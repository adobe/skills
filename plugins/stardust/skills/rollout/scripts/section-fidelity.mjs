#!/usr/bin/env node
/**
 * rollout/section-fidelity.mjs — "don't add sections the source doesn't have".
 *
 * A SCAFFOLD for the per-page source-fidelity gate (Phase C), not an auto-judge.
 * Mapping an authored EDS page's sections onto an arbitrary source page is fuzzy
 * and needs the delivering agent's judgment; this just lays the two side-by-side
 * so that judgment is fast and consistent — and pre-flags the section shapes
 * that have historically been invented (trailing cross-link rails, specialist
 * grids, generic CTAs).
 *
 *   node section-fidelity.mjs --file <content.html> --source <url>
 *   node section-fidelity.mjs --file <content.html> --source-file <path>
 *
 * Prints:
 *   - AUTHORED: ordered block sections in the content file (+ default-content prose)
 *   - SOURCE:   the source page's heading outline (h1/h2/h3) and landmark count
 *   - REVIEW:   authored blocks whose NAME matches a known "invented filler"
 *               pattern — the agent must confirm each maps to a real source region
 *               or remove it (hard-fail if it carries fabricated facts).
 * Exit code is always 0 — this informs the gate; it does not decide it.
 */
import { readFileSync } from 'node:fs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const file = arg('file');
const source = arg('source');
const sourceFile = arg('source-file');
if (!file || (!source && !sourceFile)) {
  console.error('usage: section-fidelity.mjs --file <content.html> (--source <url> | --source-file <path>)');
  process.exit(2);
}

// Section shapes that have historically been invented onto leaf pages — append
// -only "related/weitere" rails, specialist/teaser grids, generic trailing CTAs.
const FILLER = [
  /^related-/, /-related$/, /^weitere-/, /related$/,
  /specialists?$/, /-teasers?$/, /^teaser/, /conditions$/,
  /articles$/, /events$/, /-cta$/,
];

const html = readFileSync(file, 'utf8');

// AUTHORED sections: each top-level section is `<div><div class="BLOCK">…`.
// Default content (prose) sections have no block class.
const authored = [];
const sectionRe = /<div>\s*<div class="([a-z0-9-]+)"/gi;
let m;
while ((m = sectionRe.exec(html))) authored.push(m[1]);
// crude default-content detector: a `<div>` whose first child is not a classed div
const dcCount = (html.match(/<div>\s*<div>\s*<(h[1-6]|p|ul|ol)\b/gi) || []).length;

async function getSource() {
  if (sourceFile) return readFileSync(sourceFile, 'utf8');
  const r = await fetch(source, { headers: { 'user-agent': 'stardust-fidelity' } });
  if (!r.ok) { console.error(`source fetch ${r.status} for ${source}`); process.exit(1); }
  return r.text();
}

const src = await getSource();
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const outline = [];
const hRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
let h;
while ((h = hRe.exec(src))) {
  const text = stripTags(h[2]).slice(0, 80);
  if (text) outline.push(`${h[1]}  ${text}`);
}
const landmarks = (src.match(/<(section|article|aside)\b/gi) || []).length;

const review = authored.filter((b) => FILLER.some((re) => re.test(b)));

console.log(`\n# section-fidelity — ${file}`);
console.log(`source: ${source || sourceFile}\n`);
console.log(`AUTHORED sections (${authored.length} blocks + ~${dcCount} default-content):`);
authored.forEach((b, i) => console.log(`  ${i + 1}. ${b}${review.includes(b) ? '   ⟵ REVIEW' : ''}`));
console.log(`\nSOURCE outline (${outline.length} headings, ${landmarks} <section|article|aside>):`);
outline.slice(0, 40).forEach((o) => console.log(`  ${o}`));
if (outline.length > 40) console.log(`  … +${outline.length - 40} more`);
console.log('\nGATE: for each AUTHORED block — especially ⟵ REVIEW ones — confirm a real');
console.log('source region backs it. Remove any section with no source equivalent.');
console.log('HARD-FAIL (must remove before deployed) if the section carries FABRICATED');
console.log('facts: invented person names, made-up events/dates, or boilerplate prose');
console.log('not present on the source. A cross-link rail to REAL pages is a softer call.');
