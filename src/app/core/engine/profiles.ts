import { NamedProfile, TemporalProfile } from './types';

/**
 * Stylized 24-hour activity curves (local time, hour 0 = midnight–1am).
 * They are modelling assumptions, not measurements; each is normalized to a mean of 1
 * so the daily integral of a rate is unchanged.
 */
const RAW: Record<NamedProfile, readonly number[]> = {
  uniform: Array.from({ length: 24 }, () => 1),
  // Office/online activity: low at night, plateau during working hours, evening tail.
  localDaytime: [
    0.3, 0.2, 0.15, 0.15, 0.2, 0.35, 0.65, 1.05, 1.45, 1.6, 1.65, 1.65, 1.55, 1.6, 1.65, 1.6, 1.5, 1.35,
    1.2, 1.1, 1.0, 0.85, 0.65, 0.45,
  ],
  // Waking-hours consumption (meals, drinks, commuting): morning, lunch and evening peaks.
  waking: [
    0.25, 0.15, 0.1, 0.1, 0.15, 0.35, 0.85, 1.45, 1.55, 1.3, 1.2, 1.45, 1.7, 1.5, 1.2, 1.15, 1.25, 1.4,
    1.6, 1.55, 1.3, 1.0, 0.7, 0.45,
  ],
};

export function normalizeHourly(hourly: readonly number[]): number[] {
  if (hourly.length !== 24) throw new Error(`Hourly profile must have 24 values, got ${hourly.length}`);
  if (hourly.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Hourly profile values must be finite and ≥ 0');
  const mean = hourly.reduce((s, v) => s + v, 0) / 24;
  if (mean <= 0) throw new Error('Hourly profile must not be all zeros');
  return hourly.map((v) => v / mean);
}

const NORMALIZED = new Map<NamedProfile, number[]>(
  (Object.keys(RAW) as NamedProfile[]).map((k) => [k, normalizeHourly(RAW[k])]),
);

export function resolveProfile(profile: TemporalProfile | undefined): number[] {
  if (!profile) return NORMALIZED.get('uniform')!;
  if (typeof profile === 'string') return NORMALIZED.get(profile)!;
  return normalizeHourly(profile.hourly);
}

export function isUniform(hourly: readonly number[]): boolean {
  return hourly.every((v) => Math.abs(v - 1) < 1e-12);
}
