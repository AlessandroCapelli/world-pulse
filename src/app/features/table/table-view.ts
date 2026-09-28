import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { SECONDS_PER_YEAR } from '../../core/engine/periods';
import { LocaleService } from '../../core/i18n/locale.service';
import { I18nTextPipe, PercentPipe, QuantityPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';
import { MetricView } from '../world/world-view.service';

type SortKey = 'country' | 'value' | 'year' | 'provenance';

/** Accessible table alternative to the globe (also the no-WebGL fallback). */
@Component({
  selector: 'app-table-view',
  imports: [TranslocoPipe, Icon, QuantityPipe, PercentPipe, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './table-view.html',
  styleUrl: './table-view.scss',
})
export class TableView {
  readonly view = input<MetricView | null>(null);
  readonly unsupported = input(false);
  readonly closed = output<void>();
  readonly selectCountry = output<string>();

  private readonly catalog = inject(CatalogService);
  protected readonly lang = inject(LocaleService).lang;
  protected readonly sortKey = signal<SortKey>('value');
  protected readonly desc = signal(true);
  protected readonly query = signal('');
  protected readonly sortKeys: readonly SortKey[] = ['value', 'country', 'year'];

  protected readonly flow = computed(() => this.view()?.entry.file.kind === 'flow');
  protected readonly worldAmount = computed(() => {
    const w = this.view()?.display.world.value ?? 0;
    return this.flow() ? w * SECONDS_PER_YEAR : w;
  });

  protected readonly rows = computed(() => {
    const v = this.view();
    if (!v) return [];
    const lang = this.lang();
    const world = v.display.world.value;
    const flow = this.flow();
    const rows = v.display.countries.map((c) => ({
      iso3: c.iso3,
      name: this.catalog.countryName(c.iso3, lang),
      amount: flow ? c.value * SECONDS_PER_YEAR : c.value,
      share: world > 0 && !this.isPerCapita() ? (c.value / world) * 100 : null,
      year: c.dataYear,
      provenance: c.provenance,
      confidence: c.confidence,
      source: c.sourceId ? v.entry.file.sources[c.sourceId]?.publisher : null,
    }));
    const q = normalize(this.query());
    const key = this.sortKey();
    const dir = this.desc() ? -1 : 1;
    return (q ? rows.filter((r) => normalize(r.name).includes(q) || r.iso3.toLowerCase() === q) : rows).sort((a, b) => {
      const cmp =
        key === 'country'
          ? a.name.localeCompare(b.name, lang)
          : key === 'year'
            ? a.year - b.year
            : key === 'provenance'
              ? a.provenance.localeCompare(b.provenance)
              : a.amount - b.amount;
      return cmp * dir;
    });
  });

  protected isPerCapita(): boolean {
    const v = this.view();
    return !!v && v.display !== v.snapshot;
  }

  protected sort(key: SortKey): void {
    if (this.sortKey() === key) this.desc.set(!this.desc());
    else {
      this.sortKey.set(key);
      this.desc.set(key === 'value' || key === 'year');
    }
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() === key ? (this.desc() ? 'descending' : 'ascending') : 'none';
  }
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
