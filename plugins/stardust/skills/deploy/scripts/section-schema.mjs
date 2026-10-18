#!/usr/bin/env node
/**
 * section-schema.mjs — per-section ENCODE/DECODE contract generator (#93).
 *
 * The root cause of the dropped-CTA / role-swap / flattened-variant defect class
 * is that the authored rows (ENCODE) and the block's decorate() (DECODE) are
 * written independently and hoped to be inverses. This script makes the contract
 * explicit and SHARED: it renders the prototype and emits, per <section>, the
 * ordered role-classified content inventory (heading / eyebrow / cta+href / body
 * — the SAME classifier content-diff and block-roundtrip use, from
 * skills/deploy/scripts/content-inventory.mjs) plus the repeating-unit groups
 * (count + per-unit composition). Both sides are then written FROM the schema:
 *   - ENCODE: one row per repeat unit, fields in schema order; every schema item
 *     appears in the authored content (an item with no row is a drop you chose).
 *   - DECODE: the block classifies exactly the roles the schema lists; the
 *     schema's unit composition is the post-decorate count assertion.
 * block-roundtrip.mjs (#94) then verifies the round-trip actually closed.
 *
 * `editableTexts` (per section) is the ENCODE-side expected editable count for
 * the Experience Workspace gate: the number of OUTERMOST h1-h6/p/ul/ol/pre/
 * blockquote elements in the prototype section that carry visible text — the set
 * the da.live canvas stamps `data-prose-index` on and can attach an inline editor
 * to (deploy SKILL.md § Experience Workspace editability contract). ENCODE authors
 * one such element per item (a list is ONE editable unit); after decorate() the
 * `--ew` gate (block-roundtrip / ew-editability-probe) must find the same number
 * of surviving instrumented elements — fewer means authored elements were rebuilt,
 * merged or synthesized (EW1), and the block is not editable in the workspace.
 *
 * Usage:
 *   node skills/deploy/scripts/section-schema.mjs <prototypeURL> [options]
 *     --out <file>     write JSON here (default stdout)
 *     --width <px>     viewport width (default 1280)
 *     --profile <p>    eds | generic — eyebrow classifier thresholds (default eds)
 *     --split <sel>    infer the sections from the elements matching <sel> (default
 *                      `main > *`). Applies by default when the content root (<main>,
 *                      else <body>) holds no `section, [data-section]`; when given, it
 *                      applies even if it does.
 *
 * --split inference: the outermost matches inside the root, in document order (script/
 * style/template/noscript/link/meta skipped; a lone unmarked wrapper is unwrapped into
 * its children) — each section/div/article/aside/header/footer/nav/form or data-section/
 * data-block/data-module element is one section, each run of other elements between
 * them is ONE section, named by its first element's data-section, else first class,
 * else tag. A section of several elements is inventoried through a `<div data-ss-split>`
 * (display: contents) wrapped around them in the rendered page only.
 *
 * Writes: only --out <file> when given (parent directories are created; a one-line
 * section summary then goes to stdout); without --out the schema JSON is stdout.
 * The JSON's `split` is null when the prototype's own sections were used, else
 * { selector, inferred: <n sections> }; with --out the summary of an inferred schema
 * starts with `inferred <n> section(s) from --split '<sel>' (no <section> in <main>)`
 * — or `(--split given)`.
 *
 * Exit codes: 0 ok · 1 usage / error.
 *
 * Imported as a module it loads no browser and runs nothing; it exports the pure
 * rule groupSections(nodes, { tagOf, childrenOf, isMarked }) (childrenOf → ELEMENT
 * children; isMarked → carries data-section/data-block/data-module), CONTAINER_TAGS
 * and SPLIT_DEFAULT.
 *
 * The prototype must be RENDERABLE (serve static prototypes from their own dir;
 * pre-render JSX first — deploy SKILL.md Step 1). file:// works when the
 * prototype's CSS is inline.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveProfile } from './diff-profiles.mjs';
import { inventory, editableInventory } from './content-inventory.mjs';

export const SPLIT_DEFAULT = 'main > *';
export const CONTAINER_TAGS = Object.freeze(['section', 'div', 'article', 'aside', 'header', 'footer', 'nav', 'form']);
const SKIP_TAGS = Object.freeze(['script', 'style', 'template', 'noscript', 'link', 'meta']);

// The --split grouping rule, pure: only the adapter callbacks touch a node, so the same
// function groups a parsed tree in Node and live elements in the page. It reads
// CONTAINER_TAGS and SKIP_TAGS and nothing else from module scope (see GROUP_SECTIONS_PAGE_SRC).
export function groupSections(nodes, { tagOf, childrenOf, isMarked }) {
  const keep = (list) => list.filter((n) => !SKIP_TAGS.includes(tagOf(n)));
  let list = keep(nodes);
  while (list.length === 1 && !isMarked(list[0]) && CONTAINER_TAGS.includes(tagOf(list[0])) && childrenOf(list[0]).length) {
    list = keep(childrenOf(list[0]));
  }
  const groups = [];
  let run = null;
  for (const n of list) {
    if (CONTAINER_TAGS.includes(tagOf(n)) || isMarked(n)) { groups.push([n]); run = null; }
    else if (run) run.push(n);
    else { run = [n]; groups.push(run); }
  }
  return groups;
}

// page.evaluate serialises a function without its module scope, so the page gets
// groupSections' own source with the two tag lists it reads bound beside it — never a
// second copy of the rule.
export const GROUP_SECTIONS_PAGE_SRC = `(() => { const CONTAINER_TAGS = ${JSON.stringify(CONTAINER_TAGS)}; const SKIP_TAGS = ${JSON.stringify(SKIP_TAGS)}; return ${groupSections}; })()`;

class UsageError extends Error {}

function parseArgs(argv) {
  const [, , url, ...rest] = argv;
  const opts = { out: null, width: 1280, profile: 'eds', split: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--split') {
      opts.split = rest[i += 1];
      if (!opts.split) throw new UsageError('--split needs a selector, e.g. --split \'main > *\'');
    }
  }
  return { url, opts };
}

// Runs IN the page: tag every top-level prototype section with data-ss-idx and
// return its name, then detect repeating-unit groups per section (same grouping
// idea as style-fingerprint.mjs #90, but CONTENT-shaped: what a repeat unit
// contains, so ENCODE knows what "one row per unit" must carry). Without a
// prototype section (or with --split given) the sections are inferred by
// groupSections (passed in as its injected source).
/* eslint-disable no-undef */
function mapSections(groupSections, { selector, given }) {
  const root = document.querySelector('main') || document.body;
  const all = [...root.querySelectorAll('section, [data-section]')];
  let sections;
  let names = null;
  let split = null;
  if (all.length && !given) {
    const top = all.filter((s) => !s.parentElement.closest('section, [data-section]'));
    sections = top.length ? top : all;
  } else {
    const inRoot = (el) => !!el && el !== root && root.contains(el);
    const candidates = [...document.querySelectorAll(selector)].filter((el) => inRoot(el) && !inRoot(el.parentElement.closest(selector)));
    const parts = groupSections(candidates, {
      tagOf: (el) => el.tagName.toLowerCase(),
      childrenOf: (el) => [...el.children],
      isMarked: (el) => ['data-section', 'data-block', 'data-module'].some((a) => el.hasAttribute(a)),
    });
    // inventory()/editableInventory() read only the FIRST match of their root selector,
    // so a section of several elements gets one wrapper; display: contents keeps the
    // wrapped elements in their parent's layout.
    sections = parts.map((g) => {
      if (g.length === 1) return g[0];
      const wrap = document.createElement('div');
      wrap.setAttribute('data-ss-split', '');
      wrap.style.display = 'contents';
      g[0].before(wrap);
      wrap.append(...g);
      return wrap;
    });
    names = parts.map((g) => g[0].getAttribute('data-section') || g[0].classList[0] || g[0].tagName.toLowerCase());
    split = { selector, inferred: parts.length };
  }
  const out = [];
  sections.forEach((sec, idx) => {
    sec.setAttribute('data-ss-idx', String(idx));
    const name = names ? names[idx] : sec.getAttribute('data-section') || (sec.className || '').toString().split(' ')[0] || `section-${idx}`;

    // Repeating-unit groups: containers whose direct children form >=2 same
    // tag+class siblings that carry content. Outermost groups only — a card's
    // inner list is part of the card unit, not a second group.
    const reported = [];
    const groups = [];
    for (const c of [sec, ...sec.querySelectorAll('*')]) {
      if (reported.some((r) => r !== c && r.contains(c))) continue; // inside a reported unit
      const byKey = {};
      [...c.children].forEach((k) => {
        const key = `${k.tagName}.${(k.className || '').toString().split(' ')[0] || ''}`;
        (byKey[key] ||= []).push(k);
      });
      for (const [key, members] of Object.entries(byKey)) {
        if (members.length < 2) continue;
        const compose = (el) => ({
          headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
          ctas: [...el.querySelectorAll('a')].filter((a) => a.textContent.trim() && !a.querySelector('img,picture')).length,
          imgs: el.querySelectorAll('img,picture').length,
          textRuns: [...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length,
        });
        const units = members.map(compose);
        const hasContent = units.some((u) => u.headings || u.ctas || u.imgs || u.textRuns);
        if (!hasContent) continue;
        const sig = (u) => `${u.headings}|${u.ctas}|${u.imgs}|${u.textRuns}`;
        groups.push({
          unitSelector: key,
          count: members.length,
          unit: units[0],
          uniform: units.every((u) => sig(u) === sig(units[0])),
        });
        reported.push(...members);
      }
    }
    out.push({ idx, section: name, repeats: groups });
  });
  return { split, sections: out };
}
/* eslint-enable no-undef */

const USAGE = 'usage: node skills/deploy/scripts/section-schema.mjs <prototypeURL> [--out file] [--width px] [--profile eds|generic] [--split sel]';

async function main() {
  const { url, opts } = parseArgs(process.argv);
  if (!url) throw new UsageError('');
  const prof = resolveProfile(opts.profile);
  // playwright is imported only here, so --help and an import of this module answer on a checkout without it.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  let split;
  let sections;
  try {
    // reducedMotion matches content-diff's grab(): all three gates must inventory
    // the same settled DOM, or an entrance animation flips a role across gates.
    const page = await browser.newPage({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);

    // One expression: mapSections called with groupSections' injected source and the --split settings.
    const splitArg = JSON.stringify({ selector: opts.split || SPLIT_DEFAULT, given: opts.split !== null });
    const mapped = await page.evaluate(`(${mapSections})(${GROUP_SECTIONS_PAGE_SRC}, ${splitArg})`);
    split = mapped.split;
    sections = [];
    for (const m of mapped.sections) {
      const inv = await page.evaluate(inventory, [`[data-ss-idx="${m.idx}"]`, prof.eyebrow]);
      const editable = await page.evaluate(editableInventory, [`[data-ss-idx="${m.idx}"]`]);
      sections.push({
        section: m.section,
        items: inv.items.map(({ role, order, text, href }) => (href !== undefined ? { role, order, text, href } : { role, order, text })),
        imgCount: inv.imgCount,
        editableTexts: editable.count,
        repeats: m.repeats,
      });
    }
  } finally {
    await browser.close();
  }

  const schema = { source: url, width: opts.width, profile: prof.name, split, sections };
  const json = JSON.stringify(schema, null, 1);
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, `${json}\n`);
    const totals = sections.map((s) => `${s.section}(${s.items.length} items${s.repeats.length ? `, ${s.repeats.map((r) => `${r.count}×${r.unitSelector}`).join('+')}` : ''}, ${s.editableTexts} editable)`).join(', ');
    const inferred = split ? `inferred ${split.inferred} section(s) from --split '${split.selector}' (${opts.split !== null ? '--split given' : 'no <section> in <main>'})\n` : '';
    process.stdout.write(`${inferred}schema → ${opts.out}\n${sections.length} sections: ${totals}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

// Compare by real path: a symlinked checkout must not turn the CLI into a silent no-op.
function isMainModule() {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(0);
  }
  main().catch((e) => {
    process.stderr.write(e instanceof UsageError ? `${e.message ? `section-schema: ${e.message}\n` : ''}${USAGE}\n` : `section-schema error: ${e.message}\n`);
    process.exit(1);
  });
}
