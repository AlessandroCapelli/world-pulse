import { computed, Injectable, signal } from '@angular/core';
import { TIME_WINDOWS, TimeWindow } from '../engine/periods';

export type Mode = 'live' | 'window' | 'history';
export const MODES: readonly Mode[] = ['live', 'window', 'history'];

export interface Layers {
  particles: boolean;
  spikes: boolean;
  choropleth: boolean;
}

export interface CameraState {
  lat: number;
  lng: number;
  /** Distance from the globe surface in globe radii. */
  alt: number;
}

export const DEFAULT_LAYERS: Layers = { particles: true, spikes: true, choropleth: true };

/** Single signal-based store for everything that is shareable via deep link. */
@Injectable({ providedIn: 'root' })
export class AppStore {
  readonly metricId = signal<string | null>(null);
  readonly compareId = signal<string | null>(null);
  readonly mode = signal<Mode>('live');
  readonly window = signal<TimeWindow>('1min');
  /** Year shown in history mode (null = the metric's latest year). */
  readonly year = signal<number | null>(null);
  readonly country = signal<string | null>(null);
  readonly perCapita = signal(false);
  readonly layers = signal<Layers>(DEFAULT_LAYERS);
  readonly camera = signal<CameraState | null>(null);
  readonly tableView = signal(false);
  /** Set when a deep link pointed to a dataset that only exists in someone else's browser. */
  readonly missingUserMetric = signal(false);

  readonly comparing = computed(() => this.compareId() !== null);

  toggleLayer(key: keyof Layers): void {
    this.layers.update((l) => ({ ...l, [key]: !l[key] }));
  }
}

export function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

export function isWindow(v: unknown): v is TimeWindow {
  return typeof v === 'string' && (TIME_WINDOWS as readonly string[]).includes(v);
}
