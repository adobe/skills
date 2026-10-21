import { resolve } from 'node:path';
import { parseIntArg, parsePositiveIntArg } from '#src/args.mjs';
import { CliError } from '#src/errors.mjs';
import { emit } from '#src/output.mjs';
import { startCacheProxy } from '#src/cache/proxy.mjs';

const HELP = `
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

/**
 * Register the `cache` group.
 * @param {import('commander').Command} program
 * @param {{ stdout?: object, stderr?: object }} deps
 */
export function registerCache(program, deps = {}) {
  const { stdout = process.stdout, stderr = process.stderr } = deps;
  program
    .command('cache')
    .description('cache original pages locally for offline replay')
    .command('serve')
    .description('run the caching reverse proxy')
    .option('--port <n>', 'port to listen on (0 = any free port)', parseIntArg, 3001)
    .option('--cache <dir>', 'cache directory', '.page-cache')
    .option('--offline', 'serve from the cache only, never fetch')
    .option('--timeout <ms>', 'upstream fetch deadline', parsePositiveIntArg, 30000)
    .option('--also <origins>', 'other origins whose assets the pages use, comma-separated')
    .addHelpText('after', HELP)
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
