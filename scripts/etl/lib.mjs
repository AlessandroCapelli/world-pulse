// Readers and frame helpers for the ETL. A "frame" is Map<scope, Map<year, value>>
// where scope is 'world' or an ISO3 code present in public/data/geo/countries.json.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW = join(ROOT, 'data-raw');
export const DATA = join(ROOT, 'public', 'data');

const registry = JSON.parse(readFileSync(join(DATA, 'geo', 'countries.json'), 'utf8')).countries;
export const CODES = new Set(registry.filter((c) => !c.disputed || c.iso3 === 'XKX').map((c) => c.iso3));

/** Years kept in generated files: 2000, 2005, 2010 and every year from 2015. */
export const keepYear = (y) => y === 2000 || y === 2005 || y === 2010 || y >= 2015;

const report = existsSync(join(RAW, '_report.json')) ? JSON.parse(readFileSync(join(RAW, '_report.json'), 'utf8')) : {};
export function fetchedOn(sourceId) {
  return report[sourceId]?.fetched ?? new Date().toISOString().slice(0, 10);
}

function raw(file) {
  const p = join(RAW, file);
  if (!existsSync(p)) throw new Error(`Missing ${p} — run: npm run data:fetch`);
  return readFileSync(p, 'utf8');
}

function mapCode(code, { world = [] } = {}) {
  if (!code) return null;
  if (world.includes(code)) return 'world';
  if (code === 'OWID_KOS') return 'XKX';
  return CODES.has(code) ? code : null;
}

function put(frame, scope, year, value) {
  if (scope === null || !Number.isFinite(year) || value === null || value === undefined || value === '') return;
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  let m = frame.get(scope);
  if (!m) frame.set(scope, (m = new Map()));
  m.set(year, v);
}

export function worldBank(indicator) {
  const [, rows] = JSON.parse(raw(`wb-${indicator}.json`));
  const f = new Map();
  for (const r of rows ?? []) put(f, mapCode(r.countryiso3code || r.country?.id, { world: ['WLD'] }), Number(r.date), r.value);
  return f;
}

function csv(file) {
  return Papa.parse(raw(file), { header: true, skipEmptyLines: true }).data;
}

/** OWID grapher CSV: entity,code,year,<value columns>. */
export function owidGrapher(slug, column) {
  const rows = csv(`owid-${slug}.csv`);
  const col = column ?? Object.keys(rows[0] ?? {})[3];
  const f = new Map();
  for (const r of rows) put(f, mapCode(r.code, { world: ['OWID_WRL'] }), Number(r.year), r[col]);
  return f;
}

/** OWID GitHub datasets (co2-data, energy-data): country,year,iso_code,... */
export function owidDataset(file, column) {
  const rows = csv(file);
  const f = new Map();
  for (const r of rows) {
    const scope = r.country === 'World' ? 'world' : mapCode(r.iso_code);
    put(f, scope, Number(r.year), r[column]);
  }
  return f;
}

/** WHO Global Health Observatory OData: keeps both-sexes / total rows. */
export function gho(indicator) {
  const { value } = JSON.parse(raw(`gho-${indicator}.json`));
  const f = new Map();
  const rank = (d) => (d == null ? 0 : /BTSX|TOTL/.test(d) ? 1 : 9);
  const best = new Map();
  for (const r of value) {
    const scope = r.SpatialDimType === 'GLOBAL' ? 'world' : r.SpatialDimType === 'COUNTRY' ? mapCode(r.SpatialDim) : null;
    if (!scope || r.NumericValue == null) continue;
    const key = `${scope}:${r.TimeDim}`;
    const rk = Math.max(rank(r.Dim1), rank(r.Dim2));
    if (rk === 9) continue;
    const prev = best.get(key);
    if (prev && prev.rk <= rk) continue;
    best.set(key, { rk, scope, year: Number(r.TimeDim), v: r.NumericValue });
  }
  for (const b of best.values()) put(f, b.scope, b.year, b.v);
  return f;
}

export function usgsCounts() {
  const { counts } = JSON.parse(raw('usgs-m5-counts.json'));
  const f = new Map();
  for (const [y, n] of Object.entries(counts)) put(f, 'world', Number(y), n);
  return f;
}

/** Blockchain.com daily confirmed transactions → average per day for complete years. */
export function blockchainDailyAverage() {
  const { values } = JSON.parse(raw('blockchain-n-transactions.json'));
  const byYear = new Map();
  for (const { x, y } of values) {
    const yr = new Date(x * 1000).getUTCFullYear();
    const b = byYear.get(yr) ?? { sum: 0, n: 0 };
    b.sum += y;
    b.n++;
    byYear.set(yr, b);
  }
  const f = new Map();
  const current = new Date().getUTCFullYear();
  for (const [yr, b] of byYear) if (yr < current && b.n > 300) put(f, 'world', yr, b.sum / b.n);
  return f;
}

// ---------------------------------------------------------------- frame ops

export function mapValues(frame, fn) {
  const out = new Map();
  for (const [scope, years] of frame) {
    for (const [y, v] of years) {
      const nv = fn(v, scope, y);
      if (nv !== null && Number.isFinite(nv)) put(out, scope, y, nv);
    }
  }
  return out;
}

/** Combines two frames value by value (only where both exist). */
export function combine(a, b, fn) {
  const out = new Map();
  for (const [scope, years] of a) {
    const other = b.get(scope);
    if (!other) continue;
    for (const [y, v] of years) if (other.has(y)) put(out, scope, y, fn(v, other.get(y)));
  }
  return out;
}

export function sum(...frames) {
  const out = new Map();
  for (const f of frames) for (const [scope, years] of f) for (const [y, v] of years) put(out, scope, y, (out.get(scope)?.get(y) ?? 0) + v);
  return out;
}

export function onlyWorld(frame) {
  return new Map([...frame].filter(([s]) => s === 'world'));
}

export function withoutWorld(frame) {
  return new Map([...frame].filter(([s]) => s !== 'world'));
}

export function round(v, digits = 4) {
  if (v === 0) return 0;
  const p = digits - Math.ceil(Math.log10(Math.abs(v)));
  const r = p > 0 ? Number(v.toFixed(Math.min(p, 12))) : Math.round(v / 10 ** -p) * 10 ** -p;
  return Object.is(r, -0) ? 0 : r;
}

/** Converts a frame into a compact SeriesTable (only kept years that have data). */
export function toTable(frame, { sourceId, confidence, period, note, minYear = 1995, maxYear = 2100 }) {
  const years = new Set();
  for (const ys of frame.values()) for (const y of ys.keys()) if (y >= minYear && y <= maxYear && keepYear(y)) years.add(y);
  let sorted = [...years].sort((a, b) => a - b);
  sorted = completeYears(frame, sorted);
  const values = {};
  for (const scope of [...frame.keys()].sort((a, b) => (a === 'world' ? -1 : b === 'world' ? 1 : a.localeCompare(b)))) {
    const ys = frame.get(scope);
    const row = sorted.map((y) => (ys.has(y) && ys.get(y) >= 0 ? round(ys.get(y)) : null));
    if (row.some((v) => v !== null)) values[scope] = row;
  }
  if (sorted.length === 0 || Object.keys(values).length === 0) return null;
  return { sourceId, confidence, ...(period ? { period } : {}), ...(note ? { note } : {}), years: sorted, values };
}

export function latestYearOf(frame) {
  let max = -Infinity;
  for (const ys of frame.values()) for (const y of ys.keys()) max = Math.max(max, y);
  return max;
}

/**
 * Drops trailing/partial years: a year is kept only if (a) the world value exists whenever the frame has a
 * world row, (b) the country sum does not exceed the world value by more than 2% (preliminary world totals),
 * and (c) without a world row, trailing years keep at least 85% of the best-covered year's countries
 * (partial latest releases). Historical years with fewer reporting countries are kept. Dropped years are logged.
 */
export function completeYears(frame, years) {
  const world = frame.get('world');
  const countries = [...frame].filter(([s]) => s !== 'world');
  const count = (y) => countries.filter(([, ys]) => ys.has(y)).length;
  const maxCount = Math.max(0, ...years.map(count));
  const bestYear = Math.max(...years.filter((y) => count(y) === maxCount));
  const hasWorld = !!world && world.size > 0;
  return years.filter((y) => {
    const n = count(y);
    let reason = null;
    if (world && world.size > 0 && !world.has(y) && n > 0) reason = 'no world value';
    else if (world?.has(y) && n > 0) {
      const s = countries.reduce((acc, [, ys]) => acc + (ys.get(y) ?? 0), 0);
      if (s > world.get(y) * 1.02) reason = `countries exceed world by ${((s / world.get(y) - 1) * 100).toFixed(1)}%`;
    }
    if (!reason && !hasWorld && y > bestYear && maxCount > 20 && n < maxCount * 0.85) reason = `only ${n}/${maxCount} countries`;
    if (reason) TRIMMED.push(`${y}: ${reason}`);
    return !reason;
  });
}

/** Log of years removed by completeYears (printed by build.mjs). */
export const TRIMMED = [];
