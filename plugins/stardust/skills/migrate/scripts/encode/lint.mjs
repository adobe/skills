/**
 * migrate/encode/lint.mjs — the map's authoring checks behind `encode.mjs --lint` and `encode.mjs --sweep`. A library
 * module (no CLI): it reads the project and writes nothing.
 *
 *   runLint(ctx)  → Promise<exit code>  0 no finding · 1 any finding
 *   runSweep(ctx) → Promise<exit code>  0 nothing listed · 2 something listed · 1 an invalid map or no usable archetype
 *
 * Every capture is seen as the encoder sees it, through the engine's own exports: prepareCapture, dropPredicate (a
 * marker's or the transform's `drop` is never a module, a dropped row never a row), moduleLevel / walkModules,
 * markerMatches, rowNodes, classTokens, GENERATED_TOKEN.
 *
 * --lint, at authoring time, against the archetype (reference/encode-map.schema.json documents every key):
 *   map        the engine's own validators (ctx.mapErrors: validateVocabulary / validateTransform — never a second
 *              validator) and `archetype` naming the template's archetype. An invalid map skips every other check.
 *   inputs     each `inputs.<k>` {path, sha} matches the file it names; an existing capture / eds-schema / units.json
 *              is recorded. The finding prints what to record.
 *   archetype  its capture exists, its root is found, it encodes (ctx.encodeTemplate, in memory) and does not stop.
 *   C1  no selector of the map (root, chrome, wrappers, moduleSelectors, metadata text(), markers' sel / when / drop /
 *       rows / cells, transform drop) uses a forbidden form: a generated id, class or attribute value (the engine's
 *       generated-token rule: 8+ hex digits or 5+ digits), a position pseudo-class, a class on no capture of the
 *       template (a prototype class; named when it is an eds-schema unitSelector), or — in a marker, variant or module
 *       selector — a chain through a layout container (a class of wrappers[] or of a wrapper / section marker; inside
 *       :is() / :where() too, while a :has() / :not() predicate may name one).
 *   C2  every marker has a first-match hit on the archetype, or names evidence[] siblings and hits each of them.
 *   C3  every module the walk reaches is matched by exactly one marker selector (two: the array order decides
 *       silently; none: the engine's census lists it); a `unique` marker never matches twice on any capture.
 *   C4  a block marker's rows select a unit in each of its modules; where stardust/replica/units.json declares a family
 *       for the archetype or its template (unit-geometry's rule), the origin selects exactly the rows of the block
 *       modules holding its units (a block without rows: the modules). An origin selecting nothing is a note.
 *   C5  the encoded archetype's block variants and section styles equal its gated content/<path>.html: both documents
 *       reduced to sections, block names, variant lists and section-metadata, compared by encode/compare.mjs at core.
 *   C6  each block's text items (heading / cta / body, classified as content-inventory's in-page inventory does,
 *       keyed by its norm; eyebrow counts as body) keep the role and order of the eds-schema section they align with
 *       — the one sharing most of the block's text, never by section index.
 *   A missing optional input (units.json, the eds-schema, the gated document) skips its check with a note.
 *
 * --sweep, a dry run over every sibling capture (nothing is encoded or written), lists new kinds (an unmarked node the
 * engine's census reads — a sectionTags node, or a module-level node that is not class-less plain content — whose
 * shape `tag.classes` no unmarked archetype node has, visible or not: a class-less <div>, <form> or <iframe> is
 * `div.`, `form.`, `iframe.`), unknown modifiers (a class on a sibling's marker match that the archetype's matches of
 * that marker, its selectors and ignoreModifiers do not account for) and zero-hit markers (no first-match hit on any
 * capture of the template).
 *
 * Output: `✗ <check> <where>: <message>` per finding, `· <check>: <message>` per note, then the verdict, last:
 * `lint <archetype>: N findings · N notes` / `sweep <archetype>: N siblings · new kinds N · unknown modifiers N ·
 * zero-hit markers N`. --json: line 1 = the report as one JSON object; the verdict line stays last.
 *
 * ctx (built by encode.mjs): { root, template: {id, archetype, pages[]}, vocab, tf, vocabFile, transformFile,
 * mapErrors[], site, engine, dom, loadDeploy, readCapture(slug), encodeTemplate, loadEncoderDeps, json, out(line),
 * err(line) }.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECKS = ['map', 'inputs', 'archetype', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
const POSITION = new Set(['first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);
const NESTED = new Set(['not', 'is', 'where', 'has']);
const CHAINED = new Set(['marker', 'when', 'module']);
// the engine's census rule (engine.mjs PLAIN_CONTENT, not exported): class-less plain content is never a component
export const PLAIN_CONTENT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'table', 'figure', 'img', 'picture', 'hr', 'br', 'a', 'span', 'strong', 'em', 'b', 'i', 'small', 'code']);
const ROLE = { heading: 'heading', cta: 'cta', body: 'body', eyebrow: 'body' };
const ROLE_NAME = { heading: 'a heading', cta: 'a cta', body: 'body text' };
const isBlock = (m) => String(m.emitter || '').startsWith('block:');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const q = (v) => (v === null || v === undefined ? 'none' : JSON.stringify(v));
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const fileSha = (file) => { try { return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`; } catch { return null; } };
function readJson(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { missing: true }; throw e; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { error: e.message }; }
}
const INPUT_PATHS = (a) => ({ capture: `stardust/current/pages/${a}.html`, edsSchema: `stardust/eds-schema/${a}.json`, units: 'stardust/replica/units.json', variance: null });

// ===================================================================================== captures and the walk
/**
 * What the checks share: the map's markers, and each page's capture seen as the encoder sees it — prepared, its drops
 * collected (engine dropPredicate), walked (engine moduleLevel / walkModules / markerMatches); memoised per page.
 */
function setup(ctx) {
  const { dom, engine, vocab } = ctx;
  const markers = Array.isArray(vocab.markers) ? vocab.markers : [];
  const classList = (n) => String(dom.attr(n, 'class') || '').split(/\s+/).filter(Boolean);
  const tokens = engine.classTokens(vocab);
  const describe = (n) => `${n.tag}${classList(n).slice(0, 3).map((c) => `.${c}`).join('')}`;
  const caps = new Map();
  const capture = (slug) => {
    if (!caps.has(slug)) {
      const html = ctx.readCapture(slug);
      let cap = null;
      if (html !== null) {
        cap = { slug, html, prep: null, skip: null };
        try {
          cap.prep = engine.prepareCapture(html, vocab);
          if (!cap.prep.error) cap.skip = engine.dropPredicate(cap.prep, vocab, ctx.tf || {});
        } catch (e) { cap.prep = { error: `the capture cannot be prepared: ${e.message}` }; }
      }
      caps.set(slug, cap);
    }
    return caps.get(slug);
  };
  // every first-marker match at any depth (the fingerprint's traversal), and the nodes the walk classifies
  const matches = (cap) => (cap.matches ||= engine.markerMatches(cap.prep, vocab));
  const hits = (cap) => { const h = new Map(markers.map((m) => [m, 0])); for (const { marker } of matches(cap)) h.set(marker, h.get(marker) + 1); return h; };
  const walkLevel = (cap) => (cap.walk ||= engine.moduleLevel(cap.prep, vocab, { skip: cap.skip }));
  // the unmarked nodes the engine's census reads: every sectionTags node, and every module-level node that is not
  // class-less plain content — visible or not (the census itself counts the visible ones)
  const unmarked = (cap) => {
    const out = [];
    engine.walkModules(cap.prep, vocab, { skip: cap.skip, section: (n, descend) => { out.push(n); descend(); }, module: (n) => { if (!(PLAIN_CONTENT.has(n.tag) && !tokens(n).length)) out.push(n); } });
    return out;
  };
  const rowNodes = (cap, mod, m) => engine.rowNodes(mod, m, cap.skip.within);
  return { markers, classList, tokens, describe, capture, matches, hits, walkLevel, unmarked, rowNodes };
}

// ===================================================================================== selectors of the map
/** Every selector the map holds: [{where, sel, role}] in map order. */
function mapSelectors(vocab, tf) {
  const out = [];
  const add = (where, sel, role) => { if (typeof sel === 'string') out.push({ where, sel, role }); };
  const list = (v) => (Array.isArray(v) ? v : []);
  const cellSels = (cells, where) => {
    if (Array.isArray(cells)) cells.forEach((c, i) => cellSel(c, `${where}[${i}]`));
    else if (isObj(cells)) { add(`${where}.each`, cells.each, 'cell'); cellSel(cells, where); }
  };
  const cellSel = (c, where) => {
    if (!isObj(c)) return;
    add(`${where}.sel`, c.sel, 'cell'); add(`${where}.text`, c.text, 'cell');
    list(c.drop).forEach((s, i) => add(`${where}.drop[${i}]`, s, 'drop'));
    list(c.parts).forEach((p, i) => cellSel(p, `${where}.parts[${i}]`));
  };
  add('root', vocab.root, 'root');
  list(vocab.chrome).forEach((s, i) => add(`chrome[${i}]`, s, 'chrome'));
  list(vocab.wrappers).forEach((s, i) => add(`wrappers[${i}]`, s, 'wrapper'));
  list(vocab.moduleSelectors).forEach((s, i) => add(`moduleSelectors[${i}]`, s, 'module'));
  for (const row of list(vocab.metadata)) {
    if (!Array.isArray(row) || typeof row[1] !== 'string') continue;
    for (const alt of row[1].split('||')) { const m = /^text\((.*)\)$/.exec(alt.trim()); if (m) add(`metadata "${row[0]}"`, m[1], 'meta'); }
  }
  list(vocab.markers).forEach((m, i) => {
    if (!isObj(m)) return;
    const w = `markers[${i}]`;
    add(`${w}.sel`, m.sel, 'marker');
    list(m.variants).forEach((v, j) => add(`${w}.variants[${j}].when`, v && v.when, 'when'));
    list(m.drop).forEach((s, j) => add(`${w}.drop[${j}]`, s, 'drop'));
    if (typeof m.rows === 'string') add(`${w}.rows`, m.rows, 'rows');
    list(m.rows).forEach((g, j) => { if (isObj(g)) { add(`${w}.rows[${j}].sel`, g.sel, 'rows'); cellSels(g.cells, `${w}.rows[${j}].cells`); } });
    cellSels(m.cells, `${w}.cells`);
  });
  list(tf.drop).forEach((s, i) => add(`transform.drop[${i}]`, s, 'drop'));
  return out;
}

/**
 * Every compound of a selector, those inside :not() :is() :where() :has() included: [{c, top, subject}]. :is() and
 * :where() are part of the selector itself (their compounds keep the caller's top/subject position); :has() and :not()
 * are predicates (never `top`), so a structural test may name a layout class.
 */
function compounds(dom, sel, top = true, subjectCtx = true) {
  const out = [];
  for (const parts of dom.parseSelector(sel)) {
    parts.forEach((p, i) => {
      const subject = subjectCtx && i === parts.length - 1;
      out.push({ c: p.compound, top, subject });
      for (const ps of p.compound.pseudos) {
        if (!ps.arg || !NESTED.has(ps.name)) continue;
        out.push(...(ps.name === 'is' || ps.name === 'where' ? compounds(dom, ps.arg, top, subject) : compounds(dom, ps.arg, false)));
      }
    });
  }
  return out;
}

// ===================================================================================== the checks
/** The inputs as they are now: {capture, edsSchema, units, variance} → {path, sha} | null. */
function currentInputs(ctx) {
  const paths = INPUT_PATHS(ctx.template.archetype);
  const rec = isObj(ctx.vocab.inputs) ? ctx.vocab.inputs : {};
  const out = {};
  for (const k of Object.keys(paths)) {
    const path = paths[k] || (isObj(rec[k]) && typeof rec[k].path === 'string' ? rec[k].path : null);
    const sha = path ? fileSha(join(ctx.root, path)) : null;
    out[k] = sha ? { path, sha } : null;
  }
  return out;
}

function checkInputs(ctx, current, add, note) {
  const paths = INPUT_PATHS(ctx.template.archetype);
  const rec = ctx.vocab.inputs;
  const record = (k) => `record ${JSON.stringify(current[k])}`;
  if (rec === undefined) {
    for (const k of ['capture', 'edsSchema', 'units']) if (current[k]) add('inputs', `inputs.${k}`, `${record(k)} — what the map was checked against`);
    return;
  }
  if (!isObj(rec)) { add('inputs', 'inputs', 'an object { capture, edsSchema, units, variance } of { path, sha } (or null)'); return; }
  for (const k of Object.keys(paths)) {
    const r = rec[k]; const w = `inputs.${k}`;
    if (r === undefined || r === null) { if (k !== 'variance' && current[k]) add('inputs', w, `${paths[k]} exists: ${record(k)}`); continue; }
    if (!isObj(r) || typeof r.path !== 'string' || typeof r.sha !== 'string') { add('inputs', w, '{ path, sha } (or null)'); continue; }
    if (paths[k] && r.path !== paths[k]) { add('inputs', `${w}.path`, `"${r.path}" — this input is ${paths[k]}`); continue; }
    // a missing capture is the archetype check's finding; a missing optional input is its check's note
    if (!current[k]) { if (k === 'variance') note('inputs', `${w}: ${r.path} is missing — its sha cannot be checked`); continue; }
    if (current[k].sha !== r.sha) add('inputs', `${w}.sha`, `stale: the map records ${r.sha}, ${r.path} is ${current[k].sha} — re-check the map against the changed input, then record the new sha`);
  }
}

/** C1: forbidden selector forms. `captures` = every capture of the template read; `units` = eds-schema class → unitSelector. */
function checkC1(ctx, S, captures, units, add) {
  const { dom, engine, vocab, tf } = ctx;
  const GENERATED = engine.GENERATED_TOKEN;
  const present = new Set();
  for (const cap of captures) for (const n of dom.walk(dom.parseHTML(cap.html))) for (const c of S.classList(n)) present.add(c);
  const layout = new Set();
  const subjects = (sel) => { for (const parts of dom.parseSelector(sel)) { const last = parts[parts.length - 1]; if (last) for (const c of last.compound.classes) layout.add(c); } };
  for (const w of Array.isArray(vocab.wrappers) ? vocab.wrappers : []) subjects(w);
  for (const m of S.markers) if (engine.recursesThrough(m)) subjects(m.sel);
  for (const { where, sel, role } of mapSelectors(vocab, tf)) {
    const msgs = [];
    const push = (m) => { if (!msgs.includes(m)) msgs.push(m); };
    for (const { c, top, subject } of compounds(dom, sel)) {
      for (const p of c.pseudos) if (POSITION.has(p.name)) push(`a position pseudo-class :${p.name} — select by class or structure (:has, +, an ancestor), never by position`);
      if (c.id && GENERATED.test(c.id)) push(`a generated id #${c.id} — it differs on every page`);
      for (const a of c.attrs) if (a.value && GENERATED.test(a.value)) push(`a generated ${a.name === 'id' ? 'id' : 'attribute value'} [${a.name}${a.op}"${a.value}"] — it differs on every page`);
      for (const cls of c.classes) {
        if (GENERATED.test(cls)) push(`a generated class .${cls} — it differs on every page`);
        else if (!present.has(cls)) push(units.has(cls) ? `class .${cls} is the eds-schema unitSelector ${units.get(cls)}, a prototype selector — take selectors from the capture` : `class .${cls} is on no capture of the template — a prototype or invented class; take selectors from the capture`);
        if (top && !subject && CHAINED.has(role) && layout.has(cls)) push(`chains through .${cls}, a layout container — match the module itself; the walk recurses through wrappers (rule 4)`);
      }
    }
    for (const m of msgs) add('C1', where, `"${sel}": ${m}`);
  }
}

/** C2: dead markers. */
function checkC2(ctx, S, arch, add) {
  const { template } = ctx; const a = template.archetype;
  const archHits = S.hits(arch);
  S.markers.forEach((m, i) => {
    const w = `markers[${i}]`;
    let ev = m.evidence === undefined ? [] : m.evidence;
    if (!(Array.isArray(ev) && ev.every((s) => typeof s === 'string'))) { add('C2', `${w}.evidence`, 'an array of sibling slugs'); ev = []; }
    for (const s of ev) if (s === a || !template.pages.includes(s)) add('C2', `${w}.evidence`, `${s} is not a sibling of template ${template.id}`);
    if (archHits.get(m) > 0) return;
    const shadow = S.matches(arch).find((x) => x.marker !== m && ctx.dom.matches(x.node, m.sel, arch.prep.rootEl));
    const why = shadow ? ` (shadowed by markers[${S.markers.indexOf(shadow.marker)}] "${shadow.marker.sel}" wherever it matches)` : '';
    const siblings = ev.filter((s) => s !== a && template.pages.includes(s));
    if (!siblings.length) { add('C2', w, `"${m.sel}" is dead: no first-match hit on the archetype${why} and no evidence[] sibling — remove it, or name the siblings it was widened from`); return; }
    for (const s of siblings) {
      const cap = S.capture(s);
      if (!cap) add('C2', `${w}.evidence`, `evidence sibling ${s} has no capture`);
      else if (cap.prep.error) add('C2', `${w}.evidence`, `evidence sibling ${s}: ${cap.prep.error}`);
      else if (!(S.hits(cap).get(m) > 0)) add('C2', w, `"${m.sel}": no first-match hit on the archetype${why} and no hit on evidence sibling ${s}`);
    }
  });
}

/** C3 on the captures: `unique` markers, and modules two marker selectors match (the census half needs the encode). */
function checkC3(ctx, S, arch, siblings, add) {
  const rootEl = arch.prep.rootEl;
  S.markers.forEach((m, i) => {
    if (m.unique === undefined || m.unique === false) return;
    if (m.unique !== true) { add('C3', `markers[${i}].unique`, 'true or false'); return; }
    for (const cap of [arch, ...siblings]) {
      if (cap.prep.error) continue;
      const n = S.hits(cap).get(m);
      if (n > 1) add('C3', `markers[${i}]`, `"${m.sel}" is unique but has ${n} matches on ${cap.slug}`);
    }
  });
  const groups = new Map();
  for (const { node } of S.walkLevel(arch)) {
    const idx = S.markers.map((m, i) => (ctx.dom.matches(node, m.sel, rootEl) ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    const key = idx.join(' ');
    const g = groups.get(key) || { idx, n: 0, at: S.describe(node) };
    g.n += 1; groups.set(key, g);
  }
  for (const g of groups.values()) {
    const names = g.idx.map((i) => `markers[${i}] "${S.markers[i].sel}"`).join(' and ');
    add('C3', g.idx.map((i) => `markers[${i}]`).join(' '), `${names} ${g.idx.length > 2 ? 'all' : 'both'} match ${g.at}${g.n > 1 ? ` (${g.n}×)` : ''} — the array order decides silently; make the selectors disjoint (:not(…), :has(…))`);
  }
}

/** C3's other half: the encoded archetype's census — module-level nodes the walk reached with no marker. */
function checkCensus(ctx, rec, add) {
  const sectionTags = ctx.vocab.sectionTags || ['section'];
  for (const p of rec.prints || []) {
    if (!p.startsWith('UNMARKED | ')) continue;
    const [, shape, chain] = p.split(' | ');
    if (sectionTags.includes(shape.split('.')[0])) continue;
    add('C3', shape, `a module with no marker: ${shape}${chain ? ` inside ${chain}` : ''} — mark it (default-content, a block, drop:<reason>) so a sibling's change to it is seen`);
  }
}

/** C4: rows against the capture and against stardust/replica/units.json. */
function checkC4(ctx, S, arch, add, note) {
  const { dom, engine, template } = ctx; const a = template.archetype; const { rootEl } = arch.prep;
  const modules = new Map();
  for (const { node, marker } of S.matches(arch)) if (isBlock(marker) && !arch.skip.within(node)) { if (!modules.has(marker)) modules.set(marker, []); modules.get(marker).push(node); }
  for (const [m, mods] of modules) {
    if (m.rows === undefined) continue;
    const empty = mods.filter((mod) => !S.rowNodes(arch, mod, m).length);
    if (empty.length) add('C4', `markers[${S.markers.indexOf(m)}].rows`, `"${m.sel}": rows match no unit in ${empty.length} of its ${mods.length} module(s) (${S.describe(empty[0])})`);
  }
  const file = 'stardust/replica/units.json';
  const units = readJson(join(ctx.root, file));
  if (units.missing) { note('C4', `units.json skipped: no ${file} (rows were checked against the capture only)`); return; }
  if (units.error || !isObj(units.value)) { add('C4', file, `not a units.json (${units.error || 'an object of families'})`); return; }
  // unit-geometry's rule: a family applies to a page it lists or to the page's template
  const families = Object.keys(units.value).sort(byCodePoint).filter((k) => {
    const f = units.value[k];
    return isObj(f) && ((Array.isArray(f.pages) && f.pages.includes(a)) || (Array.isArray(f.templates) && f.templates.includes(template.id)));
  });
  if (!families.length) { note('C4', `${file} declares no family for ${a} or template ${template.id}`); return; }
  for (const name of families) {
    const f = units.value[name];
    if (typeof f.origin !== 'string' || !f.origin.trim()) { note('C4', `family "${name}" has no origin selector`); continue; }
    let origin;
    try { origin = dom.qsa(arch.prep.doc, f.origin); } catch (e) { note('C4', `family "${name}": origin "${f.origin}" cannot be evaluated offline (${e.message})`); continue; }
    if (!origin.length) { note('C4', `family "${name}": origin "${f.origin}" selects nothing on the capture — not adopted (the capture wins)`); continue; }
    // each unit's block module: its nearest ancestor-or-self whose first marker emits a block
    const byMarker = new Map(); let loose = 0;
    for (const u of origin) {
      let mod = null;
      for (let p = u; p && dom.isEl(p); p = p.parent) {
        const m = engine.firstMarker(p, S.markers, rootEl);
        if (m && isBlock(m)) { mod = { node: p, m }; break; }
        if (p === rootEl) break;
      }
      if (!mod) { loose += 1; continue; }
      if (!byMarker.has(mod.m)) byMarker.set(mod.m, { mods: new Set(), units: new Set() });
      byMarker.get(mod.m).mods.add(mod.node); byMarker.get(mod.m).units.add(u);
    }
    if (loose) add('C4', `units.json "${name}"`, `${loose} of the family's ${origin.length} units (origin "${f.origin}") sit in no block module — the map renders them as default content`);
    for (const [m, e] of byMarker) {
      const rows = new Set([...e.mods].flatMap((mod) => S.rowNodes(arch, mod, m)));
      const shared = [...rows].filter((r) => e.units.has(r)).length;
      if (shared === rows.size && shared === e.units.size) continue;
      add('C4', `markers[${S.markers.indexOf(m)}].rows`, `${m.rows === undefined ? `"${m.sel}" has no rows (each module is one row); ` : ''}rows select ${rows.size} node(s) where units.json family "${name}" origin "${f.origin}" selects ${e.units.size} (${shared} shared) — rows come from the capture; adopt the origin only when it selects the same nodes`);
    }
  }
}

/** A delivered document reduced to what C5 compares: sections, block names with their variants as one cell, section-metadata. */
function projection(dom, html) {
  const doc = dom.parseHTML(String(html));
  const main = dom.qs(doc, 'main') || dom.qs(doc, 'body') || doc;
  const out = ['<main>'];
  for (const sec of dom.kids(main)) {
    out.push('<div>');
    for (const c of dom.kids(sec)) {
      const cls = String(dom.attr(c, 'class') || '').split(/\s+/).filter(Boolean);
      if (c.tag !== 'div' || !cls.length) continue;
      if (cls[0] === 'metadata' || cls[0] === 'section-metadata') out.push(dom.serialize(c));
      else out.push(`<div class="${cls[0]}"><div><div>${dom.esc(cls.slice(1).sort(byCodePoint).join(' '))}</div></div></div>`);
    }
    out.push('</div>');
  }
  out.push('</main>');
  return out.join('\n');
}

/** C5: predicted variants and section styles against the gated archetype document. */
async function checkC5(ctx, html, gatedFile, add) {
  const { compareDocs } = await import('./compare.mjs');
  const cmp = compareDocs(projection(ctx.dom, readFileSync(join(ctx.root, gatedFile), 'utf8')), projection(ctx.dom, html), { level: 'core' });
  for (const d of cmp.diffs) {
    const block = / block:\S+ r0c0$/.test(d.where);
    if (d.kind === 'section-style') add('C5', d.where, `section style: the gated document has ${q(d.expected)}, the map predicts ${q(d.got)}`);
    else if (d.kind === 'text' && block) add('C5', d.where.replace(/ r0c0$/, ''), `the gated document has variants ${q(d.expected)}, the map predicts ${q(d.got)}`);
    else if (d.kind !== 'text-missing' && d.kind !== 'text-extra') add('C5', d.where, `the blocks or sections differ from the gated document (${d.kind}: ${q(d.expected)} → ${q(d.got)}) — variants and styles cannot be aligned; see --roundtrip`);
  }
}

/** C6: each block's text items in the role and order of the eds-schema section they align with. */
function checkC6(ctx, S, html, schema, norm, add, note) {
  const { dom } = ctx;
  const sections = schema.sections.map((s, si) => ({
    name: String((s && s.section) ?? `#${si}`),
    items: (s && Array.isArray(s.items) ? s.items : []).map((x, k) => (x && Object.hasOwn(ROLE, x.role) && typeof x.text === 'string' ? { role: ROLE[x.role], order: Number.isFinite(x.order) ? x.order : k, key: norm(x.text) } : null)).filter((x) => x && x.key),
  }));
  // content-inventory's in-page classification, offline: a text link is a cta; an element's own text is a heading or body
  const itemsOf = (blk) => {
    const out = [];
    const visit = (el) => {
      for (const c of dom.kids(el)) {
        if (c.tag === 'a') { const t = clean(dom.decodeEntities(dom.textOf(c))); if (!dom.qs(c, 'img, picture') && norm(t)) out.push({ role: 'cta', key: norm(t), text: t }); continue; }
        const own = clean(dom.decodeEntities(c.children.filter((x) => x.type === 'text').map((x) => x.text).join(' ')));
        if (norm(own)) out.push({ role: /^h[1-6]$/.test(c.tag) ? 'heading' : 'body', key: norm(own), text: own });
        visit(c);
      }
    };
    visit(blk);
    return out;
  };
  const main = dom.qs(dom.parseHTML(html), 'main');
  for (const sec of main ? dom.kids(main) : []) {
    for (const blk of dom.kids(sec)) {
      const cls = S.classList(blk);
      if (blk.tag !== 'div' || !cls.length || cls[0] === 'metadata' || cls[0] === 'section-metadata') continue;
      const items = itemsOf(blk);
      if (!items.length) continue;
      let best = null; let score = 0;
      for (const s of sections) { const keys = new Set(s.items.map((x) => x.key)); const n = items.filter((x) => keys.has(x.key)).length; if (n > score) { best = s; score = n; } }
      if (!best) { note('C6', `block ${cls[0]}: no eds-schema section shares its text — not checked`); continue; }
      const used = new Set(); const pairs = []; let last = -Infinity;
      for (const it of items) {
        const cands = best.items.filter((x) => !used.has(x) && x.key === it.key);
        if (!cands.length) continue;
        const pick = cands.find((x) => x.order > last) || cands[0];
        used.add(pick); pairs.push([it, pick]); last = Math.max(last, pick.order);
      }
      for (const [it, x] of pairs) if (it.role !== x.role) add('C6', `block ${cls[0]}`, `"${it.text}" is ${ROLE_NAME[it.role]} in the block, ${ROLE_NAME[x.role]} in the eds-schema section "${best.name}" — render it in the schema's role (cell mode, wrap)`);
      const inversions = pairs.map((p, k) => k > 0 && p[1].order < pairs[k - 1][1].order).filter(Boolean).length;
      const k = pairs.findIndex((p, j) => j > 0 && p[1].order < pairs[j - 1][1].order);
      if (k > 0) add('C6', `block ${cls[0]}`, `"${pairs[k - 1][0].text}" (${pairs[k - 1][0].role}) comes before "${pairs[k][0].text}" (${pairs[k][0].role}) in the block; the eds-schema section "${best.name}" orders them the other way${inversions > 1 ? ` (${inversions} inversions)` : ''} — reorder the cells`);
    }
  }
}

// ===================================================================================== --lint
const mapErrorsOf = (ctx) => ctx.mapErrors ?? [...ctx.engine.validateVocabulary(ctx.vocab).map((e) => `vocabulary.json: ${e}`), ...ctx.engine.validateTransform(ctx.tf || {}).map((e) => `transform.json: ${e}`)];

/** The archetype's stop, one finding per reason (as encode.mjs prints a stopped page). */
function stopFindings(rec, add) {
  const r = rec.report || {};
  for (const e of r.errors || []) add('archetype', 'error', e);
  for (const u of r.unmapped || []) add('archetype', 'unmapped', `${u.kind} at ${u.at} — ${u.remedy || 'map it, or drop:<reason>'}`);
  for (const f of r.flattened || []) add('archetype', 'flattened', `${f.kind} at ${f.at}: ${(f.why || []).join('; ')}`);
  for (const m of r.incomplete || []) add('archetype', 'incomplete', `MISSING ${m.role} "${String(m.text || m.key).slice(0, 80)}" — the map loses content on its own archetype`);
}

export async function runLint(ctx) {
  const { template, vocab } = ctx; const a = template.archetype;
  const findings = []; const notes = [];
  const add = (check, where, message) => findings.push({ check, where, message });
  const note = (check, message) => notes.push({ check, message });
  const current = currentInputs(ctx);
  const finish = () => {
    const order = (c) => CHECKS.indexOf(c);
    findings.sort((x, y) => order(x.check) - order(y.check));
    notes.sort((x, y) => order(x.check) - order(y.check));
    if (ctx.json) ctx.out(JSON.stringify({ template: template.id, archetype: a, findings, notes, inputs: current }));
    else {
      for (const f of findings) ctx.out(`✗ ${f.check} ${f.where}: ${f.message}`);
      for (const n of notes) ctx.out(`· ${n.check}: ${n.message}`);
    }
    ctx.out(`lint ${a}: ${plural(findings.length, 'finding')} · ${plural(notes.length, 'note')}`);
    return findings.length ? 1 : 0;
  };

  // map: the engine's validators; nothing else runs on an invalid map
  const mapErrors = mapErrorsOf(ctx);
  for (const e of mapErrors) { const i = e.indexOf(': '); add('map', i > 0 ? e.slice(0, i) : 'map', i > 0 ? e.slice(i + 2) : e); }
  if (vocab.archetype === undefined) add('map', 'archetype', `name the template's archetype: "archetype": "${a}"`);
  else if (vocab.archetype !== a) add('map', 'archetype', `the map names "${vocab.archetype}"; the archetype of template ${template.id} is "${a}"`);
  if (mapErrors.length) { note('map', 'the other checks are skipped: the map is invalid'); return finish(); }
  checkInputs(ctx, current, add, note);

  const S = setup(ctx);
  const arch = S.capture(a);
  const siblings = template.pages.filter((s) => s !== a).map((s) => S.capture(s)).filter(Boolean);
  const edsFile = INPUT_PATHS(a).edsSchema;
  const eds = readJson(join(ctx.root, edsFile));
  const edsOk = !eds.missing && !eds.error && isObj(eds.value) && Array.isArray(eds.value.sections);
  const unitSelectors = new Map();
  for (const s of edsOk ? eds.value.sections : []) for (const r of (s && Array.isArray(s.repeats) ? s.repeats : [])) { const m = /^[a-z0-9-]*\.([\w-]+)$/i.exec(String(r && r.unitSelector)); if (m) unitSelectors.set(m[1], r.unitSelector); }
  if (!arch || arch.prep.error) {
    add('archetype', arch ? 'root' : INPUT_PATHS(a).capture, arch ? arch.prep.error : 'no capture — run extract; every selector comes from it');
    if (arch) checkC1(ctx, S, [arch, ...siblings], unitSelectors, add); // C1 reads the capture's text only
    note('archetype', `${arch ? 'C2' : 'C1'}–C6 are skipped: no usable archetype capture`);
    return finish();
  }

  try {
    checkC1(ctx, S, [arch, ...siblings], unitSelectors, add);
    checkC2(ctx, S, arch, add);
    checkC3(ctx, S, arch, siblings.filter((c) => !c.prep.error), add);
    checkC4(ctx, S, arch, add, note);
  } catch (e) {
    add('archetype', 'selectors', `a selector cannot be evaluated on the capture: ${e.message}`);
  }

  // the archetype encoded in memory (unsanitised: C5 and C6 read text, not bytes) — the census, C5 and C6 read it
  let enc = null;
  try {
    const deps = await ctx.loadEncoderDeps();
    const { archetype: rec } = await ctx.encodeTemplate({ root: ctx.root, site: ctx.site, template, map: { vocab, tf: ctx.tf || {} }, deps: { ...deps, finalise: null }, slugs: [a] });
    enc = { rec, deps };
    if (rec.status !== 'clean') stopFindings(rec, add);
  } catch (e) {
    add('archetype', 'encode', e.message);
  }
  if (!enc || !enc.rec.html) { note('C3', 'unmarked modules, C5 and C6 are skipped: the archetype does not encode'); return finish(); }
  checkCensus(ctx, enc.rec, add);

  const gated = ctx.site.contentFileFor(a);
  if (!gated) note('C5', `skipped: no gated document ${ctx.site.contentPathFor(a) || 'content/<path>.html'}`);
  else await checkC5(ctx, enc.rec.html, gated, add);

  if (eds.missing) note('C6', `skipped: no ${edsFile}`);
  else if (!edsOk) add('C6', edsFile, `not an eds-schema (${eds.error || 'sections[] of { section, items[] }'})`);
  else if (typeof enc.deps.inventory.norm !== 'function') note('C6', 'skipped: deploy/content-inventory.mjs exports no norm — update the project copy of the deploy scripts');
  else checkC6(ctx, S, enc.rec.html, eds.value, enc.deps.inventory.norm, add, note);
  return finish();
}

// ===================================================================================== --sweep
export async function runSweep(ctx) {
  const { template, vocab } = ctx; const a = template.archetype;
  const mapErrors = mapErrorsOf(ctx);
  if (mapErrors.length) { for (const e of mapErrors) ctx.err(`encode --sweep: ${e}`); ctx.err('encode --sweep: the map is invalid — run --lint'); return 1; }
  const S = setup(ctx);
  const arch = S.capture(a);
  if (!arch || arch.prep.error) { ctx.err(`encode --sweep: archetype ${a}: ${arch ? arch.prep.error : `no capture ${INPUT_PATHS(a).capture}`}`); return 1; }
  // a kind is the census's shape: tag + sorted class tokens (a class-less <div>, <iframe>, <form> … is `div.`, `iframe.` …)
  const kindOf = (n) => `${n.tag}.${[...S.tokens(n)].sort(byCodePoint).join('.')}`;
  const selClasses = (m) => [m.sel, ...(Array.isArray(m.variants) ? m.variants.map((v) => v && v.when) : [])].filter((s) => typeof s === 'string').flatMap((s) => compounds(ctx.dom, s).flatMap(({ c }) => c.classes));
  const archUnmarked = new Set(S.unmarked(arch).map(kindOf));
  const known = new Map(S.markers.map((m) => [m, new Set(selClasses(m))]));
  for (const { node, marker } of S.matches(arch)) for (const t of S.tokens(node)) known.get(marker).add(t);
  const hits = S.hits(arch);
  const newKinds = []; const unknownModifiers = []; const notes = []; let swept = 0;
  for (const slug of template.pages.filter((s) => s !== a)) {
    const cap = S.capture(slug);
    if (!cap) { notes.push(`${slug}: no capture ${INPUT_PATHS(slug).capture} — skipped`); continue; }
    if (cap.prep.error) { notes.push(`${slug}: ${cap.prep.error} — the encoder stops it (error); skipped`); continue; }
    swept += 1;
    const kinds = new Map();
    for (const node of S.unmarked(cap)) {
      const k = kindOf(node);
      if (archUnmarked.has(k)) continue;
      const e = kinds.get(k) || { count: 0, visible: false };
      e.count += 1; e.visible = e.visible || ctx.engine.isVisible(node); kinds.set(k, e);
    }
    for (const k of [...kinds.keys()].sort(byCodePoint)) newKinds.push({ slug, kind: k, ...kinds.get(k) });
    const mods = new Map();
    for (const { node, marker } of S.matches(cap)) {
      hits.set(marker, hits.get(marker) + 1);
      const i = S.markers.indexOf(marker);
      for (const t of S.tokens(node)) if (!known.get(marker).has(t)) mods.set(`${String(i).padStart(6, '0')} ${t}`, { slug, marker: i, sel: marker.sel, class: t });
    }
    for (const k of [...mods.keys()].sort(byCodePoint)) unknownModifiers.push(mods.get(k));
  }
  const zeroHit = S.markers.map((m, i) => ({ marker: i, sel: m.sel, kind: m.kind || m.sel })).filter((z) => !hits.get(S.markers[z.marker]));
  if (ctx.json) ctx.out(JSON.stringify({ template: template.id, archetype: a, siblings: swept, newKinds, unknownModifiers, zeroHit, notes }));
  else {
    for (const k of newKinds) ctx.out(`✗ new kind ${k.slug}: ${k.kind} ×${k.count}${k.visible ? '' : ' (no visible text)'} — not on the archetype; mark it (default-content, a block, drop:<reason>)`);
    for (const u of unknownModifiers) ctx.out(`✗ modifier ${u.slug}: .${u.class} on markers[${u.marker}] "${u.sel}" — not on the archetype; add a variant (when/add) or list it in ignoreModifiers`);
    for (const z of zeroHit) ctx.out(`✗ zero-hit markers[${z.marker}] "${z.sel}" (${z.kind}) — no match on any capture of the template`);
    for (const n of notes) ctx.out(`· ${n}`);
  }
  ctx.out(`sweep ${a}: ${plural(swept, 'sibling')} · new kinds ${newKinds.length} · unknown modifiers ${unknownModifiers.length} · zero-hit markers ${zeroHit.length}`);
  return newKinds.length + unknownModifiers.length + zeroHit.length ? 2 : 0;
}
