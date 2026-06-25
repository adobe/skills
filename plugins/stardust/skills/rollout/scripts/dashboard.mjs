#!/usr/bin/env node
/**
 * rollout/dashboard.mjs — self-contained progress dashboard (Phase 4).
 *
 * Rendered in the stardust DESIGN IDENTITY (brand tokens read from the :root block
 * of a migrated page — the canonical token interface, token-contract.md). The
 * centerpiece is a PAGE TREE of every identified page, each node colour-coded by
 * its lifecycle stage:
 *
 *   identified → prototyped → migrated → deployed → optimised
 *
 * spanning stardust/state.json (agnostic stages) + rollout coverage (deployed) +
 * optimize (optimised = verified & no open findings). Template archetypes (the
 * pages that define a template for their siblings) are marked distinctly.
 *
 * Emits dashboard/index.html (self-contained, no external JS) + dashboard/data.json.
 * Usage: node skills/rollout/scripts/dashboard.mjs [--out <rolloutDir>]
 */
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readJSON, writeJSON } from './lib.mjs';

const i = process.argv.indexOf('--out');
const OUT = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'stardust/rollout';

const config = readJSON(join(OUT, 'rollout.json'), {});
const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
if (!pagesDoc) { console.error('rollout dashboard: run inventory.mjs first.'); process.exit(1); }
const covPages = pagesDoc.pages || [];
const templates = (readJSON(join(OUT, 'coverage', 'templates.json'), {}).templates) || [];
const blocks = (readJSON(join(OUT, 'coverage', 'blocks.json'), {}).blocks) || [];
const findingsDoc = readJSON(join(OUT, 'optimize', 'findings.json'), { findings: [], runs: [] });
const scorecard = readJSON(join(OUT, 'optimize', 'scorecard.json'), null);
const state = readJSON(join(OUT, '..', 'state.json'), null); // agnostic lifecycle (optional)
const findings = findingsDoc.findings || [];
const optimizeRan = (findingsDoc.runs || []).length > 0;

// ---- design identity: read brand tokens from a migrated page's :root -----------
function readIdentity() {
  const d = { bg: '#ffffff', fg: '#1a1f26', accent: '#147aff', heading: 'Georgia, serif', body: '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif', radius: '10px', maxw: '1100px' };
  // Scan migrated pages (home first) for one that actually exposes a :root token block.
  const candidates = covPages.filter((p) => p.source && p.source.migratedHtml)
    .sort((a, b) => (a.path === '/' ? -1 : 0) - (b.path === '/' ? -1 : 0));
  for (const c of candidates) {
    let html; try { html = readFileSync(c.source.migratedHtml, 'utf8'); } catch { continue; }
    const root = (html.match(/:root\s*\{([\s\S]*?)\}/) || [])[1];
    if (!root) continue;
    const clean = root.replace(/\/\*[\s\S]*?\*\//g, '');
    const v = (name) => { const m = clean.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'i')); return m ? m[1].trim() : null; };
    return {
      bg: v('color-bg') || d.bg, fg: v('color-fg') || d.fg, accent: v('color-accent') || d.accent,
      heading: v('heading-font-family') || d.heading, body: v('body-font-family') || d.body,
      radius: v('radius') || d.radius, maxw: v('max-width') || d.maxw,
    };
  }
  return d;
}

// ---- merge agnostic state + coverage + optimize into one page model ------------
// Four lifecycle checkpoints. A page's stage is the MOST ADVANCED it has reached
// (drives the node colour). "migrated" folds into prototyped (designed, not yet
// deployed). Legend counts are CUMULATIVE — a page counts toward every stage up
// to and including the one it reached (so identified = all pages).
const STAGES = ['identified', 'prototyped', 'deployed', 'optimised'];
const STAGE_COLOR = { identified: '#9aa3ad', prototyped: '#5b8def', deployed: '#18a0a0', optimised: '#2e9e5b' };
const AG = { rostered: 0, extracted: 0, directed: 0, prototyped: 1, approved: 1, migrated: 1 };
const rankOf = (stage) => STAGES.indexOf(stage);

const openByPage = {};
for (const f of findings) {
  if ((f.status === 'open' || f.status === 'in-progress') && f.scope.level === 'page') {
    for (const id of f.scope.ids) openByPage[id] = (openByPage[id] || 0) + 1;
  }
}

const statePages = new Map();
if (state && Array.isArray(state.pages)) for (const p of state.pages) statePages.set(p.slug, p);
const covBySlug = new Map(covPages.map((p) => [p.slug, p]));

function pathOf(slug, cov, stp) {
  if (cov && cov.path) return cov.path;
  if (stp && stp.url) { try { return new URL(stp.url).pathname.replace(/\/$/, '') || '/'; } catch { /* fall through */ } }
  return slug === 'home' ? '/' : `/${slug}`;
}
function stageOf(p) {
  let r = AG[p.agnosticStatus] ?? 0;
  // Being in the coverage ledger only counts as "prototyped/designed" if the page
  // is actually in the migrated tree. A `content-pending` sibling (archetypes-only
  // mode) sits in coverage but has no designed document yet — it stays "identified".
  const designed = p.inCoverage && !(p.delivery && p.delivery.status === 'content-pending');
  if (designed) r = Math.max(r, 1);
  if (p.delivery && (p.delivery.status === 'deployed' || p.delivery.status === 'verified')) r = Math.max(r, 2);
  if (p.delivery && p.delivery.status === 'verified' && (openByPage[p.slug] || 0) === 0 && optimizeRan) r = 3;
  return STAGES[r];
}

const repSlugs = new Set(templates.map((t) => t.representativeSlug).filter(Boolean));
const allSlugs = new Set([...covBySlug.keys(), ...statePages.keys()]);
const model = [...allSlugs].map((slug) => {
  const cov = covBySlug.get(slug); const stp = statePages.get(slug);
  const p = {
    slug, title: (cov && cov.title) || (stp && (stp.title || stp.slug)) || slug,
    path: pathOf(slug, cov, stp),
    templateId: (cov && cov.templateId) || (stp && stp.type) || null,
    delivery: cov && cov.delivery, inCoverage: !!cov,
    agnosticStatus: (stp && stp.status)
      || (cov && cov.delivery && cov.delivery.status === 'content-pending' ? 'rostered'
        : (cov ? 'migrated' : 'identified')),
    isTemplate: repSlugs.has(slug), openFindings: openByPage[slug] || 0,
  };
  p.stage = stageOf(p);
  return p;
}).sort((a, b) => a.path.localeCompare(b.path));

// ---- page tree by path ----------------------------------------------------------
function buildTree(pages) {
  const root = { seg: '', name: 'Home', children: new Map(), page: null };
  for (const p of pages) {
    const segs = p.path === '/' ? [] : p.path.replace(/^\//, '').split('/');
    let node = root;
    for (const seg of segs) {
      if (!node.children.has(seg)) node.children.set(seg, { seg, name: seg, children: new Map(), page: null });
      node = node.children.get(seg);
    }
    node.page = p;
  }
  return root;
}
const tree = buildTree(model);

// ---- snapshot -------------------------------------------------------------------
// stageCount: CUMULATIVE (reached this stage or beyond). stageExclusive: each page
// in exactly its most-advanced stage (sums to total — used for the stacked bars).
const stageCount = STAGES.reduce((m, s) => { m[s] = model.filter((p) => rankOf(p.stage) >= rankOf(s)).length; return m; }, {});
const stageExclusive = STAGES.reduce((m, s) => { m[s] = model.filter((p) => p.stage === s).length; return m; }, {});
const countBy = (arr, get) => arr.reduce((m, x) => { const k = get(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const open = findings.filter((f) => f.status === 'open' || f.status === 'in-progress');
const snapshot = {
  generatedAt: new Date().toISOString(),
  target: config.target || 'aem-eds',
  site: { sourceUrl: (config.site && config.site.sourceUrl) || null, liveHost: (config.site && config.site.liveHost) || null },
  stageCount, stageExclusive,
  pages: model.map((p) => ({ slug: p.slug, path: p.path, stage: p.stage, templateId: p.templateId, isTemplate: p.isTemplate, openFindings: p.openFindings })),
  templates: templates.map((t) => {
    const members = model.filter((p) => p.templateId === t.id);
    return { id: t.id, archetype: t.representativeSlug, pageCount: members.length, stages: STAGES.reduce((m, s) => { m[s] = members.filter((p) => p.stage === s).length; return m; }, {}) };
  }),
  blocks: { total: blocks.length, converted: blocks.filter((b) => ['converted', 'deployed', 'verified'].includes(b.delivery && b.delivery.status)).length },
  quality: scorecard ? { overall: scorecard.current.overall, dimensions: scorecard.current.dimensions, severity: scorecard.current.severity, history: (scorecard.history || []).map((h) => h.overall) } : null,
  findings: { byFixability: countBy(open, (f) => f.fixability), byAutofix: countBy(open.filter((f) => f.autofix && f.autofix.available), (f) => f.autofix.status) },
};

const dashDir = join(OUT, 'dashboard');
mkdirSync(dashDir, { recursive: true });
writeJSON(join(dashDir, 'data.json'), snapshot);
writeFileSync(join(dashDir, 'index.html'), render(snapshot, tree, readIdentity()));

console.log(`rollout dashboard → ${join(dashDir, 'index.html')}`);
console.log('='.repeat(60));
console.log(`Pages ${model.length} (cumulative): ${STAGES.map((s) => `${s} ${stageCount[s]}`).join(' · ')}`);

// ================================================================ rendering
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function dot(stage) { return `<i class="dot" style="background:${STAGE_COLOR[stage]}" title="${stage}"></i>`; }

function renderNode(node, isRoot = false) {
  const kids = [...node.children.values()].sort((a, b) => a.seg.localeCompare(b.seg));
  const p = node.page;
  let label;
  if (p) {
    const badge = p.isTemplate ? `<span class="tmpl-badge" title="template archetype for ${esc(p.templateId || '')}">T</span>` : '';
    const tref = p.templateId ? `<span class="tref">${esc(p.templateId)}</span>` : '';
    const fnd = p.openFindings ? `<span class="fnd" title="${p.openFindings} open findings">●${p.openFindings}</span>` : '';
    label = `${dot(p.stage)}<span class="nm${p.isTemplate ? ' is-t' : ''}">${esc(p.title || node.seg || 'Home')}</span>${badge}${tref}<span class="pth">${esc(p.path)}</span>${fnd}`;
  } else {
    label = `<i class="dot folder"></i><span class="nm dir">${esc(node.seg || 'Home')}/</span>`;
  }
  const childHtml = kids.length ? `<ul>${kids.map((k) => renderNode(k)).join('')}</ul>` : '';
  return `<li${isRoot ? ' class="root"' : ''}>${label}${childHtml}</li>`;
}

function stageStack(stages, total) {
  return STAGES.filter((s) => stages[s]).map((s) => `<span style="width:${pct(stages[s], total)}%;background:${STAGE_COLOR[s]}" title="${s}: ${stages[s]}"></span>`).join('');
}

function dimBars(dims) {
  const labels = { 'brand-tensions': 'Brand', 'design-ux': 'Design/UX', accessibility: 'A11y', seo: 'SEO', 'content-conversion': 'Content', 'ai-search': 'AI-search', 'cross-page': 'Cross-page' };
  return Object.entries(labels).map(([k, label]) => {
    const v = dims[k];
    if (v === null || v === undefined) return `<div class="dim"><span class="dl">${label}</span><span class="dn na">—</span></div>`;
    const c = v >= 80 ? '#2e9e5b' : v >= 50 ? '#e0a72e' : '#d6473b';
    return `<div class="dim"><span class="dl">${label}</span><span class="dbar"><i style="width:${v}%;background:${c}"></i></span><span class="dn">${v}</span></div>`;
  }).join('');
}
function sparkline(hist, ac) {
  if (!hist || hist.length < 2) return '';
  const w = 200; const h = 36;
  const pts = hist.map((v, idx) => `${(idx / (hist.length - 1)) * w},${h - (v / 100) * h}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${ac}" stroke-width="2" points="${pts}"/></svg>`;
}

function render(s, treeRoot, id) {
  const legend = STAGES.map((st) => `<span class="lg">${dot(st)}${st} <b>${s.stageCount[st]}</b></span>`).join('');
  const q = s.quality;
  const tmplRows = s.templates.map((t) => `<tr><td>${esc(t.id)}</td><td class="mono">${esc(t.archetype || '—')}</td><td>${t.pageCount}</td><td><span class="stack">${stageStack(t.stages, t.pageCount)}</span></td></tr>`).join('');
  const total = s.pages.length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>rollout — ${esc(s.site.sourceUrl || s.target)}</title>
<style>
:root{--bg:${id.bg};--fg:${id.fg};--accent:${id.accent};--heading:${id.heading};--body:${id.body};--radius:${id.radius};--maxw:${id.maxw};
--muted:color-mix(in srgb,var(--fg) 55%,transparent);--line:color-mix(in srgb,var(--fg) 12%,transparent);--card:color-mix(in srgb,var(--fg) 3%,var(--bg))}
*{box-sizing:border-box}body{margin:0;font-family:var(--body);color:var(--fg);background:var(--bg);line-height:1.5}
.wrap{max-width:var(--maxw);margin:0 auto;padding:30px 22px 70px}
header{border-bottom:3px solid var(--accent);padding-bottom:14px;margin-bottom:22px}
h1{font-family:var(--heading);font-size:26px;margin:0}h1 b{color:var(--accent)}
h2{font-family:var(--heading);font-size:15px;letter-spacing:.02em;margin:30px 0 12px}
.sub{color:var(--muted);font-size:12px;margin-top:4px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:15px}
.card .n{font-family:var(--heading);font-size:28px;line-height:1}.card .l{font-size:12px;color:var(--muted);margin-top:6px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:14px}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin:2px 0 14px;align-items:center}
.lg{font-size:12px;color:var(--muted)}.lg b{color:var(--fg)}.muted-note{font-style:italic;margin-left:auto}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:7px;vertical-align:-1px}
.dot.folder{background:transparent;border:1.5px solid var(--line)}
.tree{font-size:14px}.tree ul{list-style:none;margin:0;padding-left:20px;border-left:1px dotted var(--line)}
.tree>ul{padding-left:4px;border-left:none}.tree li{margin:3px 0}
.nm{font-weight:600}.nm.is-t{color:var(--accent)}.nm.dir{color:var(--muted);font-weight:600}
.tmpl-badge{display:inline-block;background:var(--accent);color:var(--bg);font-size:10px;font-weight:700;border-radius:4px;padding:0 5px;margin-left:6px;vertical-align:1px}
.tref{font-size:11px;color:var(--muted);margin-left:7px}
.pth{font-size:11px;color:var(--muted);margin-left:8px;font-family:ui-monospace,Menlo,Consolas,monospace}
.fnd{font-size:11px;color:#d6473b;margin-left:8px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.stack{display:flex;height:12px;width:160px;border-radius:6px;overflow:hidden;background:color-mix(in srgb,var(--fg) 8%,transparent)}.stack span{display:block}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.gauge{display:flex;align-items:center;gap:16px}.gauge .big{font-family:var(--heading);font-size:42px}
.sev{display:flex;gap:8px;margin-top:6px}.pill{border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600;color:#fff}
.dim{display:flex;align-items:center;gap:10px;margin:6px 0}.dl{width:88px;font-size:12px;color:var(--muted)}.dbar{flex:1;height:9px;background:color-mix(in srgb,var(--fg) 8%,transparent);border-radius:5px;overflow:hidden}.dbar i{display:block;height:100%}.dn{width:30px;text-align:right;font-variant-numeric:tabular-nums}.dn.na{color:var(--muted)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:20px;padding:2px 10px;margin:3px 4px 0 0;font-size:12px}.chip b{color:var(--accent)}
footer{margin-top:26px;color:var(--muted);font-size:11px;border-top:1px solid var(--line);padding-top:12px}
@media(max-width:720px){.cards{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<header><h1>rollout <b>→ ${esc(s.target)}</b></h1><div class="sub">${esc(s.site.sourceUrl || '')}${s.site.liveHost ? ` · ${esc(s.site.liveHost)}` : ''} · ${esc(s.generatedAt.slice(0, 16).replace('T', ' '))} · rendered in the project's design identity</div></header>

<div class="cards">
  <div class="card"><div class="n">${total}</div><div class="l">pages identified</div></div>
  <div class="card"><div class="n">${s.stageCount.deployed}<span style="font-size:15px;color:var(--muted)">/${total}</span></div><div class="l">deployed or beyond</div></div>
  <div class="card"><div class="n">${s.stageCount.optimised}<span style="font-size:15px;color:var(--muted)">/${total}</span></div><div class="l">optimised</div></div>
  <div class="card"><div class="n">${q ? q.overall : '—'}</div><div class="l">quality health</div></div>
</div>

<h2>Page tree</h2>
<div class="legend">${legend}<span class="lg"><span class="tmpl-badge">T</span> template archetype</span><span class="lg muted-note">counts are cumulative — pages reached this stage or beyond</span></div>
<div class="panel tree"><ul>${renderNode(treeRoot, true)}</ul></div>

<h2>Templates</h2>
<div class="panel"><table><thead><tr><th>template</th><th>archetype</th><th>pages</th><th>lifecycle</th></tr></thead><tbody>${tmplRows || '<tr><td colspan="4" class="dn na">no templates</td></tr>'}</tbody></table></div>

<h2>Quality</h2>
${q ? `<div class="grid2">
  <div class="panel"><div class="gauge"><div class="big" style="color:${q.overall >= 80 ? '#2e9e5b' : q.overall >= 50 ? '#e0a72e' : '#d6473b'}">${q.overall}</div><div><div class="sub">overall health</div><div class="sev"><span class="pill" style="background:#d6473b">P1 ${q.severity.P1}</span><span class="pill" style="background:#e0a72e">P2 ${q.severity.P2}</span><span class="pill" style="background:#9aa3ad">P3 ${q.severity.P3}</span></div></div></div><div style="margin-top:12px">${sparkline(q.history, id.accent)}</div></div>
  <div class="panel">${dimBars(q.dimensions)}</div>
</div>
<div class="panel">fixability: ${Object.entries(s.findings.byFixability).map(([k, n]) => `<span class="chip">${esc(k)} <b>${n}</b></span>`).join('') || '<span class="sub">none open</span>'} &nbsp; autofix: ${Object.entries(s.findings.byAutofix).map(([k, n]) => `<span class="chip">${esc(k)} <b>${n}</b></span>`).join('') || '<span class="sub">none</span>'}</div>` : '<div class="panel sub">optimize has not been run yet.</div>'}

<footer>stardust:rollout/dashboard · brand tokens from the migrated :root · status spans state.json + coverage + optimize · self-contained, no external JS · data.json holds this snapshot.</footer>
</div></body></html>`;
}
