// Calls `aio rt` / `aio app` and returns parsed results; failures carry only a short, redacted reason.
import { aio, parseJsonOutput } from './run.mjs';
import { redact } from './redact.mjs';

const PAGE = 50;

const reasonOf = (res) => {
  if (res.timedOut) return 'timed out';
  const line = res.stderr.split('\n').find((l) => /error|denied|unauthori[sz]ed|forbidden|not found|\b[45]\d\d\b/i.test(l));
  return redact(line ?? '').trim().slice(0, 200);
};
const failure = (args, res) => {
  const reason = reasonOf(res);
  return new Error(`aio ${args.slice(0, 3).join(' ')} failed${reason ? `: ${reason}` : ''}.`);
};

export function aioJson(args) {
  const res = aio(args, { timeoutMs: 90_000 });
  if (!res.ok) throw failure(args, res);
  const value = parseJsonOutput(res.stdout);
  // A parse error would quote the output, which may hold secrets, so the message is fixed.
  if (value === undefined) throw new Error(`Unexpected output from aio ${args.slice(0, 3).join(' ')}.`);
  return value;
}

export function listActivations(name, range, maxPages) {
  const records = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = aioJson(['rt', 'activation', 'list', name, '--since', String(range.since), '--upto', String(range.upto),
      '--full', '-l', String(PAGE), '-s', String(page * PAGE)]);
    if (!Array.isArray(batch)) throw new Error(`Unexpected output from aio rt activation list ${name}.`);
    records.push(...batch);
    if (batch.length < PAGE) return { records, truncated: false };
  }
  return { records, truncated: true };
}

// Activation records carry no log lines; `aio rt activation logs` prints them as raw text, so callers must redact.
// A failed fetch is reported as such, never as "no logs".
export function activationLogs(id) {
  const res = aio(['rt', 'activation', 'logs', id], { timeoutMs: 30_000 });
  if (!res.ok) return { status: 'failed', reason: reasonOf(res) || 'aio rt activation logs failed' };
  return { status: 'fetched', lines: res.stdout.split('\n').filter((line) => line.trim() && !line.startsWith('=== activation logs')) };
}

// Only the destination name is returned; the command also prints settings that can hold credentials.
// When local and server settings differ, only the server block (printed last) is read.
export function logDestination() {
  const res = aio(['app', 'config', 'get', 'log-forwarding']);
  if (!res.ok) return null;
  const server = res.stdout.split('Server configuration:').pop();
  if (/^Not defined/m.test(server)) return 'adobe_io_runtime';
  return server.match(/^destination:\s*(\S+)/m)?.[1] ?? null;
}
