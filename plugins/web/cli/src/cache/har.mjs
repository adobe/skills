import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '#src/errors.mjs';

/**
 * @typedef {object} HarResponse
 * @property {number} status
 * @property {Record<string, string | string[]>} headers
 * @property {() => Buffer} body
 */

const STRIPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/** @param {string} url */
export function harFileName(url) {
  const sha8 = createHash('sha256').update(url).digest('hex').slice(0, 8);
  return `${new URL(url).hostname}_${sha8}.har`;
}

/** @param {string} file */
function readHar(file) {
  try {
    const har = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(har?.log?.entries)) throw new Error('missing log.entries');
    return har;
  } catch (err) {
    throw new CliError('USAGE', `cannot read HAR ${path.basename(file)}: ${err.message}`, {
      hint: 'Re-record it with `web cache record`, or delete the file.',
    });
  }
}

/**
 * Remove failed (status <= 0) entries from a HAR file, rewriting it in place.
 * @param {string} harPath
 * @returns {{ entries: number, dropped: number }}
 */
export function dropFailedEntries(harPath) {
  const har = readHar(harPath);
  const before = har.log.entries.length;
  har.log.entries = har.log.entries.filter((e) => e.response.status > 0);
  writeFileSync(harPath, JSON.stringify(har));
  return { entries: har.log.entries.length, dropped: before - har.log.entries.length };
}

/** @param {{ name: string, value: string }[]} list */
function cleanHeaders(list) {
  /** @type {Record<string, string | string[]>} */
  const headers = {};
  for (const { name, value } of list ?? []) {
    const key = name.toLowerCase();
    if (key.startsWith(':') || STRIPPED_HEADERS.has(key)) continue;
    const prev = headers[key];
    if (key === 'set-cookie') headers[key] = [...(prev ?? []), value];
    else headers[key] = prev === undefined ? value : `${prev}, ${value}`;
  }
  return headers;
}

/** `p` with symlinks resolved; as given when it does not exist (reading it fails later). */
function realOrSelf(p) {
  return existsSync(p) ? realpathSync(p) : p;
}

/**
 * Absolute path of a HAR body file, symlinks resolved, or null when it lies outside `dir`.
 * @param {string} dir
 * @param {string} file the HAR entry's `_file`
 */
export function bodyPath(dir, file) {
  const root = realpathSync(dir);
  const resolved = realOrSelf(path.resolve(root, file));
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/**
 * @param {string} dir
 * @param {{ _file?: string, text?: string, encoding?: string }} [content]
 */
function bodyReader(dir, content = {}) {
  if (content._file) {
    const file = bodyPath(dir, content._file);
    if (!file) {
      throw new CliError('USAGE', `HAR body path escapes the cache dir: ${content._file}`, {
        hint: 'Delete the HAR file, or re-record it with `web cache record`.',
      });
    }
    return () => readFileSync(file);
  }
  if (content.text) {
    const encoding = content.encoding === 'base64' ? 'base64' : 'utf8';
    return () => Buffer.from(content.text, encoding);
  }
  return () => Buffer.alloc(0);
}

/**
 * Index every `*.har` in `dir` by `${method} ${url}`; later files (sorted) win.
 * @param {string} dir
 * @returns {Map<string, HarResponse>}
 */
export function loadHarIndex(dir) {
  const index = new Map();
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.har'))
    .sort()) {
    for (const { request, response } of readHar(path.join(dir, name)).log.entries) {
      const key = `${request.method} ${request.url}`;
      const body = bodyReader(dir, response.content);
      if (response.status === 304 && index.has(key)) continue;
      index.set(key, {
        status: response.status,
        headers: cleanHeaders(response.headers),
        body,
      });
    }
  }
  return index;
}
