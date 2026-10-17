// skills/reskin/scripts/deployed/preview.mjs — A0 of the deployed leg: where the branch preview is, whether the
// project can have one, whether the page's authored form is there, and whether the page keeps to its namespace
// in a shared repo. Writes <dir>/.work/reskin/gates/<slug>/deployed/preview.json, the record every later step reads.
//   previewOrigin({ org, repo, branch })     https://<branch>--<repo>--<org>.aem.page (the host label is at most 63 characters)
//   eligibility(root)                        { ok: true } | { ok: false, reason }: an aem-boilerplate project
//   metadataRows(plainHtml)                  the `metadata` block's rows, { <lower-cased key>: <text> }
//   isolation({ path, rows, namespace, sandbox })  the ways the page touches shared documents
//   runPreview({ dir, slug, org, repo, branch, path, namespace, sandbox, auth, maxWaitSec })  the PreviewRecord
// DEPLOY_VERIFY_ORIGIN (env) replaces the origin: the hook the fake-preview tests use. The Authorization header is
// sent to the preview origin only (a redirect is never followed) and is never part of the record.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { deployedDir } from './io.mjs';

const REQUIRED = ['stardust/runtime-contract.json', 'head.html', 'scripts/aem.js'];
const LABEL_MAX = 63;
const POLL_MS = 1000;
const REQUEST_MS = 10000;

export function previewOrigin({ org, repo, branch }) {
  const label = `${branch}--${repo}--${org}`;
  if (label.length > LABEL_MAX) {
    throw new UsageError(`the preview host label "${label}" is ${label.length} characters, over the ${LABEL_MAX}-character DNS limit: the host would not resolve; shorten the branch`);
  }
  return `https://${label}.aem.page`;
}

// The leg needs deploy's runtime probe output and the boilerplate's head.html and scripts/aem.js at the project root.
export function eligibility(root) {
  const missing = REQUIRED.filter((rel) => !existsSync(join(root, rel)));
  return missing.length
    ? { ok: false, reason: `not an aem-boilerplate project: missing ${missing.join(', ')} at the project root` }
    : { ok: true };
}

const DIV = /<(\/?)div\b[^>]*>/gi;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// The inner HTML of each top-level <div> of `html`.
function divs(html) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (const m of html.matchAll(DIV)) {
    if (!m[1]) {
      if (depth === 0) start = m.index + m[0].length;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) out.push(html.slice(start, m.index));
    }
  }
  return out;
}

const text = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
    const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  })
  .trim();

// The inner HTML of the first div whose class list has `metadata` (not `section-metadata`), or null.
function metadataBlock(html) {
  for (const open of html.matchAll(/<div\b[^>]*?\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    if (!(open[1] ?? open[2]).split(/\s+/).includes('metadata')) continue;
    const rest = html.slice(open.index + open[0].length);
    let depth = 1;
    for (const m of rest.matchAll(DIV)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return rest.slice(0, m.index);
    }
    return rest;
  }
  return null;
}

// The metadata block's rows of two or more cells: first cell the key (lower-cased), second the value. The first
// row of a key wins, as the head's first <meta> of that name does.
export function metadataRows(plainHtml) {
  const block = metadataBlock(String(plainHtml));
  const rows = {};
  for (const row of block === null ? [] : divs(block)) {
    const cells = divs(row);
    if (cells.length < 2) continue;
    const key = text(cells[0]).toLowerCase();
    if (key && !(key in rows)) rows[key] = text(cells[1]);
  }
  return rows;
}

// In a shared repo every document the page leans on lives under /<namespace>/. --sandbox waives all of it.
export function isolation({ path, rows = {}, namespace, sandbox = false }) {
  if (sandbox) return [];
  const problems = [];
  if (!path.startsWith(`/${namespace}/`)) problems.push(`the page path ${path} is outside /${namespace}/`);
  for (const key of ['nav', 'footer']) {
    const want = `/${namespace}/${key}`;
    if (rows[key] === undefined) problems.push(`the metadata ${key} row is absent: expected ${want}`);
    else if (rows[key] !== want) problems.push(`the metadata ${key} row is ${rows[key]}: expected ${want}`);
  }
  return problems;
}

// One request for the authored form: its status and body when 200, else why not. A redirect is a non-200 answer.
async function fetchPlain(url, auth) {
  try {
    const res = await fetch(url, { headers: auth ? { authorization: auth } : {}, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_MS) });
    if (res.status !== 200) {
      await res.body?.cancel();
      return { status: res.status, last: `HTTP ${res.status}` };
    }
    return { status: 200, body: await res.text() };
  } catch (e) {
    return { status: 0, last: `no response (${e.cause?.code || e.name})` };
  }
}

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

// preview.json: { skipped?, reason?, url, origin, path, plain, namespace, sandbox, auth, checkedAt, problems? }.
// `plain` is the authored form's URL, `auth` only whether a header was used, `problems` the isolation findings.
// Skipped (not an aem-boilerplate project) is recorded; a poll that never sees 200 within maxWaitSec throws an
// error with code 124 (and .last, the last response) and leaves no record, so no step reads a stale one.
// Resolves the project root as the parent of `dir`.
export async function runPreview({ dir, slug, org, repo, branch, path, namespace = null, sandbox = false, auth = null, maxWaitSec = 120, env = process.env }) {
  const file = join(deployedDir(dir, slug), 'preview.json');
  rmSync(file, { force: true });
  const base = { path, namespace, sandbox: !!sandbox, auth: !!auth };
  const eligible = eligibility(dirname(resolve(dir)));
  if (!eligible.ok) {
    const record = { skipped: true, reason: eligible.reason, url: null, origin: null, plain: null, ...base, checkedAt: new Date().toISOString() };
    writeJson(file, record);
    return record;
  }
  let origin;
  if (env.DEPLOY_VERIFY_ORIGIN) {
    try { origin = new URL(env.DEPLOY_VERIFY_ORIGIN).origin; } catch { throw new UsageError(`DEPLOY_VERIFY_ORIGIN is not a URL: ${env.DEPLOY_VERIFY_ORIGIN}`); }
  } else origin = previewOrigin({ org, repo, branch });
  const url = `${origin}${path}`;
  const plain = `${url}.plain.html`;

  const deadline = Date.now() + maxWaitSec * 1000;
  let got = await fetchPlain(plain, auth);
  while (got.status !== 200) {
    const left = deadline - Date.now();
    if (left <= 0) {
      const err = new Error(`${path}.plain.html not 200 after ${maxWaitSec} s`);
      err.code = 124;
      err.last = got.last;
      throw err;
    }
    await sleep(Math.min(POLL_MS, left));
    got = await fetchPlain(plain, auth);
  }

  const problems = isolation({ path, rows: metadataRows(got.body), namespace, sandbox });
  const record = { url, origin, path, plain, namespace, sandbox: !!sandbox, auth: !!auth, checkedAt: new Date().toISOString(), ...(problems.length ? { problems } : {}) };
  writeJson(file, record);
  return record;
}
