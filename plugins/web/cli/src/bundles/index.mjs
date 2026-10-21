import { FILES } from '#src/bundles/files.mjs';

/**
 * Read a bundled browser-side asset.
 * @param {string} name file name, e.g. `stealth-init.js`
 * @returns {string}
 */
export function loadBundle(name) {
  if (!(name in FILES)) throw new Error(`unknown bundle: ${name}`);
  return FILES[name];
}
