#!/usr/bin/env node
/*
 * Installs the personalization runtime into an EDS repo. Idempotent.
 *
 * Skill-owned files (the modules under scripts/personalization/ except
 * config.js) are updated when they differ. Site-owned files (config.js,
 * styles/target-popup.css, blocks/fragment) are only created when missing.
 * scripts/scripts.js is changed only with --apply-hook, which the skill always
 * passes:
 * - loadEager, right after decorateMain(main): await personalizeSections(main)
 *   holds and decides personalized sections before the first one loads (it
 *   waits only for the first section, and only when that one is personalized);
 * - loadLazy, right after loadSections(main): personalizeSectionsLazy(main)
 *   arms target popups.
 *
 * The report also lists what config.js still needs (contract section 3: the
 * consent mode, and hasConsent wired to the consent tool), which the skill
 * fills in after asking the user.
 *
 * Usage: node install-runtime.mjs [repoDir] [--apply-hook] [--dry-run]
 */

import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  RUNTIME_DIR, RUNTIME_MODULES, exitOnHelp, isMain, parseArgs, readText,
} from './lib.mjs';
import { checkSiteConfig, readSiteConfig } from './validate-placeholders.mjs';

export const USAGE = `Usage: node install-runtime.mjs [repoDir] [--apply-hook] [--dry-run]
Installs the personalization runtime into an EDS repo (idempotent). Skill-owned
files are updated when they differ; site-owned files (config.js,
styles/target-popup.css, blocks/fragment) are only created when missing.
scripts/scripts.js changes only with --apply-hook (the skill always passes it):
the section hooks in loadEager and loadLazy.`;

export const SECTIONS_MARKER = 'personalizeSections(main)';
export const LAZY_MARKER = 'personalizeSectionsLazy(main)';
const SECTION_TEST = "main.querySelector(':scope > .section[data-personalization]')";

const FILES = [
  ...RUNTIME_MODULES.map((name) => ({ path: `scripts/personalization/${name}`, owner: 'skill' })),
  { path: 'scripts/personalization/config.js', owner: 'site' },
  { path: 'styles/target-popup.css', owner: 'site' },
  { path: 'blocks/fragment/fragment.js', owner: 'site' },
];

/**
 * Locates a top-level function of a scripts.js source.
 * @param {string} scripts
 * @param {string} name
 * @returns {{start: number, body: string}|null} offset and source of the function
 */
export function findFunction(scripts, name) {
  const start = scripts.search(new RegExp(`(async )?function ${name}\\s*\\(`));
  if (start === -1) return null;
  const next = scripts.slice(start + 1).search(/\n(export )?(async )?function /);
  return { start, body: next === -1 ? scripts.slice(start) : scripts.slice(start, start + 1 + next) };
}

const unitOf = (indent) => (indent.length >= 4 ? indent.slice(0, indent.length / 2) : '  ');

function patchOf(hook, anchor, after) {
  return [
    '--- a/scripts/scripts.js',
    '+++ b/scripts/scripts.js',
    `@@ ${after ? 'after' : 'before'} ${anchor.trim()} @@`,
    ...(after ? [` ${anchor}`] : []),
    ...hook.split('\n').map((line) => `+${line}`),
    ...(after ? [] : [` ${anchor}`]),
  ].join('\n');
}

/**
 * Plans one hook: `lines(indent, unit)` inserted before or after the anchor
 * statement inside a function.
 * @returns {{status: 'installed'|'pending'|'not-found', source?: string, patch?: string}}
 */
function planInsert(scripts, {
  fn, marker, anchor, after, lines,
}) {
  const found = findFunction(scripts, fn);
  if (!found) return { status: 'not-found' };
  if (found.body.includes(marker)) return { status: 'installed' };
  const call = anchor.exec(found.body);
  if (!call) return { status: 'not-found' };
  const indent = call[1];
  const hook = lines(indent, unitOf(indent)).join('\n');
  const at = found.start + call.index + (after ? call[0].length : 0);
  const source = after
    ? `${scripts.slice(0, at)}\n${hook}${scripts.slice(at)}`
    : `${scripts.slice(0, at)}${hook}\n${scripts.slice(at)}`;
  return { status: 'pending', source, patch: patchOf(hook, call[0], after) };
}

/**
 * The section hook: right after decorateMain(main) in loadEager, so sections
 * are held before the first one loads.
 * @param {string} scripts scripts.js source
 * @returns {{status: 'installed'|'pending'|'not-found', source?: string, patch?: string}}
 */
export function planSectionsHook(scripts) {
  return planInsert(scripts, {
    fn: 'loadEager',
    marker: SECTIONS_MARKER,
    anchor: /^([ \t]*)decorateMain\(\s*main\s*\);/m,
    after: true,
    lines: (indent, unit) => [
      `${indent}if (${SECTION_TEST}) {`,
      `${indent}${unit}const { personalizeSections } = await import('./personalization/sections.js');`,
      `${indent}${unit}await ${SECTIONS_MARKER};`,
      `${indent}}`,
    ],
  });
}

/**
 * The lazy hook: right after loadSections(main) in loadLazy (target popups).
 * @param {string} scripts
 * @returns {{status: 'installed'|'pending'|'not-found', source?: string, patch?: string}}
 */
export function planLazyHook(scripts) {
  return planInsert(scripts, {
    fn: 'loadLazy',
    marker: LAZY_MARKER,
    anchor: /^([ \t]*)await loadSections\(\s*main\s*\);/m,
    after: true,
    lines: (indent, unit) => [
      `${indent}if (${SECTION_TEST}) {`,
      `${indent}${unit}const { personalizeSectionsLazy } = await import('./personalization/sections.js');`,
      `${indent}${unit}${LAZY_MARKER};`,
      `${indent}}`,
    ],
  });
}

/**
 * @param {string} repo
 * @param {{applyHook?: boolean, dryRun?: boolean}} options
 * @returns {object} report
 */
export function installRuntime(repo, { applyHook = false, dryRun = false } = {}) {
  const report = {
    created: [], updated: [], unchanged: [], kept: [], warnings: [], hooks: {}, hook: null,
  };
  const scriptsPath = join(repo, 'scripts', 'scripts.js');
  let scripts = readText(scriptsPath);

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

  const configPath = join(repo, 'scripts', 'personalization', 'config.js');
  const site = readSiteConfig(readText(configPath) || (dryRun ? readFileSync(join(RUNTIME_DIR, 'scripts', 'personalization', 'config.js'), 'utf8') : ''));
  const siteChecks = checkSiteConfig(site);
  report.config = { consent: site.consent, errors: siteChecks.errors, warnings: siteChecks.warnings };

  const fragment = readText(join(repo, 'blocks', 'fragment', 'fragment.js')) || '';
  if (!/export\s+async\s+function\s+loadFragment/.test(fragment)) {
    report.warnings.push('blocks/fragment/fragment.js does not export loadFragment(path); the runtime needs it');
  }

  if (scripts === null) {
    report.hook = 'not-found';
    report.warnings.push('scripts/scripts.js not found');
    return report;
  }
  const plans = [
    ['sections', planSectionsHook, 'decorateMain(main) in loadEager'],
    ['lazy', planLazyHook, 'await loadSections(main) in loadLazy'],
  ];
  plans.forEach(([name, plan, anchor]) => {
    const hook = plan(scripts);
    if (hook.status === 'pending' && applyHook && !dryRun) {
      scripts = hook.source;
      report.hooks[name] = { status: 'applied', patch: hook.patch };
    } else if (hook.status === 'pending' && applyHook) {
      // dry run: later hooks plan against the would-be source
      scripts = hook.source;
      report.hooks[name] = { status: 'pending', patch: hook.patch };
    } else {
      report.hooks[name] = { status: hook.status, patch: hook.patch };
    }
    if (hook.status === 'not-found') {
      report.warnings.push(`could not find ${anchor}; add the ${name} hook by hand (see reference/client-mode.md)`);
    }
  });
  if (Object.values(report.hooks).some((hook) => hook.status === 'applied') && !dryRun) {
    writeFileSync(scriptsPath, scripts);
  }
  const states = Object.values(report.hooks).map((hook) => hook.status);
  report.hook = ['not-found', 'pending', 'applied'].find((state) => states.includes(state)) || 'installed';
  return report;
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const repo = args._[0] || process.cwd();
  const report = installRuntime(repo, {
    applyHook: !!args['apply-hook'], dryRun: !!args['dry-run'],
  });
  console.log(JSON.stringify(report, null, 2));
  const pending = Object.entries(report.hooks).filter(([, hook]) => hook.status === 'pending');
  if (pending.length && !args['dry-run']) {
    console.log(`\nscripts.js hooks not applied. Proposed change:\n${pending.map(([, hook]) => hook.patch).join('\n')}\nRe-run with --apply-hook to apply them.`);
  }
}
