import { spawnSync } from 'node:child_process';

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
