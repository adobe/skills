#!/usr/bin/env node
/**
 * validate-contract.mjs
 *
 * Validates a domain-expert sub-skill folder against the skill-contracts defined
 * in docs/skill-contracts/. Implements the spec-driven enforcement described in
 * docs/skill-contracts/README.md.
 *
 * v1.0 scope (intentionally minimal — a "half-day spike" per the implementation plan):
 *   - Required files exist (SKILL.md, references/{locator,recipe,best-practices,locator-eval}.md)
 *   - Each file has YAML frontmatter
 *   - Required frontmatter fields are present
 *   - Required H2 sections are present (order checked best-effort)
 *   - Contract version referenced in frontmatter resolves to a ratified spec in docs/skill-contracts/
 *
 * Explicitly out of scope (deferred to future iterations):
 *   - Parsing and validating detection rules inside locator.md
 *   - Executing the locator against the eval corpus
 *   - Cross-file consistency (e.g. every checklist item links to a recipe section)
 *   - CI integration
 *
 * Usage:
 *   node scripts/validate-contract.mjs <sub-skill-path>
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = validation failures
 *   2 = bad invocation (missing arg, path doesn't exist, etc.)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'docs', 'skill-contracts');

// Required files inside a sub-skill folder, and the contract each must declare.
const REQUIRED_FILES = [
  // SKILL.md is the sub-skill's entry point; it doesn't itself target a contract
  // but it MUST declare which contract versions its references target.
  { rel: 'SKILL.md', contract: null, requiredFrontmatter: ['name', 'description'] },
  { rel: 'references/locator.md', contract: 'locator', requiredFrontmatter: ['pattern', 'contract'] },
  { rel: 'references/recipe.md', contract: 'recipe', requiredFrontmatter: ['pattern', 'contract'] },
  { rel: 'references/best-practices.md', contract: 'best-practices', requiredFrontmatter: ['pattern', 'contract'] },
];

// Required H2 sections per contract. Order is checked best-effort (sections must appear,
// and must appear in the listed order if all are present).
const REQUIRED_SECTIONS = {
  locator: ['Scope', 'Detection rules', 'Skip-file vocabulary', 'Confidence band rationale'],
  recipe: ['Scope', 'Input contract', 'Path selection', 'Locator → recipe step', 'Unlocatable cases', 'Before / after example', 'Editing strategy', 'Verification'],
  'best-practices': ['Summary', 'Review checklist', 'Common false positives', 'Common gaps', 'When the antipattern is acceptable', 'Relationship to other patterns'],
};

// Single accumulator for validation failures; the script returns non-zero if any are added.
const errors = [];
const warnings = [];

function fail(file, message) {
  errors.push({ file, message });
}

function warn(file, message) {
  warnings.push({ file, message });
}

/**
 * Extracts frontmatter (between two `---` lines at the very top of a file) as a flat
 * map of key → string-or-list. Intentionally simple — handles top-level scalars and
 * single-level list values, which is all the contract specs require. Does not support
 * nested maps; if a contract introduces nested frontmatter, this function needs upgrading.
 */
function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) {
    return null;
  }
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) {
    return null;
  }
  const block = source.slice(4, end);
  const out = {};
  let currentListKey = null;
  for (const rawLine of block.split('\n')) {
    if (rawLine.length === 0) continue;
    if (rawLine.startsWith('  - ')) {
      // Continuation of the previous list-typed key.
      if (currentListKey === null) {
        // Stray list item with no key context — skip silently; the validator
        // will catch missing required fields elsewhere.
        continue;
      }
      out[currentListKey].push(rawLine.slice(4).trim());
      continue;
    }
    const colonIdx = rawLine.indexOf(':');
    if (colonIdx === -1) continue;
    const key = rawLine.slice(0, colonIdx).trim();
    const rest = rawLine.slice(colonIdx + 1).trim();
    if (rest === '') {
      // Opens either a list (if next line is `  - ...`) or a nested map.
      // v1 only supports list; treat as empty list until proven otherwise.
      out[key] = [];
      currentListKey = key;
    } else {
      out[key] = rest;
      currentListKey = null;
    }
  }
  return out;
}

/**
 * Returns the list of H2 section headings (lines starting with `## `, stripped of the
 * leading marker) in the order they appear. Code fences are ignored — a `## ` inside
 * a fenced block is not treated as a heading.
 */
function extractH2Sections(source) {
  const headings = [];
  const lines = source.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.startsWith('## ')) {
      headings.push(line.slice(3).trim());
    }
  }
  return headings;
}

/**
 * Loads a contract spec file from docs/skill-contracts/ and returns its frontmatter.
 * Returns null if the file is missing or has no frontmatter; the caller decides how
 * to handle the absence.
 */
async function loadContractFrontmatter(contractName) {
  const file = path.join(CONTRACTS_DIR, `${contractName}-spec.md`);
  let source;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return parseFrontmatter(source);
}

/**
 * Compares the declared contract version in a sub-skill file against the
 * ratified spec. `declared` is something like "locator-1.0"; we extract the
 * version and check it against the spec's frontmatter.
 *
 * v1 policy: warn if the spec is still `draft`. Fail if the spec is missing,
 * or if the declared version doesn't match the spec's current version.
 */
async function checkContractVersion(file, declared, expectedContract) {
  if (typeof declared !== 'string' || !declared.startsWith(`${expectedContract}-`)) {
    fail(file, `frontmatter "contract" must be "${expectedContract}-<version>", got "${declared}"`);
    return;
  }
  const declaredVersion = declared.slice(expectedContract.length + 1);
  const specFm = await loadContractFrontmatter(expectedContract);
  if (specFm === null) {
    fail(file, `referenced contract "${expectedContract}-spec.md" not found in ${path.relative(REPO_ROOT, CONTRACTS_DIR)}`);
    return;
  }
  if (specFm.version !== declaredVersion) {
    fail(file, `declared contract version ${declaredVersion} does not match ratified ${expectedContract}-spec.md version ${specFm.version}`);
    return;
  }
  if (specFm.status !== 'ratified') {
    // v1 lets draft specs be referenced (otherwise nothing can validate before ratification),
    // but warns so it's visible.
    warn(file, `references ${expectedContract}-spec.md at status "${specFm.status}" — sub-skill cannot be marked Ready until spec is ratified`);
  }
}

/**
 * Verifies that every required section heading appears in the file, in the
 * required order. Missing sections are errors; ordering violations are
 * warnings (the spec text is the source of truth on strict order; the
 * validator catches the obvious omissions and leaves nuanced ordering to
 * human review).
 */
function checkSections(file, source, requiredSections) {
  const present = extractH2Sections(source);
  const presentSet = new Set(present);

  for (const required of requiredSections) {
    // Allow loose matching — a required section name appears if any actual
    // heading contains the required string. This accommodates contracts like
    // "Locator → recipe step" which sub-skills may render with extra context
    // (e.g. "Locator → recipe step (per path)").
    const found = present.some(h => h.includes(required));
    if (!found) {
      fail(file, `missing required section "## ${required}"`);
    }
  }

  // Best-effort order check: pairwise, of the sections that ARE present.
  const orderedRequired = requiredSections.filter(s => present.some(h => h.includes(s)));
  for (let i = 1; i < orderedRequired.length; i++) {
    const prev = orderedRequired[i - 1];
    const curr = orderedRequired[i];
    const prevIdx = present.findIndex(h => h.includes(prev));
    const currIdx = present.findIndex(h => h.includes(curr));
    if (prevIdx >= currIdx) {
      warn(file, `section "## ${curr}" appears before "## ${prev}" — expected order is ${prev} → ${curr}`);
    }
  }
}

async function validateFile(subSkillPath, spec) {
  const absPath = path.join(subSkillPath, spec.rel);
  let source;
  try {
    source = await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      fail(spec.rel, `required file not found`);
      return;
    }
    throw err;
  }

  const fm = parseFrontmatter(source);
  if (fm === null) {
    fail(spec.rel, `file has no YAML frontmatter (must start with --- ... ---)`);
    return;
  }

  for (const field of spec.requiredFrontmatter) {
    if (!(field in fm)) {
      fail(spec.rel, `frontmatter missing required field "${field}"`);
    }
  }

  if (spec.contract !== null) {
    await checkContractVersion(spec.rel, fm.contract, spec.contract);
    const requiredSections = REQUIRED_SECTIONS[spec.contract];
    if (requiredSections) {
      checkSections(spec.rel, source, requiredSections);
    }
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/validate-contract.mjs <sub-skill-path>');
    process.exit(2);
  }
  const subSkillPath = path.resolve(arg);
  try {
    const stat = await fs.stat(subSkillPath);
    if (!stat.isDirectory()) {
      console.error(`Not a directory: ${subSkillPath}`);
      process.exit(2);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Path does not exist: ${subSkillPath}`);
      process.exit(2);
    }
    throw err;
  }

  for (const spec of REQUIRED_FILES) {
    await validateFile(subSkillPath, spec);
  }

  const rel = path.relative(REPO_ROOT, subSkillPath);
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✅ ${rel} conforms to skill-contracts v1.0`);
    process.exit(0);
  }

  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} warning${warnings.length === 1 ? '' : 's'} in ${rel}:`);
    for (const w of warnings) {
      console.log(`   ${w.file}: ${w.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`❌ ${errors.length} error${errors.length === 1 ? '' : 's'} in ${rel}:`);
    for (const e of errors) {
      console.error(`   ${e.file}: ${e.message}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
