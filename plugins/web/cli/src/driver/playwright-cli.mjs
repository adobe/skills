import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execPlaywrightCli } from './exec.mjs';
import { CliError } from '#src/errors.mjs';

const MIN_VERSION = '0.1.20';
const INSTALL_HINT = 'npm install -g @playwright/cli@latest';

function versionAtLeast(found, min) {
  const a = found.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < b.length; i += 1) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unwrapResult(doc) {
  const raw = doc?.result;
  if (typeof raw !== 'string') return raw;
  const parsed = tryParse(raw);
  return parsed === undefined ? raw : parsed;
}

function wrapExpression(expr) {
  try {
    new Function(`return (${expr}\n)`);
    return expr;
  } catch {
    return `(() => { ${expr} })()`;
  }
}

function toCliError(message) {
  if (/not open, please run open first/.test(message)) {
    return new CliError('NO_SESSION', message, {
      hint: 'run: web browser open <url> --session <name>',
    });
  }
  return new CliError('PLAYWRIGHT_CLI', message);
}

function spawnError(error, args) {
  if (error.code === 'ETIMEDOUT') {
    return new CliError('TIMEOUT', `playwright-cli ${args[1] ?? args[0]} timed out`);
  }
  if (error.code === 'ENOENT') {
    return new CliError('PLAYWRIGHT_CLI', 'playwright-cli not found', { hint: INSTALL_HINT });
  }
  return new CliError('PLAYWRIGHT_CLI', `playwright-cli failed: ${error.code}: ${error.message}`);
}

/**
 * @param {{ exec?: typeof execPlaywrightCli, outputDir: string, debug?: boolean, timeoutMs?: number }} opts
 */
export function createDriver({
  exec = execPlaywrightCli,
  outputDir,
  debug = Boolean(process.env.WEB_DEBUG),
  timeoutMs = 60_000,
}) {
  let runCounter = 0;

  function call(args, opts) {
    if (debug) process.stderr.write(`playwright-cli ${args.join(' ')}\n`);
    const res = exec(args, { timeoutMs, ...opts });
    if (res.error) throw spawnError(res.error, args);
    if (res.status === null) {
      throw new CliError('PLAYWRIGHT_CLI', 'playwright-cli terminated by signal');
    }
    const doc = tryParse(res.stdout);
    const failure = doc?.isError ? doc.error : doc?.result?.isError ? doc.result.error : undefined;
    if (failure !== undefined) throw toCliError(String(failure));
    if (res.status !== 0) {
      const detail = (res.stderr || res.stdout).trim();
      throw new CliError('PLAYWRIGHT_CLI', detail || `exit ${res.status}`);
    }
    return doc ?? {};
  }

  function withTempFile(name, content, fn) {
    mkdirSync(outputDir, { recursive: true });
    const path = join(outputDir, name);
    writeFileSync(path, content);
    try {
      return fn(path);
    } finally {
      rmSync(path, { force: true });
    }
  }

  function list() {
    const doc = call(['list']);
    return (doc.browsers ?? []).map((b) => ({
      name: b.name,
      status: b.status,
      headed: b.headed,
      browserType: b.browserType,
      attached: b.attached,
    }));
  }

  function buildConfig({ config = {}, initScripts, cdpPort }) {
    const launchOptions = { ...config.launchOptions };
    if (cdpPort) {
      launchOptions.args = [...(launchOptions.args ?? []), `--remote-debugging-port=${cdpPort}`];
    }
    const initScript = [...(config.initScript ?? []), ...initScripts].map((p) => resolve(p));
    return { browser: { ...config, launchOptions, initScript } };
  }

  /**
   * `initScripts` are paths; `initSources` are script texts, written to files only while the
   * browser launches (playwright-cli reads them at launch) and removed after.
   */
  function open({ initScripts = [], initSources = [], ...launchOpts }) {
    mkdirSync(outputDir, { recursive: true });
    const sourcePaths = initSources.map((source, i) => {
      const path = join(outputDir, `${launchOpts.session}-init-${i}.js`);
      writeFileSync(path, source);
      return path;
    });
    try {
      return launch({ ...launchOpts, initScripts: [...initScripts, ...sourcePaths] });
    } finally {
      for (const path of sourcePaths) rmSync(path, { force: true });
    }
  }

  function launch({ session, url, headed, config, cdpPort, persistent, initScripts }) {
    if (list().some((b) => b.name === session && b.status === 'open')) {
      throw new CliError('SESSION_EXISTS', `session '${session}' is already open`, {
        hint: 'choose another --session or run: web browser close --session <name>',
      });
    }
    const body = JSON.stringify(buildConfig({ config, initScripts, cdpPort }));
    withTempFile(`${session}-cli-config.json`, body, (path) => {
      const args = [`-s=${session}`, 'open'];
      if (url) args.push(url);
      args.push(`--config=${path}`);
      if (headed) args.push('--headed');
      if (persistent) args.push('--persistent');
      call(args);
    });
    return { session, url, headed, cdpPort };
  }

  /**
   * Evaluate JS in the page. `expr` is passed through unchanged when it compiles as a single
   * expression (playwright-cli parenthesizes it); otherwise it is wrapped as `(() => { EXPR })()`
   * so callers may write statements with an explicit `return`.
   * @param {string} session
   * @param {string} expr
   */
  function evaluate(session, expr) {
    return unwrapResult(call([`-s=${session}`, 'eval', wrapExpression(expr)]));
  }

  function run(session, { code, file }) {
    const exec1 = (path) => unwrapResult(call([`-s=${session}`, 'run-code', `--filename=${path}`]));
    if (code === undefined) return exec1(file);
    runCounter += 1;
    return withTempFile(`${session}-run-${runCounter}.mjs`, code, exec1);
  }

  return {
    ensureAvailable() {
      const res = exec(['--version'], { timeoutMs: 10_000 });
      const found = res.status === 0 ? res.stdout.trim().match(/\d+\.\d+\.\d+/)?.[0] : undefined;
      if (!found) {
        throw new CliError('PLAYWRIGHT_CLI', 'playwright-cli not found', { hint: INSTALL_HINT });
      }
      if (!versionAtLeast(found, MIN_VERSION)) {
        throw new CliError(
          'PLAYWRIGHT_CLI',
          `playwright-cli ${found} is older than ${MIN_VERSION}`,
          { hint: INSTALL_HINT },
        );
      }
    },
    open,
    goto(session, url) {
      call([`-s=${session}`, 'goto', url]);
    },
    attach({ session, cdpUrl }) {
      call(['attach', `--cdp=${cdpUrl}`, `--session=${session}`]);
      return { session, attached: true };
    },
    list,
    close(session) {
      call([`-s=${session}`, 'close']);
    },
    closeAll() {
      call(['close-all']);
    },
    evaluate,
    run,
    inject(session, source) {
      run(session, { code: `async page => { await page.evaluate(${JSON.stringify(source)}) }` });
    },
    cdp(session, method, params = {}) {
      return run(session, {
        code:
          `async page => { const s = await page.context().newCDPSession(page); ` +
          `return s.send(${JSON.stringify(method)}, ${JSON.stringify(params)}) }`,
      });
    },
    screenshot(session, { path, fullPage, selector }) {
      const args = [`-s=${session}`, 'screenshot'];
      if (selector) args.push(selector);
      args.push(`--filename=${path}`);
      if (fullPage) args.push('--full-page');
      call(args);
      return { path };
    },
    pageHealth(session) {
      return evaluate(
        session,
        '({ title: document.title, url: location.href, ' +
          'bodyLength: document.body ? document.body.innerText.length : 0, ' +
          "status: performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0, " +
          "hasMainContent: !!document.querySelector('main, article, [role=main]') })",
      );
    },
    requests(session) {
      return call([`-s=${session}`, 'requests', '--static']).result;
    },
    responseHeaders(session, index) {
      return call([`-s=${session}`, 'response-headers', String(index)]).result;
    },
  };
}
