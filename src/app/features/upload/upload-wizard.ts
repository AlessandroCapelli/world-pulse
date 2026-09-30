import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CatalogService } from '../../core/data/catalog.service';
import { EngineClient } from '../../core/data/engine-client.service';
import { describeIssues, metricFileSchema } from '../../core/data/schema';
import {
  buildCountryIndex,
  buildUserMetric,
  guessColumns,
  MappingConfig,
  UploadReport,
} from '../../core/data/upload-mapper';
import { UserDataStore } from '../../core/data/user-data.store';
import { MAX_UPLOAD_ROWS, type ParsedTable } from '../../core/data/worker-tasks';
import { Confidence, MetricFile, Period, UNIT_IDS, UnitId } from '../../core/engine/types';
import { pointCount } from '../../core/engine/series';
import { LocaleService } from '../../core/i18n/locale.service';
import { Icon } from '../../shared/icons/icon';

type Step = 'file' | 'map' | 'check';
const PERIODS: Period[] = ['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second'];
const MAX_BYTES = 8 * 1024 * 1024;

@Component({
  selector: 'app-upload-wizard',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upload-wizard.html',
  styleUrl: './upload-wizard.scss',
})
export class UploadWizard {
  readonly closed = output<void>();
  readonly added = output<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly catalog = inject(CatalogService);
  private readonly engine = inject(EngineClient);
  private readonly transloco = inject(TranslocoService);
  private readToken = 0;
  protected readonly userData = inject(UserDataStore);
  protected readonly lang = inject(LocaleService).lang;

  protected readonly step = signal<Step>('file');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly issues = signal<string[]>([]);
  protected readonly dragOver = signal(false);
  protected readonly table = signal<ParsedTable | null>(null);
  protected readonly directFile = signal<MetricFile | null>(null);
  protected readonly cfg = signal<MappingConfig>({
    countryCol: '',
    valueCol: '',
    yearMode: 'column',
    yearCol: null,
    fixedYear: new Date().getFullYear() - 1,
    kind: 'flow',
    period: 'year',
    unit: 'count',
    name: '',
    unitLabel: '',
    proxy: 'population',
    confidence: 'estimate',
    sourceTitle: '',
    sourceUrl: '',
    fileName: '',
  });
  protected readonly overrides = signal<Map<string, string>>(new Map());

  protected readonly periods = PERIODS;
  protected readonly units = UNIT_IDS;
  protected readonly confidences: Confidence[] = ['official', 'estimate', 'modelled'];
  protected readonly pointCount = pointCount;
  protected readonly mine = computed(() => this.catalog.userMetrics());
  protected readonly proxies = computed(() => [...this.catalog.proxies().values()]);
  private readonly index = computed(() => buildCountryIndex(this.catalog.countries()));
  protected readonly sourceUrlInvalid = computed(() => {
    const value = this.cfg().sourceUrl.trim();
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol !== 'http:' && url.protocol !== 'https:';
    } catch {
      return true;
    }
  });

  protected readonly result = computed<{ file: MetricFile | null; report: UploadReport } | null>(() => {
    const t = this.table();
    if (!t) return null;
    const c = this.cfg();
    if (!c.countryCol || !c.valueCol || (c.yearMode === 'column' && !c.yearCol)) return null;
    return buildUserMetric(t.rows, c, this.index(), this.overrides());
  });

  protected readonly countryName = (iso3: string) => this.catalog.countryName(iso3, this.lang());

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  protected close(): void {
    this.readToken++;
    this.dialog().nativeElement.close();
    this.closed.emit();
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void this.read(f);
  }

  protected onPick(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void this.read(f);
  }

  private async read(file: File): Promise<void> {
    const token = ++this.readToken;
    this.step.set('file');
    this.directFile.set(null);
    this.table.set(null);
    this.overrides.set(new Map());
    this.busy.set(false);
    this.error.set(null);
    this.issues.set([]);
    if (file.size > MAX_BYTES) {
      this.error.set(`${(file.size / 1024 / 1024).toFixed(1)} MB > 8 MB`);
      return;
    }
    this.busy.set(true);
    try {
      const parsed = await this.engine.parse(file.name, await file.text());
      if (token !== this.readToken) return;
      if (parsed.truncated) {
        this.error.set(this.transloco.translate('upload.tooManyRows', { n: MAX_UPLOAD_ROWS }));
        return;
      }
      if (parsed.format === 'metric-file') {
        const res = metricFileSchema.safeParse(parsed.metric);
        if (!res.success) {
          this.issues.set(describeIssues(res.error).slice(0, 12));
          return;
        }
        const f = res.data;
        this.directFile.set({
          ...f,
          id: f.id.startsWith('user-') ? f.id : `user-${f.id}`,
          category: 'user',
          ...(f.allocation && !this.catalog.proxies().has(f.allocation.proxy) ? { allocation: undefined } : {}),
        });
        this.step.set('check');
        return;
      }
      this.table.set(parsed);
      const g = guessColumns(parsed.columns, parsed.rows, this.index());
      this.cfg.update((c) => ({
        ...c,
        countryCol: g.countryCol ?? parsed.columns[0] ?? '',
        valueCol: g.valueCol ?? parsed.columns[1] ?? '',
        yearCol: g.yearCol,
        yearMode: g.yearCol ? 'column' : 'fixed',
        fileName: file.name,
        name: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      }));
      this.step.set('map');
    } catch (e) {
      if (token === this.readToken) this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === this.readToken) this.busy.set(false);
    }
  }

  protected set<K extends keyof MappingConfig>(key: K, value: MappingConfig[K]): void {
    this.cfg.update((c) => ({ ...c, [key]: value }));
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setUnit(e: Event): void {
    this.set('unit', this.val(e) as UnitId);
  }

  protected setOverride(raw: string, iso3: string | null): void {
    this.overrides.update((m) => {
      const next = new Map(m);
      if (iso3) next.set(raw, iso3);
      else next.delete(raw);
      return next;
    });
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    if (!this.directFile() && this.sourceUrlInvalid()) return;
    const file = this.directFile() ?? this.result()?.file;
    if (!file) return;
    const res = metricFileSchema.safeParse(file);
    if (!res.success) {
      this.issues.set(describeIssues(res.error).slice(0, 12));
      return;
    }
    this.busy.set(true);
    try {
      await this.userData.save(file);
      this.added.emit(file.id);
      this.close();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(id: string): Promise<void> {
    await this.userData.remove(id);
  }
}
