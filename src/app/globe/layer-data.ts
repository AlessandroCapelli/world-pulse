import { Scale } from '../core/engine/types';
import { ChoroplethClasses } from './choropleth';

/** Provenance flags packed into the data texture (green channel). */
export const FLAG_NONE = 0;
export const FLAG_REPORTED = 1;
export const FLAG_ESTIMATED = 2; // interpolated or carried forward
export const FLAG_ALLOCATED = 3;

/** Everything a globe slot needs to draw one metric. Arrays are indexed by country index (1-based). */
export interface GlobeLayerData {
  key: string;
  color: string;
  scale: Scale;
  /** Display values (per second, per capita or level) used for choropleth and spikes. */
  values: Float32Array;
  flags: Uint8Array;
  /** Quantile classes of `values` for the choropleth (shared with the map legend). */
  classes: ChoroplethClasses | null;
  /** Base per-second rates used to spawn pulses (all zero for stocks). */
  rates: Float32Array;
  /** Local UTC offset (hours) per country. */
  offsets: Float32Array;
  hourly: readonly number[];
  unitsPerParticle: number;
}

export interface GlobeLayers {
  particles: boolean;
  spikes: boolean;
  choropleth: boolean;
}

export interface HoverInfo {
  index: number | null;
  x: number;
  y: number;
  slot: 0 | 1;
}
