import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError } from '#src/errors.mjs';
import { loadBundle } from '#src/bundles/index.mjs';

/** Where `--save-recipe` writes, and what is loaded when it exists and `--recipe` is not given. */
export const DEFAULT_RECIPE = 'recipe.json';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBoolean = (v) => typeof v === 'boolean';
const isStrings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

// Each type's known entry fields and what they must be; other fields are left alone.
const SCHEMA = {
  probe: {
    config: [isObject, 'an object'],
    persistent: [isBoolean, 'a boolean'],
    stealth: [isBoolean, 'a boolean'],
  },
  overlays: { rules: [isStrings, 'an array of strings'] },
};
const TYPES = Object.keys(SCHEMA);
const HINT = 'produce one with: web probe <url> --save-recipe, or web page overlays --save-recipe';

/**
 * Read a recipe file: one object, one array of entries per recipe type
 * (`probe`, `overlays`).
 * @param {string} path
 * @returns {Record<string, object[]>}
 */
export function readRecipe(path) {
  let recipe;
  try {
    recipe = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError('USAGE', `cannot read recipe ${path}: ${err.message}`, { hint: HINT });
  }
  if (!isObject(recipe)) {
    throw new CliError('USAGE', `recipe ${path} must be a JSON object`, { hint: HINT });
  }
  const unknown = Object.keys(recipe).filter((key) => !TYPES.includes(key));
  if (unknown.length > 0) {
    throw new CliError('USAGE', `recipe ${path} has unknown keys: ${unknown.join(', ')}`, {
      hint: `a recipe holds one array per type (${TYPES.join(', ')}); ${HINT}`,
    });
  }
  for (const [type, entries] of Object.entries(recipe)) checkEntries(path, type, entries);
  return recipe;
}

function checkEntries(path, type, entries) {
  const invalid = (where, expected) =>
    new CliError('USAGE', `recipe ${path}: ${where} must be ${expected}`, { hint: HINT });
  if (!Array.isArray(entries)) throw invalid(type, 'an array');
  entries.forEach((entry, i) => {
    if (!isObject(entry)) throw invalid(`${type}[${i}]`, 'an object');
    for (const [field, [valid, expected]] of Object.entries(SCHEMA[type])) {
      if (field in entry && !valid(entry[field])) throw invalid(`${type}[${i}].${field}`, expected);
    }
  });
}

/**
 * Replace the entries of one recipe type in a recipe file, keeping the other types. A file that
 * exists but is not a recipe is an error, never overwritten.
 * @returns {string} absolute path written
 */
export function saveRecipe(path, type, entries) {
  const file = resolve(path);
  const recipe = existsSync(file) ? readRecipe(file) : {};
  writeFileSync(file, `${JSON.stringify({ ...recipe, [type]: entries }, null, 2)}\n`);
  return file;
}

// An init script runs before the document has a root element, hence the observer.
function hideScript(rules) {
  return `(() => {
  const css = ${JSON.stringify(rules.join('\n'))};
  const add = () => {
    const root = document.head || document.documentElement;
    if (!root) return false;
    const style = document.createElement('style');
    style.setAttribute('data-web-recipe', 'overlays');
    style.textContent = css;
    root.appendChild(style);
    return true;
  };
  if (add()) return;
  const observer = new MutationObserver(() => add() && observer.disconnect());
  observer.observe(document, { childList: true });
})();
`;
}

const withoutTypes = (recipe, skip) =>
  Object.fromEntries(Object.entries(recipe).filter(([type]) => !skip.includes(type)));

/**
 * Turn a recipe into browser launch options. Types in `skip` are ignored: recording a type
 * must not replay it.
 * @param {string} path
 * @param {{ skip?: string[] }} [options]
 * @returns {{ config: object | undefined, persistent: boolean, initSources: string[] }}
 */
export function loadRecipe(path, { skip = [] } = {}) {
  const { probe = [], overlays = [] } = withoutTypes(readRecipe(path), skip);
  const initSources = [];
  if (probe[0]?.stealth) initSources.push(loadBundle('stealth-init.js'));
  const rules = overlays.flatMap((entry) => entry.rules ?? []);
  if (rules.length > 0) initSources.push(hideScript(rules));
  return { config: probe[0]?.config, persistent: probe[0]?.persistent === true, initSources };
}

/**
 * Launch options for `driver.open`: the recipe's, overridden by every explicit value that is
 * not undefined.
 * @param {string | undefined} recipePath
 * @param {object} explicit
 * @param {{ skip?: string[] }} [options] recipe types to leave out
 */
export function resolveLaunch(recipePath, explicit = {}, options = {}) {
  const set = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
  return { ...(recipePath ? loadRecipe(recipePath, options) : {}), ...set };
}
