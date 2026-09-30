// Builds additive country quantities from the declarative indicator registry. Derived values use
// observations for the same country and year only; missing inputs remain missing.
import { combine, fetchedOn, mapValues, toTable, withoutWorld, worldBank } from './lib.mjs';
import { EXPANDED_INDICATORS } from './expanded-indicators.mjs';

const indicatorUrl = (code) => `https://data.worldbank.org/indicator/${code}`;
const currentCompleteYear = new Date().getUTCFullYear() - 1;

function formula({ indicator, denominator, transform, scale }) {
  const expression = {
    identity: indicator,
    percent: `${indicator} / 100 × ${denominator}`,
    complement: `(1 − ${indicator} / 100) × ${denominator}`,
    per1000: `${indicator} / 1000 × ${denominator}`,
    product: `${indicator} × ${denominator}`,
  }[transform];
  return scale === 1 ? expression : `(${expression}) × ${scale}`;
}

function notes(def) {
  const denominator = def.denominator ? ` Denominator/input: ${indicatorUrl(def.denominator)}.` : '';
  const world = def.transform === 'identity'
    ? 'World totals use reported global values where available; otherwise they sum reporting countries.'
    : 'World total is the sum of reporting countries, not a claim of complete global coverage.';
  return `Quantity formula: ${formula(def)}.${denominator} Same-year inputs only; missing raw observations are not filled during dataset generation. The app can interpolate between observations or carry endpoint values for up to three years, with provenance labels. ${world}${def.note ? ` ${def.note}` : ''}`;
}

function frame(def) {
  const primary = worldBank(def.indicator);
  if (def.transform === 'identity') return mapValues(primary, (value) => value >= 0 ? value * def.scale : null);
  const denominator = worldBank(def.denominator);
  return withoutWorld(combine(primary, denominator, (value, base) => {
    if (value < 0 || base < 0) return null;
    if ((def.transform === 'percent' || def.transform === 'complement') && value > 100) return null;
    const transformed = {
      percent: () => value / 100 * base,
      complement: () => (1 - value / 100) * base,
      per1000: () => value / 1000 * base,
      product: () => value * base,
    }[def.transform]();
    return transformed * def.scale;
  }));
}

export const EXPANDED_DEFINITIONS = EXPANDED_INDICATORS.map((def) => {
  const derived = def.transform !== 'identity';
  const accessedDates = [fetchedOn(`wb-${def.indicator}`), ...(def.denominator ? [fetchedOn(`wb-${def.denominator}`)] : [])];
  const qualifier = {
    en: ' Missing raw observations are not filled during dataset generation. The app can interpolate between observations or carry endpoint values for up to three years, with provenance labels; countries without usable data remain unavailable. Categories and subsets can overlap, so metrics must not be added together.',
    it: ' Le osservazioni mancanti non vengono completate durante la generazione dei dati. L’app può interpolare tra osservazioni o riportare i valori agli estremi per un massimo di tre anni, indicando la provenienza; i paesi senza dati utilizzabili restano non disponibili. Categorie e sottoinsiemi possono sovrapporsi, quindi le metriche non vanno sommate fra loro.',
  };
  return {
    id: def.id,
    group: 'expanded',
    meta: {
      category: def.category,
      name: def.name,
      description: { en: def.description.en + qualifier.en, it: def.description.it + qualifier.it },
      unit: def.unit,
      unitLabel: def.unitLabel,
      kind: def.kind,
      resolution: { maxYearGap: 3 },
      visual: def.visual,
    },
    sources: {
      wdi: {
        title: `World Development Indicators – ${def.name.en} (${def.indicator}${def.denominator ? `; ${def.denominator}` : ''})`,
        publisher: 'World Bank',
        url: indicatorUrl(def.indicator),
        accessed: accessedDates.sort().at(-1),
      },
    },
    tables: () => {
      const data = frame(def);
      const options = {
        sourceId: 'wdi',
        confidence: derived ? 'estimate' : def.confidence,
        ...(def.kind === 'flow' ? { period: 'year' } : {}),
        note: notes(def),
        maxYear: currentCompleteYear,
      };
      // Keep national observations independently of release completeness. A partial "World"
      // aggregate must not erase fresh country data or scale older country values down.
      const countries = toTable(withoutWorld(data), { ...options, trimIncomplete: false });
      if (!data.has('world')) return [countries];
      const complete = toTable(data, { ...options, requireCountryCoverage: true });
      const world = complete?.values.world
        ? { ...complete, values: { world: complete.values.world } }
        : null;
      // A lagging world series would be carried into a newer country release and can distort
      // the total or its growth. Use explicitly partial country sums for those datasets.
      const latestCountry = countries?.years.at(-1);
      const latestWorld = world?.years.at(-1);
      if (latestCountry !== undefined && (latestWorld === undefined || latestCountry > latestWorld)) {
        if (countries) countries.note += ' Reported global releases lag country data or are incomplete; world figures use available-country sums for this dataset.';
        return [countries];
      }
      return [world, countries];
    },
  };
});
