import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CATEGORY_ORDER, CatalogService, MetricEntry } from '../../core/data/catalog.service';
import { CategoryId } from '../../core/engine/types';
import { LocaleService } from '../../core/i18n/locale.service';
import { I18nTextPipe } from '../../shared/format/format.pipes';
import { Icon } from '../../shared/icons/icon';

export interface PickerValue {
  text: string;
  unit: string;
  confidence: 'official' | 'estimate' | 'modelled';
  /** Source · data year · confidence (tooltip). */
  trace: string;
}

interface Group {
  category: CategoryId;
  items: MetricEntry[];
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

@Component({
  selector: 'app-metric-picker',
  imports: [TranslocoPipe, Icon, I18nTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './metric-picker.html',
  styleUrl: './metric-picker.scss',
})
export class MetricPicker {
  readonly selectedId = input<string | null>(null);
  readonly compareId = input<string | null>(null);
  /** Values shown next to each metric (dashboard), keyed by metric id. */
  readonly values = input<Map<string, PickerValue>>(new Map());
  readonly heading = input<string | null>(null);
  readonly mode = input<'select' | 'compare'>('select');
  readonly pick = output<string>();
  readonly closed = output<void>();

  private readonly catalog = inject(CatalogService);
  protected readonly locale = inject(LocaleService);
  protected readonly lang = this.locale.lang;
  protected readonly query = signal('');

  protected readonly groups = computed<Group[]>(() => {
    const q = normalize(this.query().trim());
    const lang = this.lang();
    const compare = this.mode() === 'compare';
    const entries = this.catalog
      .entries()
      .filter((e) => !compare || (e.file.id !== this.selectedId()))
      .filter((e) => {
        if (!q) return true;
        const f = e.file;
        return normalize(`${f.name.en} ${f.name.it} ${f.description[lang]} ${f.id}`).includes(q);
      });
    const byCat = new Map<CategoryId, MetricEntry[]>();
    for (const e of entries) {
      const cat = e.origin === 'user' ? 'user' : e.file.category;
      byCat.set(cat, [...(byCat.get(cat) ?? []), e]);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((category) => ({
      category,
      items: byCat.get(category)!.sort((a, b) => a.file.name[lang].localeCompare(b.file.name[lang], lang)),
    }));
  });

  protected readonly total = computed(() => this.groups().reduce((s, g) => s + g.items.length, 0));

  protected onSearch(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }
}
