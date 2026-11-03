import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Stops every Chromium the skill launched (any port the agent chose) and drops its profiles. */
export async function extensionHook(hookName) {
  if (hookName !== 'afterEach' && hookName !== 'beforeEach') return;
  const processes = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8' }).split('\n');
  for (const line of processes) {
    const [, pid, command] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    if (command?.startsWith('/Applications/Chromium.app/') && command.includes('--user-data-dir=/tmp/cdp-ext-pilot-')) {
      process.kill(Number(pid));
    }
  }
  for (const dir of readdirSync(tmpdir()).filter((d) => d.startsWith('cdp-ext-pilot-'))) {
    rmSync(join(tmpdir(), dir), { recursive: true, force: true });
  }
}
