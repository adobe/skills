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
  RUNTIME_DIR, RUNTIME_MODULES, exitOnHelp, importAsset, isMain, parseArgs, readJson, readText,
} from './lib.mjs';
import { LAZY_MARKER, SECTIONS_MARKER, findFunction } from './install-runtime.mjs';
import { readSiteConfig, checkSiteConfig } from './validate-placeholders.mjs';

export const USAGE = `Usage: node detect-project.mjs [repoDir]
Preflight report (JSON) of what personalize needs to know about an EDS repo:
project type (da | xwalk | doc), scripts.js hooks, who renders Section Metadata
(pipeline or aem.js), fragment block, runtime files, integrations (Target at.js /
Web SDK, Launch, experimentation, martech, consent tool, data layer), the
recorded consent config (contract section 3), content
(personalized sections, experimentation sections), edge worker (edge.cloudflare: a wrangler config or worker in the
repo), lint. Read-only. Exit 0 = DA project, 3 = unsupported.`;

const { renderSectionMetadata } = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');


// Consent tools the skill can wire hasConsent to (contract section 3), with
// the code that shows each one is on the site.
export const CONSENT_TOOLS = [
  ['onetrust', /OnetrustActiveGroups|OptanonWrapper|optanon|onetrust/i],
  ['cookiebot', /Cookiebot\.consent|consent\.cookiebot\.com|CookiebotOnAccept/],
  ['usercentrics', /usercentrics|\bUC_UI|ucEvent/i],
  ['didomi', /didomi/i],
  ['trustarc', /trustarc|truste\.com|truste_eu/i],
  ['adobe-websdk', /alloy\(\s*['"]setConsent|defaultConsent/],
  ['custom', /consent\.update/],
];

/**
 * Consent tools found in the site's code.
 * @param {string} code
 * @returns {string[]}
 */
export function consentTools(code) {
  return CONSENT_TOOLS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

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
  const eager = (scripts && findFunction(scripts, 'loadEager')?.body) || '';
  const lazy = (scripts && findFunction(scripts, 'loadLazy')?.body) || '';
  const aem = readText(join(repo, 'scripts', 'aem.js')) || '';
  const decorateSections = findFunction(aem, 'decorateSections')?.body || '';
  const fragment = readText(join(repo, 'blocks', 'fragment', 'fragment.js'));
  const head = readText(join(repo, 'head.html')) || '';
  const allCode = [scripts || '', readText(join(repo, 'scripts', 'delayed.js')) || '', head,
    ...walk(join(repo, 'scripts'), (file) => /\.js$/.test(file) && !file.includes(join('scripts', 'personalization')))
      .map((file) => readText(file) || '')].join('\n');
  const configSource = readText(join(repo, 'scripts', 'personalization', 'config.js'));
  const site = readSiteConfig(configSource || '');
  const siteChecks = checkSiteConfig(site);

  const runtimeFiles = {};
  RUNTIME_MODULES.forEach((name) => {
    const site = readText(join(repo, 'scripts', 'personalization', name));
    const asset = readText(join(RUNTIME_DIR, 'scripts', 'personalization', name));
    runtimeFiles[name] = site === null ? 'missing' : (site === asset ? 'current' : 'differs');
  });

  const contentDir = join(repo, 'content');
  const pages = walk(contentDir, (file) => file.endsWith('.html'));
  const withSections = [];
  const withExperiments = [];
  pages.forEach((file) => {
    const html = readText(file) || '';
    const page = relative(repo, file);
    if (!/section-metadata|data-personalization|data-experiment|data-audience|data-campaign/.test(html)) return;
    // Source content (Section Metadata blocks) or delivered HTML (data-* attributes).
    const names = renderSectionMetadata(html).sections.flatMap((section) => section.attributes.map(([name]) => name))
      .concat([...html.matchAll(/\s(data-[a-z0-9:_-]+)=/gi)].map((match) => match[1].toLowerCase()));
    if (names.includes('data-personalization')) withSections.push(page);
    if (names.some((name) => /^data-(experiment|campaign|audience)\b/.test(name))) withExperiments.push(page);
  });

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
      loadSectionsInLoadLazy: /await loadSections\(\s*main\s*\)/.test(lazy),
      sectionsHookInstalled: eager.includes(SECTIONS_MARKER),
      lazyHookInstalled: lazy.includes(LAZY_MARKER),
      autoBlocksFragments: !!scripts && /a\[href\*=["']\/fragments\/["']\]/.test(scripts),
    },
    sectionMetadata: {
      // Older aem.js turns Section Metadata into data-* attributes itself;
      // current aem.js leaves it to the pipeline (rendering v2, or sites
      // created on or after 2026-05-01).
      renderedBy: /section-metadata/.test(decorateSections) ? 'aem.js' : 'pipeline',
    },
    fragmentBlock: {
      exists: !!fragment,
      exportsLoadFragment: !!fragment && /export\s+async\s+function\s+loadFragment/.test(fragment),
    },
    runtime: {
      installed: Object.values(runtimeFiles).every((state) => state !== 'missing'),
      files: runtimeFiles,
      config: configSource !== null,
      popupStyles: existsSync(join(repo, 'styles', 'target-popup.css')),
    },
    integrations: {
      experimentation: existsSync(join(repo, 'plugins', 'experimentation')) || /experimentation/.test(allCode),
      martech: existsSync(join(repo, 'plugins', 'martech')) || /aem-martech|plugins\/martech/.test(allCode),
      target: /alloy|\bat(\.min)?\.js|adobe\.target|propositions/.test(allCode),
      atjs: /\bat(\.min)?\.js|adobe\.target|mboxCreate|getOffers/.test(allCode),
      websdk: /alloy|@adobe\/alloy|propositions|sendEvent/.test(allCode),
      adobeDataLayer: /adobeDataLayer/.test(allCode),
      launch: /assets\.adobedtm\.com|launch-[a-z0-9]+\.min\.js/.test(allCode),
      tealium: /tags\.tiqcdn\.com|utag\.js/.test(allCode),
      consentTools: consentTools(allCode),
    },
    // What the site recorded (config.consent), and what the setup must still ask.
    consent: {
      recorded: site.consent,
      problems: configSource === null ? [] : siteChecks.errors,
      ask: !site.consent?.mode,
    },
    content: {
      dir: existsSync(contentDir) ? 'content' : null,
      pages: pages.length,
      pagesWithSections: withSections,
      pagesWithExperiments: withExperiments,
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
