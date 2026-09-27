#!/usr/bin/env node
// evals/jev-batteries/harvest.mjs — build the labelled decision set for the decision layer (#126)
// from recorded stardust runs. Reads project folders (each with a `stardust/` dir), turns recorded
// decisions into replayable items {battery, ref, state, expected} and writes JSONL. The output names
// real sites, so it lives under data/ (gitignored) and is never committed.
//
//   node harvest.mjs --projects <dir with one project per subfolder> [--out data/items.jsonl]
//                    [--batteries page-type,dynamics-triage,section-alignment] [--per-project 40]
//                    [--seed 1]
//   node harvest.mjs --help
//
// Harvested batteries and their labels:
//   page-type          state.json pages[].type (label) + current/pages/<slug>.json (state); stratified
//                      per type, at most --per-project pages per project; `types` = the project's set, each
//                      with the paths + lead heading of up to three other pages of that type as examples.
//   dynamics-triage    dynamic-features.md feature table: class, disposition, reproducibility (labels),
//                      the feature description, reach and evidence columns (state).
//   section-alignment  eds-schema/*.json: pairs of block sections (≥ 3 items, not named like a prose
//                      wrapper); same section name across two pages → expected level 2 (same block),
//                      different names → 0. Level 1 (variant) is not
//                      derivable from the schemas and is reported as disagreement by replay.
//   flag-justify       replica/gates/<slug>-<w>/: content-diff and visual-diff flag lines present at
//                      iter1 AND still present at final → the run justified them (defect=false, expected
//                      artefact-or-intended); present at iter1 and gone at final → fixed (defect=true).
//                      progress.json `justified[]` entries add positives; their `why` is withheld.
//   residual-causes    progress.json `residuals[]`: multi-label from the recorded `cause` text by keyword
//                      (font, live variation, sticky widget, capture, chrome, pipeline, offset); the cause
//                      text is withheld, the band/pct/region and the final pixel band table are the state.
// Exit codes: 0 ok · 2 usage.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const HERE = dirname(fileURLToPath(import.meta.url));
const opt = { projects: null, out: join(HERE, 'data', 'items.jsonl'), batteries: ['page-type', 'dynamics-triage', 'section-alignment', 'flag-justify', 'residual-causes'], perProject: 40, seed: 1 };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]; const v = () => { const x = argv[++i]; if (x === undefined || x.startsWith('--')) { console.error(`${a} needs a value`); process.exit(2); } return x; };
  if (a === '--projects') opt.projects = resolve(v());
  else if (a === '--out') opt.out = resolve(v());
  else if (a === '--batteries') opt.batteries = v().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--per-project') opt.perProject = Number(v());
  else if (a === '--seed') opt.seed = Number(v());
  else { console.error(`unknown flag ${a}`); process.exit(2); }
}
if (!opt.projects || !existsSync(opt.projects)) { console.error('--projects <dir> is required and must exist'); process.exit(2); }

let seed = opt.seed || 1;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const clip = (s, n) => { if (typeof s !== 'string') return s; const cp = Array.from(s); return cp.length > n ? `${cp.slice(0, n).join('')}…` : s; }; // code points: never split an emoji

// Find every project: a dir that has stardust/state.json, up to two levels down.
const projects = [];
(function walk(d, depth) {
  if (depth > 2) return;
  for (const n of readdirSync(d)) {
    if (n.startsWith('.') || n === 'node_modules') continue;
    const p = join(d, n); if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, 'stardust', 'state.json'))) projects.push(p); else walk(p, depth + 1);
  }
})(opt.projects, 0);

const items = [];
const counts = {};
const add = (battery, ref, state, expected) => { items.push({ battery, ref, state, expected }); counts[battery] = (counts[battery] || 0) + 1; };

function pagesOf(state) { const p = state.pages; return Array.isArray(p) ? p : p && typeof p === 'object' ? Object.values(p) : []; }

function harvestPageType(project) {
  const state = readJSON(join(project, 'stardust', 'state.json')); if (!state) return;
  const pages = pagesOf(state).filter((p) => p && p.type && p.slug);
  const types = [...new Set(pages.map((p) => p.type))].sort();
  if (types.length < 2) return;
  const byType = new Map(); for (const p of shuffle(pages)) { if (!byType.has(p.type)) byType.set(p.type, []); byType.get(p.type).push(p); }
  const perType = Math.max(2, Math.floor(opt.perProject / types.length));
  for (const [type, list] of byType) {
    for (const p of list.slice(0, perType)) {
      const cap = readJSON(join(project, 'stardust', 'current', 'pages', `${p.slug}.json`)); if (!cap) continue;
      let path = p.slug; try { path = new URL(cap.finalUrl || cap.url || p.url).pathname; } catch { /* keep slug */ }
      const headings = (cap.headings || []).slice(0, 14).map((h) => ({ tag: h.tag, text: clip(h.text, 100) }));
      const words = typeof cap.body === 'string' ? cap.body.split(/\s+/).length : Array.isArray(cap.body) ? cap.body.join(' ').split(/\s+/).length : null;
      const pageState = { path, title: clip(cap.title, 160), description: clip(cap.description, 300), headings, counts: { ctas: (cap.ctas || []).length, links: (cap.links || []).length, images: (cap.media || []).length, words }, signals: cap._signals ? clip(JSON.stringify(cap._signals), 600) : undefined };
      // Options carry what the pipeline knows before typing siblings: for each type, the paths and the
      // lead heading of up to three OTHER pages of that type (the archetype and its first siblings).
      const typeOptions = Object.fromEntries(types.map((t) => {
        const others = (byType.get(t) || []).filter((o) => o.slug !== p.slug).slice(0, 3).map((o) => { const c = readJSON(join(project, 'stardust', 'current', 'pages', `${o.slug}.json`)); let op = o.slug; try { op = new URL((c && (c.finalUrl || c.url)) || o.url).pathname; } catch { /* slug */ } const h1 = c && (c.headings || []).find((h) => h.tag === 'h1'); return h1 ? `${op} — "${clip(h1.text, 60)}"` : op; });
        return [t, others.length ? { examples: others } : null];
      }));
      add('page-type', `${basename(project)}/${p.slug}`, { page: pageState, types: typeOptions }, { type });
    }
  }
}

function harvestDynamics(project) {
  const f = join(project, 'stardust', 'dynamic-features.md'); if (!existsSync(f)) return;
  const lines = readFileSync(f, 'utf8').split('\n');
  const hi = lines.findIndex((l) => /^\|/.test(l) && /\bclass\b/i.test(l) && /\bdisposition\b/i.test(l)); if (hi < 0) return;
  const cols = lines[hi].split('|').slice(1, -1).map((c) => c.trim().toLowerCase());
  const col = (name) => cols.findIndex((c) => c === name || c.startsWith(name));
  const ix = { id: col('id'), feature: col('feature'), cls: col('class'), reach: col('reach'), disp: col('disposition'), repro: col('reproducibility'), status: col('status'), evidence: col('evidence') };
  if (ix.feature < 0 || ix.cls < 0 || ix.disp < 0) return;
  const DISP = ['rebuild-native', 'index-backed', 'data-fed', 'embed-passthrough', 'client-only', 'static-snapshot', 'decided-out'];
  const REPRO = ['self', 'needs-credential', 'needs-human-capture', 'needs-backend', 'needs-business-decision'];
  const CLASSES = ['I18N', 'CR', 'L', 'S', 'F', 'M', 'V', 'T', 'A', 'R', 'X', 'D'];
  for (let i = hi + 2; i < lines.length && /^\|/.test(lines[i]); i += 1) {
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
    const plain = (s) => (s || '').replace(/\*\*/g, '').replace(/`/g, '');
    const cls = CLASSES.find((c) => new RegExp(`(^|[^A-Z])${c}([^A-Z]|$)`).test(plain(cells[ix.cls]).split(/[+,/ ]/)[0]));
    const disp = DISP.find((d) => plain(cells[ix.disp]).includes(d));
    const repro = ix.repro >= 0 ? REPRO.find((r) => plain(cells[ix.repro]).startsWith(r)) : undefined;
    if (!cls || !disp) continue;
    const feature = { id: ix.id >= 0 ? plain(cells[ix.id]) : `row-${i}`, description: plain(cells[ix.feature]), reach: ix.reach >= 0 ? plain(cells[ix.reach]) : undefined, evidence: ix.evidence >= 0 ? clip(plain(cells[ix.evidence]), 300) : undefined };
    add('dynamics-triage', `${basename(project)}/${feature.id}`, { feature }, { class: cls, disposition: disp, ...(repro ? { reproducibility: repro } : {}) });
  }
}

const GENERIC = /\b(body|prose|default|text|content|intro|copy|wrapper|section)\b/i;

function inventory(section, page) {
  const items = section.items || [];
  const roles = items.map((it) => it.role);
  const counts = { headings: roles.filter((r) => r === 'heading').length, ctas: roles.filter((r) => r === 'cta').length, images: roles.filter((r) => r === 'image' || r === 'img').length, textRuns: roles.filter((r) => r === 'body').length };
  const repeats = (section.repeats || []).map((r) => ({ count: r.count, uniform: r.uniform, unit: r.unit }));
  return { page, roles: roles.slice(0, 40), repeats, counts };
}

function harvestAlignment(project) {
  const dir = join(project, 'stardust', 'eds-schema'); if (!existsSync(dir)) return;
  const secs = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const j = readJSON(join(dir, f)); if (!j || !Array.isArray(j.sections)) continue;
    for (const s of j.sections) {
      // Blocks only: a section with fewer than three items, or named like a prose wrapper, is default
      // content — pairing two such wrappers by name labels nothing about blocks (recorded: a wrapper
      // holding one heading on one page and two paragraphs on another, labelled "same block").
      if (!s.section || (s.items || []).length < 3 || GENERIC.test(s.section)) continue;
      secs.push({ name: s.section.replace(/\s+\d+$/, ''), page: basename(f, '.json'), inv: inventory(s, basename(f, '.json')) });
    }
  }
  if (secs.length < 4) return;
  const same = []; const diff = [];
  const shuffled = shuffle(secs);
  for (let i = 0; i < shuffled.length; i += 1) for (let j = i + 1; j < shuffled.length; j += 1) {
    const a = shuffled[i]; const b = shuffled[j]; if (a.page === b.page) continue;
    (a.name === b.name ? same : diff).push([a, b]);
  }
  const n = Math.min(Math.floor(opt.perProject / 2), same.length, diff.length);
  for (const [a, b] of shuffle(same).slice(0, n)) add('section-alignment', `${basename(project)}/${a.page}:${a.name}~${b.page}:${b.name}`, { a: a.inv, b: b.inv }, { relation: 2 });
  for (const [a, b] of shuffle(diff).slice(0, n)) add('section-alignment', `${basename(project)}/${a.page}:${a.name}~${b.page}:${b.name}`, { a: a.inv, b: b.inv }, { relation: 0 });
}


// progress.json nests per page type → breakpoints → width → result; the page is the archetype slug or
// the page-type key, never a width or a structural key.
const STRUCT = new Set(['breakpoints', 'result', 'canon', 'chrome', 'motion', 'iterationNotes', 'gates']);
const pageKey = (o, k, page) => (Array.isArray(o) || /^\d+$/.test(k) || STRUCT.has(k) ? page : (o[k] && typeof o[k] === 'object' && (o[k].archetype || o[k].breakpoints || o[k].url)) ? (o[k].archetype || k) : k);

// ---- flag-justify ----------------------------------------------------------------------------------
const FLAG_LINE = /^\s*(🔴|🟠|🟡|⚠|STRETCHED|IMAGE DID NOT LOAD|BLANK|MISSING|EXTRA|HIDDEN)/u;
const POLICY = 'Capture-state policy: content that varies between loads of the origin (carousel slides, rotating offers, personalised rails, tickers, dates, hydration placeholders) is replicated at its captured state and recorded, not chased. Heuristic notes: object-fit images inside fixed boxes read as stretched; lazy images below the fold may not have loaded when sampled; JSON-LD and script bodies are machine-only text. Fonts: a licensed face may be substituted by a metric-matched one. The inconsistency register is empty unless stated: no design change is permitted.';
function flagLines(text) {
  return text.split('\n').filter((l) => FLAG_LINE.test(l.trim())).map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l.length > 8);
}
function probeSummary(text) { return text.split('\n').filter((l) => /^\s*(source|build|editable texts|Findings|Content diff|Visual diff)/.test(l)).map((l) => l.trim()).slice(0, 6).join('\n'); }
function harvestFlags(project) {
  const dir = join(project, 'stardust', 'replica', 'gates'); if (!existsSync(dir)) return;
  const seen = new Set();
  for (const g of readdirSync(dir)) {
    const m = g.match(/^(.+)-(\d{3,4})$/); if (!m) continue;
    const [, page, width] = m; const gd = join(dir, g); if (!statSync(gd).isDirectory()) continue;
    for (const probe of ['content', 'visual']) {
      const first = join(gd, `${probe}-diff-iter1.txt`); const last = join(gd, `${probe}-diff-final.txt`);
      if (!existsSync(first) || !existsSync(last)) continue;
      const t1 = readFileSync(first, 'utf8'); const tf = readFileSync(last, 'utf8');
      const finalSet = new Set(flagLines(tf));
      for (const line of flagLines(t1)) {
        const key = `${page}|${width}|${line}`; if (seen.has(key)) continue; seen.add(key);
        const kept = finalSet.has(line);
        const severity = line.startsWith('🔴') ? 'red' : line.startsWith('🟠') ? 'orange' : line.startsWith('🟡') ? 'yellow' : 'advisory';
        add('flag-justify', `${basename(project)}/${page}@${width}/${probe}/${Array.from(line).slice(0, 40).join('')}`, { flag: { probe, line: clip(line, 400), severity }, gate: { page, width: Number(width), regime: 'prototype', summary: probeSummary(t1) }, policy: POLICY }, { defect: !kept });
      }
    }
  }
  const prog = readJSON(join(project, 'stardust', 'replica', 'progress.json')); if (!prog) return;
  (function walk(o, page) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.justified)) for (const j of o.justified) {
      if (!j || !j.flag) continue; const key = `${page}|j|${j.flag}`; if (seen.has(key)) continue; seen.add(key);
      add('flag-justify', `${basename(project)}/${page}/justified/${Array.from(String(j.flag)).slice(0, 40).join('')}`, { flag: { probe: j.probe || 'content', line: clip(String(j.flag), 400), severity: /🔴/.test(j.flag) ? 'red' : /🟠/.test(j.flag) ? 'orange' : 'yellow' }, gate: { page, width: null, regime: 'prototype', summary: '' }, policy: POLICY }, { defect: false });
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'justified' && k !== 'residuals') walk(v, pageKey(o, k, page));
  })(prog, 'site');
}

// ---- residual-causes -------------------------------------------------------------------------------
const CAUSE_KEYS = {
  font_fallback: /\b(font|glyph|substitut|typeface|weight|hellix|size-adjust|kerning|face)\b/i,
  nondeterministic_live: /\b(carousel|rotat|personali[sz]|live state|a\/b|bucket|ticker|date|autoplay|hydration|loader|random|per load|each run|different card|offer)\b/i,
  sticky_widget: /\b(medallia|chat|feedback tab|sticky|fixed widget|to-top|back-to-top|cookie|scrollbar|skip-link)\b/i,
  capture_truncation: /\b(capture|truncat|settle|blocked|403|challenge|lazy|not loaded|screenshot|wrap|16,?384|unsettled)\b/i,
  chrome_generation: /\b(header|footer|nav|chrome|hamburger|store selector|search pill)\b/i,
  pipeline_transform: /\b(picture|<p>|unwrap|pipeline|metadata section|media_|rewrit|delivery)\b/i,
  offset_contamination: /\b(offset|contaminat|shift|below|above it|pushes|dy)\b/i,
};
function harvestResiduals(project) {
  const prog = readJSON(join(project, 'stardust', 'replica', 'progress.json')); if (!prog) return;
  const gates = join(project, 'stardust', 'replica', 'gates');
  (function walk(o, page) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.residuals)) for (const r of o.residuals) {
      if (!r || !r.cause) continue;
      const expected = Object.fromEntries(Object.entries(CAUSE_KEYS).map(([k, re]) => [k, re.test(String(r.cause))]));
      if (!Object.values(expected).some(Boolean)) continue;
      const width = /360/.test(JSON.stringify(r)) ? 360 : 1440;
      let table = '';
      const gd = join(gates, `${page}-${width}`);
      if (existsSync(gd)) { for (const f of ['pixel-final.txt', 'pixel-iter3.txt', 'pixel-iter2.txt', 'pixel-iter1.txt']) { const p = join(gd, f); if (existsSync(p)) { table = readFileSync(p, 'utf8').split('\n').filter((l) => /^\s*(y\s|differing|A \d|height)/.test(l)).slice(0, 14).join('\n'); break; } } }
      const verdict = { page, width, band: r.band || r.region || null, pct: r.pct ?? null, heightDelta: r.heightDelta ?? null, bands: table || undefined, notes: r.flaggedFor ? `flagged for ${r.flaggedFor}` : undefined };
      add('residual-causes', `${basename(project)}/${page}@${width}/${Array.from(String(r.band || r.region || '')).slice(0, 24).join('')}`, { verdict }, expected);
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'justified' && k !== 'residuals') walk(v, pageKey(o, k, page));
  })(prog, 'site');
}

for (const project of projects) {
  if (opt.batteries.includes('page-type')) harvestPageType(project);
  if (opt.batteries.includes('dynamics-triage')) harvestDynamics(project);
  if (opt.batteries.includes('section-alignment')) harvestAlignment(project);
  if (opt.batteries.includes('flag-justify')) harvestFlags(project);
  if (opt.batteries.includes('residual-causes')) harvestResiduals(project);
}
mkdirSync(dirname(opt.out), { recursive: true });
writeFileSync(opt.out, items.map((it) => JSON.stringify(it)).join('\n') + (items.length ? '\n' : ''));
console.log(`harvest: ${projects.length} project(s) → ${items.length} item(s) in ${opt.out}`);
for (const [b, c] of Object.entries(counts)) console.log(`  ${b}: ${c}`);
