'use strict';

/**
 * plan.js — auto-scopes an validate-migration run by diffing the current branch against
 * `main`, classifying each changed file into a supported pattern, and
 * grouping the hits by Maven module (nearest ancestor dir with a pom.xml).
 *
 * This is what lets `validate-migration-check` run with no pattern argument: "run validate-migration on
 * this branch" instead of "run validate-migration on the scheduler pattern in this dir".
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Patterns auto-detected from the branch diff, keyed by a content/path signal cheap
// enough to run on a raw diff (check.js's own `discover()` needs a *built*
// artifact, which isn't available yet at planning time). `cdw` is explicit-only:
// its dialog paths are indistinguishable from legacy-ui here.
// Order matters: RULES.find takes the FIRST match, so the broad DAM API marker
// comes after the specific runtime patterns.
const RULES = [
  { pattern: 'scheduler', test: (file, text) => /\.java$/.test(file) && /scheduler\.expression|scheduler\.runOn/.test(text) },
  { pattern: 'resource-change-listener', test: (file, text) => /\.java$/.test(file) && /ResourceChangeListener|resource\.change\.types/.test(text) },
  { pattern: 'event-migration', test: (file, text) => /\.java$/.test(file) && /job\.topics|JobConsumer|EventHandler/.test(text) },
  { pattern: 'replication', test: (file, text) => /\.java$/.test(file) && /org\.apache\.sling\.distribution|com\.day\.cq\.replication/.test(text) },
  { pattern: 'asset-manager', test: (file, text) => /\.java$/.test(file) && /com\.day\.cq\.dam\.api\./.test(text) },
  { pattern: 'legacy-ui', test: (file) => /(?:^|\/)(?:_cq_dialog|cq:dialog|_cq_design_dialog|design_dialog|dialog)(?:\/\.content\.xml|\.xml)$/.test(file) },
  { pattern: 'custom-templates', test: (file) => /(?:^|\/)conf\/[^/]+\/settings\/wcm\/templates\/[^/]+\/(?:\.content\.xml|(?:structure|initial|policies)\/.*\.content\.xml)$/.test(file) },
];

// Patterns verified from the built package without a deployed bundle.
const SOURCE_ONLY_PATTERNS = new Set(['legacy-ui', 'custom-templates']);

function resolveBaseRef(cwd) {
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], { cwd, stdio: 'ignore' });
      return ref;
    } catch { /* try next */ }
  }
  return null;
}

function changedFiles(cwd, baseRef) {
  // Union of everything that differs from baseRef in the working tree:
  //   • committed vs baseRef merge-base (baseRef...HEAD)
  //   • staged (index vs HEAD)
  //   • unstaged (working tree vs HEAD)
  //   • untracked (respects .gitignore)
  // The migration skill often edits files without committing, so committed-only
  // scoping would report "nothing to verify" right after a migration.
  const runs = [
    ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`],
    ['diff', '--name-only', '--diff-filter=ACMR', '--cached', 'HEAD'],
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  const set = new Set();
  for (const argv of runs) {
    let out;
    try { out = execFileSync('git', argv, { cwd, encoding: 'utf8' }); }
    catch { continue; }
    for (const line of out.split('\n')) {
      const f = line.trim();
      if (f) set.add(f);
    }
  }
  return [...set];
}

// Walks up from a changed file's directory to find the nearest pom.xml —
// that's the Maven module validate-migration check needs to build for this task.
function findModule(cwd, file) {
  let dir = path.dirname(path.join(cwd, file));
  const root = path.parse(cwd).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, 'pom.xml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * @param {{cwd: string, baseRef?: string}} opts
 * @returns {{ tasks: Array<{module: string, pattern: string, files: string[]}>, needsSdk: boolean, baseRef: string|null }}
 */
function computeValidationPlan({ cwd, baseRef }) {
  const resolvedBase = baseRef || resolveBaseRef(cwd);
  if (!resolvedBase) {
    return { tasks: [], needsSdk: false, baseRef: null, error: 'no main/origin-main ref found to diff against' };
  }

  const files = changedFiles(cwd, resolvedBase);
  const byModuleAndPattern = new Map(); // "moduleDir::pattern" -> { module, pattern, files: [] }

  for (const file of files) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) continue; // deleted files can't be classified by content
    const text = /\.java$/.test(file) ? safeRead(abs) : '';
    const hit = RULES.find((r) => r.test(file, text));
    if (!hit) continue;

    const module = findModule(cwd, file) || cwd;
    const key = `${module}::${hit.pattern}`;
    if (!byModuleAndPattern.has(key)) byModuleAndPattern.set(key, { module, pattern: hit.pattern, files: [] });
    byModuleAndPattern.get(key).files.push(file);
  }

  const tasks = [...byModuleAndPattern.values()];
  const needsSdk = tasks.some((t) => !SOURCE_ONLY_PATTERNS.has(t.pattern));
  return { tasks, needsSdk, baseRef: resolvedBase };
}

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

module.exports = { computeValidationPlan, changedFiles, RULES, SOURCE_ONLY_PATTERNS };
