// Turns a raw I/O Runtime activation record (plus its separately fetched log lines) into a small, redacted summary.
import { redact, redactLinesWithStatus } from './redact.mjs';

const STATUS = ['success', 'app error', 'dev error', 'sys error'];
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);
const annotation = (record, key) => record.annotations?.find((a) => a.key === key)?.value;
const pad = (n) => String(n).padStart(2, '0');

export const isSequence = (record) => annotation(record, 'kind') === 'sequence';

// A secured action runs as a sequence (sign-in check, then __secured_<action>), so one request yields two records.
// Drop the sequence record only when a run it chained is present and accounts for its outcome: a successful sequence,
// or a failed one whose chained run failed too. A failed sequence whose present runs all succeeded (a later step
// never ran) is kept. Without component ids, keep it: matching by time could hide an unrelated failure.
export function dropChainedSequences(records) {
  const byId = new Map(records.map((r) => [r.activationId, r]));
  return records.filter((r) => {
    if (!isSequence(r)) return true;
    const chained = (r.logs ?? []).filter((id) => id !== r.activationId).map((id) => byId.get(id)).filter(Boolean);
    if (!chained.length) return true;
    return statusCodeOf(r) !== 0 && !chained.some((c) => statusCodeOf(c) !== 0);
  });
}

// Summary rows carry `statusCode`; full records (--full, activation get) may only carry `response.status`/`success`.
const STATUS_NAMES = { success: 0, 'application error': 1, 'action developer error': 2, 'whisk internal error': 3 };
function statusCodeOf(record) {
  const code = record.statusCode ?? record.response?.statusCode ?? STATUS_NAMES[record.response?.status];
  return code ?? (record.response?.success === false ? 1 : 0);
}

// Local time with UTC offset, because the developer thinks in their own time zone.
function localTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zone}`;
}

function outcomeOf(record) {
  const code = statusCodeOf(record);
  // Runtime reports timeouts as an application error with the `timeout` annotation set.
  if (annotation(record, 'timeout') === true) return 'timeout';
  const result = record.response?.result ?? {};
  // Web actions report HTTP errors either as a returned statusCode (a "successful" run) or via { error: { statusCode } }.
  const httpStatus = Number(result.error?.statusCode ?? result.statusCode);
  const status = STATUS[code] ?? 'unknown';
  if (httpStatus >= 400) return code ? `http ${httpStatus} (${status})` : `http ${httpStatus}`;
  return status;
}

function errorOf(record) {
  const result = record.response?.result ?? {};
  const error = result.error?.body?.error ?? result.error ?? result.body?.error ?? (Number(result.statusCode) >= 400 ? result.body : undefined);
  if (error === undefined) return '';
  return clip(redact(typeof error === 'string' ? error : JSON.stringify(error)), 300);
}

// Picks the first error line plus the last lines, skipping stack frames. Lines are shortened to `stdout|stderr: <message>`,
// dropping the outer timestamp and the SDK logger's `<time> [main /namespace/pkg/action]` prefix (the table has both).
const message = (line) => line.replace(/^\S+\s+(stdout|stderr):\s?/, '');
const compact = (line) => line.replace(/^\S+\s+(stdout|stderr):\s?(?:\S+Z\s+\[[^\]]+\]\s+)?/, '$1: ');
function relevantLogs(lines, logLines) {
  const useful = lines.filter((line) => !/^\s*(at\s|[{}]\s*$)/.test(message(line)));
  const firstError = useful.find((line) => /\b(error|exception|failed|failure|denied|forbidden|unauthori[sz]ed)\b|\w+Error\b/i.test(message(line)));
  const tailCount = firstError ? logLines - 1 : logLines;
  const tail = (tailCount > 0 ? useful.slice(-tailCount) : []).filter((line) => line !== firstError);
  return (firstError ? [firstError, ...tail] : tail).map((line) => clip(compact(line), 300));
}

/**
 * @param {object} record  activation record from `aio rt activation list --full` or `activation get`
 * @param {object} [options]
 * @param {{status: 'fetched'|'failed'|'not-fetched', lines?: string[], reason?: string}} [options.logs]
 *   log lines from `aio rt activation logs`; records themselves carry none.
 * @param {number} [options.logLines] lines to keep: relevant lines for the table, or the first N in detail mode.
 * @param {boolean} [options.detail] keep log lines in order (drill-down) instead of picking the relevant ones.
 */
export function summarize(record, { logs = { status: 'not-fetched' }, logLines = 5, detail = false } = {}) {
  const sequence = isSequence(record);
  // Redacted line by line with state, so values spanning lines (private keys) are caught and no line is dropped.
  const raw = logs.status === 'fetched' ? logs.lines ?? [] : [];
  const { lines, suppressed } = redactLinesWithStatus(raw);
  const outcome = outcomeOf(record);
  return {
    id: record.activationId,
    time: localTime(record.start),
    startMs: record.start ?? 0,
    action: redact(String(annotation(record, 'path') ?? record.name).split('/').slice(-2).join('/')),
    outcome,
    failed: outcome !== 'success',
    durationMs: record.duration ?? null,
    sequence,
    startType: sequence ? null : annotation(record, 'initTime') ? 'cold' : 'warm',
    error: errorOf(record),
    logStatus: sequence ? 'sequence' : logs.status === 'fetched' && !lines.length ? 'empty' : logs.status,
    ...(logs.status === 'failed' ? { logError: clip(redact(logs.reason ?? ''), 200) } : {}),
    logs: detail ? lines.slice(0, logLines).map((line) => clip(line, 2000)) : relevantLogs(lines, logLines),
    // An overlong sensitive value hid the rest of this run's log; the last log line is the redactor's notice.
    ...(suppressed ? { suppressed: true } : {}),
    // Counts refer to the lines Runtime returned; lines inside a masked private key are not shown.
    ...(detail ? { logCount: raw.length, logsShown: Math.min(lines.length, logLines), logsOmitted: Math.max(0, lines.length - logLines) } : {}),
    // A sequence record lists the activation ids of the runs it chained.
    ...(sequence ? { components: record.logs ?? [] } : {}),
  };
}
