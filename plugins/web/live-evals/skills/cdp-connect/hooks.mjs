const base = 'http://localhost:9222';

/** Gives every run a clean browser: closes all tabs, then opens the case's tabs (default: one blank tab). */
export async function extensionHook(hookName, context) {
  if (hookName !== 'beforeEach') return;
  const old = (await (await fetch(`${base}/json/list`)).json()).filter((t) => t.type === 'page');
  for (const url of (context.test.vars.tabs ?? 'about:blank').split(' ')) {
    await fetch(`${base}/json/new?${url}`, { method: 'PUT' });
  }
  await Promise.all(old.map((t) => fetch(`${base}/json/close/${t.id}`)));
}
