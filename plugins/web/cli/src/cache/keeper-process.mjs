import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { CliError } from '#src/errors.mjs';
import { artifactPath } from '#src/session.mjs';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 1_000;

const stateFile = (outputDir, session) => artifactPath(outputDir, session, 'cache', 'keeper.json');
const logFile = (outputDir, session) => artifactPath(outputDir, session, 'cache', 'keeper.log');

/**
 * Whether `pid` is still a cache keeper: a stale state file may name a pid the OS has since
 * given to an unrelated process. Without `ps` (or on any failure) the answer is no.
 */
function isKeeperProcess(pid) {
  const res = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.includes('cache keeper');
}

/** The error document a failed `web` run printed on stdout, if any. */
function cliErrorFrom(stdout) {
  try {
    const { error } = JSON.parse(stdout);
    if (error?.code) return new CliError(error.code, error.message, { hint: error.hint });
  } catch {
    // Not an error document: the caller reports the generic failure.
  }
  return null;
}

/** Resolve with the keeper's `{ port, entries }` line, or reject when it exits or stalls. */
function readReady(child, log) {
  return new Promise((resolve, reject) => {
    let out = '';
    const failed = (detail) =>
      new CliError('INTERNAL', `cache keeper did not start: ${detail}`, {
        hint: `see ${log}`,
      });
    const timer = setTimeout(() => {
      child.kill();
      reject(failed(`no answer within ${START_TIMEOUT_MS} ms`));
    }, START_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const newline = out.indexOf('\n');
      if (newline < 0) return;
      try {
        const ready = JSON.parse(out.slice(0, newline));
        if (Number.isInteger(ready.port)) {
          clearTimeout(timer);
          resolve(ready);
        }
      } catch {
        // A pretty-printed error document spans lines: wait for the exit to read it whole.
      }
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(failed(err.message));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(cliErrorFrom(out) ?? failed(`exit ${code}`));
    });
  });
}

/**
 * Stop the keeper of `session`, if one was started. Returns its counters, or null when there
 * was no keeper or it was no longer reachable.
 * @param {{ session: string, outputDir: string }} opts
 * @returns {Promise<{ hits: number, misses: number, stored: number, errors: number } | null>}
 */
export async function stopKeeper({ session, outputDir }) {
  const file = stateFile(outputDir, session);
  if (!existsSync(file)) return null;
  const { pid, port } = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file, { force: true });
  const base = `http://127.0.0.1:${port}`;
  try {
    const status = await fetch(`${base}/__status`, {
      signal: AbortSignal.timeout(STOP_TIMEOUT_MS),
    }).then((res) => res.json());
    await fetch(`${base}/__stop`, { signal: AbortSignal.timeout(STOP_TIMEOUT_MS) });
    const { hits, misses, stored, errors } = status;
    return { hits, misses, stored, errors };
  } catch {
    if (isKeeperProcess(pid)) {
      try {
        process.kill(pid);
      } catch {
        // Exited between the check and the signal: nothing left to stop.
      }
    }
    return null;
  }
}

/**
 * Start `web cache keeper` for `session` as a detached background process, record it in the
 * session's keeper state file and return once it listens. A keeper left over from an earlier
 * session of the same name is stopped first.
 * @param {{ cacheDir: string, session: string, outputDir: string, argv1?: string }} opts
 *   `argv1` is the `web` entry script to run (default: the current one).
 * @returns {Promise<{ pid: number, port: number, entries: number, dir: string }>}
 */
export async function startKeeperProcess({
  cacheDir,
  session,
  outputDir,
  argv1 = process.argv[1],
}) {
  await stopKeeper({ session, outputDir });
  const dir = path.resolve(cacheDir);
  mkdirSync(outputDir, { recursive: true });
  const log = logFile(outputDir, session);
  const logFd = openSync(log, 'w');
  const args = [argv1, 'cache', 'keeper', '--cache', dir, '--session', session];
  const child = spawn(process.execPath, [...args, '--output', outputDir], {
    detached: true,
    stdio: ['ignore', 'pipe', logFd],
  });
  closeSync(logFd);
  const ready = await readReady(child, log);
  child.removeAllListeners('exit');
  child.stdout.destroy();
  child.unref();
  const state = { pid: child.pid, port: ready.port, dir };
  writeFileSync(stateFile(outputDir, session), JSON.stringify(state));
  return { ...state, entries: ready.entries };
}

/**
 * Whether `session` was opened with a cache keeper (its state file exists).
 * @param {{ session: string, outputDir: string }} opts
 */
export function hasKeeper({ session, outputDir }) {
  return existsSync(stateFile(outputDir, session));
}
