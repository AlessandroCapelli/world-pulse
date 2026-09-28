import type { CatalogPayload, GeoRequest } from './worker-tasks';

export type WorkerRequest =
  | { id: number; type: 'catalog'; payload: CatalogPayload }
  | { id: number; type: 'snapshots'; year: number | 'latest'; ids?: string[] }
  | { id: number; type: 'geo'; request: GeoRequest }
  | { id: number; type: 'parse'; name: string; text: string };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WorkerCall = DistributiveOmit<WorkerRequest, 'id'>;
