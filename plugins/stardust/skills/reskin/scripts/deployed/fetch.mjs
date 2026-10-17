// skills/reskin/scripts/deployed/fetch.mjs — the one request the deployed steps make to the preview themselves (`preview`
// polls with it, `inherited` reads the authored form with it). A library, no CLI.
//   fetchOnce(url, auth, timeoutMs)   { status: 200, body } when the page answers 200, { status, last: 'HTTP <n>' } for any
//        other answer, { status: 0, last: 'no response (<code>)' } when there is none. The Authorization header (the
//        value, or null) goes to `url` and to no other host: a redirect is never followed, it is a non-200 answer.
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
