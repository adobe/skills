// Reads the private log of a running `aio app dev` (started with its output sent to logs/aio-dev.log) and prints only
// what the agent needs: whether it's ready, the local URLs, and the last lines, redacted. Never read the log directly.
// Usage: node dev-log.mjs [--lines 40] [--file logs/aio-dev.log]
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { redactLinesWithStatus } from './lib/redact.mjs';

let opt;
try {
  opt = parseArgs({ options: { lines: { type: 'string', default: '40' }, file: { type: 'string', default: 'logs/aio-dev.log' } } }).values;
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}
if (!existsSync(opt.file)) {
  console.log(JSON.stringify({ ok: false, error: `No ${opt.file} yet. Start the dev server with its output sent there.` }));
  process.exit(1);
}

// Windows PowerShell 5.1 writes redirected output as UTF-16LE with a byte-order mark; other shells write UTF-8.
const raw = readFileSync(opt.file);
const decoded = raw[0] === 0xff && raw[1] === 0xfe ? raw.subarray(2).toString('utf16le') : raw.toString('utf8');
// eslint-disable-next-line no-control-regex
const text = decoded.replace(/^\uFEFF/, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
// Extract URLs only after redaction, preserving the sensitive-value context across lines. When an overlong sensitive
// value suppresses the rest of the log, later URLs and errors are hidden too; `suppressed` says so.
const redacted = redactLinesWithStatus(text.split(/\r?\n/));
const lines = redacted.lines.filter((line) => line.trim());
const safeText = lines.join('\n');
const after = (label) => safeText.match(new RegExp(`${label}:?\\s*\\n\\s*->\\s*(\\S+)`))?.[1] ?? null;
const count = Math.min(Math.max(Number(opt.lines) || 40, 1), 500);

console.log(JSON.stringify({
  ok: true,
  ready: text.includes('press CTRL+C to terminate the dev environment'),
  waitingForCertificate: /Waiting for the certificate to be accepted/.test(text) && !/accepted the certificate|timed out/.test(text),
  localUrl: after('To view your local application'),
  experienceCloudUrl: after('To view your deployed application in the Experience Cloud shell'),
  actionUrls: [...safeText.matchAll(/^\s*->\s*(https:\/\/localhost:\d+\/api\/\S+)/gm)].map((m) => m[1]),
  errors: lines.filter((line) => /\berror\b|\bfailed\b|✖|Unauthorized/i.test(line)).slice(-10),
  suppressed: redacted.suppressed,
  tail: lines.slice(-count),
}, null, 2));
