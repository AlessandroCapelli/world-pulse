// Validates every bundled dataset against the shared zod schema and reports coverage.
// Run: npm run data:validate   (exit code 1 on any error)
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  countriesFileSchema,
  describeIssues,
  manifestSchema,
  metricFileSchema,
} from '../src/app/core/data/schema';
import { latestYear, resolveMetric, yearRange } from '../src/app/core/engine/resolve';
import { allPoints } from '../src/app/core/engine/series';
import { ICON_IDS } from '../src/app/shared/icons/icon-ids';
import type { MetricFile } from '../src/app/core/engine/types';

const root = join(__dirname, '..');
const dataDir = join(root, 'public', 'data');
const MAX_FILE_BYTES = 5 * 1024 * 1024;

let errors = 0;
let warnings = 0;
const error = (msg: string) => {
  errors++;
  console.error(`  ✖ ${msg}`);
};
const warn = (msg: string) => {
  warnings++;
  console.warn(`  ⚠ ${msg}`);
};

function readJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_FILE_BYTES) error(`${path} is ${(size / 1024 / 1024).toFixed(1)} MB (budget 5 MB)`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Budget check for every data file, including geo.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}
for (const f of walk(dataDir)) {
  if (statSync(f).size > MAX_FILE_BYTES) error(`${f} exceeds the 5 MB budget`);
}

console.log('World Pulse – data validation\n');

const manifestResult = manifestSchema.safeParse(readJson(join(dataDir, 'manifest.json')));
if (!manifestResult.success) {
  describeIssues(manifestResult.error).forEach((m) => error(`manifest: ${m}`));
  process.exit(1);
}
const manifest = manifestResult.data;

const countriesResult = countriesFileSchema.safeParse(readJson(join(dataDir, 'geo', 'countries.json')));
if (!countriesResult.success) {
  describeIssues(countriesResult.error).forEach((m) => error(`countries.json: ${m}`));
  process.exit(1);
}
const countryCodes = new Set(countriesResult.data.countries.map((c) => c.iso3));
const disputed = new Set(countriesResult.data.countries.filter((c) => c.disputed).map((c) => c.iso3));

function load(kind: 'metrics' | 'proxies', id: string): MetricFile | null {
  const path = join(dataDir, kind, `${id}.json`);
  if (!existsSync(path)) {
    error(`${kind}/${id}.json listed in manifest but missing`);
    return null;
  }
  const parsed = metricFileSchema.safeParse(readJson(path));
  if (!parsed.success) {
    describeIssues(parsed.error).forEach((m) => error(`${kind}/${id}.json → ${m}`));
    return null;
  }
  if (parsed.data.id !== id) error(`${kind}/${id}.json has id "${parsed.data.id}"`);
  return parsed.data;
}

const proxies = new Map<string, MetricFile>();
for (const id of manifest.proxies) {
  const m = load('proxies', id);
  if (m) proxies.set(id, m);
}
const metrics: MetricFile[] = [];
for (const id of manifest.metrics) {
  if (manifest.proxies.includes(id)) error(`"${id}" is listed both as metric and proxy`);
  const m = load('metrics', id);
  if (m) metrics.push(m);
}
if (!manifest.metrics.includes(manifest.defaultMetric) && !manifest.proxies.includes(manifest.defaultMetric)) {
  error(`defaultMetric "${manifest.defaultMetric}" is not listed`);
}
const dupes = manifest.metrics.filter((id, i) => manifest.metrics.indexOf(id) !== i);
dupes.forEach((d) => error(`duplicate manifest entry "${d}"`));

const ctx = {
  proxies,
  countryCodes: [...countryCodes],
  noAllocation: disputed,
  coverageProxy: 'population',
};

console.log('metric'.padEnd(28), 'years'.padEnd(11), 'latest'.padEnd(7), 'countries'.padEnd(10), 'coverage', ' confidence');
for (const m of [...proxies.values(), ...metrics]) {
  for (const p of allPoints(m)) {
    if (p.scope !== 'world' && !countryCodes.has(p.scope)) warn(`${m.id}: scope ${p.scope} is not on the map (counted in totals only)`);
  }
  if (m.allocation && !proxies.has(m.allocation.proxy)) error(`${m.id}: allocation proxy "${m.allocation.proxy}" not found`);
  if (m.visual?.icon && !ICON_IDS.includes(m.visual.icon)) error(`${m.id}: unknown icon "${m.visual.icon}"`);
  const range = yearRange(m)!;
  const latest = latestYear(m)!;
  const snap = resolveMetric(m, latest, ctx);
  snap.warnings.forEach((w) => warn(`${m.id} @${latest}: ${w}`));
  const reported = snap.countries.filter((c) => c.provenance !== 'allocated').length;
  const conf = [...new Set(allPoints(m).map((p) => p.confidence))].join('/');
  console.log(
    m.id.padEnd(28),
    `${range.min}–${range.max}`.padEnd(11),
    String(latest).padEnd(7),
    String(reported).padEnd(10),
    `${snap.coveragePct.toFixed(0)}% (${snap.coverageBasis})`.padEnd(15),
    conf,
  );
}

console.log(`\n${metrics.length} metrics, ${proxies.size} proxies, ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
