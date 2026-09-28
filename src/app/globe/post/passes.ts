import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export const HoloShader = {
  name: 'HoloShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMotion: { value: 1 },
    uGrain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uMotion;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * 0.012 * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // Deep-space glow behind the globe.
      col += vec3(0.0, 0.016, 0.034) * smoothstep(0.75, 0.0, length(c * vec2(uRes.x / uRes.y, 1.0)));
      // Scanlines and grain.
      float scan = 0.955 + 0.045 * sin(vUv.y * uRes.y * 1.15 + uTime * uMotion * 3.0);
      col *= scan;
      col += (hash(vUv * uRes + fract(uTime * uMotion) * 91.7) - 0.5) * 0.02 * uGrain;
      // Subtle flicker.
      col *= 1.0 + uMotion * 0.01 * sin(uTime * 37.0) * sin(uTime * 11.3);
      // Vignette.
      float vig = smoothstep(1.1, 0.3, length(c * vec2(1.0, 1.15)) * 1.35);
      col *= mix(0.5, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  slot: 0 | 1;
  /** Horizontal shift of the globe inside the viewport, as a fraction of its width (+ = right). */
  shift?: number;
}

/** Points the camera at one viewport (aspect + optional horizontal shift). Undo with `camera.clearViewOffset()`. */
export function applyViewport(camera: THREE.PerspectiveCamera, v: Viewport, w: number, h: number): void {
  camera.aspect = w / h;
  if (v.shift) camera.setViewOffset(w, h, -v.shift * w, 0, w, h);
  else camera.updateProjectionMatrix();
}

/**
 * Renders the scene into the composer's read buffer, either full-frame or as two scissored
 * viewports (compare mode) with the same camera orientation. `prepare(slot)` swaps per-slot layers.
 */
export class SplitRenderPass extends Pass {
  viewports: Viewport[] = [];
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly prepare: (slot: 0 | 1) => void,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const target = this.renderToScreen ? null : read;
    renderer.setRenderTarget(target);
    renderer.getClearColor(this.clearColor);
    renderer.clear(true, true, false);
    const fullW = target ? target.width : renderer.domElement.width;
    const fullH = target ? target.height : renderer.domElement.height;
    const baseAspect = this.camera.aspect;
    const views = this.viewports.length ? this.viewports : [{ x: 0, y: 0, width: 1, height: 1, slot: 0 as const }];
    for (const v of views) {
      const x = Math.round(v.x * fullW);
      const y = Math.round(v.y * fullH);
      const w = Math.round(v.width * fullW);
      const h = Math.round(v.height * fullH);
      if (target) {
        target.viewport.set(x, y, w, h);
        target.scissor.set(x, y, w, h);
        target.scissorTest = views.length > 1;
      }
      applyViewport(this.camera, v, w, h);
      this.prepare(v.slot);
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
      if (v.shift) this.camera.clearViewOffset();
    }
    if (target) {
      target.viewport.set(0, 0, fullW, fullH);
      target.scissor.set(0, 0, fullW, fullH);
      target.scissorTest = false;
    }
    this.camera.aspect = baseAspect;
    this.camera.updateProjectionMatrix();
  }
}
