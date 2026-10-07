#!/usr/bin/env node
/*
 * Installs the personalization runtime into an EDS repo. Idempotent.
 *
 * Skill-owned files (scripts/personalization/*.js except config.js,
 * blocks/personalization/personalization.js) are updated when they differ.
 * Site-owned files (config.js, personalization.css, blocks/fragment) are only
 * created when missing. scripts/scripts.js is changed only with --apply-hook,
 * which the skill passes after the user approves the printed patch.
 *
 * Usage: node install-runtime.mjs [repoDir] [--apply-hook] [--dry-run]
 */

import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  RUNTIME_DIR, RUNTIME_MODULES, findLoadEager, exitOnHelp, isMain, parseArgs, readText,
} from './lib.mjs';

export const USAGE = `Usage: node install-runtime.mjs [repoDir] [--apply-hook] [--dry-run]
Installs the personalization runtime into an EDS repo (idempotent). Skill-owned
files are updated when they differ; site-owned files (config.js,
personalization.css, blocks/fragment) are only created when missing.
scripts/scripts.js changes only with --apply-hook (after the patch is approved).`;


export const HOOK_MARKER = 'initPersonalization(main)';

const FILES = [
  ...RUNTIME_MODULES.map((name) => ({ path: `scripts/personalization/${name}`, owner: 'skill' })),
  { path: 'scripts/personalization/config.js', owner: 'site' },
  { path: 'blocks/personalization/personalization.js', owner: 'skill' },
  { path: 'blocks/personalization/personalization.css', owner: 'site' },
  { path: 'blocks/fragment/fragment.js', owner: 'site' },
];

/**
 * Computes the scripts.js change: the hook goes right before decorateMain(main)
 * inside loadEager.
 * @param {string} scripts scripts.js source
 * @returns {{status: 'installed'|'pending'|'not-found', source?: string, patch?: string}}
 */
export function planHook(scripts) {
  const found = findLoadEager(scripts);
  if (!found) return { status: 'not-found' };
  const { start, body: eager } = found;
  if (eager.includes(HOOK_MARKER)) return { status: 'installed' };
  const call = /^([ \t]*)decorateMain\(\s*main\s*\);/m.exec(eager);
  if (!call) return { status: 'not-found' };
  const indent = call[1];
  const unit = indent.length >= 4 ? indent.slice(0, indent.length / 2) : '  ';
  const hook = [
    `${indent}if (main.querySelector('div.personalization')) {`,
    `${indent}${unit}const { initPersonalization } = await import('./personalization/index.js');`,
    `${indent}${unit}${HOOK_MARKER};`,
    `${indent}}`,
  ].join('\n');
  const at = start + call.index;
  const source = `${scripts.slice(0, at)}${hook}\n${scripts.slice(at)}`;
  const patch = [
    '--- a/scripts/scripts.js',
    '+++ b/scripts/scripts.js',
    '@@ loadEager @@',
    ...hook.split('\n').map((line) => `+${line}`),
    ` ${call[0]}`,
  ].join('\n');
  return { status: 'pending', source, patch };
}

/**
 * @param {string} repo
 * @param {{applyHook?: boolean, dryRun?: boolean}} options
 * @returns {object} report
 */
export function installRuntime(repo, { applyHook = false, dryRun = false } = {}) {
  const report = {
    created: [], updated: [], unchanged: [], kept: [], warnings: [], hook: null,
  };
  FILES.forEach(({ path, owner }) => {
    const source = join(RUNTIME_DIR, path);
    const target = join(repo, path);
    const current = readText(target);
    if (current === null) {
      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
      report.created.push(path);
    } else if (current === readFileSync(source, 'utf8')) {
      report.unchanged.push(path);
    } else if (owner === 'skill') {
      if (!dryRun) copyFileSync(source, target);
      report.updated.push(path);
    } else {
      report.kept.push(path);
    }
  });

  const fragment = readText(join(repo, 'blocks', 'fragment', 'fragment.js')) || '';
  if (!/export\s+async\s+function\s+loadFragment/.test(fragment)) {
    report.warnings.push('blocks/fragment/fragment.js does not export loadFragment(path); the runtime needs it');
  }

  const scriptsPath = join(repo, 'scripts', 'scripts.js');
  const scripts = readText(scriptsPath);
  if (scripts === null) {
    report.hook = { status: 'not-found' };
    report.warnings.push('scripts/scripts.js not found');
  } else {
    const hook = planHook(scripts);
    if (hook.status === 'pending' && applyHook && !dryRun) {
      writeFileSync(scriptsPath, hook.source);
      report.hook = { status: 'applied', patch: hook.patch };
    } else {
      report.hook = { status: hook.status, patch: hook.patch };
    }
    if (hook.status === 'not-found') {
      report.warnings.push('could not find decorateMain(main) in loadEager; add the hook by hand (see reference/client-mode.md)');
    }
  }
  if (!existsSync(join(repo, 'blocks', 'personalization'))) report.warnings.push('blocks/personalization missing');
  return report;
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const repo = args._[0] || process.cwd();
  const report = installRuntime(repo, { applyHook: !!args['apply-hook'], dryRun: !!args['dry-run'] });
  console.log(JSON.stringify(report, null, 2));
  if (report.hook.status === 'pending') {
    console.log(`\nscripts.js hook not applied. Proposed change:\n${report.hook.patch}\nRe-run with --apply-hook after approval.`);
  }
}
