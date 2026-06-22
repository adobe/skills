#!/usr/bin/env node
/**
 * snowflake substrate installer.
 *
 * Idempotently installs the overlay-pattern substrate on top of a
 * vanilla (or modified) Adobe EDS boilerplate repository. Drives off
 * substrate/MANIFEST.json — adding new files there is enough to extend
 * the installer; no code changes needed.
 *
 * Behavior:
 *   - Detects whether the substrate is already installed by grepping
 *     for the marker string in scripts/scripts.js.
 *   - If installed at the bundled version (per .snowflake/config.json):
 *     no-op.
 *   - If installed at a different version: prints a drift report
 *     and refuses to act unless --force is passed.
 *   - If not installed: copies substrate files into place, backing up
 *     existing versions to .snowflake/.backup/<timestamp>/. Merges
 *     lines into .eslintignore / .stylelintignore / .gitignore
 *     idempotently (no duplicate lines).
 *   - Writes .snowflake/config.json on success.
 *
 * Run from the target EDS repository's root. The installer
 * self-locates the substrate bundle via import.meta.url, so it
 * works regardless of where the skill bundle is mounted.
 *
 * Usage:
 *   node <SKILL_DIR>/scripts/install-substrate.mjs   [--dry-run] [--force]
 *
 * Flags:
 *   --dry-run   Print what would change; touch nothing.
 *   --force     Install even if a different-version substrate is detected.
 *
 * Exit codes:
 *   0   Success (installed, no-op, or dry-run completed cleanly)
 *   1   Target repo not detected (no .git, no package.json, etc.)
 *   2   Cannot proceed without --force (substrate drift), or an inject anchor was missing/ambiguous
 *   3   Filesystem error during install
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(SCRIPT_DIR);
const SUBSTRATE_DIR = join(SKILL_DIR, 'assets', 'substrate');

const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry-run');
const FORCE = flags.has('--force');

const log = (msg) => console.log(`[snowflake] ${msg}`);
const warn = (msg) => console.warn(`[snowflake] WARN: ${msg}`);
const die = (msg, code = 3) => { console.error(`[snowflake] ${msg}`); process.exit(code); };

// ---------------------------------------------------------------------------
// 1. Locate the target repo (the EDS repo we're installing into)
// ---------------------------------------------------------------------------

let REPO_ROOT;
try {
  REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
  die('not inside a git repository — run this from the target EDS repo root', 1);
}
if (!existsSync(join(REPO_ROOT, 'package.json'))) {
  die(`no package.json at ${REPO_ROOT} — does not look like an EDS boilerplate repo`, 1);
}
log(`target repo: ${REPO_ROOT}`);

// ---------------------------------------------------------------------------
// 2. Load the bundled manifest + version
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(SUBSTRATE_DIR, 'MANIFEST.json'), 'utf8'));
const bundledVersion = readFileSync(join(SUBSTRATE_DIR, 'VERSION'), 'utf8').trim();
log(`bundled substrate version: ${bundledVersion}`);

// ---------------------------------------------------------------------------
// 3. Detect current substrate state
//
// Robust detection: compare every file in manifest.replace against the
// bundled version (byte-identical check). If all match: installed at
// the bundled version. If any differ but the marker comment is present:
// drift. If marker absent: fresh install.
//
// Falls back to the marker-comment check if file reads fail.
// ---------------------------------------------------------------------------

function readMaybe(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

const markerFilePath = join(REPO_ROOT, manifest.marker.file);
const markerFileContent = readMaybe(markerFilePath);
const markerPresent = markerFileContent !== null
  && markerFileContent.includes(manifest.marker.needle);

let allFilesMatchBundle = true;
let driftedFiles = [];
for (const entry of manifest.replace) {
  const bundled = readMaybe(join(SUBSTRATE_DIR, entry.src));
  const installed = readMaybe(join(REPO_ROOT, entry.dst));
  if (bundled === null) die(`bundle missing: ${entry.src}`);
  if (installed === null || installed !== bundled) {
    allFilesMatchBundle = false;
    if (installed !== null) driftedFiles.push(entry.dst);
  }
}

const injectComplete = markerPresent && (manifest.inject ?? []).every((target) => {
  const content = readMaybe(join(REPO_ROOT, target.file));
  return content !== null && target.edits.every((e) => content.includes(e.skipIf));
});

const configPath = join(REPO_ROOT, '.snowflake', 'config.json');
let installedVersion = null;
if (existsSync(configPath)) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    installedVersion = cfg.substrateVersion ?? null;
  } catch {
    warn(`.snowflake/config.json is malformed — ignoring`);
  }
}

// Decision tree
if (markerPresent && allFilesMatchBundle && injectComplete) {
  log(`substrate v${bundledVersion} already installed — no-op`);
  process.exit(0);
}

if (markerPresent && !allFilesMatchBundle) {
  // Substrate is here, but some files diverge from bundled. Either
  // (a) the user customized substrate, (b) an older version is installed,
  // (c) the user partially patched. All three are "drift".
  console.error(`[snowflake] substrate marker present in ${manifest.marker.file} but ${driftedFiles.length} file(s) differ from the bundled v${bundledVersion}:`);
  driftedFiles.forEach((f) => console.error(`[snowflake]   - ${f}`));
  if (installedVersion && installedVersion !== bundledVersion) {
    console.error(`[snowflake] .snowflake/config.json reports v${installedVersion} (bundled is v${bundledVersion}).`);
  } else if (!installedVersion) {
    console.error(`[snowflake] .snowflake/config.json is absent — substrate was likely installed before snowflake was wired up, or by hand.`);
  }
  if (!FORCE) {
    console.error(`[snowflake]`);
    console.error(`[snowflake] Options:`);
    console.error(`[snowflake]   1. Investigate the diffs (compare files in <SKILL_DIR>/assets/substrate/ to the repo)`);
    console.error(`[snowflake]      and reconcile by hand, then write .snowflake/config.json yourself with`);
    console.error(`[snowflake]      { "substrateVersion": "${bundledVersion}" }.`);
    console.error(`[snowflake]   2. Re-run with --force to overwrite the diverging files. Originals will be`);
    console.error(`[snowflake]      backed up to .snowflake/.backup/<timestamp>/.`);
    process.exit(2);
  }
  log(`--force given — overwriting diverged files`);
}

if (!markerPresent) {
  // No snowflake substrate present (marker absent). Replacing the
  // boilerplate files IS the install — a vanilla aem-boilerplate clone
  // always has non-empty stock files here that differ from the bundled
  // substrate. Originals are backed up unconditionally (step 4), so this
  // is reversible. Report which pre-existing non-empty files will be
  // replaced so the caller can surface them, but don't block: the run
  // summary already disclosed the count and the backup is the safety net.
  const preexisting = [];
  for (const entry of manifest.replace) {
    const installed = readMaybe(join(REPO_ROOT, entry.dst));
    const bundled = readMaybe(join(SUBSTRATE_DIR, entry.src));
    if (installed !== null && installed !== bundled && installed.trim().length > 0) {
      preexisting.push(entry.dst);
    }
  }
  if (preexisting.length > 0) {
    log(`replacing ${preexisting.length} pre-existing file(s) (originals backed up to .snowflake/.backup/<timestamp>/):`);
    preexisting.forEach((f) => log(`  - ${f}`));
  } else {
    log(`substrate not detected — fresh install (vanilla or minimal boilerplate)`);
  }
}

if (DRY_RUN) log(`(dry-run — no files will be modified)`);

// ---------------------------------------------------------------------------
// 4. Back up files we're about to overwrite
// ---------------------------------------------------------------------------

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(REPO_ROOT, '.snowflake', '.backup', timestamp);

function backupOne(repoRelPath) {
  const src = join(REPO_ROOT, repoRelPath);
  if (!existsSync(src)) return;
  const dst = join(backupDir, repoRelPath);
  if (DRY_RUN) {
    log(`would back up: ${repoRelPath} → .snowflake/.backup/${timestamp}/${repoRelPath}`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  log(`backed up: ${repoRelPath}`);
}

// ---------------------------------------------------------------------------
// 5. Replace files per manifest.replace
// ---------------------------------------------------------------------------

for (const entry of manifest.replace) {
  const src = join(SUBSTRATE_DIR, entry.src);
  const dst = join(REPO_ROOT, entry.dst);
  if (!existsSync(src)) die(`bundle missing: ${entry.src}`);
  backupOne(entry.dst);
  if (DRY_RUN) {
    log(`would replace: ${entry.dst}  (purpose: ${entry.purpose})`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  log(`replaced: ${entry.dst}`);
}

// ---------------------------------------------------------------------------
// 6. Merge ignore-file patches (idempotent: skip lines already present)
// ---------------------------------------------------------------------------

function mergeLines(repoRelPath, linesToAdd) {
  const path = join(REPO_ROOT, repoRelPath);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const existingLines = new Set(existing.split('\n'));

  const additions = linesToAdd.filter((l) => !existingLines.has(l));
  if (additions.length === 0) {
    log(`no changes needed: ${repoRelPath}`);
    return;
  }

  if (DRY_RUN) {
    log(`would append ${additions.length} line(s) to ${repoRelPath}:`);
    additions.forEach((l) => log(`    + ${l}`));
    return;
  }

  backupOne(repoRelPath);
  const next = existing
    + (existing.endsWith('\n') || existing.length === 0 ? '' : '\n')
    + additions.join('\n')
    + '\n';
  writeFileSync(path, next);
  log(`appended ${additions.length} line(s) to ${repoRelPath}`);
}

for (const patch of manifest.ignorePatches ?? []) {
  mergeLines(patch.dst, patch.lines);
}

if (manifest.gitignore) {
  mergeLines(manifest.gitignore.dst, manifest.gitignore.lines);
}

// ---------------------------------------------------------------------------
// 6b. Apply anchored, idempotent code injections (manifest.inject)
// ---------------------------------------------------------------------------

function applyInject() {
  for (const target of manifest.inject ?? []) {
    const path = join(REPO_ROOT, target.file);
    let content = readMaybe(path);
    if (content === null) die(`inject target missing: ${target.file}`, 3);
    let changed = false;
    for (const edit of target.edits) {
      if (content.includes(edit.skipIf)) continue; // already applied — idempotent
      const idx = content.indexOf(edit.anchor);
      if (idx === -1) {
        console.error(`[snowflake] could not find the anchor for "${edit.id}" in ${target.file}.`);
        console.error(`[snowflake] Your boilerplate may have changed. Apply this manually,`);
        console.error(`[snowflake] immediately AFTER this anchor: ${JSON.stringify(edit.anchor)}`);
        console.error(`[snowflake] ---`);
        console.error(edit.insert);
        console.error(`[snowflake] ---`);
        process.exit(2);
      }
      if (content.indexOf(edit.anchor, idx + 1) !== -1) {
        die(`anchor for "${edit.id}" is ambiguous in ${target.file} (multiple matches)`, 2);
      }
      const at = idx + edit.anchor.length;
      if (DRY_RUN) {
        log(`would inject "${edit.id}" into ${target.file}`);
        content = content.slice(0, at) + '\n' + edit.insert + content.slice(at);
        continue;
      }
      content = content.slice(0, at) + '\n' + edit.insert + content.slice(at);
      changed = true;
      log(`injected "${edit.id}" into ${target.file}`);
    }
    if (changed && !DRY_RUN) {
      backupOne(target.file);
      writeFileSync(path, content);
    }
  }
}

applyInject();

// ---------------------------------------------------------------------------
// 7. Write .snowflake/config.json with installed version + defaults
//
// Merge order (later wins):
//   manifest.defaults  ← stamped on fresh install so config always has them
//   existing config    ← user edits survive upgrades
//   configOut          ← substrateVersion + installedAt always refresh
// ---------------------------------------------------------------------------

const snowflakeDir = join(REPO_ROOT, '.snowflake');
const defaults = manifest.defaults ?? {};
const existingConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : {};
const configOut = {
  substrateVersion: bundledVersion,
  installedAt: new Date().toISOString(),
};
const merged = { ...defaults, ...existingConfig, ...configOut };
if (DRY_RUN) {
  log(`would write .snowflake/config.json: ${JSON.stringify(merged, null, 2)}`);
} else {
  mkdirSync(snowflakeDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
  log(`wrote .snowflake/config.json`);
}

log(`done — substrate v${bundledVersion} ${DRY_RUN ? 'would be ' : ''}installed`);
