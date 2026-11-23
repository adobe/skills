// Runs a CLI with an argument array and captures its output; nothing is echoed.
import { spawnSync } from 'node:child_process';

// npm and aio are .cmd shims on Windows. Node quotes arguments containing spaces; shell syntax remains forbidden.
const command = (cmd, args) => (process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', cmd, ...args]] : [cmd, args]);

export function run(cmd, args, { timeoutMs = 60_000, discardOutput = false } = {}) {
  if (!['npm', 'aio'].includes(cmd) || !Array.isArray(args)
    || args.some((arg) => typeof arg !== 'string' || !/^[A-Za-z0-9_@./:-]+(?: +[A-Za-z0-9_@./:-]+)*$/.test(arg))) {
    throw new Error('Unsupported CLI command or argument. Only letters, digits, internal spaces, _, @, ., /, :, and - are allowed.');
  }
  const res = spawnSync(...command(cmd, args), { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', discardOutput ? 'ignore' : 'pipe', discardOutput ? 'ignore' : 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
    timedOut: res.error?.code === 'ETIMEDOUT',
    notFound: res.error?.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(res.stderr ?? ''),
  };
}

export const aio = (args, opts) => run('aio', args, opts);

// CLI JSON may follow banner or warning lines (which can themselves contain brackets). Try each line that starts
// a JSON value, from the top, and return the first complete parse. Returns undefined instead of throwing, because
// parse errors quote the input, which may hold secrets.
export function parseJsonOutput(text) {
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[[{]/.test(lines[i])) continue;
    try {
      return JSON.parse(lines.slice(i).join('\n'));
    } catch {
      // Not the start of the JSON document; keep looking.
    }
  }
  return undefined;
}
