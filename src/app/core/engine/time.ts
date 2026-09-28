const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Current UTC offset (hours) of an IANA zone, DST-aware, via Intl.
 * Falls back to 0 for unknown zones.
 */
export function tzOffsetHours(timeZone: string, at: Date = new Date()): number {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    } catch {
      return 0;
    }
    formatterCache.set(timeZone, fmt);
  }
  const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}

/**
 * Sub-solar point (degrees) for a UTC date — accurate to a fraction of a degree,
 * enough for a day/night terminator.
 */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const ms = date.getTime();
  const jd = ms / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const epsilon = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let lng = (ra * 180) / Math.PI - gmst * 15;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return { lat: (decl * 180) / Math.PI, lng };
}
