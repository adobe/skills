// evals/golden/fixed-clock.cjs — a frozen wall clock for the golden run. Preloaded into every chain
// script with `node --require fixed-clock.cjs`: `new Date()` with no arguments and `Date.now()` return
// GOLDEN_NOW (set by run.mjs from --now), so migratedAt / writtenAt / generatedAt / built_at and every
// hash computed over them (rollout's sourceHash over the migrated HTML) are the same on every run.
// Explicit dates (`new Date('2026-…')`, `Date.UTC`, parsing) are untouched. CommonJS so it preloads
// before an ES-module entry point on every supported Node.
'use strict';
const fixed = Date.parse(process.env.GOLDEN_NOW || '2026-01-01T00:00:00.000Z');
if (Number.isNaN(fixed)) throw new Error(`fixed-clock: GOLDEN_NOW is not a date: ${process.env.GOLDEN_NOW}`);
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
  static now() { return fixed; }
}
globalThis.Date = FixedDate;
