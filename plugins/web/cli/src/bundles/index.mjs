import { readFileSync } from 'node:fs';

/**
 * Read a bundled asset that sits next to this module.
 * @param {string} name file name, e.g. `stealth-init.js`
 * @returns {string}
 */
export function loadBundle(name) {
  return readFileSync(new URL(name, import.meta.url), 'utf-8');
}
