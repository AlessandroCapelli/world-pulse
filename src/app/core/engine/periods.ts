import { Period } from './types';

/** Mean Gregorian year in seconds (365.2425 days). */
export const SECONDS_PER_YEAR = 365.2425 * 86_400;

export const PERIOD_SECONDS: Record<Period, number> = {
  year: SECONDS_PER_YEAR,
  quarter: SECONDS_PER_YEAR / 4,
  month: SECONDS_PER_YEAR / 12,
  week: 7 * 86_400,
  day: 86_400,
  hour: 3_600,
  minute: 60,
  second: 1,
};

/** Converts a "per period" amount into a per-second rate. */
export function toPerSecond(value: number, period: Period): number {
  return value / PERIOD_SECONDS[period];
}

/** Converts a per-second rate into an amount per period. */
export function fromPerSecond(ratePerSecond: number, period: Period): number {
  return ratePerSecond * PERIOD_SECONDS[period];
}

export const TIME_WINDOWS = ['1s', '1min', '1h', '1d', '1w', '1y'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const WINDOW_SECONDS: Record<TimeWindow, number> = {
  '1s': 1,
  '1min': 60,
  '1h': 3_600,
  '1d': 86_400,
  '1w': 7 * 86_400,
  '1y': SECONDS_PER_YEAR,
};
