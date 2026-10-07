#!/usr/bin/env node
/*
 * Validates Personalization blocks in local content (.html / .plain.html).
 * Read-only; exits 1 when any placeholder has errors.
 *
 * Checks: grammar (rules.js parseSpec), unique ids per page, a default row,
 * fragments under the allowed prefixes and present (locally under content/,
 * or on --base-url), no nested placeholders, custom audiences registered in
 * config.js, decision API configured for `source | api`, SEO risks (H1).
 *
 * Usage: node validate-placeholders.mjs [files or dirs...] [--repo .]
 *          [--base-url http://localhost:3000] [--json]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  importAsset, exitOnHelp, isMain, parseArgs, readText, sitePrefixes, status,
} from './lib.mjs';

export const USAGE = `Usage: node validate-placeholders.mjs [files or dirs...] [--repo .]
         [--base-url http://localhost:3000] [--json]
Validates Personalization blocks in local content (content/<path>.html or
.plain.html): grammar, unique ids, default row, fragment prefixes and existence,
nested placeholders, registered audiences, API config, H1 risk. Read-only.
Exit 1 when any placeholder has errors.`;


const { parseSpec, criteriaUsed, stateKeysUsed } = await importAsset('runtime', 'scripts', 'personalization', 'rules.js');
const { findBlocks, sections } = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');

function htmlFiles(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return target.endsWith('.html') ? [target] : [];
  return readdirSync(target).flatMap((name) => (name.startsWith('.') ? [] : htmlFiles(join(target, name))));
}

/**
 * Local file for a fragment path: content/<path>.html (the stardust/DA
 * content tree) or content/<path>.plain.html.
 * @param {string} repo
 * @param {string} path
 * @returns {string|null}
 */
export function localFragment(repo, path) {
  const candidates = [`${path}.html`, `${path}.plain.html`].map((file) => join(repo, 'content', file));
  return candidates.find((file) => existsSync(file)) || null;
}

async function remoteFragment(baseUrl, path) {
  try {
    const response = await fetch(new URL(`${path}.plain.html`, baseUrl));
    return response.ok ? await response.text() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Validates one page.
 * @param {string} html page HTML
 * @param {object} options
 * @param {string} options.repo
 * @param {string[]} options.prefixes
 * @param {string} [options.config] scripts/personalization/config.js source
 * @param {string} [options.baseUrl]
 * @returns {Promise<{placeholders: object[]}>}
 */
export async function validatePage(html, {
  repo, prefixes, config = '', baseUrl,
}) {
  const blocks = findBlocks(html);
  const pageSections = sections(html);
  const seen = new Set();
  const placeholders = await Promise.all(blocks.map(async (block) => {
    const spec = parseSpec(block.rows, { prefixes });
    const errors = [...spec.errors];
    const warnings = [...spec.warnings];
    const info = [];
    if (spec.id) {
      if (seen.has(spec.id)) errors.push(`id "${spec.id}" is used by more than one placeholder on this page`);
      seen.add(spec.id);
    }
    if (block.rows.some((row) => /class="[^"]*\bpersonalization\b/.test(row.html))) {
      errors.push('nested Personalization blocks are not supported');
    }
    const sectionIndex = pageSections.findIndex((section) => section.start <= block.start && block.end <= section.end);
    const used = criteriaUsed(spec);
    if (sectionIndex === 0 && (used.has('geo') || spec.source === 'api')) {
      info.push('first-section placeholder decided by geo/API: client mode costs a round trip before LCP; consider edge mode');
    }
    if (['device', 'state', 'audience'].some((criterion) => used.has(criterion))) {
      info.push('uses browser-only criteria (device/state/audience): always decided in the browser');
    }
    spec.rules.forEach((rule) => rule.clauses
      .filter((clause) => clause.criterion === 'audience')
      .forEach((clause) => clause.values.forEach((name) => {
        const registered = new RegExp(`['"\`]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]?\\s*:`).test(config);
        if (!registered) warnings.push(`audience "${name}" is not registered in scripts/personalization/config.js`);
      })));
    if (spec.source === 'api' && config && !/endpoint\s*:\s*['"`][^'"`]+['"`]/.test(config.split('api:')[1] || '')) {
      warnings.push('source is api but config.api.endpoint is empty: rules and default will be used');
    }
    const keys = [...stateKeysUsed(spec)];
    if (keys.length) info.push(`state keys: ${keys.join(', ')} (set with window.hlx.personalization.setState)`);

    const targets = [
      ...spec.rules.map((rule) => ({ variant: rule.variant, path: rule.target.path })),
      ...(spec.default?.type === 'fragment' ? [{ variant: 'default', path: spec.default.path }] : []),
    ];
    const fragments = await Promise.all(targets.map(async ({ variant, path }) => {
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
      if (/<h1\b/i.test(content)) warnings.push(`fragment "${variant}" contains an H1: variants must keep equivalent headings (no cloaking)`);
      if (/class="[^"]*\bpersonalization\b/.test(content)) errors.push(`fragment "${variant}" contains a Personalization block (nesting is not supported)`);
      if (/TODO:/.test(content)) warnings.push(`fragment "${variant}" still has TODO copy`);
      return {
        variant, path, found: true, where,
      };
    }));
    if (spec.default?.type === 'inline' && block.rows.some((row) => row.key.toLowerCase() === 'default' && /<h1\b/i.test(row.html))) {
      warnings.push('inline default holds the H1: keep it equivalent across variants');
    }
    return {
      id: spec.id || null,
      section: sectionIndex,
      source: spec.source,
      variants: spec.rules.map((rule) => ({ variant: rule.variant, condition: rule.condition })),
      default: spec.default,
      fragments,
      errors,
      warnings,
      info,
    };
  }));
  return { placeholders };
}

/**
 * @param {string[]} targets files or directories
 * @param {object} options
 * @returns {Promise<object>} report
 */
export async function validate(targets, { repo, baseUrl } = {}) {
  const root = resolve(repo || process.cwd());
  const prefixes = sitePrefixes(root);
  const config = readText(join(root, 'scripts', 'personalization', 'config.js')) || '';
  const list = (targets.length ? targets : ['content']).flatMap((target) => htmlFiles(resolve(root, target)));
  const pages = [];
  await Promise.all(list.map(async (file) => {
    const html = readText(file);
    if (!/class="[^"]*\bpersonalization\b/.test(html)) return;
    const result = await validatePage(html, {
      repo: root, prefixes, config, baseUrl,
    });
    pages.push({ file: relative(root, file), ...result });
  }));
  pages.sort((a, b) => a.file.localeCompare(b.file));
  const errorCount = pages.reduce((sum, page) => sum
    + page.placeholders.reduce((inner, placeholder) => inner + placeholder.errors.length, 0), 0);
  return {
    prefixes, pages, errorCount, ok: errorCount === 0,
  };
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const report = await validate(args._, { repo: args.repo, baseUrl: args['base-url'] });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (!report.pages.length) console.log('⚠️ no Personalization blocks found');
    report.pages.forEach((page) => {
      page.placeholders.forEach((placeholder) => {
        status(!placeholder.errors.length, `${page.file} → placeholder "${placeholder.id ?? '?'}" (section ${placeholder.section + 1}, ${placeholder.variants.length} variant(s) + default)`);
        placeholder.errors.forEach((message) => console.log(`   ❌ ${message}`));
        placeholder.warnings.forEach((message) => console.log(`   ⚠️ ${message}`));
        placeholder.info.forEach((message) => console.log(`   ℹ️ ${message}`));
      });
    });
    console.log(report.ok ? '\n✓ PASS all placeholders valid' : `\n❌ FAIL ${report.errorCount} error(s)`);
  }
  process.exit(report.ok ? 0 : 1);
}
