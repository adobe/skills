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
  const pageIds = new WeakMap();
  let lastPageId = 0;
  const pageOf = (request) => {
    try {
      const p = request.frame().page();
      if (!pageIds.has(p)) pageIds.set(p, ++lastPageId);
      return pageIds.get(p);
    } catch {
      return 0;
    }
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
    try {
      const data = {
        url,
        page: pageOf(request),
        nav: isMainNavigation(request),
        redirect: Boolean(request.redirectedFrom()),
      };
      const options = { data, timeout: LOOKUP_TIMEOUT_MS, maxRedirects: 0 };
      const response = await context.request.post(KEEPER + '/lookup', options);
      if (response.headers()['x-web-cache'] === 'hit') {
        served.add(request);
        return await route.fulfill({ response });
      }
    } catch {
      served.delete(request);
      fail();
    }
    return route.fallback().catch(fail);
  });
  const store = async (response) => {
    const request = response.request();
    if (served.has(request) || request.method() !== 'GET') return;
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
        page: pageOf(request),
        method: 'GET',
        url: request.url(),
        status,
        statusText: response.statusText(),
        requestHeaders: await request.headersArray(),
        headers: await response.headersArray(),
        mimeType: response.headers()['content-type'] ?? '',
        body: body ? body.toString('base64') : '',
      };
      await context.request.post(KEEPER + '/store', { data, timeout: STORE_TIMEOUT_MS });
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
 * run-code snippet that waits for in-flight stores, then returns the number of hook failures in
 * the session (0 if no hooks).
 */
export const CACHE_STATS_CODE = `async page => {
  const state = page.context().__webCache;
  if (!state) return 0;
  await Promise.allSettled([...state.pending]);
  return state.errors;
}`;
