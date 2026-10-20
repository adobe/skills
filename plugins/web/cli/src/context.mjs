import { createDriver } from '#src/driver/playwright-cli.mjs';
import { emit } from '#src/output.mjs';

/**
 * Shared per-command context.
 * @param {import('commander').Command} command
 * @param {object} deps
 * @param {{ timeoutMs?: number }} [driverOpts]
 */
export function createContext(command, deps, { timeoutMs } = {}) {
  const opts = command.optsWithGlobals();
  const driver = (deps.driverFactory ?? createDriver)({
    outputDir: opts.output,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  driver.ensureAvailable();
  const print = (result, text) =>
    emit(result, { format: opts.format, text, stdout: deps.stdout ?? process.stdout });
  return { opts, driver, print };
}
