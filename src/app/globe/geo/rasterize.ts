// Framework-free geo processing, executed in the Web Worker:
//  - rasterizes countries into an equirectangular ID map (exact scanline fill, no antialiasing,
//    so border pixels never blend into a wrong id);
//  - samples spawn points inside each country (area-weighted);
//  - builds coastline and border line segments projected on the sphere.
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, Geometry, MultiLineString, Position } from 'geojson';
import { DEG, latLngToXyz } from '../coords';

export interface RasterInput {
  topology: Topology;
  /** iso3 → country index (1-based; 0 = no country). */
  indexOf: Record<string, number>;
  countryCount: number;
  width: number;
  height: number;
  poolSize: number;
  /** Line radius (slightly above the sphere). */
  lineRadius: number;
  /** Max segment length (degrees) before great-circle subdivision. */
  maxSegmentDeg: number;
}

export interface GeoAssets {
  width: number;
  height: number;
  /** Country index per pixel (row 0 = north). */
  ids: Uint16Array;
  /** Pixel count per country index. */
  pixelCounts: Uint32Array;
  /** Spawn points (xyz on unit sphere) grouped by country: points [poolStart[i], poolStart[i] + poolCount[i]). */
  poolPoints: Float32Array;
  poolStart: Uint32Array;
  poolCount: Uint32Array;
  /** Line segment endpoints (xyz pairs). */
  coastlines: Float32Array;
  borders: Float32Array;
}

type Ring = Position[];

export function buildGeoAssets(input: RasterInput): GeoAssets {
  const { topology, width, height } = input;
  const object = topology.objects['countries'] as GeometryCollection<{ iso3: string }>;
  const fc = feature(topology, object);
  const ids = new Uint16Array(width * height);

  for (const f of fc.features as Feature<Geometry, { iso3: string }>[]) {
    const index = input.indexOf[f.properties.iso3] ?? 0;
    if (!index || !f.geometry) continue;
    const polygons: Ring[][] =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates
          : [];
    for (const rings of polygons) fillPolygon(ids, width, height, rings, index);
  }

  const pixelCounts = new Uint32Array(input.countryCount + 1);
  for (const id of ids) pixelCounts[id]++;

  const pools = samplePools(ids, width, height, input.countryCount, input.poolSize);

  const coast = mesh(topology, object, (a, b) => a === b) as MultiLineString;
  const border = mesh(topology, object, (a, b) => a !== b) as MultiLineString;

  return {
    width,
    height,
    ids,
    pixelCounts,
    ...pools,
    coastlines: linesToSegments(coast, input.lineRadius, input.maxSegmentDeg),
    borders: linesToSegments(border, input.lineRadius, input.maxSegmentDeg),
  };
}

/** Even-odd scanline fill of one polygon (outer ring + holes) sampled at pixel centres. */
function fillPolygon(ids: Uint16Array, width: number, height: number, rings: Ring[], index: number): void {
  // Collect edges. Rings crossing the antimeridian are unwrapped into a continuous longitude
  // range (may exceed ±180); pixels are written modulo the map width.
  const x0: number[] = [];
  const y0: number[] = [];
  const x1: number[] = [];
  const y1: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const raw of rings) {
    const ring = unwrapRing(raw);
    for (let k = 0; k < ring.length - 1; k++) {
      const a = ring[k];
      const b = ring[k + 1];
      if (a[1] === b[1]) continue;
      x0.push(a[0]);
      y0.push(a[1]);
      x1.push(b[0]);
      y1.push(b[1]);
      minLat = Math.min(minLat, a[1], b[1]);
      maxLat = Math.max(maxLat, a[1], b[1]);
    }
  }
  if (x0.length === 0) return;

  const rowTop = Math.max(0, Math.floor(((90 - maxLat) / 180) * height));
  const rowBottom = Math.min(height - 1, Math.ceil(((90 - minLat) / 180) * height));
  const edgeCount = x0.length;
  // Bucket edges by starting row for an active-edge sweep.
  const buckets: number[][] = [];
  for (let e = 0; e < edgeCount; e++) {
    const top = Math.max(y0[e], y1[e]);
    const row = Math.max(rowTop, Math.floor(((90 - top) / 180) * height));
    (buckets[row] ??= []).push(e);
  }
  let active: number[] = [];
  const xs: number[] = [];
  for (let row = rowTop; row <= rowBottom; row++) {
    const bucket = buckets[row];
    if (bucket) active.push(...bucket);
    const lat = 90 - ((row + 0.5) / height) * 180;
    xs.length = 0;
    const stillActive: number[] = [];
    for (const e of active) {
      const ya = y0[e];
      const yb = y1[e];
      if (Math.min(ya, yb) > lat) continue; // edge entirely above → finished
      stillActive.push(e);
      if (ya > lat !== yb > lat) {
        xs.push(x0[e] + ((lat - ya) * (x1[e] - x0[e])) / (yb - ya));
      }
    }
    active = stillActive;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const base = row * width;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // pixel centres with lng in [xs[k], xs[k+1]) — in unwrapped pixel space
      const from = Math.ceil(((xs[k] + 180) / 360) * width - 0.5);
      const to = Math.min(from + width - 1, Math.floor(((xs[k + 1] + 180) / 360) * width - 0.5));
      for (let x = from; x <= to; x++) ids[base + (((x % width) + width) % width)] = index;
    }
  }
}

/**
 * Makes a ring's longitudes continuous (|Δlng| ≤ 180 between consecutive points).
 * A ring that winds once around a pole is closed through that pole.
 */
function unwrapRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const out: Ring = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let k = 1; k < ring.length; k++) {
    const prev = ring[k - 1][0];
    const cur = ring[k][0];
    const d = cur - prev;
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    out.push([cur + offset, ring[k][1]]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(last[0] - first[0]) > 180) {
    // Encircles a pole: close the ring along that pole.
    const avgLat = out.reduce((s, p) => s + p[1], 0) / out.length;
    const pole = avgLat >= 0 ? 90 : -90;
    out.push([last[0], pole], [first[0], pole], [first[0], first[1]]);
  }
  return out;
}

/** Area-weighted random sample of up to `poolSize` points per country (deterministic PRNG). */
function samplePools(ids: Uint16Array, width: number, height: number, countryCount: number, poolSize: number) {
  const weightSum = new Float64Array(countryCount + 1);
  const rowWeight = new Float64Array(height);
  for (let y = 0; y < height; y++) rowWeight[y] = Math.cos((90 - ((y + 0.5) / height) * 180) * DEG);
  for (let y = 0; y < height; y++) {
    const w = rowWeight[y];
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const id = ids[base + x];
      if (id) weightSum[id] += w;
    }
  }
  const rand = mulberry32(0x5eed);
  const buckets: number[][] = Array.from({ length: countryCount + 1 }, () => []);
  for (let y = 0; y < height; y++) {
    const w = rowWeight[y];
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const id = ids[base + x];
      if (!id) continue;
      const p = (poolSize * 1.3 * w) / weightSum[id];
      if (rand() < p) {
        const b = buckets[id];
        if (b.length < poolSize * 3) {
          const lng = ((x + rand()) / width) * 360 - 180;
          const lat = 90 - ((y + rand()) / height) * 180;
          b.push(lat, lng);
        }
      }
    }
  }
  const poolStart = new Uint32Array(countryCount + 1);
  const poolCount = new Uint32Array(countryCount + 1);
  let total = 0;
  for (let i = 0; i <= countryCount; i++) total += Math.min(poolSize, buckets[i].length / 2);
  const poolPoints = new Float32Array(total * 3);
  const tmp = [0, 0, 0];
  let cursor = 0;
  for (let i = 0; i <= countryCount; i++) {
    const b = buckets[i];
    const n = Math.min(poolSize, b.length / 2);
    // Samples were collected in row order: shuffle pairs so truncation keeps an unbiased subset.
    for (let k = b.length / 2 - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const la = b[k * 2];
      const lo = b[k * 2 + 1];
      b[k * 2] = b[j * 2];
      b[k * 2 + 1] = b[j * 2 + 1];
      b[j * 2] = la;
      b[j * 2 + 1] = lo;
    }
    poolStart[i] = cursor;
    poolCount[i] = n;
    for (let k = 0; k < n; k++) {
      latLngToXyz(b[k * 2], b[k * 2 + 1], 1, tmp);
      poolPoints[(cursor + k) * 3] = tmp[0];
      poolPoints[(cursor + k) * 3 + 1] = tmp[1];
      poolPoints[(cursor + k) * 3 + 2] = tmp[2];
    }
    cursor += n;
  }
  return { poolPoints, poolStart, poolCount };
}

/** MultiLineString (lng/lat) → sphere line segments, subdividing long edges along great circles. */
function linesToSegments(ml: MultiLineString, radius: number, maxSegmentDeg: number): Float32Array {
  const out: number[] = [];
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (const line of ml.coordinates) {
    for (let k = 0; k < line.length - 1; k++) {
      const p = line[k];
      const q = line[k + 1];
      if (Math.abs(p[0] - q[0]) > 180) continue;
      const span = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
      const steps = Math.max(1, Math.ceil(span / maxSegmentDeg));
      latLngToXyz(p[1], p[0], 1, a);
      latLngToXyz(q[1], q[0], 1, b);
      let prevX = a[0] * radius;
      let prevY = a[1] * radius;
      let prevZ = a[2] * radius;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        let x = a[0] + (b[0] - a[0]) * t;
        let y = a[1] + (b[1] - a[1]) * t;
        let z = a[2] + (b[2] - a[2]) * t;
        const len = Math.hypot(x, y, z) || 1;
        x = (x / len) * radius;
        y = (y / len) * radius;
        z = (z / len) * radius;
        out.push(prevX, prevY, prevZ, x, y, z);
        prevX = x;
        prevY = y;
        prevZ = z;
      }
    }
  }
  return new Float32Array(out);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
