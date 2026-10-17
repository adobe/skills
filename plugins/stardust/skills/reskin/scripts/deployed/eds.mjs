// skills/reskin/scripts/deployed/eds.mjs — what a gate needs to read an EDS preview (aem.page) rather than a
// local file: settle on the decoration, authenticate on the preview origin only, and keep the token out of
// every line the gate prints. A library, no CLI: the gates import it after their --help guard.
//   edsSettle(page, { timeoutMs })  wait for `body.appear` and every data-section-status / data-block-status
//                                   to read "loaded"; a stall is reported, never thrown
//   siteAuth, authContextOptions    the Authorization header value and the newLiveContext options that attach it
//                                   to ONE origin (live-session's resolveSiteAuth / attachOriginAuth)
//   redact(text, secret)            the text with the token replaced
//   isEdsHost(url)                  an aem.page / aem.live / hlx.page / hlx.live host, or the host of the
//                                   DEPLOY_VERIFY_ORIGIN test hook (read at call time)
// live-session.mjs comes from the diff skill and is loaded when first needed (loadLiveSession), never at import.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from '../figma/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts: the plugin tree (skills/reskin/scripts/deployed ↔ skills/diff/scripts) and the project copy
// (stardust/scripts/reskin/deployed ↔ stardust/scripts/diff).
const LIVE_SESSION = ['../../../diff/scripts/live-session.mjs', '../../diff/live-session.mjs'];
const EDS_HOST = /(^|\.)(aem|hlx)\.(page|live)$/i;
const POLL_MS = 50;

let liveSession = null;

// live-session.mjs, imported once. siteAuth answers synchronously, so it needs this to have run.
export async function loadLiveSession() {
  if (liveSession) return liveSession;
  const path = LIVE_SESSION.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
  if (!path) throw new UsageError('live-session.mjs not found (looked in ../../../diff/scripts/ and ../../diff/): copy the diff skill\'s scripts beside the reskin scripts (stardust/scripts/diff/)');
  liveSession = await import(pathToFileURL(path).href);
  return liveSession;
}

// The Authorization header value for the preview, from --auth-header or the --token-env variable (live-session
// reads both from process.argv as well), or null. Await loadLiveSession() once before the first call.
export function siteAuth({ authHeader, tokenEnv } = {}) {
  if (!liveSession) throw new Error('siteAuth: await loadLiveSession() first');
  return liveSession.resolveSiteAuth({ authHeader, tokenEnv });
}

// The newLiveContext options that send the header to the origin of `url` and to no other.
export function authContextOptions(url, header) {
  if (!header) return {};
  return { authOrigin: new URL(url).origin, authHeader: header };
}

// The text with the secret removed: the whole value and, for "token <t>" / "bearer <t>", the bare token too.
export function redact(text, secret) {
  const s = String(secret ?? '');
  const bare = s.replace(/^(token|bearer) /i, '');
  return [s, bare].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((out, v) => out.split(v).join('[redacted]'), String(text));
}

export function isEdsHost(url) {
  try {
    const u = new URL(url);
    if (EDS_HOST.test(u.hostname)) return true;
    return !!process.env.DEPLOY_VERIFY_ORIGIN && u.host === new URL(process.env.DEPLOY_VERIFY_ORIGIN).host;
  } catch { return false; }
}

// Both run in the page: what it says about its decoration now, and whether that is all "loaded".
const decoration = () => ({
  appear: !!document.body && document.body.classList.contains('appear'),
  sections: [...document.querySelectorAll('[data-section-status]')].map((el) => el.getAttribute('data-section-status')),
  blocks: [...document.querySelectorAll('[data-block-status]')].map((el, i) => ({
    name: el.getAttribute('data-block-name') || el.classList[0] || `#${i}`,
    status: el.getAttribute('data-block-status'),
  })),
});
const settled = () => !!document.body && document.body.classList.contains('appear')
  && [...document.querySelectorAll('[data-section-status]')].every((el) => el.getAttribute('data-section-status') === 'loaded')
  && [...document.querySelectorAll('[data-block-status]')].every((el) => el.getAttribute('data-block-status') === 'loaded');

// After navigating: networkidle, then body.appear, then every [data-section-status] and [data-block-status]
// "loaded", all within timeoutMs. A stall is returned, never thrown: `stalled` names "section <i>" (0-based
// among the sections) and "block <name>", or "body.appear" when it never came; a settled page has stalled [].
export async function edsSettle(page, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(deadline - Date.now(), 0);
  const stallOnly = (e) => { if (e?.name !== 'TimeoutError') throw e; };
  // The time left is read once per wait: Playwright takes a timeout of 0 as no timeout at all.
  const idleMs = remaining();
  if (idleMs > 0) await page.waitForLoadState('networkidle', { timeout: idleMs }).catch(stallOnly);
  const settleMs = remaining();
  if (settleMs > 0) await page.waitForFunction(settled, null, { timeout: settleMs, polling: POLL_MS }).catch(stallOnly);
  const d = await page.evaluate(decoration);
  const loaded = (s) => s === 'loaded';
  return {
    appear: d.appear,
    sections: { total: d.sections.length, loaded: d.sections.filter(loaded).length },
    blocks: { total: d.blocks.length, loaded: d.blocks.filter((b) => loaded(b.status)).length },
    stalled: [
      ...(d.appear ? [] : ['body.appear']),
      ...d.sections.flatMap((s, i) => (loaded(s) ? [] : [`section ${i}`])),
      ...d.blocks.filter((b) => !loaded(b.status)).map((b) => `block ${b.name}`),
    ],
  };
}
