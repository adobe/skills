#!/usr/bin/env node
// skills/reskin/scripts/test/root-tokens.test.mjs — the :root token block rendered from donor-tokens.json:
// contract names resolved through ordered fallbacks, per-type-key extras, absent names reported,
// unsafe values refused with the path, deterministic output.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { rootTokens, ROOT_MAP } from '../render/root-tokens.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const T = { palette: { pageBg: 'rgb(255, 255, 255)', bodyFg: 'rgb(26, 26, 26)', accent: 'rgb(31, 58, 95)' }, type: { family: 'Inter, "Inter-fallback", sans-serif', familyNote: 'x', display: { fontSize: '56px', lineHeight: '1.143', fontWeight: '700' }, h2: { fontSize: '40px' }, body: { fontSize: '18px', lineHeight: '28px' }, cardLabel: { fontSize: '14px', fontWeight: '500', letterSpacing: '0.02em' } }, layout: { containerMaxWidth: '1200px', sectionPaddingY: '80px' }, buttons: { primary: { borderRadius: '8px', background: 'rgb(9, 9, 9)' } } };

await check('contract names resolve through the ordered fallbacks', () => {
  const r = rootTokens(T);
  const v = Object.fromEntries(r.entries.map((e) => [e.name, e.value]));
  assert.equal(r.entries[0].name, '--heading-font-family');
  assert.equal(v['--heading-font-family'], 'Inter, "Inter-fallback", sans-serif');
  assert.equal(v['--heading-xxl'], '56px'); assert.equal(v['--heading-xl'], '40px');
  assert.equal(v['--line-height-heading'], '1.143'); assert.equal(v['--max-width'], '1200px');
  assert.equal(v['--color-accent'], 'rgb(31, 58, 95)');
  assert.equal(r.entries.find((e) => e.name === '--radius').from, 'buttons.primary.borderRadius');
});

await check('every object under type adds kebab-cased --type-* entries; plain strings do not', () => {
  const r = rootTokens(T);
  const v = Object.fromEntries(r.entries.map((e) => [e.name, e.value]));
  assert.equal(v['--type-card-label-letter-spacing'], '0.02em'); assert.equal(v['--type-h2-size'], '40px');
  assert.ok(!Object.keys(v).some((k) => k.startsWith('--type-family-note')));
});

await check('absent contract names are listed in map order and noted in the css', () => {
  const r = rootTokens(T);
  assert.deepEqual(r.absent.map((a) => a.name), ['--heading-lg', '--heading-md', '--body-sm', '--spacing-xs', '--spacing-sm', '--spacing-md', '--spacing-lg', '--spacing-xl', '--spacing-2xl']);
  assert.match(r.css, /^:root \{\n  --heading-font-family: Inter, "Inter-fallback", sans-serif;\n/);
  assert.match(r.css, /\/\* absent in donor-tokens.json: --heading-lg, /);
  assert.ok(r.css.endsWith('}\n'));
});

await check('unsafe or non-string used values throw naming the path', () => {
  assert.throws(() => rootTokens({ palette: { pageBg: 'red;} body{x:y' } }), /palette.pageBg/);
  assert.throws(() => rootTokens({ type: { body: { fontSize: 18 } } }), /type.body.fontSize/);
  assert.throws(() => rootTokens({ type: { cardLabel: { fontWeight: 'a\nb' } } }), /type.cardLabel.fontWeight/);
});

await check('output is deterministic and ROOT_MAP is exposed in contract order', () => {
  assert.equal(rootTokens(T).css, rootTokens(T).css);
  assert.equal(ROOT_MAP[0].name, '--heading-font-family');
  assert.equal(rootTokens({}).entries.length, 0);
});

await check('a sheet without the optional paths renders byte-identical to before (optional names are never listed absent)', () => {
  const before = ':root {\n  --heading-font-family: Inter, "Inter-fallback", sans-serif;\n  --body-font-family: Inter, "Inter-fallback", sans-serif;\n  --heading-xxl: 56px;\n  --heading-xl: 40px;\n  --body: 18px;\n  --line-height-heading: 1.143;\n  --line-height-body: 28px;\n  --color-bg: rgb(255, 255, 255);\n  --color-fg: rgb(26, 26, 26);\n  --color-accent: rgb(31, 58, 95);\n  --section-padding: 80px;\n  --max-width: 1200px;\n  --radius: 8px;\n  --type-display-size: 56px;\n  --type-display-line-height: 1.143;\n  --type-display-weight: 700;\n  --type-h2-size: 40px;\n  --type-body-size: 18px;\n  --type-body-line-height: 28px;\n  --type-card-label-size: 14px;\n  --type-card-label-weight: 500;\n  --type-card-label-letter-spacing: 0.02em;\n  /* absent in donor-tokens.json: --heading-lg, --heading-md, --body-sm, --spacing-xs, --spacing-sm, --spacing-md, --spacing-lg, --spacing-xl, --spacing-2xl */\n}\n';
  assert.equal(rootTokens(T).css, before);
  assert.ok(!rootTokens({}).absent.some((a) => /card|button-height|mobile/.test(a.name)));
});

await check('optional curated paths are emitted when present, after the contract names', () => {
  const t = structuredClone(T);
  t.cards = { primary: { background: 'rgb(245, 245, 245)', borderRadius: '12px', padding: '24px', titleColor: 'rgb(9, 9, 9)' } };
  t.buttons.primary.height = '48px';
  t.layout.mobile = { sectionPaddingY: '40px', gutter: '16px' };
  const r = rootTokens(t);
  const v = Object.fromEntries(r.entries.map((e) => [e.name, e.from]));
  assert.deepEqual(Object.keys(v).filter((k) => !k.startsWith('--type-')).slice(-7), ['--card-bg', '--card-radius', '--card-padding', '--card-title-color', '--button-height', '--section-padding-mobile', '--gutter-mobile']);
  assert.equal(v['--section-padding-mobile'], 'layout.mobile.sectionPaddingY');
  assert.match(r.css, /  --card-radius: 12px;\n/); assert.match(r.css, /  --gutter-mobile: 16px;\n/);
  assert.deepEqual(r.absent, rootTokens(T).absent);
});

if (failed) { console.log(`${failed} check(s) failed`); process.exitCode = 1; } else console.log('all checks passed');
