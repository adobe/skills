import { spawn, spawnSync } from 'node:child_process';

/**
 * Run playwright-cli with `--json` appended.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string }} [opts]
 * @returns {{ stdout: string, stderr: string, status: number | null, error?: Error }}
 */
export function execPlaywrightCli(args, { timeoutMs = 60_000, cwd = process.cwd() } = {}) {
  const res = spawnSync('playwright-cli', [...args, '--json'], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs,
    cwd,
  });
  const { status, error } = res;
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status, error };
}

/**
 * `execPlaywrightCli` without blocking the event loop: several sessions can run at once (the
 * header text check compares sizes in parallel). Same result shape; a timeout kills the process
 * and reports `error.code === 'ETIMEDOUT'`, as spawnSync does.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, status: number | null, error?: Error }>}
 */
export function execPlaywrightCliAsync(args, { timeoutMs = 60_000, cwd = process.cwd() } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn('playwright-cli', [...args, '--json'], { cwd });
    const out = [];
    const err = [];
    let error;
    const timer = setTimeout(() => {
      error = Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' });
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      error = e;
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        status: error ? null : status,
        ...(error ? { error } : {}),
      });
    });
  });
}
