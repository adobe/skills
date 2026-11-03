import { CliError, exitCodeFor } from '#src/errors.mjs';

/**
 * Write one result document to stdout.
 * @param {unknown} result
 * @param {{ format: 'json'|'text', text?: string, stdout?: { write(c: string): unknown } }} opts
 */
export function emit(result, { format, text, stdout = process.stdout }) {
  const json = JSON.stringify(result, null, 2);
  stdout.write(format === 'text' ? `${text ?? json}\n` : `${json}\n`);
}

/**
 * Write the error document to stdout and return the exit code.
 * @param {unknown} err
 * @param {{ stdout?: { write(c: string): unknown },
 *   stderr?: { write(c: string): unknown } }} [io]
 * @returns {number}
 */
export function fail(err, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const e = err instanceof CliError ? err : new CliError('INTERNAL', err?.message ?? String(err));
  const doc = { error: { code: e.code, message: e.message, hint: e.hint } };
  stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  stderr.write(`${e.code}: ${e.message}\n`);
  return exitCodeFor(e.code);
}
