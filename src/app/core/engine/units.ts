import { UnitId } from './types';

export type Locale = 'en' | 'it';

interface Step {
  factor: number;
  symbol: string;
}

interface UnitDef {
  /** Multiplier from this unit to the ladder base. */
  toBase: number;
  /** Ascending ladder of display steps in base units; empty = plain compact number. */
  ladder: Step[];
  /** Symbol appended after compact numbers when there is no ladder. */
  suffix?: string;
  currency?: string;
  /** Continuous quantities may be split below 1 (e.g. 0.5 t); counts may not. */
  continuous: boolean;
}

const MASS: Step[] = [
  { factor: 1e-3, symbol: 'g' },
  { factor: 1, symbol: 'kg' },
  { factor: 1e3, symbol: 't' },
  { factor: 1e6, symbol: 'kt' },
  { factor: 1e9, symbol: 'Mt' },
  { factor: 1e12, symbol: 'Gt' },
];
const VOLUME: Step[] = [
  { factor: 1, symbol: 'L' },
  { factor: 1e3, symbol: 'kL' },
  { factor: 1e6, symbol: 'ML' },
  { factor: 1e9, symbol: 'GL' },
  { factor: 1e12, symbol: 'TL' },
  { factor: 1e15, symbol: 'km³' },
];
const ENERGY: Step[] = [
  { factor: 1e-3, symbol: 'Wh' },
  { factor: 1, symbol: 'kWh' },
  { factor: 1e3, symbol: 'MWh' },
  { factor: 1e6, symbol: 'GWh' },
  { factor: 1e9, symbol: 'TWh' },
  { factor: 1e12, symbol: 'PWh' },
];
const DATA: Step[] = [
  { factor: 1, symbol: 'B' },
  { factor: 1e3, symbol: 'kB' },
  { factor: 1e6, symbol: 'MB' },
  { factor: 1e9, symbol: 'GB' },
  { factor: 1e12, symbol: 'TB' },
  { factor: 1e15, symbol: 'PB' },
  { factor: 1e18, symbol: 'EB' },
  { factor: 1e21, symbol: 'ZB' },
];
const AREA_HA: Step[] = [
  { factor: 1e-4, symbol: 'm²' },
  { factor: 1, symbol: 'ha' },
  { factor: 1e6, symbol: 'Mha' },
];

export const UNITS: Record<UnitId, UnitDef> = {
  count: { toBase: 1, ladder: [], continuous: false },
  tonne: { toBase: 1e3, ladder: MASS, continuous: true },
  kg: { toBase: 1, ladder: MASS, continuous: true },
  litre: { toBase: 1, ladder: VOLUME, continuous: true },
  kWh: { toBase: 1, ladder: ENERGY, continuous: true },
  TWh: { toBase: 1e9, ladder: ENERGY, continuous: true },
  byte: { toBase: 1, ladder: DATA, continuous: true },
  usd: { toBase: 1, ladder: [], currency: 'USD', continuous: true },
  hour: { toBase: 1, ladder: [], suffix: 'h', continuous: true },
  barrel: { toBase: 1, ladder: [], suffix: 'bbl', continuous: true },
  hectare: { toBase: 1, ladder: AREA_HA, continuous: true },
  km2: { toBase: 1, ladder: [], suffix: 'km²', continuous: true },
  teu: { toBase: 1, ladder: [], suffix: 'TEU', continuous: false },
  m3: { toBase: 1, ladder: [], suffix: 'm³', continuous: true },
};

export function isContinuous(unit: UnitId): boolean {
  return UNITS[unit].continuous;
}

const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', it: 'it-IT' };
const nfCache = new Map<string, Intl.NumberFormat>();

function nf(locale: Locale, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE_TAG[locale], opts);
    nfCache.set(key, f);
  }
  return f;
}

export interface FormattedQuantity {
  /** Number part, locale-formatted. */
  number: string;
  /** Unit symbol (may be empty for plain counts). */
  unit: string;
  /** number + unit, joined with a narrow no-break space. */
  text: string;
}

function significant(v: number): Intl.NumberFormatOptions {
  const abs = Math.abs(v);
  if (abs === 0) return { maximumFractionDigits: 0 };
  if (abs >= 100) return { maximumFractionDigits: 0 };
  if (abs >= 10) return { maximumFractionDigits: 1 };
  if (abs >= 1) return { maximumFractionDigits: 2 };
  return { maximumSignificantDigits: 2 };
}

/** Narrow no-break space between number and unit. */
const NNBSP = String.fromCharCode(0x202f);

function join(number: string, unit: string): FormattedQuantity {
  return { number, unit, text: unit ? `${number}${NNBSP}${unit}` : number };
}

/**
 * Humanized, locale-aware, compact formatting: "1.2 Mt", "4.1 PB", "3.4M", "$1.2T".
 */
export function formatQuantity(value: number, unit: UnitId, locale: Locale): FormattedQuantity {
  const def = UNITS[unit];
  if (!Number.isFinite(value)) return join('—', '');

  if (def.currency) {
    const s = nf(locale, {
      style: 'currency',
      currency: def.currency,
      notation: Math.abs(value) >= 1e4 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(value) >= 1e4 ? 1 : Math.abs(value) < 1 ? 3 : 0,
    }).format(value);
    return join(s, '');
  }

  if (def.ladder.length === 0) {
    const abs = Math.abs(value);
    const opts: Intl.NumberFormatOptions =
      abs >= 1e4 ? { notation: 'compact', maximumFractionDigits: 1 } : significant(value);
    return join(nf(locale, opts).format(value), def.suffix ?? '');
  }

  const base = value * def.toBase;
  const abs = Math.abs(base);
  let step = def.ladder[0];
  for (const s of def.ladder) if (abs >= s.factor) step = s;
  const scaled = base / step.factor;
  // Very large values beyond the ladder top: fall back to compact on the top unit.
  const opts = Math.abs(scaled) >= 1e4 ? { notation: 'compact' as const, maximumFractionDigits: 1 } : significant(scaled);
  return join(nf(locale, opts).format(scaled), step.symbol);
}

/** Full-precision grouped integer (for odometer counters). */
export function formatInteger(value: number, locale: Locale): string {
  return nf(locale, { maximumFractionDigits: 0 }).format(Math.floor(value));
}

/** Plain number with a fixed number of fraction digits. */
export function formatNumber(value: number, locale: Locale, opts: Intl.NumberFormatOptions = {}): string {
  return nf(locale, opts).format(value);
}

export function formatPercent(value: number, locale: Locale, digits = 0): string {
  return nf(locale, { style: 'percent', maximumFractionDigits: digits }).format(value / 100);
}

/**
 * Chooses a "nice" amount (1/2/5 × 10^k) so that one particle represents that many units
 * and the global spawn rate stays ≤ maxPerSecond.
 */
export function niceUnitsPerParticle(ratePerSecond: number, maxPerSecond: number, continuous: boolean): number {
  if (!(ratePerSecond > 0) || !(maxPerSecond > 0)) return 1;
  const raw = ratePerSecond / maxPerSecond;
  if (!continuous && raw <= 1) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= raw) return m * base;
  }
  return 10 * base;
}
