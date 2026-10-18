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
//        it): off the origin, the browser gets the redirect and follows it without the token; on the origin, the
//        request fails (measure the final URL) — the token never crosses a redirect. A request of the origin that
//        fails (a drop, a stall past the page's own timeout) is aborted, never continued without the header — that
//        would measure the 401 — and one stderr line names the origin. Attach it before the first navigation;
//        `context.request` (APIRequestContext) bypasses routes and keeps a header across a redirect too — send the
//        header there yourself, to the origin only. Same semantics as diff/scripts/live-session.mjs
//        `attachOriginAuth`, kept here because deploy does not import diff.
//   strayEnvLine(name, { cwd }) / strayMessage(flag)  whether the `.env` has a line for `name` the grammar does
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
// The variable's name is not echoed: a token typed in its place would be.
export const strayMessage = (flag) => `${flag}: the .env line for the variable it names is not in a form that is read; it must be exactly NAME=value (no export, no spaces round the =, no indent)`;

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
    if (!header) throw usageError(strayEnvLine(tokenEnv, { cwd }) ? strayMessage('--token-env') : 'no site token: the variable --token-env names is not set (or is empty) in the environment or in .env');
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

// The route of attachSiteAuth. A request of the origin is made HERE (route.fetch, redirects unfollowed) and is never
// released to the browser with the header: a header set with route.continue() stays on the request across every
// redirect the browser then follows, no route sees those hops, and the origin may answer the browser's ask with
// another redirect than the one it gave here (a cookie set meanwhile, a count) — to another origin, token included.
//   - an answer that is no redirect → handed to the browser (route.fulfill);
//   - a redirect to another origin → handed to the browser, which follows it as a request of its own, with no token;
//   - a redirect within the origin → ABORTED, one stderr line naming the origin and the two paths: its next hop could
//     carry the token only by a replay, and without it the instrument would measure a 401 page. The token never
//     crosses a redirect; measure the final URL.
// A request that cannot be made here (a timeout, a dropped connection) is ABORTED, never continued: continued, it
// would go out without the token and the instrument would measure a 401 page as the site. One stderr line (per
// attachSiteAuth) names the origin. The requests here set no timeout of their own (0): the caller's navigation
// timeout ends a stall.
export async function attachSiteAuth(context, origin, header) {
  if (!origin || !header) return;
  const only = new URL(origin).origin;
  const onOrigin = (u) => originOf(u) === only;
  let said = false;
  const named = new Set();
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!onOrigin(request.url())) { await route.fallback(); return; }
    let answer;
    try {
      answer = await route.fetch({ headers: { ...request.headers(), authorization: header }, maxRedirects: 0, timeout: 0 });
    } catch {
      if (!said) { said = true; console.error(`site-auth: a request to ${only} failed and was not retried without the site token`); }
      await route.abort('failed').catch(() => {});
      return;
    }
    const location = REDIRECT_STATUS.has(answer.status()) && answer.headers().location;
    let next = null;
    try { next = location ? new URL(location, request.url()).href : null; } catch { /* unresolvable: the browser cannot follow it either */ }
    if (next && onOrigin(next)) {
      const hop = `${new URL(request.url()).pathname} → ${new URL(next).pathname}`;
      if (!named.has(hop)) { named.add(hop); console.error(`site-auth: ${only} redirected ${hop}; a site token is never replayed across a redirect — measure the final URL`); }
      await route.abort('failed').catch(() => {});
      return;
    }
    // (a page that closed meanwhile leaves nothing to answer)
    await route.fulfill({ response: answer }).catch(() => {});
  });
}
