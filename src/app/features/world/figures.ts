import { MetricSnapshot, UnitId } from '../../core/engine/types';
import { formatInteger, formatQuantity, Locale } from '../../core/engine/units';

/** Splits a quantity into number + unit, using full grouped integers for plain counts (odometer friendly). */
export function splitQuantity(value: number, unit: UnitId, lang: Locale, precise = false): { number: string; unit: string } {
  if (precise && (unit === 'count' || unit === 'teu') && Math.abs(value) < 1e12) {
    return { number: formatInteger(value, lang), unit: '' };
  }
  const f = formatQuantity(value, unit, lang);
  return { number: f.number, unit: f.unit };
}

export function worldPlacedShares(s: MetricSnapshot): { reported: number; allocated: number; unallocated: number } {
  const w = s.world.value;
  if (!(w > 0)) return { reported: 0, allocated: 0, unallocated: 0 };
  let allocated = 0;
  let reported = 0;
  for (const c of s.countries) {
    if (c.provenance === 'allocated') allocated += c.value;
    else reported += c.value;
  }
  return {
    reported: Math.min(100, (reported / w) * 100),
    allocated: Math.min(100, (allocated / w) * 100),
    unallocated: Math.min(100, (s.unallocated / w) * 100),
  };
}
