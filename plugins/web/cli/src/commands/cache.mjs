import { resolve } from 'node:path';
import { parseIntArg, parsePositiveIntArg } from '#src/args.mjs';
import { CliError } from '#src/errors.mjs';
import { emit } from '#src/output.mjs';
import { startCacheProxy } from '#src/cache/proxy.mjs';
import { startHarProxy } from '#src/cache/har-proxy.mjs';
import { recordPage } from '#src/cache/record.mjs';
import { startKeeper } from '#src/cache/keeper.mjs';
import { createDriver } from '#src/driver/playwright-cli.mjs';
import { createContext } from '#src/context.mjs';

const SERVE_HELP = `
Example:
  web cache serve --cache .page-cache &            # online: fetch once, save to disk
  playwright-cli open "http://localhost:3001/?_origin=https://example.com"
  web cache serve --cache .page-cache --offline    # replay with no network
Output:
  { url, port, cache, offline, also } printed once the proxy listens; then it runs until
  Ctrl-C, SIGTERM or GET /__stop.
Notes:
  Binds 127.0.0.1 only. Open pages as <url>/path?_origin=<origin>; later requests follow the
  origin cookie. GET /__status returns hit/miss counts. A cache miss offline answers 504.
  --also names other origins (an image CDN) whose assets are cached and served like the page's.`;

const RECORD_HELP = `
Example:
  web cache record https://example.com --cache .har-cache
Output:
  { url, har, entries, dropped, bytes }
Notes:
  Loads the page in a browser (recipe and --headed apply), scrolls to trigger lazy content and
  saves every request to <cache>/<host>_<hash8>.har; failed requests are dropped.
  One URL per call: loop for more. Re-recording a URL replaces its HAR.
  Once cache proxy has run, the cache directory holds a private key: do not commit it.`;

const PROXY_HELP = `
Example:
  web cache proxy --cache .har-cache &
  web browser open https://example.com --proxy http://127.0.0.1:3002
Output:
  { url, port, cache, offline, entries } printed once the proxy listens; then it runs until
  Ctrl-C, SIGTERM or GET /__stop.
Notes:
  A forward proxy on 127.0.0.1 that answers the real URLs recorded by cache record; HTTPS is
  intercepted with a self-signed certificate (browser open --proxy accepts it). HARs are read
  at start: restart to pick up new recordings. A miss is fetched live and never stored;
  --offline answers it 504. A tracker miss is refused with 403, a failed or timed-out live
  fetch answers 502, WebSocket upgrades are refused. GET /__status returns hit, miss, live and
  blocked counts and the missed URLs.`;

function waitUntilStopped(proxy) {
  return new Promise((ok) => {
    const stop = () => proxy.stop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    proxy.closed.then(() => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      ok();
    });
  });
}

function registerServe(group, { stdout, stderr }) {
  group
    .command('serve')
    .description('run the caching reverse proxy')
    .option('--port <n>', 'port to listen on (0 = any free port)', parseIntArg, 3001)
    .option('--cache <dir>', 'cache directory', '.page-cache')
    .option('--offline', 'serve from the cache only, never fetch')
    .option('--timeout <ms>', 'upstream fetch deadline', parsePositiveIntArg, 30000)
    .option('--also <origins>', 'other origins whose assets the pages use, comma-separated')
    .addHelpText('after', SERVE_HELP)
    .action(async (opts, command) => {
      const also = (opts.also ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      for (const o of also) {
        try {
          new URL(o);
        } catch {
          throw new CliError('USAGE', `invalid --also origin: ${o}`, {
            hint: 'pass absolute origins such as https://cdn.example.com',
          });
        }
      }
      const proxy = await startCacheProxy({
        port: opts.port,
        cacheDir: opts.cache,
        offline: Boolean(opts.offline),
        timeoutMs: opts.timeout,
        also,
        log: (line) => stderr.write(`${line}\n`),
      }).catch((err) => {
        throw new CliError('INTERNAL', `cannot start proxy on port ${opts.port}: ${err.message}`, {
          hint: 'pick another --port, or 0 for any free port',
        });
      });
      const { format } = command.optsWithGlobals();
      emit(
        {
          url: proxy.url,
          port: proxy.port,
          cache: resolve(opts.cache),
          offline: Boolean(opts.offline),
          also,
        },
        { format, stdout },
      );
      await waitUntilStopped(proxy);
    });
}

function registerRecord(group, deps) {
  group
    .command('record <url>')
    .description('record a page and its resources into a HAR')
    .option('--cache <dir>', 'cache directory', '.har-cache')
    .addHelpText('after', RECORD_HELP)
    .action((url, opts, command) => {
      try {
        new URL(url);
      } catch {
        throw new CliError('USAGE', `invalid url: ${url}`, {
          hint: 'pass an absolute URL such as https://example.com',
        });
      }
      const ctx = createContext(command, deps);
      const result = recordPage(ctx.driver, {
        url,
        cacheDir: opts.cache,
        headed: Boolean(ctx.opts.headed),
        recipe: ctx.recipe,
      });
      ctx.print(result);
    });
}

function registerProxy(group, { stdout, stderr }) {
  group
    .command('proxy')
    .description('run a forward proxy that replays recorded HARs')
    .option('--port <n>', 'port to listen on (0 = any free port)', parseIntArg, 3002)
    .option('--cache <dir>', 'cache directory', '.har-cache')
    .option('--timeout <ms>', 'live fetch deadline for misses', parsePositiveIntArg, 5000)
    .option('--offline', 'answer misses 504, never fetch')
    .addHelpText('after', PROXY_HELP)
    .action(async (opts, command) => {
      const offline = Boolean(opts.offline);
      const startFailed = (err) => {
        if (err instanceof CliError) throw err;
        throw new CliError('INTERNAL', `cannot start proxy on port ${opts.port}: ${err.message}`, {
          hint: 'pick another --port, or 0 for any free port',
        });
      };
      const proxy = await startHarProxy({
        port: opts.port,
        cacheDir: opts.cache,
        offline,
        timeoutMs: opts.timeout,
        log: (line) => stderr.write(`${line}\n`),
      }).catch(startFailed);
      const { format } = command.optsWithGlobals();
      emit(
        {
          url: proxy.url,
          port: proxy.port,
          cache: resolve(opts.cache),
          offline,
          entries: proxy.entries,
        },
        { format, stdout },
      );
      await waitUntilStopped(proxy);
    });
}

/** Whether `session` is still open; a failing playwright-cli counts as closed. */
function sessionChecker(session, outputDir) {
  return () => {
    try {
      const sessions = createDriver({ outputDir }).list();
      return sessions.some((s) => s.name === session && s.status === 'open');
    } catch {
      return false;
    }
  };
}

function registerKeeper(group, { stdout, stderr }) {
  group
    .command('keeper', { hidden: true })
    .description('internal: the session cache keeper started by browser open --cache')
    .requiredOption('--cache <dir>', 'cache directory')
    .action(async (opts, command) => {
      const { session, output } = command.optsWithGlobals();
      const keeper = await startKeeper({
        cacheDir: opts.cache,
        ...(session && { isSessionOpen: sessionChecker(session, output) }),
        log: (line) => stderr.write(`${line}\n`),
      });
      stdout.write(`${JSON.stringify({ port: keeper.port, entries: keeper.entries })}\n`);
      await waitUntilStopped(keeper);
    });
}

/**
 * Register the `cache` group.
 * @param {import('commander').Command} program
 * @param {{ stdout?: object, stderr?: object, driverFactory?: Function }} deps
 */
export function registerCache(program, deps = {}) {
  const { stdout = process.stdout, stderr = process.stderr } = deps;
  const group = program
    .command('cache')
    .description('cache original pages locally for offline replay');
  registerServe(group, { stdout, stderr });
  registerRecord(group, deps);
  registerProxy(group, { stdout, stderr });
  registerKeeper(group, { stdout, stderr });
}
