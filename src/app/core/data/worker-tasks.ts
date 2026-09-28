// Tasks shared by the Web Worker and the inline (no-worker) fallback. Framework-free.
import { latestYear, resolveMetric, ResolveContext } from '../engine/resolve';
import { MetricFile, MetricSnapshot } from '../engine/types';
import type { GeoAssets, RasterInput } from '../../globe/geo/rasterize';

export interface CatalogPayload {
  metrics: MetricFile[];
  proxies: MetricFile[];
  countryCodes: string[];
  noAllocation: string[];
}

export interface GeoRequest extends Omit<RasterInput, 'topology'> {
  url: string;
}

export interface ParsedTable {
  format: 'csv' | 'json-table' | 'metric-file';
  columns: string[];
  rows: Record<string, unknown>[];
  /** Present when the JSON file already is a World Pulse metric file. */
  metric?: unknown;
  truncated: boolean;
}

export const MAX_UPLOAD_ROWS = 50_000;

export class EngineState {
  private byId = new Map<string, MetricFile>();
  private ctx: ResolveContext | null = null;

  setCatalog(p: CatalogPayload): void {
    this.byId = new Map([...p.metrics, ...p.proxies].map((m) => [m.id, m]));
    this.ctx = {
      proxies: new Map(p.proxies.map((m) => [m.id, m])),
      countryCodes: p.countryCodes,
      noAllocation: new Set(p.noAllocation),
      coverageProxy: 'population',
    };
  }

  /** Resolves metrics at a year, or each at its own latest year when `year` is 'latest'. */
  snapshots(year: number | 'latest', ids?: string[]): MetricSnapshot[] {
    if (!this.ctx) throw new Error('catalog not set');
    const out: MetricSnapshot[] = [];
    for (const id of ids ?? [...this.byId.keys()]) {
      const m = this.byId.get(id);
      if (!m) continue;
      const y = year === 'latest' ? latestYear(m) : year;
      if (y == null) continue;
      out.push(resolveMetric(m, y, this.ctx));
    }
    return out;
  }
}

export async function loadGeo(req: GeoRequest): Promise<GeoAssets> {
  const [{ buildGeoAssets }, res] = await Promise.all([import('../../globe/geo/rasterize'), fetch(req.url)]);
  if (!res.ok) throw new Error(`Failed to load ${req.url}: HTTP ${res.status}`);
  const topology = await res.json();
  return buildGeoAssets({ ...req, topology });
}

export function geoTransferables(a: GeoAssets): Transferable[] {
  return [
    a.ids.buffer,
    a.pixelCounts.buffer,
    a.poolPoints.buffer,
    a.poolStart.buffer,
    a.poolCount.buffer,
    a.coastlines.buffer,
    a.borders.buffer,
  ] as Transferable[];
}

export async function parseUpload(name: string, text: string): Promise<ParsedTable> {
  const trimmed = text.trimStart();
  const isJson = /\.json$/i.test(name) || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (isJson) {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data) && 'schemaVersion' in data) {
      return { format: 'metric-file', columns: [], rows: [], metric: data, truncated: false };
    }
    const rows = Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? (Object.values(data).find(Array.isArray) as unknown[] | undefined)
        : undefined;
    if (!rows) throw new Error('JSON must be an array of records or a World Pulse metric file');
    const records = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
    const columns = [...new Set(records.slice(0, 500).flatMap((r) => Object.keys(r)))];
    return {
      format: 'json-table',
      columns,
      rows: records.slice(0, MAX_UPLOAD_ROWS),
      truncated: records.length > MAX_UPLOAD_ROWS,
    };
  }
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  if (!result.meta.fields?.length) throw new Error('No header row found');
  return {
    format: 'csv',
    columns: result.meta.fields.filter(Boolean),
    rows: result.data.slice(0, MAX_UPLOAD_ROWS),
    truncated: result.data.length > MAX_UPLOAD_ROWS,
  };
}
