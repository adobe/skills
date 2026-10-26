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
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTE_HINTS, alignPrimary, applyAccepted, attributeInventory, diffAttributes, diffRoot, formatFinding, glyphLabel, parseRoots, subjectOf, tierLine, tierOf } from '../content-diff.mjs';
import { resolveProfile } from '../diff-profiles.mjs';
import { diffInventories, inventory, editableInventory } from '../content-inventory.mjs';
import * as deployInventory from '../../../deploy/scripts/content-inventory.mjs';
import { CONSENT_CANDIDATES } from '../live-session.mjs';

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
  assert.deepEqual(kinds(flags), ['🟡 MISSING ARIA-LABEL'], JSON.stringify(flags));
  assert.match(flags[0].msg, /second|has no build <a> with that aria-label/);
});
await check('severity follows visibility: a lost aria-label is 🟡 anywhere (invisible) and in the nothing-lost tier; a lost placeholder on an input is 🔴 (visible); a title is advisory 🟡', () => {
  const src = { attrs: [attr('abbr', 'title', 'Hypertext', false), attr('a', 'aria-label', 'Open menu', true), attr('nav', 'aria-label', 'Main', false), attr('input', 'placeholder', 'Search', true)], icons: [] };
  const flags = diffAttributes(src, { attrs: [], icons: [] }, prof);
  assert.deepEqual(kinds(flags), ['🟡 MISSING TITLE', '🟡 MISSING ARIA-LABEL', '🟡 MISSING ARIA-LABEL', '🔴 MISSING PLACEHOLDER']);
  assert.deepEqual(flags.map(tierOf), ['advisory', 'lost', 'lost', 'looks']);
});
await check('tierLine counts looks-same / nothing-lost / accepted / advisory; applyAccepted takes a finding out by kind + text (+ root) and keeps its reason', () => {
  const flags = [{ sev: '🔴', kind: 'MISSING CTA', msg: 'source cta "Knock toner" → /topic/knock-toner has no build link', root: 'main' }, { sev: '🟡', kind: 'MISSING ARIA-LABEL', msg: 'source <a> aria-label="Chart" …', root: 'main' }, { sev: '🟡', kind: 'EXTRA', msg: 'x', root: 'main' }];
  assert.equal(tierLine(flags, { owner: 2, auto: 3 }), 'Tiers: looks-same 🔴 1 · nothing-lost 🟡 1 · accepted 🟢 5 (owner 2, auto 3) · advisory 1');
  assert.equal(tierLine([]), 'Tiers: looks-same 🔴 0 · nothing-lost 🟡 0 · accepted 🟢 0 (owner 0, auto 0) · advisory 0');
  const { flags: left, accepted } = applyAccepted(flags, [{ kind: 'MISSING CTA', text: 'knock toner', reason: 'rotating ticker frozen at capture' }, { kind: 'EXTRA', root: 'header', reason: 'other root' }]);
  assert.deepEqual(left.map((f) => f.kind), ['MISSING ARIA-LABEL', 'EXTRA']);
  assert.deepEqual(accepted.map((f) => [f.kind, f.reason]), [['MISSING CTA', 'rotating ticker frozen at capture']]);
});
await check('applyAccepted matches text inside the finding\'s quoted subject only — the fixed wording ("has no build link") never matches; a kind-only entry accepts every finding of the kind', () => {
  const cta = (t) => ({ sev: '🔴', kind: 'MISSING CTA', msg: `source cta "${t}" → /x has no build link. Carry the link over.`, root: 'main' });
  const flags = [cta('Knock toner'), cta('Pricing'), { sev: '🟡', kind: 'MISSING ARIA-LABEL', msg: 'source <a> aria-label="Open menu" has no build <a> with that aria-label (build <a> aria-labels: "Close").', root: 'header' }];
  assert.equal(subjectOf(flags[0]), 'Knock toner'); assert.equal(subjectOf(flags[2]), 'Open menu'); assert.equal(subjectOf({ msg: 'no quotes' }), '');
  assert.equal(applyAccepted(flags, [{ kind: 'MISSING CTA', text: 'link', reason: 'x' }]).accepted.length, 0, 'message wording is not the subject');
  assert.equal(applyAccepted(flags, [{ kind: 'MISSING CTA', text: 'build', reason: 'x' }]).accepted.length, 0);
  assert.deepEqual(applyAccepted(flags, [{ kind: 'MISSING CTA', text: 'PRICING', reason: 'x' }]).accepted.map(subjectOf), ['Pricing']);
  assert.equal(applyAccepted(flags, [{ kind: 'MISSING ARIA-LABEL', text: 'close', reason: 'x' }]).accepted.length, 0, 'the other-values list is not the subject');
  assert.deepEqual(applyAccepted(flags, [{ kind: 'MISSING CTA', reason: 'kind-only' }]).accepted.map(subjectOf), ['Knock toner', 'Pricing'], 'kind-only accepts every finding of the kind');
});
await check('alignPrimary: one side found the root, the other fell back — re-read and say what was really measured; a side re-read at <main> that has none lands at <body>, so both align at <body> (either side)', async () => {
  const run = async (sF, tF, has) => { const calls = []; const r = await alignPrimary('.content', sF, tF, prof, async (side, to) => { calls.push(`${side}@${to}`); return to === 'main' && !has[side] ? 'body' : to; }); return { r, calls }; };
  assert.equal(await alignPrimary('main', null, null, prof, async () => { throw new Error('no re-read'); }), null);
  let { r, calls } = await run('body', null, { src: false, tgt: true });
  assert.deepEqual(calls, ['tgt@body']); assert.equal(r.note, 'root ".content": source fell back to <body>, build has it — both sides measured at <body> (aligned)');
  ({ r, calls } = await run(null, 'main', { src: true, tgt: true }));
  assert.deepEqual(calls, ['src@main']); assert.equal(r.to, 'main'); assert.match(r.note, /both sides measured at <main> \(aligned\)$/);
  ({ r, calls } = await run(null, 'main', { src: false, tgt: true }));
  assert.deepEqual(calls, ['src@main', 'tgt@body']); assert.equal(r.to, 'body');
  assert.equal(r.note, 'root ".content": source has it, build fell back to <main> — both sides measured at <body> (aligned; source has no <main>)');
  ({ r, calls } = await run('main', null, { src: true, tgt: false }));
  assert.deepEqual(calls, ['tgt@main', 'src@body']); assert.equal(r.to, 'body');
  assert.equal(r.note, 'root ".content": source fell back to <main>, build has it — both sides measured at <body> (aligned; build has no <main>)');
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
// signature fixtures (image-signature.mjs): a SIG_SIZE × SIG_SIZE RGB grid — a blank box, and a mark with structure
const sigGrid = (ink) => Array.from({ length: 144 }, (_, i) => (ink(i % 12, Math.floor(i / 12)) ? [42, 170, 102] : [255, 255, 255])).flat();
const blankSig = sigGrid(() => false); const markSig = sigGrid((x, y) => (x - 5.5) ** 2 + (y - 5.5) ** 2 <= 16);
await check('pixels never pair two blank boxes: an empty, unanchored source icon box with no build box at its anchor is 🔴 MISSING ICON, not ICON MOVED onto an empty build box elsewhere', () => {
  const src = { attrs: [], icons: [icon('glyph', '', 'search', true, { family: '', sig: blankSig })] };
  const tgt = { attrs: [], icons: [icon('glyph', '', 'button#1', true, { family: '', sig: blankSig })] };
  assert.deepEqual(kinds(diffAttributes(src, tgt, prof)), ['🔴 MISSING ICON', '🟡 EXTRA ICON']);
});
await check('the same signature under another value at the anchor is accepted as SAME IMAGE — no finding', () => {
  const accepted = [];
  const src = { attrs: [], icons: [icon('img', 'logo-a.svg', 'alpha', true, { size: '24×16', sig: markSig })] };
  const tgt = { attrs: [], icons: [icon('img', 'media_1a2b.svg', 'alpha', true, { size: '24×16', sig: markSig })] };
  assert.deepEqual(diffAttributes(src, tgt, prof, accepted), []);
  assert.deepEqual(accepted, [{ kind: 'SAME IMAGE', text: 'logo-a.svg ↔ media_1a2b.svg' }]);
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
  assert.deepEqual(diffRoot(ftr, inv({ absent: true }), inv({ absent: true }), prof), { flags: [], lines: ['root "footer": absent on both sides (no <footer> / [role="contentinfo"] outside the main root(s)) — not compared'], accepted: [] });
  const one = diffRoot(ftr, inv({ absent: true }), inv({ attrs: { attrs: [], icons: [icon('svg', '#icon-x', 'x', true)] } }), prof);
  assert.equal(one.lines[0], 'root "footer" — source: absent (no <footer> / [role="contentinfo"] outside the main root(s)) — measured as empty');
  assert.deepEqual(one.flags.map((f) => `${f.sev} ${f.kind} ${f.root}`), ['🟡 EXTRA ICON footer']);
  const fb = diffRoot({ name: 'main', sel: 'main', primary: true, chrome: false, describe: '"main"' }, inv({ fellBack: 'body' }), inv(), prof);
  assert.equal(fb.lines[0], 'root "main" — source: "main" absent, fell back to <body>');
  assert.deepEqual(diffRoot(ftr, undefined, null, prof).flags, []);
  assert.equal(diffRoot(ftr, undefined, null, prof).lines.length, 1);
});

// ---- the consent-banner skip list ----------------------------------------------------------------
// Each consent manager live-session can dismiss (a vendor accept control in CONSENT_CANDIDATES) → the banner container the
// in-page inventories skip. A new vendor candidate fails here until its container is listed in every CONSENT_UI copy.
const CONSENT_CONTAINER_OF = {
  '#onetrust-accept-btn-handler': '#onetrust-consent-sdk',
  '#cmpwelcomebtnyes': '#cmpbox', '.cmpboxbtnyes': '#cmpbox', '#cmpbntyestxt': '#cmpbox',
  '.ch2-allow-all-btn': '.ch2-container',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll': '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyButtonAccept': '#CybotCookiebotDialog',
  '#didomi-notice-agree-button': '#didomi-host',
  '[data-testid="uc-accept-all-button"]': '#usercentrics-root',
  '.osano-cm-accept-all': '.osano-cm-window',
  '[data-tid="banner-accept"]': '#termly-code-snippet-support',
  '#truste-consent-button': '#truste-consent-track',
  '.qc-cmp2-summary-buttons button[mode="primary"]': '.qc-cmp2-container',
  '.iubenda-cs-accept-btn': '#iubenda-cs-banner',
  '.cmplz-accept': '.cmplz-cookiebanner',
  '.cky-btn-accept': '.cky-consent-container',
};
await check('CONSENT_UI: one list in inventory, editableInventory (diff + deploy copies) and attributeInventory, covering exactly the vendors CONSENT_CANDIDATES dismisses', () => {
  const vendors = CONSENT_CANDIDATES.filter((sel) => !/^button:(has-text|text-matches)\(/.test(sel) && !sel.startsWith('[data-testid*='));
  assert.deepEqual(vendors.filter((sel) => !(sel in CONSENT_CONTAINER_OF)), [], 'every vendor candidate maps to a banner container');
  assert.deepEqual(Object.keys(CONSENT_CONTAINER_OF).filter((sel) => !CONSENT_CANDIDATES.includes(sel)), [], 'no mapping for a dropped candidate');
  const literal = /CONSENT_UI = '([^']+)'/.exec(inventory.toString());
  assert.ok(literal, 'inventory declares CONSENT_UI');
  assert.deepEqual(literal[1].split(', ').sort(), [...new Set(Object.values(CONSENT_CONTAINER_OF))].sort());
  for (const [name, fn] of [['inventory (deploy)', deployInventory.inventory], ['editableInventory', editableInventory], ['editableInventory (deploy)', deployInventory.editableInventory], ['attributeInventory', attributeInventory]]) {
    assert.ok(fn.toString().includes(literal[1]), `${name} carries the same consent list`);
  }
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

// ---- pure: severity by visibility (diffInventories) -------------------------------------------------
const item = (role, text, o = {}) => ({ role, text, key: text.toLowerCase(), look: '16px 700 rgb(0, 0, 0) none', family: 'Manrope', w: 100, srOnly: false, ...o });
await check('a body → heading change with the same look is an accepted ROLE UPGRADE (no finding); heading → body with the same look is 🟡 ROLE DOWNGRADE', () => {
  const up = diffInventories([item('body', 'Trending')], [item('heading', 'Trending')], prof);
  assert.deepEqual(up.flags, []); assert.deepEqual(up.accepted, [{ kind: 'ROLE UPGRADE', from: 'body', text: 'Trending' }]);
  const down = diffInventories([item('heading', 'Pricing')], [item('body', 'Pricing')], prof);
  assert.deepEqual(kinds(down.flags), ['🟡 ROLE DOWNGRADE']); assert.deepEqual(down.accepted, []);
});
const caps = { look: '12px 700 rgb(0, 0, 0) uppercase' }; // a small uppercase <div> group title is an eyebrow, the same-look <h3> a heading
await check('eyebrow → heading with the same look is an accepted ROLE UPGRADE, heading → eyebrow 🟡 ROLE DOWNGRADE; a CTA role change is never accepted; diffRoot names the upgrade and returns it', () => {
  const up = diffInventories([item('eyebrow', 'Company', caps)], [item('heading', 'Company', caps)], prof);
  assert.deepEqual(up.flags, []); assert.deepEqual(up.accepted, [{ kind: 'ROLE UPGRADE', from: 'eyebrow', text: 'Company' }]);
  assert.deepEqual(kinds(diffInventories([item('heading', 'Company', caps)], [item('eyebrow', 'Company', caps)], prof).flags), ['🟡 ROLE DOWNGRADE']);
  assert.deepEqual(kinds(diffInventories([item('cta', 'Company')], [item('heading', 'Company')], prof).flags), ['🔴 ROLE SWAP']);
  const r = diffRoot({ name: 'footer', sel: 'footer', primary: false, chrome: true, describe: '' }, { items: [item('eyebrow', 'Company', caps), item('body', 'Trending')] }, { items: [item('heading', 'Company', caps), item('heading', 'Trending')] }, prof);
  assert.ok(r.lines.includes('  accepted (invisible, nothing lost): 2 ROLE UPGRADE eyebrow/body → heading — "Company", "Trending"'), r.lines.join('\n'));
  assert.deepEqual(r.accepted.map((a) => `${a.from} ${a.text} ${a.root}`), ['eyebrow Company footer', 'body Trending footer']);
});
await check('a role change that changes the look (size, weight, colour, case or face) stays 🔴 ROLE SWAP (eyebrow ↔ body can\'t keep the look: the same text with the same look classifies the same)', () => {
  assert.deepEqual(kinds(diffInventories([item('body', 'Trending')], [item('heading', 'Trending', { look: '24px 700 rgb(0, 0, 0) none' })], prof).flags), ['🔴 ROLE SWAP']);
  assert.deepEqual(kinds(diffInventories([item('body', 'Trending')], [item('heading', 'Trending', { family: 'Inter' })], prof).flags), ['🔴 ROLE SWAP']);
  assert.deepEqual(kinds(diffInventories([item('eyebrow', 'New', { look: '12px 700 rgb(0, 0, 0) uppercase' })], [item('body', 'New')], prof).flags), ['🔴 ROLE SWAP']);
});
await check('lost screen-reader-only text is 🟡 MISSING SR-ONLY TEXT whatever its non-CTA role; visible text keeps its severity', () => {
  assert.deepEqual(kinds(diffInventories([item('heading', 'Search volume grew from 1K to 9K', { srOnly: true })], [], prof).flags), ['🟡 MISSING SR-ONLY TEXT']);
  assert.deepEqual(kinds(diffInventories([item('heading', 'Pricing')], [], prof).flags), ['🔴 MISSING HEADING']);
});
await check('a lost sr-only CTA (a skip link) stays 🔴 MISSING CTA — interactive losses are not demoted', () => {
  assert.deepEqual(kinds(diffInventories([item('cta', 'Skip to content', { srOnly: true, href: '#main' })], [], prof).flags), ['🔴 MISSING CTA']);
});

// ---- end-to-end against two fixture pages (needs playwright) -----------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end content-diff (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Icons;src:local("Arial")} .fa{display:inline-block;width:16px;height:16px} .fa::before{font-family:Icons}
    .fa-facebook::before{content:"\\f09a"} .icon{display:inline-block;width:16px;height:16px} img.flag{width:24px;height:16px}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
    </style></head><body><main>${body}</main></body></html>`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#888"/></svg>';
  // a mark with structure (a solid fill is a blank signature — no identity to pair by)
  const mark = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="#fff"/><circle cx="8" cy="8" r="6" fill="${fill}"/></svg>`;
  const pages = {
    '/source.html': page('<h1>Welcome</h1><form><input type="search" placeholder="Suche…" aria-label="Suche"></form><p>Body copy here.</p>'
      + '<a href="/de/" class="lang"><img class="flag" src="/flag-de.svg" alt=""> Deutsch</a>'
      + '<ul class="social"><li><a href="https://social.example/x" aria-label="Facebook"><i class="fa fa-facebook"></i></a></li></ul>'),
    '/build.html': page('<h1>Welcome</h1><form><input type="search" aria-label="Suche"></form><p>Body copy here.</p>'
      + '<a href="/de/" class="lang"><img class="flag" src="/flag-en.svg" alt=""> Deutsch</a>'
      + '<ul class="social"><li><a href="https://social.example/x" aria-label="Facebook"><span class="icon"></span></a></li></ul>'),
    // a menu link drawn with an inline-svg icon on one side and an <img> icon on the other, plus inline payloads and
    // a consent banner only the source carries: none of it is a content difference
    '/noise-source.html': page('<h2>Tools</h2><a href="/tools/kw"><svg width="16" height="16"><title>icon</title><rect width="16" height="16"/></svg> Keyword Generator</a>'
      + '<script type="application/json">{"props":{"page":"/"}}</script><noscript><iframe src="about:blank"></iframe>Enable JavaScript</noscript><style>.x{color:red}</style>'
      + '<div class="ch2-container"><p>We use cookies to improve your experience.</p><a href="/privacy">Cookie policy</a><button>Allow all</button>'
      + '<button aria-label="Close"><svg width="16" height="16"><path d="M0 0L16 16M16 0L0 16"/></svg></button></div>'),
    '/noise-build.html': page('<h2>Tools</h2><a href="/tools/kw"><img src="/flag-de.svg" width="16" height="16" alt=""> Keyword Generator</a>'),
    // menu group titles: a styled <div> on the source, a heading with the same computed look on the build; a chart's
    // visually hidden description dropped by the build; also dropped: text inside an sr-only wrapper (sr-only), a
    // display:none tooltip and a caption on a slide its track translated off-screen (neither sr-only: plain MISSING BODY)
    '/role-source.html': page('<style>.t{font:700 15px/1.2 Arial;color:#123;margin:0}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><div class="t">Trending</div><p>Chart <span class="sr">search volume grew from 1K to 9K</span></p>'
      + '<div class="sr"><p>Opens in a new window</p></div><span style="position:absolute;display:none">Copied to clipboard</span>'
      + '<div style="position:relative;overflow:hidden;height:40px"><div style="display:flex;transform:translateX(-2600px)"><div style="position:relative;flex:0 0 1280px;height:40px"><p style="position:absolute;left:0;margin:0">Slide caption one</p></div></div></div>'),
    '/role-build.html': page('<style>.t{font:700 15px/1.2 Arial;color:#123;margin:0}</style><h3 class="t">Trending</h3><p>Chart</p>'),
    // a whole-card link on the source vs the usual EDS card (heading, body, a separate "Read more") on the build
    '/card-source.html': page('<h2>News</h2><a href="/news/one" class="card"><img src="/flag-de.svg" width="320" height="180" alt=""><h3>Title one</h3><p>The card description.</p></a>'),
    '/card-build.html': page('<h2>News</h2><div class="card"><picture><img src="/flag-de.svg" width="320" height="180" alt=""></picture><h3>Title one</h3><p>The card description.</p><p><a href="/news/one">Read more</a></p></div>'),
    // a logo link with sr-only text on the source vs an alt-only logo on the build
    '/logo-source.html': page('<a href="/" class="logo"><img src="/flag-de.svg" width="120" height="40" alt="Brand"><span class="sr-only">Home</span></a><h1>Welcome</h1><p>Body copy here.</p>'),
    '/logo-build.html': page('<a href="/" class="logo"><img src="/flag-de.svg" width="120" height="40" alt="Brand"></a><h1>Welcome</h1><p>Body copy here.</p>'),
    // the same logo re-hosted under a media hash, the same mark drawn as inline svg vs <img>, a genuinely different
    // logo, and a laid-out 0×0 svg on the source only
    '/icons-source.html': page('<a href="/a" class="tool"><img src="/logo-a.svg" width="24" height="16" alt=""> Alpha</a>'
      + `<a href="/b" class="tool">${mark('#888')} Beta</a>`
      + '<a href="/c" class="tool"><img src="/logo-c.svg" width="24" height="16" alt=""> Gamma</a>'
      + '<p>Text <svg width="0" height="0"><rect width="1" height="1"/></svg> here.</p>'),
    '/icons-build.html': page('<a href="/a" class="tool"><img src="/media_1a2b.svg" width="24" height="16" alt=""> Alpha</a>'
      + '<a href="/b" class="tool"><img src="/media_3c4d.svg" width="24" height="16" alt=""> Beta</a>'
      + '<a href="/c" class="tool"><img src="/media_5e6f.svg" width="24" height="16" alt=""> Gamma</a>'
      + '<p>Text here.</p>'),
    '/logo-a.svg': mark('#2a6'), '/media_1a2b.svg': mark('#2a6'), '/media_3c4d.svg': mark('#888'),
    '/logo-c.svg': mark('#2a6'), '/media_5e6f.svg': mark('#c00'),
    // a source with no <main> (its menu sits in a body-level bar) against a build whose <main> holds only the content
    '/nomain-source.html': '<!doctype html><html><body><div class="bar"><a href="/p">Pricing</a><a href="/l">Login</a></div><div class="content"><h1>Welcome</h1><p>Body copy here.</p><a href="/x">Ticker topic</a></div></body></html>',
    '/nomain-build.html': '<!doctype html><html><body><div class="bar"><a href="/p">Pricing</a><a href="/l">Login</a></div><main><h1>Welcome</h1><p>Body copy here.</p></main></body></html>',
    '/flag-de.svg': svg, '/flag-en.svg': svg.replace('#888', '#c00'),
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
  await check('e2e: an icon+text link counts as the same CTA whether the icon is inline svg or <img>; script / noscript / style text and a consent banner are not content — no MISSING CTA / BODY, the banner named once in the summary', async () => {
    const r = await run([`${base}/noise-source.html`, `${base}/noise-build.html`, '--profile', 'generic', '--width', '1280']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /MISSING CTA|MISSING BODY|EXTRA \[main\]: build cta|MISSING ICON|MISSING ARIA-LABEL/, r.stdout);
    assert.match(r.stdout, /^Findings: (none|\d+ \(0 structural 🔴\))/m, r.stdout);
    assert.match(r.stdout, /source: 2 text nodes — 1 headings, 0 eyebrows, 1 CTAs, 0 body; 0 img; consent banner skipped \(3 text nodes\)/, r.stdout);
    assert.match(r.stdout, /build: 2 text nodes — 1 headings, 0 eyebrows, 1 CTAs, 0 body; 1 img$/m, r.stdout);
    assert.match(r.stdout, /icons: source 1 \/ build 1$/m, r.stdout); // the banner's close-button svg is not counted
  });
  await check('e2e: a whole-card link <a><img><h3>T</h3><p>D</p></a> is a heading + body, not one CTA "t d" — against the EDS card (h3, p, separate "Read more") no 🔴, only the build\'s extra CTA', async () => {
    const r = await run([`${base}/card-source.html`, `${base}/card-build.html`, '--profile', 'generic', '--width', '1280']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /^  🔴|MISSING/m, r.stdout);
    assert.match(r.stdout, /source: 3 text nodes — 2 headings, 0 eyebrows, 0 CTAs, 1 body; 1 img$/m, r.stdout);
    assert.match(r.stdout, /build: 4 text nodes — 2 headings, 0 eyebrows, 1 CTAs, 1 body; 1 img$/m, r.stdout);
    assert.match(r.stdout, /^Findings: 1 \(0 structural 🔴\)$/m, r.stdout);
    assert.match(r.stdout, /^  🟠 EXTRA \[main\]: build cta "Read more"/m, r.stdout);
  });
  await check('e2e: a logo link whose only text is sr-only "Home" reads like an alt-only logo — no MISSING CTA, no findings', async () => {
    const r = await run([`${base}/logo-source.html`, `${base}/logo-build.html`, '--profile', 'generic', '--width', '1280']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Findings: none — content \+ roles match$/m, r.stdout);
    assert.match(r.stdout, /source: 2 text nodes — 1 headings, 0 eyebrows, 0 CTAs, 1 body; 1 img$/m, r.stdout);
  });
  await check('e2e: a same-look div → heading is accepted (named on the root and in --json, not a finding); dropped sr-only text (own clip or an sr-only wrapper) is 🟡 MISSING SR-ONLY TEXT, a display:none tooltip and an off-track slide caption plain MISSING BODY; 0 structural 🔴', async () => {
    const r = await run([`${base}/role-source.html`, `${base}/role-build.html`, '--profile', 'generic', '--width', '1280', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ {2}accepted \(invisible, nothing lost\): 1 ROLE UPGRADE body → heading — "Trending"$/m, r.stdout);
    assert.doesNotMatch(r.stdout, /ROLE SWAP/, r.stdout);
    assert.match(r.stdout, /🟡 MISSING SR-ONLY TEXT \[main\]: source body "search volume grew from 1K to 9K"/, r.stdout);
    assert.match(r.stdout, /🟡 MISSING SR-ONLY TEXT \[main\]: source body "Opens in a new window"/, r.stdout);
    assert.match(r.stdout, /🟡 MISSING BODY \[main\]: source body "Copied to clipboard"/, r.stdout);
    assert.match(r.stdout, /🟡 MISSING BODY \[main\]: source body "Slide caption one"/, r.stdout);
    assert.match(r.stdout, /^Findings: \d+ \(0 structural 🔴\)$/m, r.stdout);
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('Inventories JSON:') + 'Inventories JSON:'.length));
    assert.deepEqual(j.accepted, [{ kind: 'ROLE UPGRADE', from: 'body', text: 'Trending', root: 'main' }]);
  });
  await check('e2e: icons pair by pixels — a re-hosted file is SAME IMAGE, inline svg vs <img> of the same mark is SAME ICON (both accepted, no finding); a different logo stays 🔴 ICON DIFF; a laid-out 0×0 svg is not an icon', async () => {
    const r = await run([`${base}/icons-source.html`, `${base}/icons-build.html`, '--profile', 'generic', '--width', '1280']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /accepted \(invisible, nothing lost\): 1 SAME IMAGE — "logo-a\.svg ↔ media_1a2b\.svg"; 1 SAME ICON — "[^"]+ ↔ media_3c4d\.svg"$/m, r.stdout);
    assert.match(r.stdout, /^ {2}attributes \(placeholder\/aria-label\/title\): source 0 \/ build 0; icons: source 3 \/ build 3$/m, r.stdout);
    assert.match(r.stdout, /^Findings: 1 \(1 structural 🔴\)$/m, r.stdout);
    assert.match(r.stdout, /🔴 ICON DIFF \[main\]: source image logo-c\.svg \(24×16\) vs build image media_5e6f\.svg \(24×16\) at "gamma"/, r.stdout);
  });
  await check('e2e: a source without <main> against a build with one is measured at <body> on both sides (aligned, said once) — the menu is not missing content; an accepted-list entry takes the frozen ticker link out with its reason', async () => {
    const acc = join(mkdtempSync(join(tmpdir(), 'cd-acc-')), 'accepted.json');
    writeFileSync(acc, JSON.stringify({ accepted: [{ kind: 'MISSING CTA', text: 'ticker topic', reason: 'rotating feed, frozen at capture' }] }));
    const r = await run([`${base}/nomain-source.html`, `${base}/nomain-build.html`, '--profile', 'generic', '--width', '1280', '--accepted', acc]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^⚠ root "main": source fell back to <body>, build has it — both sides measured at <body> \(aligned\)$/m, r.stdout);
    assert.doesNotMatch(r.stdout, /MISSING CTA \[main\]: source cta "(pricing|login)"/i, r.stdout);
    assert.match(r.stdout, /^Tiers: looks-same 🔴 0 · nothing-lost 🟡 0 · accepted 🟢 1 \(owner 1, auto 0\) · advisory \d+$/m, r.stdout);
    assert.match(r.stdout, /🟢 MISSING CTA \[main\] accepted \(.*accepted\.json\): rotating feed, frozen at capture/, r.stdout);
  });
  server.close();
}

console.log(failed ? `\n${failed} failing` : '\ncontent-diff: all checks passed');
process.exit(failed ? 1 : 0);
