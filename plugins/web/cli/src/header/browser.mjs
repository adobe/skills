/**
 * pw.mjs's API on the web CLI's driver (`createDriver` from ../vendor/web-cli/lib.mjs): the
 * tools run unchanged under the `web-header` binary (lib/browser.mjs useBrowser()).
 * - A tool names its sessions (`plg-src-o`, `<id>-panels`); each name gets a session of its own
 *   with a generated name (`web-<6 hex>`), as the CLI's rules ask: names are global per machine.
 * - The viewport, device scale factor and bypassCSP go in the launch config, as pw.mjs sets them.
 * - runCode is the driver's run (synchronous). runCodeAsync runs the same call in a worker
 *   thread with a driver of its own, so a tool's parallel sizes stay parallel (text-styles.mjs).
 * - A call without a timeout gets `runTimeoutMs` (20 min): pw.mjs's runCode had none, and the
 *   driver's default (60 s) is shorter than one menu sweep.
 * - No browser is left behind untracked (PR #27 review): a launch that fails after Chromium may
 *   have started is closed; a close that fails (closing a session that is not open does not fail)
 *   is retried by closeAll(), and one that still fails is reported with its session name.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

/** A run result as pw.mjs decodes it: the tools' functions return a JSON string, or nothing. */
export function decode(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** The playwright-cli launch config of a session at this size. */
export function launchConfig({ width = 1440, height = 900, scale = 1 } = {}) {
  return {
    browserName: 'chromium',
    contextOptions: { viewport: { width, height }, deviceScaleFactor: scale, bypassCSP: true },
  };
}

/**
 * `driver`: the CLI's driver (or a fake one in tests). `runAsync(session, code, timeoutMs)`: how
 * runCodeAsync runs a call off the main thread (default: a worker with a driver on `libUrl`).
 */
export function webBrowser(driver, {
  runTimeoutMs = 20 * 60_000,
  libUrl = new URL('../vendor/web-cli/lib.mjs', import.meta.url).href,
  runAsync = (session, code, timeoutMs) => runInWorker(libUrl, session, code, timeoutMs),
  newName = () => `web-${randomBytes(3).toString('hex')}`,
  warn = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const names = new Map();
  // sessions whose close failed: closeAll() tries them again, then reports those still open
  const unclosed = new Map();
  const sessionOf = (name) => {
    const session = names.get(name);
    if (!session) throw new Error(`session ${name} is not open (openSession first)`);
    return session;
  };
  /** Closes a session; false (kept in `unclosed` with its error) when the close itself failed. */
  function close(session) {
    try {
      driver.close(session);
      unclosed.delete(session);
      return true;
    } catch (e) {
      unclosed.set(session, e?.message ?? String(e));
      return false;
    }
  }
  function closeSession(name) {
    const session = names.get(name);
    if (!session) return;
    names.delete(name);
    close(session);
  }
  function openSession(name, size = {}) {
    closeSession(name);
    for (let attempt = 1; ; attempt += 1) {
      const session = newName();
      try {
        driver.open({ session, config: launchConfig(size) });
        names.set(name, session);
        return session;
      } catch (e) {
        // the name is another process's browser: never close it, take another name
        if (e?.code === 'SESSION_EXISTS' && attempt < 3) continue;
        // a launch that failed (a timeout, a broken answer) may have started the browser anyway
        if (e?.code !== 'SESSION_EXISTS') close(session);
        throw e;
      }
    }
  }
  return {
    openSession,
    closeSession,
    runCode: (name, source, { timeout = 0 } = {}) =>
      decode(driver.run(sessionOf(name), { code: source, timeoutMs: timeout || runTimeoutMs })),
    runCodeAsync: async (name, source, { timeout = 0 } = {}) =>
      decode(await runAsync(sessionOf(name), source, timeout || runTimeoutMs)),
    /** Closes every session still open, retries the closes that failed, reports what is left. */
    closeAll() {
      [...names.keys()].forEach(closeSession);
      for (const session of unclosed.keys()) { // deleting the current key while iterating is safe
        if (!close(session)) {
          warn(`warning: browser session ${session} could not be closed (${unclosed.get(session)}): playwright-cli -s=${session} close`);
        }
      }
      return [...unclosed.keys()];
    },
    sessions: () => [...names.values()],
  };
}

/** One driver.run in a worker thread; its temp files in a folder of their own. */
function runInWorker(libUrl, session, code, timeoutMs) {
  const outputDir = mkdtempSync(join(tmpdir(), 'web-run-'));
  const worker = new Worker(new URL('./web-run-worker.mjs', import.meta.url), {
    workerData: { libUrl, outputDir, session, code, timeoutMs },
  });
  return new Promise((resolve, reject) => {
    worker.once('message', (m) => (m.ok ? resolve(m.value) : reject(Object.assign(new Error(m.message), { code: m.code }))));
    worker.once('error', reject);
    worker.once('exit', (c) => c && reject(new Error(`run worker exited ${c}`)));
  }).finally(() => rmSync(outputDir, { recursive: true, force: true }));
}
