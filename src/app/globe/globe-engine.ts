import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { subsolarPoint } from '../core/engine/time';
import { CameraPose, CameraRig } from './camera-rig';
import { classOf, MAX_CLASSES } from './choropleth';
import { DEG, idMapPixel, latLngToXyz, xyzToLatLng } from './coords';
import type { GeoAssets } from './geo/rasterize';
import { FLAG_ALLOCATED, GlobeLayerData, GlobeLayers, HoverInfo } from './layer-data';
import { Atmosphere } from './layers/atmosphere';
import { Backdrop } from './layers/backdrop';
import { BorderLines } from './layers/border-lines';
import { blankTexture, DATA_TEX_WIDTH, HoloSphere } from './layers/holo-sphere';
import { Particles } from './layers/particles';
import { Spikes } from './layers/spikes';
import { applyViewport, HoloShader, SplitRenderPass, Viewport } from './post/passes';
import { profileFor, QualityGovernor, QualityLevel } from './quality';

export interface GlobeCallbacks {
  hover(info: HoverInfo): void;
  select(index: number | null, slot: 0 | 1): void;
  camera(pose: CameraPose): void;
  quality?(level: QualityLevel, frameMs: number): void;
}

export interface GlobeEngineOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  mobile: boolean;
  quality: QualityLevel;
  maxQuality: QualityLevel;
  callbacks: GlobeCallbacks;
}

export interface GeoBundle {
  assets: GeoAssets;
  /** Unit-sphere centroid (xyz) per country index. */
  centroids: Float32Array;
  countryCount: number;
}

interface Slot {
  data: GlobeLayerData | null;
  tex: THREE.DataTexture;
  prevTex: THREE.DataTexture;
  color: THREE.Color;
  /** Choropleth class colours (linear), current and previous dataset. */
  ramp: THREE.Color[];
  prevRamp: THREE.Color[];
  mix: number;
  acc: Float32Array;
  particles: Particles;
  spikes: Spikes | null;
}

const MAX_SPIKE = 0.42;

/** Owns the WebGL renderer, scene, render loop and interaction. Framework-free; runs outside Angular. */
export class GlobeEngine {
  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly split: SplitRenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly holo: ShaderPass;
  private readonly rig: CameraRig;
  private readonly sphere: HoloSphere;
  private readonly atmosphere = new Atmosphere();
  private readonly backdrop: Backdrop;
  private borders: BorderLines | null = null;
  private readonly slots: [Slot, Slot];
  private geo: GeoBundle | null = null;
  private layers: GlobeLayers = { particles: true, spikes: true, choropleth: true };
  private readonly governor: QualityGovernor;
  private pixelRatio = 1;
  private spawnBudget = 400;
  private width = 1;
  private height = 1;
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private simUnix = Date.now() / 1000;
  private timeScale = 1;
  private sunTimer = 0;
  private reducedMotion: boolean;
  private comparing = false;
  private hovered: number | null = null;
  private selected: number | null = null;
  private pointer: { x: number; y: number; dirty: boolean; inside: boolean } = { x: 0, y: 0, dirty: false, inside: false };
  private down: { x: number; y: number; t: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpColor = new THREE.Color();
  private readonly listeners: [EventTarget, string, EventListener][] = [];
  private cameraNotify = 0;

  constructor(private readonly opts: GlobeEngineOptions) {
    this.reducedMotion = opts.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x010409, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 200);
    this.camera.position.set(0, 0, 3.3);

    this.sphere = new HoloSphere(opts.mobile ? 64 : 96);
    this.backdrop = new Backdrop(opts.mobile ? 700 : 1600);
    this.scene.add(this.backdrop.group, this.atmosphere.mesh, this.sphere.mesh);

    const capacity = opts.mobile ? 8000 : 20000;
    this.slots = [this.createSlot(capacity), this.createSlot(Math.round(capacity / 2))];
    for (const s of this.slots) this.scene.add(s.particles.group);

    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace }),
    );
    this.split = new SplitRenderPass(this.scene, this.camera, (slot) => this.prepareSlot(slot));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.42, 0.32);
    this.holo = new ShaderPass(HoloShader);
    this.composer.addPass(this.split);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.holo);
    this.composer.addPass(new OutputPass());

    this.rig = new CameraRig(this.camera, opts.canvas, this.reducedMotion, () => this.onCameraChange());
    this.governor = new QualityGovernor(opts.quality, opts.maxQuality, (level) => this.applyQuality(level));
    this.applyQuality(opts.quality);
    this.updateSun();
    this.bindPointer(opts.canvas);
    this.listen(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  private createSlot(capacity: number): Slot {
    const height = 1;
    return {
      data: null,
      tex: blankTexture(DATA_TEX_WIDTH, height),
      prevTex: blankTexture(DATA_TEX_WIDTH, height),
      color: new THREE.Color('#46f0ff'),
      ramp: Array.from({ length: MAX_CLASSES }, () => new THREE.Color()),
      prevRamp: Array.from({ length: MAX_CLASSES }, () => new THREE.Color()),
      mix: 1,
      acc: new Float32Array(0),
      particles: new Particles(capacity),
      spikes: null,
    };
  }

  /** Dev-only handle for debugging from the console. */
  get debug(): { scene: THREE.Scene; bloom: UnrealBloomPass; holo: ShaderPass; frameMs: number; quality: QualityLevel; renderer: THREE.WebGLRenderer } {
    return { scene: this.scene, bloom: this.bloom, holo: this.holo, frameMs: this.governor.frameMs, quality: this.governor.level, renderer: this.renderer };
  }

  // ------------------------------------------------------------------ public API

  setGeo(bundle: GeoBundle): void {
    this.geo = bundle;
    const { assets } = bundle;
    this.sphere.setIdMap(assets.ids, assets.width, assets.height);
    this.borders?.dispose();
    if (this.borders) this.scene.remove(this.borders.group);
    this.borders = new BorderLines(assets.coastlines, assets.borders);
    this.scene.add(this.borders.group);
    const texHeight = Math.ceil((bundle.countryCount + 1) / DATA_TEX_WIDTH);
    for (const s of this.slots) {
      s.tex.dispose();
      s.prevTex.dispose();
      s.tex = blankTexture(DATA_TEX_WIDTH, texHeight);
      s.prevTex = blankTexture(DATA_TEX_WIDTH, texHeight);
      s.acc = new Float32Array(bundle.countryCount + 1).map(() => Math.random());
      s.spikes?.dispose();
      if (s.spikes) this.scene.remove(s.spikes.mesh);
      s.spikes = new Spikes(bundle.centroids);
      this.scene.add(s.spikes.mesh);
      if (s.data) this.setData(this.slots.indexOf(s) as 0 | 1, s.data, true);
    }
  }

  setData(slotIndex: 0 | 1, data: GlobeLayerData | null, immediate = false): void {
    const s = this.slots[slotIndex];
    if (!immediate && s.data && data && s.data.key === data.key && this.geo) {
      s.data = data;
      return;
    }
    const changedMetric = !s.data || !data || s.data.key.split('|')[0] !== data.key.split('|')[0];
    s.data = data;
    if (slotIndex === 1) this.setComparing(data !== null);
    if (!this.geo || !s.spikes) return;
    if (!data) {
      s.particles.clear();
      s.spikes.setTargets(new Float32Array(0), new Uint8Array(0), s.color, false);
      return;
    }
    // Cross-fade: current becomes previous.
    const swap = s.prevTex;
    s.prevTex = s.tex;
    s.tex = swap;
    s.color.set(data.color);
    const rampSwap = s.prevRamp;
    s.prevRamp = s.ramp;
    s.ramp = rampSwap;
    const classes = data.classes;
    s.ramp.forEach((c, k) => c.set(classes?.colors[Math.min(k, classes.colors.length - 1)] ?? data.color));
    s.mix = immediate ? 1 : 0;

    const n = this.geo.countryCount + 1;
    let max = 0;
    for (let i = 1; i < n; i++) if (data.flags[i] && data.values[i] > max) max = data.values[i];
    const texData = s.tex.image.data as Uint8Array;
    texData.fill(0);
    const heights = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const v = data.values[i];
      const flag = data.flags[i];
      if (!flag || !(v > 0) || max <= 0) continue;
      const r = v / max;
      // Choropleth: quantile class (colour index) + its position in the ramp (brightness).
      const k = classes ? classOf(v, classes) : -1;
      const n = classes ? classes.colors.length : 1;
      texData[i * 4] = k + 1;
      texData[i * 4 + 1] = flag;
      texData[i * 4 + 2] = Math.round((n > 1 ? Math.max(0, k) / (n - 1) : 1) * 255);
      const hs = data.scale === 'linear' ? r : data.scale === 'log' ? Math.log10(1 + 99 * r) / 2 : Math.sqrt(r);
      heights[i] = Math.max(0.004, hs * MAX_SPIKE);
    }
    s.tex.needsUpdate = true;
    s.spikes.setTargets(heights, data.flags, s.color, immediate);
    if (changedMetric) {
      s.particles.clear();
      s.acc.fill(0);
    }
  }

  setLayers(layers: GlobeLayers): void {
    this.layers = { ...layers };
    for (const s of this.slots) {
      s.particles.group.visible = layers.particles;
      if (s.spikes) s.spikes.mesh.visible = layers.spikes;
    }
    this.sphere.material.uniforms['uChoropleth'].value = layers.choropleth ? 1 : 0;
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
    if (scale === 1) this.simUnix = Date.now() / 1000;
  }

  setSelected(index: number | null): void {
    this.selected = index;
    this.sphere.material.uniforms['uSelected'].value = index ?? -1;
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
    this.rig.setReducedMotion(v);
  }

  pose(): CameraPose {
    return this.rig.pose();
  }

  setPose(pose: CameraPose, animate: boolean): void {
    this.rig.setPose(pose, animate);
  }

  /** Opening shot: start far and slightly rotated, then glide to the pose. */
  intro(target: CameraPose): void {
    const pose = this.comparing ? { ...target, alt: Math.max(target.alt, this.compareFitAlt()) } : target;
    if (this.reducedMotion) {
      this.rig.setPose(pose, false);
      return;
    }
    this.rig.setPose({ lat: pose.lat + 12, lng: pose.lng - 55, alt: pose.alt + 2.2 }, false);
    this.rig.glideTo(pose, 2.6);
  }

  flyToIndex(index: number): void {
    if (!this.geo) return;
    const c = this.geo.centroids;
    const { lat, lng } = xyzToLatLng(c[index * 3], c[index * 3 + 1], c[index * 3 + 2]);
    this.rig.flyTo(lat, lng);
  }

  rotateBy(dLat: number, dLng: number): void {
    this.rig.rotateBy(dLat, dLng);
  }

  zoomBy(factor: number): void {
    this.rig.zoomBy(factor);
  }

  /** Country index at the centre of the (primary) view. */
  pickCenter(): number | null {
    const p = this.rig.pose();
    return this.pickLatLng(p.lat, p.lng) ?? this.nearestCountry(p.lat, p.lng, 10);
  }

  /** Nearest country centroid within maxDeg (keyboard selection over the sea). */
  private nearestCountry(lat: number, lng: number, maxDeg: number): number | null {
    if (!this.geo) return null;
    const xyz = latLngToXyz(lat, lng, 1);
    const c = this.geo.centroids;
    let best: number | null = null;
    let bestDot = Math.cos(maxDeg * DEG);
    for (let i = 1; i <= this.geo.countryCount; i++) {
      const dot = xyz[0] * c[i * 3] + xyz[1] * c[i * 3 + 1] + xyz[2] * c[i * 3 + 2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return best;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    // On narrow portrait layouts the bottom sheet covers the lower part: lift the globe.
    if (this.width < 760 && this.height > this.width && !this.comparing) {
      this.camera.setViewOffset(this.width, this.height, 0, this.height * 0.16, this.width, this.height);
    } else if (this.height <= 500 && this.width > this.height && !this.comparing) {
      // Short landscape (phone on its side): the side panel covers the right: shift the globe left.
      this.camera.setViewOffset(this.width, this.height, Math.min(170, this.width * 0.19), 0, this.width, this.height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    (this.holo.uniforms['uRes'].value as THREE.Vector2).set(this.width * this.pixelRatio, this.height * this.pixelRatio);
    this.layoutViewports();
  }

  start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    if (this.timeScale === 1) this.simUnix = Date.now() / 1000;
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Renders one frame and returns a 2D copy of it (for PNG export). */
  capture(): HTMLCanvasElement {
    this.composer.render(0);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    out.getContext('2d')!.drawImage(src, 0, 0);
    return out;
  }

  dispose(): void {
    this.stop();
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.rig.dispose();
    for (const s of this.slots) {
      s.particles.dispose();
      s.spikes?.dispose();
      s.tex.dispose();
      s.prevTex.dispose();
    }
    this.borders?.dispose();
    this.sphere.dispose();
    this.atmosphere.dispose();
    this.backdrop.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ------------------------------------------------------------------ frame

  private tick(now: number): void {
    const frameMs = now - this.last;
    this.last = now;
    const dt = Math.min(0.1, Math.max(0, frameMs / 1000));
    this.time += dt;
    this.simUnix += dt * this.timeScale;
    this.governor.sample(frameMs, dt);

    this.sunTimer -= dt;
    if (this.sunTimer <= 0) this.updateSun();

    this.rig.update(dt);
    const u = this.sphere.material.uniforms;
    u['uTime'].value = this.time;
    u['uMotion'].value = this.reducedMotion ? 0 : 1;
    this.holo.uniforms['uTime'].value = this.time;
    this.holo.uniforms['uMotion'].value = this.reducedMotion ? 0 : 1;
    this.backdrop.update(this.time, dt, this.pixelRatio, !this.reducedMotion);

    for (const s of this.slots) {
      if (s.mix < 1) s.mix = Math.min(1, s.mix + dt / 0.9);
      if (this.layers.particles && s.data) this.spawn(s, dt);
      s.particles.flush(this.time, this.reducedMotion);
      s.spikes?.update(dt);
    }

    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      this.updateHover();
    }
    this.composer.render(dt);
  }

  private spawn(s: Slot, dt: number): void {
    const d = s.data!;
    const geo = this.geo;
    if (!geo || d.unitsPerParticle <= 0) return;
    const { poolPoints, poolStart, poolCount } = geo.assets;
    const hourBase = this.simUnix / 3600;
    const perSecondBudget = this.comparing ? this.spawnBudget / 2 : this.spawnBudget;
    let budget = Math.max(1, Math.ceil(perSecondBudget * dt * 1.5));
    const scale = (dt * this.timeScale) / d.unitsPerParticle;
    const n = geo.countryCount + 1;
    const hourly = d.hourly;
    for (let i = 1; i < n && budget > 0; i++) {
      const r = d.rates[i];
      if (!(r > 0)) continue;
      let lh = (hourBase + d.offsets[i]) % 24;
      if (lh < 0) lh += 24;
      s.acc[i] += r * hourly[Math.min(23, lh | 0)] * scale;
      if (s.acc[i] > 12) s.acc[i] = 12;
      while (s.acc[i] >= 1 && budget > 0) {
        s.acc[i] -= 1;
        budget--;
        const count = poolCount[i];
        let x: number, y: number, z: number;
        if (count > 0) {
          const k = (poolStart[i] + ((Math.random() * count) | 0)) * 3;
          x = poolPoints[k];
          y = poolPoints[k + 1];
          z = poolPoints[k + 2];
        } else {
          x = geo.centroids[i * 3];
          y = geo.centroids[i * 3 + 1];
          z = geo.centroids[i * 3 + 2];
        }
        const dim = d.flags[i] === FLAG_ALLOCATED ? 0.55 : 1;
        const jitter = 0.8 + Math.random() * 0.4;
        this.tmpColor.copy(s.color).multiplyScalar(dim * jitter);
        s.particles.spawn(x, y, z, this.time, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
      }
    }
  }

  private prepareSlot(slot: 0 | 1): void {
    const s = this.slots[slot];
    const u = this.sphere.material.uniforms;
    u['uData'].value = s.tex;
    u['uDataPrev'].value = s.prevTex;
    u['uMix'].value = s.data ? s.mix : 1;
    const ramp = u['uRamp'].value as THREE.Color[];
    const prevRamp = u['uRampPrev'].value as THREE.Color[];
    for (let k = 0; k < MAX_CLASSES; k++) {
      ramp[k].copy(s.ramp[k]);
      prevRamp[k].copy(s.prevRamp[k]);
    }
    u['uHover'].value = this.hovered ?? -1;
    for (let k = 0; k < 2; k++) {
      const visible = k === slot;
      this.slots[k].particles.group.visible = visible && this.layers.particles;
      const sp = this.slots[k].spikes;
      if (sp) sp.mesh.visible = visible && this.layers.spikes;
    }
  }

  // ------------------------------------------------------------------ helpers

  private setComparing(on: boolean): void {
    if (this.comparing === on) return;
    this.comparing = on;
    this.resize(this.width, this.height);
    // Each globe gets half the screen: back off so it still fits its viewport.
    if (on) this.rig.ensureAltAtLeast(this.compareFitAlt(), 0.9);
  }

  /** Camera altitude at which a globe fits one half of the split screen. */
  private compareFitAlt(): number {
    const portrait = this.height > this.width;
    const aspect = portrait ? this.width / (this.height / 2) : this.width / 2 / this.height;
    const halfV = (this.camera.fov / 2) * DEG;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    return 1 / Math.sin(0.66 * Math.min(halfV, halfH)) - 1;
  }

  private layoutViewports(): void {
    if (!this.comparing) {
      this.split.viewports = [];
      return;
    }
    const portrait = this.height > this.width;
    this.split.viewports = portrait
      ? [
          { x: 0, y: 0.5, width: 1, height: 0.5, slot: 0 },
          { x: 0, y: 0, width: 1, height: 0.5, slot: 1 },
        ]
      : [
          // Nudge both globes towards the centre, away from the metric cards on the sides.
          { x: 0, y: 0, width: 0.5, height: 1, slot: 0, shift: 0.1 },
          { x: 0.5, y: 0, width: 0.5, height: 1, slot: 1, shift: -0.1 },
        ];
  }

  private applyQuality(level: QualityLevel): void {
    const p = profileFor(level);
    this.pixelRatio = p.pixelRatio;
    this.spawnBudget = p.spawnBudget;
    this.bloom.enabled = p.bloom;
    this.bloom.strength = 0.6;
    this.resize(this.width, this.height);
    this.opts.callbacks.quality?.(level, this.governor?.frameMs ?? 16);
  }

  private updateSun(): void {
    this.sunTimer = 10;
    const s = subsolarPoint(new Date(this.simUnix * 1000));
    const xyz = latLngToXyz(s.lat, s.lng, 1);
    (this.sphere.material.uniforms['uSunDir'].value as THREE.Vector3).set(xyz[0], xyz[1], xyz[2]);
  }

  private onCameraChange(): void {
    if (!this.rig?.userDriven) return;
    const now = performance.now();
    if (now - this.cameraNotify < 250) return;
    this.cameraNotify = now;
    this.opts.callbacks.camera(this.rig.pose());
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    this.listen(canvas, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      const rect = canvas.getBoundingClientRect();
      this.pointer = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, dirty: true, inside: true };
    });
    this.listen(canvas, 'pointerleave', () => {
      this.pointer.inside = false;
      this.pointer.dirty = true;
    });
    this.listen(canvas, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      this.rig.interacted();
    });
    this.listen(canvas, 'pointerup', (e) => {
      const ev = e as PointerEvent;
      const d = this.down;
      this.down = null;
      if (ev.pointerType !== 'mouse') {
        this.pointer.inside = false;
        this.pointer.dirty = true;
      }
      if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const rect = canvas.getBoundingClientRect();
      const hit = this.pickScreen(ev.clientX - rect.left, ev.clientY - rect.top);
      this.opts.callbacks.select(hit.index, hit.slot);
    });
    this.listen(canvas, 'wheel', () => this.rig.interacted());
  }

  private updateHover(): void {
    const hit = this.pointer.inside ? this.pickScreen(this.pointer.x, this.pointer.y) : { index: null, slot: 0 as const };
    this.hovered = hit.index;
    this.opts.callbacks.hover({ index: hit.index, x: this.pointer.x, y: this.pointer.y, slot: hit.slot });
  }

  private pickScreen(px: number, py: number): { index: number | null; slot: 0 | 1 } {
    // Locate the viewport under the pointer (GL y axis points up).
    const nx = px / this.width;
    const ny = 1 - py / this.height;
    const views: Viewport[] = this.split.viewports.length
      ? this.split.viewports
      : [{ x: 0, y: 0, width: 1, height: 1, slot: 0 }];
    const v = views.find((q) => nx >= q.x && nx <= q.x + q.width && ny >= q.y && ny <= q.y + q.height) ?? views[0];
    const ndc = new THREE.Vector2(((nx - v.x) / v.width) * 2 - 1, ((ny - v.y) / v.height) * 2 - 1);
    const aspect = this.camera.aspect;
    applyViewport(this.camera, v, v.width * this.width, v.height * this.height);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (v.shift) this.camera.clearViewOffset();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const o = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const b = o.dot(dir);
    const c = o.dot(o) - 1;
    const disc = b * b - c;
    if (disc < 0) return { index: null, slot: v.slot };
    const t = -b - Math.sqrt(disc);
    const p = o.clone().addScaledVector(dir, t);
    const { lat, lng } = xyzToLatLng(p.x, p.y, p.z);
    return { index: this.pickLatLng(lat, lng), slot: v.slot };
  }

  private pickLatLng(lat: number, lng: number): number | null {
    const geo = this.geo;
    if (!geo) return null;
    const { ids, width, height, pixelCounts } = geo.assets;
    const id = ids[idMapPixel(lat, lng, width, height)];
    if (id) return id;
    // Micro-states that cover (almost) no pixels: pick the nearest centroid within ~1.2°.
    const xyz = latLngToXyz(lat, lng, 1);
    let best: number | null = null;
    let bestDot = Math.cos(1.2 * DEG);
    for (let i = 1; i <= geo.countryCount; i++) {
      if (pixelCounts[i] > 12) continue;
      const c = geo.centroids;
      const dot = xyz[0] * c[i * 3] + xyz[1] * c[i * 3 + 1] + xyz[2] * c[i * 3 + 2];
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    return best;
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn, { passive: true });
    this.listeners.push([target, type, fn]);
  }
}
