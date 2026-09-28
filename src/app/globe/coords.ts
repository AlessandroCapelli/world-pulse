// Globe coordinate convention (right-handed, Y up):
//   lat = 0, lng = 0  → +Z (faces the default camera)
//   lng = +90 (east)  → +X
//   lat = +90 (north) → +Y
export const DEG = Math.PI / 180;

export function latLngToXyz(lat: number, lng: number, radius = 1, out: number[] = [0, 0, 0]): number[] {
  const la = lat * DEG;
  const lo = lng * DEG;
  const c = Math.cos(la);
  out[0] = radius * c * Math.sin(lo);
  out[1] = radius * Math.sin(la);
  out[2] = radius * c * Math.cos(lo);
  return out;
}

export function xyzToLatLng(x: number, y: number, z: number): { lat: number; lng: number } {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG, lng: Math.atan2(x, z) / DEG };
}

/** Pixel of the equirectangular ID map (row 0 = north) containing (lat, lng). */
export function idMapPixel(lat: number, lng: number, width: number, height: number): number {
  const x = Math.min(width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
  return y * width + x;
}
