import { RenderMode, ServerRoute } from '@angular/ssr';
import { readManifestIds } from './core/data/server-catalog-source';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'about', renderMode: RenderMode.Prerender },
  {
    path: 'metric/:id',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => readManifestIds().map((id) => ({ id })),
  },
  { path: '**', renderMode: RenderMode.Prerender },
];
