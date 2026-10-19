// skills/reskin/scripts/deployed/preview.mjs — A0 of the deployed leg: where the branch preview is, whether the
// project can have one, whether the page's authored form is there, and whether the page keeps to its namespace
// in a shared repo. Writes <dir>/.work/reskin/gates/<slug>/deployed/preview.json, the record every later step reads.
//   previewOrigin({ org, repo, branch })     https://<branch>--<repo>--<org>.aem.page (the host label is at most 63 characters)
//   eligibility(root)                        { ok: true } | { ok: false, reason }: an aem-boilerplate project
//   headMetadata(html)                       the delivered page's head metas nav and footer, { nav?, footer? }
//   isolation({ path, meta, origin, namespace, sandbox })  the ways the page touches shared documents
//   runPreview({ dir, slug, org, repo, branch, path, namespace, sandbox, auth, tokenFlag, maxWaitSec })  the PreviewRecord
//        (tokenFlag names the flag that gave the token, for the error when the preview refuses it)
// DEPLOY_VERIFY_ORIGIN (env) replaces the origin: the hook the fake-preview tests use. The record says so
// (`originOverride`), since a page measured there was not measured on its branch preview. The Authorization header is
// sent to the preview origin only (a redirect is never followed), only once the preview has refused a request without
// it, and is never part of the record.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { fetchOnce, plainUrl } from './fetch.mjs';
import { deployedDir } from './io.mjs';

const REQUIRED = ['stardust/runtime-contract.json', 'head.html', 'scripts/aem.js'];
const LABEL_MAX = 63;
const POLL_MS = 1000;
const REQUEST_MS = 10000;
const BASE = 'http://x';

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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const META = /<meta\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole;
  const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return Number.isInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
});

// Real EDS strips the metadata block from the authored form and emits the page's metadata as head metas, so the
// chrome the page loads is read from the delivered page: the first <meta name="nav"> and <meta name="footer"> of
// the head (comments, scripts and styles, which can hold tag-like text, are left out; a fragment without
// </head> is read whole). Names match exactly, as the boilerplate's selector does; a meta without content is no meta.
export function headMetadata(html) {
  const head = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .split(/<\/head\s*>/i)[0];
  const out = {};
  for (const [, attrs] of head.matchAll(META)) {
    const a = {};
    for (const m of attrs.matchAll(ATTR)) a[m[1].toLowerCase()] ??= decode(m[2] ?? m[3] ?? m[4] ?? '');
    if ((a.name === 'nav' || a.name === 'footer') && a.content !== undefined) out[a.name] ??= a.content;
  }
  return out;
}

// A path a fetch resolves as written: no %, backslash, query, fragment or space (the URL parser would rewrite
// them), no `.`, `..` or interior empty segment. A trailing slash is fine.
function isPlainPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[%\\]/.test(path)) return false;
  try { if (new URL(path, BASE).pathname !== path) return false; } catch { return false; }
  const segments = path.slice(1).split('/');
  return segments.every((s, i) => s !== '.' && s !== '..' && (s !== '' || i === segments.length - 1));
}

const notPlain = (path, namespace) => `the page path ${path} is not a plain path (no %, \\, query, fragment, space, empty, . or .. segment): a fetch could resolve it outside /${namespace}/`;

// nav and footer are read the way the header block reads them: new URL(value, page).pathname.
function chromeProblem(key, value, origin, namespace) {
  const want = `/${namespace}/${key}`;
  if (value === undefined) return `the ${key} meta is absent from the page head: expected ${want}`;
  if (value === '') return `the ${key} meta is empty: expected ${want}`;
  let url;
  try { url = new URL(value, origin); } catch { return `the ${key} meta is ${value}, not a URL: expected ${want}`; }
  if (url.origin !== new URL(origin).origin) return `the ${key} meta is ${value}, on another origin: expected ${want}`;
  if (url.pathname !== want) return `the ${key} meta is ${value}${value === url.pathname ? '' : ` (${url.pathname})`}: expected ${want}`;
  return null;
}

// In a shared repo every document the page leans on lives under /<namespace>/. --sandbox waives all of it.
// `meta` is headMetadata of the delivered page, `origin` the page's origin (a full-URL nav on it is the same path).
export function isolation({ path, meta = {}, origin = BASE, namespace, sandbox = false }) {
  if (sandbox) return [];
  const problems = [];
  if (!isPlainPath(path)) problems.push(notPlain(path, namespace));
  else if (!path.startsWith(`/${namespace}/`)) problems.push(`the page path ${path} is outside /${namespace}/`);
  for (const key of ['nav', 'footer']) {
    const problem = chromeProblem(key, meta[key], origin, namespace);
    if (problem) problems.push(problem);
  }
  return problems;
}

// One request, ended by REQUEST_MS or by `budgetMs`, the time left of --max-wait, whichever is first (fetchOnce).
const attemptOnce = (url, auth, budgetMs) => fetchOnce(url, auth, Math.max(1, Math.min(REQUEST_MS, budgetMs)));

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

// preview.json: { skipped?, reason?, url, origin, path, plain, namespace, sandbox, auth, tokenUnused?, originOverride?,
// checkedAt, problems? }. `plain` is the authored form's URL, `problems` the isolation findings, `originOverride`
// { env: 'DEPLOY_VERIFY_ORIGIN', origin } the origin that stood in for the branch preview's (absent when none did).
// `auth` is whether the preview refused a request without the site token (401 or 403): the page is protected and the
// later steps treat it so. This step sends the token only after such a refusal, so the first request of the poll, the
// authored form's, is the anonymous one; for a preview that never asked for one none is sent and the record says
// `tokenUnused: true` (content, tokens and figma, later steps, send a token they are given regardless). With no token,
// a refusal is a setup error (the token is missing), and so is the refusal of a token that was sent (it is wrong or
// expired); neither is something to poll until 124.
// Skipped (not an aem-boilerplate project) is recorded; a poll that never sees 200 for the authored form and then
// for the delivered page (whose head says which nav and footer it loads) within maxWaitSec throws an error with
// code 124 (and .last, the last response) and leaves no record, so no step reads a stale one.
// A path that is not a plain path in a shared repo is refused before any request. Resolves the project root as
// the parent of `dir`.
export async function runPreview({ dir, slug, org, repo, branch, path, namespace = null, sandbox = false, auth = null, tokenFlag = '--auth-header or --token-env', maxWaitSec = 120, env = process.env }) {
  const file = join(deployedDir(dir, slug), 'preview.json');
  rmSync(file, { force: true });
  const base = { path, namespace, sandbox: !!sandbox };
  const eligible = eligibility(dirname(resolve(dir)));
  if (!eligible.ok) {
    const record = { skipped: true, reason: eligible.reason, url: null, origin: null, plain: null, ...base, auth: false, checkedAt: new Date().toISOString() };
    writeJson(file, record);
    return record;
  }
  let origin;
  let originOverride = null;
  if (env.DEPLOY_VERIFY_ORIGIN) {
    try { origin = new URL(env.DEPLOY_VERIFY_ORIGIN).origin; } catch { throw new UsageError(`DEPLOY_VERIFY_ORIGIN is not a URL: ${env.DEPLOY_VERIFY_ORIGIN}`); }
    originOverride = { env: 'DEPLOY_VERIFY_ORIGIN', origin };
  } else origin = previewOrigin({ org, repo, branch });
  const url = `${origin}${path}`;
  const plain = plainUrl(url);
  let using = null;
  const recorded = (problems) => {
    const record = { url, origin, ...base, auth: !!using, ...(auth && !using ? { tokenUnused: true } : {}), ...(originOverride ? { originOverride } : {}), plain, checkedAt: new Date().toISOString(), ...(problems.length ? { problems } : {}) };
    writeJson(file, record);
    return record;
  };
  if (!sandbox && !isPlainPath(path)) return recorded([notPlain(path, namespace)]);

  const deadline = Date.now() + maxWaitSec * 1000;
  const waitFor200 = async (target, what) => {
    let last;
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > 0 && deadline - Date.now() <= 0) {
        const err = new Error(`${what} not 200 after ${maxWaitSec} s`);
        err.code = 124;
        err.last = last;
        throw err;
      }
      const got = await attemptOnce(target, using, deadline - Date.now());
      if (got.status === 200) return got.body;
      if (got.status === 401 || got.status === 403) {
        // The token was sent and refused: wrong or expired, a setup error, not a page that is not served yet.
        if (using) throw new UsageError(`the preview refused the site token (HTTP ${got.status}) given by ${tokenFlag}: it is wrong or expired`);
        if (!auth) throw new UsageError('the preview needs a site token: pass --token-env <NAME>');
        using = auth;
        continue;
      }
      last = got.last;
      await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
    }
  };
  await waitFor200(plain, new URL(plain).pathname);
  const page = await waitFor200(url, path);
  return recorded(isolation({ path, meta: headMetadata(page), origin, namespace, sandbox }));
}
