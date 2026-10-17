import { parseIntArg } from '#src/args.mjs';
import { existsSync } from 'node:fs';
import { CliError } from '#src/errors.mjs';
import { createContext } from '#src/context.mjs';
import {
  artifactPath,
  generateSessionName,
  loadRecipe,
  requireOpenSession,
} from '#src/session.mjs';

const HELP = {
  OPEN: `
Example:
  S=$(web browser open https://example.com --headed | jq -r .session)
Output:
  { session, url, headed, cdpPort? }
Notes:
  Without --session a name web-<4 hex> is generated and returned. An open name exits 2
  (SESSION_EXISTS). --recipe applies a recipe from \`web probe\`. Leaves the browser open.
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
  { session, status }
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
      .option('--persistent', 'use a persistent profile'),
    ({ opts, driver, print }, url) => {
      const session = opts.session ?? generateSessionName();
      const recipe = opts.recipe ? loadRecipe(opts.recipe) : {};
      const cdpPort = opts.cdpPort;
      driver.open({
        session,
        url,
        headed: opts.headed,
        cdpPort,
        persistent: opts.persistent || recipe.persistent,
        config: recipe.config,
      });
      print({ session, url, headed: Boolean(opts.headed), ...(cdpPort && { cdpPort }) });
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
    (ctx) => {
      const session = openSession(ctx);
      ctx.driver.close(session);
      ctx.print({ session, status: 'closed' });
    },
  );

  action(
    browser
      .command('close-all')
      .description('close every session')
      .addHelpText('after', HELP.CLOSE_ALL),
    (ctx) => {
      const closed = ctx.driver.list().map((s) => s.name);
      ctx.driver.closeAll();
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
