// ETL metric definitions. Each definition fully describes one generated file in public/data/{metrics,proxies}:
// descriptive metadata + the tables built from the downloaded datasets. Hand-curated metrics (company
// statements, analyst estimates) are NOT listed here and are never overwritten by the build.
import { EXPANDED_DEFINITIONS } from './expanded-metrics.mjs';
import {
  blockchainDailyAverage,
  combine,
  fetchedOn,
  gho,
  mapValues,
  onlyWorld,
  owidDataset,
  owidGrapher,
  sum,
  toTable,
  usgsCounts,
  withoutWorld,
  worldBank,
} from './lib.mjs';

const t = (en, it) => ({ en, it });

function src(rawId, title, publisher, url, published) {
  return { title, publisher, url, ...(published ? { published } : {}), accessed: fetchedOn(rawId) };
}

const WDI = (code, title) =>
  src(`wb-${code}`, `World Development Indicators – ${title} (${code})`, 'World Bank', `https://data.worldbank.org/indicator/${code}`);
const OWID_SRC = (slug, title, publisher) =>
  src(`owid-${slug}`, `${title} (via Our World in Data)`, publisher, `https://ourworldindata.org/grapher/${slug}`);

const popFrame = () => worldBank('SP.POP.TOTL');
const TWH_PER_BARREL = 1.587e-6; // ≈ 1.587 MWh per barrel (1 toe = 11.63 MWh, ~7.33 bbl per tonne)
const KWH_PER_M3_GAS = 10.0; // ≈ 1 bcm natural gas = 10 TWh (Energy Institute conversion factors)

const yearly = (frame, sourceId, confidence, note, maxYear) => toTable(frame, { sourceId, confidence, period: 'year', note, maxYear });
const level = (frame, sourceId, confidence, note) => toTable(frame, { sourceId, confidence, note });

export const DEFINITIONS = [
  ...EXPANDED_DEFINITIONS,
  // ============================================================== proxies
  {
    id: 'population',
    target: 'proxies',
    meta: {
      category: 'demography-health',
      name: t('Population', 'Popolazione'),
      description: t(
        'Total resident population (World Bank, based on UN World Population Prospects and national censuses). Also the default proxy for allocating world totals and computing per-capita values.',
        'Popolazione residente totale (Banca Mondiale, su base UN World Population Prospects e censimenti nazionali). È anche il proxy predefinito per ripartire i totali mondiali e calcolare i valori pro capite.',
      ),
      unit: 'count',
      unitLabel: t('people', 'persone'),
      kind: 'stock',
      resolution: { maxYearGap: 10 },
      visual: { color: '#ff6ec7', icon: 'users', scale: 'sqrt' },
    },
    sources: { wdi: WDI('SP.POP.TOTL', 'Population, total') },
    tables: () => [level(popFrame(), 'wdi', 'official')],
  },
  {
    id: 'gdp',
    target: 'proxies',
    meta: {
      category: 'economy',
      name: t('GDP generated', 'PIL generato'),
      description: t(
        'Gross domestic product at current US dollars: the value of goods and services produced. Also an allocation proxy for consumption and trade metrics.',
        'Prodotto interno lordo a dollari USA correnti: il valore di beni e servizi prodotti. È anche il proxy di allocazione per metriche di consumo e commercio.',
      ),
      unit: 'usd',
      unitLabel: t('US dollars', 'dollari USA'),
      kind: 'flow',
      allocation: { proxy: 'population' },
      resolution: { maxYearGap: 5 },
      visual: { color: '#ffd166', icon: 'dollar', scale: 'sqrt' },
      featured: true,
    },
    sources: { wdi: WDI('NY.GDP.MKTP.CD', 'GDP (current US$)') },
    tables: () => [yearly(worldBank('NY.GDP.MKTP.CD'), 'wdi', 'official')],
  },
  {
    id: 'internet-users',
    target: 'proxies',
    meta: {
      category: 'digital',
      name: t('Internet users', 'Utenti di internet'),
      description: t(
        'People who used the Internet in the last three months: ITU share of individuals using the Internet × population. Allocation proxy for digital activity.',
        'Persone che hanno usato internet negli ultimi tre mesi: quota ITU di individui che usano internet × popolazione. Proxy di allocazione per le attività digitali.',
      ),
      unit: 'count',
      unitLabel: t('users', 'utenti'),
      kind: 'stock',
      allocation: { proxy: 'population' },
      resolution: { maxYearGap: 6 },
      visual: { color: '#5ee7ff', icon: 'wifi', scale: 'sqrt' },
    },
    sources: { wdi: WDI('IT.NET.USER.ZS', 'Individuals using the Internet (% of population)') },
    tables: () => [
      level(combine(worldBank('IT.NET.USER.ZS'), popFrame(), (pct, pop) => (pct / 100) * pop), 'wdi', 'official', 'Computed: ITU share × World Bank population.'),
    ],
  },
  {
    id: 'land-area',
    target: 'proxies',
    meta: {
      category: 'geography',
      name: t('Land area', 'Superficie terrestre'),
      description: t(
        'Country land area excluding inland water (FAO via World Bank). Used as an allocation proxy for phenomena spread over land.',
        'Superficie terrestre dei paesi escluse le acque interne (FAO tramite Banca Mondiale). Usata come proxy di allocazione per fenomeni distribuiti sulla terraferma.',
      ),
      unit: 'km2',
      unitLabel: t('km²', 'km²'),
      kind: 'stock',
      resolution: { maxYearGap: 30 },
      visual: { color: '#7fd6c2', icon: 'globe', scale: 'sqrt' },
    },
    sources: { wdi: WDI('AG.LND.TOTL.K2', 'Land area (sq. km)') },
    tables: () => [level(worldBank('AG.LND.TOTL.K2'), 'wdi', 'official')],
  },

  // ============================================================== people & health
  {
    id: 'births',
    meta: {
      category: 'demography-health',
      name: t('Babies born', 'Bambini nati'),
      description: t(
        'Live births per year in every country, from the UN World Population Prospects 2024 (estimates, not projections).',
        'Nati vivi all’anno in ogni paese, dalle UN World Population Prospects 2024 (stime, non proiezioni).',
      ),
      unit: 'count',
      unitLabel: t('births', 'nascite'),
      kind: 'flow',
      allocation: { proxy: 'population' },
      visual: { color: '#ff7ad9', icon: 'baby', scale: 'sqrt' },
      featured: true,
    },
    sources: { wpp: OWID_SRC('number-of-births-per-year', 'World Population Prospects 2024 – births', 'United Nations, DESA Population Division') },
    tables: () => [yearly(owidGrapher('number-of-births-per-year', 'births__sex_all__age_all__variant_estimates'), 'wpp', 'official')],
  },
  {
    id: 'deaths',
    meta: {
      category: 'demography-health',
      name: t('Deaths', 'Decessi'),
      description: t(
        'Deaths from all causes per year in every country, from the UN World Population Prospects 2024 (2020–2022 include COVID-19 excess mortality).',
        'Decessi per tutte le cause all’anno in ogni paese, dalle UN World Population Prospects 2024 (2020–2022 includono l’eccesso di mortalità da COVID-19).',
      ),
      unit: 'count',
      unitLabel: t('deaths', 'decessi'),
      kind: 'flow',
      allocation: { proxy: 'population' },
      visual: { color: '#9aa7ff', icon: 'candle', scale: 'sqrt' },
      featured: true,
    },
    sources: { wpp: OWID_SRC('number-of-deaths-per-year', 'World Population Prospects 2024 – deaths', 'United Nations, DESA Population Division') },
    tables: () => [yearly(owidGrapher('number-of-deaths-per-year', 'deaths__sex_all__age_all__variant_estimates'), 'wpp', 'official')],
  },
  {
    id: 'population-growth',
    meta: {
      category: 'demography-health',
      name: t('Population growth', 'Crescita della popolazione'),
      description: t(
        'Net natural increase of the world population: UN births minus UN deaths. Not placed on countries, because several countries are shrinking.',
        'Aumento naturale netto della popolazione mondiale: nascite ONU meno decessi ONU. Non assegnato ai paesi, perché diversi paesi sono in calo.',
      ),
      unit: 'count',
      unitLabel: t('people', 'persone'),
      kind: 'flow',
      visual: { color: '#ff9ecb', icon: 'trend', scale: 'linear' },
    },
    sources: { wpp: OWID_SRC('number-of-births-per-year', 'World Population Prospects 2024 – births and deaths', 'United Nations, DESA Population Division') },
    tables: () => [
      yearly(
        onlyWorld(
          combine(
            owidGrapher('number-of-births-per-year', 'births__sex_all__age_all__variant_estimates'),
            owidGrapher('number-of-deaths-per-year', 'deaths__sex_all__age_all__variant_estimates'),
            (b, d) => b - d,
          ),
        ),
        'wpp',
        'official',
        'Computed: births minus deaths.',
      ),
    ],
  },
  {
    id: 'road-deaths',
    meta: {
      category: 'demography-health',
      name: t('Road traffic deaths', 'Morti in incidenti stradali'),
      description: t(
        'Estimated road traffic deaths per country (WHO Global status report on road safety 2023). WHO models under-reporting, so values often exceed police counts.',
        'Morti stimate in incidenti stradali per paese (Rapporto globale OMS sulla sicurezza stradale 2023). L’OMS corregge la sottostima, quindi i valori superano spesso i dati di polizia.',
      ),
      unit: 'count',
      unitLabel: t('deaths', 'decessi'),
      kind: 'flow',
      temporalProfile: 'waking',
      resolution: { maxYearGap: 6 },
      visual: { color: '#ff6b6b', icon: 'road', scale: 'sqrt' },
    },
    sources: { who: src('gho-RS_196', 'Global Health Observatory – estimated number of road traffic deaths (RS_196)', 'World Health Organization', 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/estimated-number-of-road-traffic-deaths') },
    tables: () => [yearly(gho('RS_196'), 'who', 'estimate')],
  },
  {
    id: 'malaria-cases',
    meta: {
      category: 'demography-health',
      name: t('Malaria cases', 'Casi di malaria'),
      description: t(
        'Estimated malaria cases in endemic countries (WHO World Malaria Report). The world value is the sum of the countries.',
        'Casi stimati di malaria nei paesi endemici (Rapporto mondiale OMS sulla malaria). Il valore mondiale è la somma dei paesi.',
      ),
      unit: 'count',
      unitLabel: t('cases', 'casi'),
      kind: 'flow',
      visual: { color: '#c3ff5c', icon: 'mosquito', scale: 'sqrt' },
    },
    sources: { who: src('gho-MALARIA_EST_CASES', 'Global Health Observatory – estimated number of malaria cases', 'World Health Organization', 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/estimated-number-of-malaria-cases') },
    tables: () => [yearly(withoutWorld(gho('MALARIA_EST_CASES')), 'who', 'estimate')],
  },
  {
    id: 'malaria-deaths',
    meta: {
      category: 'demography-health',
      name: t('Malaria deaths', 'Morti di malaria'),
      description: t(
        'Estimated deaths from malaria (WHO World Malaria Report), mostly young children in sub-Saharan Africa.',
        'Morti stimate per malaria (Rapporto mondiale OMS sulla malaria), soprattutto bambini piccoli nell’Africa subsahariana.',
      ),
      unit: 'count',
      unitLabel: t('deaths', 'decessi'),
      kind: 'flow',
      visual: { color: '#9dd35a', icon: 'mosquito', scale: 'sqrt' },
    },
    sources: { who: src('gho-MALARIA_EST_DEATHS', 'Global Health Observatory – estimated number of malaria deaths', 'World Health Organization', 'https://www.who.int/data/gho/data/indicators/indicator-details/GHO/estimated-number-of-malaria-deaths') },
    tables: () => [yearly(withoutWorld(gho('MALARIA_EST_DEATHS')), 'who', 'estimate')],
  },
  {
    id: 'tuberculosis-cases',
    meta: {
      category: 'demography-health',
      name: t('People falling ill with TB', 'Persone che si ammalano di TBC'),
      description: t(
        'Estimated new tuberculosis cases: WHO incidence rate per 100,000 × population.',
        'Nuovi casi stimati di tubercolosi: tasso di incidenza OMS per 100.000 × popolazione.',
      ),
      unit: 'count',
      unitLabel: t('people', 'persone'),
      kind: 'flow',
      visual: { color: '#ffa94d', icon: 'lungs', scale: 'sqrt' },
    },
    sources: { wdi: WDI('SH.TBS.INCD', 'Incidence of tuberculosis (per 100,000 people)') },
    tables: () => [yearly(combine(worldBank('SH.TBS.INCD'), popFrame(), (r, p) => (r / 1e5) * p), 'wdi', 'estimate', 'Computed: WHO incidence rate × population.')],
  },
  {
    id: 'hiv-infections',
    meta: {
      category: 'demography-health',
      name: t('New HIV infections', 'Nuove infezioni da HIV'),
      description: t('Adults and children newly infected with HIV (UNAIDS estimates).', 'Adulti e bambini con nuova infezione da HIV (stime UNAIDS).'),
      unit: 'count',
      unitLabel: t('infections', 'infezioni'),
      kind: 'flow',
      visual: { color: '#ff5470', icon: 'ribbon', scale: 'sqrt' },
    },
    sources: { wdi: WDI('SH.HIV.INCD', 'Adults and children newly infected with HIV') },
    tables: () => [yearly(worldBank('SH.HIV.INCD'), 'wdi', 'estimate')],
  },
  {
    id: 'under5-deaths',
    meta: {
      category: 'demography-health',
      name: t('Deaths of children under 5', 'Morti di bambini sotto i 5 anni'),
      description: t(
        'Deaths of children before their fifth birthday (UN Inter-agency Group for Child Mortality Estimation).',
        'Decessi di bambini prima del quinto compleanno (UN Inter-agency Group for Child Mortality Estimation).',
      ),
      unit: 'count',
      unitLabel: t('children', 'bambini'),
      kind: 'flow',
      visual: { color: '#b39cff', icon: 'child', scale: 'sqrt' },
    },
    sources: { wdi: WDI('SH.DTH.MORT', 'Number of under-five deaths') },
    tables: () => [yearly(worldBank('SH.DTH.MORT'), 'wdi', 'estimate')],
  },

  {
    id: 'refugees',
    meta: {
      category: 'demography-health',
      name: t('Refugees hosted', 'Rifugiati accolti'),
      description: t(
        'Refugees under UNHCR’s mandate by country of asylum. A level, not a flow: how many people live as refugees in each country.',
        'Rifugiati sotto mandato UNHCR per paese d’asilo. È un livello, non un flusso: quante persone vivono come rifugiati in ogni paese.',
      ),
      unit: 'count',
      unitLabel: t('refugees', 'rifugiati'),
      kind: 'stock',
      visual: { color: '#ffb3e6', icon: 'users', scale: 'sqrt' },
    },
    sources: { unhcr: OWID_SRC('refugee-population-by-country-or-territory-of-asylum', 'Refugee Population Statistics – refugees by country of asylum', 'UNHCR') },
    tables: () => [level(withoutWorld(owidGrapher('refugee-population-by-country-or-territory-of-asylum', 'refugees')), 'unhcr', 'official')],
  },

  // ============================================================== environment & energy
  {
    id: 'tree-cover-loss',
    meta: {
      category: 'environment-energy',
      name: t('Tree cover lost', 'Copertura arborea persa'),
      description: t(
        'Area of tree cover lost to clearing, logging, fires and other disturbances (University of Maryland / Global Forest Watch). Includes temporary loss, so it is not the same as permanent deforestation.',
        'Superficie di copertura arborea persa per disboscamento, taglio, incendi e altri disturbi (University of Maryland / Global Forest Watch). Include perdite temporanee, quindi non coincide con la deforestazione permanente.',
      ),
      unit: 'hectare',
      unitLabel: t('hectares', 'ettari'),
      kind: 'flow',
      visual: { color: '#48e08b', icon: 'tree', scale: 'sqrt' },
      featured: true,
    },
    sources: { gfw: OWID_SRC('tree-cover-loss', 'Global Forest Watch – tree cover loss', 'University of Maryland / World Resources Institute') },
    tables: () => [yearly(owidGrapher('tree-cover-loss'), 'gfw', 'official')],
  },
  {
    id: 'co2-emissions',
    meta: {
      category: 'environment-energy',
      name: t('CO₂ emitted', 'CO₂ emessa'),
      description: t(
        'Fossil-fuel and industry CO₂ emissions (excluding land-use change), territorial, from the Global Carbon Budget. Countries without data share the remainder by GDP.',
        'Emissioni di CO₂ da combustibili fossili e industria (escluso il cambio d’uso del suolo), territoriali, dal Global Carbon Budget. I paesi senza dati si ripartiscono il resto per PIL.',
      ),
      unit: 'tonne',
      unitLabel: t('tonnes of CO₂', 'tonnellate di CO₂'),
      kind: 'flow',
      allocation: { proxy: 'gdp' },
      visual: { color: '#b0ff6a', icon: 'factory', scale: 'sqrt' },
      featured: true,
    },
    sources: { gcb: src('owid-co2-data', 'Global Carbon Budget – national fossil CO₂ emissions (OWID CO₂ dataset)', 'Global Carbon Project', 'https://github.com/owid/co2-data') },
    tables: () => [yearly(mapValues(owidDataset('owid-co2-data.csv', 'co2'), (v) => v * 1e6), 'gcb', 'official')],
  },
  {
    id: 'methane-emissions',
    meta: {
      category: 'environment-energy',
      name: t('Methane emitted', 'Metano emesso'),
      description: t(
        'Methane emissions from all sectors, in tonnes of CO₂-equivalent (100-year warming potential), from Jones et al. via the OWID CO₂ dataset.',
        'Emissioni di metano da tutti i settori, in tonnellate di CO₂ equivalente (potenziale di riscaldamento a 100 anni), da Jones et al. tramite il dataset CO₂ di OWID.',
      ),
      unit: 'tonne',
      unitLabel: t('tonnes CO₂-eq', 'tonnellate CO₂-eq'),
      kind: 'flow',
      allocation: { proxy: 'population' },
      visual: { color: '#d9ff7a', icon: 'flame', scale: 'sqrt' },
    },
    sources: { owid: src('owid-co2-data', 'National contributions to climate change – methane (OWID CO₂ dataset)', 'Jones et al. / Our World in Data', 'https://github.com/owid/co2-data') },
    tables: () => [yearly(mapValues(owidDataset('owid-co2-data.csv', 'methane'), (v) => v * 1e6), 'owid', 'estimate')],
  },
  ...electricity(),
  {
    id: 'primary-energy',
    meta: {
      category: 'environment-energy',
      name: t('Energy consumed', 'Energia consumata'),
      description: t(
        'Primary energy consumption from all sources (Energy Institute Statistical Review & EIA via OWID energy dataset; substitution method).',
        'Consumo di energia primaria da tutte le fonti (Energy Institute Statistical Review ed EIA tramite il dataset energia di OWID; metodo di sostituzione).',
      ),
      unit: 'TWh',
      unitLabel: t('energy', 'energia'),
      kind: 'flow',
      allocation: { proxy: 'gdp' },
      visual: { color: '#ffcf70', icon: 'bolt', scale: 'sqrt' },
    },
    sources: { owid: ENERGY() },
    tables: () => [yearly(owidDataset('owid-energy-data.csv', 'primary_energy_consumption'), 'owid', 'official')],
  },
  {
    id: 'oil-consumed',
    meta: {
      category: 'environment-energy',
      name: t('Oil burned', 'Petrolio consumato'),
      description: t(
        'Oil consumption (Energy Institute via OWID), converted from energy to barrels at ≈1.59 MWh per barrel. Remaining countries share the rest by GDP.',
        'Consumo di petrolio (Energy Institute tramite OWID), convertito da energia a barili a ≈1,59 MWh per barile. Gli altri paesi si ripartiscono il resto per PIL.',
      ),
      unit: 'barrel',
      unitLabel: t('barrels', 'barili'),
      kind: 'flow',
      allocation: { proxy: 'gdp' },
      visual: { color: '#ffae42', icon: 'barrel', scale: 'sqrt' },
      featured: true,
    },
    sources: { owid: ENERGY() },
    tables: () => [
      yearly(mapValues(owidDataset('owid-energy-data.csv', 'oil_consumption'), (v) => v / TWH_PER_BARREL), 'owid', 'estimate', 'Converted from TWh at ≈1.587 MWh per barrel.'),
    ],
  },
  {
    id: 'gas-consumed',
    meta: {
      category: 'environment-energy',
      name: t('Natural gas burned', 'Gas naturale consumato'),
      description: t(
        'Natural gas consumption (Energy Institute via OWID), converted from energy to cubic metres at ≈10 kWh per m³. Remaining countries share the rest by GDP.',
        'Consumo di gas naturale (Energy Institute tramite OWID), convertito da energia a metri cubi a ≈10 kWh per m³. Gli altri paesi si ripartiscono il resto per PIL.',
      ),
      unit: 'm3',
      unitLabel: t('cubic metres', 'metri cubi'),
      kind: 'flow',
      allocation: { proxy: 'gdp' },
      visual: { color: '#7cc6ff', icon: 'gas', scale: 'sqrt' },
    },
    sources: { owid: ENERGY() },
    tables: () => [
      yearly(mapValues(owidDataset('owid-energy-data.csv', 'gas_consumption'), (v) => (v * 1e9) / KWH_PER_M3_GAS), 'owid', 'estimate', 'Converted from TWh at ≈10 kWh per m³.'),
    ],
  },
  {
    id: 'meat-produced',
    meta: {
      category: 'environment-energy',
      name: t('Meat produced', 'Carne prodotta'),
      description: t('Meat production, all species (FAOSTAT).', 'Produzione di carne, tutte le specie (FAOSTAT).'),
      unit: 'tonne',
      unitLabel: t('tonnes of meat', 'tonnellate di carne'),
      kind: 'flow',
      allocation: { proxy: 'population' },
      visual: { color: '#ff8fa3', icon: 'meat', scale: 'sqrt' },
    },
    sources: { fao: OWID_SRC('meat-production-tonnes', 'FAOSTAT – meat production', 'Food and Agriculture Organization of the UN') },
    tables: () => [yearly(owidGrapher('meat-production-tonnes'), 'fao', 'official')],
  },
  {
    id: 'fish-caught',
    meta: {
      category: 'environment-energy',
      name: t('Wild fish caught', 'Pesce pescato'),
      description: t(
        'Capture fisheries production: wild fish and other aquatic animals landed (FAO via World Bank); excludes aquaculture.',
        'Produzione della pesca di cattura: pesci e altri animali acquatici sbarcati (FAO tramite Banca Mondiale); esclusa l’acquacoltura.',
      ),
      unit: 'tonne',
      unitLabel: t('tonnes of fish', 'tonnellate di pesce'),
      kind: 'flow',
      visual: { color: '#5ecbff', icon: 'fish', scale: 'sqrt' },
    },
    sources: { wdi: WDI('ER.FSH.CAPT.MT', 'Capture fisheries production (metric tons)') },
    tables: () => [yearly(worldBank('ER.FSH.CAPT.MT'), 'wdi', 'official')],
  },
  {
    id: 'fish-farmed',
    meta: {
      category: 'environment-energy',
      name: t('Fish farmed', 'Pesce allevato'),
      description: t('Aquaculture production of fish and other aquatic animals (FAO via World Bank).', 'Produzione dell’acquacoltura di pesci e altri animali acquatici (FAO tramite Banca Mondiale).'),
      unit: 'tonne',
      unitLabel: t('tonnes of fish', 'tonnellate di pesce'),
      kind: 'flow',
      visual: { color: '#3fd0c9', icon: 'fish', scale: 'sqrt' },
    },
    sources: { wdi: WDI('ER.FSH.AQUA.MT', 'Aquaculture production (metric tons)') },
    tables: () => [yearly(worldBank('ER.FSH.AQUA.MT'), 'wdi', 'official')],
  },
  {
    id: 'plastic-produced',
    meta: {
      category: 'environment-energy',
      name: t('Plastic produced', 'Plastica prodotta'),
      description: t(
        'Global plastics production including additives and fibres (Geyer et al. and OECD Global Plastics Outlook, via OWID). The latest measured year is 2019.',
        'Produzione mondiale di plastica inclusi additivi e fibre (Geyer et al. e OECD Global Plastics Outlook, tramite OWID). L’ultimo anno misurato è il 2019.',
      ),
      unit: 'tonne',
      unitLabel: t('tonnes of plastic', 'tonnellate di plastica'),
      kind: 'flow',
      allocation: { proxy: 'gdp' },
      resolution: { maxYearGap: 7 },
      visual: { color: '#6ff7e8', icon: 'box', scale: 'sqrt' },
    },
    sources: { oecd: OWID_SRC('global-plastics-production', 'Global plastics production', 'Geyer et al. (2017); OECD Global Plastics Outlook') },
    tables: () => [yearly(onlyWorld(owidGrapher('global-plastics-production')), 'oecd', 'estimate')],
  },
  {
    id: 'water-withdrawn',
    meta: {
      category: 'environment-energy',
      name: t('Fresh water withdrawn', 'Acqua dolce prelevata'),
      description: t(
        'Annual freshwater withdrawals for agriculture, industry and municipalities (FAO AQUASTAT via World Bank). Countries report in different years; the engine carries values forward and flags them.',
        'Prelievi annui di acqua dolce per agricoltura, industria e usi civili (FAO AQUASTAT tramite Banca Mondiale). I paesi comunicano in anni diversi; il motore riporta i valori in avanti segnalandolo.',
      ),
      unit: 'm3',
      unitLabel: t('cubic metres', 'metri cubi'),
      kind: 'flow',
      resolution: { maxYearGap: 10 },
      visual: { color: '#4fc3ff', icon: 'water', scale: 'sqrt' },
    },
    sources: { wdi: WDI('ER.H2O.FWTL.K3', 'Annual freshwater withdrawals, total (billion cubic meters)') },
    tables: () => [yearly(mapValues(worldBank('ER.H2O.FWTL.K3'), (v) => v * 1e9), 'wdi', 'official')],
  },
  {
    id: 'earthquakes',
    meta: {
      category: 'environment-energy',
      name: t('Earthquakes (M5+)', 'Terremoti (M5+)'),
      description: t(
        'Earthquakes of magnitude 5 or more recorded in the USGS ComCat catalogue each year. Not placed on countries (most occur offshore along plate boundaries).',
        'Terremoti di magnitudo 5 o superiore registrati ogni anno nel catalogo USGS ComCat. Non assegnati ai paesi (la maggior parte avviene in mare lungo i margini di placca).',
      ),
      unit: 'count',
      unitLabel: t('earthquakes', 'terremoti'),
      kind: 'flow',
      visual: { color: '#ff9f43', icon: 'quake', scale: 'linear' },
    },
    sources: { usgs: src('usgs-m5-counts', 'ANSS Comprehensive Earthquake Catalog (ComCat) – event counts, M ≥ 5', 'US Geological Survey', 'https://earthquake.usgs.gov/fdsnws/event/1/') },
    tables: () => [yearly(usgsCounts(), 'usgs', 'official')],
  },

  // ============================================================== consumption & production
  {
    id: 'ev-sales',
    meta: {
      category: 'consumer',
      name: t('Electric cars sold', 'Auto elettriche vendute'),
      description: t(
        'New battery-electric and plug-in hybrid cars sold (IEA Global EV Outlook via OWID). Countries outside the IEA coverage are unallocated.',
        'Auto nuove elettriche e ibride plug-in vendute (IEA Global EV Outlook tramite OWID). I paesi fuori dalla copertura IEA non sono allocati.',
      ),
      unit: 'count',
      unitLabel: t('electric cars', 'auto elettriche'),
      kind: 'flow',
      temporalProfile: 'localDaytime',
      visual: { color: '#6dffb0', icon: 'car', scale: 'sqrt' },
      featured: true,
    },
    sources: { iea: OWID_SRC('electric-car-sales', 'Global EV Outlook – electric car sales', 'International Energy Agency') },
    tables: () => [yearly(owidGrapher('electric-car-sales'), 'iea', 'official')],
  },
  {
    id: 'coffee-harvested',
    meta: {
      category: 'consumer',
      name: t('Coffee harvested', 'Caffè raccolto'),
      description: t('Green coffee production (FAOSTAT).', 'Produzione di caffè verde (FAOSTAT).'),
      unit: 'tonne',
      unitLabel: t('tonnes of coffee', 'tonnellate di caffè'),
      kind: 'flow',
      visual: { color: '#c08a5b', icon: 'coffee', scale: 'sqrt' },
    },
    sources: { fao: OWID_SRC('coffee-bean-production', 'FAOSTAT – green coffee production', 'Food and Agriculture Organization of the UN') },
    tables: () => [yearly(owidGrapher('coffee-bean-production'), 'fao', 'official')],
  },
  {
    id: 'cocoa-harvested',
    meta: {
      category: 'consumer',
      name: t('Cocoa beans harvested', 'Cacao raccolto'),
      description: t(
        'Cocoa bean production (FAOSTAT) — the raw material of chocolate; two thirds come from West Africa.',
        'Produzione di fave di cacao (FAOSTAT), la materia prima del cioccolato; due terzi vengono dall’Africa occidentale.',
      ),
      unit: 'tonne',
      unitLabel: t('tonnes of cocoa', 'tonnellate di cacao'),
      kind: 'flow',
      visual: { color: '#b87755', icon: 'bean', scale: 'sqrt' },
    },
    sources: { fao: OWID_SRC('cocoa-bean-production', 'FAOSTAT – cocoa bean production', 'Food and Agriculture Organization of the UN') },
    tables: () => [yearly(owidGrapher('cocoa-bean-production'), 'fao', 'official')],
  },
  {
    id: 'wine-produced',
    meta: {
      category: 'consumer',
      name: t('Wine produced', 'Vino prodotto'),
      description: t('Wine production (FAOSTAT, tonnes; 1 tonne ≈ 1,000 litres).', 'Produzione di vino (FAOSTAT, tonnellate; 1 tonnellata ≈ 1.000 litri).'),
      unit: 'tonne',
      unitLabel: t('tonnes of wine', 'tonnellate di vino'),
      kind: 'flow',
      visual: { color: '#d8486f', icon: 'wine', scale: 'sqrt' },
    },
    sources: { fao: OWID_SRC('wine-production', 'FAOSTAT – wine production', 'Food and Agriculture Organization of the UN') },
    tables: () => [yearly(owidGrapher('wine-production'), 'fao', 'official')],
  },

  // ============================================================== digital & science
  {
    id: 'bitcoin-transactions',
    meta: {
      category: 'digital',
      name: t('Bitcoin transactions', 'Transazioni Bitcoin'),
      description: t(
        'Confirmed on-chain Bitcoin transactions, yearly average per day (Blockchain.com). Not geolocatable, so not placed on countries.',
        'Transazioni Bitcoin confermate on-chain, media giornaliera annua (Blockchain.com). Non geolocalizzabili, quindi non assegnate ai paesi.',
      ),
      unit: 'count',
      unitLabel: t('transactions', 'transazioni'),
      kind: 'flow',
      visual: { color: '#f7931a', icon: 'bitcoin', scale: 'linear' },
    },
    sources: { bc: src('blockchain-n-transactions', 'Confirmed transactions per day', 'Blockchain.com', 'https://www.blockchain.com/explorer/charts/n-transactions') },
    tables: () => [toTable(blockchainDailyAverage(), { sourceId: 'bc', confidence: 'official', period: 'day', note: 'Yearly average of daily counts.' })],
  },
  {
    id: 'patents-filed',
    meta: {
      category: 'digital',
      name: t('Patent applications', 'Domande di brevetto'),
      description: t(
        'Patent applications filed at national patent offices, residents plus non-residents (WIPO via World Bank).',
        'Domande di brevetto depositate presso gli uffici nazionali, residenti e non residenti (OMPI tramite Banca Mondiale).',
      ),
      unit: 'count',
      unitLabel: t('applications', 'domande'),
      kind: 'flow',
      temporalProfile: 'localDaytime',
      visual: { color: '#ffe27a', icon: 'bulb', scale: 'sqrt' },
    },
    sources: {
      wdi: src(
        'wb-IP.PAT.RESD',
        'World Development Indicators – Patent applications, residents (IP.PAT.RESD) + nonresidents (IP.PAT.NRES)',
        'World Bank / WIPO',
        'https://data.worldbank.org/indicator/IP.PAT.RESD',
      ),
    },
    tables: () => [
      yearly(combine(worldBank('IP.PAT.RESD'), worldBank('IP.PAT.NRES'), (a, b) => a + b), 'wdi', 'official', 'Residents + non-residents.'),
    ],
  },
  {
    id: 'scientific-articles',
    meta: {
      category: 'digital',
      name: t('Scientific articles published', 'Articoli scientifici pubblicati'),
      description: t(
        'Scientific and technical journal articles (National Science Foundation, based on Scopus, via World Bank), by authors’ country.',
        'Articoli su riviste scientifiche e tecniche (National Science Foundation, su base Scopus, tramite Banca Mondiale), per paese degli autori.',
      ),
      unit: 'count',
      unitLabel: t('articles', 'articoli'),
      kind: 'flow',
      temporalProfile: 'localDaytime',
      visual: { color: '#9fd2ff', icon: 'book', scale: 'sqrt' },
    },
    sources: { wdi: WDI('IP.JRN.ARTC.SC', 'Scientific and technical journal articles') },
    tables: () => [yearly(worldBank('IP.JRN.ARTC.SC'), 'wdi', 'official')],
  },

  // ============================================================== economy
  {
    id: 'tourist-arrivals',
    meta: {
      category: 'economy',
      name: t('International tourist arrivals', 'Arrivi turistici internazionali'),
      description: t(
        'Overnight international visitors arriving in each country (UN Tourism, via Our World in Data). The world value is the sum of reporting countries. The latest complete year (2021) is still depressed by COVID-19 travel restrictions: later years are added once most countries have reported.',
        'Visitatori internazionali con pernottamento arrivati in ogni paese (UN Tourism, tramite Our World in Data). Il valore mondiale è la somma dei paesi che comunicano i dati. L’ultimo anno completo (2021) risente ancora delle restrizioni COVID-19: gli anni successivi verranno aggiunti quando la maggior parte dei paesi li avrà comunicati.',
      ),
      unit: 'count',
      unitLabel: t('arrivals', 'arrivi'),
      kind: 'flow',
      visual: { color: '#ffcf5c', icon: 'suitcase', scale: 'sqrt' },
    },
    sources: { unt: OWID_SRC('international-tourist-trips', 'Inbound tourism – overnight visitors (tourists)', 'UN Tourism') },
    tables: () => [yearly(withoutWorld(owidGrapher('international-tourist-trips', 'in_tour_arrivals_trips_total_overnight_vis_tourists')), 'unt', 'official')],
  },
  {
    id: 'air-passengers',
    meta: {
      category: 'economy',
      name: t('Air passengers', 'Passeggeri aerei'),
      description: t(
        'Passengers carried by airlines registered in each country (ICAO via World Bank).',
        'Passeggeri trasportati dalle compagnie aeree registrate in ogni paese (ICAO tramite Banca Mondiale).',
      ),
      unit: 'count',
      unitLabel: t('passengers', 'passeggeri'),
      kind: 'flow',
      temporalProfile: 'waking',
      visual: { color: '#9ad0ff', icon: 'plane', scale: 'sqrt' },
      featured: true,
    },
    sources: { wdi: WDI('IS.AIR.PSGR', 'Air transport, passengers carried') },
    tables: () => [yearly(worldBank('IS.AIR.PSGR'), 'wdi', 'official')],
  },
  {
    id: 'containers-shipped',
    meta: {
      category: 'economy',
      name: t('Shipping containers handled', 'Container movimentati'),
      description: t(
        'Container port traffic in twenty-foot equivalent units (UNCTAD / Lloyd’s via World Bank).',
        'Traffico container nei porti in TEU (UNCTAD / Lloyd’s tramite Banca Mondiale).',
      ),
      unit: 'teu',
      unitLabel: t('containers (TEU)', 'container (TEU)'),
      kind: 'flow',
      visual: { color: '#ff9966', icon: 'ship', scale: 'sqrt' },
    },
    sources: { wdi: WDI('IS.SHP.GOOD.TU', 'Container port traffic (TEU: 20 foot equivalent units)') },
    tables: () => [yearly(worldBank('IS.SHP.GOOD.TU'), 'wdi', 'official')],
  },
  {
    id: 'merchandise-exports',
    meta: {
      category: 'economy',
      name: t('Goods exported', 'Merci esportate'),
      description: t('Value of merchandise exports (WTO via World Bank).', 'Valore delle esportazioni di merci (OMC tramite Banca Mondiale).'),
      unit: 'usd',
      unitLabel: t('US dollars of goods', 'dollari USA di merci'),
      kind: 'flow',
      temporalProfile: 'localDaytime',
      allocation: { proxy: 'gdp' },
      visual: { color: '#ffe08a', icon: 'export', scale: 'sqrt' },
    },
    sources: { wdi: WDI('TX.VAL.MRCH.CD.WT', 'Merchandise exports (current US$)') },
    tables: () => [yearly(worldBank('TX.VAL.MRCH.CD.WT'), 'wdi', 'official')],
  },
  {
    id: 'military-spending',
    meta: {
      category: 'economy',
      name: t('Military spending', 'Spesa militare'),
      description: t('Military expenditure in current US dollars (SIPRI via World Bank).', 'Spesa militare in dollari USA correnti (SIPRI tramite Banca Mondiale).'),
      unit: 'usd',
      unitLabel: t('US dollars', 'dollari USA'),
      kind: 'flow',
      visual: { color: '#ff7a59', icon: 'shield', scale: 'sqrt' },
      featured: true,
    },
    sources: { wdi: WDI('MS.MIL.XPND.CD', 'Military expenditure (current USD)') },
    tables: () => [yearly(worldBank('MS.MIL.XPND.CD'), 'wdi', 'official')],
  },
  {
    id: 'remittances',
    meta: {
      category: 'economy',
      name: t('Money sent home by migrants', 'Rimesse dei migranti'),
      description: t(
        'Personal remittances received by each country (World Bank / IMF balance of payments).',
        'Rimesse personali ricevute da ogni paese (Banca Mondiale / bilancia dei pagamenti FMI).',
      ),
      unit: 'usd',
      unitLabel: t('US dollars', 'dollari USA'),
      kind: 'flow',
      visual: { color: '#ffd98a', icon: 'dollar', scale: 'sqrt' },
    },
    sources: { wdi: WDI('BX.TRF.PWKR.CD.DT', 'Personal remittances, received (current US$)') },
    tables: () => [yearly(worldBank('BX.TRF.PWKR.CD.DT'), 'wdi', 'official', undefined, 2024)], // 2025 world total is still preliminary
  },
];

function ENERGY() {
  return src('owid-energy-data', 'Energy dataset (Ember, Energy Institute Statistical Review, EIA)', 'Our World in Data / Ember / Energy Institute', 'https://github.com/owid/energy-data');
}

function electricity() {
  const col = (c) => owidDataset('owid-energy-data.csv', c);
  const base = (id, column, name, description, color, icon, extra = {}) => ({
    id,
    meta: {
      category: 'environment-energy',
      name,
      description,
      unit: 'TWh',
      unitLabel: extra.unitLabel ?? t('electricity', 'elettricità'),
      kind: 'flow',
      ...(extra.temporalProfile ? { temporalProfile: extra.temporalProfile } : {}),
      ...(extra.allocation ? { allocation: extra.allocation } : {}),
      visual: { color, icon, scale: 'sqrt' },
      ...(extra.featured ? { featured: true } : {}),
    },
    sources: { owid: ENERGY() },
    tables: () => [yearly(col(column), 'owid', 'official')],
  });
  const DEMAND = { hourly: [0.82, 0.78, 0.76, 0.75, 0.76, 0.8, 0.9, 1.02, 1.1, 1.12, 1.13, 1.13, 1.12, 1.12, 1.12, 1.11, 1.1, 1.12, 1.15, 1.14, 1.1, 1.02, 0.93, 0.86] };
  const SUN = { hourly: [0, 0, 0, 0, 0, 0.05, 0.4, 1.2, 2.2, 3.1, 3.8, 4.2, 4.3, 4.1, 3.6, 2.9, 2.0, 1.1, 0.4, 0.05, 0, 0, 0, 0] };
  return [
    base(
      'electricity-generated',
      'electricity_generation',
      t('Electricity generated', 'Elettricità prodotta'),
      t(
        'Electricity generated from all sources (Ember and Energy Institute via OWID). The daily curve is a stylized demand profile (night trough, evening peak).',
        'Elettricità prodotta da tutte le fonti (Ember ed Energy Institute tramite OWID). La curva giornaliera è un profilo di domanda stilizzato (minimo notturno, picco serale).',
      ),
      '#ffe066',
      'bolt',
      { temporalProfile: DEMAND, allocation: { proxy: 'gdp' }, featured: true },
    ),
    base(
      'solar-generated',
      'solar_electricity',
      t('Solar electricity', 'Elettricità solare'),
      t('Electricity generated by solar power. Follows the local sun: zero at night, peak at noon.', 'Elettricità prodotta dal solare. Segue il sole locale: zero di notte, picco a mezzogiorno.'),
      '#ffd000',
      'sun',
      { temporalProfile: SUN, featured: true, unitLabel: t('solar power', 'energia solare') },
    ),
    base(
      'wind-generated',
      'wind_electricity',
      t('Wind electricity', 'Elettricità eolica'),
      t('Electricity generated by wind turbines (onshore and offshore).', 'Elettricità prodotta dalle turbine eoliche (a terra e in mare).'),
      '#8ff0ff',
      'wind',
      { unitLabel: t('wind power', 'energia eolica') },
    ),
    base(
      'hydro-generated',
      'hydro_electricity',
      t('Hydropower', 'Energia idroelettrica'),
      t('Electricity generated by hydropower plants.', 'Elettricità prodotta dalle centrali idroelettriche.'),
      '#4fa8ff',
      'droplet',
      { unitLabel: t('hydropower', 'energia idroelettrica') },
    ),
    base(
      'coal-generated',
      'coal_electricity',
      t('Coal power', 'Elettricità da carbone'),
      t('Electricity generated by burning coal.', 'Elettricità prodotta bruciando carbone.'),
      '#ff7b54',
      'flame',
      { temporalProfile: DEMAND, unitLabel: t('coal power', 'energia da carbone') },
    ),
    base(
      'nuclear-generated',
      'nuclear_electricity',
      t('Nuclear power', 'Energia nucleare'),
      t('Electricity generated by nuclear reactors.', 'Elettricità prodotta dai reattori nucleari.'),
      '#9dff8a',
      'atom',
      { unitLabel: t('nuclear power', 'energia nucleare') },
    ),
  ];
}
