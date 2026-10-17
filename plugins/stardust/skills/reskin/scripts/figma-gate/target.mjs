// skills/reskin/scripts/figma-gate/target.mjs — what a Figma check measures: a Target is a URL, how its
// page is opened and how its sections are found (a JoinSource). Two regimes:
//   local    a reskin page that marks its sections with data-slot / data-module (a file or a URL).
//   preview  the deployed page of an EDS preview: opened and settled like any EDS page, its sections found
//            by joining the reskin page's data-slot sections to the preview's authored form (.plain.html).
// The browser instruments come from the diff skill's measure-live.mjs, loaded when a page is opened (never at
// import, so --help needs none of them); the preview's helpers load when a preview is opened or joined.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from '../figma/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts: the plugin tree (skills/reskin/scripts/figma-gate ↔ skills/diff/scripts) and the project
// copy (stardust/scripts/reskin/figma-gate ↔ stardust/scripts/diff).
const MEASURE_LIVE = ['../../../diff/scripts/measure-live.mjs', '../../diff/measure-live.mjs'];

export async function loadMeasureLive() {
  const path = MEASURE_LIVE.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
  if (!path) throw new UsageError('measure-live.mjs not found (looked in ../../../diff/scripts/ and ../../diff/): copy the diff skill\'s scripts beside the reskin scripts (stardust/scripts/diff/)');
  return import(pathToFileURL(path).href);
}

export async function loadChromium() {
  try { return (await import('playwright')).chromium; } catch {
    throw new UsageError('playwright is not importable from the reskin scripts: run npm i -D playwright pixelmatch pngjs --legacy-peer-deps in the project (reskin SKILL.md § Setup)');
  }
}

export const toUrl = (s) => (/^(https?|file):/i.test(s) ? s : pathToFileURL(resolve(s)).href);

const isLocal = (url) => {
  const u = new URL(url);
  return u.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname);
};

// Sections of a reskin page: main section[data-slot], in document order.
export const localAttributes = {
  name: 'data-slot',
  selector: (slot) => `main section[data-slot="${slot}"]`,
  collect: (page) => page.evaluate(() => [...document.querySelectorAll('main section[data-slot]')].map((el) => ({
    slot: el.getAttribute('data-slot'),
    module: el.getAttribute('data-module'),
    text: el.innerText,
    nested: !!el.parentElement?.closest('section[data-slot]'),
  }))),
};

export function localTarget(input) {
  const url = toUrl(input);
  return {
    url,
    regime: 'local',
    join: localAttributes,
    async open(browser, width) {
      const { openPage, settle, visit } = await loadMeasureLive();
      const { ctx, page } = await openPage(browser, { width, height: 900 });
      try {
        if (isLocal(url)) {
          await page.goto(url, { waitUntil: 'networkidle' });
          await settle(page, { passes: 2, quietMs: 300 });
        } else {
          await visit(page, url);
        }
        await page.evaluate(() => document.fonts.ready);
      } catch (e) {
        await ctx.close();
        if (e?.name === 'BotChallengeError') e.code = 3;
        throw e;
      }
      return page;
    },
  };
}

const REQUEST_MS = 10000;
const coded = (code, message) => Object.assign(new Error(message), { code });
const refused = (url, status, auth) => new UsageError(`${url} answered HTTP ${status}: ${auth ? 'the site token was not accepted' : 'the preview is protected: pass --auth-header or --token-env'}`);

// The authored form, with the site token when there is one. A redirect is a non-200 answer, so the header never
// follows one to another origin. A 401 or 403 is a usage error; no answer, or any other status, is no verdict (124).
async function fetchPlain(url, auth) {
  let res;
  try {
    res = await fetch(url, { headers: auth ? { authorization: auth } : {}, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_MS) });
  } catch (e) {
    throw coded(124, `${url} did not answer (${e.cause?.code || e.name})`);
  }
  if (res.status === 200) return res.text();
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) throw refused(url, res.status, auth);
  throw coded(124, `${url} answered HTTP ${res.status}: the authored form is not there; re-run once the page is previewed`);
}

// A deployed EDS page (--target preview). open() navigates it like any EDS page, with the site token sent to its
// origin only, and waits for the decoration: a block that never decorates throws code 124 "stalled decoration: …",
// a bot challenge code 3, a 401 or 403 a usage error. Its sections are not marked, so join.collect reads what the
// join needs: the authored form of the page, the text of each decorated `main > div` (the page is open) and the
// data-slot sections of the reskin page (a file or URL, opened in a second page of the same browser); join.match is
// plain-join.mjs's plainJoin over them. edsTimeoutMs, the settle bound, is on the target so the ramp's probe uses it too.
export function previewTarget(input, { reskin, auth = null, edsTimeoutMs = 20000 } = {}) {
  const url = toUrl(input);
  if (!/^https?:/i.test(url)) throw new UsageError(`--target preview needs the http(s) URL of the preview, got ${input}`);
  if (!reskin) throw new UsageError('--target preview needs --reskin <file>: the reskin page whose data-slot sections the preview is joined to');
  if (!/^(https?|file):/i.test(reskin) && !existsSync(resolve(reskin))) throw new UsageError(`--reskin ${reskin} not found`);
  const reskinPage = localTarget(reskin);
  return {
    url,
    regime: 'preview',
    edsTimeoutMs,
    join: {
      name: '.plain.html',
      async collect(page) {
        const { plainUrl } = await import('../deployed/fetch.mjs');
        const html = await fetchPlain(plainUrl(url), auth);
        const decorated = await page.evaluate(() => [...document.querySelectorAll('main > div')].map((el) => el.innerText));
        const local = await reskinPage.open(page.context().browser(), page.viewportSize()?.width ?? 1440);
        try { return { local: await localAttributes.collect(local), html, decorated }; } finally { await local.context().close(); }
      },
      async match({ dom, ...rest }) {
        const { plainJoin, plainSections } = await import('./plain-join.mjs');
        return plainJoin({ ...rest, local: dom.local, plain: plainSections(dom.html), decorated: dom.decorated });
      },
    },
    async open(browser, width) {
      const eds = await import('../deployed/eds.mjs');
      const { gotoLive, newLiveContext } = await eds.loadLiveSession();
      const ctx = await newLiveContext(browser, { locale: 'en-US', viewport: { width, height: 900 }, ...eds.authContextOptions(url, auth) });
      try {
        const page = await ctx.newPage();
        await gotoLive(page, url, { waitUntil: 'networkidle', settleMs: 0 });
        const { stalled } = await eds.edsSettle(page, { timeoutMs: edsTimeoutMs });
        if (stalled.length) throw coded(124, `stalled decoration: ${stalled.join(', ')}`);
        await page.evaluate(() => document.fonts.ready);
        return page;
      } catch (e) {
        await ctx.close();
        if (e?.name === 'BotChallengeError') e.code = 3;
        if (e?.name === 'LiveHTTPError' && (e.status === 401 || e.status === 403)) throw refused(url, e.status, auth);
        throw e;
      }
    },
  };
}
