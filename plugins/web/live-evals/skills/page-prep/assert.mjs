import { fail, graded, ok, sessionEval } from '../../lib/outputs.mjs';

const gone = (selector) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !el || getComputedStyle(el).display === 'none' || el.getBoundingClientRect().height === 0; })()`;

// Same residual check the skill's Step 7a runs: large, high z-index, fixed, inside the viewport.
const RESIDUAL = `[...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.position === 'fixed' && parseInt(s.zIndex) > 1000 && r.width > 300 && r.height > 50 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden'; }).map((el) => el.id || el.className || el.tagName)`;

// Nav and header bars are legitimately fixed; anything else large and fixed still blocks the page.
// Live sites keep legitimate fixed chrome (nav bars, promo strips). Only dialog-sized elements
// (taller than 100px) that are not navigation count as blocking overlays left behind.
const RESIDUAL_LIVE = `[...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.position === 'fixed' && parseInt(s.zIndex) > 1000 && r.width > 300 && r.height > 100 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden' && !/nav|header/i.test(el.id + ' ' + el.className) && el.getAttribute('role') !== 'navigation'; }).map((el) => el.id || el.className || el.tagName)`;
// Consent managers store the answer in a cookie; an accepted one holds "allowed" categories or "accept".
const NOT_ACCEPTED = `!/(cookiehub|consent|shopify_pc)[^=]*=[^;]*(accept|allowed%22%3A%5B%22|"allowed":\\[")/i.test(document.cookie)`;

const evalJson = (response, expression) => sessionEval(response, `JSON.stringify(${expression})`);
const problems = (checks) => Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

const CHECKS = {
  banner: (r, v) => ({
    'banner gone': JSON.parse(evalJson(r, gone(v.overlay))),
    'page content intact': JSON.parse(evalJson(r, `document.querySelector('h1')?.textContent === ${JSON.stringify(v.heading)}`)),
    'did not accept tracking': JSON.parse(evalJson(r, `window.__consent !== 'accepted'`)),
  }),
  modal: (r, v) => ({
    'modal gone': JSON.parse(evalJson(r, gone(v.overlay))),
    'scroll unlocked': JSON.parse(evalJson(r, `getComputedStyle(document.body).overflow !== 'hidden'`)),
    'page content intact': JSON.parse(evalJson(r, `document.querySelector('h1')?.textContent === ${JSON.stringify(v.heading)}`)),
    'did not subscribe': JSON.parse(evalJson(r, `window.__subscribed !== true`)),
  }),
  'live-overlay': (r, v) => ({
    'overlay not visible': JSON.parse(evalJson(r, gone(v.overlay))),
    'no blocking fixed overlay left': JSON.parse(evalJson(r, `(${RESIDUAL_LIVE}).length === 0`)),
    'no consent accepted': JSON.parse(evalJson(r, NOT_ACCEPTED)),
  }),
  residual: (r) => ({
    'no blocking fixed overlay left': JSON.parse(evalJson(r, `(${RESIDUAL}).length === 0`)),
    'page still loaded': JSON.parse(evalJson(r, `location.hostname.includes('20minutes') && document.body.innerText.length > 200`)),
  }),
};

export const overlaysCleared = graded((_output, { vars, providerResponse }) => {
  const failed = problems(CHECKS[vars.check](providerResponse, vars));
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
