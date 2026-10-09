#!/usr/bin/env node
/*
 * Preflight: reports what the personalization skill needs to know about a
 * repo, as JSON. Read-only.
 *
 * Usage: node detect-project.mjs [repoDir]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  RUNTIME_DIR, RUNTIME_MODULES, findLoadEager, exitOnHelp, isMain, parseArgs, readJson, readText,
} from './lib.mjs';

export const USAGE = `Usage: node detect-project.mjs [repoDir]
Preflight report (JSON) of what personalize needs to know about an EDS repo:
project type (da | xwalk | doc), scripts.js hook, fragment block, runtime files,
integrations (Target, experimentation, martech, consent, data layer), content
placeholders, edge worker (edge.cloudflare: a wrangler config or worker in the
repo), lint. Read-only. Exit 0 = DA project, 3 = unsupported.`;


function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  readdirSync(dir).forEach((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return;
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file, predicate, out);
    else if (predicate(file)) out.push(file);
  });
  return out;
}

/**
 * @param {string} repo
 * @returns {{type: string, source: string}}
 */
export function projectType(repo) {
  const fstab = readText(join(repo, 'fstab.yaml')) || '';
  if (/author-|adobeaemcloud\.com|adobecqms\.net/.test(fstab)
    || existsSync(join(repo, 'component-models.json'))) {
    return { type: 'xwalk', source: 'fstab.yaml / component-models.json' };
  }
  if (/drive\.google\.com|sharepoint\.com/.test(fstab)) return { type: 'doc', source: 'fstab.yaml' };
  return { type: 'da', source: 'default (no xwalk or document-based markers)' };
}

/**
 * @param {string} repo
 * @returns {object}
 */
export function detect(repo) {
  const { type, source } = projectType(repo);
  const scripts = readText(join(repo, 'scripts', 'scripts.js'));
  const eager = (scripts && findLoadEager(scripts)?.body) || '';
  const fragment = readText(join(repo, 'blocks', 'fragment', 'fragment.js'));
  const head = readText(join(repo, 'head.html')) || '';
  const allCode = [scripts || '', readText(join(repo, 'scripts', 'delayed.js')) || '', head].join('\n');

  const runtimeFiles = {};
  RUNTIME_MODULES.forEach((name) => {
    const site = readText(join(repo, 'scripts', 'personalization', name));
    const asset = readText(join(RUNTIME_DIR, 'scripts', 'personalization', name));
    runtimeFiles[name] = site === null ? 'missing' : (site === asset ? 'current' : 'differs');
  });
  const blockFiles = ['personalization.js', 'personalization.css'].map((name) => existsSync(join(repo, 'blocks', 'personalization', name)));

  const contentDir = join(repo, 'content');
  const pages = walk(contentDir, (file) => file.endsWith('.html'));
  const withPlaceholders = pages
    .filter((file) => /class="[^"]*\bpersonalization\b/.test(readText(file)))
    .map((file) => relative(repo, file));

  const wranglers = walk(repo, (file) => /wrangler\.(toml|jsonc?)$/.test(file)).map((file) => relative(repo, file));
  const personalizedWorker = existsSync(join(repo, 'cdn', 'cloudflare-worker', 'src', 'personalization', 'personalize.js'));
  const pkg = readJson(join(repo, 'package.json')) || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const supported = type === 'da';
  return {
    repo,
    projectType: type,
    projectTypeSource: source,
    supported,
    reason: supported ? undefined : `personalize supports DA projects only (this is "${type}")`,
    scriptsJs: {
      exists: !!scripts,
      hasLoadEager: !!eager,
      decorateMainInLoadEager: /decorateMain\(\s*main\s*\)/.test(eager),
      hookInstalled: /initPersonalization\s*\(/.test(eager),
      autoBlocksFragments: !!scripts && /a\[href\*=["']\/fragments\/["']\]/.test(scripts),
    },
    fragmentBlock: {
      exists: !!fragment,
      exportsLoadFragment: !!fragment && /export\s+async\s+function\s+loadFragment/.test(fragment),
    },
    runtime: {
      installed: Object.values(runtimeFiles).every((state) => state !== 'missing') && blockFiles.every(Boolean),
      files: runtimeFiles,
      block: blockFiles.every(Boolean),
      config: existsSync(join(repo, 'scripts', 'personalization', 'config.js')),
    },
    integrations: {
      experimentation: existsSync(join(repo, 'plugins', 'experimentation')) || /experimentation/.test(allCode),
      martech: existsSync(join(repo, 'plugins', 'martech')) || /aem-martech|plugins\/martech/.test(allCode),
      target: /alloy|at\.js|adobe\.target|propositions/.test(allCode),
      adobeDataLayer: /adobeDataLayer/.test(allCode),
      launch: /assets\.adobedtm\.com|launch-[a-z0-9]+\.min\.js/.test(allCode),
      tealium: /tags\.tiqcdn\.com|utag\.js/.test(allCode),
      consent: (/onetrust|optanon/i.test(allCode) && 'onetrust')
        || (/cookiebot/i.test(allCode) && 'cookiebot')
        || (/consent/i.test(allCode) && 'custom') || null,
    },
    content: {
      dir: existsSync(contentDir) ? 'content' : null,
      pages: pages.length,
      pagesWithPlaceholders: withPlaceholders,
    },
    edge: {
      // The site fronts its own Cloudflare: the skill's default mode is then client + edge.
      cloudflare: wranglers.length > 0 || personalizedWorker,
      wranglerConfigs: wranglers,
      personalizedWorker,
      hlxignoresCdn: /^\/?cdn\/?(\*\*)?$/m.test(readText(join(repo, '.hlxignore')) || ''),
    },
    lint: {
      script: !!pkg.scripts?.lint,
      eslint: !!deps.eslint,
      stylelint: !!deps.stylelint,
      nodeModules: existsSync(join(repo, 'node_modules')),
    },
  };
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const repo = args._[0] || process.cwd();
  const report = detect(repo);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.supported ? 0 : 3);
}
