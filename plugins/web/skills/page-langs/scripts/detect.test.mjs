// Run: npm install --prefix <skill-dir> && node --test scripts/detect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DETECT = join(import.meta.dirname, 'detect.mjs');

function detect(page) {
  const out = mkdtempSync(join(tmpdir(), 'page-langs-test-'));
  const stdin = `### Result\n${JSON.stringify(page)}\n### Ran Playwright code\n`;
  execFileSync('node', [DETECT, '--output', out], { input: stdin, stdio: ['pipe', 'ignore', 'ignore'] });
  return JSON.parse(readFileSync(join(out, 'langs.json'), 'utf8'));
}

const page = {
  url: 'https://shop.example.com/en/tent',
  htmlLang: 'en',
  nestedLangs: [{ lang: 'de', count: 1 }],
  hreflang: [],
  metaContentLanguage: null,
  text: [
    'DE', 'FR', 'Garantie',
    'The tent packs down to the size of a water bottle and pitches in under three minutes, even in the dark.',
    'Two doors and two vestibules mean nobody climbs over anybody at night, and every seam is taped.',
    'Enviamos a toda España y Portugal en un plazo de tres a cinco días laborables desde la compra.',
    'Si la tienda no te convence, puedes devolverla sin usar dentro de los treinta días siguientes.',
    'Auf alle Zelte gewähren wir eine Garantie von fünf Jahren auf Material- und Verarbeitungsfehler.',
  ].join('\n'),
  wordCount: 90,
};

test('detects every language in mixed-language text', () => {
  const langs = detect(page).detected.map((d) => d.language);
  assert.deepEqual([...langs].sort(), ['de', 'en', 'es']);
});

test('flags the undeclared language and agrees on declared ones', () => {
  const { reconciliation } = detect(page);
  assert.deepEqual(reconciliation.detectedNotDeclared, ['es']);
  assert.deepEqual([...reconciliation.agreement].sort(), ['de', 'en']);
});

test('reports nothing for text too short to classify', () => {
  const { detected } = detect({ ...page, text: 'DE\nFR\nGarantie' });
  assert.deepEqual(detected, []);
});

test('splits blocks longer than CLD3 reads at once', () => {
  const en = 'The tent packs down small, pitches in minutes, and keeps you dry when the weather turns on the trail. ';
  const es = 'La tienda se pliega en poco espacio, se monta en minutos y te mantiene seco cuando cambia el tiempo. ';
  const block = en.repeat(15) + es.repeat(15);
  const { detected } = detect({ ...page, nestedLangs: [], text: block });
  const share = Object.fromEntries(detected.map((d) => [d.language, d.proportion]));
  assert.deepEqual(Object.keys(share).sort(), ['en', 'es']);
  assert.ok(share.es > 0.25 && share.en > 0.25, JSON.stringify(share));
});
