#!/usr/bin/env node
// Fixture test: skills/extract/scripts/brand-review.mjs (extract/reference/brand-review-template.md is
// the rule) — each of the 13 detectors with a triggering and a non-triggering input, card consolidation
// (> 3 → 1), sections without data omitted, `<!-- stardust:provenance -->` first head child, no
// `<script`, no external font unless the captured home page loads one, exit 2 without
// _brand-extraction.json or without its _provenance, --help exits 0. Runs brand-surface.mjs on the
// modular fixture first so the review renders from a real brand surface. No browser.
// Usage: node plugins/stardust/evals/fixtures/brand-review.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDetectors, consolidate, cssVars, renderReview, DETECTOR_IDS } from '../../skills/extract/scripts/brand-review.mjs';

const SCRIPTS = join(import.meta.dirname, '..', '..', 'skills', 'extract', 'scripts');
const FIX = join(import.meta.dirname, '..', 'lint', 'fixtures', 'brand-surface');
const run = (script, args) => { const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const fired = (brand, pages) => new Set(runDetectors(brand, pages).map((t) => t.id));
const base = () => ({ _provenance: { writtenBy: 'stardust:extract', writtenAt: '2026-09-18T09:10:00Z', script: 'brand-surface.mjs', mode: 'full', notes: [] }, site: { name: 'Example', originUrl: 'https://example.com', tagline: 'Ship your work' }, palette: [{ role: 'background', value: '#ffffff', occurrences: 600, usedAs: ['background'], sourceSelectors: ['body'], sources: ['index'] }, { role: 'text-primary', value: '#0f1217', occurrences: 400, usedAs: ['text'], sourceSelectors: ['h1'], sources: ['index'] }, { role: 'primary', value: '#147aff', occurrences: 100, usedAs: ['background', 'text'], sourceSelectors: ['a.btn'], sources: ['index'] }], type: { headingFamily: { name: 'Example Sans', stack: '"Example Sans"', weights: [700], sizes: ['48px', '38.4px'], lineHeights: [1.1] }, bodyFamily: { name: 'Example Text', stack: '"Example Text", sans-serif' }, scaleAudit: { kind: 'modular', ratios: [1.25], matchedScale: 'major-third' }, files: [] }, motifs: { borderRadius: { primary: '8px', occurrences: { '8px': 60 } }, shadows: [], gradients: [], patterns: [] }, logo: { source: 'img', step: '1b', sourceSelector: 'img[src="https://example.com/w.svg"]', url: 'https://example.com/w.svg', alt: 'Example', format: 'svg' }, voice: { heroHeadline: 'Build, ship, and own your work', firstParagraph: 'One platform.', tone: { guess: 'professional-warm', evidence: 'x' } }, voiceTable: { ctaFrequency: [], headingFrequency: [], toneMetrics: { headingsUppercasePercent: 0, distinctHeadings: 3, distinctCtaLabels: 2 } }, crossPromo: { detected: false }, systemComponents: [], spacing: { baseUnit: 8, scale: [8, 16, 24] } });
const page = (over = {}) => ({ slug: 'index', title: 'Example', screenshot: 'assets/screenshots/index.png', ctas: [{ label: 'Get started', domPath: 'header > a' }], links: { internal: [{ href: '/pricing', text: 'Pricing', domPath: 'header > nav > a' }], external: [] }, cssCustomProperties: [{ name: '--ex-primary', value: '#147aff' }], media: { images: [{ src: 'a.jpg', alt: 'Two engineers at a whiteboard' }, { src: 'b.jpg', alt: 'A team lunch' }, { src: 'c.jpg', alt: 'Office' }] }, embedDominance: { dominated: false }, landmarks: [], headings: [], components: {}, _provenance: { waitMode: 'medium', waitMs: 2500 }, ...over });

// ---- doc pins (D3): brand-review-template.md names the renderer and the real T-logo-variants trigger ----
const tpl = readFileSync(join(import.meta.dirname, '..', '..', 'skills', 'extract', 'reference', 'brand-review-template.md'), 'utf8');
assert.match(tpl, /\*\*Renderer\.\*\* `skills\/extract\/scripts\/brand-review\.mjs --out/, 'template § Output names brand-review.mjs as the renderer');
assert.match(tpl, /exit 2 without `_brand-extraction\.json`/, 'template states exit 2 without the brand surface');
assert.ok(!/Always emits/.test(tpl), 'T-logo-variants no longer "Always emits"');
assert.match(tpl, /`T-logo-variants` \|[^\n]*`step` is below `1b`/, 'T-logo-variants trigger = chain landed below step 1b');

// ---- the 13 detectors: triggering vs non-triggering ----
const quiet = fired(base(), [page()]);
assert.deepEqual([...quiet], [], `clean brand + clean page fires nothing, got ${[...quiet]}`);
const T = (mut, pagesMut = (p) => [p]) => { const b = base(); mut(b); return fired(b, pagesMut(page())); };
assert.ok(T((b) => { b.type.scaleAudit = { kind: 'ad-hoc', ratios: [1.33, 1.6], matchedScale: null }; }).has('T-scale'), 'T-scale fires on ad-hoc');
assert.ok(T((b) => { b.motifs.borderRadius.occurrences = { '2px': 30, '4px': 20, '8px': 12, '16px': 40 }; }).has('T-radius-vocab'), 'T-radius-vocab: 3 small radii with ≥ 10 occurrences');
assert.ok(!T((b) => { b.motifs.borderRadius.occurrences = { '2px': 30, '4px': 20, '8px': 9, '16px': 40 }; }).has('T-radius-vocab'), 'T-radius-vocab quiet with only 2 qualifying radii');
assert.ok(T(() => {}, (p) => [page({ ctas: [{ label: 'Learn more' }, { label: 'Read more' }] })]).has('T-cta-vocab'), 'T-cta-vocab: two see-more labels');
assert.ok(!T(() => {}, () => [page({ ctas: [{ label: 'Learn more' }, { label: 'Get started' }] })]).has('T-cta-vocab'), 'T-cta-vocab quiet across buckets');
assert.ok(T(() => {}, () => [page({ links: { internal: [{ text: 'click here', href: '/x', domPath: 'main > a' }], external: [] } })]).has('T-link-content-free'), 'T-link-content-free: "click here"');
assert.ok(T((b) => { b.logo = { source: 'apple-touch-icon', step: '3', sourceSelector: '/apple-touch-icon.png' }; }).has('T-logo-variants'), 'T-logo-variants fires when the chain landed below step 1b');
assert.ok(!T((b) => { b.logo.source = 'inline-svg'; b.logo.step = '1'; }).has('T-logo-variants'), 'T-logo-variants quiet on a banner wordmark');
assert.ok(T((b) => { b.palette.push({ role: 'accent-1', value: '#e63946', occurrences: 40, usedAs: ['text'], sourceSelectors: ['h2'], sources: ['index'] }); }).has('T-color-imbalance'), 'T-color-imbalance: accent used as text only');
assert.ok(!T((b) => { b.palette.push({ role: 'text-secondary', value: '#5b6470', occurrences: 40, usedAs: ['text'], sourceSelectors: ['p'], sources: ['index'] }); }).has('T-color-imbalance'), 'T-color-imbalance skips text-secondary');
assert.ok(T(() => {}, () => [page({ cssCustomProperties: [] }), page({ slug: 'about', cssCustomProperties: [] })]).has('T-no-tokens'), 'T-no-tokens: empty on every page');
assert.ok(!T(() => {}, () => [page({ cssCustomProperties: [] }), page({ slug: 'about' })]).has('T-no-tokens'), 'T-no-tokens quiet when one page has tokens');
assert.ok(T(() => {}, () => [page({ cssCustomProperties: [{ name: '--primary', value: '#007bff' }] })]).has('T-tokens-unused'), 'T-tokens-unused: Bootstrap default --primary vs brand #147aff');
assert.ok(!T(() => {}, () => [page({ cssCustomProperties: [{ name: '--primary', value: '#147aff' }] })]).has('T-tokens-unused'), 'T-tokens-unused quiet when the token matches the brand');
assert.ok(T(() => {}, () => [page({ media: { images: [{ alt: 'Logo' }, { alt: 'A team' }] } })]).has('T-img-alt-generic'), 'T-img-alt-generic: alt "Logo"');
assert.ok(T(() => {}, () => [page({ embedDominance: { dominated: true, iframeSrc: 'https://app.datawrapper.de/x' } })]).has('T-embed-dominance'), 'T-embed-dominance');
assert.ok(T(() => {}, () => [page({ media: { images: [{ alt: '' }, { alt: ' ' }, { alt: 'ok' }] } })]).has('T-img-alt-empty'), 'T-img-alt-empty: 66 % empty');
assert.ok(!T(() => {}, () => [page({ media: { images: [{ alt: '' }, { alt: 'a' }, { alt: 'b' }, { alt: 'c' }] } })]).has('T-img-alt-empty'), 'T-img-alt-empty quiet at 25 %');
assert.ok(T(() => {}, () => [page({ links: { internal: [{ text: 'Sign in', domPath: 'header > nav > a' }, { text: 'Log in', domPath: 'header > nav > a:nth-child(2)' }], external: [] } })]).has('T-nav-conflict'), 'T-nav-conflict: sign in ↔ log in');
assert.ok(!T(() => {}, () => [page({ links: { internal: [{ text: 'Sign in', domPath: 'footer > a' }, { text: 'Log in', domPath: 'footer > a' }], external: [] } })]).has('T-nav-conflict'), 'T-nav-conflict reads the top nav only');
assert.ok(T((b) => { b.voice.heroHeadline = 'Celebrating our 25th anniversary'; }).has('T-temporal-mark'), 'T-temporal-mark: anniversary in the hero');
assert.equal(DETECTOR_IDS.length, 13);
// consolidation: 5 imbalance cards → 1
const many = base(); for (let i = 0; i < 5; i += 1) many.palette.push({ role: `accent-${i + 1}`, value: `#e6394${i}`, occurrences: 10, usedAs: ['text'], sourceSelectors: ['h2'], sources: ['index'] });
const cards = runDetectors(many, [page()]); assert.equal(cards.filter((c) => c.id === 'T-color-imbalance').length, 5);
const cons = consolidate(cards); assert.equal(cons.filter((c) => c.id === 'T-color-imbalance').length, 1, 'consolidated to one card'); assert.match(cons.find((c) => c.id === 'T-color-imbalance').body, /5 matches/);
// css vars: saturated primary, hue-anchored dark, fallback chain on a desaturated brand
const vars = cssVars({ palette: [{ role: 'background', value: '#ffffff' }, { role: 'primary', value: '#e63946', usedAs: ['background'] }, { role: 'accent-1', value: '#b91c2a' }, { role: 'accent-2', value: '#1d7a5f' }], type: { headingFamily: { name: 'Example Sans', stack: '"Example Sans"' }, bodyFamily: { stack: 'Arial, sans-serif' } } });
assert.equal(vars.vars['--primary'], '#e63946'); assert.equal(vars.vars['--primary-dark'], '#b91c2a', 'same hue family, darker'); assert.equal(vars.vars['--accent'], '#1d7a5f', '≥ 60° away');
assert.match(vars.vars['--display'], /"Example Sans", -apple-system/, 'bare stack gets a system fallback chain'); assert.equal(vars.vars['--body'], 'Arial, sans-serif', 'a terminated stack passes through');
const grey = cssVars({ palette: [{ role: 'background', value: '#ffffff' }, { role: 'text-primary', value: '#222222' }], type: {} });
assert.equal(grey.vars['--primary'], '#147aff'); assert.ok(grey.notes.some((n) => /falls back/.test(n)), 'desaturated brand → documented default + note');
// render: omitted sections, provenance first, no scripts / fonts
const r = renderReview(base(), [page()], null, { outDir: 'stardust/current' });
assert.match(r.html, /^<!DOCTYPE html>\n<html lang="en">\n<head>\n<!-- stardust:provenance\n/, 'provenance comment is the first head child');
assert.ok(!/<script/i.test(r.html), 'no script'); assert.ok(!/<link/i.test(r.html), 'no external font link by default');
assert.ok(!r.html.includes('id="cross-promo"') && !r.html.includes('id="embeds"') && !r.html.includes('id="system-components"'), 'sections without data are omitted');
assert.ok(r.html.includes('id="tensions"'), 'tensions section renders even when empty');
const order = ['coverage', 'pages', 'palette', 'typography', 'voice', 'tensions', 'motifs', 'logo', 'spacing'].map((id) => r.html.indexOf(`id="${id}"`)); assert.deepEqual([...order].sort((a, b) => a - b), order, 'canonical section order');
const rb = renderReview({ ...base(), voice: undefined, voiceTable: undefined, _provenance: { ...base()._provenance, mode: 'bounded' } }, [], null); assert.ok(!rb.html.includes('id="voice"') && !rb.html.includes('id="pages"'), 'bounded surface: voice + pages omitted, not fabricated');
assert.ok(renderReview(base(), [], null, { fontLink: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">' }).html.includes('fonts.googleapis.com'), 'a font <link> the site loads is mirrored');

// ---- end to end on the modular fixture ----
const d = mkdtempSync(join(tmpdir(), 'brand-review-')); const out = join(d, 'current'); cpSync(join(FIX, 'modular'), out, { recursive: true });
assert.equal(run('brand-review.mjs', ['--out', out]).code, 2, 'exit 2 without _brand-extraction.json');
assert.equal(run('brand-surface.mjs', ['--out', out]).code, 0);
const e2e = run('brand-review.mjs', ['--out', out]); assert.equal(e2e.code, 0, e2e.out);
for (const id of DETECTOR_IDS) assert.match(e2e.out, new RegExp(`^${id}: (fired|quiet)$`, 'm'), `${id} result printed`);
assert.match(e2e.out, /^T-img-alt-generic: fired$/m, 'about.json carries alt "photo"');
const html = readFileSync(join(out, 'brand-review.html'), 'utf8');
assert.match(html, /<head>\n<!-- stardust:provenance/); assert.ok(!/<script/i.test(html)); assert.ok(!/<link\b/i.test(html), 'modular home loads no external font → none in the review');
assert.ok(html.includes('id="system-components"') && html.includes('site-header'), 'system components rendered from the brand surface');
assert.ok(html.includes('assets/screenshots/index.png'), 'screenshot grid from pages/*.json');
assert.ok(html.includes('--primary:#147aff'), 'brand colour drives the chrome');
// ad-hoc home page loads Google Fonts → the same <link> is mirrored
const d2 = mkdtempSync(join(tmpdir(), 'brand-review-')); const out2 = join(d2, 'current'); cpSync(join(FIX, 'ad-hoc'), out2, { recursive: true });
assert.equal(run('brand-surface.mjs', ['--out', out2]).code, 0); const e2 = run('brand-review.mjs', ['--out', out2]); assert.equal(e2.code, 0);
assert.match(readFileSync(join(out2, 'brand-review.html'), 'utf8'), /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/); assert.match(e2.out, /^T-scale: fired$/m);
// exit 2 when _provenance is missing; dry-run writes nothing; --help
writeFileSync(join(out2, '_brand-extraction.json'), JSON.stringify({ palette: [] })); assert.equal(run('brand-review.mjs', ['--out', out2]).code, 2, 'exit 2 without _provenance');
rmSync(join(out, 'brand-review.html')); assert.equal(run('brand-review.mjs', ['--out', out, '--dry-run']).code, 0); assert.ok(!existsSync(join(out, 'brand-review.html')), 'dry-run writes nothing');
assert.equal(run('brand-review.mjs', ['--help']).code, 0); assert.equal(run('brand-review.mjs', ['--nope']).code, 2);
const d4 = run('brand-review.mjs', ['--out', '--dry-run']); assert.equal(d4.code, 2, 'D4: --out followed by a flag is a usage error (not a swallowed --dry-run)'); assert.match(d4.out, /--out needs a value/, 'D4: refused as usage, not as a missing brand file');

console.log('brand-review test: ok');
