import { effect, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { GeoAssets } from '../../globe/geo/rasterize';
import { MetricSnapshot } from '../engine/types';
import { CatalogService } from './catalog.service';
import type { WorkerCall, WorkerResponse } from './worker-protocol';
import { EngineState, GeoRequest, loadGeo, parseUpload, ParsedTable } from './worker-tasks';

/**
 * Runs parsing and aggregation off the main thread (Web Worker), with an inline fallback
 * for environments without workers (prerender, old browsers).
 */
@Injectable({ providedIn: 'root' })
export class EngineClient {
  private readonly catalog = inject(CatalogService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private worker: Worker | null = null;
  private inline: EngineState | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private catalogSent: Promise<unknown> | null = null;
  private readonly cache = new Map<string, Promise<MetricSnapshot[]>>();

  /** Increments whenever the catalog sent to the engine changes (invalidates snapshot caches). */
  readonly catalogVersion = signal(0);

  constructor() {
    if (this.isBrowser && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./engine.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
          const p = this.pending.get(data.id);
          if (!p) return;
          this.pending.delete(data.id);
          if (data.ok) p.resolve(data.result);
          else p.reject(new Error(data.error));
        };
      } catch {
        this.worker = null;
      }
    }
    effect(() => {
      if (this.catalog.status() !== 'ready') return;
      const entries = this.catalog.entries();
      const countries = this.catalog.countries();
      const payload = {
        metrics: entries.filter((e) => e.origin !== 'proxy').map((e) => e.file),
        proxies: entries.filter((e) => e.origin === 'proxy').map((e) => e.file),
        countryCodes: countries.map((c) => c.iso3),
        noAllocation: countries.filter((c) => c.disputed).map((c) => c.iso3),
      };
      this.cache.clear();
      this.catalogSent = this.call({ type: 'catalog', payload });
      this.catalogVersion.update((v) => v + 1);
    });
  }

  async snapshots(year: number | 'latest', ids?: string[]): Promise<MetricSnapshot[]> {
    if (!this.catalogSent) throw new Error('catalog not ready');
    const key = `${year}|${ids?.join(',') ?? '*'}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.catalogSent.then(() => this.call({ type: 'snapshots', year, ids }) as Promise<MetricSnapshot[]>);
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  geo(request: GeoRequest): Promise<GeoAssets> {
    return this.call({ type: 'geo', request }) as Promise<GeoAssets>;
  }

  parse(name: string, text: string): Promise<ParsedTable> {
    return this.call({ type: 'parse', name, text }) as Promise<ParsedTable>;
  }

  private call(msg: WorkerCall): Promise<unknown> {
    if (this.worker) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker!.postMessage({ ...msg, id });
      });
    }
    return this.runInline(msg);
  }

  private async runInline(msg: WorkerCall): Promise<unknown> {
    this.inline ??= new EngineState();
    switch (msg.type) {
      case 'catalog':
        this.inline.setCatalog(msg.payload);
        return null;
      case 'snapshots':
        return this.inline.snapshots(msg.year, msg.ids);
      case 'geo':
        return loadGeo(msg.request);
      case 'parse':
        return parseUpload(msg.name, msg.text);
    }
  }
}
