#!/usr/bin/env node
/**
 * pipeline-mimic.mjs — apply the DA → EDS delivery pipeline's rewrites to an
 * authored <main> so the local harness shows the DELIVERED shape.
 *
 * Why: build-harness / render-harness / block-roundtrip used to present the
 * authored HTML plus the client runtime (runtimeMimic). Every server-side
 * rewrite was missing, so "emulation passed, published failed" traced to the
 * same handful of pipeline behaviours on eleven recorded projects (13 of 34
 * nested gate agents on one rollout burned their budget on section-metadata
 * rendered as a block, bare <img> where live has <p><picture>, un-hoisted CTAs).
 * The rules below are the catalogued facts (reference/pipeline-facts.md), applied
 * as a string-in / string-out transform that is idempotent: mimic(plain) === plain,
 * so the same scripts can also be pointed at a fetched .plain.html.
 *
 * Rules (each toggleable via opts.rules / --no-<rule>; counted; printed once per run):
 *   sectionMeta  section-metadata block → `style` tokens become classes on the
 *                section div (D7: comma-separated = N classes; space-separated =
 *                ONE hyphen-joined class), other keys → data-<key>; block removed.
 *                --style-split first-only keeps only the first comma token (for a
 *                stack measured to behave so).
 *   meta         page `metadata` block removed; its rows are returned as `meta`
 *                ({ title, template, theme, nav, footer, … }) — build-harness emits
 *                <meta name> tags (the real aem.js decorateTemplateAndTheme reads
 *                them); render-harness sets body.<template>/<theme> directly. The
 *                emptied section stays (delivers as an empty band — META ALONE 🟡).
 *   strip        DA/pipeline attribute + inline canon: `style`, `target`,
 *                `aria-label` and <img width|height> dropped; non-icon <span> and
 *                <small> unwrapped (#39); <b>→<strong>, <i>→<em>, <s>→<del>.
 *   hoist        a link whose ONLY content is one emphasis (`<a><strong>…</strong></a>`,
 *                either nesting, `<em><strong>` kept in order) → `<strong><a>…</a></strong>`
 *                (the shape decorateButtons buttonizes — D6 SOLE-EMPH).
 *   picture      every <img> not already in a <picture> → <picture><img loading="lazy">
 *                </picture>, wrapped in <p> (with its inline ancestors) unless a block
 *                container (<p>, <li>, heading, cell text) already holds it.
 *   emphPicture  <em>/<strong> whose only content is a <picture> is unwrapped.
 *   headingBr    <br> inside <h1>–<h6> removed (a space keeps the words apart).
 *   icon         `:name:` in text → <span class="icon icon-name"></span> (not in <code>/<pre>).
 *   table        a raw <table> directly under a section → block div named after
 *                its first cell (`Cards (dark)` → class="cards dark"), rows → divs.
 *   whitespace   NBSP/space-only <p>/headings dropped; edge <br> runs dropped;
 *                edge NBSP trimmed; edge <br>/whitespace moved out of inline
 *                formatting; adjacent identical <strong>/<em> merged; a block cell
 *                holding ONE <p> is unwrapped to its content. `&#8203;` is kept (D8).
 *
 * Fixtures (`--self-test`, also run by evals/lint/pipeline-mimic-fixture.mjs):
 *   fixtures/pipeline-probe.html + .plain.html  one instance of every rule; the .plain.html is
 *                DERIVED from the fact catalogue (reference/pipeline-facts.md), not recorded —
 *                rows resting on it alone are marked "assumed" there until `--probe --record` re-records it.
 *   fixtures/pipeline-recorded.plain.html  a REAL delivered shape (preview .plain.html, hosts and
 *                names redacted; /media_<hash> src/srcset, <source> sets, width/height, heading
 *                ids): every rule must be a no-op on it, and normaliseForCompare() must hide
 *                exactly those artefacts. Re-record with a fresh DA token: PUT the probe page to a
 *                scratch path, POST /preview/, GET <preview>/<path>.plain.html.
 *
 * Module: `pipelineMimic(html, { styleSplit, rules }) → { html, meta, counts }`,
 * `formatCounts(counts)`, `bodyClasses(meta)`, `metaTags(meta)`, `normaliseForCompare(html)`,
 * `probeVerdicts(fixtureHtml, plainHtml)`, `contractStyleSplit(contractPath)`, `resolveStyleSplit(flag, root)`,
 * `scanAutoBlocks(scriptsJsSource)`.
 *
 * Runtime scan (target-runtime.md § Auto-blocking hook — the D1 auto-blocks the project owns):
 *   --runtime scripts/scripts.js [--contract stardust/runtime-contract.json] [--json]
 *   Static regex scan, no execution: every helper `buildAutoBlocks()` calls with `main` becomes one
 *   `{ fn, trigger }` row — `trigger` is the selectors the helper queries (`h1, picture`) or `—`. Rows
 *   are written to the contract's `autoBlocks` key (other keys kept; file created when absent). A helper
 *   that queries both `h1` and `picture` is flagged `guard: h1 and picture must share a section` (the
 *   authored <h1> otherwise leaves its section on every page). No `buildAutoBlocks` → `autoBlocks: []`.
 *   Exit 0 written · 1 cannot read the file.
 *
 * Probe (the D7 "fixture-verify"; re-measures the catalogue on THIS stack — reference/pipeline-facts.md § Probe):
 *   --probe --org <org> --repo <repo> --branch <ref>   PUT the probe fixture to a hidden DA path
 *        (`/.stardust-probe/pipeline-<ts>.html`) → POST /preview/ → GET `<ref>--<repo>--<org>.aem.page/….plain.html`
 *        (bounded retries) → DELETE the preview and the source. Never POST /live/ (D1, D16); ≤ 7 requests,
 *        all on the TARGET, none on the source site. Then the region diff below.
 *   --compare <fetched.plain.html>   the same diff offline on a page already fetched (the eval path).
 *   Verdict per rule (sectionMeta … whitespace): `match` — the fetched page carries the rule as catalogued;
 *   `differ` — disabling the rule (or, for sectionMeta, the other `--style-split`) brings the mimic closer
 *   to the fetched page; `unmeasured` — the fixture never exercised it. Plus `multiValueStyle`
 *   (comma | first-only), `spaceStyle` (hyphen-joined | split), `zwspSurvives`, `residual` (normalised lines
 *   the full mimic still leaves different — 0 when the catalogue explains the whole page), `probedAt`, `ref`,
 *   `origin` — merged into `--contract stardust/runtime-contract.json` under `pipeline` (other keys kept; file
 *   created when absent). `--record` rewrites fixtures/pipeline-probe.plain.html from the fetched page
 *   (`--fixture-dir` for another copy). `resolveStyleSplit(flag, root)` is what build-harness / render-harness /
 *   block-roundtrip call: the `--style-split` flag wins, else `#pipeline.multiValueStyle`, else `comma` — and
 *   they print `style-split <value> (<source>)` once per run.
 *
 * CLI:
 *   node skills/deploy/scripts/pipeline-mimic.mjs <in.html> [--out <file>] [--json]
 *        [--style-split comma|first-only] [--no-<rule> …]
 *   node skills/deploy/scripts/pipeline-mimic.mjs --self-test     # fixture pair check
 *   node skills/deploy/scripts/pipeline-mimic.mjs --probe --org <org> --repo <repo> --branch <ref>
 *        [--contract stardust/runtime-contract.json] [--record] [--fixture-dir <dir>] [--token-env DA_TOKEN] [--json]
 *   node skills/deploy/scripts/pipeline-mimic.mjs --compare <plain.html> [--contract <path>] [--record] [--fixture-dir <dir>] [--json]
 *   node skills/deploy/scripts/pipeline-mimic.mjs --help
 *
 * Exit codes: 0 = ok (self-test passed; probe/compare recorded, every rule matches the catalogue);
 *   1 = usage / read error / self-test failed; 2 = probe NO VERDICT (token missing or 401/403, preview not
 *   2xx, .plain.html not 200 after retries — `pipeline` left untouched, one WARN, never reported as a FAIL);
 *   3 = probe/compare recorded WITH deviations (one line per differing rule; the contract carries the
 *   measured value — the harness then narrows its render, the rule text is never auto-edited) OR with a
 *   residual no rule explains (`residual > 0`, every rule `match`: the page deviates for a reason outside the
 *   catalogue — inspect it, `--record` keeps it; a clean contract is never recorded over it silently).
 * Dependency-free; never writes to content/ (the harness presents the delivered
 * shape — delivery itself is unchanged: 0.19.3 "nothing changes what the pipeline emits").
 * Test hooks: DEPLOY_BATCH_DA_SRC / DEPLOY_BATCH_ADMIN / DEPLOY_BATCH_DELIVERY_BASE (the deploy-batch mock).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveToken } from './lib.mjs';

// ─────────────────────────────────────────────── minimal HTML tree ──
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const INLINE = new Set(['a', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'sup', 'sub', 'code', 'span', 'small', 'mark', 'kbd']);
const BLOCKISH = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dt', 'dd', 'blockquote', 'pre', 'figcaption']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;

export function parse(html) {
  const root = { type: 'root', children: [], parent: null };
  let cur = root;
  let i = 0;
  const push = (n) => { n.parent = cur; cur.children.push(n); return n; };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { push({ type: 'text', text: html.slice(i) }); break; }
    if (lt > i) push({ type: 'text', text: html.slice(i, lt) });
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end < 0 ? html.length : end + 3;
      push({ type: 'raw', text: html.slice(lt, stop) }); i = stop; continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      const stop = end < 0 ? html.length : end + 1;
      push({ type: 'raw', text: html.slice(lt, stop) }); i = stop; continue;
    }
    const close = html.slice(lt).match(/^<\/([a-zA-Z][\w:-]*)\s*>/);
    if (close) {
      const tag = close[1].toLowerCase();
      let n = cur;
      while (n && n.type !== 'root' && n.tag !== tag) n = n.parent;
      if (n && n.type === 'el') cur = n.parent;
      i = lt + close[0].length; continue;
    }
    const open = html.slice(lt).match(/^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+))?)*)\s*(\/?)>/);
    if (!open) { push({ type: 'text', text: '<' }); i = lt + 1; continue; }
    const tag = open[1].toLowerCase();
    const attrs = [];
    for (const m of open[2].matchAll(ATTR_RE)) attrs.push([m[1], m[2] ?? m[3] ?? m[4] ?? null]);
    const el = push({ type: 'el', tag, attrs, children: [] });
    i = lt + open[0].length;
    if (VOID.has(tag) || open[3]) continue;
    if (tag === 'script' || tag === 'style') {
      const end = html.toLowerCase().indexOf(`</${tag}>`, i);
      const stop = end < 0 ? html.length : end;
      el.children.push({ type: 'text', text: html.slice(i, stop), parent: el });
      i = end < 0 ? html.length : stop + tag.length + 3; continue;
    }
    cur = el;
  }
  return root;
}

export function serialize(node) {
  if (node.type === 'text' || node.type === 'raw') return node.text;
  if (node.type === 'root') return node.children.map(serialize).join('');
  const attrs = node.attrs.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${v.replace(/"/g, '&quot;')}"`)).join('');
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

// ── node helpers
const isEl = (n, tag) => n && n.type === 'el' && (tag === undefined || n.tag === tag);
const isWs = (n) => n && n.type === 'text' && !/\S/.test(n.text);
const attr = (el, k) => { const a = el.attrs.find(([n]) => n === k); return a ? a[1] : undefined; };
const setAttr = (el, k, v) => { const a = el.attrs.find(([n]) => n === k); if (a) a[1] = v; else el.attrs.push([k, v]); };
const delAttr = (el, k) => { const before = el.attrs.length; el.attrs = el.attrs.filter(([n]) => n !== k); return before !== el.attrs.length; };
const elChildren = (el) => el.children.filter((c) => c.type === 'el');
const classes = (el) => (attr(el, 'class') || '').split(/\s+/).filter(Boolean);
const remove = (n) => { const p = n.parent; if (!p) return; p.children.splice(p.children.indexOf(n), 1); n.parent = null; };
const replaceWith = (n, ...nodes) => { const p = n.parent; const at = p.children.indexOf(n); nodes.forEach((x) => { x.parent = p; }); p.children.splice(at, 1, ...nodes); n.parent = null; };
const unwrap = (el) => replaceWith(el, ...el.children);
const wrap = (n, tag, attrs = []) => { const w = { type: 'el', tag, attrs, children: [], parent: null }; replaceWith(n, w); n.parent = w; w.children.push(n); return w; };
const el = (tag, attrs = [], children = []) => { const e = { type: 'el', tag, attrs, children: [], parent: null }; children.forEach((c) => { c.parent = e; e.children.push(c); }); return e; };
const text = (t) => ({ type: 'text', text: t, parent: null });
function all(root, pred) { // pre-order, collected before mutation
  const out = [];
  const visit = (n) => { if (n.type === 'el' && pred(n)) out.push(n); (n.children || []).forEach(visit); };
  visit(root);
  return out;
}
const ancestors = (n) => { const a = []; for (let p = n.parent; p && p.type === 'el'; p = p.parent) a.push(p); return a; };

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const textOf = (n) => (n.type === 'text' ? decode(n.text) : n.type === 'el' ? n.children.map(textOf).join('') : '');
export const toClassName = (s) => (s || '').toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const NBSP_RE = /(?:\s| |&nbsp;|&#160;|&#xa0;)/i;
const blank = (s) => !s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s ]/g, '').length;

// Sections = top-level divs of <main> (or of the fragment when no <main> is present).
function mainNode(root) {
  const m = all(root, (n) => n.tag === 'main')[0];
  return m || root;
}
const sections = (root) => mainNode(root).children.filter((c) => isEl(c, 'div'));
// key/value rows of a config block: <div class="x"><div><div>key</div><div>value</div></div>…
function rows(block) {
  return elChildren(block).filter((r) => r.tag === 'div').map((r) => {
    const cells = elChildren(r).filter((c) => c.tag === 'div');
    return cells.length >= 2 ? [textOf(cells[0]).trim().toLowerCase(), textOf(cells[1]).replace(/[\s ]+/g, ' ').trim()] : null;
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────── rules ──
const RULES = ['sectionMeta', 'meta', 'strip', 'hoist', 'picture', 'emphPicture', 'headingBr', 'icon', 'table', 'whitespace'];

function ruleSectionMeta(root, c, styleSplit) {
  for (const sec of sections(root)) {
    for (const block of elChildren(sec).filter((b) => classes(b)[0] === 'section-metadata')) {
      for (const [k, v] of rows(block)) {
        if (k === 'style') {
          const tokens = styleSplit === 'first-only' ? [v.split(',')[0]] : v.split(',');
          const cls = new Set(classes(sec));
          tokens.map((t) => toClassName(t.trim())).filter(Boolean).forEach((t) => cls.add(t));
          setAttr(sec, 'class', [...cls].join(' '));
        } else if (k) setAttr(sec, `data-${toClassName(k)}`, v);
      }
      remove(block); c.sectionMeta += 1;
    }
  }
}

function ruleMeta(root, c) {
  const meta = {};
  for (const sec of sections(root)) {
    for (const block of elChildren(sec).filter((b) => classes(b)[0] === 'metadata')) {
      for (const [k, v] of rows(block)) if (k) meta[k] = v;
      remove(block); c.meta += 1;
      if (!sec.children.some((n) => n.type === 'el' || (n.type === 'text' && /\S/.test(n.text)))) sec.children = []; // empty band, :empty on live
    }
  }
  return meta;
}

function ruleStrip(root, c) {
  for (const e of all(root, () => true)) {
    for (const k of ['style', 'target', 'aria-label']) if (delAttr(e, k)) c.strip += 1;
    if (e.tag === 'img' && !ancestors(e).some((p) => p.tag === 'picture')) for (const k of ['width', 'height']) if (delAttr(e, k)) c.strip += 1;
  }
  for (const e of all(root, (n) => n.tag === 'b' || n.tag === 'i' || n.tag === 's')) { e.tag = { b: 'strong', i: 'em', s: 'del' }[e.tag]; c.strip += 1; }
  for (const e of all(root, (n) => n.tag === 'small' || (n.tag === 'span' && !classes(n).some((k) => k === 'icon' || k.startsWith('icon-'))))) { unwrap(e); c.strip += 1; }
}

function ruleHoist(root, c) {
  for (const a of all(root, (n) => n.tag === 'a')) {
    const kids = a.children.filter((k) => !isWs(k));
    if (kids.length !== 1 || !isEl(kids[0]) || !['strong', 'em'].includes(kids[0].tag)) continue;
    // peel nested sole emphasis in order: <a><em><strong>x</strong></em></a> → <em><strong><a>x</a></strong></em>
    const chain = [];
    let inner = kids[0];
    while (isEl(inner) && ['strong', 'em'].includes(inner.tag)) {
      chain.push(inner);
      const k = inner.children.filter((x) => !isWs(x));
      if (k.length === 1 && isEl(k[0]) && ['strong', 'em'].includes(k[0].tag)) inner = k[0]; else break;
    }
    const content = chain[chain.length - 1].children;
    a.children = []; content.forEach((n) => { n.parent = a; a.children.push(n); });
    let outer = a;
    for (const e of chain) { e.children = []; outer = wrap(outer, e.tag, e.attrs); }
    c.hoist += 1;
  }
}

function rulePicture(root, c) {
  for (const img of all(root, (n) => n.tag === 'img')) {
    if (ancestors(img).some((p) => p.tag === 'picture')) continue;
    const keep = img.attrs.filter(([k]) => k !== 'loading' && k !== 'alt' && k !== 'src');
    const alt = attr(img, 'alt'); const src = attr(img, 'src');
    img.attrs = [['loading', 'lazy'], ...(alt !== undefined ? [['alt', alt]] : []), ...(src !== undefined ? [['src', src]] : []), ...keep];
    const pic = wrap(img, 'picture');
    c.picture += 1;
    if (ancestors(pic).some((p) => BLOCKISH.has(p.tag))) continue;
    let top = pic;
    while (top.parent && top.parent.type === 'el' && INLINE.has(top.parent.tag)) top = top.parent;
    if (top.parent && top.parent.type === 'el' && (top.parent.tag === 'div' || top.parent.tag === 'main')) wrap(top, 'p');
  }
}

function ruleEmphPicture(root, c) {
  for (const e of all(root, (n) => n.tag === 'em' || n.tag === 'strong')) {
    const kids = e.children.filter((k) => !isWs(k));
    if (kids.length === 1 && isEl(kids[0], 'picture')) { unwrap(e); c.emphPicture += 1; }
  }
}

function ruleHeadingBr(root, c) {
  for (const h of all(root, (n) => HEADINGS.has(n.tag))) {
    for (const br of all(h, (n) => n.tag === 'br')) {
      const prev = br.parent.children[br.parent.children.indexOf(br) - 1];
      const next = br.parent.children[br.parent.children.indexOf(br) + 1];
      const needsSpace = prev && next && /\S$/.test(textOf(prev)) && /^\S/.test(textOf(next));
      if (needsSpace) replaceWith(br, text(' ')); else remove(br);
      c.headingBr += 1;
    }
  }
}

function ruleIcon(root, c) {
  const visit = (n) => {
    if (n.type === 'el' && (n.tag === 'code' || n.tag === 'pre')) return;
    if (n.type === 'text' && /:[a-z][a-z0-9-]*:/.test(n.text)) {
      const parts = [];
      let last = 0;
      for (const m of n.text.matchAll(/:([a-z][a-z0-9-]*):/g)) {
        if (m.index > last) parts.push(text(n.text.slice(last, m.index)));
        parts.push(el('span', [['class', `icon icon-${m[1]}`]]));
        last = m.index + m[0].length; c.icon += 1;
      }
      if (last < n.text.length) parts.push(text(n.text.slice(last)));
      replaceWith(n, ...parts);
      return;
    }
    [...(n.children || [])].forEach(visit);
  };
  visit(root);
}

function ruleTable(root, c) {
  for (const sec of sections(root)) {
    for (const table of elChildren(sec).filter((t) => t.tag === 'table')) {
      const trs = all(table, (n) => n.tag === 'tr');
      if (!trs.length) continue;
      const cellsOf = (tr) => elChildren(tr).filter((x) => x.tag === 'td' || x.tag === 'th');
      const head = textOf(cellsOf(trs[0])[0] || trs[0]).trim();
      const m = head.match(/^([^(]+?)\s*(?:\(([^)]*)\))?\s*$/);
      const cls = [toClassName(m ? m[1] : head), ...(m && m[2] ? m[2].split(',').map((v) => toClassName(v.trim())) : [])].filter(Boolean);
      const block = el('div', [['class', cls.join(' ')]]);
      for (const tr of trs.slice(1)) {
        const row = el('div');
        for (const td of cellsOf(tr)) { const cell = el('div', [], td.children.filter((k) => !isWs(k))); row.children.push(cell); cell.parent = row; }
        block.children.push(row); row.parent = block;
      }
      replaceWith(table, block); c.table += 1;
    }
  }
}

function ruleWhitespace(root, c) {
  // (a) NBSP/space-only paragraphs and headings (only <br> children allowed) vanish
  for (const p of all(root, (n) => n.tag === 'p' || HEADINGS.has(n.tag))) {
    if (p.children.every((k) => (k.type === 'text' && blank(k.text)) || isEl(k, 'br'))) { remove(p); c.whitespace += 1; }
  }
  // (b) adjacent identical emphasis merges (no text between)
  for (const e of all(root, (n) => n.tag === 'strong' || n.tag === 'em')) {
    if (!e.parent) continue;
    const sib = e.parent.children;
    const next = sib[sib.indexOf(e) + 1];
    if (isEl(next, e.tag) && !e.attrs.length && !next.attrs.length) {
      next.children.forEach((k) => { k.parent = e; e.children.push(k); });
      remove(next); c.whitespace += 1;
    }
  }
  // (c) edge <br> / whitespace moves OUT of inline formatting
  for (const e of all(root, (n) => INLINE.has(n.tag) && n.tag !== 'code' && n.tag !== 'span')) { // surviving spans are icons
    if (!e.parent) continue;
    const at = () => e.parent.children.indexOf(e);
    while (e.children.length && (isEl(e.children[0], 'br') || isWs(e.children[0]))) { const k = e.children.shift(); k.parent = e.parent; e.parent.children.splice(at(), 0, k); c.whitespace += 1; }
    while (e.children.length && (isEl(e.children[e.children.length - 1], 'br') || isWs(e.children[e.children.length - 1]))) { const k = e.children.pop(); k.parent = e.parent; e.parent.children.splice(at() + 1, 0, k); c.whitespace += 1; }
    if (e.children.length) {
      const first = e.children[0]; const last = e.children[e.children.length - 1];
      if (first.type === 'text' && /^\s/.test(first.text)) { const m = first.text.match(/^\s+/)[0]; first.text = first.text.slice(m.length); e.parent.children.splice(at(), 0, text(m)); c.whitespace += 1; }
      if (last.type === 'text' && /\s$/.test(last.text)) { const m = last.text.match(/\s+$/)[0]; last.text = last.text.slice(0, -m.length); e.parent.children.splice(at() + 1, 0, text(m)); c.whitespace += 1; }
    }
    if (!e.children.length) { remove(e); c.whitespace += 1; }
  }
  // (d) edge <br> runs and edge NBSP inside p / heading / li / cell
  for (const p of all(root, (n) => BLOCKISH.has(n.tag) || (n.tag === 'div' && n.parent && isEl(n.parent, 'div') && n.parent.parent && isEl(n.parent.parent, 'div') && classes(n.parent.parent).length > 0))) {
    const kids = p.children;
    const dropEdge = (idx) => { const k = kids[idx]; if (isEl(k, 'br') || (k.type === 'text' && blank(k.text) && NBSP_RE.test(k.text) && / |&nbsp;|&#160;/i.test(k.text))) { remove(k); c.whitespace += 1; return true; } return false; };
    // strip trailing: <br> or NBSP-only text, skipping pure whitespace text
    for (;;) {
      let j = kids.length - 1;
      while (j >= 0 && isWs(kids[j])) j -= 1;
      if (j < 0 || !dropEdge(j)) break;
    }
    for (;;) {
      let j = 0;
      while (j < kids.length && isWs(kids[j])) j += 1;
      if (j >= kids.length || !dropEdge(j)) break;
    }
    const firstText = kids.find((k) => k.type === 'text' && /\S/.test(k.text) || k.type === 'el');
    if (firstText && firstText.type === 'text') { const t = firstText.text.replace(/^(?:\s*(?: |&nbsp;|&#160;))+\s*/i, ''); if (t !== firstText.text) { firstText.text = t; c.whitespace += 1; } }
    const lastText = [...kids].reverse().find((k) => k.type === 'text' && /\S/.test(k.text) || k.type === 'el');
    if (lastText && lastText.type === 'text') { const t = lastText.text.replace(/\s*(?:(?: |&nbsp;|&#160;)\s*)+$/i, ''); if (t !== lastText.text) { lastText.text = t; c.whitespace += 1; } }
  }
  // (e) a block cell holding exactly one <p> (and nothing else) unwraps to its content
  for (const sec of sections(root)) {
    for (const block of elChildren(sec).filter((b) => b.tag === 'div' && classes(b).length)) {
      for (const row of elChildren(block).filter((r) => r.tag === 'div')) {
        for (const cell of elChildren(row).filter((x) => x.tag === 'div')) {
          const kids = cell.children.filter((k) => !isWs(k));
          if (kids.length === 1 && isEl(kids[0], 'p') && !kids[0].attrs.length) {
            cell.children = []; kids[0].children.forEach((k) => { k.parent = cell; cell.children.push(k); }); c.whitespace += 1;
          }
        }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────── API ──
export function pipelineMimic(html, { styleSplit = 'comma', rules = {} } = {}) {
  const on = (r) => rules[r] !== false;
  const counts = Object.fromEntries(RULES.map((r) => [r, 0]));
  const root = parse(html);
  let meta = {};
  if (on('sectionMeta')) ruleSectionMeta(root, counts, styleSplit);
  if (on('meta')) meta = ruleMeta(root, counts);
  if (on('strip')) ruleStrip(root, counts);
  if (on('hoist')) ruleHoist(root, counts);
  if (on('picture')) rulePicture(root, counts);
  if (on('emphPicture')) ruleEmphPicture(root, counts);
  if (on('headingBr')) ruleHeadingBr(root, counts);
  if (on('icon')) ruleIcon(root, counts);
  if (on('table')) ruleTable(root, counts);
  if (on('whitespace')) ruleWhitespace(root, counts);
  return { html: serialize(root), meta, counts };
}

export const formatCounts = (c) => `pipeline emulation: section-metadata ${c.sectionMeta}, meta ${c.meta}, picture ${c.picture}, hoist ${c.hoist}, whitespace ${c.whitespace}, table→block ${c.table}, icon ${c.icon}, heading-br ${c.headingBr}, emph-picture ${c.emphPicture}, strip ${c.strip}`;
// body classes the real decorateTemplateAndTheme() would add from template / theme rows
export const bodyClasses = (meta) => ['template', 'theme'].map((k) => meta[k]).filter(Boolean).flatMap((v) => v.split(',')).map((v) => toClassName(v.trim())).filter(Boolean);
// <meta name> tags for build-harness (the real aem.js reads getMetadata('template'|'theme'|'nav'|'footer'))
export const metaTags = (meta) => Object.entries(meta).filter(([k]) => k !== 'title').map(([k, v]) => `<meta name="${k.replace(/"/g, '&quot;')}" content="${v.replace(/"/g, '&quot;')}">`).join('\n');
// Fixture comparison: a recorded .plain.html carries /media_<hash> src/srcset,
// <source> children and real image dimensions that no local mimic can produce.
export const normaliseForCompare = (html) => html
  .replace(/<source\b[^>]*>/gi, '')
  .replace(/\s(src|srcset)="[^"]*"/gi, ' $1="#"')
  .replace(/<img\b[^>]*>/gi, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, ''))
  .replace(/>\s+</g, '>\n<')
  .trim();

// Fixture pair check (also run by evals/lint/pipeline-mimic-fixture.mjs).
export function selfTest(dir = path.join(import.meta.dirname, 'fixtures')) {
  const src = readFileSync(path.join(dir, 'pipeline-probe.html'), 'utf8');
  const plain = readFileSync(path.join(dir, 'pipeline-probe.plain.html'), 'utf8');
  const out = pipelineMimic(src);
  const failures = [];
  const a = normaliseForCompare(out.html); const b = normaliseForCompare(plain);
  if (a !== b) {
    const la = a.split('\n'); const lb = b.split('\n');
    const at = la.findIndex((l, i) => l !== lb[i]);
    failures.push(`mimic(fixture) ≠ recorded .plain.html at line ${at + 1}:\n    got:      ${la[at]}\n    expected: ${lb[at]}`);
  }
  const twice = pipelineMimic(plain).html;
  if (twice !== plain) {
    const la = twice.split('\n'); const lb = plain.split('\n');
    const at = la.findIndex((l, i) => l !== lb[i]);
    failures.push(`mimic(plain) is not idempotent at line ${at + 1}:\n    got:      ${la[at]}\n    expected: ${lb[at]}`);
  }
  for (const r of RULES) if (!out.counts[r]) failures.push(`rule ${r} never fired on the fixture — the fixture must exercise every rule once`);
  // recorded delivered shape (redacted preview .plain.html: /media_<hash> src/srcset, <source> sets, real
  // width/height, heading ids): every rule must leave it untouched, and the normaliser must hide exactly
  // the artefacts no local mimic can produce
  const recorded = readFileSync(path.join(dir, 'pipeline-recorded.plain.html'), 'utf8');
  const again = pipelineMimic(recorded).html;
  if (again !== recorded) {
    const la = again.split('\n'); const lb = recorded.split('\n');
    const at = la.findIndex((l, i) => l !== lb[i]);
    failures.push(`mimic(recorded .plain.html) is not idempotent at line ${at + 1}:\n    got:      ${la[at]}\n    expected: ${lb[at]}`);
  }
  if (!/<source\b/.test(recorded) || !/media_[0-9a-f]{20,}/.test(recorded) || !/<img\b[^>]*\swidth="\d+"[^>]*\sheight="\d+"/.test(recorded)) failures.push('pipeline-recorded.plain.html must stay a real recording: <source> sets, /media_<hash> URLs and image dimensions');
  const n = normaliseForCompare(recorded);
  if (/<source\b|media_[0-9a-f]{20,}|\s(?:width|height)="/.test(n)) failures.push('normaliseForCompare left a <source>, a media hash or an image dimension in place');
  if (out.meta.template !== 'Landing Page' || out.meta.nav !== '/nav-minimal') failures.push(`meta rows not returned: ${JSON.stringify(out.meta)}`);
  return { failures, counts: out.counts, meta: out.meta };
}

// ────────────────────────────────────────────────────────── probe ──
const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';
const ADMIN = process.env.DEPLOY_BATCH_ADMIN || 'https://admin.hlx.page';
const DELIVERY_BASE = process.env.DEPLOY_BATCH_DELIVERY_BASE || null;
const PROBE_RETRIES = 3;
const PROBE_DELAY_MS = Number(process.env.PIPELINE_PROBE_DELAY_MS) || 2000;
const ZWSP = /\u200b|&#8203;|&#x200b;/i;
const forDiff = (html) => normaliseForCompare(html).replace(/&#8203;|&#x200b;/gi, '\u200b').split('\n');
/** symmetric line-multiset distance — enough to say which variant sits closer to a fixture-sized page */
function distance(a, b) {
  const count = new Map();
  for (const l of a) count.set(l, (count.get(l) || 0) + 1);
  for (const l of b) count.set(l, (count.get(l) || 0) - 1);
  let d = 0; for (const v of count.values()) d += Math.abs(v);
  return d;
}

/** Per-rule verdicts of a fetched .plain.html against the catalogue (the mimic) applied to the probe fixture. */
export function probeVerdicts(fixtureHtml, plainHtml) {
  const target = forDiff(plainHtml);
  const full = pipelineMimic(fixtureHtml);
  const base = distance(forDiff(full.html), target);
  const rules = {};
  for (const r of RULES) {
    if (!full.counts[r]) { rules[r] = 'unmeasured'; continue; }
    if (base === 0) { rules[r] = 'match'; continue; }
    const without = distance(forDiff(pipelineMimic(fixtureHtml, { rules: { [r]: false } }).html), target);
    rules[r] = without < base ? 'differ' : 'match';
  }
  let multiValueStyle = 'comma';
  if (base > 0 && full.counts.sectionMeta) {
    const firstOnly = distance(forDiff(pipelineMimic(fixtureHtml, { styleSplit: 'first-only' }).html), target);
    if (firstOnly < base) { multiValueStyle = 'first-only'; rules.sectionMeta = 'differ'; }
  }
  // a space-separated `style` token: the catalogue says ONE hyphen-joined class; `split` when the page shows the tokens apart
  const spaceToken = [...fixtureHtml.matchAll(/<div>style<\/div><div>([^<]+)<\/div>/gi)].map((m) => m[1].trim()).find((v) => !v.includes(',') && /\s/.test(v));
  let spaceStyle = 'unmeasured';
  if (spaceToken) {
    const joined = toClassName(spaceToken); const apart = spaceToken.split(/\s+/).map(toClassName);
    const classAttrs = [...plainHtml.matchAll(/<div class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
    if (classAttrs.some((c) => c.includes(joined))) spaceStyle = 'hyphen-joined';
    else if (classAttrs.some((c) => apart.every((t) => c.includes(t)))) { spaceStyle = 'split'; rules.sectionMeta = 'differ'; }
  }
  const zwspSurvives = ZWSP.test(fixtureHtml) ? ZWSP.test(plainHtml) : null;
  const deviations = RULES.filter((r) => rules[r] === 'differ');
  return { rules, multiValueStyle, spaceStyle, zwspSurvives, deviations, distance: base };
}

/** `pipeline.multiValueStyle` from a runtime contract — the harness default when --style-split is absent; null when unmeasured. */
export function contractStyleSplit(contractPath = 'stardust/runtime-contract.json') {
  try {
    const v = JSON.parse(readFileSync(contractPath, 'utf8')).pipeline?.multiValueStyle;
    return v === 'comma' || v === 'first-only' ? v : null;
  } catch { return null; }
}

/** The harness scripts' styleSplit: the flag wins, else the measured `#pipeline.multiValueStyle` under <root>/stardust/, else comma. */
export function resolveStyleSplit(flag, root = process.cwd()) {
  if (flag) return { value: flag, source: '--style-split' };
  const measured = contractStyleSplit(path.join(root, 'stardust', 'runtime-contract.json'));
  if (measured) return { value: measured, source: 'runtime-contract.json#pipeline' };
  return { value: 'comma', source: 'default — #pipeline unmeasured' };
}
export const styleSplitLine = (r) => `style-split ${r.value} (${r.source})`;

function mergeContract(file, pipeline) {
  let contract = {};
  if (existsSync(file)) { try { contract = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON (${e.message}) — fix it; nothing written`); } }
  contract.pipeline = pipeline;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
}

function recordVerdicts(opts, fixtureHtml, plainHtml, origin) {
  const v = probeVerdicts(fixtureHtml, plainHtml);
  const pipeline = { ...v.rules, multiValueStyle: v.multiValueStyle, spaceStyle: v.spaceStyle, zwspSurvives: v.zwspSurvives, residual: v.distance, probedAt: new Date().toISOString(), ref: opts.branch || null, origin };
  const unexplained = v.distance > 0 && !v.deviations.length;
  mergeContract(opts.contract, pipeline);
  if (opts.record) { writeFileSync(path.join(opts.fixtureDir, 'pipeline-probe.plain.html'), plainHtml); process.stderr.write(`pipeline probe: recorded ${path.join(opts.fixtureDir, 'pipeline-probe.plain.html')}\n`); }
  if (opts.json) process.stdout.write(`${JSON.stringify(pipeline, null, 2)}\n`);
  else {
    process.stdout.write(`pipeline probe: ${RULES.map((r) => `${r} ${v.rules[r]}`).join(', ')} · multiValueStyle ${v.multiValueStyle} · spaceStyle ${v.spaceStyle} · zwspSurvives ${v.zwspSurvives} · residual ${v.distance} → ${opts.contract}#pipeline\n`);
    for (const r of v.deviations) process.stdout.write(`  differ: ${r} — the fetched page does not carry this rule as catalogued (reference/pipeline-facts.md); the measured value is in the contract, the rule text is unchanged\n`);
  }
  if (unexplained) process.stderr.write(`WARN pipeline probe: residual ${v.distance} normalised line(s) differ that no catalogued rule explains — the page deviates for a reason outside reference/pipeline-facts.md; inspect the fetched .plain.html (--record keeps it under the fixture dir) before trusting the local render; recorded with residual (exit 3)\n`);
  return v.deviations.length || unexplained ? 3 : 0;
}

// ─────────────────────────────────────────────────────── runtime scan ──

/** The body of `function <name>(` … matching-brace, or null. */
function fnBody(src, name) {
  const m = src.match(new RegExp(`(?:function\\s+${name}\\s*\\([^)]*\\)|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>)\\s*\\{`));
  if (!m) return null;
  let i = m.index + m[0].length; let depth = 1; const start = i;
  for (; i < src.length && depth; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}') depth -= 1; }
  return depth ? null : src.slice(start, i - 1);
}

/** Static inventory of the auto-blocks `buildAutoBlocks()` wires: [{ fn, trigger, guard? }]. */
export function scanAutoBlocks(src) {
  const body = fnBody(src, 'buildAutoBlocks');
  if (body === null) return [];
  const calls = [...new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(\s*main\b/g)].map((m) => m[1]).filter((n) => n !== 'buildAutoBlocks'))];
  return calls.map((fn) => {
    const helper = fnBody(src, fn) || '';
    const selectors = [...new Set([...helper.matchAll(/querySelector(?:All)?\(\s*(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2].trim()))];
    const row = { fn, trigger: selectors.length ? selectors.join(', ') : '—' };
    if (selectors.some((q) => /\bh1\b/.test(q)) && selectors.some((q) => /\bpicture\b|\bimg\b/.test(q))) row.guard = 'h1 and picture must share a section';
    return row;
  });
}

function runtimeScan(opts) {
  let src;
  try { src = readFileSync(opts.runtime, 'utf8'); } catch (e) { process.stderr.write(`cannot read ${opts.runtime}: ${e.message}\n`); return 1; }
  const autoBlocks = scanAutoBlocks(src);
  const file = opts.contract;
  let contract = {};
  if (existsSync(file)) { try { contract = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { process.stderr.write(`${file} is not valid JSON (${e.message}) — fix it; nothing written\n`); return 1; } }
  contract.autoBlocks = autoBlocks;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
  if (opts.json) process.stdout.write(`${JSON.stringify(autoBlocks, null, 2)}\n`);
  else {
    process.stdout.write(`runtime scan: ${autoBlocks.length} auto-block${autoBlocks.length === 1 ? '' : 's'} in ${opts.runtime} → ${file}#autoBlocks\n`);
    for (const r of autoBlocks) process.stdout.write(`  ${r.fn}  trigger: ${r.trigger}${r.guard ? `  guard: ${r.guard}` : ''}\n`);
  }
  return 0;
}

async function probe(opts) {
  const fixtureHtml = readFileSync(path.join(opts.fixtureDir, 'pipeline-probe.html'), 'utf8');
  const noVerdict = (why) => { process.stderr.write(`WARN pipeline probe: no verdict — ${why}; ${opts.contract}#pipeline left as is, the catalogue defaults apply (exit 2)\n`); return 2; };
  const tok = resolveToken(opts.tokenEnv);
  if (!tok) return noVerdict(`${opts.tokenEnv} missing (run node skills/deploy/scripts/da-token-check.mjs)`);
  const { org, repo, branch } = opts;
  const p = `/.stardust-probe/pipeline-${Date.now()}`;
  const headers = { Authorization: `Bearer ${tok.value}` };
  const call = async (method, url, body) => { try { const res = await fetch(url, { method, headers, body }); return res; } catch (err) { return { status: 0, text: async () => String(err.message || err) }; } };
  const fd = new FormData(); fd.append('data', new Blob([fixtureHtml], { type: 'text/html' }), 'pipeline-probe.html');
  const put = await call('PUT', `${DA_SRC}/${org}/${repo}${p}.html`, fd);
  if (put.status < 200 || put.status >= 300) return noVerdict(`PUT ${put.status} (token source: ${tok.source})`);
  const cleanup = async () => { await call('DELETE', `${ADMIN}/preview/${org}/${repo}/${branch}${p}`); await call('DELETE', `${DA_SRC}/${org}/${repo}${p}.html`); };
  const prev = await call('POST', `${ADMIN}/preview/${org}/${repo}/${branch}${p}`);
  if (prev.status < 200 || prev.status >= 300) { await cleanup(); return noVerdict(`preview ${prev.status}`); }
  const origin = DELIVERY_BASE ? `${DELIVERY_BASE}/aem.page` : `https://${branch}--${repo}--${org}.aem.page`;
  let plain = null; let last = 0;
  for (let i = 0; i < PROBE_RETRIES && plain === null; i += 1) {
    const res = await call('GET', `${origin}${p}.plain.html`);
    last = res.status;
    if (res.status === 200) plain = await res.text(); else await new Promise((r) => setTimeout(r, PROBE_DELAY_MS));
  }
  await cleanup();
  if (plain === null) return noVerdict(`.plain.html ${last} after ${PROBE_RETRIES} reads`);
  return recordVerdicts(opts, fixtureHtml, plain, origin);
}

// ──────────────────────────────────────────────────────────── CLI ──
const USAGE = 'usage: node skills/deploy/scripts/pipeline-mimic.mjs <in.html> [--out <file>] [--json] [--style-split comma|first-only] [--no-<rule>]\n'
  + '       node skills/deploy/scripts/pipeline-mimic.mjs --self-test\n'
  + '       node skills/deploy/scripts/pipeline-mimic.mjs --probe --org <org> --repo <repo> --branch <ref> [--contract stardust/runtime-contract.json] [--record] [--fixture-dir <dir>] [--token-env DA_TOKEN] [--json]\n'
  + '       node skills/deploy/scripts/pipeline-mimic.mjs --compare <plain.html> [--contract <path>] [--record] [--fixture-dir <dir>] [--json]\n'
  + '       node skills/deploy/scripts/pipeline-mimic.mjs --runtime scripts/scripts.js [--contract <path>] [--json]   # → contract.autoBlocks [{fn, trigger}]\n'
  + `       rules: ${RULES.join(', ')}\n`
  + '       exit 0 ok · 1 usage / self-test failed · 2 probe no verdict · 3 recorded with deviations or an unexplained residual\n';

async function main(argv) {
  const opts = { out: null, json: false, styleSplit: 'comma', rules: {}, selfTest: false, files: [], probe: false, compare: null, contract: 'stardust/runtime-contract.json', record: false, fixtureDir: path.join(import.meta.dirname, 'fixtures'), tokenEnv: 'DA_TOKEN' };
  const value = (i, flag) => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { process.stderr.write(`${flag} needs a value\n${USAGE}`); throw new RangeError('usage'); } return v; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(USAGE); return 0; }
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--style-split') opts.styleSplit = argv[++i];
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--probe') opts.probe = true;
    else if (a === '--compare') opts.compare = value(i++, a);
    else if (a === '--org') opts.org = value(i++, a);
    else if (a === '--repo') opts.repo = value(i++, a);
    else if (a === '--branch') opts.branch = value(i++, a);
    else if (a === '--contract') opts.contract = value(i++, a);
    else if (a === '--record') opts.record = true;
    else if (a === '--fixture-dir') opts.fixtureDir = value(i++, a);
    else if (a === '--token-env') opts.tokenEnv = value(i++, a);
    else if (a === '--runtime') opts.runtime = value(i++, a);
    else if (a.startsWith('--no-')) { const r = a.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()); if (!RULES.includes(r)) { process.stderr.write(`unknown rule ${a}\n${USAGE}`); return 1; } opts.rules[r] = false; }
    else if (a.startsWith('--')) { process.stderr.write(`unknown option ${a}\n${USAGE}`); return 1; }
    else opts.files.push(a);
  }
  if (!['comma', 'first-only'].includes(opts.styleSplit)) { process.stderr.write(`--style-split must be comma or first-only\n`); return 1; }
  if (opts.runtime) {
    if (opts.probe || opts.compare) { process.stderr.write(`--runtime is its own mode\n${USAGE}`); return 1; }
    return runtimeScan(opts);
  }
  if (opts.probe || opts.compare) {
    if (opts.probe && opts.compare) { process.stderr.write(`--probe and --compare are exclusive\n${USAGE}`); return 1; }
    if (opts.probe && (!opts.org || !opts.repo || !opts.branch)) { process.stderr.write(`--probe needs --org, --repo and --branch\n${USAGE}`); return 1; }
    if (opts.compare) {
      let plain;
      try { plain = readFileSync(opts.compare, 'utf8'); } catch (e) { process.stderr.write(`cannot read ${opts.compare}: ${e.message}\n`); return 1; }
      return recordVerdicts(opts, readFileSync(path.join(opts.fixtureDir, 'pipeline-probe.html'), 'utf8'), plain, `offline:${opts.compare}`);
    }
    return probe(opts);
  }
  if (opts.selfTest) {
    const { failures, counts } = selfTest();
    if (failures.length) { failures.forEach((f) => process.stderr.write(`✗ ${f}\n`)); return 1; }
    process.stdout.write(`pipeline-mimic self-test: fixture pair equal after normalisation, idempotent on .plain.html — ${formatCounts(counts)}\n`);
    return 0;
  }
  if (opts.files.length !== 1) { process.stderr.write(USAGE); return 1; }
  let html;
  try { html = readFileSync(opts.files[0], 'utf8'); } catch (e) { process.stderr.write(`cannot read ${opts.files[0]}: ${e.message}\n`); return 1; }
  const res = pipelineMimic(html, { styleSplit: opts.styleSplit, rules: opts.rules });
  if (opts.out) writeFileSync(opts.out, res.html); else if (!opts.json) process.stdout.write(res.html);
  if (opts.json) process.stdout.write(`${JSON.stringify({ meta: res.meta, counts: res.counts, out: opts.out }, null, 2)}\n`);
  else process.stderr.write(`${formatCounts(res.counts)}\n`);
  return 0;
}

const isCli = process.argv[1] && path.basename(process.argv[1]) === 'pipeline-mimic.mjs';
if (isCli) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => { if (!(e instanceof RangeError)) process.stderr.write(`pipeline-mimic: ${e.message}\n`); process.exit(1); });
