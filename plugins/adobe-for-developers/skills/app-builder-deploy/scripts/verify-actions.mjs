// After a deploy: checks that every action of the app, including a secured action's two parts, exists in the
// linked workspace. With --since <epoch ms>, also flags actions not updated since then (stale code).
// Prints JSON; exits 1 when something is missing or stale, or when the check itself could not run.
// Usage: node verify-actions.mjs [--since <epoch ms>]
import { parseArgs } from 'node:util';
import { readAppContext } from './lib/app-config.mjs';
import { aio, parseJsonOutput } from './lib/run.mjs';

const PAGE = 50;
const MAX_PAGES = 40;

// Reads the package's whole action inventory, page by page; an incomplete read is an error, never a "missing".
function deployedActions(pkg) {
  const actions = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = aio(['rt', 'action', 'list', pkg, '--json', '-l', String(PAGE), '-s', String(page * PAGE)], { timeoutMs: 60_000 });
    if (!res.ok) throw new Error(`Could not list the actions of ${pkg}${res.timedOut ? ' (timed out)' : ''}.`);
    const batch = parseJsonOutput(res.stdout);
    if (!Array.isArray(batch)) throw new Error(`Unexpected output while listing the actions of ${pkg}.`);
    batch.forEach((a) => actions.set(`${pkg}/${a.name}`, a));
    if (batch.length < PAGE) return actions;
  }
  throw new Error(`${pkg} has more than ${PAGE * MAX_PAGES} actions; could not read them all.`);
}

try {
  const { since } = parseArgs({ options: { since: { type: 'string' } } }).values;
  if (since !== undefined && !/^\d{13}$/.test(since)) throw new Error('--since takes a time in milliseconds since 1970 (13 digits).');
  const context = readAppContext();
  const expected = context.extensions.flatMap((e) => e.actions)
    .flatMap((a) => (a.secured ? [a.name, a.name.replace(/\/([^/]+)$/, '/__secured_$1')] : [a.name]));
  const deployed = new Map();
  for (const pkg of new Set(expected.map((name) => name.split('/')[0]))) deployedActions(pkg).forEach((a, name) => deployed.set(name, a));
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
  }, null, 2));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, verified: false, error: error.message }));
  process.exitCode = 1;
}
