/// <reference lib="webworker" />
import { EngineState, geoTransferables, loadGeo, parseUpload } from './worker-tasks';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

const state = new EngineState();

addEventListener('message', async ({ data }: MessageEvent<WorkerRequest>) => {
  const reply = (msg: WorkerResponse, transfer: Transferable[] = []) => postMessage(msg, transfer);
  try {
    switch (data.type) {
      case 'catalog':
        state.setCatalog(data.payload);
        reply({ id: data.id, ok: true, result: null });
        break;
      case 'snapshots':
        reply({ id: data.id, ok: true, result: state.snapshots(data.year, data.ids) });
        break;
      case 'geo': {
        const assets = await loadGeo(data.request);
        reply({ id: data.id, ok: true, result: assets }, geoTransferables(assets));
        break;
      }
      case 'parse':
        reply({ id: data.id, ok: true, result: await parseUpload(data.name, data.text) });
        break;
    }
  } catch (e) {
    reply({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
