import { computed, inject, Injectable, PendingTasks, signal } from '@angular/core';
import { invalidate, latestYear, ResolveContext, yearRange } from '../engine/resolve';
import { CategoryId, Manifest, MetricFile, YearRange } from '../engine/types';
import { CATALOG_SOURCE } from './catalog-source';
import { CountriesFile, CountryRecord } from './schema';

export type MetricOrigin = 'bundled' | 'proxy' | 'user';

export interface MetricEntry {
  file: MetricFile;
  origin: MetricOrigin;
  range: YearRange;
  latest: number;
}

export const CATEGORY_ORDER: CategoryId[] = [
  'demography-health',
  'consumer',
  'environment-energy',
  'digital',
  'economy',
  'geography',
  'user',
];

/** Loads and indexes the bundled catalog (manifest, proxies, metrics, country registry) plus user datasets. */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly source = inject(CATALOG_SOURCE);
  private readonly pendingTasks = inject(PendingTasks);
  private loading: Promise<void> | null = null;

  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly error = signal<string | null>(null);
  readonly manifest = signal<Manifest | null>(null);
  readonly countries = signal<CountryRecord[]>([]);
  private readonly bundled = signal<MetricEntry[]>([]);
  readonly userMetrics = signal<MetricFile[]>([]);

  readonly entries = computed<MetricEntry[]>(() => [...this.bundled(), ...this.userMetrics().map((f) => entry(f, 'user'))]);
  readonly byId = computed(() => new Map(this.entries().map((e) => [e.file.id, e])));
  readonly proxies = computed(
    () => new Map(this.bundled().filter((e) => e.origin === 'proxy').map((e) => [e.file.id, e.file])),
  );
  readonly countryByIso = computed(() => new Map(this.countries().map((c) => [c.iso3, c])));
  readonly countryByIndex = computed(() => {
    const arr: (CountryRecord | undefined)[] = [];
    for (const c of this.countries()) arr[c.i] = c;
    return arr;
  });
  readonly defaultMetricId = computed(() => this.manifest()?.defaultMetric ?? 'births');

  readonly resolveContext = computed<ResolveContext>(() => ({
    proxies: this.proxies(),
    countryCodes: this.countries().map((c) => c.iso3),
    noAllocation: new Set(this.countries().filter((c) => c.disputed).map((c) => c.iso3)),
    coverageProxy: 'population',
  }));

  load(): Promise<void> {
    if (this.loading) return this.loading;
    const done = this.pendingTasks.add();
    this.status.set('loading');
    this.loading = this.fetchAll()
      .then(() => this.status.set('ready'))
      .catch((e: unknown) => {
        this.error.set(e instanceof Error ? e.message : String(e));
        this.status.set('error');
      })
      .finally(done);
    return this.loading;
  }

  private async fetchAll(): Promise<void> {
    const manifest = await this.source.readJson<Manifest>('manifest.json');
    const [countries, proxies, metrics] = await Promise.all([
      this.source.readJson<CountriesFile>('geo/countries.json'),
      Promise.all(manifest.proxies.map((id) => this.source.readJson<MetricFile>(`proxies/${id}.json`))),
      Promise.all(manifest.metrics.map((id) => this.source.readJson<MetricFile>(`metrics/${id}.json`))),
    ]);
    this.manifest.set(manifest);
    this.countries.set(countries.countries as CountryRecord[]);
    this.bundled.set([...metrics.map((f) => entry(f, 'bundled')), ...proxies.map((f) => entry(f, 'proxy'))]);
  }

  setUserMetrics(files: MetricFile[]): void {
    for (const f of this.userMetrics()) invalidate(f);
    this.userMetrics.set(files);
  }

  countryName(iso3: string, lang: 'en' | 'it'): string {
    return this.countryByIso().get(iso3)?.name[lang] ?? iso3;
  }
}

function entry(file: MetricFile, origin: MetricOrigin): MetricEntry {
  return { file, origin, range: yearRange(file) ?? { min: 0, max: 0 }, latest: latestYear(file) ?? 0 };
}
