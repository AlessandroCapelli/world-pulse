import { InjectionToken } from '@angular/core';

/**
 * Reads a JSON file from the bundled `public/data` folder.
 * Browser: relative fetch (resolved against <base href>, so it works under a GitHub Pages sub-path).
 * Prerender: synchronous file-system read (see app.config.server.ts).
 */
export interface CatalogSource {
  readJson<T>(path: string): Promise<T>;
}

export const CATALOG_SOURCE = new InjectionToken<CatalogSource>('CATALOG_SOURCE', {
  providedIn: 'root',
  factory: () => browserCatalogSource,
});

export const browserCatalogSource: CatalogSource = {
  async readJson<T>(path: string): Promise<T> {
    const res = await fetch(new URL(`data/${path}`, document.baseURI));
    if (!res.ok) throw new Error(`Failed to load data/${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  },
};
