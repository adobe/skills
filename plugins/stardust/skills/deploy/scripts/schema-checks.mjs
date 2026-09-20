/**
 * skills/deploy/scripts/schema-checks.mjs — the pure half of two qa-gate.mjs / section-schema.mjs checks.
 * No browser, no deps: section-schema.mjs measures the facts in the page, qa-gate.mjs judges them here,
 * and one node test pins both judgements (scripts/test/schema-checks.test.mjs).
 *
 *   flagGenericWithStructure(schema)  (T28.4 — deploy Step 2b; audit-and-naming.md § 2b)
 *     Sections triaged to default content (`defaultContent: true`, or the object form
 *     `{ reason, dynamicsRow }`) whose measured `structure` carries interactive descendants or ≥ 2
 *     columns: prose cannot carry a tab strip, a form or a side-by-side layout — the section needs a
 *     block or a `dynamics` row. Returns [{ section, facts, interactive, columns, reason, dynamicsRow }].
 *     With `reason` (or `dynamicsRow`) recorded on the section the flag is a warning; without it a FAIL.
 *     Hands-off never writes the reason (it resolves by converting a block within the cap).
 *
 *   h1SectionVerdict({ schemaIndex, pageIndex, autoBlocks })  (T21.2 — leisure-airline F19 b)
 *     The authored <h1> must still sit in its authored section after the runtime ran
 *     `buildAutoBlocks()`. schemaIndex = the schema section (chrome excluded) that holds the h1,
 *     pageIndex = the rendered `main .section` that holds it. Equal → ok. Different with a non-empty
 *     `runtime-contract.json#autoBlocks` → FAIL naming the builder rows (an auto-block moved it);
 *     different with none → WARN (something else moved it — verify by eye); unknown on either side →
 *     null (nothing to judge; qa-gate's own `exactly one <h1>` check covers the count).
 *
 *   repeatUnitGroups(root, { skip, atoms })  (T28.2 — the ONE repeat-unit grouping rule)
 *     Runs IN the page: section-schema.mjs mapSections and replica's layout-cluster / variant-census
 *     collectors call it through `inPageCall(fn, args, { repeatUnitGroups })`, so the rule lives in this
 *     browser-free module and never diverges. Body free of module-scope identifiers by contract
 *     (schema-checks.test.mjs runs it over a plain-object DOM).
 *
 *   parseQaGateArgs(argv)  — qa-gate.mjs's argument table: the URL is the first positional that is not a
 *     flag's value (`--schema x.json <url>` no longer reads x.json as the URL); value flags refuse a following
 *     `--flag`; unknown flags are a usage error.
 */

export const INTERACTIVE_SELECTORS = ['button', 'input', 'select', 'textarea', 'form', 'details', '[role=tab]', '[role=tablist]', '[role=tabpanel]', '[aria-expanded]', '[aria-controls]', '[data-reactroot]', '[data-v-app]', '[ng-app]', '[data-widget]'];
export const MUSTACHE_MARKER = 'text {{…}}';

/** true when the section's structure facts say "this is not prose". */
export function hasStructure(structure) {
  if (!structure) return false;
  const interactive = Array.isArray(structure.interactive) ? structure.interactive : [];
  const columns = Number(structure.columns) || 0;
  return interactive.length > 0 || columns >= 2;
}

/** `defaultContent: true` | `{ reason?, dynamicsRow? }` → { flagged, reason, dynamicsRow } — anything else is not default content. */
export function defaultContentOf(section) {
  const d = section && section.defaultContent;
  if (d === true) return { flagged: true, reason: null, dynamicsRow: null };
  if (d && typeof d === 'object') return { flagged: true, reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : null, dynamicsRow: typeof d.dynamicsRow === 'string' && d.dynamicsRow.trim() ? d.dynamicsRow.trim() : null };
  return { flagged: false, reason: null, dynamicsRow: null };
}

export const structureFactsText = (structure) => `interactive=[${(structure.interactive || []).join(' ')}] columns=${Number(structure.columns) || 0}`;

export function flagGenericWithStructure(schema) {
  const out = [];
  for (const s of (schema && Array.isArray(schema.sections) ? schema.sections : [])) {
    const dc = defaultContentOf(s);
    if (!dc.flagged || !hasStructure(s.structure)) continue;
    out.push({ section: s.section, facts: structureFactsText(s.structure), interactive: [...(s.structure.interactive || [])], columns: Number(s.structure.columns) || 0, reason: dc.reason, dynamicsRow: dc.dynamicsRow });
  }
  return out;
}

export function h1SectionVerdict({ schemaIndex, pageIndex, autoBlocks = [] } = {}) {
  const known = (v) => Number.isInteger(v) && v >= 0;
  if (!known(schemaIndex) || !known(pageIndex)) return null;
  if (schemaIndex === pageIndex) return { level: 'ok', message: `h1 in its authored section (#${schemaIndex + 1})` };
  const rows = Array.isArray(autoBlocks) ? autoBlocks.filter((r) => r && r.fn) : [];
  const where = `h1 left its authored section: schema section #${schemaIndex + 1} → page section #${pageIndex + 1}`;
  if (rows.length) return { level: 'fail', message: `${where} — an auto-block moved it (runtime-contract.json#autoBlocks: ${rows.map((r) => `${r.fn}${r.trigger ? ` ← ${r.trigger}` : ''}`).join(', ')}); guard the builder so h1 and picture share one section (target-runtime.md § Auto-blocking hook)` };
  return { level: 'warn', message: `${where} — no auto-block is recorded (runtime-contract.json#autoBlocks empty or absent); verify by eye` };
}

/* eslint-disable no-undef */
/**
 * IN-PAGE. Outermost containers whose direct children hold ≥ 2 same tag + first-class siblings carrying content
 * (a heading, a text CTA, an image or a text run) form one repeat-unit group; a reported unit's inner lists are
 * part of the unit, never a second group. `skip` = container tags never scanned (SCRIPT, STYLE, …); `atoms` =
 * child tags never grouped (LI stays groupable). Returns [{ unitSelector, tag, count, unit, uniform, depth,
 * members }] — `members` are elements (strip them before crossing the evaluate boundary).
 */
export function repeatUnitGroups(root, opts) {
  const skip = (opts && opts.skip) || [];
  const atoms = (opts && opts.atoms) || [];
  const compose = (el) => ({
    headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    ctas: [...el.querySelectorAll('a')].filter((a) => (a.textContent || '').trim() && !a.querySelector('img,picture')).length,
    imgs: el.querySelectorAll('img,picture').length,
    textRuns: [...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length,
  });
  const sig = (u) => `${u.headings}|${u.ctas}|${u.imgs}|${u.textRuns}`;
  const reported = [];
  const groups = [];
  for (const c of [root, ...root.querySelectorAll('*')]) {
    if (skip.includes(c.tagName) || reported.some((r) => r !== c && r.contains(c))) continue;
    const byKey = {};
    for (const k of c.children) {
      if (atoms.includes(k.tagName)) continue;
      const key = `${k.tagName}.${String(k.className || '').trim().split(/\s+/)[0] || ''}`;
      (byKey[key] ||= []).push(k);
    }
    for (const [key, members] of Object.entries(byKey)) {
      if (members.length < 2) continue;
      const units = members.map(compose);
      if (!units.some((u) => u.headings || u.ctas || u.imgs || u.textRuns)) continue;
      let depth = 0;
      for (let e = c; e && e !== root; e = e.parentElement) depth += 1;
      groups.push({ unitSelector: key, tag: members[0].tagName, count: members.length, unit: units[0], uniform: units.every((u) => sig(u) === sig(units[0])), depth, members });
      reported.push(...members);
    }
  }
  return groups;
}
/* eslint-enable no-undef */

/**
 * Source of `fn(args)` with `helpers` (name → in-page function) defined in scope. Pass the string to
 * page.evaluate: it runs as ONE expression through the driver, so no page-side eval and a strict prototype CSP
 * is irrelevant. `args` must be JSON.
 */
export function inPageCall(fn, args, helpers = {}) {
  const defs = Object.entries(helpers).map(([n, f]) => `const ${n} = ${f.toString()};`).join('\n');
  return `((__args) => { ${defs}\nreturn (${fn.toString()})(__args); })(${JSON.stringify(args === undefined ? null : args)})`;
}

const QA_GATE_VALUE_FLAGS = { schema: 'schema', maxw: 'maxw', 'full-bleed': 'fullBleed', marker: 'marker' };
const QA_GATE_BOOL_FLAGS = { 'no-drive': 'noDrive' }; // switches: never consume the next argument

/** qa-gate.mjs argv (after the script) → { url, schema, maxw, fullBleed, marker, noDrive, error }. */
export function parseQaGateArgs(argv) {
  const out = { url: null, schema: null, maxw: 1340, fullBleed: [], marker: null, noDrive: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (name in QA_GATE_BOOL_FLAGS) { out[QA_GATE_BOOL_FLAGS[name]] = true; continue; }
      if (!(name in QA_GATE_VALUE_FLAGS)) { out.error = `unknown flag ${a}`; return out; }
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { out.error = `${a} needs a value`; return out; }
      i += 1;
      if (name === 'maxw') { out.maxw = Number(v); if (!Number.isFinite(out.maxw) || out.maxw <= 0) { out.error = '--maxw needs a positive number of px'; return out; } }
      else if (name === 'full-bleed') out.fullBleed = v.split(',').map((s) => s.trim()).filter(Boolean);
      else out[QA_GATE_VALUE_FLAGS[name]] = v;
    } else if (out.url === null) out.url = a;
    else { out.error = `unexpected argument ${a} (one harness URL)`; return out; }
  }
  return out;
}
