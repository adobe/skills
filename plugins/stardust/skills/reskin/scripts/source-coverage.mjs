#!/usr/bin/env node
/**
 * skills/reskin/scripts/source-coverage.mjs — gate (a′): what the content reference did NOT take in.
 *
 * Every other content gate compares the target with the captured model, so whatever the capture
 * did not observe is invisible to all of them and its loss passes. Three blind spots, one per axis:
 *
 *   S1 space      — regions OUTSIDE the content scope (a sidebar, a breadcrumb, a utility bar).
 *                   capture-content records them as `residue[]`; each one of kind breadcrumb,
 *                   aside, nav or other with ≥ --min-chars of text must be carried to the target
 *                   as a region (one target element, at most 3× the region's text, holding ≥ 60% of
 *                   its text lines) or declared dropped. kind `chrome` (header/footer) is A6's.
 *   S2 time       — content rendered after first paint (an XHR feed). The capture now settles until
 *                   the page text stops growing (`_provenance.settle`); a model without that record,
 *                   or one captured unstable, is reported — re-capture (n/a on a Figma-sourced model:
 *                   nothing renders late in a design file). The target is settled the
 *                   same way before it is measured, so a client-rendered block is read rendered.
 *   S4 placement  — a slot or residue region the source sets BESIDE the content column (a section
 *                   sidebar: capture's `placement.region` rail-start | rail-end) must sit beside the
 *                   target's content column on the same side at 1440 — not stacked after the content
 *                   above the footer. Declared moves (`placement` in --declared) pass with their why.
 *   S3 attribute  — the band tone behind each slot (`sections[].tone`: dark | tinted | page,
 *                   measured from the painted background). A source dark band whose heading does not
 *                   sit on a dark band in the target fails unless declared; tinted → page is advisory.
 *
 * Usage:
 *   node source-coverage.mjs --model <content-model.json> --target <url|file>
 *       [--declared <coverage.json>]  declared drops: { "version": 1,
 *                                       "residue": [{ "match": "<substring of sel or first line>",
 *                                                     "why": "…" }],
 *                                       "tones": [{ "slot": "s01", "to": "tinted|page", "why": "…" }],
 *                                       "placement": [{ "slot": "s09" | "match": "<sel or first line>",
 *                                                       "to": "rail-start|rail-end|band|main", "why": "…" }],
 *                                       "blocking": true }
 *       [--min-chars 20]              residue regions shorter than this are listed, never gated
 *       [--out <report.json>]
 * The target must be reachable without auth: a protected preview (401 or 403) is out of scope, exit 2.
 *
 * Exit: 0 PASS (or ADVISORY with "blocking": false), 1 FAIL, 2 usage / invalid declared file.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { contentColumn, regionOf } from './placement.mjs';

const USAGE = 'usage: node source-coverage.mjs --model <content-model.json> --target <url|file> [--declared <coverage.json>] [--min-chars 20] [--out <report.json>]';

export function parseArgs(argv) {
  const o = { model: null, target: null, declared: null, minChars: 20, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--target') o.target = argv[++i];
    else if (a === '--declared') o.declared = argv[++i];
    else if (a === '--min-chars') o.minChars = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** Validates a declared-coverage file; returns { declared, problems }. */
export function readDeclared(json) {
  const problems = [];
  const d = json || {};
  const known = ['version', 'residue', 'tones', 'placement', 'blocking'];
  Object.keys(d).forEach((k) => { if (!known.includes(k)) problems.push(`unknown key "${k}"`); });
  if (d.version !== 1) problems.push('version must be 1');
  (d.residue || []).forEach((r, i) => {
    if (!r.match) problems.push(`residue[${i}]: match required`);
    if (!r.why) problems.push(`residue[${i}]: why required`);
  });
  (d.tones || []).forEach((t, i) => {
    if (!/^s\d+$/.test(t.slot || '')) problems.push(`tones[${i}]: slot (sNN) required`);
    if (!['dark', 'tinted', 'page'].includes(t.to)) problems.push(`tones[${i}]: to must be dark | tinted | page`);
    if (!t.why) problems.push(`tones[${i}]: why required`);
  });
  (d.placement || []).forEach((t, i) => {
    if (!t.slot && !t.match) problems.push(`placement[${i}]: slot (sNN) or match required`);
    if (!['rail-start', 'rail-end', 'top', 'band', 'main'].includes(t.to)) problems.push(`placement[${i}]: to must be rail-start | rail-end | top | band | main`);
    if (!t.why) problems.push(`placement[${i}]: why required`);
  });
  return { declared: { residue: d.residue || [], tones: d.tones || [], placement: d.placement || [], blocking: d.blocking !== false }, problems };
}

/**
 * The regions the source sets beside its content column (placement.mjs), each with the text lines the
 * target is searched by: [{ key, slot?, sel?, region, lines }]. Pure; exported for tests.
 */
export function railItems(model) {
  const out = [];
  for (const s of model.sections || []) {
    if (!/^rail-/.test(s.placement?.region || '')) continue;
    const lines = [...(s.headings || []).map((h) => h.text || h), ...(s.ctas || []).map((c) => c.text)].filter((t) => typeof t === 'string' && t.trim().length >= 2);
    out.push({ key: s.slot, slot: s.slot, region: s.placement.region, lines: lines.length ? lines.slice(0, 20) : [(s.visibleText || '').slice(0, 80)] });
  }
  (model.residue || []).filter((r) => r.kind !== 'chrome').forEach((r) => {
    if (/^rail-/.test(r.placement?.region || '')) out.push({ key: `residue:${r.sel}`, sel: r.sel, region: r.placement.region, lines: (r.lines || []).slice(0, 20) });
  });
  return out;
}

// Target placement of one rail item from the measured boxes: target.rails[key] = { rect, items } where items are
// the target's top-level content blocks ({ rect, hasH1, textLen }) without the rail itself. Pure.
export function targetRegion(m) {
  if (!m || !m.rect) return null;
  return regionOf(m.rect, contentColumn(m.items || []));
}

// "top": the rail's box ends above the content's start — the block holding the h1, else the one with the most
// text (a band carried there, never after the content). Pure.
export function isAboveContent(m) {
  if (!m?.rect || !m.items?.length) return false;
  const ref = m.items.find((it) => it.hasH1) || [...m.items].sort((a, b) => (b.textLen || 0) - (a.textLen || 0))[0];
  return m.rect.y + m.rect.h <= ref.rect.y + 2;
}

/**
 * Pure verdict over the measured target. `target.regions` maps residue index → best region recall;
 * `target.slotTones` maps slot → measured target tone of the slot's probe text (or null: not found).
 */
export function judge(model, target, declared, minChars) {
  const rows = [];
  const residue = (model.residue || []).filter((r) => r.kind !== 'chrome');
  residue.forEach((r, i) => {
    const decl = declared.residue.find((d) => r.sel.includes(d.match) || (r.lines[0] || '').includes(d.match));
    const recall = target.regions[i] ?? 0;
    let verdict;
    if (r.textLen < minChars) verdict = 'info';
    else if (recall >= 0.6) verdict = 'carried';
    else if (decl) verdict = 'declared';
    else verdict = 'FAIL';
    rows.push({ check: 'S1', kind: r.kind, sel: r.sel, textLen: r.textLen, recall: +recall.toFixed(2), verdict, ...(decl ? { why: decl.why } : {}), sample: r.lines.slice(0, 4).join(' | ').slice(0, 120) });
  });

  const settle = model._provenance?.settle;
  // A Figma-sourced model is read from the design file, not a live page: there is nothing to settle.
  if (model._provenance?.source?.kind === 'figma') rows.push({ check: 'S2', verdict: 'n/a', detail: 'n/a: Figma-sourced model (read from the design file; no late-rendered content)' });
  else if (!settle) rows.push({ check: 'S2', verdict: 'WARN', detail: 'model has no settle record (captured before stardust 0.40) — late-rendered content may be missing from the reference; re-capture' });
  else if (!settle.stable) rows.push({ check: 'S2', verdict: 'WARN', detail: `source text still growing at the settle cap (${settle.waitedMs}ms) — re-capture with a higher CAPTURE_SETTLE_CAP_MS` });
  else rows.push({ check: 'S2', verdict: 'ok', detail: `settled in ${settle.waitedMs}ms, ${settle.lateChars} late chars captured` });

  (model.sections || []).filter((s) => s.tone && s.tone !== 'page').forEach((s) => {
    const got = target.slotTones[s.slot];
    const decl = declared.tones.find((t) => t.slot === s.slot);
    let verdict;
    if (got === s.tone) verdict = 'carried';
    else if (decl && decl.to === (got ?? decl.to)) verdict = 'declared';
    else if (got === undefined || got === null) verdict = s.tone === 'dark' ? 'FAIL' : 'WARN';
    else if (s.tone === 'dark') verdict = 'FAIL';
    else verdict = 'WARN';
    rows.push({ check: 'S3', slot: s.slot, source: s.tone, target: got ?? 'not found', verdict, ...(decl ? { why: decl.why } : {}), probe: probeOf(s) });
  });

  railItems(model).forEach((it) => {
    const s1 = rows.find((r) => r.check === 'S1' && it.sel && r.sel === it.sel);
    if (s1 && s1.verdict !== 'carried') return; // dropped (S1 FAIL) or declared dropped: S1 owns it, nothing to place
    const decl = (declared.placement || []).find((d) => (d.slot && d.slot === it.slot) || (d.match && ((it.sel || '').includes(d.match) || (it.lines[0] || '').includes(d.match))));
    const m = target.rails?.[it.key];
    // a rail declared "top" is measured as top or not: a band stacked after the content is a FAIL either way
    const got = decl?.to === 'top' && m?.rect ? (isAboveContent(m) ? 'top' : 'below content') : targetRegion(m);
    let verdict;
    if (got === it.region) verdict = 'carried';
    else if (decl && (got === null || decl.to === got)) verdict = 'declared';
    else verdict = 'FAIL';
    rows.push({ check: 'S4', key: it.key, source: it.region, target: got ?? 'not found', verdict, ...(decl ? { why: decl.why } : {}), sample: it.lines.slice(0, 3).join(' | ').slice(0, 100) });
  });

  const fails = rows.filter((r) => r.verdict === 'FAIL').length;
  const gated = rows.filter((r) => ['carried', 'declared', 'FAIL'].includes(r.verdict)).length;
  let verdict = 'PASS';
  if (fails) verdict = declared.blocking ? `FAIL ${fails}/${gated}` : `ADVISORY ${fails}/${gated} (blocking false)`;
  return { verdict, fails, rows };
}

export function probeOf(slot) {
  const h = (slot.headings || [])[0]?.text;
  return (h || slot.visibleText || '').slice(0, 60).trim();
}

async function measureTarget(url, model, minChars) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  if ([401, 403].includes(response?.status())) {
    await browser.close();
    console.error(`[source-coverage] ${url} answered HTTP ${response.status()}: a protected preview is out of scope, make it reachable without auth`);
    process.exit(2);
  }
  const len = () => page.evaluate(() => (document.body.innerText || '').length);
  let last = await len(); let still = 0; const t0 = Date.now();
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); });
  while (Date.now() - t0 < 15000 && still < 3) {
    await page.waitForTimeout(500);
    const now = await len();
    if (now === last) still += 1; else { still = 0; last = now; }
  }
  const residue = (model.residue || []).filter((r) => r.kind !== 'chrome');
  const probes = (model.sections || []).filter((s) => s.tone && s.tone !== 'page').map((s) => ({ slot: s.slot, probe: probeOf(s) }));
  const rails = railItems(model);
  const result = await page.evaluate(({ residue, probes, minChars, rails }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const CHROME = 'header, footer, [role="banner"], [role="contentinfo"]';
    const els = [...document.body.querySelectorAll('*')].filter((e) => !e.closest(CHROME) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(e.tagName));
    const texts = new Map();
    const textOf = (e) => { if (!texts.has(e)) texts.set(e, norm(e.innerText)); return texts.get(e); };
    const regions = residue.map((r) => {
      if (r.textLen < minChars) return 0;
      const lines = r.lines.map(norm).filter((l) => l.length >= 2);
      if (!lines.length) return 0;
      let best = 0;
      els.forEach((e) => {
        const t = textOf(e);
        if (!t || t.length > Math.max(r.textLen * 3, 60)) return;
        const hit = lines.filter((l) => t.includes(l)).length / lines.length;
        if (hit > best) best = hit;
      });
      return best;
    });
    const rgba = (c) => { const m = (c || '').match(/[\d.]+/g); return m ? m.map(Number) : null; };
    const opaque = (el) => { const c = rgba(getComputedStyle(el).backgroundColor); return c && (c[3] === undefined || c[3] > 0.5) ? c : null; };
    const lum = ([r, g, b]) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const pageBg = opaque(document.body) || opaque(document.documentElement) || [255, 255, 255];
    const slotTones = {};
    const seen = new Map();
    probes.forEach(({ slot, probe }) => {
      const p = norm(probe);
      if (!p) { slotTones[slot] = null; return; }
      // Two bands can open with the same text ("Ready to apply?"): inside the slot's own [data-slot] when the
      // target has one, else the k-th innermost match in document order for the k-th slot with that text.
      const k = seen.get(p) || 0;
      seen.set(p, k + 1);
      const own = document.querySelector(`[data-slot="${CSS.escape(slot)}"]`);
      const pool = own ? els.filter((e) => own.contains(e)) : els;
      const inner = pool.filter((e) => textOf(e).includes(p) && ![...e.children].some((c) => textOf(c).includes(p)));
      const host = own ? inner[0] : (inner[k] ?? inner[0]);
      if (!host) { slotTones[slot] = null; return; }
      let c = null;
      for (let e = host; e && e !== document.documentElement; e = e.parentElement) { c = opaque(e); if (c) break; }
      c = c || pageBg;
      const same = c.slice(0, 3).every((v, i) => Math.abs(v - pageBg[i]) < 6);
      slotTones[slot] = lum(c) < 0.2 ? 'dark' : (same ? 'page' : 'tinted');
    });
    // S4: the rail's box and the content it should sit beside. From the rail's host, climb to the branch whose
    // parent holds a sibling with more text than it (the content column: main's other sections on a reskin page
    // or a preview, the content wrapper beside an aside in any layout); those siblings are the content blocks.
    const docRect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const shownBox = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const lenOf = (e) => norm(e.innerText).length;
    const railRects = {};
    rails.forEach((it) => {
      let host = it.slot ? document.querySelector(`[data-slot="${it.slot}"]`) : null;
      if (!host) {
        const lines = it.lines.map(norm).filter((l) => l.length >= 2);
        let best = null; let bestHit = 0;
        els.forEach((e) => {
          const t = textOf(e);
          if (!t) return;
          const hit = lines.filter((l) => t.includes(l)).length / (lines.length || 1);
          if (hit >= 0.6 && (hit > bestHit || (hit === bestHit && t.length < textOf(best).length))) { best = e; bestHit = hit; }
        });
        host = best;
      }
      if (!host) { railRects[it.key] = null; return; }
      let top = host; let sibs = [];
      while (top.parentElement && top.parentElement !== document.documentElement) {
        sibs = [...top.parentElement.children].filter((c) => c !== top && shownBox(c) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(c.tagName) && !c.closest(CHROME));
        if (sibs.some((c) => lenOf(c) > lenOf(top))) break;
        top = top.parentElement; sibs = [];
      }
      railRects[it.key] = {
        rect: docRect(top),
        items: sibs.map((b) => ({ rect: docRect(b), hasH1: !!(b.matches('h1') || b.querySelector('h1')), textLen: lenOf(b) })),
      };
    });
    return { regions, slotTones, rails: railRects };
  }, { residue, probes, minChars, rails });
  await browser.close();
  return { ...result, settledMs: Date.now() - t0 };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  if (o.help) { console.log(USAGE); process.exit(0); }
  if (!o.model || !o.target) { console.error(USAGE); process.exit(2); }
  const model = JSON.parse(readFileSync(o.model, 'utf8'));
  let declared = { residue: [], tones: [], placement: [], blocking: true };
  if (o.declared) {
    if (!existsSync(o.declared)) { console.error(`[source-coverage] declared file not found: ${o.declared}`); process.exit(2); }
    const r = readDeclared(JSON.parse(readFileSync(o.declared, 'utf8')));
    if (r.problems.length) { r.problems.forEach((p) => console.error(`[source-coverage] ${o.declared}: ${p}`)); process.exit(2); }
    ({ declared } = r);
  }
  const url = /^[a-z]+:/i.test(o.target) ? o.target : pathToFileURL(resolve(o.target)).href;
  const target = await measureTarget(url, model, o.minChars);
  const res = judge(model, target, declared, o.minChars);
  res.rows.forEach((r) => {
    if (r.check === 'S1') console.log(`[source-coverage] S1 ${r.verdict.padEnd(8)} ${r.kind} ${r.sel} — ${r.textLen} chars, recall ${r.recall}${r.why ? ` (declared: ${r.why})` : ''} "${r.sample}"`);
    else if (r.check === 'S2') console.log(`[source-coverage] S2 ${r.verdict.padEnd(8)} ${r.detail}`);
    else if (r.check === 'S4') console.log(`[source-coverage] S4 ${r.verdict.padEnd(8)} ${r.key} ${r.source} → ${r.target}${r.why ? ` (declared: ${r.why})` : ''} "${r.sample}"${r.verdict === 'FAIL' ? ' — the source sets it beside the content; render it there (mapping.json "rail")' : ''}`);
    else console.log(`[source-coverage] S3 ${r.verdict.padEnd(8)} ${r.slot} ${r.source} → ${r.target}${r.why ? ` (declared: ${r.why})` : ''} "${r.probe}"`);
  });
  console.log(`[source-coverage] ${res.verdict}`);
  if (res.fails && declared.blocking) console.log('[source-coverage] carry each FAIL to the target (a block, page chrome, a tone variant) or declare it with a why (--declared; gates.md § (a′)).');
  if (o.out) writeFileSync(o.out, JSON.stringify({ model: o.model, target: o.target, ...res }, null, 2));
  process.exit(res.fails && declared.blocking ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
