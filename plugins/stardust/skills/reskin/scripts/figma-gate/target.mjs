// skills/reskin/scripts/figma-gate/target.mjs — what a Figma check measures: a Target is a URL, how its
// page is opened and how its sections are found (a JoinSource). Only the local regime exists: a reskin
// page that marks its sections with data-slot / data-module. The browser instruments come from the diff
// skill's measure-live.mjs, loaded when a page is opened (never at import, so --help needs none of them).
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
