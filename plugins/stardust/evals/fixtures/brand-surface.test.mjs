#!/usr/bin/env node
// Fixture test: skills/extract/scripts/brand-surface.mjs (extract/reference/brand-surface.md is the rule)
// over evals/lint/fixtures/brand-surface/{modular,ad-hoc} — three synthetic schema-2 records + an
// index.html sidecar, a _crawl-log.json and a fonts manifest (synthetic brand "Example", example.com):
//   palette ΔE < 5 clustering + role naming · CMP button colour EXCLUDED (crawl.mjs CONSENT_LABELS)
//   heading/body family + scaleAudit.kind modular vs ad-hoc · motif mode from stats.motifs
//   systemComponents fingerprint across ≥ 2 pages · wordmark = largest banner image (180×32) beats
//   apple-touch-icon (logo chain step 1b) · origins[] one entry · --bounded / auto-bounded omits
//   voice/voiceTable/crossPromo/register and stamps mode "bounded" · every palette value cites
//   sourceSelectors + sources · exit 1 with no live record · exit 2 on usage · --help exits 0.
// No browser: the script is offline by design. Usage: node plugins/stardust/evals/fixtures/brand-surface.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deltaE, clusterColors, isThirdPartyChrome, parseColor, pxOf, scaleAudit, headingSizes, isBoundedRun } from '../../skills/extract/scripts/brand-surface.mjs';

const SCRIPT = join(import.meta.dirname, '..', '..', 'skills', 'extract', 'scripts', 'brand-surface.mjs');
const FIX = join(import.meta.dirname, '..', 'lint', 'fixtures', 'brand-surface');
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const fresh = (set) => { const d = mkdtempSync(join(tmpdir(), 'brand-surface-')); cpSync(join(FIX, set), join(d, 'current'), { recursive: true }); return join(d, 'current'); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---- pure functions ----
assert.ok(deltaE('rgb(20, 122, 255)', 'rgb(22, 124, 255)') < 5, 'near-duplicate blues cluster (ΔE < 5)');
assert.ok(deltaE('#147aff', '#c81e1e') > 5, 'blue vs red do not cluster');
assert.equal(parseColor('rgba(0, 0, 0, 0)'), null, 'alpha 0 is not a colour');
assert.equal(parseColor('transparent'), null, 'transparent is not a colour');
const cl = clusterColors([{ value: 'rgb(20, 122, 255)', weight: 5, usedAs: 'background', selector: 'a.btn', page: 'index' }, { value: 'rgb(22, 124, 255)', weight: 2, usedAs: 'background', selector: 'a.btn2', page: 'pricing' }, { value: 'rgba(0,0,0,0)', weight: 99, usedAs: 'background', selector: 'x', page: 'index' }, { value: '#c81e1e', weight: 1, usedAs: 'background', selector: 'b', page: 'index' }]);
assert.equal(cl.length, 2, 'two clusters — transparent dropped, near-blues merged');
assert.equal(cl[0].value, '#147aff', 'most frequent member is the representative');
assert.equal(cl[0].occurrences, 7);
assert.ok(isThirdPartyChrome({ label: 'Accept all cookies', domPath: 'div > button' }), 'consent-table label is third-party chrome');
assert.ok(isThirdPartyChrome({ label: 'Reject non-essential', domPath: 'div > button' }), 'B2 label regex is third-party chrome');
assert.ok(isThirdPartyChrome({ label: 'OK', domPath: '#onetrust-banner-sdk > button' }), 'CMP selector is third-party chrome');
assert.ok(!isThirdPartyChrome({ label: 'Get started', domPath: 'header > a' }), 'a brand CTA is not chrome');
assert.equal(pxOf('2rem'), 32); assert.equal(pxOf('clamp(2rem, 5vw, 3.5rem)'), 56, 'clamp with a vw middle → the max'); assert.equal(pxOf('38.4px'), 38.4);
assert.deepEqual(scaleAudit([48, 38.4, 30.72]).kind, 'modular'); assert.equal(scaleAudit([48, 38.4, 30.72]).matchedScale, 'major-third');
assert.equal(scaleAudit([60, 45, 32, 20]).kind, 'ad-hoc'); assert.equal(scaleAudit([60, 45, 32, 20]).matchedScale, null);
const hs = headingSizes([{ level: 1, style: { fontSize: '18px', fontWeight: 400 } }, { level: 1, style: { fontSize: '18px', fontWeight: 400 } }, { level: 1, style: { fontSize: '18px', fontWeight: 400 } }, { level: 1, style: { fontSize: '60px', fontWeight: 700 } }]);
assert.equal(hs[0].fontSize, '60px', 'weighted score picks the visible display H1 over hidden 18px H1s');
assert.ok(isBoundedRun({ runs: [{ args: { pages: ['/'], cap: 5 } }] }), '--pages run is bounded');
assert.ok(isBoundedRun({ runs: [{ args: { pages: null, cap: 1 } }] }), '--single run is bounded');
assert.ok(!isBoundedRun({ runs: [{ args: { pages: null, cap: 5 } }] }), 'a capped crawl is not bounded');
assert.ok(!isBoundedRun({ runs: [{ args: { pages: ['/'], cap: 1, prep: true } }] }), '--prep is never bounded');

// ---- modular set: full run ----
const out = fresh('modular');
const r1 = run(['--out', out]);
assert.equal(r1.code, 0, `modular run exits 0\n${r1.out}`);
const b = readJson(join(out, '_brand-extraction.json'));
assert.equal(Object.keys(b)[0], '_provenance', '_provenance is the first key');
assert.equal(b._provenance.script, 'brand-surface.mjs'); assert.equal(b._provenance.writtenBy, 'stardust:extract'); assert.equal(b._provenance.mode, 'full'); assert.deepEqual(b._provenance.synthesizedInputs, []);
assert.ok(b._provenance.readArtifacts.some((a) => a.endsWith('pages/index.json')) && b._provenance.readArtifacts.some((a) => a.endsWith('_fonts-manifest.json')), 'readArtifacts lists the records and the manifest');
// palette: clustering + roles + citations + CMP exclusion
const roles = Object.fromEntries(b.palette.map((p) => [p.role, p.value]));
assert.equal(roles.background, '#ffffff'); assert.equal(roles['text-primary'], '#0f1217'); assert.equal(roles.primary, '#147aff', 'CTA background → primary (rgb(22,124,255) clustered into it)');
assert.ok(!b.palette.some((p) => p.value === '#167cff'), 'near-duplicate blue did not become its own entry');
assert.ok(!b.palette.some((p) => deltaE(p.value, '#c81e1e') < 5), 'the "Accept all cookies" button colour is NOT in the palette');
assert.ok(!Object.values(b.componentStyle.buttons).some((x) => x && x.background === '#c81e1e'), 'CMP button is not a button cluster either');
for (const p of b.palette) { assert.ok(Array.isArray(p.sourceSelectors) && p.sourceSelectors.length > 0, `${p.role} cites sourceSelectors`); assert.ok(p.sources.length > 0, `${p.role} cites pages`); assert.ok(p.occurrences > 0); assert.ok(p.usedAs.length > 0); }
assert.ok(b.palette.length <= 8);
assert.ok(b._provenance.notes.some((n) => /third-party chrome: 3 CTA/.test(n)), 'exclusion is noted');
// type
assert.equal(b.type.headingFamily.name, 'Example Sans'); assert.equal(b.type.bodyFamily.name, 'Example Text');
assert.deepEqual(b.type.headingFamily.sizes, ['48px', '38.4px', '30.72px']);
assert.equal(b.type.scaleAudit.kind, 'modular'); assert.equal(b.type.scaleAudit.matchedScale, 'major-third'); assert.equal(b.type.scaleRatio, 1.25);
assert.equal(b.type.files.length, 2, 'type.files from the fonts manifest'); assert.equal(b.type.loadStrategy, 'swap'); assert.equal(b.iconFont, null);
// motifs from stats.motifs (element-weighted: 8px = 20 + 30 + 10)
assert.equal(b.motifs.borderRadius.primary, '8px'); assert.equal(b.motifs.borderRadius.occurrences['8px'], 60); assert.equal(b.motifs.borderRadius.pill, '9999px');
assert.ok(!('0px' in b.motifs.borderRadius.occurrences), 'zero radius excluded');
assert.equal(b.motifs.shadows[0].value, '0 4px 16px rgba(0,0,0,0.08)'); assert.ok(b.motifs.shadows.length <= 3);
assert.ok(b.motifs.patterns.some((p) => p.name === 'card-grid'));
// system components across ≥ 2 pages (3 pages → threshold min(3, 2) = 2; header/footer on all 3)
const header = b.systemComponents.find((s) => s.kind === 'header'); const footer = b.systemComponents.find((s) => s.kind === 'footer');
assert.ok(header && header.occurrences === 3 && header.name === 'site-header', 'site-header fingerprint on 3 pages');
assert.deepEqual(header.headingSequence, ['Product', 'Pricing', 'About']); assert.deepEqual(header.ctaLabels, ['Get started']); assert.match(header.domFingerprintHash, /^sha256:[0-9a-f]{64}$/);
assert.ok(footer && footer.occurrences === 3, 'site-footer fingerprint on 3 pages');
assert.ok(b.systemComponents.some((s) => s.kind === 'background-motif' && s.occurrences === 2), 'shared CSS background on 2 pages → background-motif');
// logo chain: step 1b — 180×32 banner <img> beats apple-touch-icon (present in the sidecar) and the 24×24 header icon svg
assert.equal(b.logo.source, 'img'); assert.equal(b.logo.step, '1b'); assert.equal(b.logo.renderedWidth, 180); assert.equal(b.logo.renderedHeight, 32);
assert.equal(b.logo.sourceSelector, 'img[src="https://example.com/img/wordmark.svg"]'); assert.equal(b.logo.synthesized, false);
// origins, site, voice (full mode)
assert.equal(b.origins.length, 1); assert.deepEqual(b.origins[0], { origin: 'https://example.com', role: 'primary', pagesCaptured: 3, contributedSignals: [] });
assert.equal(b.site.name, 'Example'); assert.equal(b.site.originUrl, 'https://example.com');
assert.equal(b.voice.heroHeadline, 'Build, ship, and own your work'); assert.equal(b.voice.heroImage.url, 'https://example.com/img/hero.jpg', 'largest first-viewport image is the hero, not the wordmark');
assert.equal(b.voiceTable.ctaFrequency[0].label, 'Get started'); assert.equal(b.voiceTable.ctaFrequency[0].pageCount, 3);
assert.ok(!b.voiceTable.ctaFrequency.some((c) => /cookie/i.test(c.label)), 'CMP label is not a CTA sample');
assert.ok(['brand', 'product', 'ambiguous'].includes(b.register));
assert.equal(b.crossPromo.detected, false, 'footer headings are system components, not a cross-promo anchor');

// --bounded on the same set: voice/voiceTable/crossPromo/register omitted, mode stamped
const out2 = fresh('modular');
assert.equal(run(['--out', out2, '--bounded']).code, 0);
const bb = readJson(join(out2, '_brand-extraction.json'));
assert.equal(bb._provenance.mode, 'bounded'); for (const k of ['voice', 'voiceTable', 'crossPromo', 'register']) assert.ok(!(k in bb), `${k} omitted under --bounded`);
assert.ok(bb._provenance.notes.some((n) => /^bounded: 3 page\(s\)/.test(n))); assert.deepEqual(bb._provenance.synthesizedInputs, []);
assert.equal(bb.palette.length, b.palette.length, 'palette/type/motifs still aggregated under --bounded');

// --home home legacy alias (D6): index.json absent, home.json present
const out3 = fresh('modular'); const idx = readJson(join(out3, 'pages', 'index.json')); idx.slug = 'home'; writeFileSync(join(out3, 'pages', 'home.json'), JSON.stringify(idx)); spawnSync('rm', [join(out3, 'pages', 'index.json')]);
const r3 = run(['--out', out3, '--home', 'home']); assert.equal(r3.code, 0, r3.out); assert.equal(readJson(join(out3, '_brand-extraction.json')).voice.heroHeadline, 'Build, ship, and own your work', 'home alias accepted');

// ---- ad-hoc set: auto-bounded from _crawl-log.json (--pages run), ad-hoc scale, inline-svg wordmark (step 1) written to assets/logo.svg
const out4 = fresh('ad-hoc');
const r4 = run(['--out', out4]); assert.equal(r4.code, 0, r4.out);
const a = readJson(join(out4, '_brand-extraction.json'));
assert.equal(a._provenance.mode, 'bounded', 'auto-bounded when runs[last].args.pages is non-null'); assert.ok(!('voice' in a) && !('register' in a));
assert.equal(a.type.scaleAudit.kind, 'ad-hoc'); assert.equal(a.type.scaleAudit.matchedScale, null); assert.equal(a.type.scaleRatio, null); assert.deepEqual(a.type.scaleAudit.ratios, [1.333, 1.406, 1.6]);
assert.deepEqual(a.type.files, [], 'no manifest → files []'); assert.ok(a._provenance.notes.some((n) => /_fonts-manifest\.json absent/.test(n)));
assert.equal(a.logo.source, 'inline-svg'); assert.equal(a.logo.step, '1'); assert.equal(a.logo.intrinsicWidth, 160); assert.ok(existsSync(join(out4, 'assets', 'logo.svg')), 'assets/logo.svg written from the sidecar markup');
assert.match(readFileSync(join(out4, 'assets', 'logo.svg'), 'utf8'), /^<svg viewBox="0 0 160 40"/);
assert.deepEqual(a.systemComponents, []); assert.ok(a._provenance.notes.some((n) => /requires ≥ 3 pages/.test(n)));
assert.equal(a.motifs.borderRadius.primary, '3px'); assert.equal(a.motifs.gradients.length, 1);
assert.equal(a.spacing.baseUnit, null, '70/50 px paddings → no 4/8 rhythm'); assert.deepEqual(a.spacing.scale, []);

// ---- exits: dry-run writes nothing · no live record → 1 · usage → 2 · --help → 0
const out5 = fresh('ad-hoc'); const r5 = run(['--out', out5, '--dry-run']); assert.equal(r5.code, 0); assert.ok(!existsSync(join(out5, '_brand-extraction.json')), 'dry-run writes nothing'); assert.match(r5.out, /"mode": "bounded"/);
const out6 = fresh('ad-hoc'); const dead = readJson(join(out6, 'pages', 'index.json')); delete dead._provenance.renderedBy; writeFileSync(join(out6, 'pages', 'index.json'), JSON.stringify(dead)); spawnSync('rm', [join(out6, 'pages', 'about.json')]);
const r6 = run(['--out', out6]); assert.equal(r6.code, 1, 'every record failing provenance → exit 1'); assert.match(r6.out, /no live page record/);
const empty = mkdtempSync(join(tmpdir(), 'brand-surface-empty-')); mkdirSync(join(empty, 'pages')); assert.equal(run(['--out', empty]).code, 1, 'empty pages dir → exit 1');
assert.equal(run(['--out', out, '--bogus']).code, 2, 'unknown flag → exit 2'); assert.equal(run(['--out', join(empty, 'nope')]).code, 2, 'missing --out dir → exit 2');
assert.equal(run(['--help']).code, 0);

console.log('brand-surface test: ok');
