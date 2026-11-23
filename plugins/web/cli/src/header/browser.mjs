/**
 * The browser the header checks drive, on the CLI's driver. The checks name their sessions
 * (`plg-src-o`, `<id>-panels`) and call openSession / runCode / runCodeAsync / closeSession; the
 * `header` commands point those at a `webBrowser` for the length of one command (useBrowser).
 * - Each name gets a session of its own with a generated name (`web-<6 hex>`): session names are
 *   global per machine.
 * - The viewport, device scale factor and bypassCSP (the checks inject their scripts) go in the
 *   launch config.
 * - runCode is the driver's run; runCodeAsync its runAsync, so a check's parallel sizes run at once.
 * - A call without a timeout gets `runTimeoutMs` (20 min): one menu sweep takes longer than the
 *   driver's default (60 s).
 * - No browser is left behind untracked: a launch that fails after Chromium may have started is
 *   closed; a close that fails is retried by closeAll(), and one that still fails is reported with
 *   its session name.
 */
import { randomBytes } from 'node:crypto';

/** A run result: the checks' snippets return a JSON string, or nothing. */
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
 * `driver`: the CLI's driver (or a fake one in tests).
 * @param {object} driver
 * @param {{ runTimeoutMs?: number, newName?: () => string, warn?: (line: string) => void }} [opts]
 */
export function webBrowser(
  driver,
  {
    runTimeoutMs = 20 * 60_000,
    newName = () => `web-${randomBytes(3).toString('hex')}`,
    warn = (line) => process.stderr.write(`${line}\n`),
  } = {},
) {
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
      decode(
        await driver.runAsync(sessionOf(name), {
          code: source,
          timeoutMs: timeout || runTimeoutMs,
        }),
      ),
    /** Closes every session still open, retries the closes that failed, reports what is left. */
    closeAll() {
      [...names.keys()].forEach(closeSession);
      for (const session of unclosed.keys()) {
        if (!close(session)) {
          warn(
            `warning: browser session ${session} could not be closed (${unclosed.get(session)}): ` +
              `playwright-cli -s=${session} close`,
          );
        }
      }
      return [...unclosed.keys()];
    },
    sessions: () => [...names.values()],
  };
}

let current = null;

/** Every check's browser call from now on goes to `browser` (null: none, calls throw). */
export function useBrowser(browser) {
  current = browser;
}

const active = () => {
  if (!current) throw new Error('no browser: the header checks run inside a `web header` command');
  return current;
};

export const openSession = (...args) => active().openSession(...args);
export const closeSession = (...args) => active().closeSession(...args);
export const runCode = (...args) => active().runCode(...args);
export const runCodeAsync = (...args) => active().runCodeAsync(...args);
