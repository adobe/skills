// Reads the private log of a running `aio app dev` (started with its output sent to logs/aio-dev.log) and prints only
// what the agent needs: whether it's ready, the local URLs, and the last lines, redacted. Never read the log directly.
// Usage: node dev-log.mjs [--lines 40] [--max-errors 10] [--max-action-urls 500] [--file logs/aio-dev.log]
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createLineRedactor } from './lib/redact.mjs';
import { integerOption } from './lib/run.mjs';

const DEFAULT_TAIL_LINES = 40;

try {
  const options = parseArgs({
    options: {
      lines: { type: 'string', default: String(DEFAULT_TAIL_LINES) },
      'max-errors': { type: 'string', default: '10' }, 'max-action-urls': { type: 'string', default: '500' },
      file: { type: 'string', default: 'logs/aio-dev.log' },
    },
  }).values;
  const tailLineLimit = integerOption(options.lines, 'lines');
  const maxErrors = integerOption(options['max-errors'], 'max-errors', { min: 0 });
  const maxActionUrls = integerOption(options['max-action-urls'], 'max-action-urls', { min: 0 });
  const file = await open(options.file, 'r');
  try {
    // PowerShell 5.1 redirects to UTF-16LE with a BOM; use UTF-8 for other launch paths.
    const bom = Buffer.alloc(2);
    await file.read(bom, 0, 2, 0);
    const isUtf16Le = bom[0] === 0xff && bom[1] === 0xfe;
    const input = file.createReadStream({ start: isUtf16Le ? 2 : 0, encoding: isUtf16Le ? 'utf16le' : 'utf8', autoClose: false });
    const reader = createInterface({ input, crlfDelay: Infinity });
    input.on('error', (error) => reader.emit('error', error));
    const redactLine = createLineRedactor();
    const result = {
      ok: true, ready: false, waitingForCertificate: false,
      localUrl: null, experienceCloudUrl: null, actionUrls: [], actionUrlsTruncated: false,
      errors: [], suppressed: false, tail: [],
    };
    let sawCertificateWait = false;
    let certificateResolved = false;
    let pendingUrlField = null;
    try {
      for await (const rawLine of reader) {
        // Strip terminal colors before checking status or redacting sensitive field names.
        // eslint-disable-next-line no-control-regex
        const line = rawLine.replace(/^\uFEFF/, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        result.ready ||= line.includes('press CTRL+C to terminate the dev environment');
        sawCertificateWait ||= /Waiting for the certificate to be accepted/.test(line);
        certificateResolved ||= /accepted the certificate|timed out/.test(line);
        const redactedLine = redactLine(line);
        if (!redactedLine?.trim()) continue;
        if (pendingUrlField) {
          const url = redactedLine.match(/^\s*->\s*(\S+)/)?.[1];
          if (url && result[pendingUrlField] === null) result[pendingUrlField] = url;
          pendingUrlField = null;
        }
        if (/To view your local application:?\s*$/.test(redactedLine)) pendingUrlField = 'localUrl';
        if (/To view your deployed application in the Experience Cloud shell:?\s*$/.test(redactedLine)) pendingUrlField = 'experienceCloudUrl';
        const actionUrl = redactedLine.match(/^\s*->\s*(https:\/\/localhost:\d+\/api\/\S+)/)?.[1];
        if (actionUrl) {
          if (result.actionUrls.length < maxActionUrls) result.actionUrls.push(actionUrl);
          else result.actionUrlsTruncated = true;
        }
        if (/\berror\b|\bfailed\b|✖|Unauthorized/i.test(redactedLine)) {
          result.errors.push(redactedLine);
          if (result.errors.length > maxErrors) result.errors.shift();
        }
        result.tail.push(redactedLine);
        if (result.tail.length > tailLineLimit) result.tail.shift();
      }
    } finally {
      reader.close();
      input.destroy();
    }
    result.waitingForCertificate = sawCertificateWait && !certificateResolved;
    result.suppressed = redactLine.isSuppressed();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await file.close();
  }
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.code === 'ENOENT' ? 'No dev log yet. Start the dev server with its output sent to the log file.' : 'Could not read the dev log. Check the file and arguments.',
  }));
  process.exitCode = 1;
}
