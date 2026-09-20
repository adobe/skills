#!/usr/bin/env node
// Fixture test: the per-page schema gate (extract/scripts/validate-page.mjs +
// crawl.mjs validateRecord / validateProvenance — current-state-schema.md
// § Required vs optional · § Versioning · § Live-render evidence).
//   * a full schema-2 record passes (WARN allowed, never FAIL)
//   * a record missing `landmarks` FAILs with the key named
//   * a pre-schema-2 record passes only with --legacy (WARN per absent key)
//   * renderedBy "synthesized" FAILs even with --legacy (no provenance hatch)
//   * the CLI: exit 0 / 1 / 2 and --json
// Runs without playwright (crawl.mjs imports it lazily inside main()).
// Usage: node plugins/stardust/evals/fixtures/validate-page.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateRecord, validateProvenance, REQUIRED_KEYS, SCHEMA_VERSION, CONSENT_LABELS } from '../../skills/extract/scripts/crawl.mjs';

const SCRIPT = new URL('../../skills/extract/scripts/validate-page.mjs', import.meta.url).pathname;
const prov = (over = {}) => ({ renderedBy: 'playwright', fetchedAt: '2026-09-20T10:00:00.000Z', waitMode: 'medium', waitMs: 2500, httpStatus: 200, schemaVersion: SCHEMA_VERSION, script: 'crawl.mjs', width: 1440, dpr: 1, technique: 'headless', storageState: false, variants: [], ...over });
const full = (over = {}) => ({
  _provenance: prov(), slug: 'index', url: 'https://example.com/', finalUrl: 'https://example.com/', title: 'Example', metaDescription: 'A page.',
  heroHeadline: 'Designed for the way you work', heroLede: 'One platform.', og: {}, themeColor: { light: null, dark: null }, language: 'en',
  headings: [{ tag: 'h1', level: 1, text: 'Hi' }], landmarks: [{ tag: 'main', role: 'main', children: [] }], ctas: [{ label: 'Go', href: '/go' }],
  links: { internal: [], external: [] }, media: { images: [], imgs: [], cssBackgrounds: [], inlineSvgs: [], videos: [], iframes: [] }, forms: [], widgets: { modals: [], accordions: [], tabs: [] },
  components: {}, perSectionStyle: [], embedDominance: { dominated: false }, cssCustomProperties: [], screenshot: 'assets/screenshots/index.png',
  _signals: { captureQuality: 'ok', shadowRoots: 0, shadowTextLen: 0 }, stats: { wordCount: 1 }, ...over,
});

// provenance — the five fields, no hatch
assert.deepEqual(validateProvenance(prov()), { ok: true, missing: [] });
assert.deepEqual(validateProvenance({ ...prov(), renderedBy: 'synthesized' }).missing, ['renderedBy']);
assert.deepEqual(validateProvenance({ ...prov(), waitMs: 0, httpStatus: 404 }).missing, ['waitMs', 'httpStatus'], '2xx/3xx only; waitMs > 0');
assert.ok(validateProvenance({ ...prov(), waitMode: 'domcontentloaded(fallback)' }).ok, 'the (fallback) form is a recipe mode');
assert.deepEqual(validateProvenance(null).missing, ['_provenance']);

// schema 2 record
const good = validateRecord(full());
assert.ok(good.ok && good.fail.length === 0, `full record passes: ${good.fail}`);
assert.ok(REQUIRED_KEYS.includes('landmarks') && REQUIRED_KEYS.includes('stats') && !REQUIRED_KEYS.includes('dynamic'), 'dynamic (--dynamics only) is optional by contract');
const empty = validateRecord(full({ headings: [], landmarks: [], ctas: [] }));
assert.ok(empty.ok, 'empty arrays pass (presence-only gate)');
assert.deepEqual(empty.warn, ['headings empty', 'landmarks empty', 'ctas empty'], 'the schema says log a warning');
const { landmarks, ...noLm } = full();
const miss = validateRecord(noLm);
assert.equal(miss.ok, false); assert.deepEqual(miss.fail, ['landmarks'], 'the missing key is named');
const bad = validateRecord(full({ _provenance: prov({ renderedBy: 'synthesized' }) }));
assert.deepEqual(bad.fail, ['_provenance.renderedBy']);
assert.deepEqual(validateRecord(full({ _provenance: prov({ schemaVersion: SCHEMA_VERSION + 1 }) })).fail, [`_provenance.schemaVersion ${SCHEMA_VERSION + 1} > ${SCHEMA_VERSION} (newer than this validator)`]);
assert.deepEqual(validateRecord(full({ links: ['https://example.com/a'] })).fail, ['links.internal', 'links.external'], 'the flat links[] of schema 1 is not the schema-2 shape');
assert.deepEqual(validateRecord(full({ _signals: { captureQuality: 'degraded', shadowRoots: 2, shadowTextLen: 0 } })).warn, ['captureQuality degraded', '2 open shadow root(s) with no pierced text']);

// legacy (pre-schema-2) record: schemaVersion absent, old keys only
const legacyRec = { _provenance: prov({ schemaVersion: undefined, script: undefined }), slug: 'about', url: 'https://example.com/about', finalUrl: 'https://example.com/about', title: 'About', description: 'x', og: {}, headings: [{ tag: 'h1', level: 1, text: 'About' }], body: [], ctas: [], links: [], media: { imgs: [], cssBackgrounds: [] }, customProps: {}, screenshot: null, _signals: {} };
delete legacyRec._provenance.schemaVersion;
const strict = validateRecord(legacyRec);
assert.equal(strict.ok, false); assert.ok(strict.fail.includes('_provenance.schemaVersion') && strict.fail.includes('landmarks'), 'without --legacy a pre-2 record fails');
const lenient = validateRecord(legacyRec, { legacy: true });
assert.ok(lenient.ok, `--legacy admits it: ${lenient.fail}`); assert.ok(lenient.warn.some((w) => w === 'legacy record: landmarks absent'), 'absent schema-2 keys become WARNs');
const synthLegacy = validateRecord({ ...legacyRec, _provenance: { ...legacyRec._provenance, renderedBy: 'synthesized' } }, { legacy: true });
assert.equal(synthLegacy.ok, false); assert.deepEqual(synthLegacy.fail, ['_provenance.renderedBy'], 'provenance has no hatch, --legacy or not');

// consent table export (T23.4 palette exclusion reads it — one source)
assert.ok(CONSENT_LABELS.includes('accept all cookies') && CONSENT_LABELS.includes('reject all') && CONSENT_LABELS.includes('cookie settings') && CONSENT_LABELS.includes('no thanks'), 'accept + decline + settings + close labels, flat');
assert.equal(new Set(CONSENT_LABELS).size, CONSENT_LABELS.length, 'de-duplicated');

// CLI
const dir = mkdtempSync(join(tmpdir(), 'validate-page-')); const pages = join(dir, 'pages'); mkdirSync(pages);
writeFileSync(join(pages, 'index.json'), JSON.stringify(full()));
writeFileSync(join(pages, 'about.json'), JSON.stringify(legacyRec));
const run = (...extra) => spawnSync(process.execPath, [SCRIPT, ...extra], { encoding: 'utf8' });
let r = run('--dir', pages);
assert.equal(r.status, 1, `strict run fails on the legacy record: ${r.stdout}`); assert.match(r.stdout, /^FAIL about\s+missing .*landmarks/m); assert.match(r.stdout, /1 FAIL/);
r = run('--dir', pages, '--legacy');
assert.equal(r.status, 0, `--legacy passes: ${r.stdout}`); assert.match(r.stdout, /^WARN about/m); assert.match(r.stdout, /0 FAIL, 1 WARN/);
r = run('--dir', pages, '--legacy', '--json');
const j = JSON.parse(r.stdout); assert.equal(j.ok, true); assert.equal(j.records.length, 2); assert.equal(j.schemaVersion, SCHEMA_VERSION);
writeFileSync(join(pages, 'fake.json'), JSON.stringify(full({ slug: 'fake', _provenance: prov({ renderedBy: 'synthesized' }) })));
r = run('--dir', pages, '--legacy');
assert.equal(r.status, 1, 'a synthesized record fails even under --legacy'); assert.match(r.stdout, /^FAIL fake\s+missing _provenance\.renderedBy/m);
assert.equal(run('--dir', join(dir, 'nowhere')).status, 2, 'missing dir → 2');
assert.equal(run('--bogus').status, 2, 'unknown arg → 2');
assert.equal(run('--help').status, 0);
assert.match(run('--help').stdout, /Exit codes/);

console.log('validate-page test: ok');
