// Redacts text line by line as it arrives (e.g. the log of a running `aio app dev`, or pasted logs), so it can sit in a
// pipe of a long-running command. Private-key blocks spanning lines are masked as a whole.
// Usage: <command> | node redact-text.mjs      or      node redact-text.mjs < file
import { createInterface } from 'node:readline';
import { createLineRedactor } from './lib/redact.mjs';

const redactLine = createLineRedactor();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const out = redactLine(line);
  if (out !== null) process.stdout.write(`${out}\n`);
});
// Ctrl+C reaches every process in the pipe; stop reading cleanly (each line is already written) instead of being killed.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => rl.close());
// Exit naturally rather than with process.exit(), so output still queued for a pipe is written first.
rl.on('close', () => {
  process.stdin.destroy();
  process.exitCode = 0;
});
