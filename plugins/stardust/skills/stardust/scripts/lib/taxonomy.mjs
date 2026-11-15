/**
 * skills/stardust/scripts/lib/taxonomy.mjs — the dynamics triage vocabulary and the one copy of its class labels.
 * Pure library: no I/O, nothing runs on import. Reached through ../contracts.mjs (README.md § Layout).
 *
 * Owns (and replaces): dynamics lib.mjs TAXONOMY (re-exported there), the CLASS_NAMES literals of dynamics-detect.mjs and
 * spec-knowledge.mjs — two copies that had drifted (A: "API / settings", D: "data file" in spec); the dynamics labels are
 * the reference (dynamics/reference/classes-and-signals.md). Every writer of feature rows checks against TAXONOMY.
 */

/** The triage vocabulary (dynamics reference/triage.md, classes-and-signals.md). */
export const TAXONOMY = {
  class: ['L', 'S', 'F', 'M', 'V', 'T', 'A', 'R', 'X', 'I18N', 'CR', 'D'],
  disposition: ['rebuild-native', 'index-backed', 'data-fed', 'embed-passthrough', 'client-only', 'static-snapshot', 'decided-out'],
  reproducibility: ['self', 'needs-credential', 'needs-human-capture', 'needs-backend', 'needs-business-decision'],
  status: ['pending', 'in-progress', 'interim', 'done', 'scaffolded-awaiting-owner', 'delivered-by-capture', 'decided-out', 'skipped-source-broken'],
};

/** Human label per class letter — the report columns of dynamics-detect and spec-knowledge. */
export const CLASS_NAMES = {
  L: 'listing', S: 'search', F: 'form', M: 'modal / interactive', V: 'media', T: 'tag / consent', A: 'API / personalisation / settings',
  R: 'relationship', X: 'auth / commerce', I18N: 'locale', CR: 'client-rendered', D: 'sheet / data file',
};
