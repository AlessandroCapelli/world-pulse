/**
 * Choropleth classes shared by the globe shader and the map legend, so both always show the same colours.
 *
 * Countries are split into quantile classes (each class holds roughly the same number of countries): with
 * heavily skewed data (China and India vs. small islands) this keeps neighbours distinguishable, which a
 * continuous linear or log ramp does not. Colours come from a perceptual ramp in OKLCH built around the
 * metric colour: lightness grows monotonically, hue drifts towards violet for the smallest values.
 */

export const MAX_CLASSES = 7;

export interface ChoroplethClasses {
  /** Class edges, length = colors.length + 1 (first = minimum, last = maximum). */
  breaks: number[];
  /** sRGB hex colour of each class, from low to high. */
  colors: string[];
}

/** Quantile classes of the positive values (index 0 is unused: arrays are indexed by country index). */
export function quantileClasses(values: ArrayLike<number>, include: (i: number) => boolean, color: string): ChoroplethClasses | null {
  const vals: number[] = [];
  for (let i = 1; i < values.length; i++) if (include(i) && values[i] > 0) vals.push(values[i]);
  if (vals.length < 2) return null;
  vals.sort((a, b) => a - b);
  const n = Math.max(2, Math.min(MAX_CLASSES, Math.floor(vals.length / 4)));
  const breaks: number[] = [];
  for (let k = 0; k < n; k++) {
    const b = vals[Math.floor((k * vals.length) / n)];
    if (breaks.length === 0 || b > breaks[breaks.length - 1]) breaks.push(b);
  }
  const max = vals[vals.length - 1];
  if (max > breaks[breaks.length - 1] || breaks.length === 1) breaks.push(max);
  return { breaks, colors: ramp(color, breaks.length - 1) };
}

/** Class of a value (0-based), or -1 for no value. */
export function classOf(v: number, c: ChoroplethClasses): number {
  if (!(v > 0)) return -1;
  const n = c.colors.length;
  for (let k = n - 1; k > 0; k--) if (v >= c.breaks[k]) return k;
  return 0;
}

/** `n` colours from dark/violet-shifted to light, anchored on the metric colour. */
export function ramp(hex: string, n: number): string[] {
  const [, cm, hm] = toOklch(hex);
  const low = Math.abs(hueDelta(hm, 290)) < 40 ? hm + 70 : 290;
  const peak = Math.max(cm, 0.12);
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 1 : k / (n - 1);
    const l = 0.34 + 0.47 * t;
    const h = hm + hueDelta(hm, low) * (1 - t) * 0.8;
    const c = peak * (0.8 + 0.2 * Math.sin(Math.PI * t)) * (1 - 0.3 * smooth(0.8, 1, t));
    out.push(fromOklch(l, c, h));
  }
  return out;
}

// ------------------------------------------------------------------ OKLab helpers (Björn Ottosson)

function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x46f0ff;
  const r = toLinear(((v >> 16) & 255) / 255);
  const g = toLinear(((v >> 8) & 255) / 255);
  const b = toLinear((v & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklabToLinear(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → sRGB hex, reducing chroma until the colour fits the sRGB gamut. */
function fromOklch(L: number, C: number, H: number): string {
  const hr = (H * Math.PI) / 180;
  let c = C;
  let rgb = oklabToLinear(L, c * Math.cos(hr), c * Math.sin(hr));
  for (let i = 0; i < 24 && rgb.some((x) => x < -1e-4 || x > 1 + 1e-4); i++) {
    c *= 0.9;
    rgb = oklabToLinear(L, c * Math.cos(hr), c * Math.sin(hr));
  }
  return '#' + rgb.map((x) => Math.round(toGamma(Math.max(0, Math.min(1, x))) * 255).toString(16).padStart(2, '0')).join('');
}
