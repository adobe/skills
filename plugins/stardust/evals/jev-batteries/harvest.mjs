#!/usr/bin/env node
// evals/jev-batteries/harvest.mjs — build the labelled decision set for the decision layer (#127)
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
//   phase-claim        status.jsonl `end` lines joined to the journal section naming the phase; label
//                      `cites_instrument_output` = the detail or section carries a measured number, a
//                      PASS/FAIL word or an evidence path (a literal-presence label). The asserted class
//                      lives in fixtures/phase-claim.jsonl (hand-written; recorded runs rarely contain it).
//   brief-check        with --transcripts <dir of Claude Code project folders>: every Agent tool prompt
//                      from the recorded sessions, labelled per checklist item by literal presence.
//   decision-batch     "Decision batch" sections of dynamic-features.md as positives (one_batch = true).
//   block-triage       eds-conversion-log.md block table (name, description, tier) = the registry; every
//                      eds-schema section whose name is a registry block → expected reuse = that block,
//                      decode_tier = the table's tier, is_block = true.
//   metadata-select    content/<page>.html metadata Title / Description vs candidates from the captured
//                      page (title, og title, h1, description, og description, first paragraph); an item
//                      only when the authored value equals a candidate (label = that candidate).
//   flow-routing       with --transcripts: the first user prompt of every recorded session, labelled with
//                      the project's state.json flow (or `replica` when stardust/replica/progress.json
//                      exists); hands_off from the prompt's own words. Fixtures add redesign / reskin / none.
//   section-alignment  (v2 labels) same block name + same unit composition → 2, same name otherwise → 1,
//                      different names → 0; the state carries the per-unit composition and clipped texts.
//   Fixtures under fixtures/*.jsonl are copied into the output as-is (--fixtures <dir>, default beside
//   this script) so a single replay covers recorded and hand-written items.
// Exit codes: 0 ok · 2 usage.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const HERE = dirname(fileURLToPath(import.meta.url));
const opt = { projects: null, out: join(HERE, 'data', 'items.jsonl'), batteries: ['page-type', 'dynamics-triage', 'section-alignment', 'flag-justify', 'residual-causes', 'phase-claim', 'brief-check', 'decision-batch', 'block-triage', 'metadata-select', 'flow-routing'], transcripts: null, fixtures: join(HERE, 'fixtures'), perProject: 40, seed: 1 };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]; const v = () => { const x = argv[++i]; if (x === undefined || x.startsWith('--')) { console.error(`${a} needs a value`); process.exit(2); } return x; };
  if (a === '--projects') opt.projects = resolve(v());
  else if (a === '--out') opt.out = resolve(v());
  else if (a === '--batteries') opt.batteries = v().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--per-project') opt.perProject = Number(v());
  else if (a === '--seed') opt.seed = Number(v());
  else if (a === '--transcripts') opt.transcripts = resolve(v());
  else if (a === '--fixtures') opt.fixtures = resolve(v());
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
  const sample = items.slice(0, 6).map((it) => `${it.role}: ${clip(String(it.text || ''), 50)}`);
  return { page, roles: roles.slice(0, 40), repeats, counts, sample };
}
const unitShape = (inv) => JSON.stringify((inv.repeats || []).map((r) => r.unit));

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
  const variant = [];
  for (let i = 0; i < shuffled.length; i += 1) for (let j = i + 1; j < shuffled.length; j += 1) {
    const a = shuffled[i]; const b = shuffled[j]; if (a.page === b.page) continue;
    if (a.name !== b.name) diff.push([a, b]); else if (unitShape(a.inv) === unitShape(b.inv)) same.push([a, b]); else variant.push([a, b]);
  }
  const n = Math.min(Math.floor(opt.perProject / 3), same.length, diff.length);
  const strip = (inv) => ({ ...inv });
  for (const [a, b] of shuffle(same).slice(0, n)) add('section-alignment', `${basename(project)}/${a.page}:${a.name}~${b.page}:${b.name}`, { a: strip(a.inv), b: strip(b.inv) }, { relation: 2 });
  for (const [a, b] of shuffle(variant).slice(0, n)) add('section-alignment', `${basename(project)}/${a.page}:${a.name}~${b.page}:${b.name}`, { a: strip(a.inv), b: strip(b.inv) }, { relation: 1 });
  for (const [a, b] of shuffle(diff).slice(0, n)) add('section-alignment', `${basename(project)}/${a.page}:${a.name}~${b.page}:${b.name}`, { a: strip(a.inv), b: strip(b.inv) }, { relation: 0 });
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
      let table = ''; let anchors = ''; let chrome = ''; let fonts = '';
      const gd = join(gates, `${page}-${width}`);
      if (existsSync(gd)) {
        for (const f of ['pixel-final.txt', 'pixel-iter3.txt', 'pixel-iter2.txt', 'pixel-iter1.txt']) { const p = join(gd, f); if (existsSync(p)) { table = readFileSync(p, 'utf8').split('\n').filter((l) => /^\s*(y\s|differing|A \d|height)/.test(l)).slice(0, 14).join('\n'); break; } }
        // anchors: live vs the latest proto probe → per-section top / height deltas in words
        const live = existsSync(join(gd, 'anchor-live.txt')) ? readFileSync(join(gd, 'anchor-live.txt'), 'utf8') : '';
        const protoFile = ['anchor-proto-final.txt', 'anchor-proto-iter3.txt', 'anchor-proto-iter2.txt', 'anchor-proto-iter1.txt'].map((f) => join(gd, f)).find(existsSync);
        const proto = protoFile ? readFileSync(protoFile, 'utf8') : '';
        const parse = (t) => Object.fromEntries([...t.matchAll(/^\s*y\s+(\d+)\s+h\s+(\d+)\s+(\S+)/gm)].map((m) => [m[3], { y: Number(m[1]), h: Number(m[2]) }]));
        const L = parse(live); const Pp = parse(proto);
        anchors = Object.keys(Pp).map((k) => (L[k] ? `${k}: build top ${Pp[k].y - L[k].y >= 0 ? '+' : ''}${Pp[k].y - L[k].y} px, height ${Pp[k].h - L[k].h >= 0 ? '+' : ''}${Pp[k].h - L[k].h} px vs live` : `${k}: on the build only`)).slice(0, 12).join('\n');
        for (const f of readdirSync(gd)) { if (/^chrome-parity.*\.txt$/.test(f)) { chrome = readFileSync(join(gd, f), 'utf8').split('\n').filter((l) => /^(✗|✓)/.test(l)).slice(0, 4).join('\n'); } if (/^stitch|^pixel-/.test(f) && /\.txt$/.test(f)) { const t = readFileSync(join(gd, f), 'utf8'); const m = t.match(/font[^\n]*(fallback|error|not loaded|status)[^\n]*/i); if (m && !fonts) fonts = m[0].slice(0, 200); } }
      }
      const verdict = { page, width, band: r.band || r.region || null, pct: r.pct ?? null, heightDelta: r.heightDelta ?? null, bands: table || undefined, anchors: anchors || undefined, chrome: chrome || undefined, fonts: fonts || undefined, notes: r.flaggedFor ? `flagged for ${r.flaggedFor}` : undefined };
      add('residual-causes', `${basename(project)}/${page}@${width}/${Array.from(String(r.band || r.region || '')).slice(0, 24).join('')}`, { verdict }, expected);
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'justified' && k !== 'residuals') walk(v, pageKey(o, k, page));
  })(prog, 'site');
}


// ---- phase-claim ------------------------------------------------------------------------------------
const EVIDENCE = /\d+(\.\d+)?\s?%|Δ\s?-?\d|\bPASS\b|\bFAIL\b|🔴|\d+\/\d+|\.(txt|json|png|md|html)\b|stardust\/|\bexit \d\b|\b\d+ ?px\b/;
function journalSections(text) {
  const out = []; const re = /^## (.+)$/gm; let m; const idx = [];
  while ((m = re.exec(text))) idx.push({ title: m[1], start: m.index });
  for (let i = 0; i < idx.length; i += 1) out.push({ title: idx[i].title, body: text.slice(idx[i].start, idx[i + 1] ? idx[i + 1].start : undefined) });
  return out;
}
function harvestPhaseClaims(project) {
  const f = join(project, 'stardust', 'status.jsonl'); if (!existsSync(f)) return;
  const journal = existsSync(join(project, 'stardust', 'journal.md')) ? journalSections(readFileSync(join(project, 'stardust', 'journal.md'), 'utf8')) : [];
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l && l.event === 'end');
  for (const l of lines) {
    const norm = (x) => String(x || '').toLowerCase().replace(/[-_ ]+/g, ' ');
    const sec = journal.find((s) => norm(s.title).includes(norm(l.phase).replace(/^[a-z]\d? /, '')) || norm(s.title).includes(norm(l.phase)));
    const detail = l.detail || ''; const body = sec ? clip(sec.body, 2500) : '';
    if (!detail && !body) continue;
    const evidenced = EVIDENCE.test(detail) || EVIDENCE.test(body);
    add('phase-claim', `${basename(project)}/${l.skill}/${l.phase}/${(l.ts || '').slice(0, 19)}`, { claim: { skill: l.skill, phase: l.phase, detail: clip(detail, 600), artifact: l.artifact || null, journal: body || null }, expects: 'an evidenced end of a stardust phase names instrument verdict lines (pixel %, Δh, PASS/FAIL, structural red counts), counts of pages or nodes, and paths to evidence files' }, { cites_instrument_output: evidenced });
  }
}

// ---- brief-check (from Claude Code transcripts) -------------------------------------------------------
const CHECK = {
  names_owned_paths: /work only inside|may (only )?(write|touch|edit)|must not (touch|edit|write)|never (edit|touch|write)|owned paths|do not (touch|edit|modify)|files you may/i,
  carries_gate_commands: /gate\.sh|run-bg\.mjs|pixel-compare|gate-all|block-roundtrip|content-diff\.mjs|qa-gate|deploy-batch|node stardust\/scripts/i,
  cites_contract_sections: /EW\d|editability contract|david'?s model|§|section \d|reference\/[a-z-]+\.md|SKILL\.md/i,
  requires_ledger_lines: /ledger\.mjs|status\.jsonl|progress\.json|verdict line|report back|one line (back|per)/i,
  forbids_shortcuts: /never (copy|paste) the (live )?dom|no dom cop|never eyeball|measure(d)?,? not (by )?eye|never weaken|do not weaken|frozen|no fixed sleep|never sleep/i,
  bounded_scope: /archetype|template|pages?:|slugs?|unit|only these|this page|cluster/i,
};
function harvestBriefs(dir) {
  if (!dir || !existsSync(dir)) return;
  const files = [];
  (function walk(d, depth) { if (depth > 3) return; for (const n of readdirSync(d)) { const p = join(d, n); try { if (statSync(p).isDirectory()) walk(p, depth + 1); else if (p.endsWith('.jsonl')) files.push(p); } catch { /* skip */ } } })(dir, 0);
  let n = 0;
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (!text.includes('"name":"Agent"')) continue;
    for (const line of text.split('\n')) {
      if (!line.includes('"name":"Agent"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const content = j && j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const c of content) {
        if (!c || c.type !== 'tool_use' || c.name !== 'Agent' || !c.input || !c.input.prompt) continue;
        const brief = String(c.input.prompt); if (brief.length < 300) continue;
        const expected = Object.fromEntries(Object.entries(CHECK).map(([k, re]) => [k, re.test(brief)]));
        const phase = /archetype|recreat|prototype/i.test(c.input.description || brief.slice(0, 300)) ? 'archetype' : /deploy|block|convert/i.test(c.input.description || '') ? 'deploy' : /cluster|deliver/i.test(c.input.description || '') ? 'cluster' : /foundation|canon/i.test(c.input.description || '') ? 'foundation' : 'other';
        n += 1;
        add('brief-check', `${basename(dirname(f)).replace(/^-Users-[a-z]+-stardust-\d{4}-\d{2}-/, '')}/${n}/${clip(c.input.description || 'brief', 30)}`, { brief: clip(brief, 6000), phase, checklist: Object.keys(CHECK) }, expected);
      }
    }
  }
}

// ---- decision-batch (positives from the curated inventory) -------------------------------------------
function harvestDecisionBatches(project) {
  const f = join(project, 'stardust', 'dynamic-features.md'); if (!existsSync(f)) return;
  const text = readFileSync(f, 'utf8'); const m = text.match(/^##+ .*decision batch[^\n]*\n([\s\S]*?)(?=^##+ |\n*$)/im);
  if (!m || m[1].trim().length < 120) return;
  const pending = [...text.matchAll(/\|\s*\d+\s*\|\s*([a-z0-9-]+)\s*\|[^\n]*\|\s*(needs-[a-z-]+)\s*\|/gi)].map((x) => `${x[1]} (${x[2]})`).slice(0, 12);
  add('decision-batch', `${basename(project)}/decision-batch`, { message: clip(m[1].trim(), 3000), pending }, { one_batch: true });
}


// ---- block-triage (conversion-log registry × schema sections) ----------------------------------------
function blockRegistry(project) {
  const f = join(project, 'stardust', 'eds-conversion-log.md'); if (!existsSync(f)) return null;
  const lines = readFileSync(f, 'utf8').split('\n');
  const reg = {}; const tiers = {};
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|/.test(lines[i]) || !/\|\s*-{3}/.test(lines[i + 1] || '')) continue;
    const cols = lines[i].split('|').slice(1, -1).map((c) => c.trim().toLowerCase());
    const bi = cols.findIndex((c) => /^block/.test(c)); if (bi < 0) continue;
    const ti = cols.findIndex((c) => c === 'tier' || /decode/.test(c)); const di = cols.findIndex((c, k) => k !== bi && /what|pattern|purpose|description|shape|variants/.test(c));
    for (let j = i + 2; j < lines.length && /^\|/.test(lines[j]); j += 1) {
      const cells = lines[j].split('|').slice(1, -1).map((c) => c.trim());
      const name = (cells[bi] || '').replace(/`/g, '').trim(); if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
      if (!reg[name]) reg[name] = clip((di >= 0 ? cells[di] : cells.filter((_, k) => k !== bi).join(' · ')).replace(/`/g, ''), 160);
      const tierText = ti >= 0 ? cells[ti] : cells.join(' ');
      if (/template-slotted/i.test(tierText)) tiers[name] = 'template_slotted'; else if (/reconstructive/i.test(tierText)) tiers[name] = 'reconstructive';
    }
  }
  return Object.keys(reg).length >= 4 ? { reg, tiers } : null;
}
function harvestBlockTriage(project) {
  const R = blockRegistry(project); if (!R) return;
  const dir = join(project, 'stardust', 'eds-schema'); if (!existsSync(dir)) return;
  let n = 0;
  for (const f of shuffle(readdirSync(dir).filter((x) => x.endsWith('.json')))) {
    const j = readJSON(join(dir, f)); if (!j || !Array.isArray(j.sections)) continue;
    for (const s of j.sections) {
      const name = String(s.section || '').replace(/\s+\d+$/, ''); if (!R.reg[name] || (s.items || []).length < 2) continue;
      if (n >= opt.perProject) return;
      const items = (s.items || []).slice(0, 12).map((it) => ({ role: it.role, text: clip(String(it.text || ''), 60), ...(it.href ? { href: clip(it.href, 60) } : {}) }));
      const expected = { reuse: name, is_block: true }; if (R.tiers[name]) expected.decode_tier = R.tiers[name];
      add('block-triage', `${basename(project)}/${basename(f, '.json')}/${name}`, { section: { items, repeats: (s.repeats || []).map((r) => ({ count: r.count, uniform: r.uniform, unit: r.unit })) }, registry: R.reg }, expected);
      n += 1;
    }
  }
}

// ---- metadata-select (authored metadata vs candidates from the capture) -----------------------------
const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").trim().toLowerCase();
function harvestMetadata(project) {
  const cdir = join(project, 'content'); if (!existsSync(cdir)) return;
  const files = []; (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.html$/.test(e) && !/^_/.test(e)) files.push(p); } })(cdir);
  let n = 0;
  for (const f of shuffle(files)) {
    if (n >= opt.perProject) return;
    const html = readFileSync(f, 'utf8'); const start = html.indexOf('<div class="metadata">'); if (start < 0) continue;
    const rest = html.slice(start + 22); const stop = rest.search(/<div class="(?!metadata)[^"]*">|<\/main>/); const block = stop > 0 ? rest.slice(0, stop) : rest.slice(0, 4000);
    const kv = Object.fromEntries([...block.matchAll(/<div>\s*<div>([^<]+)<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => [m[1].trim().toLowerCase(), m[2].replace(/<[^>]+>/g, '').trim()]));
    const slug = basename(f, '.html'); const cap = readJSON(join(project, 'stardust', 'current', 'pages', `${slug}.json`)); if (!cap) continue;
    const h1 = (cap.headings || []).find((h) => h.tag === 'h1'); const firstPara = typeof cap.body === 'string' ? cap.body.split(/\n+/).find((x) => x.trim().length > 40) : Array.isArray(cap.body) ? cap.body.find((x) => String(x).trim().length > 40) : null;
    const page = { path: (() => { try { return new URL(cap.finalUrl || cap.url).pathname; } catch { return slug; } })(), h1: h1 ? h1.text : null, headings: (cap.headings || []).slice(0, 8).map((h) => clip(h.text, 80)), first_paragraph: clip(firstPara, 300), og_title: cap.og && cap.og.title ? cap.og.title : null, og_description: cap.og && cap.og.description ? cap.og.description : null, site_name: null };
    for (const field of ['title', 'description']) {
      const authored = kv[field]; if (!authored) continue;
      const cands = [...new Set([cap.title, cap.og && cap.og.title, h1 && h1.text, cap.description, cap.og && cap.og.description, firstPara, ...(cap.headings || []).slice(0, 4).map((h) => h.text)].filter((x) => x && String(x).trim().length > 3).map((x) => String(x).replace(/\s+/g, ' ').trim()))].slice(0, 12);
      const hit = cands.find((c) => norm(c) === norm(authored)); if (!hit) continue;
      add('metadata-select', `${basename(project)}/${slug}/${field}`, { field, page, candidates: cands }, { pick: hit });
      n += 1;
    }
  }
}

// ---- flow-routing (first user prompt per session × the project's flow) ------------------------------
function flowOf(project) {
  const st = readJSON(join(project, 'stardust', 'state.json')); if (st && st.flow) return st.flow;
  if (existsSync(join(project, 'stardust', 'replica', 'progress.json')) || existsSync(join(project, 'stardust', 'replica', 'inconsistency-register.md'))) return 'replica';
  if (/redesign/i.test(basename(project))) return 'redesign';
  return null;
}
function harvestFlowRouting(dir) {
  if (!dir || !existsSync(dir)) return;
  const byName = new Map(projects.map((p) => [basename(p), p]));
  for (const d of readdirSync(dir)) {
    const m = d.match(/^-Users-[a-z]+-stardust-\d{4}-\d{2}-(.+)$/); if (!m) continue;
    const proj = byName.get(m[1]) || [...byName.entries()].find(([k]) => m[1].startsWith(k))?.[1]; if (!proj) continue;
    const flow = flowOf(proj); if (!flow) continue;
    for (const f of readdirSync(join(dir, d)).filter((x) => x.endsWith('.jsonl'))) {
      let first = null;
      for (const line of readFileSync(join(dir, d, f), 'utf8').split('\n')) {
        if (!line.includes('"type":"user"')) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.type !== 'user') continue;
        const c = j.message && j.message.content; const text = typeof c === 'string' ? c : Array.isArray(c) && c[0] && c[0].type === 'text' ? c[0].text : '';
        if (!text || /^<task-notification|^<system-reminder|^Base directory|^<local-command|^<command-name/.test(text.trim())) continue;
        first = text.trim(); break;
      }
      if (!first || first.length < 40 || !/migrat|eds|stardust|replica|redesign|reskin/i.test(first)) continue;
      const handsOff = /hands-?off|autonomous|no approval|without asking|don'?t ask|never ask|do not ask|run everything|end to end/i.test(first);
      add('flow-routing', `${m[1]}/${basename(f, '.jsonl').slice(0, 8)}`, { prompt: clip(first, 1500) }, { flow, hands_off: handsOff });
    }
  }
}

function copyFixtures(dir) {
  if (!dir || !existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) for (const line of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) { try { const it = JSON.parse(line); if (opt.batteries.includes(it.battery) || !opt.batteries.length) add(it.battery, it.ref, it.state, it.expected); } catch { /* skip */ } }
}

for (const project of projects) {
  if (opt.batteries.includes('page-type')) harvestPageType(project);
  if (opt.batteries.includes('dynamics-triage')) harvestDynamics(project);
  if (opt.batteries.includes('section-alignment')) harvestAlignment(project);
  if (opt.batteries.includes('flag-justify')) harvestFlags(project);
  if (opt.batteries.includes('residual-causes')) harvestResiduals(project);
  if (opt.batteries.includes('phase-claim')) harvestPhaseClaims(project);
  if (opt.batteries.includes('decision-batch')) harvestDecisionBatches(project);
  if (opt.batteries.includes('block-triage')) harvestBlockTriage(project);
  if (opt.batteries.includes('metadata-select')) harvestMetadata(project);
}
if (opt.batteries.includes('brief-check')) harvestBriefs(opt.transcripts);
if (opt.batteries.includes('flow-routing')) harvestFlowRouting(opt.transcripts);
copyFixtures(opt.fixtures);
mkdirSync(dirname(opt.out), { recursive: true });
writeFileSync(opt.out, items.map((it) => JSON.stringify(it)).join('\n') + (items.length ? '\n' : ''));
console.log(`harvest: ${projects.length} project(s) → ${items.length} item(s) in ${opt.out}`);
for (const [b, c] of Object.entries(counts)) console.log(`  ${b}: ${c}`);
