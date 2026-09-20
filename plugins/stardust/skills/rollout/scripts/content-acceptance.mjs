#!/usr/bin/env node
/**
 * rollout/content-acceptance.mjs — the offline source-vs-imported ROLE INVENTORY gate
 * (content-count acceptance, migrate/reference/fidelity-tiers.md § Content-count acceptance).
 *
 * The cheapest gate in the flow: static counts, no browser, zero source hits. Source =
 * the rendered DOM sidecar `stardust/current/pages/<slug>.html` (resolved from the capture
 * JSON's `renderedHtml`), scoped to `main | [role=main]` (else --source-main + --source-exclude,
 * recorded); target = the migrated HTML file (`main`, minus `.metadata` / `.section-metadata`)
 * or --target-url (ONE hit on the delivery origin, none on the source).
 *
 * Counts by class (keys via the same normalisation content-inventory.mjs uses — case, quotes,
 * dashes, arrows, trailing punctuation): headings h1–h6 (per level + text), links (text +
 * normalised path), images (count — the pipeline renames src to /media_<hash>), list items, table rows, words.
 *
 * Verdict (the 0.18.2 rule, unchanged by default):
 *   🔴 any count DROP in headings / links / images / list items / table rows not covered by a
 *      `_meta.json#contentDeviations[]` entry (`{kind, source, target, reason}`: a `source`
 *      text / href / src matching the dropped item downgrades it to `covered`), or words
 *      ratio < 0.9 (dropped body copy)                                      → exit 2
 *   🟡 words ratio > 1.1 (clones / duplicated blocks) — advisory            → exit 0
 *   tolerances are EXPLICIT flags only — `--tolerance links=0.1,images=0.1,words=0.1` — echoed
 *   in the record and the summary; there is no silent default relaxation.
 * On exit 2 migrate keeps the page out of `migrated` (`lastRun.failures[]`); rollout Phase C
 * treats it as P1 → no PUT. PASS appends `"content-count"` to `_meta.json#gatesPassed[]` and
 * writes `stardust/migrated/_acceptance/<slug>.json`; `--report-only` writes records, exit 0,
 * never writes `gatesPassed` (bulk triage). A structured-source compile may write the same
 * record with `skipped[]`; the script then fails on any skipped class not in --skipped-allow.
 * `unmeasured` (source sidecar missing, target missing, --target-url not 200) → exit 1, the
 * record says so — never a pass, never a FAIL.
 *
 * Usage:
 *   node skills/rollout/scripts/content-acceptance.mjs --slug <s> | --all [--state stardust/state.json]
 *        [--source <html>] [--target <html> | --target-url <plain.html>] [--meta <_meta.json>]
 *        [--source-main <sel>] [--source-exclude <sel,…>] [--tolerance k=v,…] [--report-only]
 *        [--skipped-allow <class,…>] [--trace <text>] [--out stardust/migrated/_acceptance] [--json]
 * Exit: 0 pass (or --report-only) · 1 usage / unmeasured (a side missing) · 2 🔴 dropped content
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- text + key normalisation (the content-inventory.mjs norm() rule — kept identical) ----
const ARROWS = /[→➔➜›⇒➤>]+/g;
export const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function normKey(s) {
  return clean(s).replace(ARROWS, ' ')
    .replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/…/g, '...').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/[.,;:!?·•]+$/g, '').trim();
}
export const pathKey = (href) => { const h = String(href || '').trim(); if (!h || /^(javascript:|mailto:|tel:|#)/i.test(h)) return null; try { const u = new URL(h, 'https://x.example'); return `${u.pathname.replace(/\/+$/, '').replace(/\.(html?|jsp|aspx?|php)$/i, '').toLowerCase() || '/'}`; } catch { return h.toLowerCase(); } };
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

// ---- a tiny tolerant HTML tokenizer (no deps, like delivery-lint / qa lib) ----
export function tokenize(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<\/?([a-zA-Z][\w:-]*)([^>]*)>|[^<]+/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--') || /^<(script|style)/i.test(m[0])) continue;
    if (m[1]) {
      const closing = m[0].startsWith('</');
      const attrs = {};
      for (const a of m[2].matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? '';
      out.push({ type: closing ? 'close' : 'open', tag: m[1].toLowerCase(), attrs, selfClosing: /\/\s*>$/.test(m[0]) || /^(img|br|hr|input|meta|link|source|track|wbr)$/i.test(m[1]) });
    } else out.push({ type: 'text', text: decode(m[0]) });
  }
  return out;
}
const matchSel = (tok, sel) => {
  // supports: tag, .class, #id, [attr], [attr=value], tag.class, and comma lists (each part matched independently)
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((one) => {
    const tag = (one.match(/^[a-z][\w-]*/i) || [null])[0];
    if (tag && tok.tag !== tag.toLowerCase()) return false;
    for (const c of one.matchAll(/\.([\w-]+)/g)) if (!(tok.attrs.class || '').split(/\s+/).includes(c[1])) return false;
    for (const i of one.matchAll(/#([\w-]+)/g)) if (tok.attrs.id !== i[1]) return false;
    for (const a of one.matchAll(/\[([\w:-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) { if (!(a[1] in tok.attrs)) return false; if (a[2] !== undefined && tok.attrs[a[1]] !== a[2]) return false; }
    return true;
  });
};

/**
 * Static inventory of the region matched by `mainSel` (first match; whole document when
 * none matches and `fallbackWhole`), skipping subtrees matched by `exclude` selectors.
 */
export function inventory(html, { mainSel = 'main,[role=main]', exclude = [], fallbackWhole = true } = {}) {
  const toks = tokenize(html);
  const inv = { headings: {}, links: {}, images: {}, listItems: 0, tableRows: 0, words: 0, headingLevels: {}, scoped: false, excluded: 0 };
  const stack = []; // open tags inside the region
  let inMain = false; let mainDepth = 0; let skipDepth = 0; let headingLevel = null; let headingText = ''; let linkHref = null; let linkText = '';
  let sawMain = toks.some((t) => t.type === 'open' && matchSel(t, mainSel));
  if (!sawMain && !fallbackWhole) return inv;
  if (!sawMain) inMain = true; else inv.scoped = true;
  const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'track', 'wbr']);
  for (const t of toks) {
    if (t.type === 'open') {
      if (!inMain && sawMain && matchSel(t, mainSel)) { inMain = true; mainDepth = stack.length; }
      if (inMain && skipDepth === 0 && exclude.some((e) => matchSel(t, e))) { skipDepth = stack.length + 1; inv.excluded += 1; }
      if (!VOID.has(t.tag) && !t.selfClosing) stack.push(t.tag);
      if (!inMain || skipDepth) continue;
      if (/^h[1-6]$/.test(t.tag)) { headingLevel = t.tag; headingText = ''; }
      if (t.tag === 'a' && t.attrs.href !== undefined) { linkHref = t.attrs.href; linkText = ''; }
      if (t.tag === 'img') { const src = t.attrs.src || t.attrs['data-src'] || ''; if (src && !/^data:/.test(src)) { const k = basename(String(src).split(/[?#]/)[0]).toLowerCase() || src; inv.images[k] = (inv.images[k] || 0) + 1; } }
      if (t.tag === 'li') inv.listItems += 1;
      if (t.tag === 'tr') inv.tableRows += 1;
    } else if (t.type === 'close') {
      const i = stack.lastIndexOf(t.tag); if (i !== -1) stack.length = i;
      if (skipDepth && stack.length < skipDepth) skipDepth = 0;
      if (inMain && sawMain && stack.length <= mainDepth) inMain = false; // the region's own close tag popped it
      if (!inMain || skipDepth) continue;
      if (headingLevel && t.tag === headingLevel) { const k = `${headingLevel}:${normKey(headingText)}`; inv.headings[k] = (inv.headings[k] || 0) + 1; inv.headingLevels[headingLevel] = (inv.headingLevels[headingLevel] || 0) + 1; headingLevel = null; }
      if (linkHref !== null && t.tag === 'a') { const pk = pathKey(linkHref); if (pk) { const k = `${normKey(linkText)}|${pk}`; inv.links[k] = (inv.links[k] || 0) + 1; } linkHref = null; }
    } else if (inMain && !skipDepth) {
      const txt = t.text;
      if (headingLevel) headingText += txt;
      if (linkHref !== null) linkText += txt;
      inv.words += clean(txt).split(' ').filter(Boolean).length;
    }
  }
  return inv;
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
/** Compare two inventories → per-class {source, emitted, dropped[], extra[]} + words. */
export function compare(src, tgt) {
  const cls = (a, b) => { const dropped = []; const extra = []; for (const [k, n] of Object.entries(a)) { const m = b[k] || 0; if (m < n) dropped.push({ key: k, source: n, emitted: m }); } for (const [k, n] of Object.entries(b)) { if (!(k in a)) extra.push({ key: k, emitted: n }); } return { source: sum(a), emitted: sum(b), dropped, extra }; };
  return {
    headings: cls(src.headings, tgt.headings),
    links: cls(src.links, tgt.links),
    // images compare by COUNT: the delivery pipeline renames every src to /media_<hash> (source-fidelity-gate.md
    // § The published-origin gate), so a basename key is unstable; the source basenames absent on the target
    // are listed as `missing[]` for triage and deviation matching only.
    images: { source: sum(src.images), emitted: sum(tgt.images), dropped: sum(tgt.images) < sum(src.images) ? [{ key: 'img', source: sum(src.images), emitted: sum(tgt.images), missing: Object.keys(src.images).filter((k) => !(k in tgt.images)) }] : [], extra: [] },
    listItems: { source: src.listItems, emitted: tgt.listItems, dropped: tgt.listItems < src.listItems ? [{ key: 'li', source: src.listItems, emitted: tgt.listItems }] : [], extra: [] },
    tableRows: { source: src.tableRows, emitted: tgt.tableRows, dropped: tgt.tableRows < src.tableRows ? [{ key: 'tr', source: src.tableRows, emitted: tgt.tableRows }] : [], extra: [] },
    words: { source: src.words, emitted: tgt.words, ratio: src.words ? Math.round((tgt.words / src.words) * 1000) / 1000 : (tgt.words ? null : 1) },
  };
}
/** Apply deviations (covered) + tolerances → verdict { red[], yellow[], covered[] }. */
export function judge(cmp, { deviations = [], tolerance = {}, skipped = [], skippedAllow = [] } = {}) {
  const red = []; const yellow = []; const covered = [];
  const devKeys = deviations.map((d) => normKey(d.source || '')).filter(Boolean);
  const coveredBy = (item) => { const k = normKey(item.key.split('|')[0].replace(/^h[1-6]:/, '')); const p = item.key.split('|')[1]; const hit = deviations.find((d) => { const ds = normKey(d.source || ''); return ds && (ds === k || (p && normKey(pathKey(d.source) || '') === normKey(p)) || item.key.toLowerCase().includes(ds) || (item.missing || []).some((m) => normKey(m) === ds || normKey(basename(String(d.source || '').split(/[?#]/)[0])) === normKey(m))); }); return hit || null; };
  for (const c of ['headings', 'links', 'images', 'listItems', 'tableRows']) {
    const tol = Number(tolerance[c] || 0);
    const allowedDrop = Math.floor(cmp[c].source * tol);
    let uncovered = 0;
    for (const d of cmp[c].dropped) { const dev = coveredBy(d); if (dev) covered.push({ class: c, ...d, deviation: dev.kind || 'deviation', reason: dev.reason || null }); else uncovered += d.source - d.emitted; }
    if (uncovered > allowedDrop) red.push({ class: c, kind: 'dropped', source: cmp[c].source, emitted: cmp[c].emitted, dropped: uncovered, allowed: allowedDrop, msg: `${c}: ${cmp[c].source} → ${cmp[c].emitted} (${uncovered} dropped${allowedDrop ? `, ${allowedDrop} tolerated` : ''}${devKeys.length ? `, ${covered.filter((x) => x.class === c).length} covered by contentDeviations[]` : ''})` });
  }
  const wTol = Number(tolerance.words || 0);
  const r = cmp.words.ratio;
  if (r !== null && r < 0.9 - wTol) red.push({ class: 'words', kind: 'dropped', source: cmp.words.source, emitted: cmp.words.emitted, ratio: r, msg: `words: ratio ${r} < ${(0.9 - wTol).toFixed(2)} (${cmp.words.source} → ${cmp.words.emitted})` });
  else if (r !== null && r > 1.1 + wTol) yellow.push({ class: 'words', kind: 'duplicated', source: cmp.words.source, emitted: cmp.words.emitted, ratio: r, msg: `words: ratio ${r} > ${(1.1 + wTol).toFixed(2)} — clones / duplicated blocks? (${cmp.words.source} → ${cmp.words.emitted})` });
  for (const sk of skipped) if (!skippedAllow.includes(sk)) red.push({ class: sk, kind: 'skipped', msg: `${sk}: skipped by the compiler and not in --skipped-allow` });
  return { red, yellow, covered, verdict: red.length ? 'fail' : 'pass' };
}

// ---- CLI ----
function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); if (i === -1) return fallback; const v = process.argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`content-acceptance: --${name} needs a value`); process.exit(1); } return v; }
const has = (f) => process.argv.includes(`--${f}`);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

async function acceptPage({ slug, sourcePath, targetPath, targetUrl, metaPath, outDir, mainSel, exclude, tolerance, reportOnly, skippedAllow, trace, jsonOut }) {
  const rec = { slug, at: new Date().toISOString(), source: sourcePath, target: targetUrl || targetPath, meta: metaPath || null, scope: { main: mainSel, exclude }, tolerances: tolerance, reportOnly, verdict: null };
  // unmeasured = a side is missing: the record still lands (never a pass, never a FAIL — the page stays ungated)
  const unmeasured = (reason) => { rec.verdict = 'unmeasured'; rec.reason = reason; mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, `${slug}.json`), `${JSON.stringify(rec, null, 2)}\n`); return rec; };
  if (!sourcePath || !existsSync(sourcePath)) return unmeasured(`source sidecar missing (${sourcePath || 'no renderedHtml / --source'}) — zero source hits: re-run extract for this page`);
  let targetHtml;
  if (targetUrl) { try { const res = await fetch(targetUrl); if (!res.ok) return unmeasured(`--target-url HTTP ${res.status}`); targetHtml = await res.text(); } catch (e) { return unmeasured(`--target-url fetch error: ${e.message}`); } } else { if (!targetPath || !existsSync(targetPath)) return unmeasured(`target missing (${targetPath || '--target'})`); targetHtml = readFileSync(targetPath, 'utf8'); }
  const src = inventory(readFileSync(sourcePath, 'utf8'), { mainSel, exclude });
  const tgt = inventory(targetHtml, { mainSel: 'main,[role=main]', exclude: ['.metadata', '.section-metadata', ...(targetUrl ? [] : [])] });
  const meta = metaPath ? readJson(metaPath) : null;
  const existing = readJson(join(outDir, `${slug}.json`));
  const skipped = (existing && Array.isArray(existing.skipped)) ? existing.skipped : [];
  const cmp = compare(src, tgt);
  const j = judge(cmp, { deviations: (meta && meta.contentDeviations) || [], tolerance, skipped, skippedAllow });
  Object.assign(rec, { class: { headings: cmp.headings, links: cmp.links, images: cmp.images, listItems: cmp.listItems, tableRows: cmp.tableRows }, words: cmp.words, sourceScoped: src.scoped, sourceExcludedSubtrees: src.excluded, red: j.red, yellow: j.yellow, covered: j.covered, skipped, verdict: j.verdict });
  if (trace) { const k = normKey(trace); rec.trace = { text: trace, inSource: Object.keys({ ...src.headings, ...src.links }).some((x) => x.includes(k)) || readFileSync(sourcePath, 'utf8').toLowerCase().includes(k), inTarget: targetHtml.toLowerCase().includes(k) }; }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${slug}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  if (j.verdict === 'pass' && !reportOnly && meta && metaPath) { meta.gatesPassed = Array.isArray(meta.gatesPassed) ? meta.gatesPassed : []; if (!meta.gatesPassed.includes('content-count')) meta.gatesPassed.push('content-count'); writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`); rec.gatesPassedWritten = true; }
  return rec;
}
function summaryMd(records, outDir) {
  const byClass = {};
  for (const r of records) for (const f of r.red || []) { byClass[f.class] ??= { pages: 0, items: [] }; byClass[f.class].pages += 1; byClass[f.class].items.push(`${r.slug}: ${f.msg}`); }
  const md = ['# content-count acceptance — summary', '', `Generated ${new Date().toISOString()}. Rule: any count drop not covered by contentDeviations[] is 🔴; words ratio < 0.9 🔴, > 1.1 🟡; tolerances only as explicit flags (echoed per record).`, '', `**content-count: ${records.filter((r) => r.verdict === 'pass').length} passed · ${records.filter((r) => (r.covered || []).length && r.verdict === 'pass').length} covered · ${records.filter((r) => r.verdict === 'fail').length} failed · ${records.filter((r) => r.verdict === 'unmeasured').length} unmeasured**`, '', '| class | pages affected | example |', '|---|---|---|'];
  for (const [c, v] of Object.entries(byClass).sort((a, b) => b[1].pages - a[1].pages)) md.push(`| ${c} | ${v.pages} | ${v.items[0]} |`);
  if (!Object.keys(byClass).length) md.push('| — | 0 | no dropped class |');
  md.push('', '## Per-page records', '', ...records.map((r) => `- ${r.slug}: ${r.verdict}${r.reason ? ` — ${r.reason}` : ''}${(r.red || []).length ? ` — ${r.red.map((f) => f.msg).join('; ')}` : ''}${(r.yellow || []).length ? ` — 🟡 ${r.yellow.map((f) => f.msg).join('; ')}` : ''} (${join(outDir, `${r.slug}.json`)})`), '');
  return md.join('\n');
}
async function main() {
  const USAGE = 'usage: content-acceptance.mjs --slug <s> | --all [--state <state.json>] [--source <html>] [--target <html> | --target-url <plain.html>] [--meta <_meta.json>] [--source-main <sel>] [--source-exclude <sel,…>] [--tolerance k=v,…] [--report-only] [--skipped-allow <class,…>] [--trace <text>] [--out <dir>] [--json]\n  exit 0 pass (or --report-only) · 1 usage / unmeasured (a side missing) · 2 🔴 dropped content';
  if (has('help') || has('h')) { console.log(USAGE); process.exit(0); }
  const statePath = arg('state', 'stardust/state.json');
  const state = readJson(statePath) || { pages: [], migrate: {} };
  const outDir = arg('out', 'stardust/migrated/_acceptance');
  const mainSel = arg('source-main', 'main,[role=main]');
  const exclude = (arg('source-exclude', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const tolerance = Object.fromEntries((arg('tolerance', '') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k.trim(), Number(v)]; }));
  for (const [k, v] of Object.entries(tolerance)) if (!['headings', 'links', 'images', 'listItems', 'tableRows', 'words'].includes(k) || !Number.isFinite(v) || v < 0 || v > 1) { console.error(`content-acceptance: --tolerance ${k}=${v} — classes headings|links|images|listItems|tableRows|words, value 0–1`); process.exit(1); }
  const skippedAllow = (arg('skipped-allow', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const reportOnly = has('report-only');
  const slugArg = arg('slug', null);
  if (!slugArg && !has('all')) { console.error(USAGE); process.exit(1); }
  const pages = has('all') ? (state.pages || []) : [(state.pages || []).find((p) => p.slug === slugArg) || { slug: slugArg }];
  const migratedDir = (state.migrate && state.migrate.outputDir) || 'stardust/migrated/';
  const pageMap = (state.migrate && state.migrate.pageMap) || [];
  const records = [];
  for (const p of pages) {
    const sp = p.currentStatePath || `stardust/current/pages/${p.slug}.json`;
    const cap = readJson(sp);
    const sourcePath = arg('source', null) && !has('all') ? arg('source', null) : (cap && cap.renderedHtml ? join(dirname(sp), cap.renderedHtml.replace(/^pages\//, '')) : join(dirname(sp), `${p.slug}.html`));
    const pm = pageMap.find((m) => m.slug === p.slug);
    const targetPath = arg('target', null) && !has('all') ? arg('target', null) : (pm ? join(migratedDir, pm.outputPath) : null);
    const metaPath = arg('meta', null) && !has('all') ? arg('meta', null) : (targetPath ? join(dirname(targetPath), '_meta.json') : null);
    const rec = await acceptPage({ slug: p.slug, sourcePath, targetPath, targetUrl: has('all') ? null : arg('target-url', null), metaPath: metaPath && existsSync(metaPath) ? metaPath : null, outDir, mainSel, exclude, tolerance, reportOnly, skippedAllow, trace: arg('trace', null), jsonOut: has('json') });
    records.push(rec);
    if (!has('json')) {
      const line = rec.verdict === 'unmeasured' ? `? ${rec.slug}: unmeasured — ${rec.reason}` : `${rec.verdict === 'pass' ? '✓' : '🔴'} ${rec.slug}: ${rec.verdict}${rec.red.length ? ` — ${rec.red.map((f) => f.msg).join('; ')}` : ''}${rec.yellow.length ? ` — 🟡 ${rec.yellow.map((f) => f.msg).join('; ')}` : ''}${rec.covered.length ? ` — covered: ${rec.covered.length} item(s) by contentDeviations[]` : ''}${Object.keys(tolerance).length ? ` — tolerances ${Object.entries(tolerance).map(([k, v]) => `${k}=${v}`).join(',')}` : ''}${rec.gatesPassedWritten ? ' — gatesPassed += content-count' : reportOnly && rec.verdict === 'pass' ? ' — report-only (gatesPassed not written)' : ''}`;
      console.log(line);
      if (rec.trace) console.log(`  trace "${rec.trace.text}": in source ${rec.trace.inSource ? 'yes' : 'no'} · in target ${rec.trace.inTarget ? 'yes' : 'no'}`);
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'summary.md'), summaryMd(records, outDir));
  const failed = records.filter((r) => r.verdict === 'fail').length; const unmeasured = records.filter((r) => r.verdict === 'unmeasured').length; const passed = records.filter((r) => r.verdict === 'pass').length;
  if (has('json')) console.log(JSON.stringify({ passed, failed, unmeasured, covered: records.reduce((n, r) => n + (r.covered || []).length, 0), records }, null, 2));
  else console.log(`content-count: ${passed} passed · ${records.filter((r) => (r.covered || []).length && r.verdict === 'pass').length} covered · ${failed} failed · ${unmeasured} unmeasured — ${join(outDir, 'summary.md')}`);
  process.exit(failed && !reportOnly ? 2 : unmeasured && !failed ? 1 : 0);
}
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
