import { CliError } from '#src/errors.mjs';
import { loadBundle } from '#src/bundles/index.mjs';
import { runPageCommand } from '#src/page/run.mjs';
import { buildBundle, buildHideExpression, loadPatterns } from '#src/page/overlay-db.mjs';

const MODES = ['quick', 'thorough'];

export const RESIDUAL_EXPRESSION =
  `JSON.stringify([...document.querySelectorAll('*')].filter(el => { var s = ` +
  `getComputedStyle(el); var r = el.getBoundingClientRect(); if (s.position !== ` +
  `'fixed' || s.display === 'none' || s.visibility === 'hidden') return false; ` +
  `var vw = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0); var vh = ` +
  `Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0); if (vw <= 0 || vh ` +
  `<= 0) return false; var covers = vw * vh >= 0.5 * window.innerWidth * ` +
  `window.innerHeight; return covers || (parseInt(s.zIndex, 10) > 1000 && ` +
  `(el.offsetWidth > 100 || el.offsetHeight > 100)); }).map(el => { var s = ` +
  `getComputedStyle(el); return { tag: el.tagName, id: el.id, cls: (el.getAttribute(` +
  `'class') || '').slice(0, 50), role: el.getAttribute('role') || (/^(HEADER|NAV)$/.test(` +
  `el.tagName) ? 'landmark' : null), z: s.zIndex, w: el.offsetWidth, h: ` +
  `el.offsetHeight }; }))`;

const parseMaybe = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

/**
 * Detect overlays on the current page.
 * @param {object} driver
 * @param {string} session
 * @param {object} patterns overlay pattern database
 * @returns {object} `{ overlays, scroll_locked, scroll_fix? }`
 */
export function detectOverlays(driver, session, patterns) {
  const source = buildBundle(patterns, loadBundle('overlay-detect.js'));
  const code = `async page => page.evaluate(${JSON.stringify(source)})`;
  return parseMaybe(driver.run(session, { code }));
}

function stepCode(step) {
  if (step.action === 'click') {
    const sel = JSON.stringify(step.selector);
    return (
      `{ const l = page.locator(${sel}).first(); ` +
      `if ((await l.count()) === 0) { skipped++; } ` +
      `else { await l.click({ timeout: 2000 }); clicked++; } }`
    );
  }
  return `await page.waitForTimeout(${Number(step.ms)});`;
}

function dismissCode(steps) {
  const body = steps.map(stepCode).join('\n');
  return `async page => {\nlet clicked = 0, skipped = 0;\n${body}\nreturn { clicked, skipped };\n}`;
}

function runDismissSteps(driver, session, overlay) {
  const base = { id: overlay.id, strategy: 'dismiss' };
  try {
    const result = parseMaybe(driver.run(session, { code: dismissCode(overlay.dismiss) }));
    if (result?.clicked > 0) return { ...base, ok: true };
    return { ...base, ok: false, error: 'no dismiss selector matched' };
  } catch (err) {
    return { ...base, ok: false, error: err.message };
  }
}

const isTrue = (value) => value === true || value === 'true';

function isHidden(driver, session, selector) {
  const sel = JSON.stringify(selector);
  const expr =
    `(() => { const el = document.querySelector(${sel}); if (!el) return true; ` +
    `return getComputedStyle(el).display === 'none' || ` +
    `el.getBoundingClientRect().height === 0; })()`;
  return isTrue(driver.evaluate(session, expr));
}

function hideOverlays(driver, session, report, overlays) {
  const ids = overlays.map((o) => o.id);
  driver.evaluate(session, buildHideExpression(report, ids));
  return overlays.map((o) => {
    const base = { id: o.id, strategy: 'hide' };
    if (isHidden(driver, session, o.selector)) return { ...base, ok: true };
    return { ...base, ok: false, error: 'still visible after hide' };
  });
}

function scrollUnlocked(driver, session) {
  return isTrue(driver.evaluate(session, `getComputedStyle(document.body).overflow !== 'hidden'`));
}

function dismissThorough(driver, session, report) {
  const hasSteps = (o) => o.dismiss?.length > 0;
  const dismissed = report.overlays
    .filter(hasSteps)
    .map((o) => runDismissSteps(driver, session, o));
  const failed = new Set(dismissed.filter((d) => !d.ok).map((d) => d.id));
  const toHide = report.overlays.filter((o) => !hasSteps(o) || failed.has(o.id));
  return [...dismissed, ...hideOverlays(driver, session, report, toHide)];
}

/**
 * Dismiss or hide the detected overlays, then fix scroll lock.
 * @param {object} driver
 * @param {string} session
 * @param {object} report detection report
 * @param {{ mode: 'quick'|'thorough' }} spec
 * @returns {Array<{ id: string, strategy: string, ok: boolean, error?: string }>}
 */
export function dismissOverlays(driver, session, report, { mode }) {
  if (mode === 'quick') {
    return hideOverlays(driver, session, report, report.overlays);
  }
  return dismissThorough(driver, session, report);
}

function residualBlockers(driver, session) {
  const code = `async page => page.evaluate(${JSON.stringify(RESIDUAL_EXPRESSION)})`;
  return parseMaybe(driver.run(session, { code }));
}

const HELP = `
Example:
  web page overlays --session "$S" --dismiss --mode thorough
Output:
  { overlays: [{ id, type, selector, ... }], scrollLocked, scrollFix, url, session, durationMs }
  with --dismiss also: applied: [{ id, strategy, ok, error? }], scrollUnlocked, residual: [{ tag, id, role, ... }]
Notes:
  --dismiss quick hides every overlay with CSS. thorough (default) clicks the CMP's dismiss steps
  and hides overlays that have none or whose dismiss failed; scroll lock is fixed in both.
  residual[] lists visible fixed elements still covering the viewport (or z-index > 1000): check it is empty.
  Site headers/navs may appear with role set; filter them rather than hiding every entry.
`;

/**
 * Register `page overlays [url]`.
 * @param {import('commander').Command} group
 * @param {object} deps
 */
export function registerOverlays(group, deps) {
  group
    .command('overlays [url]')
    .description('detect cookie banners and modals; optionally dismiss them')
    .addHelpText('after', HELP)
    .option('--dismiss', 'dismiss or hide the detected overlays')
    .option('--mode <mode>', `dismissal mode: ${MODES.join(', ')}`, 'thorough')
    .option('--refresh-db', 'refresh the overlay pattern database first')
    .action((url, opts, command) => {
      if (!MODES.includes(opts.mode)) {
        throw new CliError('USAGE', `unknown mode ${opts.mode}`, {
          hint: `one of: ${MODES.join(', ')}`,
        });
      }
      return runPageCommand(command, deps, {
        url,
        fn: async (driver, session) => {
          const patterns = await loadPatterns({
            refresh: opts.refreshDb,
            fetch: deps.fetch,
            cacheDir: deps.cacheDir,
            stderr: deps.stderr,
          });
          const report = detectOverlays(driver, session, patterns);
          const result = {
            overlays: report.overlays,
            scrollLocked: report.scroll_locked,
            scrollFix: report.scroll_fix ?? null,
          };
          if (!opts.dismiss) return result;
          result.applied = dismissOverlays(driver, session, report, { mode: opts.mode });
          if (report.scroll_locked) result.scrollUnlocked = scrollUnlocked(driver, session);
          result.residual = residualBlockers(driver, session);
          return result;
        },
      });
    });
}
