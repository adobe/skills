#!/usr/bin/env node
// skills/extract/scripts/test/style-census.test.mjs — the style-census.mjs contract. Part (a): the pure
// aggregate (colour parsing + clustering, roles and sources, type families/sizes/levels, motifs, hover
// deltas, the logo chain, icon font, order independence), argument parsing and the page list — no
// browser. Part (b): end-to-end against a fixture site served from this process (two pages, known
// colours/fonts/radius/shadow/gradient/hover, a consent overlay, an inline SVG logo) — runs only where
// playwright is importable, prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, clusterColors, parseColor, toHex, parseArgs, listUrls, UsageError, DEFAULTS, DEFAULT_UA } from '../style-census.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'style-census.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'style-census-test-')));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const run = (args, cwd = root) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd }); return { code: r.status, out: r.stdout, err: r.stderr }; };

// ---- fixture census records (the shape census() returns) --------------------------------------------
const hist = (value, count, area, ...sources) => ({ value, count, area, sources });
const heading = (tag, fontSize, fontWeight, fontFamily, color = 'rgb(17, 17, 17)') => ({ tag, text: `${tag} text`, selector: `main > ${tag}`, fontFamily, fontSize, fontWeight, lineHeight: '1.2', letterSpacing: 'normal', textTransform: 'none', color });
const button = (bg, hoverBg, count = 1, sel = 'main > a') => ({ text: 'Go', selector: sel, count, backgroundColor: bg, color: 'rgb(255, 255, 255)', borderRadius: '8px', padding: '12px 24px', border: '0px none rgb(0, 0, 0)', borderColor: 'rgb(0, 0, 0)', boxShadow: 'none', fontFamily: '"Inter", sans-serif', fontSize: '14px', fontWeight: '600', textTransform: 'none', letterSpacing: 'normal', hover: hoverBg ? { backgroundColor: hoverBg, color: 'rgb(255, 255, 255)', borderColor: 'rgb(0, 0, 0)', boxShadow: 'none', changed: hoverBg !== bg } : null });
const base = () => ({
  title: 'p', viewport: { width: 1440, height: 900 }, elements: { total: 100, visible: 90 }, occluders: [],
  headings: [heading('h1', '60px', '700', '"Söhne", system-ui'), heading('h1', '60px', '700', '"Söhne", system-ui'), ...Array.from({ length: 20 }, () => heading('h1', '18px', '400', '"Söhne", system-ui')), heading('h2', '36px', '700', '"Söhne", system-ui')],
  text: [{ tag: 'p', text: 'body copy body copy body copy', selector: 'main > p', fontFamily: '"Inter", sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '24px', letterSpacing: 'normal', textTransform: 'none', color: 'rgb(17, 17, 17)' }],
  buttons: [button('rgb(20, 122, 255)', 'rgb(0, 90, 200)', 3), button('rgb(255, 255, 255)', 'rgb(255, 255, 255)', 5, 'main > a:nth-of-type(2)'), button('rgb(230, 0, 60)', null, 1, 'main > a:nth-of-type(3)')],
  links: [{ text: 'more', selector: 'main > p > a', count: 4, color: 'rgb(0, 100, 200)', textDecoration: 'underline', fontWeight: '400', hover: { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 60, 120)', borderColor: 'rgb(0, 0, 0)', boxShadow: 'none', changed: true } }],
  surfaces: [],
  radii: [hist('8px', 10, 5000, 'main > div'), hist('16px', 3, 900000, 'main > section'), hist('9999px', 2, 800, 'main > span')],
  shadows: [hist('0px 1px 2px rgba(0, 0, 0, 0.06)', 9, 0, 'main > a'), hist('0px 4px 16px rgba(0, 0, 0, 0.08)', 4, 0, 'main > div'), hist('0px 24px 48px rgba(0, 0, 0, 0.12)', 2, 0, 'main > aside'), hist('0px 0px 0px 1px rgb(0, 0, 0)', 1, 0, 'main > input')],
  gradients: [hist('linear-gradient(135deg, rgb(20, 122, 255) 0%, rgb(107, 33, 255) 100%)', 1, 300000, 'main > section:nth-of-type(1)')],
  bgColors: [hist('rgb(255, 255, 255)', 3, 1200000, 'body'), hist('rgb(250, 250, 250)', 2, 1000, 'main > section:nth-of-type(2)'), hist('rgb(240, 242, 245)', 4, 300000, 'footer'), hist('rgb(20, 122, 255)', 3, 3000, 'main > a')],
  textColors: [hist('rgb(17, 17, 17)', 40, 0, 'main > p'), hist('rgb(255, 255, 255)', 5, 0, 'main > a')],
  borderColors: [hist('rgb(200, 204, 210)', 12, 0, 'main > div')],
  customProps: { '--brand': { declared: '#147aff', computed: '#147aff' } }, fonts: [{ family: 'Inter', weight: '400', style: 'normal', status: 'loaded' }],
  logoCandidates: [{ tag: 'img', selector: 'header > img', src: 'https://x.test/tiny-logo.png', alt: 'logo', class: '', id: null, href: null, inHomeLink: false, rect: { x: 0, y: 0, w: 24, h: 24 } }],
  iconFont: null,
});
const home = base();
home.logoCandidates.push({ tag: 'svg', selector: 'header > a > svg', inlineSvg: true, hasText: false, viewBox: '0 0 120 40', ariaLabel: null, class: '', id: null, href: '/', inHomeLink: true, rect: { x: 0, y: 8, w: 120, h: 40 } }, { tag: 'img', selector: 'header > a:nth-of-type(2) > img', src: 'https://x.test/brand-logo.svg', alt: 'Brand', class: 'site-logo', id: null, href: '/', inHomeLink: true, rect: { x: 0, y: 8, w: 120, h: 48 } });
const about = base();
about.gradients = [hist('linear-gradient(135deg, rgb(20, 122, 255) 0%, rgb(107, 33, 255) 100%)', 2, 100000, 'main > section:nth-of-type(3)')];
about.iconFont = { families: ['icomoon'], glyphs: [{ class: 'icon icon-search', pseudo: '::before', codepoint: 'U+E928', fontFamily: 'icomoon' }] };
const pages = { 'https://x.test/about': { 1440: about }, 'https://x.test/': { 1440: home, 360: base() } };

// ---- part (a): pure ------------------------------------------------------------------------------------
await check('parseColor: rgb/rgba/percent alpha/color(srgb); alpha 0 and junk are not colours; toHex incl. alpha suffix', () => {
  assert.deepEqual(parseColor('rgb(20, 122, 255)'), { r: 20, g: 122, b: 255, a: 1 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('rgba(0, 0, 0, 0)'), null); assert.equal(parseColor('transparent'), null); assert.equal(parseColor('currentcolor'), null); assert.equal(parseColor(null), null);
  assert.deepEqual(parseColor('color(srgb 1 0 0 / 50%)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(toHex(parseColor('rgb(20, 122, 255)')), '#147aff'); assert.equal(toHex(parseColor('rgba(0, 0, 0, 0.5)')), '#00000080');
});
await check('clusterColors: ≤12 per channel merges onto the heaviest member, >12 stays apart, alpha 0 dropped, sources capped at 5 and deduped, input order irrelevant', () => {
  const samples = [
    { value: 'rgb(250, 250, 250)', weight: 2, area: 10, prop: 'background', url: 'u', selector: 's1' },
    { value: 'rgb(255, 255, 255)', weight: 9, area: 99, prop: 'background', url: 'u', selector: 's2' },
    { value: 'rgb(20, 20, 20)', weight: 3, prop: 'text', url: 'u', selector: 's3' },
    { value: 'rgb(40, 40, 40)', weight: 1, prop: 'text', url: 'u', selector: 's4' },
    { value: 'rgba(0, 0, 0, 0)', weight: 99, prop: 'background', url: 'u', selector: 's5' },
    ...Array.from({ length: 7 }, (_, i) => ({ value: 'rgb(255, 255, 255)', weight: 1, prop: 'text', url: `u${i}`, selector: 's2' })),
  ];
  const c = clusterColors(samples);
  assert.deepEqual(c.map((k) => k.hex), ['#ffffff', '#141414', '#282828']);
  assert.equal(c[0].weight, 18); assert.deepEqual(c[0].values, ['rgb(255, 255, 255)', 'rgb(250, 250, 250)']); assert.equal(c[0].by.background, 11); assert.equal(c[0].by.text, 7);
  assert.equal(c[0].sources.length, 5); assert.deepEqual(c[0].sources[0], { url: 'u', selector: 's2', prop: 'background' });
  assert.deepEqual(clusterColors([...samples].reverse()), c, 'order-independent');
});
const agg = aggregate(pages);
await check('aggregate.colors: roles — background (largest area), surface (next), text, primary (top button bg that is not the background), secondary, accent (link), border, heading; sources carry url/selector/prop', () => {
  const byRole = (r) => agg.colors.find((c) => c.roles.includes(r));
  assert.equal(byRole('background').hex, '#ffffff'); assert.equal(byRole('surface').hex, '#f0f2f5', 'a grey 15 from white stays its own cluster; one within 12 would merge into the background'); assert.equal(byRole('text').hex, '#111111'); assert.equal(byRole('heading').hex, '#111111');
  assert.equal(byRole('primary').hex, '#147aff', 'the white ghost button (5×) is the background, not the primary');
  assert.equal(byRole('secondary').hex, '#e6003c'); assert.equal(byRole('accent').hex, '#0064c8'); assert.equal(byRole('border').hex, '#c8ccd2');
  const firstBare = agg.colors.findIndex((k) => !k.roles.length); assert.ok(firstBare === -1 || agg.colors.slice(firstBare).every((c) => !c.roles.length), 'role-bearing clusters come first');
  const src = byRole('primary').sources; assert.ok(src.length && src.length <= 5); assert.deepEqual(Object.keys(src[0]), ['url', 'selector', 'prop']); assert.equal(src[0].url, 'https://x.test/');
  assert.ok(!agg.colors.some((c) => c.values.some((v) => /rgba\(0, 0, 0, 0\)/.test(v))), 'alpha 0 never enters');
});
await check('aggregate.type: families split headings/text, heading vs body family, sizes desc with where they occur, weights, per-level weighted score beats hidden-h1 mode', () => {
  assert.equal(agg.type.headingFamily, 'Söhne'); assert.equal(agg.type.bodyFamily, 'Inter');
  const s = agg.type.families.find((f) => f.family === 'Söhne'); assert.equal(s.headings, 69); assert.equal(s.text, 0);
  assert.deepEqual(agg.type.sizes.map((x) => x.px), [60, 36, 18, 16, 14]); assert.equal(agg.type.sizes.find((x) => x.px === 16).text, 3); assert.equal(agg.type.sizes.find((x) => x.px === 14).buttons, 27);
  assert.equal(agg.type.levels.h1.fontSize, 60, '2 visible 60px/700 h1s outscore 20 hidden 18px/400 ones'); assert.equal(agg.type.levels.h2.fontSize, 36);
  assert.equal(agg.type.weights[0].weight, '400');
});
await check('aggregate.motifs: radius mode by element count vs area mode, pill separate, shadows top 3 of 4, gradients merged across pages with summed counts and sources', () => {
  assert.equal(agg.motifs.radius.mode, '8px'); assert.equal(agg.motifs.radius.areaMode, '16px'); assert.equal(agg.motifs.radius.pill, '9999px');
  assert.equal(agg.motifs.radius.values[0].count, 30);
  assert.equal(agg.motifs.shadows.length, 3); assert.equal(agg.motifs.shadows[0].value, '0px 1px 2px rgba(0, 0, 0, 0.06)'); assert.equal(agg.motifs.shadows[0].count, 27);
  assert.equal(agg.motifs.gradients.length, 1); assert.equal(agg.motifs.gradients[0].count, 4); assert.equal(agg.motifs.gradients[0].sources.length, 2, 'same url + selector at two widths is one source');
});
await check('aggregate.hover: distinct button/link deltas, unchanged and null hovers skipped, counts across pages', () => {
  assert.equal(agg.hover.length, 2);
  const b = agg.hover.find((h) => h.kind === 'button'); assert.deepEqual(b.from, { backgroundColor: 'rgb(20, 122, 255)' }); assert.deepEqual(b.to, { backgroundColor: 'rgb(0, 90, 200)' }); assert.equal(b.count, 3);
  const l = agg.hover.find((h) => h.kind === 'link'); assert.deepEqual(l.to, { color: 'rgb(0, 60, 120)' });
});
await check('aggregate.logo: inline SVG in the home link wins over the logo-ish img; without it the img; a 24px icon is none. iconFont unions pages. counts.', () => {
  assert.equal(agg.logo.source, 'inline-svg'); assert.equal(agg.logo.selector, 'header > a > svg'); assert.equal(agg.logo.url, 'https://x.test/');
  const noSvg = structuredClone(pages); noSvg['https://x.test/'][1440].logoCandidates = home.logoCandidates.filter((c) => !c.inlineSvg);
  const l2 = aggregate(noSvg).logo; assert.equal(l2.source, 'img'); assert.equal(l2.src, 'https://x.test/brand-logo.svg');
  assert.equal(aggregate({ 'https://x.test/about': { 1440: about } }).logo.source, 'none');
  assert.deepEqual(agg.iconFont.families, ['icomoon']); assert.equal(agg.iconFont.glyphs[0].codepoint, 'U+E928'); assert.equal(aggregate({ 'https://x.test/': { 1440: home } }).iconFont, null);
  assert.deepEqual(agg.counts, { pages: 2, widths: [360, 1440], measurements: 3 });
});
await check('aggregate is deterministic: reversed page/width key order gives a deep-equal result', () => {
  const reversed = Object.fromEntries(Object.entries(pages).reverse().map(([u, w]) => [u, Object.fromEntries(Object.entries(w).reverse())]));
  assert.deepEqual(aggregate(reversed), agg);
});
await check('parseArgs: defaults, repeatable + comma widths deduped, usage errors', () => {
  const d = parseArgs([]); assert.equal(d.pages, DEFAULTS.pages); assert.equal(d.out, DEFAULTS.out); assert.deepEqual(d.widths, [1440]); assert.equal(d.concurrency, 1, 'one live page at a time — the census is a full live pass'); assert.equal(d.maxPages, Infinity); assert.equal(d.timeoutMs, 20000); assert.equal(d.ua, DEFAULT_UA); assert.match(DEFAULT_UA, /^Mozilla\/5\.0 \(Macintosh.*Chrome\/\d+/);
  assert.deepEqual(d.dismiss, []); assert.equal(d.headed, false); assert.equal(d.locale, null);
  assert.deepEqual(parseArgs(['--width', '360,1440', '--width', '1440']).widths, [360, 1440]);
  assert.deepEqual(parseArgs(['--urls', 'https://a.test/, https://b.test/x']).urls, ['https://a.test/', 'https://b.test/x']);
  const l = parseArgs(['--concurrency', '2', '--dismiss', '.close, .later', '--dismiss', '#x', '--headed', '--locale', 'en-GB']);
  assert.equal(l.concurrency, 2); assert.deepEqual(l.dismiss, ['.close', '.later', '#x']); assert.equal(l.headed, true); assert.equal(l.locale, 'en-GB');
  assert.deepEqual(DEFAULTS.dismiss, [], 'parseArgs never mutates the shared default list');
  for (const bad of [['--bogus'], ['--width'], ['--width', 'wide'], ['--width', '100'], ['--concurrency', '0'], ['--timeout-ms', '10'], ['--pages', 'p', '--urls', 'https://a.test/'], ['--urls', '']]) assert.throws(() => parseArgs(bad), UsageError, bad.join(' '));
});
await check('parseArgs: a value flag followed by nothing or by another --flag is a usage error naming the flag (never swallows the flag)', () => {
  for (const [flag, ...tail] of [['--pages'], ['--urls'], ['--out'], ['--width'], ['--concurrency'], ['--max-pages'], ['--timeout-ms'], ['--ua'], ['--dismiss'], ['--locale'], ['--out', '--headed'], ['--concurrency', '--width', '360'], ['--urls', '--out', 'x.json'], ['--locale', '--headed']]) {
    assert.throws(() => parseArgs([flag, ...tail]), (e) => e instanceof UsageError && e.code === 2 && e.message.startsWith(`${flag} needs a value`), `${flag} ${tail.join(' ')}`);
  }
  const r = run(['--out', '--headed']); assert.equal(r.code, 2); assert.match(r.err, /style-census: --out needs a value/);
  assert.ok(existsSync(join(HERE, '..', '..', '..', 'diff', 'scripts', 'live-session.mjs')), 'the plugin-tree layout the script resolves first');
});
await check('listUrls: finalUrl over url, non-records skipped, deduped in file order, --max-pages, missing dir and bad URL are usage errors', () => {
  const dir = join(root, 'pages'); mkdirSync(dir);
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ url: 'https://x.test/b', finalUrl: 'https://x.test/b/' }));
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ url: 'https://x.test/' }));
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ url: 'https://x.test/' }));
  writeFileSync(join(dir, 'z.json'), '{"not":"a record"}'); writeFileSync(join(dir, 'a.html'), '<html></html>');
  assert.deepEqual(listUrls(parseArgs(['--pages', dir])), ['https://x.test/', 'https://x.test/b/']);
  assert.deepEqual(listUrls(parseArgs(['--pages', dir, '--max-pages', '1'])), ['https://x.test/']);
  assert.throws(() => listUrls(parseArgs(['--pages', join(root, 'nope')])), /not a directory/);
  assert.throws(() => listUrls(parseArgs(['--urls', 'not a url'])), /not a URL/);
});
await check('CLI: --help exits 0 with Usage + Writes before any work; usage errors exit 2 and write nothing', () => {
  const h = run(['--help']); assert.equal(h.code, 0); assert.match(h.out, /Usage:/); assert.match(h.out, /Writes \(nothing else\):/); assert.match(h.out, /--max-pages/);
  const e = run(['--bogus']); assert.equal(e.code, 2); assert.match(e.err, /unknown argument --bogus/);
  const m = run(['--pages', join(root, 'missing')]); assert.equal(m.code, 2); assert.match(m.err, /not a directory/);
});

// ---- part (b): end-to-end against a fixture site (needs playwright) --------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end census (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const CSS = `:root{--brand:#147aff;--radius:8px} body{margin:0;background:#ffffff;color:#111111;font-family:Georgia,serif;font-size:16px;line-height:1.5}
    header{background:#0b1f3a;padding:12px 24px;display:flex;gap:24px;align-items:center} header a{color:#fff} h1,h2,h3{font-family:Arial,sans-serif;margin:0 0 16px}
    h1{font-size:48px;font-weight:700} h2{font-size:32px;font-weight:700} main{max-width:1200px;margin:0 auto;padding:32px 24px}
    .hero{background-image:linear-gradient(135deg,#147aff,#6b21ff);padding:48px;color:#fff;border-radius:16px} main p a{color:#0064c8} main p a:hover{color:#003c78}
    .cta{display:inline-block;background:#147aff;color:#fff;padding:12px 24px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.06);font-family:Arial,sans-serif;font-weight:600;text-decoration:none} .cta:hover{background:#005ac8}
    .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px} .card{background:#f0f2f5;border:1px solid #c8ccd2;border-radius:8px;padding:24px}
    .icon-search::before{content:"\\e928";font-family:"my-icons"} footer{background:#0b1f3a;color:#fff;padding:40px 24px;margin-top:48px}`;
  const body = (title) => `<header><a href="/" aria-label="Home"><svg width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#147aff"/><text x="10" y="28" fill="#fff">Brand</text></svg></a><nav><a href="/about">About</a></nav></header>
    <main><section class="hero"><h1>${title}</h1><p>A hero paragraph with more than twenty characters in it.</p><a class="cta" href="/about">Get started</a></section>
    <section><h2>Cards</h2><div class="cards">${'<div class="card"><h3>Card</h3><p>Card copy that is comfortably longer than twenty characters. <a href="/about">Read more</a></p></div>'.repeat(3)}</div><span class="icon icon-search"></span></section></main>
    <footer><p>Footer copy that is longer than twenty characters too.</p></footer>`;
  const consent = '<div id="consent" style="position:fixed;inset:0;background:rgb(123, 45, 67);z-index:999;display:flex;align-items:center;justify-content:center"><div role="dialog"><p>We use cookies on this site.</p><button id="acc" style="padding:8px 16px">Accept all</button></div></div><script>document.getElementById("acc").onclick=()=>document.getElementById("consent").remove()</script>';
  const promo = '<div id="promo" style="position:fixed;inset:0;background:rgb(210, 20, 20);z-index:999"><p style="padding:40px">Subscribe to our newsletter today.</p></div>';
  const html = (title, extra) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${body(title)}${extra}</body></html>`;
  const server = createServer((req, res) => {
    if (req.url === '/') return res.setHeader('content-type', 'text/html').end(html('Home headline', consent));
    if (req.url === '/about') return res.setHeader('content-type', 'text/html').end(html('About headline', promo));
    res.statusCode = 404; return res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runAsync = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: root });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
  const outFile = join(root, 'census', '_computed-styles.json');
  const r = await runAsync(['--urls', `${origin}/,${origin}/about`, '--out', outFile, '--width', '1440', '--width', '360']);
  let doc = null;
  await check('e2e: exit 0, summary line, progress on stderr, the file and only the file written', () => {
    assert.equal(r.code, 0, r.err); assert.match(r.out, /^style-census: 2 pages × 2 widths → .*_computed-styles\.json\n$/); assert.match(r.err, /\[style-census\] OK {3}http:\/\/127\.0\.0\.1:\d+\/ @1440 /);
    doc = JSON.parse(readFileSync(outFile, 'utf8'));
    assert.equal(doc._provenance.writtenBy, 'stardust:extract'); assert.deepEqual(doc._provenance.widths, [1440, 360]); assert.deepEqual(doc._provenance.failed, []); assert.deepEqual(doc._provenance.synthesizedInputs, []); assert.equal(doc._provenance.readArtifacts.length, 2);
  });
  const home = () => doc.pages[`${origin}/`]['1440'];
  const about = () => doc.pages[`${origin}/about`]['1440'];
  await check('e2e page record: consent dismissed by its label, headings/text/buttons+hover/links+hover/surfaces/histograms/customProps/logo/iconFont carry the fixture values', () => {
    assert.equal(home().consent.dismissed, 'Accept all'); assert.deepEqual(home().occluders, []);
    const h1 = home().headings.find((h) => h.tag === 'h1'); assert.equal(h1.fontSize, '48px'); assert.equal(h1.fontWeight, '700'); assert.match(h1.fontFamily, /Arial/); assert.match(h1.selector, /^main > section:nth-of-type\(1\) > h1$/);
    assert.ok(home().text.length >= 3 && home().text.every((t) => t.text.length > 20)); assert.match(home().text[0].fontFamily, /Georgia/);
    const cta = home().buttons.find((b) => b.text === 'Get started'); assert.equal(cta.backgroundColor, 'rgb(20, 122, 255)'); assert.equal(cta.borderRadius, '8px'); assert.match(cta.boxShadow, /rgba\(0, 0, 0, 0\.06\)/); assert.equal(cta.hover.backgroundColor, 'rgb(0, 90, 200)'); assert.equal(cta.hover.changed, true);
    const link = home().links.find((l) => l.text === 'Read more'); assert.equal(link.color, 'rgb(0, 100, 200)'); assert.equal(link.count, 3); assert.equal(link.hover.color, 'rgb(0, 60, 120)');
    assert.equal(home().surfaces.find((s) => s.matched === 'header').backgroundColor, 'rgb(11, 31, 58)'); assert.ok(home().surfaces.some((s) => s.matched === 'main > *'));
    assert.ok(home().radii.some((x) => x.value === '8px' && x.count >= 4)); assert.ok(home().shadows.some((x) => /0\.06/.test(x.value))); assert.match(home().gradients[0].value, /^linear-gradient\(135deg, rgb\(20, 122, 255\), rgb\(107, 33, 255\)\)$/);
    assert.ok(home().bgColors.some((x) => x.value === 'rgb(240, 242, 245)' && x.count === 3)); assert.ok(home().borderColors.some((x) => x.value === 'rgb(200, 204, 210)'));
    assert.deepEqual(home().customProps['--brand'], { declared: '#147aff', computed: '#147aff' });
    const svg = home().logoCandidates.find((c) => c.inlineSvg); assert.equal(svg.inHomeLink, true); assert.equal(svg.hasText, true); assert.equal(svg.rect.w, 120);
    assert.equal(home().iconFont.glyphs[0].codepoint, 'U+E928'); assert.match(home().iconFont.glyphs[0].class, /icon-search/);
    assert.equal(doc.pages[`${origin}/`]['360'].viewport.width, 360);
  });
  await check('e2e overlays: the dismissed consent colour and the undismissed full-page promo (excluded as an occluder) are NOT in the palette', () => {
    assert.equal(about().occluders.length, 1); assert.ok(about().occluders[0].coverage >= 0.9); assert.equal(about().occluders[0].backgroundColor, 'rgb(210, 20, 20)'); assert.equal(about().consent.dismissed, null);
    const all = doc.aggregate.colors.flatMap((c) => [c.hex, ...c.values]);
    assert.ok(!all.includes('#7b2d43') && !all.includes('rgb(123, 45, 67)'), 'consent overlay colour leaked'); assert.ok(!all.includes('#d21414') && !all.includes('rgb(210, 20, 20)'), 'promo overlay colour leaked');
  });
  await check('e2e aggregate: roles, families, sizes, motifs, hover deltas, logo, icon font', () => {
    const a = doc.aggregate; const byRole = (role) => a.colors.find((c) => c.roles.includes(role));
    assert.equal(byRole('background').hex, '#ffffff'); assert.equal(byRole('primary').hex, '#147aff'); assert.equal(byRole('text').hex, '#111111'); assert.equal(byRole('border').hex, '#c8ccd2'); assert.equal(byRole('accent').hex, '#0064c8');
    assert.ok(a.colors.some((c) => c.hex === '#f0f2f5') && a.colors.some((c) => c.hex === '#0b1f3a'));
    assert.equal(a.type.headingFamily, 'Arial'); assert.equal(a.type.bodyFamily, 'Georgia'); assert.deepEqual(a.type.sizes.map((s) => s.px).slice(0, 3), [48, 32, 18.72]); assert.equal(a.type.levels.h1.fontSize, 48);
    assert.equal(a.motifs.radius.mode, '8px'); assert.match(a.motifs.shadows[0].value, /0\.06/); assert.equal(a.motifs.gradients.length, 1);
    assert.ok(a.hover.some((h) => h.kind === 'button' && h.to.backgroundColor === 'rgb(0, 90, 200)')); assert.ok(a.hover.some((h) => h.kind === 'link' && h.to.color === 'rgb(0, 60, 120)'));
    assert.equal(a.logo.source, 'inline-svg'); assert.equal(a.logo.url, `${origin}/`); assert.deepEqual(a.iconFont.glyphs.map((g) => g.codepoint), ['U+E928']);
    assert.deepEqual(a.counts, { pages: 2, widths: [360, 1440], measurements: 4 });
  });
  await check('e2e failures: every page failing → exit 1, aggregate null, error recorded; one failing → exit 0 with the count in the summary', async () => {
    const all = await runAsync(['--urls', `${origin}/missing`, '--out', join(root, 'fail.json')]);
    assert.equal(all.code, 1); assert.match(all.out, /1 of 1 measurements failed/); const f = JSON.parse(readFileSync(join(root, 'fail.json'), 'utf8')); assert.equal(f.aggregate, null); assert.equal(f._provenance.failed[0].error, 'HTTP 404');
    const part = await runAsync(['--urls', `${origin}/about,${origin}/missing`, '--out', join(root, 'part.json')]);
    assert.equal(part.code, 0); assert.match(part.out, /1 pages × 1 widths .* \(1 of 2 measurements failed/); assert.match(part.err, /FAIL .*\/missing @1440 {2}HTTP 404/);
  });
  server.close();
}

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nstyle-census: all checks passed');
process.exit(failed ? 1 : 0);
