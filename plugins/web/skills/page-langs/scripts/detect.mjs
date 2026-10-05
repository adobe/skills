#!/usr/bin/env node
/**
 * detect.mjs — run CLD3 on collect.js output and write langs.json.
 *
 * Usage:
 *   playwright-cli run-code --filename=collect.js | node detect.mjs [--output <dir>]
 *
 * Reads playwright-cli run-code output from stdin (strips the envelope),
 * runs Google CLD3 on the visible text, reconciles declared vs detected,
 * and writes langs.json to the output directory.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputIdx = process.argv.indexOf('--output');
const outputDir = resolve(outputIdx !== -1 ? process.argv[outputIdx + 1] : './page-langs-output');

// ─── Read stdin ───────────────────────────────────────────────────────────────

const raw = await new Promise((res, rej) => {
  let buf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => res(buf));
  process.stdin.on('error', rej);
});

// ─── Strip playwright-cli envelope ───────────────────────────────────────────

function stripEnvelope(s) {
  const start = s.indexOf('### Result');
  if (start === -1) return s.trim();
  const after = s.slice(start + '### Result'.length);
  const end = after.lastIndexOf('### Ran Playwright code');
  return (end === -1 ? after : after.slice(0, end)).trim();
}

let pageData;
try {
  pageData = JSON.parse(stripEnvelope(raw));
} catch (err) {
  process.stderr.write(`Failed to parse collect output: ${err.message}\n`);
  process.stderr.write(`Raw output preview: ${raw.slice(0, 300)}\n`);
  process.exit(1);
}

// ─── CLD3 detection ───────────────────────────────────────────────────────────

let loadModule;
try {
  ({ loadModule } = await import('cld3-asm'));
} catch {
  const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
  process.stderr.write(
    `cld3-asm not installed. Run:\n  npm install --prefix "${skillDir}"\nthen retry.\n`
  );
  process.exit(1);
}

// cld3-asm's findMostFrequentLanguages always returns a single language for
// mixed text, so classify each text block on its own and weight by bytes.
// Blocks CLD3 marks unreliable are ignored, and so are blocks under
// MIN_BLOCK_BYTES: nav labels such as "DE" or "Garantie" get confident but
// wrong codes (pt, nl, ga...) that would show up as undeclared languages.
const MIN_BLOCK_BYTES = 50;

function aggregate(results) {
  const bytes = new Map();
  const weighted = new Map();
  let total = 0;
  for (const { language, probability, is_reliable, size } of results) {
    if (!is_reliable || language === 'und' || size < MIN_BLOCK_BYTES) continue;
    bytes.set(language, (bytes.get(language) || 0) + size);
    weighted.set(language, (weighted.get(language) || 0) + probability * size);
    total += size;
  }
  return [...bytes.entries()]
    .map(([language, b]) => ({
      language,
      probability: weighted.get(language) / b,
      is_reliable: true,
      proportion: b / total,
    }))
    .sort((a, b) => b.proportion - a.proportion)
    .slice(0, 5);
}

const cldFactory = await loadModule();
const identifier = cldFactory.create(0, 1000);
let detected = [];
try {
  const blocks = (pageData.text || '').split('\n').filter((b) => b.trim());
  detected = aggregate(blocks.map((block) => ({
    ...identifier.findLanguage(block),
    size: Buffer.byteLength(block),
  })));
} finally {
  identifier.dispose();
}

// ─── Reconcile declared vs detected ──────────────────────────────────────────

function primarySubtag(code) {
  if (!code || code.toLowerCase() === 'x-default' || code === 'und') return null;
  return code.toLowerCase().split('-')[0] || null;
}

function reconcile(declared, detectedList) {
  const detectedCodes = new Set(
    detectedList.filter((r) => r.is_reliable).map((r) => r.language)
  );
  const declaredCodes = new Set();
  const add = (raw) => { const p = primarySubtag(raw); if (p) declaredCodes.add(p); };

  if (declared.htmlLang) add(declared.htmlLang);
  for (const { lang } of declared.nestedLangs) add(lang);
  for (const { hreflang } of declared.hreflang) add(hreflang);
  if (declared.metaContentLanguage) {
    declared.metaContentLanguage.split(',').forEach((p) => add(p.trim()));
  }

  return {
    agreement:           [...declaredCodes].filter((c) =>  detectedCodes.has(c)),
    declaredNotDetected: [...declaredCodes].filter((c) => !detectedCodes.has(c)),
    detectedNotDeclared: [...detectedCodes].filter((c) => !declaredCodes.has(c)),
  };
}

const declared = {
  htmlLang:            pageData.htmlLang ?? null,
  nestedLangs:         pageData.nestedLangs ?? [],
  hreflang:            pageData.hreflang ?? [],
  metaContentLanguage: pageData.metaContentLanguage ?? null,
};

const result = {
  url:            pageData.url,
  wordCount:      pageData.wordCount,
  detected,
  declared,
  reconciliation: reconcile(declared, detected),
};

// ─── Write output ─────────────────────────────────────────────────────────────

await mkdir(outputDir, { recursive: true });
const outPath = join(outputDir, 'langs.json');
await writeFile(outPath, JSON.stringify(result, null, 2));
process.stderr.write(`Done. Output: ${outPath}\n`);

if (detected.length > 0) {
  const summary = detected
    .map((r) => `${r.language} (${(r.proportion * 100).toFixed(0)}%)`)
    .join(', ');
  process.stdout.write(`Detected: ${summary}\n`);
} else {
  process.stdout.write('No languages detected (text too short or undetermined).\n');
}
const { detectedNotDeclared, declaredNotDetected } = result.reconciliation;
if (detectedNotDeclared.length > 0) {
  process.stdout.write(`⚠ Undeclared: ${detectedNotDeclared.join(', ')}\n`);
}
if (declaredNotDetected.length > 0) {
  process.stdout.write(`ℹ Declared but not in body: ${declaredNotDetected.join(', ')}\n`);
}
