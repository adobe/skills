// After a deploy: checks that every action of the app, including a secured action's two parts, exists in the
// linked workspace. With --since <epoch ms>, also flags timestamps before that local time (possibly stale code).
// Prints JSON; exits 1 when something is missing or stale, or when the check itself could not run.
// Usage: node verify-actions.mjs [--since <epoch ms>] [--max-pages 40] [--page-size 50]
//        [--command-timeout-seconds 60] [--max-output-mb 64]
import { parseArgs } from 'node:util';
import { readAppContext } from './lib/app-config.mjs';
import { aio, commandOptionsFromArgs, integerOption, parseJsonOutput } from './lib/run.mjs';

// Reads the package's whole action inventory, page by page; an incomplete read is an error, never a "missing".
function deployedActions(pkg, { maxPages, pageSize, ...commandOptions }) {
  const actions = new Map();
  for (let page = 0; page < maxPages; page++) {
    const res = aio(['rt', 'action', 'list', pkg, '--json', '-l', String(pageSize), '-s', String(page * pageSize)], commandOptions);
    if (!res.ok) throw new Error(`Could not list the actions of ${pkg}${res.timedOut ? ' (timed out)' : ''}.`);
    const batch = parseJsonOutput(res.stdout);
    if (!Array.isArray(batch)) throw new Error(`Unexpected output while listing the actions of ${pkg}.`);
    batch.forEach((a) => actions.set(`${pkg}/${a.name}`, a));
    if (batch.length < pageSize) return actions;
  }
  throw new Error(`${pkg} reached the inventory limit of ${pageSize * maxPages} actions; could not confirm the inventory is complete. Increase --max-pages and try again.`);
}

try {
  const options = parseArgs({
    options: {
      since: { type: 'string' },
      'max-pages': { type: 'string', default: '40' }, 'page-size': { type: 'string', default: '50' },
      'command-timeout-seconds': { type: 'string', default: '60' }, 'max-output-mb': { type: 'string', default: '64' },
    },
  }).values;
  const { since } = options;
  if (since !== undefined && !/^\d{13}$/.test(since)) throw new Error('--since takes a time in milliseconds since 1970 (13 digits).');
  // Runtime limits list requests to 50 entities; larger requested pages could hide server-side truncation.
  const pageSize = integerOption(options['page-size'], 'page-size', { max: 50 });
  const maxPages = integerOption(options['max-pages'], 'max-pages', { max: Math.floor(Number.MAX_SAFE_INTEGER / pageSize) });
  const commandOptions = commandOptionsFromArgs(options);
  const context = readAppContext(commandOptions);
  const expected = context.extensions.flatMap((e) => e.actions)
    .flatMap((a) => (a.secured ? [a.name, a.name.replace(/\/([^/]+)$/, '/__secured_$1')] : [a.name]));
  const deployed = new Map();
  for (const pkg of new Set(expected.map((name) => name.split('/')[0]))) {
    deployedActions(pkg, { maxPages, pageSize, ...commandOptions }).forEach((a, name) => deployed.set(name, a));
  }
  const missing = expected.filter((name) => !deployed.has(name));
  const updatedOf = (name) => {
    const updated = deployed.get(name)?.updated;
    return typeof updated === 'number' && Number.isFinite(updated) ? updated : null;
  };
  const present = expected.filter((name) => deployed.has(name));
  // Without an update time, freshness can't be judged: report that instead of treating the action as current.
  const unknownUpdate = since ? present.filter((name) => updatedOf(name) === null) : [];
  const stale = since ? present.filter((name) => updatedOf(name) !== null && updatedOf(name) < Number(since)) : [];
  const ok = missing.length === 0 && stale.length === 0 && unknownUpdate.length === 0;
  console.log(JSON.stringify({
    ok,
    workspace: context.workspace.name,
    uiOnly: expected.length === 0,
    expected,
    missing,
    ...(since ? { stale, unknownUpdate } : {}),
    ...(stale.length ? { freshnessWarning: 'These server timestamps precede the local --since time. Code may be stale, or the local and Runtime clocks may differ; freshness is unconfirmed.' } : {}),
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, verified: false, error: error.message }));
  process.exitCode = 1;
}
