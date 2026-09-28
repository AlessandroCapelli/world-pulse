import { MetricFile, SeriesPoint } from './types';

const cache = new WeakMap<MetricFile, SeriesPoint[]>();

/** All points of a metric: individual `series` plus the expanded compact `tables` (memoized). */
export function allPoints(metric: MetricFile): SeriesPoint[] {
  let pts = cache.get(metric);
  if (pts) return pts;
  pts = [...(metric.series ?? [])];
  for (const t of metric.tables ?? []) {
    for (const [scope, values] of Object.entries(t.values)) {
      values.forEach((value, i) => {
        if (value === null || value === undefined) return;
        pts!.push({
          scope,
          year: t.years[i],
          value,
          ...(t.period ? { period: t.period } : {}),
          sourceId: t.sourceId,
          confidence: t.confidence,
          ...(t.note ? { note: t.note } : {}),
        });
      });
    }
  }
  cache.set(metric, pts);
  return pts;
}

export function pointCount(metric: MetricFile): number {
  return allPoints(metric).length;
}
