#!/usr/bin/env node
/**
 * bootstrap-authorkit.mjs — one-shot AuthorKit runtime port for a vanilla
 * aem-boilerplate target.
 *
 * Solves the "manual, version-drifted bootstrap" gap (stardust multitest finding
 * #6): the Runtime-bootstrap step in deploy/SKILL.md is a ~15-step manual port
 * (copy ~10 paths from author-kit, remove the boilerplate set, apply two
 * mandatory edits that fail SILENTLY if forgotten, patch the blank-render gate,
 * write .eslintignore). Doing it by hand per site is error-prone, and "port from
 * the latest test branch" is an unpinned moving target.
 *
 * This script automates the port and VERIFIES the two mandatory edits, so a
 * missed edit is a hard error instead of a silent footer-error-box / unstyled
 * fragment at runtime. Two source modes:
 *
 *   --from-sibling <dir>   RECOMMENDED. Copy the runtime from another EDS project
 *                          in the workspace that is ALREADY bootstrapped (has
 *                          scripts/ak.js with both edits). Offline, deterministic,
 *                          parity-safe with a known-good deployed runtime. This is
 *                          the multi-site / monorepo path (8 sites, one repo).
 *
 *   --ref <gitref>         Fetch a PINNED author-kit ref tarball from GitHub and
 *                          port from it. Defaults to AUTHORKIT_REF below — pin a
 *                          real commit/tag here rather than tracking `main`, so a
 *                          runtime restructure upstream (the static-fragment ->
 *                          block-based drift this finding flagged) can't silently
 *                          change what gets ported. Needs network + `tar`.
 *
 * Usage:
 *   node bootstrap-authorkit.mjs --target . --from-sibling ../starbucks
 *   node bootstrap-authorkit.mjs --target . --ref <commit-sha>
 *
 * Idempotent: re-running is safe (copies overwrite, edits are checked before
 * re-applying). Exits non-zero if a mandatory edit can't be verified.
 */
import { cp, readFile, writeFile, rm, readdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sh = promisify(execFile);

// Pin a real author-kit ref here (commit SHA or tag). 'main' is the drift-prone
// default the finding warns about — override with --ref or set this to a SHA.
const AUTHORKIT_REF = 'main';
const AUTHORKIT_TARBALL = (ref) => `https://codeload.github.com/aemsites/author-kit/tar.gz/${ref}`;

// The PORT-IN manifest, kept in sync with deploy/SKILL.md § Runtime bootstrap.
const PORT_FILES = ['scripts/ak.js', 'scripts/scripts.js', 'scripts/postlcp.js', 'scripts/lazy.js', 'head.html', '.hlxignore'];
const PORT_DIRS = ['scripts/utils', 'tools', 'deps', 'blocks/fragment', 'blocks/section-metadata'];
// The REMOVE manifest (boilerplate the AuthorKit runtime replaces).
const REMOVE = ['scripts/aem.js', 'scripts/delayed.js', 'styles/fonts.css', 'styles/lazy-styles.css',
  'blocks/header', 'blocks/footer', 'blocks/cards', 'blocks/columns', 'blocks/widget'];
const ESLINTIGNORE = ['deps/', 'scripts/ak.js', 'scripts/lazy.js', 'scripts/postlcp.js',
  'scripts/scripts.js', 'scripts/utils/', 'tools/', 'blocks/fragment/', 'samples'];

function parseArgs(argv) {
  const a = { target: '.', ref: AUTHORKIT_REF };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--target') a.target = argv[(i += 1)];
    else if (k === '--from-sibling') a.sibling = argv[(i += 1)];
    else if (k === '--ref') a.ref = argv[(i += 1)];
    else if (k === '--allow-unpinned') a.allowUnpinned = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  return a;
}

const log = (s) => console.error(s);

async function resolveSource(args) {
  if (args.sibling) {
    if (!existsSync(path.join(args.sibling, 'scripts/ak.js'))) {
      throw new Error(`--from-sibling ${args.sibling} is not a bootstrapped EDS project (no scripts/ak.js)`);
    }
    log(`[bootstrap] source: sibling ${args.sibling} (offline, parity-safe)`);
    return { dir: args.sibling, cleanup: async () => {} };
  }
  // tarball mode
  const tmp = await mkdtemp(path.join(tmpdir(), 'authorkit-'));
  const tgz = path.join(tmp, 'ak.tgz');
  log(`[bootstrap] source: author-kit@${args.ref} (fetching tarball)`);
  await sh('curl', ['-sSL', '-o', tgz, AUTHORKIT_TARBALL(args.ref)]);
  await sh('tar', ['xzf', tgz, '-C', tmp]);
  const sub = (await readdir(tmp)).find((d) => d.startsWith('author-kit-'));
  if (!sub) throw new Error('tarball did not contain an author-kit- dir');
  return { dir: path.join(tmp, sub), cleanup: async () => rm(tmp, { recursive: true, force: true }) };
}

async function portIn(srcDir, target) {
  const copied = [];
  const missing = [];
  for (const rel of [...PORT_FILES, ...PORT_DIRS]) {
    const from = path.join(srcDir, rel);
    if (!existsSync(from)) { missing.push(rel); continue; }
    const to = path.join(target, rel);
    // head.html special case: deploy Step 3 § Favicon adds exactly one
    // `<link rel="icon" href="/favicon.<ext>">` tag for non-.ico formats,
    // and re-running bootstrap (the documented recovery path) would blind-
    // overwrite it with the stock head.html — nothing downstream re-verifies
    // head.html. Preserve any existing icon link TAG(S) — matched as complete
    // <link ...> tags over the whole file (a tag may span lines; a line-based
    // filter re-injects an unterminated fragment), rel covering icon /
    // shortcut icon / apple-touch-icon — and re-inject them after the copy.
    // Only complete matched tags are ever injected (idempotent: identical
    // trimmed tags are not duplicated).
    let faviconTags = [];
    if (rel === 'head.html' && existsSync(to)) {
      faviconTags = ((await readFile(to, 'utf8')).match(/<link\b[^>]*>/gi) || [])
        .filter((t) => /\brel=["'][^"']*icon[^"']*["']/i.test(t))
        .map((t) => t.trim());
    }
    await cp(from, to, { recursive: true, force: true });
    if (faviconTags.length) {
      let head = await readFile(to, 'utf8');
      const have = new Set((head.match(/<link\b[^>]*>/gi) || []).map((t) => t.trim()));
      const inject = faviconTags.filter((t) => !have.has(t));
      if (inject.length) {
        if (head.length && !head.endsWith('\n')) head += '\n';
        head += `${inject.join('\n')}\n`;
        await writeFile(to, head);
        log(`[bootstrap] head.html: preserved favicon link across the overwrite (${inject.join(' | ')})`);
      }
    }
    copied.push(rel);
  }
  return { copied, missing };
}

async function removeBoilerplate(target) {
  const removed = [];
  for (const rel of REMOVE) {
    const p = path.join(target, rel);
    if (existsSync(p)) { await rm(p, { recursive: true, force: true }); removed.push(rel); }
  }
  return removed;
}

async function applyEdits(target) {
  const results = [];
  // Edit 1 — lazy.js: drop the utils/footer.js import (collides with static footer fragment).
  const lazyPath = path.join(target, 'scripts/lazy.js');
  let lazy = await readFile(lazyPath, 'utf8');
  if (/utils\/footer\.js/.test(lazy)) {
    lazy = lazy.split('\n').filter((l) => !l.includes('utils/footer.js')).join('\n');
    await writeFile(lazyPath, lazy);
  }
  results.push({ edit: 'lazy.js: no utils/footer.js import', ok: !/utils\/footer\.js/.test(lazy) });

  // Edit 2 — postlcp.js: set el.className = name before innerHTML in loadStaticFragment.
  const plPath = path.join(target, 'scripts/postlcp.js');
  let pl = await readFile(plPath, 'utf8');
  const hasClassName = /el\.className\s*=\s*name\s*;/.test(pl);
  if (!hasClassName && /el\.innerHTML\s*=\s*html\s*;/.test(pl)) {
    pl = pl.replace(/(\n(\s*))el\.innerHTML\s*=\s*html\s*;/, '$1el.className = name;$1el.innerHTML = html;');
    await writeFile(plPath, pl);
  }
  results.push({ edit: 'postlcp.js: el.className = name before innerHTML', ok: /el\.className\s*=\s*name\s*;/.test(pl) });
  return results;
}

async function patchBlankRenderGate(target) {
  // #40: vanilla boilerplate styles.css gates body display on body.appear, which
  // ak.js never adds -> permanently-hidden body (blank page that passes most checks).
  const cssPath = path.join(target, 'styles/styles.css');
  if (!existsSync(cssPath)) return { patched: false, note: 'no styles/styles.css yet (foundation step will author it)' };
  let css = await readFile(cssPath, 'utf8');
  if (!/body\.appear/.test(css)) return { patched: false, note: 'no body.appear gate present (clean)' };
  const before = css;
  // Drop `display: none` from the bare body rule and remove the body.appear reveal rule.
  css = css.replace(/(body\s*\{[^}]*?)\bdisplay\s*:\s*none\s*;?/m, '$1/* display:none gate removed by bootstrap (#40) */');
  css = css.replace(/body\.appear\s*\{[^}]*\}\s*/m, '');
  if (css !== before) { await writeFile(cssPath, css); return { patched: true, note: 'removed body{display:none}+body.appear gate' }; }
  return { patched: false, note: 'WARNING: body.appear present but auto-patch did not match — remove the display:none gate manually (#40)' };
}

async function writeEslintignore(target) {
  const p = path.join(target, '.eslintignore');
  const existing = existsSync(p) ? (await readFile(p, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const merged = [...new Set([...existing, ...ESLINTIGNORE])];
  await writeFile(p, `${merged.join('\n')}\n`);
  return merged.length - existing.length;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(path.join(args.target, 'scripts'))) throw new Error(`--target ${args.target} is not an EDS project (no scripts/)`);
  // Refuse the drift-prone `main` default unless explicitly acknowledged: on 2 of
  // 6 e2e sites author-kit@main had drifted to a block-based postlcp.js that fails
  // the mandatory static-fragment edit, and the port had already deleted the
  // boilerplate — bricking the repo. Force a conscious choice.
  if (args.ref === 'main' && !args.allowUnpinned && !args.sibling) {
    log('[bootstrap] REFUSING author-kit@main (drift-prone). Pass --ref <known-good-sha>, or --from-sibling <path> to port from a working repo, or --allow-unpinned to accept the risk.');
    process.exit(3);
  }
  const { dir, cleanup } = await resolveSource(args);
  try {
    // Transactional ordering: port + verify the mandatory edits BEFORE removing any
    // boilerplate, so a failed/incompatible edit leaves the original runtime intact
    // and recoverable rather than a half-ported brick.
    const { copied, missing } = await portIn(dir, args.target);
    const edits = await applyEdits(args.target);
    const gate = await patchBlankRenderGate(args.target);

    log('\n[bootstrap] PORT-IN:');
    for (const c of copied) log(`  + ${c}`);
    if (missing.length) log(`[bootstrap] NOT FOUND in source (verify source is a full runtime): ${missing.join(', ')}`);
    log('[bootstrap] MANDATORY EDITS:');
    for (const e of edits) log(`  ${e.ok ? 'OK  ' : 'FAIL'} ${e.edit}`);
    log(`[bootstrap] blank-render gate: ${gate.note}`);

    const failed = edits.filter((e) => !e.ok);
    if (failed.length) {
      log('\n[bootstrap] FAILED: a mandatory edit could not be verified (the ported runtime is incompatible — likely source drift). WARNING: the PORT-IN files (scripts/*.js, head.html, tools/, deps/, fragment blocks) were already copied over your originals — the repo is now a HYBRID runtime, not the original. Restore with `git checkout -- .` (the script keeps no backups), pin a known-good --ref, and re-run. The boilerplate REMOVE step did not run.');
      process.exit(1);
    }

    // Edits verified — now safe to remove the boilerplate the new runtime replaces.
    const removed = await removeBoilerplate(args.target);
    const eslintAdded = await writeEslintignore(args.target);
    log('[bootstrap] REMOVED boilerplate:');
    for (const r of removed) log(`  - ${r}`);
    log(`[bootstrap] .eslintignore: +${eslintAdded} entries`);
    log('\n[bootstrap] done. Next: foundation (Step 3), then push the branch + force Code Sync before deploy.');
  } finally {
    await cleanup();
  }
}

main().catch((e) => { console.error(`[bootstrap] fatal: ${e.message}`); process.exit(2); });
