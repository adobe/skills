import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguages, loadDetector } from '#src/page/langs-detect.mjs';

const WORDS = { en: /\b(the|and|tent)\b/, es: /\b(la|se|tienda)\b/, de: /\b(wir|und|auf)\b/ };

const fakeDetector = {
  create: () => ({
    findLanguage: (text) => {
      const language = Object.keys(WORDS).find((l) => WORDS[l].test(text));
      return language
        ? { language, probability: 0.95, is_reliable: true }
        : { language: 'und', probability: 0, is_reliable: false };
    },
    dispose() {},
  }),
};

const page = {
  url: 'https://shop.example.com/en/tent',
  htmlLang: 'en',
  nestedLangs: [{ lang: 'de', count: 1 }],
  hreflang: [],
  metaContentLanguage: null,
  text: [
    'DE',
    'FR',
    'Garantie',
    'The tent packs down to the size of a water bottle and pitches in under three minutes.',
    'Two doors and two vestibules mean nobody climbs over anybody at night, and every seam.',
    'Enviamos a toda España y Portugal, la tienda se envía en un plazo de tres a cinco días.',
    'Si la tienda no te convence, se puede devolver sin usar dentro de los treinta días.',
    'Auf alle Zelte gewähren wir eine Garantie von fünf Jahren auf Material und Verarbeitung.',
  ].join('\n'),
  wordCount: 90,
};

test('result has the schema top-level fields', () => {
  const r = detectLanguages(page, fakeDetector);
  assert.deepEqual(Object.keys(r), ['url', 'wordCount', 'detected', 'declared', 'reconciliation']);
  assert.deepEqual(r.declared, {
    htmlLang: 'en',
    nestedLangs: page.nestedLangs,
    hreflang: [],
    metaContentLanguage: null,
  });
});

test('detects every language in mixed-language text', () => {
  const langs = detectLanguages(page, fakeDetector).detected.map((d) => d.language);
  assert.deepEqual([...langs].sort(), ['de', 'en', 'es']);
});

test('flags the undeclared language and agrees on declared ones', () => {
  const { reconciliation } = detectLanguages(page, fakeDetector);
  assert.deepEqual(reconciliation.detectedNotDeclared, ['es']);
  assert.deepEqual([...reconciliation.agreement].sort(), ['de', 'en']);
});

test('reports nothing for text too short to classify', () => {
  const { detected } = detectLanguages({ ...page, text: 'DE\nFR\nGarantie' }, fakeDetector);
  assert.deepEqual(detected, []);
});

test('missing optional signals default to null/empty', () => {
  const r = detectLanguages({ url: 'u', text: '', wordCount: 0 }, fakeDetector);
  assert.deepEqual(r.declared, {
    htmlLang: null,
    nestedLangs: [],
    hreflang: [],
    metaContentLanguage: null,
  });
});

test('splits blocks longer than CLD3 reads at once', () => {
  const en = 'The tent packs down small, pitches in minutes, and keeps you dry on the trail. ';
  const es = 'La tienda se pliega en poco espacio, se monta en minutos y te mantiene seco. ';
  const block = en.repeat(15) + es.repeat(15);
  const seen = [];
  const spy = {
    create: () => ({
      findLanguage: (t) => (seen.push(Buffer.byteLength(t)), fakeDetector.create().findLanguage(t)),
      dispose() {},
    }),
  };
  const { detected } = detectLanguages({ ...page, nestedLangs: [], text: block }, spy);
  assert.ok(seen.length > 1 && seen.every((n) => n <= 1000), JSON.stringify(seen));
  assert.deepEqual(detected.map((d) => d.language).sort(), ['en', 'es']);
});

test('loadDetector throws UNSUPPORTED with install hint when module missing', async () => {
  const importer = async () => {
    throw new Error('Cannot find package');
  };
  await assert.rejects(loadDetector(importer), (err) => {
    assert.equal(err.code, 'UNSUPPORTED');
    assert.match(err.hint, /^cd \/.*cli && npm install$/);
    return true;
  });
});

test('loadDetector resolves the loaded module via importer', async () => {
  const importer = async () => ({ loadModule: async () => fakeDetector });
  assert.equal(await loadDetector(importer), fakeDetector);
});
