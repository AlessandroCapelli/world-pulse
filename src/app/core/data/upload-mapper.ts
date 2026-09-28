// Pure logic behind the upload wizard: country matching, value parsing, validation report,
// and conversion to a World Pulse MetricFile. Framework-free.
import { Confidence, MetricFile, MetricKind, Period, SeriesPoint, UnitId } from '../engine/types';
import type { CountryRecord } from './schema';

export const WORLD_ALIASES = ['world', 'wld', 'owid wrl', 'owid_wrl', 'mondo', 'global', 'globale', 'total', 'totale', 'earth'];

export interface MappingConfig {
  countryCol: string;
  valueCol: string;
  yearMode: 'column' | 'fixed';
  yearCol: string | null;
  fixedYear: number;
  kind: MetricKind;
  period: Period;
  unit: UnitId;
  name: string;
  unitLabel: string;
  proxy: string | null;
  confidence: Confidence;
  sourceTitle: string;
  sourceUrl: string;
  fileName: string;
}

export interface CountryIndex {
  byAlias: Map<string, string>;
  names: { iso3: string; norm: string }[];
}

export interface Unmatched {
  raw: string;
  rows: number;
  suggestion: string | null;
}

export interface UploadReport {
  rows: number;
  matched: number;
  worldRows: number;
  unmatched: Unmatched[];
  duplicates: number;
  invalid: number;
  outliers: { iso3: string; year: number; value: number }[];
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildCountryIndex(countries: readonly CountryRecord[]): CountryIndex {
  const byAlias = new Map<string, string>();
  const names: { iso3: string; norm: string }[] = [];
  for (const c of countries) {
    for (const a of c.aliases) {
      const n = normalizeName(a);
      if (!byAlias.has(n)) byAlias.set(n, c.iso3);
      names.push({ iso3: c.iso3, norm: n });
    }
  }
  return { byAlias, names };
}

export function isWorldName(raw: string): boolean {
  return WORLD_ALIASES.includes(normalizeName(raw));
}

export function matchCountry(raw: string, idx: CountryIndex): string | null {
  const n = normalizeName(raw);
  if (!n) return null;
  return idx.byAlias.get(n) ?? null;
}

/** Closest country by edit distance (for "did you mean"). */
export function suggestCountry(raw: string, idx: CountryIndex): string | null {
  const n = normalizeName(raw);
  if (n.length < 3) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const { iso3, norm } of idx.names) {
    if (Math.abs(norm.length - n.length) > 4) continue;
    const d = levenshtein(n, norm);
    if (d < bestD) {
      bestD = d;
      best = iso3;
    }
  }
  return bestD <= Math.max(2, Math.floor(n.length * 0.3)) ? best : null;
}

function levenshtein(a: string, b: string): number {
  const prev = new Array(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Spaces (including no-break ones), underscores and apostrophes used as thousands separators. */
const SEPARATORS = new RegExp(`[ _'${String.fromCharCode(9, 0xa0, 0x202f)}]`, 'g');

/** Parses "1,234.5", "1.234,5", "1 234", "12%" → number (null if not numeric). */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(SEPARATORS, '').replace(/%$/, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function slugify(s: string): string {
  return (
    normalizeName(s)
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'dataset'
  );
}

export interface BuildResult {
  file: MetricFile | null;
  report: UploadReport;
}

/**
 * Converts parsed rows into a MetricFile. `overrides` maps an unmatched raw country name
 * to an ISO3 code chosen by the user, or to 'ignore'.
 */
export function buildUserMetric(
  rows: readonly Record<string, unknown>[],
  cfg: MappingConfig,
  idx: CountryIndex,
  overrides: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date(),
): BuildResult {
  const points = new Map<string, SeriesPoint>();
  const unmatched = new Map<string, number>();
  let matched = 0;
  let worldRows = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const row of rows) {
    const rawCountry = String(row[cfg.countryCol] ?? '').trim();
    if (!rawCountry) {
      invalid++;
      continue;
    }
    const year = cfg.yearMode === 'fixed' ? cfg.fixedYear : Math.round(parseNumber(row[cfg.yearCol ?? '']) ?? NaN);
    const value = parseNumber(row[cfg.valueCol]);
    if (!Number.isInteger(year) || year < 1800 || year > 2100 || value === null || value < 0) {
      invalid++;
      continue;
    }
    let scope: string | null;
    if (isWorldName(rawCountry)) {
      scope = 'world';
      worldRows++;
    } else {
      const override = overrides.get(rawCountry);
      if (override === 'ignore') continue;
      scope = override ?? matchCountry(rawCountry, idx);
      if (!scope) {
        unmatched.set(rawCountry, (unmatched.get(rawCountry) ?? 0) + 1);
        continue;
      }
      matched++;
    }
    const key = `${scope}:${year}`;
    if (points.has(key)) duplicates++;
    points.set(key, {
      scope,
      year,
      value,
      ...(cfg.kind === 'flow' ? { period: cfg.period } : {}),
      sourceId: 'user',
      confidence: cfg.confidence,
    });
  }

  const series = [...points.values()];
  const report: UploadReport = {
    rows: rows.length,
    matched,
    worldRows,
    unmatched: [...unmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([raw, n]) => ({ raw, rows: n, suggestion: suggestCountry(raw, idx) })),
    duplicates,
    invalid,
    outliers: findOutliers(series),
  };
  if (series.length === 0) return { file: null, report };

  const name = cfg.name.trim() || cfg.fileName.replace(/\.[^.]+$/, '');
  const label = cfg.unitLabel.trim() || name;
  const date = now.toISOString().slice(0, 10);
  const file: MetricFile = {
    schemaVersion: 1,
    id: `user-${slugify(name)}-${now.getTime().toString(36)}`,
    category: 'user',
    name: { en: name, it: name },
    description: {
      en: `Your dataset “${name}” (${cfg.fileName}), added on ${date}. Stored only in this browser.`,
      it: `Il tuo dataset «${name}» (${cfg.fileName}), aggiunto il ${date}. Salvato solo in questo browser.`,
    },
    unit: cfg.unit,
    unitLabel: { en: label, it: label },
    kind: cfg.kind,
    ...(cfg.proxy ? { allocation: { proxy: cfg.proxy } } : {}),
    visual: { color: '#ff9ee8', icon: 'database', scale: 'sqrt' },
    series,
    sources: {
      user: {
        title: cfg.sourceTitle.trim() || cfg.fileName,
        publisher: cfg.sourceTitle.trim() ? cfg.sourceTitle.trim() : 'User upload',
        url: safeUrl(cfg.sourceUrl) ?? `file:///${encodeURIComponent(cfg.fileName)}`,
        accessed: date,
      },
    },
  };
  return { file, report };
}

function safeUrl(u: string): string | null {
  try {
    const url = new URL(u.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Flags values whose log10 deviates from the per-year median by > 3.5 robust z-scores. */
export function findOutliers(series: readonly SeriesPoint[]): { iso3: string; year: number; value: number }[] {
  const byYear = new Map<number, SeriesPoint[]>();
  for (const p of series) if (p.scope !== 'world' && p.value > 0) byYear.set(p.year, [...(byYear.get(p.year) ?? []), p]);
  const out: { iso3: string; year: number; value: number }[] = [];
  for (const [year, pts] of byYear) {
    if (pts.length < 8) continue;
    const logs = pts.map((p) => Math.log10(p.value));
    const med = median(logs);
    const mad = median(logs.map((l) => Math.abs(l - med))) || 1e-9;
    pts.forEach((p, i) => {
      if (Math.abs(logs[i] - med) / (1.4826 * mad) > 3.5) out.push({ iso3: p.scope, year, value: p.value });
    });
  }
  return out.slice(0, 12);
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Guesses the country / value / year columns from header names and content. */
export function guessColumns(columns: readonly string[], rows: readonly Record<string, unknown>[], idx: CountryIndex) {
  const sample = rows.slice(0, 50);
  const score = (col: string, test: (v: unknown) => boolean) => sample.filter((r) => test(r[col])).length;
  const countryCol =
    columns.find((c) => /^(country|entity|nation|paese|nazione|iso3?|code|location|area)$/i.test(c.trim())) ??
    [...columns].sort((a, b) => score(b, (v) => !!matchCountry(String(v ?? ''), idx)) - score(a, (v) => !!matchCountry(String(v ?? ''), idx)))[0] ??
    null;
  const yearCol =
    columns.find((c) => /^(year|anno|yr|date|time)$/i.test(c.trim())) ??
    columns.find((c) => c !== countryCol && score(c, (v) => /^(1[89]|20)\d\d$/.test(String(v ?? '').trim())) > sample.length * 0.8) ??
    null;
  const valueCol =
    columns.find((c) => c !== countryCol && c !== yearCol && /value|valore|amount|total|count/i.test(c)) ??
    columns.filter((c) => c !== countryCol && c !== yearCol).sort((a, b) => score(b, (v) => parseNumber(v) !== null) - score(a, (v) => parseNumber(v) !== null))[0] ??
    null;
  return { countryCol, yearCol, valueCol };
}
