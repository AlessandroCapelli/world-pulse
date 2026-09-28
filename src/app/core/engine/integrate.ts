import { isUniform } from './profiles';
import { MetricSnapshot } from './types';

/**
 * Exact, drift-free integration of rates modulated by a local-time hourly profile.
 * Totals are always computed from absolute timestamps (never by summing per-frame deltas).
 */

export interface OffsetBucket {
  /** Local time offset from UTC in hours (e.g. 5.5). */
  offsetHours: number;
  /** Sum of per-second base rates of all countries sharing this offset. */
  rate: number;
}

export interface IntegrableRates {
  buckets: OffsetBucket[];
  /** Base rate not tied to a country (unallocated residual): integrated with a flat profile. */
  flatRate: number;
  hourly: readonly number[];
  /** prefix[h] = Σ hourly[0..h-1]; prefix[24] = 24. */
  prefix: number[];
}

export function prefixSums(hourly: readonly number[]): number[] {
  const prefix = [0];
  for (let h = 0; h < 24; h++) prefix.push(prefix[h] + hourly[h]);
  return prefix;
}

/**
 * ∫ p(localHour(t)) dt over [t0, t1] in seconds (Unix seconds), for a piecewise-constant hourly profile.
 * Returns "profile-weighted seconds": multiply by a base per-second rate to get a total.
 */
export function weightedSeconds(
  hourly: readonly number[],
  prefix: readonly number[],
  offsetHours: number,
  t0: number,
  t1: number,
): number {
  if (t1 <= t0) return 0;
  const cumulative = (tSec: number): number => {
    const hours = tSec / 3600 + offsetHours;
    const days = Math.floor(hours / 24);
    const inDay = hours - days * 24;
    const h = Math.min(23, Math.floor(inDay));
    return days * 24 + prefix[h] + hourly[h] * (inDay - h);
  };
  return (cumulative(t1) - cumulative(t0)) * 3600;
}

/** Groups per-country base rates by UTC offset so integration costs O(offsets), not O(countries). */
export function buildIntegrable(
  snapshot: MetricSnapshot,
  offsetOf: (iso3: string) => number,
  hourly: readonly number[],
): IntegrableRates {
  const byOffset = new Map<number, number>();
  for (const c of snapshot.countries) {
    const off = offsetOf(c.iso3);
    byOffset.set(off, (byOffset.get(off) ?? 0) + c.value);
  }
  return {
    buckets: [...byOffset.entries()].map(([offsetHours, rate]) => ({ offsetHours, rate })),
    flatRate: snapshot.unallocated,
    hourly,
    prefix: prefixSums(hourly),
  };
}

/** Total amount produced over [t0, t1] (Unix seconds). */
export function integrate(rates: IntegrableRates, t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  const dt = t1 - t0;
  let total = rates.flatRate * dt;
  if (isUniform(rates.hourly)) {
    for (const b of rates.buckets) total += b.rate * dt;
    return total;
  }
  for (const b of rates.buckets) {
    total += b.rate * weightedSeconds(rates.hourly, rates.prefix, b.offsetHours, t0, t1);
  }
  return total;
}

/** Instantaneous world rate (per second) at Unix time t. */
export function instantRate(rates: IntegrableRates, t: number): number {
  let total = rates.flatRate;
  for (const b of rates.buckets) total += b.rate * profileAt(rates.hourly, b.offsetHours, t);
  return total;
}

export function profileAt(hourly: readonly number[], offsetHours: number, tSec: number): number {
  const hours = tSec / 3600 + offsetHours;
  const inDay = ((hours % 24) + 24) % 24;
  return hourly[Math.min(23, Math.floor(inDay))];
}

/** World base rate (per second) of a snapshot, including the unallocated residual. */
export function baseRate(rates: IntegrableRates): number {
  return rates.flatRate + rates.buckets.reduce((s, b) => s + b.rate, 0);
}
