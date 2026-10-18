// skills/deploy/scripts/site-auth.mjs — library, no CLI: the site token of a protected preview for the deploy
// instruments (deploy-batch's delivered check, qa-gate, ai-readability). Deploy never imports the diff skill, so the
// rule of diff/scripts/live-session.mjs (`instrumentAuth`) is kept here, to the letter.
//
//   readSiteAuth(name, { env, cwd, flag })  the `Authorization` value held in the variable `name`: the environment
//        first, then the line `^NAME=(.*)$` of a `.env` in `cwd`; the value is trimmed, one pair of surrounding quotes
//        stripped, and `token ` put in front unless it starts with `token ` or `bearer ` (any case). null when it is
//        not set or is empty. `export NAME=`, `NAME = v` and a trailing `# comment` are not that line. A `name` that is
//        not an identifier is a usage error naming `flag` — it never echoes the value, a token pasted in its place.
//   instrumentSiteAuth({ tokenEnv, authHeader, authOrigin, urls, env, cwd })  the opt-in of an instrument:
//        { origin, header } for --token-env / --auth-header / --auth-origin, or null when neither of the first two was
//        given — a SITE_TOKEN in the environment or `.env` is never used on its own, and nothing here reads argv. The
//        origin is `authOrigin`, else the one origin of `urls`; two or more without `authOrigin` is a usage error
//        rather than a guess. An absent flag is undefined; an empty one is a usage error. Failures are Errors with
//        `code = 2` whose text names a flag or a variable, never a value.
//   attachSiteAuth(context, origin, header)  a `context.route` that makes the requests of `origin` with `authorization`
//        added and lets every other request through untouched, so a webfont, an image host, a vendor — or the target
//        of a redirect off the origin — never sees it. A redirect is settled inside the route (see the comment above
//        it): off the origin, the browser gets the redirect and follows it without the token; within the origin, it
//        keeps it. A request of the origin that fails (a drop, a stall past the page's own timeout), or whose redirect
//        chain inside the origin is still going after ten hops (a loop), is aborted, never continued without the header
//        — that would measure the 401 — and one stderr line names the origin. Attach it before the first navigation;
//        `context.request` (APIRequestContext) bypasses routes and keeps a header across a redirect too — send the
//        header there yourself, to the origin only. Same semantics as diff/scripts/live-session.mjs
//        `attachOriginAuth`, kept here because deploy does not import diff.
//   strayEnvLine(name, { cwd }) / strayMessage(flag, name)  whether the `.env` has a line for `name` the grammar does
//        not read (`export NAME=`, `NAME = v`), and the usage-error text for it, so it is not reported as "not set".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const withTokenPrefix = (v) => (/^(token|bearer) /i.test(v) ? v : `token ${v}`);
const usageError = (message) => Object.assign(new Error(message), { code: 2 });

export function readSiteAuth(name, { env = process.env, cwd = process.cwd(), flag = '--token-env' } = {}) {
  if (typeof name !== 'string' || !ENV_NAME.test(name)) throw usageError(`${flag} takes the name of an environment variable (letters, digits and underscores), not the token`);
  let v = env[name];
  const file = join(cwd, '.env');
  if (!v && existsSync(file)) v = (readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1];
  v = (v || '').trim().replace(/^["']|["']$/g, '');
  return v ? withTokenPrefix(v) : null;
}

const originOf = (url) => { try { const p = new URL(url); return p.protocol === 'http:' || p.protocol === 'https:' ? p.origin : null; } catch { return null; } };

// True when the `.env` in `cwd` has a line for `name` in a form the grammar does not read (`export NAME=`, `NAME = v`,
// an indented one): the author set it and would otherwise be told it is not set. The value is never looked at.
export function strayEnvLine(name, { cwd = process.cwd() } = {}) {
  const file = join(cwd, '.env');
  if (typeof name !== 'string' || !ENV_NAME.test(name) || !existsSync(file)) return false;
  const loose = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  return readFileSync(file, 'utf8').split(/\r?\n/).some((line) => loose.test(line) && !line.startsWith(`${name}=`));
}
export const strayMessage = (flag, name) => `${flag} ${name}: found a ${name} line in ./.env but it must be exactly ${name}=value (no export, no spaces round the =, no indent)`;

export function instrumentSiteAuth({ tokenEnv, authHeader, authOrigin, urls = [], env = process.env, cwd = process.cwd() } = {}) {
  const wantsHeader = authHeader !== undefined && authHeader !== null;
  const wantsEnv = tokenEnv !== undefined && tokenEnv !== null;
  if (!wantsHeader && !wantsEnv) return null;

  let header;
  if (wantsHeader) {
    const value = typeof authHeader === 'string' ? authHeader.trim() : '';
    if (!value) throw usageError('--auth-header needs a value');
    header = withTokenPrefix(value);
  } else {
    header = readSiteAuth(tokenEnv, { env, cwd });
    if (!header) throw usageError(strayEnvLine(tokenEnv, { cwd }) ? strayMessage('--token-env', tokenEnv) : `no site token: --token-env ${tokenEnv} is not set (or is empty) in the environment or in a ${tokenEnv}= line of .env`);
  }

  let origin;
  if (authOrigin !== undefined && authOrigin !== null) {
    origin = typeof authOrigin === 'string' && originOf(authOrigin);
    if (!origin) throw usageError('--auth-origin needs an http(s) URL, such as https://host; only its origin is used');
  } else {
    const origins = [...new Set(urls.map(originOf).filter(Boolean))];
    if (origins.length === 0) throw usageError('the site token has no http(s) URL to take an origin from: pass --auth-origin <url>');
    if (origins.length > 1) throw usageError(`the site token goes to one origin only and these URLs have ${origins.length} (${origins.join(', ')}): pass --auth-origin <url> to name it`);
    [origin] = origins;
  }
  return { origin, header };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 10;

// The route of attachSiteAuth. A header set with route.continue() stays on the request when the server redirects to
// ANOTHER origin, and a redirect answered with route.fulfill() is followed by the browser without going through any
// route again, so the follow-up carries nothing. So a redirect is settled here, on the origin's side of it:
//   - no redirect → the origin's answer is handed to the browser (route.fetch, redirects unfollowed + route.fulfill);
//   - a redirect that leaves the origin (directly, or after hops inside it) → the browser gets that redirect, and
//     follows it without the token;
//   - a redirect chain that stays inside the origin → route.continue() with the header: the browser follows it
//     itself (its URL stays true) and every hop is the origin's. The chain was walked first, so this relies on the
//     origin redirecting the same way twice; only GET/HEAD are walked and replayed — any other method gets its
//     answer as it came, a redirect included. A chain (or loop) still inside the origin after MAX_HOPS hops fails
//     closed like a failed request: aborted, one stderr line naming the origin and the hop count.
// A request that cannot be made here (a timeout, a dropped connection) is ABORTED, never continued: continued, it
// would go out without the token and the instrument would measure a 401 page as the site. One stderr line (per
// attachSiteAuth) names the origin. The requests here set no timeout of their own (0): the caller's navigation
// timeout ends a stall.
export async function attachSiteAuth(context, origin, header) {
  if (!origin || !header) return;
  const only = new URL(origin).origin;
  const onOrigin = (u) => originOf(u) === only;
  const target = (response, from) => {
    const location = REDIRECT_STATUS.has(response.status()) && response.headers().location;
    try { return location ? new URL(location, from).href : null; } catch { return null; }
  };
  const tooLong = new Error('redirect chain past the hop budget');
  let said = false;
  let saidLong = false;
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!onOrigin(request.url())) { await route.fallback(); return; }
    const headers = { ...request.headers(), authorization: header };
    let last;
    let replay = false;
    try {
      last = await route.fetch({ headers, maxRedirects: 0, timeout: 0 });
      let next = target(last, request.url());
      if (next && ['GET', 'HEAD'].includes(request.method())) {
        for (let hop = 0; next && onOrigin(next) && hop < MAX_HOPS; hop += 1) {
          const answer = await context.request.fetch(next, { method: request.method(), headers, maxRedirects: 0, timeout: 0 });
          const after = target(answer, next);
          if (!after) { replay = true; break; }
          last = answer;
          next = after;
        }
        if (!replay && next && onOrigin(next)) throw tooLong;
      }
    } catch (e) {
      if (e === tooLong) {
        if (!saidLong) { saidLong = true; console.error(`site-auth: a redirect chain inside ${only} was still going after ${MAX_HOPS} hops (a loop?) and was not followed without the site token`); }
      } else if (!said) { said = true; console.error(`site-auth: a request to ${only} failed and was not retried without the site token`); }
      await route.abort('failed').catch(() => {});
      return;
    }
    // (a page that closed meanwhile leaves nothing to answer)
    if (replay) await route.continue({ headers }).catch(() => {});
    else await route.fulfill({ response: last }).catch(() => {});
  });
}
