import { toPerSecond } from './periods';
import { allPoints } from './series';
import {
  Confidence,
  CountryValue,
  MetricFile,
  MetricSnapshot,
  ResolvedValue,
  SeriesPoint,
  WorldValue,
  YearRange,
} from './types';

export const DEFAULT_MAX_YEAR_GAP = 5;
const WORLD = 'world';

const CONFIDENCE_RANK: Record<Confidence, number> = { official: 0, estimate: 1, modelled: 2 };

/** Returns the weaker of two confidence levels. */
export function weakest(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

interface NormalizedPoint {
  year: number;
  value: number;
  confidence: Confidence;
  sourceId: string;
  note?: string;
}

/** Series grouped by scope, normalized (per second for flows) and sorted by year. */
export type IndexedSeries = Map<string, NormalizedPoint[]>;

export function indexSeries(metric: MetricFile): IndexedSeries {
  const map: IndexedSeries = new Map();
  for (const p of allPoints(metric)) {
    const value = normalizePoint(metric, p);
    const list = map.get(p.scope) ?? [];
    list.push({ year: p.year, value, confidence: p.confidence, sourceId: p.sourceId, note: p.note });
    map.set(p.scope, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.year - b.year);
  return map;
}

function normalizePoint(metric: MetricFile, p: SeriesPoint): number {
  if (metric.kind === 'stock') return p.value;
  if (!p.period) throw new Error(`Metric ${metric.id}: flow point ${p.scope}/${p.year} has no period`);
  return toPerSecond(p.value, p.period);
}

/**
 * Resolves a single sorted series at `year`:
 * exact year → linear interpolation between neighbours → nearest endpoint carried within `maxGap`
 * (optionally scaled by `growth(year) / growth(endpointYear)`). Returns null beyond the gap.
 */
export function valueAt(
  points: readonly NormalizedPoint[] | undefined,
  year: number,
  maxGap: number,
  growth?: (y: number) => number | null,
): ResolvedValue | null {
  if (!points || points.length === 0) return null;

  const exact = points.find((p) => p.year === year);
  if (exact) {
    return {
      value: exact.value,
      dataYear: exact.year,
      provenance: 'reported',
      confidence: exact.confidence,
      sourceId: exact.sourceId,
      note: exact.note,
    };
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (year > first.year && year < last.year) {
    let lo = first;
    let hi = last;
    for (const p of points) {
      if (p.year < year) lo = p;
      else if (p.year > year) {
        hi = p;
        break;
      }
    }
    const t = (year - lo.year) / (hi.year - lo.year);
    const nearest = t <= 0.5 ? lo : hi;
    return {
      value: lo.value + (hi.value - lo.value) * t,
      dataYear: nearest.year,
      provenance: 'interpolated',
      confidence: weakest(lo.confidence, hi.confidence),
      sourceId: nearest.sourceId,
      note: nearest.note,
    };
  }

  const endpoint = year < first.year ? first : last;
  if (Math.abs(year - endpoint.year) > maxGap) return null;

  let value = endpoint.value;
  const target = growth?.(year);
  const base = growth?.(endpoint.year);
  if (target != null && base != null && base > 0) value *= target / base;

  return {
    value,
    dataYear: endpoint.year,
    provenance: 'carried',
    confidence: weakest(endpoint.confidence, 'estimate'),
    sourceId: endpoint.sourceId,
    note: endpoint.note,
  };
}

export function yearRange(metric: MetricFile): YearRange | null {
  const pts = allPoints(metric);
  if (pts.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    min = Math.min(min, p.year);
    max = Math.max(max, p.year);
  }
  return { min, max };
}

/** Latest year for which the metric has a world value or any country value. */
export function latestYear(metric: MetricFile): number | null {
  return yearRange(metric)?.max ?? null;
}

export interface ResolveContext {
  /** Proxy metrics by id (population, gdp, internet-users, land-area…). */
  proxies: ReadonlyMap<string, MetricFile>;
  /** Country codes that exist on the map (the allocation universe). */
  countryCodes: readonly string[];
  /** Codes that never receive allocated values (disputed areas without data). */
  noAllocation?: ReadonlySet<string>;
  /** Proxy used to compute coverage when there is no world series. */
  coverageProxy?: string;
}

const snapshotCache = new WeakMap<MetricFile, Map<number, MetricSnapshot>>();
const indexCache = new WeakMap<MetricFile, IndexedSeries>();

function indexed(metric: MetricFile): IndexedSeries {
  let idx = indexCache.get(metric);
  if (!idx) {
    idx = indexSeries(metric);
    indexCache.set(metric, idx);
  }
  return idx;
}

/** Resolves a metric at a target year into per-country values + world total with provenance. */
export function resolveMetric(metric: MetricFile, year: number, ctx: ResolveContext): MetricSnapshot {
  let perYear = snapshotCache.get(metric);
  const cached = perYear?.get(year);
  if (cached) return cached;

  const snapshot = computeSnapshot(metric, year, ctx);
  if (!perYear) {
    perYear = new Map();
    snapshotCache.set(metric, perYear);
  }
  perYear.set(year, snapshot);
  return snapshot;
}

function computeSnapshot(metric: MetricFile, year: number, ctx: ResolveContext): MetricSnapshot {
  const series = indexed(metric);
  const maxGap = metric.resolution?.maxYearGap ?? DEFAULT_MAX_YEAR_GAP;
  const warnings: string[] = [];
  const worldPoints = series.get(WORLD);
  const worldResolved = valueAt(worldPoints, year, maxGap);

  // Growth reference for carried country values: the world series, interpolated only (no carry).
  const growth = worldPoints
    ? (y: number) => {
        const w = valueAt(worldPoints, y, 0);
        return w ? w.value : null;
      }
    : undefined;

  const countries: CountryValue[] = [];
  let knownSum = 0;
  for (const [scope, points] of series) {
    if (scope === WORLD) continue;
    const r = valueAt(points, year, maxGap, growth);
    if (!r) continue;
    countries.push({ iso3: scope, ...r });
    knownSum += r.value;
  }

  let world: WorldValue;
  let unallocated = 0;
  let coveragePct: number;
  let coverageBasis: 'world' | 'proxy' = 'world';

  if (worldResolved) {
    world = {
      value: worldResolved.value,
      provenance: worldResolved.provenance,
      dataYear: worldResolved.dataYear,
      confidence: worldResolved.confidence,
      sourceId: worldResolved.sourceId,
    };
    const tolerance = Math.abs(world.value) * 1e-9;
    let residual = world.value - knownSum;

    if (residual < -tolerance) {
      if (knownSum > world.value * 1.03) warnings.push(
        `Country values exceed the world total at ${year} by ${(((knownSum - world.value) / world.value) * 100).toFixed(1)}%; world set to the country sum.`,
      );
      // ≤1% differences come from rounding of published values: keep the world provenance.
      world = knownSum > world.value * 1.01
        ? {
            value: knownSum,
            provenance: 'sum',
            dataYear: Math.max(...countries.map((c) => c.dataYear)),
            confidence: countries.reduce<Confidence>((acc, c) => weakest(acc, c.confidence), 'official'),
            sourceId: null,
          }
        : { ...world, value: knownSum };
      residual = 0;
    }

    if (residual > tolerance) {
      const allocated = metric.allocation ? allocate(metric, year, residual, countries, ctx, warnings) : [];
      if (allocated.length > 0) countries.push(...allocated);
      else unallocated = residual;
    }
    coveragePct = world.value > 0 ? clampPct((knownSum / world.value) * 100) : 0;
  } else {
    world = {
      value: knownSum,
      provenance: 'sum',
      dataYear: countries.length ? Math.max(...countries.map((c) => c.dataYear)) : null,
      confidence: countries.reduce<Confidence>((acc, c) => weakest(acc, c.confidence), 'official'),
      sourceId: null,
    };
    coverageBasis = 'proxy';
    coveragePct = proxyCoverage(countries, year, ctx);
  }

  return {
    metricId: metric.id,
    year,
    kind: metric.kind,
    unit: metric.unit,
    world,
    countries,
    unallocated,
    coveragePct,
    coverageBasis,
    warnings,
  };
}

function allocate(
  metric: MetricFile,
  year: number,
  residual: number,
  known: readonly CountryValue[],
  ctx: ResolveContext,
  warnings: string[],
): CountryValue[] {
  const proxyId = metric.allocation!.proxy;
  const proxy = ctx.proxies.get(proxyId);
  if (!proxy) {
    warnings.push(`Allocation proxy "${proxyId}" not found; residual left unallocated.`);
    return [];
  }
  const knownSet = new Set(known.map((c) => c.iso3));
  const exclude = new Set(metric.allocation!.exclude ?? []);
  const proxySnapshot = resolveMetric(proxy, year, { ...ctx, coverageProxy: undefined });
  const candidates = proxySnapshot.countries.filter(
    (c) =>
      !knownSet.has(c.iso3) &&
      !exclude.has(c.iso3) &&
      !ctx.noAllocation?.has(c.iso3) &&
      c.value > 0,
  );
  const total = candidates.reduce((s, c) => s + c.value, 0);
  if (total <= 0) return [];
  const note = `Allocated from the world total by ${proxy.name.en.toLowerCase()} share.`;
  return candidates.map((c) => ({
    iso3: c.iso3,
    value: (residual * c.value) / total,
    dataYear: year,
    provenance: 'allocated' as const,
    confidence: 'modelled' as const,
    sourceId: null,
    note,
  }));
}

function proxyCoverage(countries: readonly CountryValue[], year: number, ctx: ResolveContext): number {
  const proxy = ctx.coverageProxy ? ctx.proxies.get(ctx.coverageProxy) : undefined;
  if (!proxy) return countries.length > 0 ? 100 : 0;
  const snap = resolveMetric(proxy, year, { ...ctx, coverageProxy: undefined });
  const total = snap.countries.reduce((s, c) => s + c.value, 0);
  if (total <= 0) return 0;
  const byIso = new Map(snap.countries.map((c) => [c.iso3, c.value]));
  const covered = countries.reduce((s, c) => s + (byIso.get(c.iso3) ?? 0), 0);
  return clampPct((covered / total) * 100);
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Divides country and world values by the population proxy snapshot. */
export function perCapita(snapshot: MetricSnapshot, population: MetricSnapshot): MetricSnapshot {
  const pop = new Map(population.countries.map((c) => [c.iso3, c.value]));
  const countries = snapshot.countries
    .filter((c) => (pop.get(c.iso3) ?? 0) > 0)
    .map((c) => ({ ...c, value: c.value / pop.get(c.iso3)! }));
  const worldPop = population.world.value;
  return {
    ...snapshot,
    countries,
    world: { ...snapshot.world, value: worldPop > 0 ? snapshot.world.value / worldPop : 0 },
    unallocated: worldPop > 0 ? snapshot.unallocated / worldPop : 0,
  };
}

/** Clears memoized snapshots (used when user datasets change). */
export function invalidate(metric: MetricFile): void {
  snapshotCache.delete(metric);
  indexCache.delete(metric);
}
