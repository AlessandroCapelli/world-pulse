// Build-time geo pipeline.
// Reads Natural Earth (world-atlas) TopoJSON and produces:
//   public/data/geo/countries-50m.json / countries-110m.json  (copied, properties trimmed)
//   public/data/geo/countries.json                            (country registry: index, codes, names, aliases, centroid, tz, area)
//   public/data/proxies/land-area.json                        (land area proxy, computed from geometry)
// Run: npm run geo:build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import countries from 'i18n-iso-countries';
import ct from 'countries-and-timezones';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outGeo = join(root, 'public/data/geo');
const outProxies = join(root, 'public/data/proxies');
mkdirSync(outGeo, { recursive: true });
mkdirSync(outProxies, { recursive: true });

countries.registerLocale(require('i18n-iso-countries/langs/en.json'));
countries.registerLocale(require('i18n-iso-countries/langs/it.json'));

const EARTH_RADIUS_KM = 6371.0088;
const ACCESSED = '2026-09-27';

/** Features without an ISO numeric id in Natural Earth. Disputed areas keep neutral pseudo-codes and carry no data. */
const UNCODED = {
  Somaliland: { iso3: 'XSO', en: 'Somaliland', it: 'Somaliland', tz: 'Africa/Mogadishu', disputed: true },
  Kosovo: { iso3: 'XKX', iso2: 'XK', en: 'Kosovo', it: 'Kosovo', tz: 'Europe/Belgrade', disputed: true },
  'N. Cyprus': { iso3: 'XNC', en: 'Northern Cyprus', it: 'Cipro del Nord', tz: 'Asia/Nicosia', disputed: true },
  'Siachen Glacier': { iso3: 'XSG', en: 'Siachen Glacier', it: 'Ghiacciaio del Siachen', tz: 'Asia/Kolkata', disputed: true },
  // Christmas Island + Cocos (Keeling) Islands: Australian external territories.
  'Indian Ocean Ter.': { iso3: 'AUS' },
};

/** Representative IANA zone for multi-zone countries (population-weighted choice). */
const TZ_OVERRIDES = {
  US: 'America/Chicago', CA: 'America/Toronto', RU: 'Europe/Moscow', BR: 'America/Sao_Paulo',
  AU: 'Australia/Sydney', MX: 'America/Mexico_City', ID: 'Asia/Jakarta', KZ: 'Asia/Almaty',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CN: 'Asia/Shanghai', CD: 'Africa/Kinshasa',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', EC: 'America/Guayaquil', MN: 'Asia/Ulaanbaatar',
  PG: 'Pacific/Port_Moresby', NZ: 'Pacific/Auckland', FR: 'Europe/Paris', GB: 'Europe/London',
  DK: 'Europe/Copenhagen', NL: 'Europe/Amsterdam', UA: 'Europe/Kyiv', UZ: 'Asia/Tashkent',
  MY: 'Asia/Kuala_Lumpur', KI: 'Pacific/Tarawa', FM: 'Pacific/Pohnpei', GL: 'America/Nuuk',
  DE: 'Europe/Berlin', CY: 'Asia/Nicosia', IN: 'Asia/Kolkata', NO: 'Europe/Oslo', IT: 'Europe/Rome',
};

/**
 * Approximate population centres for large countries whose geometric centroid is far from where people live.
 * Hand-set, rounded to ~0.5° (approximations, as stated on the About page).
 */
const CENTROID_OVERRIDES = {
  USA: [-92.3, 37.4], CAN: [-79.0, 45.8], RUS: [48.0, 55.0], BRA: [-45.5, -18.5], AUS: [146.5, -32.5],
  CHN: [113.0, 32.0], IND: [79.5, 22.5], IDN: [110.0, -6.8], ARG: [-60.5, -33.5], KAZ: [70.0, 47.5],
  EGY: [31.2, 29.5], DZA: [3.5, 35.5], LBY: [15.0, 31.5], SAU: [45.0, 24.0], MEX: [-100.0, 21.0],
  CHL: [-71.0, -34.5], NOR: [10.5, 60.5], SWE: [15.5, 59.0], FRA: [2.5, 46.8], GBR: [-1.8, 52.8],
  NLD: [5.3, 52.2], DNK: [9.8, 55.9], NZL: [174.5, -38.5], ESP: [-3.7, 40.2], PRT: [-8.3, 39.8],
  ECU: [-78.8, -1.6], ITA: [12.5, 42.5],
};

/** Common spellings used by World Bank / OWID / UN exports that i18n-iso-countries does not list. */
const EXTRA_ALIASES = {
  USA: ['united states of america', 'us', 'usa', 'u.s.', 'america', 'stati uniti d america'],
  GBR: ['uk', 'great britain', 'britain', 'england', 'united kingdom of great britain and northern ireland'],
  RUS: ['russia', 'russian federation'],
  KOR: ['south korea', 'korea, rep.', 'korea rep', 'republic of korea', 'korea (republic of)'],
  PRK: ['north korea', "korea, dem. people's rep.", 'dprk'],
  IRN: ['iran', 'iran, islamic rep.', 'iran (islamic republic of)'],
  EGY: ['egypt, arab rep.'],
  TUR: ['turkiye', 'türkiye', 'turkey'],
  CZE: ['czech republic', 'czechia'],
  VNM: ['viet nam', 'vietnam'],
  COD: ['congo, dem. rep.', 'dr congo', 'drc', 'democratic republic of congo', 'democratic republic of the congo', 'congo-kinshasa'],
  COG: ['congo, rep.', 'republic of congo', 'congo-brazzaville', 'congo'],
  CIV: ["cote d'ivoire", 'ivory coast', "côte d'ivoire", 'costa d avorio'],
  LAO: ['lao pdr', 'laos'],
  SYR: ['syria', 'syrian arab republic'],
  VEN: ['venezuela, rb', 'venezuela'],
  YEM: ['yemen, rep.'],
  GMB: ['gambia, the', 'the gambia'],
  BHS: ['bahamas, the', 'the bahamas'],
  KGZ: ['kyrgyz republic'],
  SVK: ['slovak republic'],
  MKD: ['north macedonia', 'macedonia'],
  SWZ: ['eswatini', 'swaziland'],
  MMR: ['myanmar', 'burma'],
  BOL: ['bolivia'],
  TZA: ['tanzania'],
  MDA: ['moldova'],
  TWN: ['taiwan'],
  HKG: ['hong kong sar, china', 'hong kong'],
  MAC: ['macao sar, china', 'macau'],
  PSE: ['palestine', 'west bank and gaza', 'state of palestine'],
  FSM: ['micronesia, fed. sts.', 'micronesia'],
  CPV: ['cabo verde', 'cape verde'],
  TLS: ['timor-leste', 'east timor'],
  BRN: ['brunei', 'brunei darussalam'],
  XKX: ['kosovo'],
};

const normalize = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function largestPolygonCentroid(f) {
  if (f.geometry.type === 'Polygon') return geoCentroid(f);
  let best = null;
  let bestArea = -1;
  for (const coords of f.geometry.coordinates) {
    const poly = { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: {} };
    const a = geoArea(poly);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return geoCentroid(best);
}

function trimTopology(path) {
  const topo = JSON.parse(readFileSync(require.resolve(path), 'utf8'));
  for (const g of topo.objects.countries.geometries) {
    const mapped = resolveCode(g);
    g.properties = { iso3: mapped.iso3 };
    delete g.id;
  }
  return topo;
}

function resolveCode(g) {
  if (g.id) {
    const iso3 = countries.numericToAlpha3(g.id);
    return { iso3, iso2: countries.alpha3ToAlpha2(iso3), num: g.id };
  }
  const u = UNCODED[g.properties.name];
  if (!u) throw new Error(`Unmapped feature ${g.properties.name}`);
  return { iso3: u.iso3, iso2: u.iso2 ?? null, num: null, meta: u };
}

const topo50 = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
const fc = feature(topo50, topo50.objects.countries);

/** @type {Map<string, any>} */
const byIso = new Map();
for (let k = 0; k < fc.features.length; k++) {
  const f = fc.features[k];
  const g = topo50.objects.countries.geometries[k];
  const code = resolveCode(g);
  const entry = byIso.get(code.iso3) ?? { ...code, features: [] };
  entry.features.push(f);
  byIso.set(code.iso3, entry);
}

/** Display names where the ISO library picks an awkward form. */
const NAME_OVERRIDES = {
  ARE: { en: 'United Arab Emirates' },
  GBR: { en: 'United Kingdom' },
  COD: { en: 'DR Congo', it: 'RD del Congo' },
  COG: { en: 'Congo', it: 'Congo' },
  CIV: { en: "Côte d'Ivoire" },
  BRN: { en: 'Brunei' },
  LAO: { en: 'Laos' },
  MDA: { en: 'Moldova' },
  FSM: { en: 'Micronesia', it: 'Micronesia' },
  SYR: { en: 'Syria' },
  VAT: { en: 'Vatican City' },
  VGB: { en: 'British Virgin Islands' },
  VIR: { en: 'U.S. Virgin Islands' },
  FLK: { en: 'Falkland Islands' },
  MMR: { it: 'Myanmar' },
  TWN: { it: 'Taiwan' },
  USA: { it: 'Stati Uniti' },
  SHN: { it: "Sant'Elena" },
  TUR: { en: 'Türkiye', it: 'Turchia' },
  CPV: { en: 'Cabo Verde' },
  MAF: { en: 'Saint Martin' },
  SXM: { en: 'Sint Maarten' },
};

const registry = [];
let index = 1;
for (const [iso3, e] of [...byIso.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const meta = e.meta ?? UNCODED[Object.keys(UNCODED).find((n) => UNCODED[n].iso3 === iso3)] ?? {};
  const iso2 = e.iso2 ?? meta.iso2 ?? null;
  const en = meta.en ?? countries.getName(iso3, 'en', { select: 'official' }) ?? iso3;
  const it = meta.it ?? countries.getName(iso3, 'it', { select: 'official' }) ?? en;
  const shortEn = meta.en ?? countries.getName(iso3, 'en', { select: 'alias' }) ?? en;
  const aliasSet = new Set();
  for (const lang of ['en', 'it']) {
    const all = countries.getName(iso3, lang, { select: 'all' }) ?? [];
    for (const n of all) aliasSet.add(normalize(n));
  }
  for (const n of EXTRA_ALIASES[iso3] ?? []) aliasSet.add(normalize(n));
  for (const f of e.features) aliasSet.add(normalize(topoName(f)));
  aliasSet.add(normalize(en));
  aliasSet.add(normalize(it));
  aliasSet.add(iso3.toLowerCase());
  if (iso2) aliasSet.add(iso2.toLowerCase());
  aliasSet.delete('');

  const area = e.features.reduce((s, f) => s + geoArea(f), 0) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  const biggest = e.features.reduce((a, b) => (geoArea(a) >= geoArea(b) ? a : b));
  const centroid = CENTROID_OVERRIDES[iso3] ?? largestPolygonCentroid(biggest);
  const tz =
    meta.tz ??
    (iso2 && TZ_OVERRIDES[iso2]) ??
    (iso2 && ct.getCountry(iso2)?.timezones?.[0]) ??
    'Etc/UTC';

  registry.push({
    i: index++,
    iso3,
    iso2,
    num: e.num ?? null,
    name: { en: NAME_OVERRIDES[iso3]?.en ?? (shortEn.length < en.length ? shortEn : en), it: NAME_OVERRIDES[iso3]?.it ?? it },
    aliases: [...aliasSet].sort(),
    c: [round(centroid[0], 2), round(centroid[1], 2)],
    tz,
    areaKm2: Math.round(area),
    ...(meta.disputed ? { disputed: true } : {}),
  });
}

function topoName(f) {
  const idx = fc.features.indexOf(f);
  return topo50.objects.countries.geometries[idx].properties.name;
}

function round(v, d) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}

writeFileSync(join(outGeo, 'countries.json'), JSON.stringify({ version: 1, source: 'Natural Earth 1:50m via world-atlas 2.0; ISO 3166 names via i18n-iso-countries; zones via countries-and-timezones', countries: registry }));
writeFileSync(join(outGeo, 'countries-50m.json'), JSON.stringify(trimTopology('world-atlas/countries-50m.json')));
writeFileSync(join(outGeo, 'countries-110m.json'), JSON.stringify(trimTopology('world-atlas/countries-110m.json')));

const landArea = {
  schemaVersion: 1,
  id: 'land-area',
  category: 'geography',
  name: { en: 'Land area', it: 'Superficie terrestre' },
  description: {
    en: 'Country land area computed from Natural Earth 1:50m polygons (includes inland water). Used as an allocation proxy for phenomena spread over land.',
    it: 'Superficie dei paesi calcolata dai poligoni Natural Earth 1:50m (acque interne incluse). Usata come proxy di allocazione per fenomeni distribuiti sulla terraferma.',
  },
  unit: 'km2',
  unitLabel: { en: 'km²', it: 'km²' },
  kind: 'stock',
  resolution: { maxYearGap: 100 },
  visual: { color: '#7fd6c2', icon: 'globe', scale: 'sqrt' },
  series: registry
    .filter((c) => !c.disputed)
    .map((c) => ({ scope: c.iso3, year: 2020, value: c.areaKm2, sourceId: 'ne', confidence: 'modelled' })),
  sources: {
    ne: {
      title: 'Natural Earth Admin 0 – Countries, 1:50m (world-atlas 2.0)',
      publisher: 'Natural Earth / computed by World Pulse',
      url: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/',
      accessed: ACCESSED,
    },
  },
};
writeFileSync(join(outProxies, 'land-area.json'), JSON.stringify(landArea, null, 1));

console.log(`countries.json: ${registry.length} entries`);
