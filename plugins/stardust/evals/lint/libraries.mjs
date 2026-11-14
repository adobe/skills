// Pure libraries under skills/*/scripts/: exported functions, no CLI. Shared by script-help.mjs
// (a library is not asked for --help) and scripts-index.mjs (a library has no index row: the
// index lists what an agent runs, and an agent never runs a library).
//
// <skill>/scripts/<file> → one-line reason. A file belongs here only when it exports functions
// and has no argv handling of its own; a script that grows a CLI leaves this list and gets an
// index row.
export const LIBRARIES = {
  'deploy/scripts/content-inventory.mjs': 'library: role-classified inventory + diff, imported by block-roundtrip and section-schema; no CLI',
  'deploy/scripts/css-as-text.mjs': 'library: is this authored text CSS? (D15 / #134), imported by davids-model-lint and ew-editability-probe; no CLI',
  'deploy/scripts/eds-path.mjs': 'library: the delivered-path contract (deliveredUrl, daPath, pathKey) imported by spec, rollout and deploy; no CLI',
  'deploy/scripts/file-lock.mjs': 'library: cross-process lock + atomic merge for the shared deploy ledgers; no CLI',
  'deploy/scripts/diff-profiles.mjs': 'library: stack profiles (eds|generic) for the inventory classifiers; no CLI',
  'diff/scripts/content-inventory.mjs': 'library: the diff skill\'s copy of the inventory classifier, imported by content-diff; no CLI',
  'diff/scripts/image-signature.mjs': 'library: icon pixel signatures, imported by content-diff and chrome-parity; no CLI',
  'diff/scripts/diff-profiles.mjs': 'library: the diff skill\'s copy of the stack profiles, imported by content-diff and visual-diff; no CLI',
  'diff/scripts/measure-live.mjs': 'library: settle + rect/type measurement shared by clip-probe, content-presence, unit-geometry; no CLI',
  'dynamics/scripts/lib.mjs': 'library: shared arg/io/playwright helpers for the dynamics instruments; no CLI',
  'dynamics/scripts/martech.mjs': 'library: martech contract + hand-off for dynamics-plan --martech; no CLI',
  'qa/scripts/lib.mjs': 'library: shared helpers for qa.mjs and its checks; no CLI',
  'rollout/scripts/lib.mjs': 'library: shared IO + roll-up helpers for the rollout scripts; no CLI',
  'spec/scripts/lib.mjs': 'library: shared args, config, HTML tree reader and pool for the spec stages; no CLI',
  'spec/scripts/rules.mjs': 'library: the rule format spec-knowledge evaluates for reach, impact and findings; no CLI',
  'stardust/scripts/browser.mjs': 'library: the one entry to the browser for every script; no CLI',
  'stardust/scripts/live-session.mjs': 'library: the live-site rules behind browser.mjs; no CLI',
};
