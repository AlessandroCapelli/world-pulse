// Registry of public datasets downloaded by `npm run data:fetch` (development time only —
// the app itself never calls these APIs). Files land in data-raw/ (git-ignored).
import { EXTRA_WB_INDICATORS } from './expanded-indicators.mjs';

const WB = (indicator) => ({
  id: `wb-${indicator}`,
  kind: 'worldbank',
  url: `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=1995:2026`,
  file: `wb-${indicator}.json`,
});

const OWID = (slug) => ({
  id: `owid-${slug}`,
  kind: 'owid-grapher',
  url: `https://ourworldindata.org/grapher/${slug}.csv?v=1&csvType=full&useColumnShortNames=true`,
  file: `owid-${slug}.csv`,
});

const GHO = (indicator) => ({
  id: `gho-${indicator}`,
  kind: 'gho',
  url: `https://ghoapi.azureedge.net/api/${indicator}`,
  file: `gho-${indicator}.json`,
});

export const WB_INDICATORS = [
  'SP.POP.TOTL', // population
  'NY.GDP.MKTP.CD', // GDP, current US$
  'IT.NET.USER.ZS', // internet users, % of population
  'AG.LND.TOTL.K2', // land area, km²
  'SH.TBS.INCD', // TB incidence per 100,000
  'SH.HIV.INCD', // new HIV infections (number)
  'SH.DTH.MORT', // under-5 deaths (number)
  'IS.AIR.PSGR', // air passengers carried
  'IS.SHP.GOOD.TU', // container port traffic (TEU)
  'TX.VAL.MRCH.CD.WT', // merchandise exports, current US$
  'MS.MIL.XPND.CD', // military expenditure, current US$
  'BX.TRF.PWKR.CD.DT', // personal remittances received, current US$
  'IP.PAT.RESD', // patent applications, residents
  'IP.PAT.NRES', // patent applications, non-residents
  'IP.JRN.ARTC.SC', // scientific and technical journal articles
  'ER.FSH.CAPT.MT', // capture fisheries production (t)
  'ER.FSH.AQUA.MT', // aquaculture production (t)
  'ER.H2O.FWTL.K3', // annual freshwater withdrawals (billion m³)
];

export const OWID_SLUGS = [
  'number-of-births-per-year',
  'number-of-deaths-per-year',
  'meat-production-tonnes',
  'electric-car-sales',
  'global-plastics-production',
  'coffee-bean-production',
  'cocoa-bean-production',
  'wine-production',
  'international-tourist-trips',
  'refugee-population-by-country-or-territory-of-asylum',
  'tree-cover-loss',
];

export const GHO_INDICATORS = ['MALARIA_EST_CASES', 'MALARIA_EST_DEATHS', 'RS_196'];

export const SOURCES = [
  ...WB_INDICATORS.map((code) => ({
    ...WB(code),
    ...(EXTRA_WB_INDICATORS.includes(code) ? { group: 'expanded' } : {}),
  })),
  ...EXTRA_WB_INDICATORS.filter((code) => !WB_INDICATORS.includes(code)).map((code) => ({
    ...WB(code),
    group: 'expanded',
  })),
  ...OWID_SLUGS.map(OWID),
  ...GHO_INDICATORS.map(GHO),
  {
    id: 'owid-co2-data',
    kind: 'owid-dataset',
    url: 'https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv',
    file: 'owid-co2-data.csv',
  },
  {
    id: 'owid-energy-data',
    kind: 'owid-dataset',
    url: 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv',
    file: 'owid-energy-data.csv',
  },
  {
    id: 'blockchain-n-transactions',
    kind: 'blockchain',
    url: 'https://api.blockchain.info/charts/n-transactions?timespan=all&format=json&sampled=false',
    file: 'blockchain-n-transactions.json',
  },
  // USGS: one count request per year (see fetch.mjs).
  { id: 'usgs-m5-counts', kind: 'usgs', url: 'https://earthquake.usgs.gov/fdsnws/event/1/count', file: 'usgs-m5-counts.json' },
];
