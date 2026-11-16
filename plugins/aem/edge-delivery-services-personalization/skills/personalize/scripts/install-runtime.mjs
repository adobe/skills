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
 * The report also lists what config.js still needs (the
 * consent mode, and hasConsent wired to the consent tool), which the skill
 * fills in after asking the user.
 *
 * --check-live <origin> installs nothing: it checks, before publishing, that
 * the live site (https://main--<repo>--<owner>.aem.live) serves this repo's
 * runtime: every skill-owned module and config.js byte for byte, and both
 * scripts.js hooks. It fails closed: a mismatch, a missing file or a network
 * error exits 1.
 *
 * Usage: node install-runtime.mjs [repoDir] [--apply-hook] [--dry-run]
 *        node install-runtime.mjs [repoDir] --check-live <origin> [--json]
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
       node install-runtime.mjs [repoDir] --check-live <origin> [--json]
Installs the personalization runtime into an EDS repo (idempotent). Skill-owned
files are updated when they differ; site-owned files (config.js,
styles/target-popup.css, blocks/fragment) are only created when missing.
scripts/scripts.js changes only with --apply-hook (the skill always passes it):
the section hooks in loadEager and loadLazy.
--check-live <origin> (before publishing; origin =
https://main--<repo>--<owner>.aem.live) installs nothing: PASS only when the
origin serves this repo's runtime modules and config.js byte for byte and
scripts.js has both hooks. Any mismatch, missing file or network error exits 1.`;

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

// What the live site must serve before a page is published.
export const LIVE_FILES = [
  ...RUNTIME_MODULES.map((name) => `scripts/personalization/${name}`),
  'scripts/personalization/config.js',
];

/**
 * Whether an origin serves this repo's runtime: a page is published
 * only once main serves the code.
 * @param {string} repo
 * @param {string} origin e.g. https://main--<repo>--<owner>.aem.live
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.timeout] ms per request
 * @returns {Promise<{origin: string, ok: boolean, checked: string[], problems: string[]}>}
 */
export async function checkLive(repo, origin, { fetchImpl = globalThis.fetch, timeout = 10000 } = {}) {
  const problems = [];
  const fetchText = async (path) => {
    try {
      const response = await fetchImpl(new URL(`/${path}`, origin), { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) return { problem: `${path}: HTTP ${response.status} from ${origin}` };
      return { text: await response.text() };
    } catch (error) {
      return { problem: `${path}: could not be fetched from ${origin} (${error.message})` };
    }
  };
  await Promise.all(LIVE_FILES.map(async (path) => {
    const local = readText(join(repo, path));
    if (local === null) {
      problems.push(`${path} is not in the repo: install the runtime first`);
      return;
    }
    const live = await fetchText(path);
    if (live.problem) problems.push(live.problem);
    else if (live.text !== local) problems.push(`${path}: ${origin} serves another version than this repo (merge and wait for main, or check the branch)`);
  }));
  const scripts = await fetchText('scripts/scripts.js');
  if (scripts.problem) problems.push(scripts.problem);
  else {
    [SECTIONS_MARKER, LAZY_MARKER].filter((marker) => !scripts.text.includes(marker))
      .forEach((marker) => problems.push(`scripts/scripts.js on ${origin} has no ${marker} hook`));
  }
  problems.sort();
  return {
    origin, ok: !problems.length, checked: [...LIVE_FILES, 'scripts/scripts.js'], problems,
  };
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const repo = args._[0] || process.cwd();
  if (args['check-live'] !== undefined) {
    const origin = args['check-live'];
    if (typeof origin !== 'string' || !/^https?:\/\/[^/]+/.test(origin)) {
      console.error(`❌ --check-live needs the live origin (https://main--<repo>--<owner>.aem.live)\n${USAGE}`);
      process.exit(2);
    }
    const live = await checkLive(repo, origin);
    if (args.json) console.log(JSON.stringify(live, null, 2));
    else {
      live.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
      console.log(live.ok
        ? `✓ PASS ${origin} serves this repo's runtime (${live.checked.length} files) and both hooks`
        : `❌ FAIL ${origin} does not serve this repo's runtime: stay at preview`);
    }
    process.exit(live.ok ? 0 : 1);
  }
  const report = installRuntime(repo, {
    applyHook: !!args['apply-hook'], dryRun: !!args['dry-run'],
  });
  console.log(JSON.stringify(report, null, 2));
  const pending = Object.entries(report.hooks).filter(([, hook]) => hook.status === 'pending');
  if (pending.length && !args['dry-run']) {
    console.log(`\nscripts.js hooks not applied. Proposed change:\n${pending.map(([, hook]) => hook.patch).join('\n')}\nRe-run with --apply-hook to apply them.`);
  }
}
