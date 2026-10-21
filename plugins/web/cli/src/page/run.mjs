import { CliError } from '#src/errors.mjs';
import { createContext } from '#src/context.mjs';
import { withSession } from '#src/session.mjs';
import { assertNotBlocked } from '#src/driver/blocked.mjs';

/**
 * Run `fn` on a page (given url or open session) and print its result with metadata.
 * Result is spread first, so url/session/durationMs override same-named result fields.
 * @param {import('commander').Command} command
 * @param {object} deps
 * @param {{ url?: string, fn: (driver: object, session: string, opts: object) => object }} spec
 */
export async function runPageCommand(command, deps, { url, fn }) {
  const ctx = createContext(command, deps);
  if (!url && !ctx.opts.session) {
    throw new CliError('USAGE', 'pass a <url> or --session <name>', {
      hint: 'web browser open <url> --session <name>',
    });
  }
  const start = Date.now();
  let health;
  const { session, result } = await withSession(
    ctx.driver,
    { session: ctx.opts.session, url, headed: ctx.opts.headed, recipePath: ctx.opts.recipe },
    async (name) => {
      health = ctx.driver.pageHealth(name);
      assertNotBlocked(health);
      return { session: name, result: await fn(ctx.driver, name, ctx.opts) };
    },
  );
  const doc = {
    ...result,
    url: health?.url || url,
    session,
    durationMs: Date.now() - start,
  };
  ctx.print(doc, result.text);
}
