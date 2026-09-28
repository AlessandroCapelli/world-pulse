import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CATEGORY_ORDER, CatalogService } from '../../core/data/catalog.service';
import { EngineClient } from '../../core/data/engine-client.service';
import { SECONDS_PER_YEAR, WINDOW_SECONDS } from '../../core/engine/periods';
import { CountryValue, MetricFile, MetricSnapshot } from '../../core/engine/types';
import { LocaleService } from '../../core/i18n/locale.service';
import { AppStore } from '../../core/state/app-store';
import { I18nTextPipe, PercentPipe, QuantityPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { ConfidenceBadge } from '../../shared/ui/confidence-badge';
import { SparkPoint, Sparkline } from '../../shared/ui/sparkline';
import { WorldView } from '../world/world-view.service';

interface Row {
  file: MetricFile;
  value: CountryValue;
  amount: number;
}

@Component({
  selector: 'app-country-panel',
  imports: [TranslocoPipe, Icon, ConfidenceBadge, Sparkline, QuantityPipe, PercentPipe, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './country-panel.html',
  styleUrl: './country-panel.scss',
})
export class CountryPanel {
  readonly iso3 = input.required<string>();
  readonly closed = output<void>();
  readonly pick = output<string>();

  private readonly catalog = inject(CatalogService);
  private readonly engine = inject(EngineClient);
  protected readonly world = inject(WorldView);
  protected readonly store = inject(AppStore);
  protected readonly lang = inject(LocaleService).lang;

  protected readonly country = computed(() => this.catalog.countryByIso().get(this.iso3()) ?? null);
  protected readonly view = computed(() => this.world.primary());
  protected readonly file = computed(() => this.view()?.entry.file ?? null);

  /** Amount shown for flows: per window in window mode, otherwise per year. */
  private amountFor(rate: number): number {
    return rate * (this.store.mode() === 'window' ? WINDOW_SECONDS[this.store.window()] : SECONDS_PER_YEAR);
  }
  protected readonly periodKey = computed(() => (this.store.mode() === 'window' ? 'window' : 'year'));

  protected readonly primaryValue = computed(() => {
    const v = this.view();
    if (!v) return null;
    const raw = v.snapshot.countries.find((c) => c.iso3 === this.iso3()) ?? null;
    if (!raw) return null;
    const flow = v.entry.file.kind === 'flow';
    const sorted = [...v.snapshot.countries].sort((a, b) => b.value - a.value);
    const rank = sorted.findIndex((c) => c.iso3 === this.iso3()) + 1;
    const pop = v.population?.countries.find((c) => c.iso3 === this.iso3())?.value ?? null;
    const src = raw.sourceId ? v.entry.file.sources[raw.sourceId] : null;
    return {
      raw,
      amount: flow ? this.amountFor(raw.value) : raw.value,
      perPerson: pop && v.entry.file.id !== 'population' ? (flow ? raw.value * SECONDS_PER_YEAR : raw.value) / pop : null,
      share: v.snapshot.world.value > 0 ? (raw.value / v.snapshot.world.value) * 100 : null,
      rank,
      total: sorted.length,
      population: pop,
      source: src,
    };
  });

  /** Population of the country in the current year (from the population proxy). */
  protected readonly population = computed(() => this.view()?.population?.countries.find((c) => c.iso3 === this.iso3())?.value ?? null);

  /** Width of the share-of-world bar: never thinner than a visible sliver. */
  protected shareBar(pct: number): number {
    return Math.max(1.5, Math.min(100, pct));
  }

  protected readonly query = signal('');

  // ---- sparkline over the metric's year range
  private readonly history = signal<SparkPoint[]>([]);
  protected readonly spark = computed(() => this.history());

  protected readonly rows = computed<{ category: string; rows: Row[] }[]>(() => {
    const mode = this.store.mode();
    const snaps: Map<string, MetricSnapshot> = mode === 'history' ? this.world.yearAll() : this.world.latestAll();
    const iso = this.iso3();
    const lang = this.lang();
    const q = this.query().trim().toLowerCase();
    const groups = new Map<string, Row[]>();
    for (const e of this.catalog.entries()) {
      if (q && !e.file.name[lang].toLowerCase().includes(q)) continue;
      const s = snaps.get(e.file.id);
      const value = s?.countries.find((c) => c.iso3 === iso);
      if (!value) continue;
      const cat = e.origin === 'user' ? 'user' : e.file.category;
      const amount = e.file.kind === 'flow' ? this.amountFor(value.value) : value.value;
      groups.set(cat, [...(groups.get(cat) ?? []), { file: e.file, value, amount }]);
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({ category, rows: groups.get(category)! }));
  });

  constructor() {
    let token = 0;
    effect(() => {
      const v = this.view();
      const iso = this.iso3();
      this.engine.catalogVersion();
      if (!v) return;
      const my = ++token;
      const { min, max } = v.entry.range;
      const step = Math.max(1, Math.ceil((max - min) / 30));
      const years: number[] = [];
      for (let y = min; y <= max; y += step) years.push(y);
      if (years[years.length - 1] !== max) years.push(max);
      const id = v.entry.file.id;
      void Promise.all(years.map((y) => this.engine.snapshots(y, [id]))).then((all) => {
        if (my !== token) return;
        const pts: SparkPoint[] = [];
        all.forEach((list, k) => {
          const c = list[0]?.countries.find((q) => q.iso3 === iso);
          if (c) pts.push({ x: years[k], y: c.value, estimated: c.provenance !== 'reported' });
        });
        this.history.set(pts);
      });
    });
  }
}
