// Downloads every public dataset listed in sources.mjs into data-raw/.
// Usage: npm run data:fetch [-- --only <id-substring|group>] [-- --force]
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rawDir = join(root, 'data-raw');
mkdirSync(rawDir, { recursive: true });

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (args.includes('--only') && !only) throw new Error('--only requires a source id or group');
const selected = SOURCES.filter((source) => !only || source.id.includes(only) || source.group === only);
if (selected.length === 0) throw new Error(`No source matches "${only}"`);
if (new Set(SOURCES.map((source) => source.id)).size !== SOURCES.length) {
  throw new Error('Duplicate source definitions');
}
const force = args.includes('--force');
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'world-pulse-etl (https://github.com/AlessandroCapelli/world-pulse)' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt >= 3) throw e;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    return get(url, attempt + 1);
  }
}

async function fetchUsgs() {
  const counts = {};
  const last = new Date().getUTCFullYear() - 1;
  for (let y = 2000; y <= last; y++) {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/count?format=geojson&starttime=${y}-01-01&endtime=${y + 1}-01-01&minmagnitude=5`;
    counts[y] = JSON.parse(await get(url)).count;
  }
  return JSON.stringify({ minmagnitude: 5, counts });
}

const report = existsSync(join(rawDir, '_report.json')) ? JSON.parse(readFileSync(join(rawDir, '_report.json'), 'utf8')) : {};
let failed = 0;
for (const s of selected) {
  const path = join(rawDir, s.file);
  if (!force && existsSync(path) && Date.now() - statSync(path).mtimeMs < MAX_AGE_MS) {
    console.log(`  cached   ${s.id}`);
    continue;
  }
  try {
    const body = s.kind === 'usgs' ? await fetchUsgs() : await get(s.url);
    if (s.kind === 'worldbank') {
      const json = JSON.parse(body);
      if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error(`unexpected World Bank payload: ${body.slice(0, 200)}`);
      if (Number(json[0]?.pages) > 1) throw new Error('World Bank response is incomplete; increase per_page');
      if (!json[1].some((row) => row.value !== null)) throw new Error('World Bank response has no observations');
    }
    if (s.kind === 'owid-grapher' && !/^entity,code,year,/i.test(body)) throw new Error(`unexpected OWID header: ${body.slice(0, 120)}`);
    writeFileSync(path, body);
    report[s.id] = { url: s.url, file: s.file, fetched: new Date().toISOString().slice(0, 10), bytes: body.length };
    console.log(`  ok       ${s.id} (${(body.length / 1024).toFixed(0)} kB)`);
  } catch (e) {
    failed++;
    report[s.id] = { ...(report[s.id] ?? {}), url: s.url, error: String(e.message ?? e) };
    console.error(`  FAILED   ${s.id}: ${e.message ?? e}`);
  }
}
writeFileSync(join(rawDir, '_report.json'), JSON.stringify(report, null, 2));
console.log(failed ? `\n${failed} source(s) failed — see data-raw/_report.json` : '\nAll sources fetched. Next: npm run data:build');
process.exit(failed ? 1 : 0);
