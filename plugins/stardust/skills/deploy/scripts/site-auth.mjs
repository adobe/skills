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
//        added and hands the answer to the browser, and lets every other request through untouched, so a webfont, an
//        image host, a vendor — or the target of a redirect off the origin — never sees it. (A header set by
//        `route.continue` stays on the request across a redirect to another origin; the browser follows a redirect
//        answered here as a new request, which the route sees again.) A request that cannot be made here is continued
//        without the header. Attach it before the first navigation; `context.request` (APIRequestContext) bypasses
//        routes and keeps a header across a redirect too — send the header there yourself, to the origin only.
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
    if (!header) throw usageError(`no site token: --token-env ${tokenEnv} is not set (or is empty) in the environment or in a ${tokenEnv}= line of .env`);
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

export async function attachSiteAuth(context, origin, header) {
  if (!origin || !header) return;
  const only = new URL(origin).origin;
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (originOf(request.url()) !== only) { await route.continue(); return; }
    // A header set on a continued request survives a redirect off the origin, so the request is made here with
    // redirects unfollowed and its answer handed to the browser, which follows a redirect as a new request the
    // route sees again — a fetch without the header to the other origin.
    let response;
    try { response = await route.fetch({ headers: { ...request.headers(), authorization: header }, maxRedirects: 0 }); } catch { await route.continue(); return; }
    await route.fulfill({ response });
  });
}
