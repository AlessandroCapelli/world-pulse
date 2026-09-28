// Post-build step for GitHub Pages (static hosting, no rewrites):
//  - 404.html = client-side-rendered shell, so any non-prerendered URL still boots the SPA;
//  - .nojekyll so files are served as-is;
//  - sitemap.xml from the canonical URL of every prerendered page;
//  - sanity check that every HTML page carries the expected <base href>.
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'world-pulse', 'browser');
if (!existsSync(out)) {
  console.error(`Build output not found: ${out}`);
  process.exit(1);
}

const shell = existsSync(join(out, 'index.csr.html')) ? 'index.csr.html' : 'index.html';
copyFileSync(join(out, shell), join(out, '404.html'));
writeFileSync(join(out, '.nojekyll'), '');

const html = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) html.push(p);
  }
};
walk(out);

const bases = new Set(html.map((p) => /<base href="([^"]*)"/.exec(readFileSync(p, 'utf8'))?.[1] ?? '(none)'));
if (bases.size !== 1) {
  console.error(`Inconsistent <base href> values: ${[...bases].join(', ')}`);
  process.exit(1);
}

// Sitemap (submit it in Search Console: robots.txt is only read at the domain root, not under a project sub-path).
const canonical = html
  .map((p) => /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(p, 'utf8'))?.[1])
  .filter((u) => !!u);
const urls = [...new Set(canonical)].sort();
const today = new Date().toISOString().slice(0, 10);
const entries = urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${today}</lastmod></url>`);
const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...entries, '</urlset>', ''];
writeFileSync(join(out, 'sitemap.xml'), sitemap.join('\n'));

console.log(
  `GitHub Pages output ready: ${html.length} HTML files, base href ${[...bases][0]}, 404.html from ${shell}, .nojekyll and sitemap.xml (${urls.length} URLs) written.`,
);
