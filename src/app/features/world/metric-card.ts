import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SECONDS_PER_YEAR, WINDOW_SECONDS } from '../../core/engine/periods';
import { formatQuantity } from '../../core/engine/units';
import { instantRate } from '../../core/engine/integrate';
import { CatalogService } from '../../core/data/catalog.service';
import { LocaleService } from '../../core/i18n/locale.service';
import { AppStore, Layers } from '../../core/state/app-store';
import { ClockService } from '../../core/time/clock.service';
import { I18nTextPipe, PercentPipe, QuantityPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { ConfidenceBadge } from '../../shared/ui/confidence-badge';
import { Odometer } from '../../shared/ui/odometer';
import { MetricView, WorldView } from './world-view.service';
import { splitQuantity, worldPlacedShares } from './figures';

const CATEGORY_ICON: Record<string, string> = {
  consumer: 'bag',
  'demography-health': 'users',
  'environment-energy': 'leaf',
  digital: 'wifi',
  economy: 'dollar',
  geography: 'globe',
  user: 'database',
};

@Component({
  selector: 'app-metric-card',
  imports: [TranslocoPipe, Icon, Odometer, ConfidenceBadge, QuantityPipe, PercentPipe, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './metric-card.html',
  styleUrl: './metric-card.scss',
})
export class MetricCard {
  readonly view = input.required<MetricView>();
  /** Compact variant (compare mode / country selected). */
  readonly compact = input(false);
  readonly side = input<'left' | 'right' | null>(null);
  readonly compareRequest = output<void>();
  /** Asks to pick another metric for this card (compare mode). */
  readonly changeMetric = output<void>();
  /** Mobile: collapsed card shows only title + headline. */
  readonly collapsed = input(false);

  protected readonly store = inject(AppStore);
  protected readonly world = inject(WorldView);
  private readonly clock = inject(ClockService);
  private readonly catalog = inject(CatalogService);
  protected readonly locale = inject(LocaleService);
  protected readonly lang = this.locale.lang;
  protected readonly showDetails = signal(false);

  protected readonly file = computed(() => this.view().entry.file);
  protected readonly snapshot = computed(() => this.view().snapshot);
  protected readonly isFlow = computed(() => this.file().kind === 'flow');
  protected readonly hasProfile = computed(() => this.view().rates.hourly.some((h) => Math.abs(h - 1) > 1e-9));
  protected readonly color = computed(() => this.file().visual?.color ?? '#46f0ff');
  protected readonly icon = computed(() => this.file().visual?.icon ?? CATEGORY_ICON[this.file().category] ?? 'globe');
  protected readonly isUser = computed(() => this.view().entry.origin === 'user');
  protected readonly perCapita = computed(() => this.store.perCapita() && this.file().id !== 'population' && !!this.view().population);

  /** Main figure (recomputed at the 10 Hz clock rate when counting). */
  protected readonly headline = computed(() => {
    const v = this.view();
    const mode = this.store.mode();
    const f = this.file();
    if (this.perCapita()) {
      const w = v.display.world.value;
      return { kind: 'perPerson' as const, value: f.kind === 'flow' ? w * SECONDS_PER_YEAR : w };
    }
    if (f.kind === 'stock') return { kind: 'level' as const, value: v.snapshot.world.value };
    if (mode === 'live') return { kind: 'sinceOpen' as const, value: this.world.sinceOpen(v) };
    if (mode === 'window') {
      const r = this.world.replay();
      const total = this.world.inWindow(v, this.store.window());
      return { kind: 'window' as const, value: r ? total * this.world.replayProgress() : total };
    }
    return { kind: 'year' as const, value: v.snapshot.world.value * SECONDS_PER_YEAR };
  });

  protected readonly headlineParts = computed(() => {
    const h = this.headline();
    const precise = h.kind === 'sinceOpen' || h.kind === 'window';
    const unit = this.file().unit;
    if (h.kind === 'perPerson') {
      const f = formatQuantity(h.value, unit, this.lang());
      return { number: f.number, unit: f.unit };
    }
    return splitQuantity(h.value, unit, this.lang(), precise && h.value < 1e9);
  });

  /** Noun after the number: the unit label for plain counts ("births"), the metric name when a unit symbol is shown ("13 kt · CO₂ emitted"). */
  protected readonly captionLabel = computed(() => (this.headlineParts().unit ? this.file().name : this.file().unitLabel));

  protected readonly captionKey = computed(() => {
    switch (this.headline().kind) {
      case 'sinceOpen':
        return 'card.sinceOpen';
      case 'window':
        return 'card.inWindow';
      case 'year':
        return 'card.inYear';
      case 'perPerson':
        return this.isFlow() ? 'card.perPersonYear' : 'country.perPerson';
      default:
        return 'card.level';
    }
  });

  protected readonly ratePerSecond = computed(() => {
    const v = this.view();
    if (!this.isFlow()) return null;
    if (this.store.mode() === 'history') return v.snapshot.world.value;
    return instantRate(v.rates, this.clock.now() / 1000);
  });
  protected readonly perYear = computed(() => (this.isFlow() ? this.snapshot().world.value * SECONDS_PER_YEAR : null));
  protected readonly perDay = computed(() => (this.isFlow() ? this.snapshot().world.value * WINDOW_SECONDS['1d'] : null));

  protected readonly shares = computed(() => worldPlacedShares(this.snapshot()));
  protected readonly worldSource = computed(() => {
    const id = this.snapshot().world.sourceId;
    const f = this.file();
    return id ? f.sources[id] : Object.values(f.sources)[0];
  });
  /** Proxy used to allocate the residual, as an i18n key ("proxyBy.gdp" → "GDP"). */
  protected readonly proxyKey = computed(() => {
    const proxy = this.file().allocation?.proxy;
    return proxy && this.catalog.byId().has(proxy) ? `proxyBy.${proxy}` : null;
  });
  protected readonly sources = computed(() => Object.entries(this.file().sources).map(([id, s]) => ({ id, ...s })));
  protected readonly legend = computed(() => {
    const g = this.side() === 'right' ? this.world.globeSecondary() : this.world.globePrimary();
    if (!g || !g.unitsPerParticle || !this.isFlow()) return null;
    const f = formatQuantity(g.unitsPerParticle, this.file().unit, this.lang());
    return { text: f.text, label: f.unit ? null : this.file().unitLabel };
  });
  /** Quantile classes of the map fill (same colours as the globe, same unit/period as the tooltip). */
  protected readonly mapLegend = computed(() => {
    const g = this.side() === 'right' ? this.world.globeSecondary() : this.world.globePrimary();
    const c = g?.classes;
    if (!c) return null;
    const k = this.isFlow() ? SECONDS_PER_YEAR : 1;
    const lang = this.lang();
    const unit = this.file().unit;
    const fmt = (x: number) => formatQuantity(x * k, unit, lang).text;
    return {
      min: fmt(c.breaks[0]),
      max: fmt(c.breaks[c.breaks.length - 1]),
      classes: c.colors.map((color, i) => ({ color, range: `${fmt(c.breaks[i])} – ${fmt(c.breaks[i + 1])}` })),
      allocated: this.view().display.countries.some((d) => d.provenance === 'allocated'),
    };
  });

  protected readonly stale = computed(() => {
    const y = this.snapshot().world.dataYear;
    if (this.store.mode() === 'history') return null;
    return y !== null && y < new Date().getFullYear() - 3 ? y : null;
  });

  protected readonly layerKeys: (keyof Layers)[] = ['particles', 'spikes', 'choropleth'];
  protected readonly layerIcons: Record<keyof Layers, string> = { particles: 'live', spikes: 'layers', choropleth: 'globe' };
}
