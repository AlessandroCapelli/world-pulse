// Builds the ETL-managed metric files from data-raw/ (see metrics.mjs) and updates the manifest.
// Hand-curated metric files are left untouched. Usage: npm run data:build [-- --only <id>]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, TRIMMED } from './lib.mjs';
import { DEFINITIONS } from './metrics.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

/** Pretty JSON that keeps each table row on a single line (readable diffs, compact files). */
function stringify(obj) {
  return JSON.stringify(obj, null, 1).replace(/\[\n\s+([\s\S]*?)\n\s+\]/g, (m, body) =>
    /^[-\d.eE+,\snul]*$/.test(body) ? `[${body.replace(/\s+/g, ' ').replace(/ ,/g, ',')}]` : m,
  );
}

const manifestPath = join(DATA, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const built = [];
let failed = 0;

for (const def of DEFINITIONS) {
  if (only && def.id !== only) continue;
  try {
    TRIMMED.length = 0;
    const tables = def.tables().filter(Boolean);
    if (TRIMMED.length) console.log(`  ${def.id}: dropped incomplete ${[...new Set(TRIMMED)].join('; ')}`);
    if (tables.length === 0) throw new Error('no data rows');
    const file = { schemaVersion: 1, id: def.id, ...def.meta, tables, sources: def.sources };
    const target = def.target ?? 'metrics';
    writeFileSync(join(DATA, target, `${def.id}.json`), stringify(file) + '\n');
    const scopes = new Set(tables.flatMap((t) => Object.keys(t.values)));
    const years = tables.flatMap((t) => t.years);
    built.push({ id: def.id, target, scopes: scopes.size, from: Math.min(...years), to: Math.max(...years) });
    if (target === 'proxies' && !manifest.proxies.includes(def.id)) manifest.proxies.push(def.id);
    if (target === 'metrics' && !manifest.metrics.includes(def.id)) manifest.metrics.push(def.id);
  } catch (e) {
    failed++;
    console.error(`  FAILED ${def.id}: ${e.message}`);
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const b of built) console.log(`  ${b.id.padEnd(24)} ${b.target.padEnd(8)} ${String(b.scopes).padStart(4)} scopes  ${b.from}–${b.to}`);
console.log(`\n${built.length} file(s) generated${failed ? `, ${failed} failed` : ''}. Next: npm run data:validate`);
process.exit(failed ? 1 : 0);
