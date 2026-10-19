#!/usr/bin/env node
/**
 * skills/reskin/scripts/figma-text-gate.mjs — the Figma text gate (reskin Phase 5 for Figma-sourced pages;
 * reference/gates.md § Figma text gate). dom-equality needs a source DOM; a Figma-only page has none, so this
 * gate takes its reference from the Figma tree itself — never from the content model, which is what it checks.
 *
 * Reference: every effectively-visible TEXT node of the page frame's body sections, in reading order, in
 * rendered case (figma/content.mjs textReference: the same visibility, segmentation and order rules the
 * model was built with, re-derived from the cached nodes response). Chrome (header/footer) is outside the
 * gate, as for live pages.
 * Measure: the render's <main> innerText (whitespace collapsed) and its form controls' placeholders.
 * Each reference string is consumed in order from the innerText; the check reports
 *   missing    a reference string the render does not show
 *   order      shown, but before an earlier reference (an order swap)
 *   case       shown only in another case (TITLE refs are caseless by default: CSS capitalize ≠ Figma TITLE)
 *   duplicate  shown more often than the design has it
 *   extra      rendered text that matches no reference (between or after consumed strings)
 * and for drawn fields (text-ops.json op "attr") the placeholder attributes, in order.
 * text-ops.json beside the model (or --text-ops) declares what not to expect: text ops omit | attr | caseless |
 * replace { node, op, to?, text?, why }. (The page's reskin/deltas/<slug>.json is dom-equality's and
 * slot-coverage's, not this gate's.) The verdict is PASS only with zero findings.
 *
 * Usage: node figma-text-gate.mjs --model <content-model.json> --rendered <file|url>
 *          [--text-ops <text-ops.json>] [--nodes <nodes.json>] [--dir stardust] [--scope main]
 *          [--report <out.json>] [--wait-until load|networkidle]
 *          [--wait-eds] [--eds-timeout <ms>] [--auth-header <value> | --token-env <NAME>]
 * On an aem.page preview (deployed-gate content, a Figma-only page): the EDS decoration is settled first
 * (--wait-eds, implied on an EDS host; a stall is exit 2) and the site token goes to the rendered origin only,
 * never printed (deployed/eds.mjs).
 * Exit: 0 PASS, 1 FAIL, 2 setup (no cached frame, playwright missing, bad args).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textReference } from './figma/content.mjs';

const HELP = `usage: node figma-text-gate.mjs --model <content-model.json> --rendered <file|url>
         [--text-ops <text-ops.json>] [--nodes <nodes.json>] [--dir stardust] [--scope main]
         [--report <out.json>] [--wait-until load|networkidle]
         [--wait-eds] [--eds-timeout <ms>] [--auth-header <value> | --token-env <NAME>]

The Figma text gate: every effectively-visible TEXT node of the page frame (body sections, reading
order, rendered case) appears exactly once, in order, in the render's <main> innerText; drawn-field
placeholders appear as placeholder attributes. The reference is re-read from the cached Figma nodes
response (the model's _provenance.source.figma.node), never from the model. Reports missing, order,
case, duplicate and extra text. text-ops.json beside the model is read by default.
On an http(s) preview: --wait-eds (implied on aem.page) settles the EDS decoration first, a stall is exit 2;
--auth-header / --token-env authenticate on the rendered origin only and are never printed.
Exit 0 PASS, 1 FAIL, 2 setup error, 3 bot challenge.`;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower = (s) => s.toLocaleLowerCase('en');

// Pure: refs [{ node, text, title? }] × measured { text, attrs: [string] } × deltas → findings.
export function compareText(refs, measured, deltas = {}) {
  const ops = new Map();
  for (const d of deltas.text || []) { if (!ops.has(d.node)) ops.set(d.node, []); ops.get(d.node).push(d); }
  const opOf = (r, op) => (ops.get(r.node) || []).find((d) => d.op === op);
  const hay = norm(measured.text);
  const hayL = lower(hay);
  const findings = { missing: [], order: [], case: [], duplicate: [], extra: [], attr: { missing: [], extra: [] } };
  const attrRefs = [];
  const textRefs = [];
  const attrNodes = new Set();
  for (const r of refs) {
    if (opOf(r, 'omit')) continue;
    const a = opOf(r, 'attr');
    if (a) {
      // a drawn field: the strings inside its box are one placeholder (deltas text), consumed once per node
      const k = `${a.field || a.node}\u0000${a.text}`;
      if (!attrNodes.has(k)) { attrNodes.add(k); attrRefs.push({ node: a.field || r.node, text: norm(a.text) }); }
      if (norm(a.text).includes(r.text)) continue;
    }
    const rep = opOf(r, 'replace');
    textRefs.push({ ...r, text: rep ? norm(rep.to) : r.text, caseless: Boolean(r.title || opOf(r, 'caseless')) });
  }
  // attr refs that sit inside other attr refs' fields were folded above; consume the rest in order
  let ai = 0;
  const attrs = (measured.attrs || []).map(norm).filter(Boolean);
  for (const r of attrRefs) {
    const at = attrs.indexOf(r.text, ai);
    if (at < 0) findings.attr.missing.push(r);
    else { for (const x of attrs.slice(ai, at)) findings.attr.extra.push(x); ai = at + 1; }
  }
  for (const x of attrs.slice(ai)) findings.attr.extra.push(x);

  let cursor = 0;
  const gaps = [];
  const consumed = [];
  for (const r of textRefs) {
    const needle = r.text;
    let at = hay.indexOf(needle, cursor);
    let viaCase = false;
    if (at < 0) {
      const ci = hayL.indexOf(lower(needle), cursor);
      if (ci >= 0) { at = ci; viaCase = !r.caseless; }
    }
    if (at >= 0) {
      if (viaCase) findings.case.push({ node: r.node, text: needle, rendered: hay.slice(at, at + needle.length) });
      gaps.push([cursor, at]);
      consumed.push([at, at + needle.length]);
      cursor = at + needle.length;
      continue;
    }
    const before = r.caseless ? hayL.indexOf(lower(needle)) : hay.indexOf(needle);
    if (before >= 0 && before < cursor) findings.order.push({ node: r.node, text: needle, at: before });
    else findings.missing.push({ node: r.node, text: needle });
  }
  gaps.push([cursor, hay.length]);
  // an order-swapped string sits in an earlier gap: it is not also extra
  const blank = (s, start) => {
    let out = s;
    for (const o of findings.order) {
      const i = out.indexOf(o.text);
      if (i >= 0 && o.at >= start && o.at < start + s.length) out = out.slice(0, i) + ' '.repeat(o.text.length) + out.slice(i + o.text.length);
    }
    return out;
  };
  for (const [a, b] of gaps) {
    const g = norm(blank(hay.slice(a, b), a));
    if (/[\p{L}\p{N}]/u.test(g)) findings.extra.push({ text: g.slice(0, 120), at: a });
  }
  // duplicates: a reference string rendered more often than the design has it
  const want = new Map();
  for (const r of textRefs) if (r.text.length >= 4) want.set(r.text, (want.get(r.text) || 0) + 1);
  for (const [t, n] of want) {
    let c = 0; let i = -1;
    while ((i = hay.indexOf(t, i + 1)) >= 0) c += 1;
    // a short string inside a longer reference string is not a duplicate of it
    const inside = textRefs.filter((r) => r.text !== t && r.text.includes(t)).length;
    if (c > n + inside) findings.duplicate.push({ text: t, expected: n, rendered: c });
  }
  const count = findings.missing.length + findings.order.length + findings.case.length + findings.duplicate.length + findings.extra.length + findings.attr.missing.length + findings.attr.extra.length;
  return { verdict: count ? 'FAIL' : 'PASS', refs: textRefs.length, attrRefs: attrRefs.length, findings, count };
}

// The cached nodes responses for the model's frame: <dir>/.work/reskin/figma/<key>/<version>/{nodes,content-nodes-*}.json.
export function findFrame({ dir, model, nodesFile = null }) {
  const src = model?._provenance?.source;
  if (src?.kind !== 'figma') throw Object.assign(new Error('the model is not Figma-sourced (_provenance.source.kind != "figma"): use dom-equality for live pages'), { code: 2 });
  const id = src.figma?.node;
  const files = [];
  if (nodesFile) files.push(nodesFile);
  else {
    const root = join(dir, '.work', 'reskin', 'figma');
    if (existsSync(root)) {
      for (const k of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        if (src.figma.fileKey && src.figma.fileKey !== 'redacted' && k.name !== src.figma.fileKey) continue;
        for (const v of readdirSync(join(root, k.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
          if (src.figma.version && v.name !== String(src.figma.version).replace(/[^A-Za-z0-9._-]+/g, '-') && src.figma.version !== 'current') continue;
          for (const f of readdirSync(join(root, k.name, v.name))) if (f === 'nodes.json' || /^content-nodes-.*\.json$/.test(f)) files.push(join(root, k.name, v.name, f));
        }
      }
    }
  }
  const find = (n) => { if (!n) return null; if (n.id === id) return n; for (const c of n.children || []) { const r = find(c); if (r) return r; } return null; };
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    for (const v of Object.values(j.nodes || {})) { const hit = find(v?.document); if (hit) return { frame: hit, file: f }; }
  }
  throw Object.assign(new Error(`frame ${id} is not in the cached nodes responses under ${join(dir, '.work', 'reskin', 'figma')} (pass --nodes <nodes.json>)`), { code: 2 });
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const VALUES = ['--model', '--rendered', '--text-ops', '--nodes', '--dir', '--scope', '--report', '--wait-until', '--eds-timeout', '--auth-header', '--token-env'];
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--wait-eds') { o.waitEds = true; continue; }
    if (['--auth-header', '--token-env'].includes(argv[i]) && (argv[i + 1] === undefined || !argv[i + 1].trim())) { console.error(`figma-text-gate: ${argv[i]} needs a value`); return 2; }
    if (!VALUES.includes(argv[i]) || argv[i + 1] === undefined) { console.error(`figma-text-gate: unknown or incomplete argument ${argv[i]}\n${HELP}`); return 2; }
    o[argv[i].slice(2)] = argv[++i];
  }
  if (!o.model || !o.rendered) { console.error(HELP); return 2; }
  const dir = o.dir || 'stardust';
  const model = JSON.parse(readFileSync(o.model, 'utf8'));
  const deltasPath = o['text-ops'] || join(dirname(o.model), 'text-ops.json');
  const deltas = existsSync(deltasPath) ? JSON.parse(readFileSync(deltasPath, 'utf8')) : {};
  let frame;
  try { ({ frame } = findFrame({ dir, model, nodesFile: o.nodes })); } catch (e) { console.error(`figma-text-gate: ${e.message}`); return 2; }
  const rulesPath = join(dir, 'reskin', 'content-rules.json');
  const rules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : {};
  const refs = textReference(frame, { rules });

  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { console.error('figma-text-gate: playwright is not importable here (npm i -D playwright --no-save)'); return 2; }
  const target = /^(https?|file):/.test(o.rendered) ? o.rendered : pathToFileURL(resolve(o.rendered)).href;
  const http = /^https?:/.test(target);
  // A preview (http): deployed/eds.mjs settles the decoration and sends the token to this origin only.
  let eds = null; let live = null; let auth = null;
  if (http) {
    try { eds = await import('./deployed/eds.mjs'); live = await eds.loadLiveSession(); } catch (e) { console.error(`figma-text-gate: ${e.message.split('\n')[0]}`); return 2; }
    if (o['auth-header'] !== undefined || o['token-env'] !== undefined) {
      auth = eds.siteAuth({ authHeader: o['auth-header'], tokenEnv: o['token-env'] });
      if (!auth) { console.error('figma-text-gate: no site token: the variable --token-env names is not set in the environment or .env'); return 2; }
    }
  }
  const say = (m) => (auth ? eds.redact(m, auth) : m);
  const browser = await chromium.launch();
  let measured;
  try {
    const viewport = { width: 1440, height: 900 };
    const page = http ? await (await live.newLiveContext(browser, { viewport, ...eds.authContextOptions(target, auth) })).newPage() : await browser.newPage({ viewport });
    if (http) {
      try { await live.gotoLive(page, target, { waitUntil: o['wait-until'] || 'load', timeoutMs: 60000, settleMs: 0 }); } catch (e) { console.error(say(`figma-text-gate: ${e.message}`)); return e.name === 'BotChallengeError' ? 3 : 2; }
      if (o.waitEds || eds.isEdsHost(target)) {
        const { stalled } = await eds.edsSettle(page, { timeoutMs: o['eds-timeout'] ? Number(o['eds-timeout']) : 20000 });
        if (stalled.length) { console.error(say(`figma-text-gate: stalled decoration: ${stalled.join(', ')}`)); return 2; }
      }
    } else await page.goto(target, { waitUntil: o['wait-until'] || 'load' });
    const scope = o.scope || 'main';
    measured = await page.evaluate((sel) => {
      const root = document.querySelector(sel) || document.querySelector('.site-main') || document.body;
      return { text: root.innerText, attrs: [...root.querySelectorAll('input[placeholder], textarea[placeholder]')].map((e) => e.getAttribute('placeholder')), scope: root.tagName.toLowerCase() + (root.className ? `.${String(root.className).split(' ')[0]}` : '') };
    }, scope);
  } finally { await browser.close(); }

  const res = compareText(refs, measured, deltas);
  const out = { _provenance: { writtenBy: 'stardust:reskin/figma-text-gate.mjs', writtenAt: new Date().toISOString() }, gate: 'figma-text', model: o.model, rendered: o.rendered, frame: frame.id, scope: measured.scope, deltas: existsSync(deltasPath) ? deltasPath : null, ...res };
  if (o.report) { mkdirSync(dirname(o.report), { recursive: true }); writeFileSync(o.report, `${JSON.stringify(out, null, 2)}\n`); }
  const f = res.findings;
  console.log(`figma-text-gate: ${res.verdict} · ${res.refs} text ref(s), ${res.attrRefs} placeholder ref(s) · missing ${f.missing.length}, order ${f.order.length}, case ${f.case.length}, duplicate ${f.duplicate.length}, extra ${f.extra.length}, placeholder ${f.attr.missing.length}/${f.attr.extra.length}`);
  for (const [k, list] of Object.entries({ missing: f.missing, order: f.order, case: f.case, duplicate: f.duplicate, extra: f.extra, 'placeholder missing': f.attr.missing, 'placeholder extra': f.attr.extra })) {
    for (const x of list.slice(0, 8)) console.log(`  ${k}: ${JSON.stringify(typeof x === 'string' ? x : x.text).slice(0, 100)}${x.node ? ` (${x.node})` : ''}`);
  }
  return res.verdict === 'PASS' ? 0 : 1;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(fileURLToPath(import.meta.url)) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`figma-text-gate: ${e.message}`); process.exit(e.code === 2 ? 2 : 1); });
}
