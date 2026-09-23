#!/usr/bin/env node
// skills/diff/scripts/test/content-diff.test.mjs — the content-diff.mjs attribute + icon layer: diffAttributes (pure —
// placeholder / aria-label / title pairing by value, icons pairing by anchor then by identity + order (ICON MOVED), 🔴 on
// interactive elements and 🟡 otherwise, title / EXTRA / ICON KIND / ICON MOVED advisory, glyph labels), the roots layer
// (parseRoots — --main lists + the chrome roots; diffRoot / formatFinding — per-root findings tagged with their root),
// --help in an empty cwd, importing the module runs no probe;
// then end-to-end against two small fixture pages served from a temp dir — a source with a localized search
// placeholder, a flag image inside a locale link and an icon-font glyph inside a social link, against a build that
// dropped the placeholder, swapped the flag and left the social box empty (the three defects a recorded hands-off
// run shipped on every page while this probe read 0 🔴). The end-to-end part runs where playwright is importable
// and prints a skip line otherwise. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTE_HINTS, attributeInventory, diffAttributes, diffRoot, formatFinding, glyphLabel, parseRoots } from '../content-diff.mjs';
import { resolveProfile } from '../diff-profiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'content-diff.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const prof = resolveProfile('generic');
const attr = (tag, a, value, interactive) => ({ tag, attr: a, value, interactive });
const icon = (kind, value, anchor, interactive, extra = {}) => ({ kind, value, size: '16×16', interactive, anchor, ...extra });
const kinds = (flags) => flags.map((f) => `${f.sev} ${f.kind}`);

// ---- pure: attributes ----------------------------------------------------------------------------
await check('identical inventories → no flags; empty / missing inventories → no flags', () => {
  const inv = { attrs: [attr('input', 'placeholder', 'Search…', true), attr('a', 'aria-label', 'Home', true), attr('abbr', 'title', 'World Wide Web', false)], icons: [icon('glyph', '""', 'facebook', true, { family: 'Icons' })] };
  assert.deepEqual(diffAttributes(inv, inv, prof), []);
  assert.deepEqual(diffAttributes({ attrs: [], icons: [] }, { attrs: [], icons: [] }, prof), []);
  assert.deepEqual(diffAttributes(undefined, null, prof), []);
});
await check('a dropped placeholder on an input is 🔴 MISSING PLACEHOLDER and lists the build\'s placeholders on that tag; a translation shows as MISSING + EXTRA', () => {
  const src = { attrs: [attr('input', 'placeholder', 'Suche…', true)], icons: [] };
  const none = diffAttributes(src, { attrs: [], icons: [] }, prof);
  assert.deepEqual(kinds(none), ['🔴 MISSING PLACEHOLDER']);
  assert.match(none[0].msg, /^source <input> placeholder="Suche…" has no build <input> with that placeholder\. /);
  assert.ok(none[0].msg.endsWith(ATTRIBUTE_HINTS.MISSING_ATTRIBUTE));
  const other = diffAttributes(src, { attrs: [attr('input', 'placeholder', 'Search…', true)], icons: [] }, prof);
  assert.deepEqual(kinds(other), ['🔴 MISSING PLACEHOLDER', '🟡 EXTRA PLACEHOLDER']);
  assert.match(other[0].msg, /\(build <input> placeholders: "Search…"\)\./);
  assert.match(other[1].msg, /^build <input> placeholder="Search…" has no source source\. /);
});
await check('pairing is by (attribute, value), case-insensitive, first unused target — duplicates count; the same value under another attribute does not pair', () => {
  const src = { attrs: [attr('a', 'aria-label', 'Next', true), attr('a', 'aria-label', 'Next', true), attr('img', 'title', 'Next', false)], icons: [] };
  const tgt = { attrs: [attr('a', 'aria-label', 'next', true), attr('span', 'title', 'Next', false)], icons: [] };
  const flags = diffAttributes(src, tgt, prof);
  assert.deepEqual(kinds(flags), ['🔴 MISSING ARIA-LABEL'], JSON.stringify(flags));
  assert.match(flags[0].msg, /second|has no build <a> with that aria-label/);
});
await check('severity follows the element: a non-interactive title is 🟡, an aria-label on a link 🔴, an aria-label on a landmark 🟡', () => {
  const src = { attrs: [attr('abbr', 'title', 'Hypertext', false), attr('a', 'aria-label', 'Open menu', true), attr('nav', 'aria-label', 'Main', false)], icons: [] };
  assert.deepEqual(kinds(diffAttributes(src, { attrs: [], icons: [] }, prof)), ['🟡 MISSING TITLE', '🔴 MISSING ARIA-LABEL', '🟡 MISSING ARIA-LABEL']);
});
await check('a missing title is 🟡 even on an interactive element (an <img title> inside a link — measured as 🔴 on a delivered replica); placeholder and aria-label there stay 🔴', () => {
  const src = { attrs: [attr('img', 'title', 'Open the gallery', true), attr('a', 'aria-label', 'Open the gallery', true), attr('input', 'placeholder', 'Search', true)], icons: [] };
  assert.deepEqual(kinds(diffAttributes(src, { attrs: [], icons: [] }, prof)), ['🟡 MISSING TITLE', '🔴 MISSING ARIA-LABEL', '🔴 MISSING PLACEHOLDER']);
});

// ---- pure: icons ---------------------------------------------------------------------------------
await check('an icon-font glyph inside a social link with no build icon at that anchor is 🔴 MISSING ICON; an empty icon box there is 🔴 ICON DIFF naming "no glyph"', () => {
  const src = { attrs: [], icons: [icon('glyph', '""', 'facebook', true, { family: 'Icons' })] };
  const missing = diffAttributes(src, { attrs: [], icons: [] }, prof);
  assert.deepEqual(kinds(missing), ['🔴 MISSING ICON']);
  assert.equal(missing[0].msg, `source icon-font glyph U+F09A (Icons, 16×16) at "facebook" has no build icon there. ${ATTRIBUTE_HINTS.MISSING_ICON}`);
  const empty = diffAttributes(src, { attrs: [], icons: [icon('glyph', '', 'facebook', true, { family: '' })] }, prof);
  assert.deepEqual(kinds(empty), ['🔴 ICON DIFF']);
  assert.match(empty[0].msg, /^source icon-font glyph U\+F09A \(Icons, 16×16\) vs build empty icon box \(16×16\) at "facebook"\. /);
});
await check('a different flag file inside a locale link is 🔴 ICON DIFF; the same file on another host is not a finding; outside a link the diff is 🟡', () => {
  const src = { attrs: [], icons: [icon('img', 'flag-de.svg', 'deutsch', true, { size: '24×16' })] };
  const wrong = diffAttributes(src, { attrs: [], icons: [icon('img', 'flag-en.svg', 'deutsch', true, { size: '24×16' })] }, prof);
  assert.deepEqual(kinds(wrong), ['🔴 ICON DIFF']);
  assert.equal(wrong[0].msg, `source image flag-de.svg (24×16) vs build image flag-en.svg (24×16) at "deutsch". ${ATTRIBUTE_HINTS.ICON_DIFF}`);
  assert.deepEqual(diffAttributes(src, { attrs: [], icons: [icon('img', 'flag-de.svg', 'deutsch', true, { size: '24×16' })] }, prof), [], 'file name, never the host');
  const deco = diffAttributes({ attrs: [], icons: [icon('img', 'check.svg', 'fast delivery', false)] }, { attrs: [], icons: [icon('img', 'tick.svg', 'fast delivery', false)] }, prof);
  assert.deepEqual(kinds(deco), ['🟡 ICON DIFF']);
});
await check('same anchor, different technique (glyph vs inline svg vs image) is 🟡 ICON KIND even inside a link; a build-only icon is 🟡 EXTRA ICON', () => {
  const src = { attrs: [], icons: [icon('glyph', '""', 'twitter', true, { family: 'Icons' })] };
  const svg = diffAttributes(src, { attrs: [], icons: [icon('svg', '#icon-twitter', 'twitter', true)] }, prof);
  assert.deepEqual(kinds(svg), ['🟡 ICON KIND']);
  assert.match(svg[0].msg, /^source icon-font glyph U\+F099 \(Icons, 16×16\) vs build inline svg #icon-twitter \(16×16\) at "twitter"\. /);
  const extra = diffAttributes({ attrs: [], icons: [] }, { attrs: [], icons: [icon('css', 'mask:search.svg', 'search', true)] }, prof);
  assert.deepEqual(kinds(extra), ['🟡 EXTRA ICON']);
  assert.match(extra[0].msg, /^build css icon mask:search\.svg \(16×16\) at "search" has no source source\. /);
});
await check('icons pair same kind + value first, then same kind, then any kind at the anchor — two icons at one anchor do not steal each other\'s match', () => {
  const src = { attrs: [], icons: [icon('glyph', '""', 'share', true), icon('glyph', '""', 'share', true)] };
  const tgt = { attrs: [], icons: [icon('glyph', '""', 'share', true), icon('glyph', '""', 'share', true)] };
  assert.deepEqual(diffAttributes(src, tgt, prof), [], 'order within an anchor does not matter');
  const one = diffAttributes(src, { attrs: [], icons: [icon('glyph', '""', 'share', true)] }, prof);
  assert.deepEqual(kinds(one), ['🔴 MISSING ICON']); assert.match(one[0].msg, /U\+F09A/);
});
// ---- pure: icons paired by identity + order (ICON MOVED) -------------------------------------------
// The FAQ shape measured on a delivered replica: one U+E911 glyph per accordion item; the source anchors each to its
// question text (the interactive host's label), the build hosts the same glyph in text-less <button>s → button#1…#7.
const faqSrc = (n) => Array.from({ length: n }, (_, i) => icon('glyph', '"\ue911"', `question ${i + 1}`, true, { family: 'Icons' }));
const faqTgt = (n) => Array.from({ length: n }, (_, i) => icon('glyph', '"\ue911"', `button#${i + 1}`, true, { family: 'Icons' }));
await check('the FAQ shape — the same glyph ×7, anchors question text vs button#1…#7 — is 7 × 🟡 ICON MOVED, 0 MISSING, 0 EXTRA', () => {
  const flags = diffAttributes({ attrs: [], icons: faqSrc(7) }, { attrs: [], icons: faqTgt(7) }, prof);
  assert.deepEqual(kinds(flags), Array(7).fill('🟡 ICON MOVED'), JSON.stringify(flags));
  assert.equal(flags.filter((f) => /MISSING|EXTRA/.test(f.kind)).length, 0);
  assert.match(flags[0].msg, /^source icon-font glyph U\+E911 \(Icons, 16×16\) at "question 1" is at "button#1" in the build — same icon, paired by order\. /);
  assert.ok(flags[0].msg.endsWith(ATTRIBUTE_HINTS.ICON_MOVED), flags[0].msg);
  assert.match(flags[6].msg, /at "question 7" is at "button#7"/, 'document order pairs ordinals');
});
await check('an icon truly missing beside moved ones stays 🔴 MISSING ICON (the last unpaired in document order); a different glyph never pairs by identity — MISSING + EXTRA', () => {
  const flags = diffAttributes({ attrs: [], icons: faqSrc(8) }, { attrs: [], icons: faqTgt(7) }, prof);
  assert.equal(kinds(flags).filter((k) => k === '🟡 ICON MOVED').length, 7);
  assert.deepEqual(kinds(flags).filter((k) => k !== '🟡 ICON MOVED'), ['🔴 MISSING ICON']);
  assert.match(flags.find((f) => f.kind === 'MISSING ICON').msg, /at "question 8" has no build icon there\. /);
  const other = diffAttributes({ attrs: [], icons: [icon('glyph', '"\ue911"', 'question 1', true)] }, { attrs: [], icons: [icon('glyph', '"\ue912"', 'button#1', true)] }, prof);
  assert.deepEqual(kinds(other), ['🔴 MISSING ICON', '🟡 EXTRA ICON']);
});
await check('identity pairing prefers the same nearest block: a glyph missing from block A stays MISSING in A instead of taking block B\'s icon; without block keys it pairs by root order', () => {
  const g = (anchor, block) => ({ ...icon('glyph', '"\ue911"', anchor, true, { family: 'Icons' }), block });
  const src = { attrs: [], icons: [g('question 1', 'faq a'), g('question 2', 'faq a'), g('question 3', 'faq b')] };
  const tgt = { attrs: [], icons: [g('button#1', 'faq a'), g('button#2', 'faq b')] };
  const flags = diffAttributes(src, tgt, prof);
  assert.deepEqual(kinds(flags), ['🟡 ICON MOVED', '🔴 MISSING ICON', '🟡 ICON MOVED'], JSON.stringify(flags));
  assert.match(flags[1].msg, /at "question 2" has no build icon there/);
  assert.match(flags[0].msg, /paired by order within "faq a"\. /);
  assert.match(flags[2].msg, /at "question 3" is at "button#2" in the build — same icon, paired by order within "faq b"\. /);
  const flat = diffAttributes({ attrs: [], icons: src.icons.map((i) => ({ ...i, block: '' })) }, { attrs: [], icons: tgt.icons.map((i) => ({ ...i, block: '' })) }, prof);
  assert.deepEqual(kinds(flat), ['🟡 ICON MOVED', '🟡 ICON MOVED', '🔴 MISSING ICON']);
});
await check('anchor passes come first: swapped flags (de at "english", en at "deutsch") are two 🔴 ICON DIFF, never ICON MOVED; an empty icon box has no identity — a source glyph never pairs with an empty build box elsewhere', () => {
  const src = { attrs: [], icons: [icon('img', 'flag-de.svg', 'deutsch', true), icon('img', 'flag-en.svg', 'english', true)] };
  const tgt = { attrs: [], icons: [icon('img', 'flag-en.svg', 'deutsch', true), icon('img', 'flag-de.svg', 'english', true)] };
  assert.deepEqual(kinds(diffAttributes(src, tgt, prof)), ['🔴 ICON DIFF', '🔴 ICON DIFF']);
  const empty = diffAttributes({ attrs: [], icons: [icon('glyph', '"\ue911"', 'question 1', true, { family: 'Icons' })] }, { attrs: [], icons: [icon('glyph', '', 'button#1', true, { family: '' })] }, prof);
  assert.deepEqual(kinds(empty), ['🔴 MISSING ICON', '🟡 EXTRA ICON']);
});
await check('glyphLabel: quotes stripped, private-use and non-ASCII code points as U+XXXX, ASCII kept, empty → no glyph', () => {
  assert.equal(glyphLabel('""'), 'U+F09A'); assert.equal(glyphLabel("'→'"), 'U+2192'); assert.equal(glyphLabel('"+"'), '+');
  assert.equal(glyphLabel('"a b"'), 'aU+00A0b'); assert.equal(glyphLabel(''), 'no glyph'); assert.equal(glyphLabel('""'), 'no glyph');
});
await check('a profile hint overrides the built-in text for a kind', () => {
  const p = { ...prof, hints: { ...prof.hints, MISSING_ICON: 'custom hint.' } };
  const f = diffAttributes({ attrs: [], icons: [icon('svg', '#x', 'a', false)] }, { attrs: [], icons: [] }, p);
  assert.ok(f[0].msg.endsWith(' custom hint.'), f[0].msg);
});
await check('attributeInventory is a plain serialisable function (no outer-scope references) — the shape Playwright needs', () => {
  const src = attributeInventory.toString();
  assert.match(src, /^function attributeInventory\(args\)/);
  assert.doesNotMatch(src, /ATTRIBUTE_HINTS|describeIcon|glyphLabel\(|EMPTY_INVENTORY|CHROME_ROOTS/, 'nothing from the module scope is referenced inside');
  assert.match(src, /block: blockOf\(el\)/, 'every icon record carries its block key');
});

// ---- pure: roots -----------------------------------------------------------------------------------
await check('parseRoots: the default is the profile root plus the header and footer chrome roots, resolved OUTSIDE the main root; --no-chrome leaves the main root alone; a profile may default chrome off and --chrome overrides it', () => {
  const roots = parseRoots(null, null, prof);
  assert.deepEqual(roots.map((r) => `${r.name}${r.primary ? '*' : ''}${r.chrome ? '+' : ''}`), ['main*', 'header+', 'footer+']);
  assert.equal(roots[1].sel, 'header:not(main header), [role="banner"]:not(main [role="banner"])');
  assert.equal(roots[2].sel, 'footer:not(main footer), [role="contentinfo"]:not(main [role="contentinfo"])');
  assert.deepEqual(parseRoots(null, false, prof).map((r) => r.name), ['main']);
  assert.deepEqual(parseRoots(null, null, { ...prof, chromeDefault: false }).map((r) => r.name), ['main']);
  assert.deepEqual(parseRoots('', true, { ...prof, chromeDefault: false }).map((r) => r.name), ['main', 'header', 'footer']);
});
await check('parseRoots: --main a,b is two roots (the first primary), both excluded from the chrome selectors; a chrome root listed under --main is not doubled', () => {
  const roots = parseRoots('#content, .page-body', null, prof);
  assert.deepEqual(roots.map((r) => [r.name, r.sel, r.primary]), [
    ['#content', '#content', true], ['.page-body', '.page-body', false],
    ['header', 'header:not(#content header):not(.page-body header), [role="banner"]:not(#content [role="banner"]):not(.page-body [role="banner"])', false],
    ['footer', 'footer:not(#content footer):not(.page-body footer), [role="contentinfo"]:not(#content [role="contentinfo"]):not(.page-body [role="contentinfo"])', false]]);
  assert.deepEqual(parseRoots('main,header', null, prof).map((r) => `${r.name}${r.chrome ? '+' : ''}`), ['main', 'header', 'footer+']);
});
const inv = (over = {}) => ({ items: [], imgCount: 0, editable: { count: 0, items: [] }, attrs: { attrs: [], icons: [] }, ...over });
const hdr = { name: 'header', sel: 'header', primary: false, chrome: true, describe: 'no <header> / [role="banner"] outside the main root(s)' };
await check('diffRoot: every finding of a root carries it and formatFinding prints "[root]" after the kind; the report block names the root and both sides', () => {
  const { flags, lines } = diffRoot(hdr, inv({ attrs: { attrs: [attr('input', 'placeholder', 'Suche…', true)], icons: [] } }), inv(), prof);
  assert.deepEqual(flags.map((f) => [f.sev, f.kind, f.root]), [['🔴', 'MISSING PLACEHOLDER', 'header']]);
  assert.match(formatFinding(flags[0]), /^  🔴 MISSING PLACEHOLDER \[header\]: source <input> placeholder="Suche…" has no build <input> with that placeholder\. /);
  assert.deepEqual(lines, ['root "header"', '  source: 0 text nodes — 0 headings, 0 eyebrows, 0 CTAs, 0 body; 0 img', '  build: 0 text nodes — 0 headings, 0 eyebrows, 0 CTAs, 0 body; 0 img',
    '  editable texts (outermost h*/p/ul/ol): source 0 / build 0', '  attributes (placeholder/aria-label/title): source 1 / build 0; icons: source 0 / build 0']);
});
await check('diffRoot runs the text layer and the editable count per root too: a nav link dropped from the header is 🔴 MISSING CTA [header], fewer editable elements 🟡 EDITABLE COUNT [header]', () => {
  const cta = { role: 'cta', text: 'Contact', key: 'contact', href: '/contact' };
  const { flags } = diffRoot(hdr, inv({ items: [cta], editable: { count: 1, items: [] } }), inv(), prof);
  assert.deepEqual(flags.map((f) => `${f.sev} ${f.kind} [${f.root}]`), ['🔴 MISSING CTA [header]', '🟡 EDITABLE COUNT [header]']);
});
await check('diffRoot: a root absent on both sides is one line and no findings; absent on one side is measured as empty and said so; the primary root\'s fallback is named; missing inventories read as absent', () => {
  const ftr = { name: 'footer', sel: 'footer', primary: false, chrome: true, describe: 'no <footer> / [role="contentinfo"] outside the main root(s)' };
  assert.deepEqual(diffRoot(ftr, inv({ absent: true }), inv({ absent: true }), prof), { flags: [], lines: ['root "footer": absent on both sides (no <footer> / [role="contentinfo"] outside the main root(s)) — not compared'] });
  const one = diffRoot(ftr, inv({ absent: true }), inv({ attrs: { attrs: [], icons: [icon('svg', '#icon-x', 'x', true)] } }), prof);
  assert.equal(one.lines[0], 'root "footer" — source: absent (no <footer> / [role="contentinfo"] outside the main root(s)) — measured as empty');
  assert.deepEqual(one.flags.map((f) => `${f.sev} ${f.kind} ${f.root}`), ['🟡 EXTRA ICON footer']);
  const fb = diffRoot({ name: 'main', sel: 'main', primary: true, chrome: false, describe: '"main"' }, inv({ fellBack: 'body' }), inv(), prof);
  assert.equal(fb.lines[0], 'root "main" — source: "main" absent, fell back to <body>');
  assert.deepEqual(diffRoot(ftr, undefined, null, prof).flags, []);
  assert.equal(diffRoot(ftr, undefined, null, prof).lines.length, 1);
});

// ---- cli -----------------------------------------------------------------------------------------
await check('--help: exit 0, usage on stdout naming the attribute layer, ICON MOVED, --main lists and --chrome/--no-chrome, nothing written in an empty cwd; two missing args → usage on stderr, exit 1', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'content-diff-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  const wrote = readdirSync(cwd); rmSync(cwd, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^usage: node skills\/diff\/scripts\/content-diff\.mjs/); assert.match(r.stdout, /MISSING ICON, ICON DIFF, ICON KIND, EXTRA ICON, ICON MOVED/); assert.deepEqual(wrote, []);
  assert.match(r.stdout, /--main <sel\[,sel…\]>/); assert.match(r.stdout, /--chrome \| --no-chrome/); assert.match(r.stdout, /MISSING TITLE, ICON MOVED, ICON KIND and every EXTRA are 🟡/); assert.match(r.stdout, /\[<root>\]/);
  const u = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(u.status, 1); assert.match(u.stderr, /^usage:/);
});

// ---- end-to-end against two fixture pages (needs playwright) -----------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end content-diff (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Icons;src:local("Arial")} .fa::before{font-family:Icons;display:inline-block;width:16px;height:16px}
    .fa-facebook::before{content:"\\f09a"} .icon{display:inline-block;width:16px;height:16px} img.flag{width:24px;height:16px}
    </style></head><body><main>${body}</main></body></html>`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#888"/></svg>';
  const pages = {
    '/source.html': page('<h1>Welcome</h1><form><input type="search" placeholder="Suche…" aria-label="Suche"></form><p>Body copy here.</p>'
      + '<a href="/de/" class="lang"><img class="flag" src="/flag-de.svg" alt=""> Deutsch</a>'
      + '<ul class="social"><li><a href="https://social.example/x" aria-label="Facebook"><i class="fa fa-facebook"></i></a></li></ul>'),
    '/build.html': page('<h1>Welcome</h1><form><input type="search" aria-label="Suche"></form><p>Body copy here.</p>'
      + '<a href="/de/" class="lang"><img class="flag" src="/flag-en.svg" alt=""> Deutsch</a>'
      + '<ul class="social"><li><a href="https://social.example/x" aria-label="Facebook"><span class="icon"></span></a></li></ul>'),
    '/flag-de.svg': svg, '/flag-en.svg': svg,
  };
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0]; const body = pages[path];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  await check('e2e: the three recorded defects are structural 🔴 — dropped placeholder, wrong flag in the locale link, empty social icon box — on a page whose text + roles match; exit 0 (advisory contract kept)', async () => {
    const r = await run([`${base}/source.html`, `${base}/build.html`, '--profile', 'generic', '--width', '1280', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Content diff @ 1280px \(profile "generic", roots: main, header, footer\)$/m, r.stdout);
    assert.match(r.stdout, /^root "main"$/m, r.stdout);
    assert.match(r.stdout, /^root "header": absent on both sides \(no <header> \/ \[role="banner"\] outside the main root\(s\)\) — not compared$/m, r.stdout);
    assert.match(r.stdout, /^root "footer": absent on both sides /m, r.stdout);
    assert.match(r.stdout, /^Findings: 3 \(3 structural 🔴\)$/m, r.stdout);
    assert.match(r.stdout, /^  🔴 MISSING PLACEHOLDER \[main\]: source <input> placeholder="Suche…" has no build <input> with that placeholder\. /m, r.stdout);
    assert.match(r.stdout, /^  🔴 ICON DIFF \[main\]: source image flag-de\.svg \(24×16\) vs build image flag-en\.svg \(24×16\) at "deutsch"\. /m, r.stdout);
    assert.match(r.stdout, /^  🔴 ICON DIFF \[main\]: source icon-font glyph U\+F09A \(Icons, 16×16\) vs build empty icon box \(16×16\) at "facebook"\. /m, r.stdout);
    assert.match(r.stdout, /^  attributes \(placeholder\/aria-label\/title\): source 3 \/ build 2; icons: source 2 \/ build 2$/m, r.stdout);
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('Inventories JSON:') + 'Inventories JSON:'.length));
    assert.equal(j.findings.length, 3); assert.deepEqual(j.findings.map((f) => f.kind).sort(), ['ICON DIFF', 'ICON DIFF', 'MISSING PLACEHOLDER']);
    assert.ok(j.findings.every((f) => f.root === 'main')); assert.equal(j.primaryRoot, 'main');
    assert.equal(j.roots.header.source.absent, true); assert.equal(j.roots.footer.build.absent, true);
    assert.deepEqual(j.source.attrs.attrs.map((a) => `${a.tag} ${a.attr}=${a.value} ${a.interactive}`), ['input placeholder=Suche… true', 'input aria-label=Suche true', 'a aria-label=Facebook true']);
    assert.deepEqual(j.source.attrs.icons.map((i) => `${i.kind} ${i.value} @${i.anchor} ${i.interactive}`), ['img flag-de.svg @deutsch true', 'glyph "" @facebook true']);
    assert.deepEqual(j.build.attrs.icons.map((i) => `${i.kind} ${i.value} @${i.anchor}`), ['img flag-en.svg @deutsch', 'glyph  @facebook']);
  });
  await check('e2e: a page against itself → no findings, the same attribute and icon counts on both sides', async () => {
    const r = await run([`${base}/source.html`, `${base}/source.html`, '--profile', 'generic']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Findings: none — content \+ roles match$/m, r.stdout);
    assert.match(r.stdout, /icons: source 2 \/ build 2$/m);
  });
  server.close();
}

console.log(failed ? `\n${failed} failing` : '\ncontent-diff: all checks passed');
process.exit(failed ? 1 : 0);
