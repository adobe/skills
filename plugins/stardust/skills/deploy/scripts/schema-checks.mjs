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
 *   h1SectionVerdict({ schemaIndex, pageIndex, autoBlocks })  (T21.2 — jet2 F19 b)
 *     The authored <h1> must still sit in its authored section after the runtime ran
 *     `buildAutoBlocks()`. schemaIndex = the schema section (chrome excluded) that holds the h1,
 *     pageIndex = the rendered `main .section` that holds it. Equal → ok. Different with a non-empty
 *     `runtime-contract.json#autoBlocks` → FAIL naming the builder rows (an auto-block moved it);
 *     different with none → WARN (something else moved it — verify by eye); unknown on either side →
 *     null (nothing to judge; qa-gate's own `exactly one <h1>` check covers the count).
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
