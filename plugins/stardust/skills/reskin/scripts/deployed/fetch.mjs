// skills/reskin/scripts/deployed/fetch.mjs — what the deployed steps share to ask the preview for a page themselves (`preview`
// polls with fetchOnce, `inherited` reads the authored form with it, figma-gate's preview join finds the authored form by
// plainUrl). A library, no CLI.
//   plainUrl(url)                     the authored form of a preview page: <path>.plain.html, <folder>/index.plain.html for a
//        folder (a path ending in /), a .html extension and the query and fragment dropped.
//   fetchOnce(url, auth, timeoutMs)   { status: 200, body } when the page answers 200, { status, last: 'HTTP <n>' } for any
//        other answer, { status: 0, last: 'no response (<code>)' } when there is none. The Authorization header (the
//        value, or null) goes to `url` and to no other host: a redirect is never followed, it is a non-200 answer.
export function plainUrl(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  const path = u.pathname.replace(/\.html$/, '');
  u.pathname = `${path}${path.endsWith('/') ? 'index' : ''}.plain.html`;
  return u.href;
}

export async function fetchOnce(url, auth, timeoutMs) {
  try {
    const res = await fetch(url, { headers: auth ? { authorization: auth } : {}, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) {
      await res.body?.cancel();
      return { status: res.status, last: `HTTP ${res.status}` };
    }
    return { status: 200, body: await res.text() };
  } catch (e) {
    return { status: 0, last: `no response (${e.cause?.code || e.name})` };
  }
}
