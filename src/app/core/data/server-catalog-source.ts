import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogSource } from './catalog-source';

/** Prerender-time source: reads `public/data` from the workspace (the CLI prerenders from the project root). */
export const serverCatalogSource: CatalogSource = {
  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', path), 'utf8')) as T;
  },
};

export function readManifestIds(): string[] {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'manifest.json'), 'utf8')) as {
    metrics: string[];
    proxies: string[];
  };
  return [...manifest.metrics, ...manifest.proxies];
}
