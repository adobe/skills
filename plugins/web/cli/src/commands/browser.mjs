import { parseIntArg } from '#src/args.mjs';
import { existsSync } from 'node:fs';
import { CliError } from '#src/errors.mjs';
import { createContext } from '#src/context.mjs';
import { extendConfig, resolveLaunch } from '#src/recipe.mjs';
import { artifactPath, generateSessionName, requireOpenSession } from '#src/session.mjs';
import { CACHE_STATS_CODE, cacheHooksCode } from '#src/cache/hooks.mjs';
import { hasKeeper, startKeeperProcess, stopKeeper } from '#src/cache/keeper-process.mjs';

const HELP = {
  OPEN: `
Example:
  S=$(web browser open https://example.com --headed | jq -r .session)
Output:
  { session, url, headed, cdpPort?, proxy?, cache?: { dir, entries } }
Notes:
  Without --session a name web-<4 hex> is generated and returned. An open name exits 2
  (SESSION_EXISTS). --recipe applies a recipe from \`web probe\`. Leaves the browser open.
  --proxy routes the browser through web cache proxy (certificate errors ignored).
  --cache <dir> records every page the session loads into per-page HARs (the cache record
  format) and serves cached requests from disk; all network requests are made by the
  browser. A background keeper serves the cache until browser close. Not with --proxy.
  Every response is recorded with its original status (errors included, redirect hops with
  redirectURL); only 2xx/3xx are served from the cache, errors are re-checked live. Redirect
  hops after the first are always fetched live (Playwright does not route them).
`,
  ATTACH: `
Example:
  S=$(web browser attach http://127.0.0.1:9222 | jq -r .session)
Output:
  { session, attached }
Notes:
  Joins a running Chrome started with --remote-debugging-port.
`,
  LIST: `
Example:
  web browser list
Output:
  { sessions: [{ name, status, headed, url }] }
Notes:
  url is null unless the session is open.
`,
  CLOSE: `
Example:
  web browser close --session "$S"
Output:
  { session, status, cache?: { hits, misses, stored, errors } | null }
Notes:
  cache is present for a session opened with --cache; null when its keeper had stopped.
Exit codes:
  2 NO_SESSION when the session is not open.
`,
  CLOSE_ALL: `
Example:
  web browser close-all
Output:
  { closed: [name] }
`,
  EVAL: `
Example:
  web browser eval "document.title" --session "$S"
Output:
  { result }
Notes:
  One JS expression, evaluated in the page: no \`;\`, no \`return\`. For statements use
  \`browser run\`. result is the JSON-serializable value.
`,
  RUN: `
Example:
  web browser run "async page => page.title()" --session "$S"
Output:
  { result }
Notes:
  Argument is a file path (if the file exists) or inline code \`async page => {…}\`.
  Statements and \`return\` are allowed. The function receives the Playwright \`page\`.
`,
  CDP: `
Example:
  web browser cdp Page.getLayoutMetrics --session "$S"
  web browser cdp Emulation.setDeviceMetricsOverride '{"width":390,"height":844}' --session "$S"
Output:
  { result }
Notes:
  params-json is an optional JSON object (default {}); invalid JSON exits 2 (USAGE).
`,
  SHOT: `
Example:
  web browser screenshot --full-page --session "$S"
Output:
  { path }
Notes:
  Writes <output>/<session>-screenshot-<timestamp>.png. --selector captures one element.
`,
};

const GROUP_HELP = `
Use for session plumbing; analysis lives in \`web page\`. Commands other than open, attach
and list act on the browser named by --session (or WEB_SESSION) and need it open.
Sessions stay open until \`browser close\`; \`playwright-cli -s <session> …\` drives the same one.
`;

const DESCRIPTION = 'session plumbing: open, attach, list, close, eval, run, cdp, screenshot';

function sessionUrl(driver, { name, status }) {
  if (status !== 'open') return null;
  try {
    return driver.evaluate(name, 'location.href');
  } catch {
    return null;
  }
}

function assertUrl(value) {
  try {
    new URL(value);
  } catch {
    throw new CliError('USAGE', `invalid --proxy url: ${value}`, {
      hint: 'pass an absolute URL such as http://127.0.0.1:3002',
    });
  }
}

function closeQuietly(driver, session) {
  try {
    driver.close(session);
  } catch (err) {
    process.stderr.write(`warning: failed to close session ${session}: ${err.message}\n`);
  }
}

/**
 * Open `session` as a cache session: start its keeper, open the browser on about:blank,
 * install the cache hooks, then navigate, so the first page is recorded too.
 */
async function openWithCache({ driver, keeper, openArgs, url, cacheDir, outputDir }) {
  const { session } = openArgs;
  if (driver.list().some((s) => s.name === session && s.status === 'open')) {
    throw new CliError('SESSION_EXISTS', `session '${session}' is already open`, {
      hint: 'choose another --session or run: web browser close --session <name>',
    });
  }
  const started = await keeper.start({ cacheDir, session, outputDir });
  try {
    driver.open({ ...openArgs, url: undefined });
    driver.run(session, { code: cacheHooksCode(started.port) });
    if (url) driver.goto(session, url);
  } catch (err) {
    await keeper.stop({ session, outputDir });
    closeQuietly(driver, session);
    throw err;
  }
  return { dir: started.dir, entries: started.entries };
}

/** Stop the session's keeper; its counters plus the hooks' errors, or null if it was gone. */
async function closeCache({ driver, keeper, session, outputDir, stderr }) {
  let hookErrors = 0;
  try {
    hookErrors = driver.run(session, { code: CACHE_STATS_CODE });
  } catch (err) {
    stderr.write(`warning: cannot read cache hook errors for ${session}: ${err.message}\n`);
  }
  driver.close(session);
  const stats = await keeper.stop({ session, outputDir });
  if (!stats) {
    stderr.write(`warning: cache keeper for ${session} was not running\n`);
    return null;
  }
  return { ...stats, errors: stats.errors + hookErrors };
}

function parseParams(json) {
  if (json === undefined) return {};
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new CliError('USAGE', `params-json is not valid JSON: ${err.message}`);
  }
}

/**
 * Register the `browser` group.
 * @param {import('commander').Command} program
 * @param {object} deps
 */
export function registerBrowser(program, deps) {
  const browser = program
    .command('browser')
    .description(DESCRIPTION)
    .addHelpText('after', GROUP_HELP);
  const action = (cmd, fn) =>
    cmd.action(async (...args) => {
      const command = args.at(-1);
      const ctx = createContext(command, deps);
      await fn(ctx, ...args.slice(0, -2));
    });
  const keeper = deps.keeper ?? { start: startKeeperProcess, stop: stopKeeper };
  const stderr = deps.stderr ?? process.stderr;
  const openSession = (ctx) => {
    requireOpenSession(ctx.driver, ctx.opts.session);
    return ctx.opts.session;
  };

  action(
    browser
      .command('open [url]')
      .description('open a browser session')
      .addHelpText('after', HELP.OPEN)
      .option('--cdp-port <n>', 'remote debugging port', parseIntArg)
      .option('--persistent', 'use a persistent profile')
      .option('--proxy <url>', 'route the browser through a web cache proxy')
      .option('--cache <dir>', 'record and replay the session in HARs under <dir>'),
    async ({ opts, driver, print, recipe }, url) => {
      const session = opts.session ?? generateSessionName();
      const { cdpPort, proxy } = opts;
      if (proxy && opts.cache) {
        throw new CliError('USAGE', '--cache and --proxy cannot be combined', {
          hint: 'use --cache to record while browsing, or --proxy to replay via cache proxy',
        });
      }
      if (proxy) assertUrl(proxy);
      const launch = resolveLaunch(recipe, { persistent: opts.persistent });
      const config = proxy
        ? extendConfig(launch.config, {
            launchOptions: { proxy: { server: proxy } },
            contextOptions: { ignoreHTTPSErrors: true },
          })
        : launch.config;
      const openArgs = {
        session,
        url,
        headed: opts.headed,
        cdpPort,
        ...launch,
        ...(config && { config }),
      };
      let cache;
      if (opts.cache) {
        const cacheDir = opts.cache;
        const outputDir = opts.output;
        cache = await openWithCache({ driver, keeper, openArgs, url, cacheDir, outputDir });
      } else {
        driver.open(openArgs);
      }
      print({
        session,
        url,
        headed: Boolean(opts.headed),
        ...(cdpPort && { cdpPort }),
        ...(proxy && { proxy }),
        ...(opts.cache && { cache }),
      });
    },
  );

  action(
    browser
      .command('attach <cdp-url>')
      .description('attach to a running Chrome')
      .addHelpText('after', HELP.ATTACH),
    ({ opts, driver, print }, cdpUrl) => {
      const session = opts.session ?? generateSessionName();
      driver.attach({ session, cdpUrl });
      print({ session, attached: true });
    },
  );

  action(
    browser.command('list').description('list sessions').addHelpText('after', HELP.LIST),
    ({ driver, print }) => {
      const sessions = driver.list().map((s) => ({
        name: s.name,
        status: s.status,
        headed: s.headed,
        url: sessionUrl(driver, s),
      }));
      print({ sessions });
    },
  );

  action(
    browser.command('close').description('close the session').addHelpText('after', HELP.CLOSE),
    async (ctx) => {
      const session = openSession(ctx);
      const outputDir = ctx.opts.output;
      if (!hasKeeper({ session, outputDir })) {
        ctx.driver.close(session);
        return ctx.print({ session, status: 'closed' });
      }
      const { driver } = ctx;
      const cache = await closeCache({ driver, keeper, session, outputDir, stderr });
      return ctx.print({ session, status: 'closed', cache });
    },
  );

  action(
    browser
      .command('close-all')
      .description('close every session')
      .addHelpText('after', HELP.CLOSE_ALL),
    async (ctx) => {
      const closed = ctx.driver.list().map((s) => s.name);
      ctx.driver.closeAll();
      for (const session of closed) await keeper.stop({ session, outputDir: ctx.opts.output });
      ctx.print({ closed });
    },
  );

  action(
    browser
      .command('eval <expr>')
      .description('evaluate a JS expression')
      .addHelpText('after', HELP.EVAL),
    (ctx, expr) => {
      ctx.print({ result: ctx.driver.evaluate(openSession(ctx), expr) });
    },
  );

  action(
    browser
      .command('run <file-or-code>')
      .description('run a Playwright script or code')
      .addHelpText('after', HELP.RUN),
    (ctx, arg) => {
      const target = existsSync(arg) ? { file: arg } : { code: arg };
      ctx.print({ result: ctx.driver.run(openSession(ctx), target) });
    },
  );

  action(
    browser
      .command('cdp <method> [params-json]')
      .description('send a raw CDP command')
      .addHelpText('after', HELP.CDP),
    (ctx, method, json) => {
      const params = parseParams(json);
      ctx.print({ result: ctx.driver.cdp(openSession(ctx), method, params) });
    },
  );

  action(
    browser
      .command('screenshot')
      .description('take a screenshot')
      .addHelpText('after', HELP.SHOT)
      .option('--full-page', 'capture the full page')
      .option('--selector <css>', 'capture one element'),
    (ctx) => {
      const session = openSession(ctx);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = artifactPath(ctx.opts.output, session, 'screenshot', `${stamp}.png`);
      ctx.driver.screenshot(session, {
        path,
        fullPage: ctx.opts.fullPage,
        selector: ctx.opts.selector,
      });
      ctx.print({ path });
    },
  );
  return browser;
}
