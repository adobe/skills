import { execFileSync } from 'node:child_process';
import { killHeadedBrowsers } from './headless.mjs';

/** Session names open before the first run started; captured once, never closed by the hook. */
let knownSessions = null;

function listSessionNames() {
  try {
    const out = execFileSync('playwright-cli', ['list', '--json'], {
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return (JSON.parse(out).browsers ?? []).map((b) => b.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Closes the playwright-cli browser a run left open (named by metadata.runId), after its assertions ran. */
export async function extensionHook(hookName, context) {
  if (hookName === 'beforeEach') {
    killHeadedBrowsers();
    knownSessions ??= new Set(listSessionNames());
  }
  if (hookName !== 'afterEach') return;
  killHeadedBrowsers();
  const runId = context.result?.response?.metadata?.runId;
  if (runId) closeSession(`run-${runId}`, ['close', 'delete-data']);
  closeInventedSessions(runId ? `run-${runId}` : null);
  closeEphemeralWebSessions();
}

function closeSession(session, cmds) {
  for (const cmd of cmds) {
    try {
      execFileSync('playwright-cli', [`-s=${session}`, cmd], { stdio: 'ignore', timeout: 30_000 });
    } catch {
      // session was never opened or is already gone
    }
  }
}

/**
 * Close sessions an agent invented (not open before the first run, not `run-*`).
 * Trade-off: with parallel runs, another run's invented session may be closed early;
 * `run-*` sessions are left to their own run's afterEach to limit that.
 */
function closeInventedSessions(ownSession) {
  for (const name of listSessionNames()) {
    if (knownSessions?.has(name) || (/^run-/.test(name) && name !== ownSession)) continue;
    closeSession(name, ['close']);
  }
}

/** The web CLI closes its own ephemeral `web-*` sessions; close any it could not (best effort). */
function closeEphemeralWebSessions() {
  try {
    const { browsers = [] } = JSON.parse(execFileSync('playwright-cli', ['list', '--json'], { encoding: 'utf-8', timeout: 30_000 }));
    for (const { name } of browsers.filter((b) => b.name?.startsWith('web-'))) {
      execFileSync('playwright-cli', [`-s=${name}`, 'close'], { stdio: 'ignore', timeout: 30_000 });
    }
  } catch {
    // playwright-cli missing, no sessions, or already closed
  }
}
