import {
  afterNextRender,
  ChangeDetectionStrategy,
  computed,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  isDevMode,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LocaleService } from '../core/i18n/locale.service';
import { CatalogService } from '../core/data/catalog.service';
import { EngineClient } from '../core/data/engine-client.service';
import type { CameraPose } from './camera-rig';
import { latLngToXyz } from './coords';
import type { GlobeEngine } from './globe-engine';
import { GlobeLayerData, GlobeLayers } from './layer-data';
import { initialQuality } from './quality';

export interface FlyRequest {
  index: number;
  nonce: number;
}

/**
 * Angular wrapper around the framework-free GlobeEngine. The engine and its render loop are created
 * after the first browser render and never touch Angular change detection; this component only
 * forwards signal inputs to the engine and emits coarse events (hover change, selection, camera).
 */
@Component({
  selector: 'app-globe',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'globe',
    tabindex: '0',
    role: 'application',
    '[attr.aria-label]': 'ariaLabel()',
    '(keydown)': 'onKey($event)',
  },
  template: `
    <canvas #canvas class="globe-canvas"></canvas>
    <div #tooltip class="globe-tooltip" [class.visible]="hoverVisible()">
      <ng-content select="[globeTooltip]" />
    </div>
    @if (status() === 'loading') {
      <div class="globe-loading" aria-live="polite">
        <span class="spinner"></span>{{ 'fallback.globeLoading' | transloco }}
      </div>
    }
  `,
  styleUrl: './globe.component.scss',
})
export class GlobeComponent {
  readonly primary = input<GlobeLayerData | null>(null);
  readonly secondary = input<GlobeLayerData | null>(null);
  readonly layers = input<GlobeLayers>({ particles: true, spikes: true, choropleth: true });
  readonly selectedIndex = input<number | null>(null);
  readonly timeScale = input(1);
  readonly initialPose = input<CameraPose | null>(null);
  readonly fly = input<FlyRequest | null>(null);
  readonly reducedMotion = input(false);
  /** Portrait phones: fraction of the screen height covered by the bottom sheet. */
  readonly bottomInset = input(0.32);

  readonly hoverChange = output<{ index: number | null; slot: 0 | 1 }>();
  readonly countrySelect = output<{ index: number | null; slot: 0 | 1 }>();
  readonly poseChange = output<CameraPose>();
  readonly unsupported = output<void>();
  readonly ready = output<GlobeEngine>();

  protected readonly status = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly hoverVisible = signal(false);
  private readonly transloco = inject(TranslocoService);
  private readonly locale = inject(LocaleService);
  protected readonly ariaLabel = computed(() => {
    this.locale.lang();
    return this.transloco.translate('a11y.globe');
  });

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly tooltip = viewChild.required<ElementRef<HTMLDivElement>>('tooltip');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly catalog = inject(CatalogService);
  private readonly engineClient = inject(EngineClient);
  private readonly engine = signal<GlobeEngine | null>(null);
  private lastHover: number | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    let disposed = false;
    let resize: ResizeObserver | null = null;
    destroyRef.onDestroy(() => {
      disposed = true;
      resize?.disconnect();
      this.engine()?.dispose();
    });

    afterNextRender(() => {
      void this.boot(() => disposed).then((engine) => {
        if (!engine) return;
        resize = new ResizeObserver(([entry]) => {
          const box = entry.contentRect;
          engine.resize(box.width, box.height);
        });
        resize.observe(this.host.nativeElement);
      });
    });

    effect(() => this.engine()?.setData(0, this.primary()));
    effect(() => this.engine()?.setData(1, this.secondary()));
    effect(() => this.engine()?.setLayers(this.layers()));
    effect(() => this.engine()?.setSelected(this.selectedIndex()));
    effect(() => this.engine()?.setTimeScale(this.timeScale()));
    effect(() => this.engine()?.setReducedMotion(this.reducedMotion()));
    effect(() => this.engine()?.setBottomInset(this.bottomInset()));
    effect(() => {
      const req = this.fly();
      const engine = this.engine();
      if (req && engine) untracked(() => engine.flyToIndex(req.index));
    });
  }

  private async boot(isDisposed: () => boolean): Promise<GlobeEngine | null> {
    const { GlobeEngine } = await import('./globe-engine');
    if (!GlobeEngine.supported()) {
      this.status.set('failed');
      this.unsupported.emit();
      return null;
    }
    await this.catalog.load();
    const countries = this.catalog.countries();
    const count = countries.reduce((m, c) => Math.max(m, c.i), 0);
    const { level, mobile } = initialQuality();
    const hi = !mobile;
    const assetsPromise = this.engineClient.geo({
      url: new URL(`data/geo/countries-${hi ? '50m' : '110m'}.json`, document.baseURI).href,
      indexOf: Object.fromEntries(countries.map((c) => [c.iso3, c.i])),
      countryCount: count,
      width: hi ? 4096 : 2048,
      height: hi ? 2048 : 1024,
      poolSize: hi ? 96 : 48,
      lineRadius: 1.0015,
      maxSegmentDeg: hi ? 1 : 2,
    });

    const engine = new GlobeEngine({
      canvas: this.canvas().nativeElement,
      reducedMotion: this.reducedMotion(),
      mobile,
      quality: level,
      maxQuality: mobile ? 1 : 2,
      callbacks: {
        hover: (h) => {
          const el = this.tooltip().nativeElement;
          el.style.transform = `translate(${Math.round(h.x)}px, ${Math.round(h.y)}px)`;
          // Keep the tooltip on screen near the right/top edges.
          const box = this.host.nativeElement.clientWidth;
          el.dataset['side'] = h.x > box - 270 ? 'left' : 'right';
          el.dataset['v'] = h.y < 70 ? 'below' : 'middle';
          if (h.index !== this.lastHover) {
            this.lastHover = h.index;
            this.hoverVisible.set(h.index !== null);
            this.hoverChange.emit({ index: h.index, slot: h.slot });
          }
        },
        select: (index, slot) => this.countrySelect.emit({ index, slot }),
        camera: (pose) => this.poseChange.emit(pose),
      },
    });
    const rect = this.host.nativeElement.getBoundingClientRect();
    engine.resize(rect.width, rect.height);
    const fromUrl = this.initialPose();
    if (fromUrl) engine.setPose(fromUrl, false);
    else engine.intro(this.defaultPose());
    engine.start();
    if (isDevMode()) (globalThis as { __wpGlobe?: GlobeEngine }).__wpGlobe = engine;

    const assets = await assetsPromise;
    if (isDisposed()) {
      engine.dispose();
      return null;
    }
    const centroids = new Float32Array((count + 1) * 3);
    const tmp = [0, 0, 0];
    for (const c of countries) {
      latLngToXyz(c.c[1], c.c[0], 1, tmp);
      centroids.set(tmp, c.i * 3);
    }
    engine.setGeo({ assets, centroids, countryCount: count });
    this.engine.set(engine);
    this.status.set('ready');
    this.ready.emit(engine);
    return engine;
  }

  /** Centre on the visitor's own country (from the browser time zone) — no geolocation needed. */
  private defaultPose(): CameraPose {
    let lat = 22;
    let lng = 12;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const c = this.catalog.countries().find((k) => k.tz === tz);
      if (c) {
        lng = c.c[0];
        lat = Math.max(-30, Math.min(50, c.c[1] - 8));
      }
    } catch {
      /* keep default */
    }
    // Fit the globe to the narrower field of view (portrait phones are limited horizontally).
    const rect = this.host.nativeElement.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const halfV = (36 / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const fill = aspect < 1 ? 0.8 : 0.68;
    const alt = 1 / Math.sin(fill * Math.min(halfV, halfH)) - 1;
    return { lat, lng, alt: Math.max(1.2, Math.min(8.5, alt)) };
  }

  protected onKey(e: KeyboardEvent): void {
    const engine = this.engine();
    if (!engine) return;
    const step = e.shiftKey ? 15 : 5;
    switch (e.key) {
      case 'ArrowLeft':
        engine.rotateBy(0, -step);
        break;
      case 'ArrowRight':
        engine.rotateBy(0, step);
        break;
      case 'ArrowUp':
        engine.rotateBy(step, 0);
        break;
      case 'ArrowDown':
        engine.rotateBy(-step, 0);
        break;
      case '+':
      case '=':
        engine.zoomBy(0.8);
        break;
      case '-':
      case '_':
        engine.zoomBy(1.25);
        break;
      case 'Enter':
      case ' ':
        this.countrySelect.emit({ index: engine.pickCenter(), slot: 0 });
        break;
      case 'Escape':
        this.countrySelect.emit({ index: null, slot: 0 });
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
