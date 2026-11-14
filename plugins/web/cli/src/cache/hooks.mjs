// run-code snippets for a session cache. They run inside playwright-cli, where there is no fs,
// fetch, Buffer or process: state lives on the browser context, disk access goes through the
// keeper (src/cache/keeper.mjs) via context.request. Any keeper failure falls back to the
// network so the page never breaks; failures are counted in context.__webCache.errors.

const HOOKS = `async page => {
  const context = page.context();
  if (context.__webCache) return 'already';
  const state = { errors: 0, pending: new Set() };
  context.__webCache = state;
  const served = new WeakSet();
  // Each top-level navigation is its own recording (one page HAR). A request belongs to the
  // recording current when it was routed, so a late response never lands in the next page.
  const currentRecording = new WeakMap();
  const recordingOf = new WeakMap();
  let lastRecording = 0;
  const pageOf = (request) => {
    try {
      return request.frame().page();
    } catch {
      return null;
    }
  };
  const chainStart = (request) => {
    let first = request;
    try {
      while (first.redirectedFrom()) first = first.redirectedFrom();
    } catch {
      // Keep the furthest request reached.
    }
    return first;
  };
  // Redirect hops are never routed: they take the recording of the request that started them.
  const recordingFor = (request) => {
    const page = pageOf(request);
    return (
      recordingOf.get(request) ??
      recordingOf.get(chainStart(request)) ??
      (page && currentRecording.get(page)) ??
      0
    );
  };
  const startRecording = (request) => {
    lastRecording += 1;
    const page = pageOf(request);
    if (page) currentRecording.set(page, lastRecording);
    recordingOf.set(request, lastRecording);
  };
  const isMainNavigation = (request) => {
    try {
      return request.isNavigationRequest() && !request.frame().parentFrame();
    } catch {
      return false;
    }
  };
  const startOf = (request) => {
    try {
      const { startTime } = request.timing();
      return startTime > 0 ? startTime : undefined;
    } catch {
      return undefined;
    }
  };
  const fail = () => {
    state.errors += 1;
  };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== 'GET' || !/^https?:/.test(url)) return route.fallback();
    let response;
    let fulfilled = false;
    try {
      const nav = isMainNavigation(request);
      const redirect = Boolean(request.redirectedFrom());
      if (nav && !redirect) startRecording(request);
      else recordingOf.set(request, recordingFor(request));
      const data = { url, page: recordingOf.get(request), nav, redirect };
      const options = { data, timeout: LOOKUP_TIMEOUT_MS, maxRedirects: 0 };
      response = await context.request.post(KEEPER + '/lookup', options);
      if (response.headers()['x-web-cache'] === 'hit') {
        served.add(request);
        await route.fulfill({ response });
        fulfilled = true;
      }
    } catch {
      served.delete(request);
      fail();
    } finally {
      // Playwright keeps every APIResponse body until disposed.
      if (response) await response.dispose().catch(fail);
    }
    if (!fulfilled) await route.fallback().catch(fail);
  });
  const store = async (response) => {
    const request = response.request();
    if (served.has(request) || request.method() !== 'GET') return;
    // An event stream's body only ends when the stream closes: never wait for it.
    if ((response.headers()['content-type'] ?? '').includes('text/event-stream')) return;
    const status = response.status();
    let body;
    try {
      body = await response.body();
    } catch {
      if (status < 300 || status > 399) return;
    }
    try {
      const data = {
        startedAt: startOf(request),
        page: recordingFor(request),
        method: 'GET',
        url: request.url(),
        status,
        statusText: response.statusText(),
        requestHeaders: await request.headersArray(),
        headers: await response.headersArray(),
        mimeType: response.headers()['content-type'] ?? '',
        body: body ? body.toString('base64') : '',
      };
      const ack = await context.request.post(KEEPER + '/store', { data, timeout: STORE_TIMEOUT_MS });
      await ack.dispose();
    } catch {
      fail();
    }
  };
  context.on('response', (response) => {
    const pending = store(response);
    state.pending.add(pending);
    return pending.finally(() => state.pending.delete(pending));
  });
  return 'installed';
}`;

/**
 * The run-code snippet that turns a session into a cache session served by the keeper on
 * `port`. Installs once per browser context: returns 'installed' or 'already'.
 * @param {number} port
 * @returns {string}
 */
export function cacheHooksCode(port) {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid keeper port: ${port}`);
  return HOOKS.replaceAll('KEEPER', JSON.stringify(`http://127.0.0.1:${port}`))
    .replace('LOOKUP_TIMEOUT_MS', '1000')
    .replace('STORE_TIMEOUT_MS', '10000');
}

/**
 * run-code snippet that waits up to 5 s for in-flight stores, then returns the number of hook
 * failures in the session, stores still unfinished included (0 if no hooks). The deadline uses
 * page.waitForTimeout: run-code has no setTimeout.
 */
export const CACHE_STATS_CODE = `async page => {
  const state = page.context().__webCache;
  if (!state) return 0;
  const flushed = Promise.allSettled([...state.pending]).then(() => true);
  const deadline = page.waitForTimeout(5000).then(() => false, () => false);
  const done = await Promise.race([flushed, deadline]);
  return state.errors + (done ? 0 : state.pending.size);
}`;
