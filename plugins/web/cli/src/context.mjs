import { existsSync } from 'node:fs';
import { createDriver } from '#src/driver/playwright-cli.mjs';
import { emit } from '#src/output.mjs';
import { DEFAULT_RECIPE } from '#src/recipe.mjs';
import { CliError } from '#src/errors.mjs';

// A playwright-cli call that navigates must outlive its navigation timeout, so that the
// navigation error (not a bare TIMEOUT) is what gets reported.
const CALL_MARGIN_MS = 5_000;

/**
 * `WEB_TIMEOUT`: how long one browser step (a navigation, one playwright-cli call) may take,
 * in ms; undefined when unset.
 * @param {NodeJS.ProcessEnv} env
 */
export function stepTimeout(env) {
  const raw = env.WEB_TIMEOUT;
  if (raw === undefined || raw === '') return undefined;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new CliError('USAGE', `WEB_TIMEOUT must be a positive integer (ms), got: ${raw}`, {
      hint: 'e.g. WEB_TIMEOUT=120000 for remote browsers that take up to 2 minutes to load',
    });
  }
  return ms;
}

/**
 * Shared per-command context. `recipe` is the recipe to launch browsers with: `--recipe`,
 * else `WEB_RECIPE`, else `./recipe.json` when it exists.
 * `recipeExplicit` is true when `--recipe` was typed, not defaulted.
 * `WEB_TIMEOUT` (see stepTimeout) overrides the command's own call timeout and sets the
 * navigation timeout of the browsers the command launches.
 * @param {import('commander').Command} command
 * @param {object} deps
 * @param {{ timeoutMs?: number }} [driverOpts]
 */
export function createContext(command, deps, { timeoutMs } = {}) {
  const opts = command.optsWithGlobals();
  const step = stepTimeout(deps.env ?? process.env);
  const callTimeout = step === undefined ? timeoutMs : step + CALL_MARGIN_MS;
  const driver = (deps.driverFactory ?? createDriver)({
    outputDir: opts.output,
    ...(callTimeout === undefined ? {} : { timeoutMs: callTimeout }),
    ...(step === undefined ? {} : { navigationTimeoutMs: step }),
  });
  driver.ensureAvailable();
  const print = (result, text) =>
    emit(result, { format: opts.format, text, stdout: deps.stdout ?? process.stdout });
  const recipe = opts.recipe ?? (existsSync(DEFAULT_RECIPE) ? DEFAULT_RECIPE : undefined);
  const recipeExplicit = command.getOptionValueSourceWithGlobals('recipe') === 'cli';
  return { opts, driver, print, recipe, recipeExplicit };
}
