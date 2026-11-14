#!/usr/bin/env node
/*
 * Validates personalized sections (Section Metadata, contract section 1) in
 * local content (.html / .plain.html), and the site config they rely on.
 * Read-only; exits 1 when anything has errors.
 *
 * Source content is read the way the pipeline renders it (Section Metadata
 * rows -> data-* attributes, html.js renderSectionMetadata), then parsed by
 * the runtime's own grammar (section-spec.js) and checked against the
 * contract's section.schema.json, so what passes here is what the browser
 * and the edge worker see.
 *
 * Section checks: grammar and cross-row rules, the section schema, unique
 * ids, rows the pipeline mangles, AEM Experimentation metadata on the
 * section or the page, fragments under the allowed prefixes and present
 * (locally under content/, or on --base-url), no nesting, TODO copy, the
 * same H1 as the authored content, registered audiences, engine limits
 * (config.api.engine), no slow engine on the first section in the browser,
 * configured sources, the first section (LCP).
 * Config checks: consent recorded (mode, tool, exceptions with their
 * approval), no removed options (providers, sendWithoutConsent), mocks.
 *
 * Usage: node validate-placeholders.mjs [files or dirs...] [--repo .]
 *          [--base-url http://localhost:3000] [--mode client|edge] [--json]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  importAsset, exitOnHelp, isMain, parseArgs, readText, sitePrefixes, status,
} from './lib.mjs';
import { check } from './schema.mjs';

export const USAGE = `Usage: node validate-placeholders.mjs [files or dirs...] [--repo .]
         [--base-url http://localhost:3000] [--mode client|edge] [--json]
Validates personalized sections (Section Metadata) in local content
(content/<path>.html or .plain.html) against the personalization contract:
grammar and the section schema, unique ids, rows the pipeline mangles, AEM
Experimentation on the section or page, fragments (prefixes, existence,
nesting, TODO copy, H1), registered audiences, engine limits, no slow engine
on the first section in the browser, source and consent config, LCP.
--mode: client or edge (default: edge when the repo has the skill's worker).
Read-only. Exit 1 when anything has errors.`;

const { stateKeysUsed } = await importAsset('runtime', 'scripts', 'personalization', 'rules.js');
const {
  parseSection, sectionCriteria, sectionObject, ATTRIBUTE, EXPERIMENTATION_META,
} = await importAsset('runtime', 'scripts', 'personalization', 'section-spec.js');
const { engineProfile, candidates: candidatesOf } = await importAsset('runtime', 'scripts', 'personalization', 'contract.js');
const {
  findSections, findBlocks, sections, renderSectionMetadata, textContent,
} = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');

const PERSONALIZED = /section-metadata|data-personalization/;
const EXCEPTIONS = ['rules', 'split', 'api', 'rum', 'data-layer'];
export const WORKER_MARKER = join('src', 'personalization', 'personalize.js');

function htmlFiles(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return target.endsWith('.html') ? [target] : [];
  return readdirSync(target).flatMap((name) => (name.startsWith('.') ? [] : htmlFiles(join(target, name))));
}

/**
 * Local file for a fragment path: content/<path>.html (the local DA
 * content tree) or content/<path>.plain.html.
 * @param {string} repo
 * @param {string} path
 * @returns {string|null}
 */
export function localFragment(repo, path) {
  const files = [`${path}.html`, `${path}.plain.html`].map((file) => join(repo, 'content', file));
  return files.find((file) => existsSync(file)) || null;
}

async function remoteFragment(baseUrl, path) {
  try {
    const response = await fetch(new URL(`${path}.plain.html`, baseUrl));
    return response.ok ? await response.text() : null;
  } catch (e) {
    return null;
  }
}

// The object literal after `key:` in a config source, braces balanced.
function configBlock(text, key) {
  const match = new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*\\{`).exec(text);
  if (!match) return null;
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(match.index + match[0].length, i);
  }
  return null;
}

const stringValue = (block, key) => {
  const match = block && new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(block);
  return match ? match[1] : '';
};

const listValue = (block, key) => {
  const match = block && new RegExp(`(?:^|[\\s,{])${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(block);
  return match ? [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]) : [];
};

/**
 * What the validator needs from scripts/personalization/config.js, read
 * textually (the browser module is never executed in Node).
 * @param {string} source config.js source
 * @returns {object}
 */
export function readSiteConfig(source = '') {
  const text = String(source || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const consent = configBlock(text, 'consent');
  const api = configBlock(text, 'api');
  const target = configBlock(text, 'target');
  return {
    present: !!text.trim(),
    consent: consent === null ? null : {
      mode: stringValue(consent, 'mode'),
      tool: stringValue(consent, 'tool'),
      withoutConsent: listValue(consent, 'withoutConsent'),
      policyRef: stringValue(consent, 'policyRef'),
    },
    apiEndpoint: stringValue(api, 'endpoint'),
    engine: stringValue(api, 'engine') || 'generic',
    targetClientCode: stringValue(target, 'clientCode'),
    targetTransport: stringValue(target, 'transport') || 'delivery-api',
    targetEndpoint: stringValue(target, 'endpoint'),
    mock: /(?:^|[\s,{])mock\s*:\s*(?!false\b|null\b|undefined\b|0\b)\S/.test(text),
    removed: ['providers', 'sendWithoutConsent'].filter((key) => new RegExp(`(?:^|[\\s,{])${key}\\s*:`).test(text)),
    audiences: configBlock(text, 'audiences') || '',
  };
}

/**
 * Problems of the site config (contract section 3 and site-config.schema.json).
 * @param {object} site readSiteConfig()
 * @returns {{errors: string[], warnings: string[], info: string[]}}
 */
export function checkSiteConfig(site) {
  const errors = [];
  const warnings = [];
  const info = [];
  if (!site.present) return { errors, warnings: ['scripts/personalization/config.js not found: run install-runtime.mjs'], info };
  site.removed.forEach((key) => errors.push(`config.${key} is not supported: ${key === 'providers' ? 'other engines use the decision engine API (config.api)' : 'record approved exceptions in config.consent.withoutConsent'}`));
  const { consent } = site;
  if (!consent || !consent.mode) {
    errors.push('config.consent.mode is not recorded (cmp, allow or deny)');
  } else {
    if (!['cmp', 'allow', 'deny'].includes(consent.mode)) errors.push(`config.consent.mode must be cmp, allow or deny, got "${consent.mode}"`);
    if (consent.mode === 'cmp' && !consent.tool) errors.push('config.consent.tool names the consent tool when mode is cmp');
    if (consent.mode !== 'cmp' && consent.tool) errors.push(`config.consent.tool is only for mode cmp (mode is ${consent.mode})`);
    if (consent.mode === 'allow' && consent.withoutConsent.length) errors.push('config.consent.withoutConsent has no meaning with mode allow');
    consent.withoutConsent.filter((name) => !EXCEPTIONS.includes(name))
      .forEach((name) => errors.push(`config.consent.withoutConsent: unknown exception "${name}" (${EXCEPTIONS.join(', ')})`));
    if (consent.withoutConsent.length && !consent.policyRef) errors.push('config.consent.withoutConsent needs policyRef: where privacy/legal recorded the approval');
    if (consent.mode === 'deny') warnings.push('consent mode is deny: every section shows its default until a consent tool is connected');
    if (consent.withoutConsent.length) info.push(`approved without consent: ${consent.withoutConsent.join(', ')} (${consent.policyRef})`);
  }
  if (site.targetTransport === 'websdk' && site.targetEndpoint) errors.push('config.target.endpoint is for the delivery-api transport only');
  if (!['delivery-api', 'websdk'].includes(site.targetTransport)) errors.push(`config.target.transport must be delivery-api or websdk, got "${site.targetTransport}"`);
  if (!['generic', 'of1'].includes(site.engine)) errors.push(`config.api.engine must be generic or of1, got "${site.engine}"`);
  if (site.mock) warnings.push('config.mock is on: tests and demos only, set it to false before launch');
  return { errors, warnings, info };
}

// Hosts a variant link may name: the site itself (relative links resolve to
// localhost here) or its aem.page / aem.live hosts.
const SITE_HOSTS = /^(localhost(:\d+)?|[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.(aem|hlx)\.(page|live))$/i;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function audienceWarnings(rules, site) {
  const warnings = [];
  rules.forEach((rule) => rule.clauses
    .filter((clause) => clause.criterion === 'audience')
    .forEach((clause) => clause.values.forEach((name) => {
      const registered = new RegExp(`['"\`]?${escapeRegExp(name)}['"\`]?\\s*:`).test(site.audiences);
      if (!registered) warnings.push(`audience "${name}" is not registered in scripts/personalization/config.js`);
    })));
  return warnings;
}

/**
 * AEM Experimentation page metadata: delivered <meta> tags or a source
 * Metadata block (Experiment, Campaign, Campaign-*, Audience-*).
 * @param {string} html
 * @returns {string|null} the first name found
 */
export function pageExperimentation(html) {
  const head = String(html).split(/<\/head>/i)[0];
  const meta = [...head.matchAll(/<meta\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    .find((name) => EXPERIMENTATION_META.test(name));
  if (meta) return meta;
  const row = findBlocks(html, 'metadata').flatMap((block) => block.rows)
    .map((entry) => textContent(entry.key).toLowerCase().replace(/[^0-9a-z:_-]+/g, '-'))
    .find((name) => EXPERIMENTATION_META.test(name));
  return row || null;
}

/**
 * Finds each fragment locally or on the preview and checks its content.
 * @returns {Promise<object[]>}
 */
async function checkFragments(targets, {
  repo, baseUrl, errors, warnings,
}) {
  return Promise.all(targets.map(async ({ variant, path }) => {
    const local = localFragment(repo, path);
    let content = local ? readText(local) : null;
    let where = local ? relative(repo, local) : null;
    if (!content && baseUrl) {
      content = await remoteFragment(baseUrl, path);
      where = content ? `${baseUrl}${path}` : null;
    }
    if (!content) {
      const message = `fragment for "${variant}" not found: ${path} (expected content${path}.html${baseUrl ? ` or ${baseUrl}${path}.plain.html` : ''})`;
      if (existsSync(join(repo, 'content')) || baseUrl) errors.push(message);
      else warnings.push(`${message}; pass --base-url to check a preview`);
      return { variant, path, found: false };
    }
    const nested = renderSectionMetadata(content).sections
      .some((section) => section.attributes.some(([name]) => name === ATTRIBUTE))
      || /\sdata-personalization=/.test(content);
    if (nested) errors.push(`fragment "${variant}" has a personalized section (nesting is not supported)`);
    if (/TODO:/.test(content)) warnings.push(`fragment "${variant}" still has TODO copy`);
    return {
      variant, path, found: true, where, h1: /<h1\b/i.test(content),
    };
  }));
}

function h1Warnings(fragments, authoredH1) {
  // Every variant keeps the authored heading structure: warn only on a mismatch.
  return fragments.filter((fragment) => fragment.found && fragment.h1 !== authoredH1)
    .map(({ variant, h1 }) => `fragment "${variant}" ${h1 ? 'adds an H1 the authored content lacks' : "drops the authored content's H1"}: keep the same heading structure in every variant (no cloaking)`);
}

function sourceInfo(spec) {
  if (spec.source === 'split') {
    return `A/B test: ${spec.split ? `${spec.split.join('% / ')}% to the variants, the rest to the default (control)` : `even split across the default (control) and ${spec.variants.length} variant(s)`}; assigned for the session, only with consent (or the approved split exception)`;
  }
  if (spec.source === 'target' && spec.display === 'popup') {
    const trigger = spec.trigger.type === 'scroll' ? `scroll past ${Math.round(spec.trigger.ratio * 100)}%` : spec.trigger.type;
    return `Target offer opens as a popup on ${trigger} at location "${spec.location || spec.id}"; the default stays in place`;
  }
  if (spec.source === 'target') return `Target location "${spec.location || spec.id}"; JSON offers { "fragment": ... } or { "control": true }`;
  if (spec.source === 'api') return `decision engine${spec.rules.length ? '; the Rule rows decide when it gives no usable answer' : '; the default shows when it gives no usable answer'}`;
  return null;
}

/**
 * Validates the personalized sections of one page.
 * @returns {Promise<object[]>}
 */
async function validateSections(html, {
  repo, prefixes, site, baseUrl, mode,
}) {
  if (!PERSONALIZED.test(html)) return [];
  const rendered = renderSectionMetadata(html);
  const source = sections(html);
  const profile = engineProfile(site.engine);
  const experiment = pageExperimentation(html);
  const seen = new Set();
  const list = findSections(rendered.html)
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.attributes.some(([name]) => name === ATTRIBUTE || name.startsWith(`${ATTRIBUTE}-`)));
  const apiCount = list.filter(({ section }) => (section.attributes.find(([name]) => name === `${ATTRIBUTE}-source`)?.[1] || '').trim().toLowerCase() === 'api').length;
  return Promise.all(list.map(async ({ section, index }) => {
    const spec = parseSection(section.attributes, { prefixes });
    const errors = [...spec.errors];
    const warnings = [...spec.warnings];
    const info = [];
    if (!spec.errors.length) {
      check('section', sectionObject(spec), { prefixes })
        .forEach((problem) => errors.push(`section schema: ${problem}`));
    }
    if (spec.id) {
      if (seen.has(spec.id)) errors.push(`id "${spec.id}" is used by more than one section on this page`);
      seen.add(spec.id);
    }
    if (experiment) errors.push(`the page has AEM Experimentation metadata (${experiment}): a page experiment gets no personalized sections; use split or Target for a section test`);
    // Rows the pipeline changes before the runtime sees them.
    const authored = rendered.sections.find((entry) => entry.index === index);
    (authored?.repeated || []).filter((key) => /^personalization/i.test(key.trim())).forEach((key) => {
      errors.push(`row "${key.trim()}" appears more than once: only its last value reaches the page${/rule/i.test(key) ? '; number further rules for a variant ("Personalization Rule India 2")' : ''}`);
    });
    (authored?.rows || []).filter((row) => /^personalization-rule/.test(row.name) && row.paragraphs > 1).forEach((row) => {
      errors.push(`"${row.key.trim()}" holds ${row.paragraphs} paragraphs: the pipeline joins them with "," which changes the condition; write it on one line (& for AND)`);
    });
    const range = source[index];
    const inner = range ? html.slice(range.openEnd, range.closeStart) : '';
    if (/TODO:/.test(inner.replace(/<div\b[^>]*class="section-metadata"[\s\S]*$/, ''))) warnings.push('the default (authored content) still has TODO copy');

    // Links to another site: only their path is used (a same-origin fragment).
    const links = section.attributes.find(([name]) => name === `${ATTRIBUTE}-variants`)?.[1] || '';
    links.split(',').map((item) => item.trim()).filter(Boolean).forEach((link) => {
      let host;
      try {
        ({ host } = new URL(link));
      } catch (e) {
        return;
      }
      if (!SITE_HOSTS.test(host)) warnings.push(`variant link ${link} points to another site: only its path is used, from this site`);
    });

    const used = sectionCriteria(spec);
    warnings.push(...audienceWarnings(spec.rules, site));
    if (spec.source === 'api') {
      const count = candidatesOf(spec).length;
      if (count < profile.minCandidates || count > profile.maxCandidates) {
        errors.push(`the ${site.engine} engine takes ${profile.minCandidates} to ${profile.maxCandidates} candidates per section (variants + default), this section has ${count}`);
      }
      if (index === 0 && profile.slow) {
        const message = `the ${site.engine} engine can be slower than the eager budget: it must not decide the first section in the browser`;
        if (mode === 'client') errors.push(`${message}; decide it at the edge or personalize a later section`);
        else warnings.push(`${message}; the edge decides it (the browser falls back to the Rule rows when the edge leaves it)`);
      }
      if (profile.descriptions && !Object.keys(spec.descriptions).length) {
        info.push(`${site.engine} reads candidate descriptions: the server route fills missing ones from the fragments and the default's text`);
      }
      if (site.present && !site.apiEndpoint && !site.mock) {
        warnings.push(`source is api but config.api.endpoint is empty: ${spec.rules.length ? 'the Rule rows decide' : 'visitors see the default'}`);
      }
    }
    if (spec.source === 'target' && site.present && !site.mock
      && site.targetTransport === 'delivery-api' && !site.targetClientCode && !site.targetEndpoint) {
      warnings.push('source is target but config.target.clientCode is empty: visitors see the default');
    }
    const about = sourceInfo(spec);
    if (about) info.push(about);
    if (index === 0 && spec.held && !errors.length) {
      warnings.push(`first section (LCP) stays hidden until decided (up to the eager budget) in client mode; ${spec.source === 'target' ? 'target is browser-only: personalize a later section or show it as a popup' : 'decide it at the edge or personalize a later section'}`);
    }
    if (['device', 'state', 'audience'].some((criterion) => used.has(criterion))) {
      info.push('uses browser-only criteria (device/state/audience): the edge leaves it to the browser');
    }
    const keys = [...stateKeysUsed(spec)];
    if (keys.length) info.push(`state keys: ${keys.join(', ')} (set with window.hlx.personalization.setState)`);

    const fragments = await checkFragments(spec.variants.map(({ name, path }) => ({ variant: name, path })), {
      repo, baseUrl, errors, warnings,
    });
    warnings.push(...h1Warnings(fragments, /<h1\b/i.test(inner)));
    return {
      id: spec.id || null,
      section: index,
      source: spec.source,
      display: spec.display,
      trigger: spec.trigger,
      split: spec.split,
      location: spec.location,
      variants: spec.variants,
      rules: spec.rules.map((rule) => ({ variant: rule.variant, condition: rule.condition })),
      fragments,
      errors,
      warnings,
      info,
    };
  })).then((results) => {
    if (apiCount > profile.sections && results.length) {
      results[0].errors.push(`the ${site.engine} engine takes at most ${profile.sections} api sections per page, this page has ${apiCount}`);
    }
    return results;
  });
}

/**
 * Validates one page.
 * @param {string} html page HTML (source content or delivered)
 * @param {object} options
 * @param {string} options.repo
 * @param {string[]} options.prefixes
 * @param {string} [options.config] scripts/personalization/config.js source
 * @param {string} [options.baseUrl]
 * @param {'client'|'edge'} [options.mode]
 * @returns {Promise<{sections: object[]}>}
 */
export async function validatePage(html, {
  repo, prefixes, config = '', baseUrl, mode = 'client',
}) {
  const personalized = await validateSections(html, {
    repo, prefixes, site: readSiteConfig(config), baseUrl, mode,
  });
  return { sections: personalized };
}

/**
 * Client + edge when the repo has the skill's worker.
 * @param {string} repo
 * @returns {'client'|'edge'}
 */
export function detectMode(repo) {
  const dirs = [join(repo, 'cdn', 'cloudflare-worker'), ...(existsSync(join(repo, 'cdn'))
    ? readdirSync(join(repo, 'cdn')).map((name) => join(repo, 'cdn', name)) : [])];
  return dirs.some((dir) => existsSync(join(dir, WORKER_MARKER))) ? 'edge' : 'client';
}

/**
 * @param {string[]} targets files or directories
 * @param {object} options
 * @returns {Promise<object>} report
 */
export async function validate(targets, { repo, baseUrl, mode } = {}) {
  const root = resolve(repo || process.cwd());
  const prefixes = sitePrefixes(root);
  const config = readText(join(root, 'scripts', 'personalization', 'config.js')) || '';
  const resolvedMode = mode || detectMode(root);
  const list = (targets.length ? targets : ['content']).flatMap((target) => htmlFiles(resolve(root, target)));
  const pages = [];
  await Promise.all(list.map(async (file) => {
    const html = readText(file);
    if (!PERSONALIZED.test(html)) return;
    const result = await validatePage(html, {
      repo: root, prefixes, config, baseUrl, mode: resolvedMode,
    });
    if (result.sections.length) pages.push({ file: relative(root, file), ...result });
  }));
  pages.sort((a, b) => a.file.localeCompare(b.file));
  const site = checkSiteConfig(readSiteConfig(config));
  const count = (items) => items.reduce((sum, item) => sum + item.errors.length, 0);
  const errorCount = pages.reduce((sum, page) => sum + count(page.sections), 0) + site.errors.length;
  return {
    prefixes, mode: resolvedMode, config: site, pages, errorCount, ok: errorCount === 0,
  };
}

function print(label, item) {
  status(!item.errors.length, label);
  item.errors.forEach((message) => console.log(`   ❌ ${message}`));
  item.warnings.forEach((message) => console.log(`   ⚠️ ${message}`));
  item.info.forEach((message) => console.log(`   ℹ️ ${message}`));
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const report = await validate(args._, {
    repo: args.repo,
    baseUrl: args['base-url'],
    mode: ['client', 'edge'].includes(args.mode) ? args.mode : undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(`site config (mode ${report.mode})`, report.config);
    if (!report.pages.length) console.log('⚠️ no personalized sections found');
    report.pages.forEach((page) => {
      page.sections.forEach((section) => print(`${page.file} → section ${section.section + 1} "${section.id ?? '?'}" (${section.source}${section.source === 'target' ? `, ${section.display}` : ''}, ${section.variants.length} variant(s) + default)`, section));
    });
    console.log(report.ok ? '\n✓ PASS all sections and the config are valid' : `\n❌ FAIL ${report.errorCount} error(s)`);
  }
  process.exit(report.ok ? 0 : 1);
}
