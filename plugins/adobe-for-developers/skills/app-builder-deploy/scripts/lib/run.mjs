// Runs a CLI with an argument array and captures its output; nothing is echoed.
import { spawnSync } from 'node:child_process';
import { constants as bufferConstants } from 'node:buffer';

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

// npm and aio are .cmd shims on Windows. Node quotes arguments containing spaces; shell syntax remains forbidden.
const command = (cmd, args) => (process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', cmd, ...args]] : [cmd, args]);

export function run(cmd, args, {
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, maxBufferBytes = DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
  discardOutput = false, timeLimitExpiresAtMs = Infinity,
} = {}) {
  if (!['npm', 'aio'].includes(cmd) || !Array.isArray(args)
    || args.some((arg) => typeof arg !== 'string' || !/^[A-Za-z0-9_@./:-]+(?: +[A-Za-z0-9_@./:-]+)*$/.test(arg))) {
    throw new Error('Unsupported CLI command or argument. Only letters, digits, internal spaces, _, @, ., /, :, and - are allowed.');
  }
  const remainingTimeMs = timeLimitExpiresAtMs - Date.now();
  if (remainingTimeMs <= 0) return { ok: false, stdout: '', stderr: '', timedOut: true, timeLimitExceeded: true, notFound: false };
  const effectiveTimeoutMs = Math.min(timeoutMs, remainingTimeMs);
  const res = spawnSync(...command(cmd, args), { encoding: 'utf8', timeout: effectiveTimeoutMs, stdio: ['ignore', discardOutput ? 'ignore' : 'pipe', discardOutput ? 'ignore' : 'pipe'], maxBuffer: maxBufferBytes });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
    timedOut: res.error?.code === 'ETIMEDOUT',
    timeLimitExceeded: res.error?.code === 'ETIMEDOUT' && effectiveTimeoutMs === remainingTimeMs,
    notFound: res.error?.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(res.stderr ?? ''),
  };
}

export const aio = (args, opts) => run('aio', args, opts);

export function integerOption(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`--${name} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

export function commandOptionsFromArgs(options) {
  return {
    ...(options['command-timeout-seconds'] === undefined ? {} : {
      timeoutMs: integerOption(options['command-timeout-seconds'], 'command-timeout-seconds', { max: Math.floor(Number.MAX_SAFE_INTEGER / 1000) }) * 1000,
    }),
    ...(options['max-output-mb'] === undefined ? {} : {
      maxBufferBytes: integerOption(options['max-output-mb'], 'max-output-mb', { max: Math.floor(bufferConstants.MAX_STRING_LENGTH / (1024 * 1024)) }) * 1024 * 1024,
    }),
  };
}

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
