import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { UserDataStore } from '../../core/data/user-data.store';
import { buildIntegrable, integrate } from '../../core/engine/integrate';
import { SECONDS_PER_YEAR, WINDOW_SECONDS } from '../../core/engine/periods';
import { resolveProfile } from '../../core/engine/profiles';
import { LocaleService } from '../../core/i18n/locale.service';
import { SeoService } from '../../core/seo/seo.service';
import { SITE } from '../../core/site.config';
import { AppStore } from '../../core/state/app-store';
import { UrlSync } from '../../core/state/url-sync';
import { ClockService } from '../../core/time/clock.service';
import type { CameraPose } from '../../globe/camera-rig';
import { FlyRequest, GlobeComponent } from '../../globe/globe.component';
import type { GlobeEngine } from '../../globe/globe-engine';
import { I18nTextPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { CompareBar } from '../compare/compare-bar';
import { Ticker } from '../counters/ticker';
import { CountryPanel } from '../country-panel/country-panel';
import { TopBar } from '../hud/top-bar';
import { MetricPicker, PickerValue } from '../metric-picker/metric-picker';
import { composeScreenshot, downloadBlob } from '../share/capture';
import { ShareMenu } from '../share/share-menu';
import { TableView } from '../table/table-view';
import { TimeControls } from '../time-controls/time-controls';
import { UploadWizard } from '../upload/upload-wizard';
import { splitQuantity } from './figures';
import { GlobeTooltip } from './globe-tooltip';
import { MetricCard } from './metric-card';
import { WorldView } from './world-view.service';

/** Phone layout breakpoint (keep in sync with the SCSS media queries). */
const NARROW_QUERY = '(max-width: 760px), (max-height: 500px) and (orientation: landscape)';

@Component({
  selector: 'app-world-page',
  imports: [
    TranslocoPipe,
    I18nTextPipe,
    Icon,
    GlobeComponent,
    GlobeTooltip,
    TopBar,
    MetricPicker,
    MetricCard,
    TimeControls,
    Ticker,
    CountryPanel,
    CompareBar,
    TableView,
    ShareMenu,
    UploadWizard,
  ],
  providers: [WorldView, UrlSync],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './world-page.html',
  styleUrl: './world-page.scss',
})
export class WorldPage {
  readonly id = input<string>();

  protected readonly store = inject(AppStore);
  protected readonly world = inject(WorldView);
  protected readonly catalog = inject(CatalogService);
  protected readonly locale = inject(LocaleService);
  protected readonly lang = this.locale.lang;
  private readonly seo = inject(SeoService);
  private readonly router = inject(Router);
  private readonly clock = inject(ClockService);
  private readonly transloco = inject(TranslocoService);
  private readonly userData = inject(UserDataStore);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Phone layout (bottom sheet, one globe at a time when comparing). */
  protected readonly narrow = signal(this.isBrowser && matchMedia(NARROW_QUERY).matches);
  protected readonly pickerOpen = signal(this.isBrowser ? !matchMedia(NARROW_QUERY).matches : true);
  /** Which slot the picker is choosing for when opened from a compare card ('compare' = right slot). */
  protected readonly pickTarget = signal<'primary' | 'compare' | null>(null);
  protected readonly comparePicking = computed(() => this.pickTarget() !== null);
  /** Mobile bottom sheet collapsed to the headline. */
  protected readonly sheetCollapsed = signal(this.isBrowser && matchMedia(NARROW_QUERY).matches);
  /** Phone compare mode: which of the two metrics the single globe shows. */
  protected readonly compareSlot = signal<0 | 1>(0);
  private sheetTouch: { y: number; top: number } | null = null;
  protected readonly shareOpen = signal(false);
  protected readonly uploadOpen = signal(false);
  protected readonly capturing = signal(false);
  protected readonly unsupported = signal(false);
  protected readonly hovered = signal<{ index: number | null; slot: 0 | 1 }>({ index: null, slot: 0 });
  protected readonly fly = signal<FlyRequest | null>(null);
  protected readonly announcement = signal('');
  protected readonly reducedMotion = signal(
    this.isBrowser && typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  private engine: GlobeEngine | null = null;
  private cameraFromUrl = false;

  protected readonly initialPose = computed<CameraPose | null>(() => untracked(() => this.store.camera()));
  protected readonly selectedIndex = computed(() => {
    const iso = this.store.country();
    return iso ? (this.catalog.countryByIso().get(iso)?.i ?? null) : null;
  });
  /** Phones: how much of the screen the bottom sheet covers, so the globe (and the selected country) stays visible above it. */
  protected readonly bottomInset = computed(() => (this.sheetCollapsed() ? 0.28 : this.store.country() ? 0.56 : 0.4));
  private readonly singleCompare = computed(() => this.narrow() && this.store.comparing());
  /** Globe inputs: on phones only one metric is drawn at a time (full-size globe), switched by the compare tabs. */
  protected readonly globeA = computed(() => (this.singleCompare() && this.compareSlot() === 1 ? this.world.globeSecondary() : this.world.globePrimary()));
  protected readonly globeB = computed(() => (this.narrow() ? null : this.world.globeSecondary()));
  protected readonly hoverView = computed(() =>
    this.hovered().slot === 1 || (this.singleCompare() && this.compareSlot() === 1) ? this.world.secondary() : this.world.primary(),
  );
  /** Card shown in the sheet while comparing: the right-hand metric on desktop, the active tab on phones. */
  protected readonly compareCard = computed(() => {
    const left = this.singleCompare() && this.compareSlot() === 0;
    const view = left ? this.world.primary() : this.world.secondary();
    return view ? { view, side: left ? ('left' as const) : ('right' as const) } : null;
  });

  protected readonly pickerHeading = computed(() => {
    const mode = this.store.mode();
    this.lang();
    if (mode === 'window') {
      return this.transloco.translate('window.inTheWorld', { window: this.transloco.translate(`window.${this.store.window()}`) });
    }
    if (mode === 'history' && this.world.year()) return `${this.transloco.translate('history.year')} ${this.world.year()}`;
    return this.transloco.translate('ticker.title');
  });

  /** Integrable rates for every flow metric at its latest year (dashboard values). */
  private readonly allRates = computed(() => {
    const snaps = this.world.latestAll();
    const offsets = this.world.offsetsByIndex();
    const idx = new Map(this.catalog.countries().map((c) => [c.iso3, c.i]));
    const out = new Map<string, ReturnType<typeof buildIntegrable>>();
    for (const e of this.catalog.entries()) {
      const s = snaps.get(e.file.id);
      if (s && e.file.kind === 'flow') {
        out.set(e.file.id, buildIntegrable(s, (iso) => offsets[idx.get(iso) ?? 0] ?? 0, resolveProfile(e.file.temporalProfile)));
      }
    }
    return out;
  });

  /** Per-metric values shown in the picker/dashboard for the current mode (≤10 Hz). */
  protected readonly pickerValues = computed(() => {
    const mode = this.store.mode();
    const lang = this.lang();
    const snaps = mode === 'history' ? this.world.yearAll() : this.world.latestAll();
    const rates = this.allRates();
    const now = this.clock.now() / 1000;
    const t0 = this.clock.openedAt / 1000;
    const win = WINDOW_SECONDS[this.store.window()];
    const map = new Map<string, PickerValue>();
    for (const e of this.catalog.entries()) {
      const s = snaps.get(e.file.id);
      // No data for that year: leave the value out rather than showing a misleading 0.
      if (!s || (s.world.provenance === 'sum' && s.countries.length === 0)) continue;
      let v: number;
      if (e.file.kind === 'stock') v = s.world.value;
      else if (mode === 'history') v = s.world.value * SECONDS_PER_YEAR;
      else {
        const r = rates.get(e.file.id);
        if (!r) continue;
        v = mode === 'live' ? integrate(r, t0, now) : integrate(r, now - win, now);
      }
      const q = splitQuantity(v, e.file.unit, lang, mode === 'live' && e.file.kind === 'flow');
      const src = s.world.sourceId ? e.file.sources[s.world.sourceId] : undefined;
      map.set(e.file.id, {
        text: q.number,
        unit: q.unit,
        confidence: s.world.confidence,
        trace: `${src?.publisher ?? this.transloco.translate('provenance.sum')} · ${s.world.dataYear ?? '—'} · ${this.transloco.translate('confidence.' + s.world.confidence)}`,
      });
    }
    return map;
  });

  protected readonly shareUrl = computed(() => {
    // Recompute when state changes (URL is updated asynchronously by UrlSync).
    this.store.camera();
    this.store.metricId();
    this.store.mode();
    this.store.country();
    this.clock.now();
    return this.isBrowser ? location.href : SITE.url;
  });

  constructor() {
    if (this.isBrowser) {
      const mq = matchMedia(NARROW_QUERY);
      const onChange = () => this.narrow.set(mq.matches);
      mq.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', onChange));
      inject(UrlSync).start();
      this.cameraFromUrl = this.store.camera() !== null;
    }

    // Route param → store (the metric lives in the path).
    effect(() => {
      const id = this.id() ?? null;
      untracked(() => this.store.metricId.set(id));
    });

    // Unknown metric id (e.g. someone else's local dataset): fall back and explain.
    effect(() => {
      const id = this.id();
      if (!id || this.catalog.status() !== 'ready' || !this.userData.restored()) return;
      if (!this.catalog.byId().has(id)) {
        untracked(() => {
          this.store.missingUserMetric.set(true);
          void this.router.navigate(['/'], { queryParamsHandling: 'preserve', replaceUrl: true });
        });
      }
    });

    // SEO meta (also rendered into the prerendered HTML).
    effect(() => {
      const e = this.world.entry();
      const lang = this.lang();
      const routed = !!this.id();
      if (!e) return;
      untracked(() =>
        this.seo.set({
          title: routed ? e.file.name[lang] : SITE.name,
          description: routed ? e.file.description[lang] : this.transloco.translate('app.description'),
          path: routed ? `metric/${e.file.id}` : '',
        }),
      );
    });

    // Screen-reader announcements for coarse changes (never for ticking counters).
    effect(() => {
      const e = this.world.entry();
      const mode = this.store.mode();
      const iso = this.store.country();
      this.lang();
      if (!e) return;
      untracked(() => {
        const parts = [
          e.file.name[this.lang()],
          this.transloco.translate('a11y.mode', { mode: this.transloco.translate(`mode.${mode}`) }),
        ];
        if (iso) parts.push(this.catalog.countryName(iso, this.lang()));
        this.announcement.set(parts.join('. '));
      });
    });
  }

  // ------------------------------------------------------------------ events

  protected onPick(id: string): void {
    const target = this.pickTarget();
    this.pickTarget.set(null);
    if (target === 'compare') {
      this.store.compareId.set(id === this.world.entry()?.file.id ? null : id);
      if (!this.isBrowser || this.narrow()) this.pickerOpen.set(false);
      return;
    }
    if (target === 'primary' && id === this.store.compareId()) this.store.compareId.set(null);
    const isDefault = id === this.catalog.defaultMetricId() && !this.id();
    void this.router.navigate(isDefault ? ['/'] : ['/metric', id], { queryParamsHandling: 'preserve' });
    if (!this.isBrowser || this.narrow()) this.pickerOpen.set(false);
  }

  protected onCountrySelect(e: { index: number | null }): void {
    const c = e.index ? this.catalog.countryByIndex()[e.index] : null;
    this.store.country.set(c?.iso3 ?? null);
    if (c && e.index) this.fly.set({ index: e.index, nonce: Date.now() });
    if (c && this.narrow()) this.sheetCollapsed.set(false);
  }

  protected selectIso(iso3: string): void {
    const c = this.catalog.countryByIso().get(iso3);
    this.store.country.set(iso3);
    if (c) this.fly.set({ index: c.i, nonce: Date.now() });
    if (c && this.narrow()) this.sheetCollapsed.set(false);
  }

  /** From the table: back to the globe, focused on that country (the table stays as the fallback without WebGL). */
  protected showCountry(iso3: string): void {
    this.selectIso(iso3);
    if (!this.unsupported()) this.store.tableView.set(false);
  }

  protected onPose(p: CameraPose): void {
    this.store.camera.set(p);
  }

  protected onGlobeReady(engine: GlobeEngine): void {
    this.engine = engine;
    const iso = this.store.country();
    if (iso && !this.cameraFromUrl) this.selectIso(iso);
  }

  protected startCompare(): void {
    this.pickTarget.set('compare');
    this.pickerOpen.set(true);
  }

  protected closePicker(): void {
    this.pickTarget.set(null);
    this.pickerOpen.set(false);
  }

  protected changeSlot(target: 'primary' | 'compare'): void {
    this.pickTarget.set(target);
    this.pickerOpen.set(true);
  }

  protected stopCompare(): void {
    this.store.compareId.set(null);
    this.compareSlot.set(0);
  }

  // ------------------------------------------------------------------ phone bottom sheet (swipe / tap)

  protected onSheetTouchStart(e: TouchEvent, sheet: HTMLElement): void {
    // The country panel scrolls inside its own body: a downward swipe collapses the sheet only when that is at the top.
    const inner = (e.target as Element).closest('.body')?.scrollTop ?? 0;
    this.sheetTouch = this.narrow() ? { y: e.touches[0].clientY, top: Math.max(sheet.scrollTop, inner) } : null;
  }

  protected onSheetTouchEnd(e: TouchEvent): void {
    const t = this.sheetTouch;
    this.sheetTouch = null;
    if (!t) return;
    const dy = e.changedTouches[0].clientY - t.y;
    // Swipe up/down, or a tap on a collapsed sheet outside its buttons (keyboard users have the handle button).
    const tap = Math.abs(dy) < 8 && !(e.target as Element).closest('button, a');
    if ((dy < -32 || tap) && this.sheetCollapsed()) this.sheetCollapsed.set(false);
    else if (dy > 32 && !this.sheetCollapsed() && t.top <= 0) this.sheetCollapsed.set(true);
  }

  protected async capture(): Promise<void> {
    const v = this.world.primary();
    if (!this.engine || !v) return;
    this.capturing.set(true);
    try {
      const base = this.engine.capture();
      const lang = this.lang();
      const f = v.entry.file;
      const mode = this.store.mode();
      const value =
        f.kind === 'stock'
          ? v.snapshot.world.value
          : mode === 'live'
            ? this.world.sinceOpen(v)
            : mode === 'window'
              ? this.world.inWindow(v, this.store.window())
              : v.snapshot.world.value * SECONDS_PER_YEAR;
      const q = splitQuantity(value, f.unit, lang, mode !== 'history');
      // Same wording as the metric card: the metric name when a unit symbol is shown ("13 kt · CO₂ emitted").
      const label = q.unit ? f.name[lang] : f.unitLabel[lang];
      const caption =
        f.kind === 'stock'
          ? `${label} ${this.transloco.translate('card.level')}`
          : mode === 'live'
            ? `${label} ${this.transloco.translate('card.sinceOpen')}`
            : mode === 'window'
              ? `${label} ${this.transloco.translate('card.inWindow', { window: this.transloco.translate('window.' + this.store.window()) })}`
              : `${label} ${this.transloco.translate('card.inYear', { year: v.snapshot.year })}`;
      const src = v.snapshot.world.sourceId ? f.sources[v.snapshot.world.sourceId] : undefined;
      const blob = await composeScreenshot(base, {
        metric: f.name[lang],
        value: `${q.number}${q.unit ? ' ' + q.unit : ''}`,
        caption,
        trace: `${src?.publisher ?? ''} · ${v.snapshot.world.dataYear ?? ''} · ${this.transloco.translate('confidence.' + v.snapshot.world.confidence)}`,
        url: SITE.url.replace(/^https?:\/\//, ''),
        date: new Date().toISOString().slice(0, 10),
        color: f.visual?.color ?? '#46f0ff',
      });
      downloadBlob(blob, `world-pulse-${f.id}-${new Date().toISOString().slice(0, 10)}.png`);
    } finally {
      this.capturing.set(false);
    }
  }
}
