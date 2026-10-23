import { existsSync } from 'node:fs';
import { createDriver } from '#src/driver/playwright-cli.mjs';
import { emit } from '#src/output.mjs';
import { DEFAULT_RECIPE } from '#src/recipe.mjs';

/**
 * Shared per-command context. `recipe` is the recipe to launch browsers with: `--recipe`,
 * else `WEB_RECIPE`, else `./recipe.json` when it exists.
 * `recipeExplicit` is true when `--recipe` was typed, not defaulted.
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
  const recipe = opts.recipe ?? (existsSync(DEFAULT_RECIPE) ? DEFAULT_RECIPE : undefined);
  const recipeExplicit = command.getOptionValueSourceWithGlobals('recipe') === 'cli';
  return { opts, driver, print, recipe, recipeExplicit };
}
