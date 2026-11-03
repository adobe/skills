/**
 * The `header` group: capture a site's header as data, and compare a page you build with it
 * (`web doc header`). Each check is a module of src/header/; this file gives them the CLI's
 * contract: one JSON document on stdout (`--format text`: the check's lines), errors as error
 * documents, and these exit codes: 0 the check ran, clean or not (read `clean`); 1 CHECK_FAILED, it
 * did not run to its end (a page did not load, a size could not be compared, a browser call failed)
 * and nothing is certified; 2 a usage error (a bad option, a map naming no region of the capture),
 * playwright-cli or the image libraries missing.
 * Every browser a command opens gets a generated session name and is closed when the command ends,
 * however it ends (a signal included).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDriver } from '#src/driver/playwright-cli.mjs';
import { CliError } from '#src/errors.mjs';
import { emit } from '#src/output.mjs';
import { useBrowser, webBrowser } from '#src/header/browser.mjs';
import { captureHeader } from '#src/header/capture.mjs';
import { clsAt } from '#src/header/cls-at.mjs';
import { loadImaging } from '#src/header/imaging.mjs';
import { checkMenus } from '#src/header/menus.mjs';
import { checkPanels } from '#src/header/panels.mjs';
import { comparePage } from '#src/header/pixels.mjs';
import { checkText, parseSizes } from '#src/header/text.mjs';

/** The CLS a page may have (the threshold of `header check cls`). */
export const MAX_CLS = 0.05;

/** The code of a check that did not run to its end: exit 1, with an error document. */
export const CHECK_FAILED = 'CHECK_FAILED';

const usage = (message) =>
  new CliError('USAGE', message, { hint: 'run: web header check <check> --help' });

/**
 * A failure inside a check, as one error with one exit code (1): the driver's own codes would
 * give 2 for a page that does not load (PLAYWRIGHT_CLI) and 1 for anything else. Usage errors and
 * failures already said as such are kept.
 */
export function asCheckFailure(e) {
  if (e instanceof CliError && ['USAGE', 'UNSUPPORTED', CHECK_FAILED].includes(e.code)) return e;
  const code = typeof e?.code === 'string' ? `${e.code}: ` : '';
  return new CliError(CHECK_FAILED, `${code}${e?.message ?? String(e)}`, {
    hint: 'the check did not run to its end, so nothing was measured: fix the cause (the page, the browser) and re-run the same command',
  });
}

// option values checked before any browser starts (a pool of 0 workers measured nothing and read as clean)
const positiveInt = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw usage(`expected a positive integer, got "${v}"`);
  return n;
};
const positiveNumber = (v) => {
  if (!(Number(v) > 0)) throw usage(`expected a positive number, got "${v}"`);
  return v;
};
const nonNegativeNumber = (v) => {
  if (!(Number(v) >= 0) || v.trim() === '') throw usage(`expected a number >= 0, got "${v}"`);
  return Number(v);
};
const numberList = (v) => {
  if (!v.split(',').every((x) => x.trim() !== '' && Number.isFinite(Number(x))))
    throw usage(`expected numbers separated by commas, got "${v}"`);
  return v;
};
const sizeList = (v) => {
  try {
    parseSizes(v);
  } catch (e) {
    throw usage(e.message);
  }
  return v;
};

/**
 * Runs `fn(opts)` with the checks on the CLI's driver and prints its document. The driver's scratch
 * files go to a temp folder: the commands write their artifacts where their arguments say, and
 * nothing lands in the caller's cwd. `images`: load the image libraries first (exit 2 if missing).
 */
async function run(command, deps, fn, { images = false } = {}) {
  const opts = command.optsWithGlobals();
  if (images) await (deps.loadImaging ?? loadImaging)();
  const scratch = mkdtempSync(join(tmpdir(), 'web-header-'));
  const driver = (deps.driverFactory ?? createDriver)({ outputDir: scratch });
  driver.ensureAvailable?.();
  const browser = webBrowser(driver);
  useBrowser(browser);
  // a signal ends the process: its browsers are closed first, then the signal goes on
  const signals = ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => {
      browser.closeAll();
      rmSync(scratch, { recursive: true, force: true });
      process.kill(process.pid, signal);
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  try {
    let doc;
    try {
      doc = await fn(opts);
    } catch (e) {
      throw asCheckFailure(e);
    }
    emit(doc, { format: opts.format, text: doc.text, stdout: deps.stdout ?? process.stdout });
  } finally {
    signals.forEach(([signal, handler]) => process.removeListener(signal, handler));
    browser.closeAll();
    useBrowser(null);
    rmSync(scratch, { recursive: true, force: true });
  }
}

const collect = (value, list) => [...list, value];

const GROUP_HELP = `
Use to rebuild a site's header 1:1: capture the source once (header capture), then run the checks
on the page you build until every one is clean. web doc header has the loop and how to read each
check. The checks need sharp, pngjs and pixelmatch (optional dependencies): install the CLI as a
package (web doc header, Install).
`;

const EXIT_HELP = `
Exit codes:
  0 the check ran, clean or not (read clean, or the lines) · 1 CHECK_FAILED: it did not run to its
  end, nothing is certified (an error document) · 2 usage, playwright-cli or the image libraries
  (sharp, pngjs, pixelmatch: optional dependencies, see web doc header) missing`;

const HELP = {
  capture: `
Output:
  { dir, page: { url, title, regions: [{ id, selector, rect, tabletRect, mobileRect }] },
    open, text }: open is <dir>/open/open.json:
  { closedLinks, closedOverlays, states: [{ label, trigger, file, links, newLinks,
    panel: { rect, background, shadow, padding, radius, border, links, items: [{ text, href }], text },
    visibleOverlays }], header: { scroll, breakpoint: { shownAt, hiddenAt } },
    mobileMenu: { toggle, revealed, lateOverlays, item } }
Notes:
  At 1440x900, 820x1180 and 390x844 the source is loaded held still (A/B services blocked,
  overlays hidden, lazy content loaded, animations finished) and shot (<dir>/<vp>.png); the header
  (--header, else the first header element at the top of the page with the bands stacked above
  it, such as a promo bar) is one region per selector, top first (header, header-2, ...), with its
  box per viewport (page.json; crops and style dumps in regions/). Then each menu is opened as
  the source opens it (hover, else click; its visible label only; a fresh load per menu) and shot
  at 1440x900; then the scroll probe, the breakpoint, and the burger at 390x844
  (open/mobile-menu.png).
  The hide rules are in <dir>/overlays.json (hideCss): pass it to the text check (--hide-css).`,
  menus: `
Output:
  { clean, menus: [{ label, trigger, expected, opened, left, ok, problems }], text }
Notes:
  At 1440x900 each menu of open.json (newLinks > 0) is opened as the source opens it, its links
  counted (at least 80 % of the capture's), and closed as the source closes it.`,
  panels: `
Output:
  { clean, panels: [{ label, trigger, mismatch, links, expected, missing, extra, problems }],
    mobile: { mismatch, problems } | null, outDir, text }
Notes:
  The pixel mismatch inside each source panel box (<= 1.5 %), the revealed hrefs against the
  capture's (as multisets), the mobile menu against open/mobile-menu.png (<= 2.0 %).
  <outDir> is cleared first; panels.json and the shots are written there.`,
  pixels: `
Output:
  { clean, compared, missing, notShown, viewport, regions: { <key>: { srcH, edsH, mismatch, ... } },
    full, cls, overflow, text }
Notes:
  compare.mjs on one width (desktop 1440x900, --tablet 820x1180, --mobile 390x844): the regions of
  --map (region ids of the capture -> selectors on the page), the full page, CLS while loading.
  A map key naming no region of the capture is a usage error. missing: keys whose selector matched
  nothing on the page (not clean); notShown: keys the source does not show at this width (not
  compared). clean: at least one region compared, none missing, every compared one with height
  delta 0 and mismatch 0 % (the ladder's step 2); nothing to compare at this width is CHECK_FAILED.`,
  cls: `
Output:
  { clean, cls: { <width>: value }, max, text }
Notes:
  The layout shift of a load at each width (4 s after load, the page held still); clean: every
  value under --max (the bar's 0.05).`,
  text: `
Output:
  { clean, notCleanAt, sizes: [{ tag, matched, rows, onlySource, onlyPage, px, ... }], text }
Notes:
  Every visible text of the source's header and the page's (with --open or --mobile-menu, of the
  viewport), matched by text: computed properties and boxes; icons by position; where the page
  below the header starts; --scale 2 --shots also counts differing pixels. Sizes WIDTH or
  WIDTHxHEIGHT (900 tall by default), a fresh load each, --parallel at a time.
  A size that could not be compared fails the command (CHECK_FAILED); its message names those
  sizes and holds the other sizes' lines.`,
};

/**
 * The map's keys against the capture's regions (page.json, and slices.json when there is one):
 * a key naming no region is a usage error, before any browser starts.
 */
export function checkMap(mapFile, sourceDir) {
  let map;
  try {
    map = JSON.parse(readFileSync(mapFile, 'utf8'));
  } catch (e) {
    throw usage(`--map ${mapFile}: ${e.message}`);
  }
  if (!existsSync(join(sourceDir, 'page.json')))
    throw usage(`${sourceDir} is not a capture: no page.json`);
  const page = JSON.parse(readFileSync(join(sourceDir, 'page.json'), 'utf8'));
  const slicesFile = join(sourceDir, 'slices.json');
  const slices = existsSync(slicesFile) ? JSON.parse(readFileSync(slicesFile, 'utf8')) : [];
  const ids = new Set([...page.regions, ...slices].map((r) => r.id));
  const bad = Object.keys(map).filter((k) => k.split('+').some((id) => !ids.has(id)));
  if (!Object.keys(map).length) throw usage(`--map ${mapFile}: no region`);
  if (bad.length)
    throw usage(
      `--map ${mapFile}: no region ${bad.join(', ')} in ${sourceDir}/page.json (its regions: ${[...ids].join(', ')})`,
    );
  return map;
}

/**
 * `header check pixels`' verdict on compare.mjs's report: { clean, compared }. Clean only when a
 * region was compared and every requested one is accounted for: none missing on the page, none
 * unknown to the capture, every compared one with dH 0 and mismatch 0 %. Nothing to compare at
 * this width (every requested region not shown by the source there) is a failed check, not clean.
 */
export function pixelsVerdict({ regions, missing = [], unknown = [], notShown = [], viewport }) {
  const compared = Object.keys(regions);
  if (!compared.length && !missing.length && !unknown.length) {
    throw new CliError(
      CHECK_FAILED,
      `nothing compared at ${viewport}: the source shows none of the requested regions at this width (${notShown.join(', ') || 'none requested'})`,
    );
  }
  const clean =
    compared.length > 0 &&
    !missing.length &&
    !unknown.length &&
    compared.every((k) => regions[k].edsH === regions[k].srcH && regions[k].mismatch === 0);
  return { clean, compared };
}

/**
 * Register the `header` group.
 * @param {import('commander').Command} program
 * @param {object} deps
 */
export function registerHeader(program, deps) {
  const header = program
    .command('header')
    .description('capture a site header and compare a page with it')
    .addHelpText('after', GROUP_HELP);
  header
    .command('capture <url> <dir>')
    .description('capture the header: its region, open menus, breakpoint, scroll and mobile menu')
    .addHelpText('after', HELP.capture + EXIT_HELP)
    .option(
      '--header <selector>',
      "a part of the source's header (repeat for several)",
      collect,
      [],
    )
    .action((url, dir, o, command) =>
      run(
        command,
        deps,
        async () => {
          const { page, open, lines } = await captureHeader(url, dir, { header: o.header });
          return { dir: resolve(dir), page, open, text: lines.join('\n') };
        },
        { images: true },
      ),
    );

  const check = header.command('check').description('compare a page with the captured source');
  check
    .command('menus <page> <openJson>')
    .description('the menus open and close as on the source')
    .addHelpText('after', HELP.menus + EXIT_HELP)
    .action((page, openJson, _o, command) =>
      run(command, deps, () => {
        const { ok, menus, lines } = checkMenus(page, openJson);
        return { clean: ok, menus, text: lines.join('\n') };
      }),
    );
  check
    .command('panels <page> <sourceDir> <outDir>')
    .description("each open panel's pixels and hrefs, and the mobile menu")
    .addHelpText('after', HELP.panels + EXIT_HELP)
    .action((page, sourceDir, outDir, _o, command) =>
      run(
        command,
        deps,
        () => {
          const { ok, panels, mobile, lines } = checkPanels(page, sourceDir, outDir);
          return { clean: ok, panels, mobile, outDir: resolve(outDir), text: lines.join('\n') };
        },
        { images: true },
      ),
    );
  check
    .command('pixels <page> <sourceDir> <outDir>')
    .description('the header region (and the full page) against the source, at one width')
    .addHelpText('after', HELP.pixels + EXIT_HELP)
    .requiredOption('--map <file>', 'region ids of the capture -> selectors on the page (JSON)')
    .option('--only <ids>', 'only these region ids')
    .option('--tablet', 'at 820x1180')
    .option('--mobile', 'at 390x844')
    .option('--no-full', 'skip the full-page comparison')
    .option('--static', 'a plain HTML page: do not wait for EDS decoration')
    .action((page, sourceDir, outDir, o, command) =>
      run(
        command,
        deps,
        async () => {
          checkMap(o.map, sourceDir);
          const { report, lines } = await comparePage(page, sourceDir, outDir, {
            map: o.map,
            only: o.only,
            tablet: o.tablet,
            mobile: o.mobile,
            'no-full': o.full === false,
            static: o.static,
          });
          return { ...pixelsVerdict(report), ...report, text: lines.join('\n') };
        },
        { images: true },
      ),
    );
  check
    .command('cls <page> <widths>')
    .description('the layout shift of a load at each width')
    .addHelpText('after', HELP.cls + EXIT_HELP)
    .option('--max <n>', 'the threshold', nonNegativeNumber, MAX_CLS)
    .action((page, widths, o, command) =>
      run(command, deps, () => {
        const asked = [...new Set(widths.split(','))];
        if (!asked.every((w) => positiveInt(w))) throw usage(`expected widths, got "${widths}"`);
        // the lines in the order asked (an object lists integer keys in ascending order)
        const rows = asked.map((w) => {
          const v = clsAt(page, +w);
          if (!Number.isFinite(v)) throw new CliError(CHECK_FAILED, `CLS at ${w}: no value (${v})`);
          return [w, v];
        });
        return {
          clean: rows.every(([, v]) => v < o.max),
          cls: Object.fromEntries(rows),
          max: o.max,
          text: rows.map(([w, v]) => `${v < o.max ? 'OK  ' : 'FAIL'} CLS at ${w}: ${v}`).join('\n'),
        };
      }),
    );
  check
    .command('text <source> <page>')
    .description('texts, glyph properties, positions and icons against the source')
    .addHelpText('after', HELP.text + EXIT_HELP)
    .option('--sizes <list>', 'WIDTH or WIDTHxHEIGHT, comma-separated', sizeList, '1440x900')
    .option('--open <label>', 'a menu opened as the source opens it')
    .option('--trigger <how>', 'hover or click (with --open)', 'hover')
    .option('--mobile-menu', 'the burger opened')
    .option('--scroll <ys>', 'wheel to each y in turn and compare there (600,500,0)', numberList)
    .option('--scale <n>', 'device scale factor', positiveNumber, '1')
    .option('--shots <prefix>', 'write both viewports and count differing pixels')
    .option('--hide-css <overlays.json>', "the capture's overlay hide rules")
    .option('--source-cache <dir>', "reuse the source's states from <dir>")
    .option(
      '--baseline <url>',
      'the page before the work: what it already differs by is not counted',
    )
    .option('--band <band>', 'auto, or the header band in px', 'auto')
    .option(
      '--tolerance <px>',
      'positions within this are equal',
      (v) => String(nonNegativeNumber(v)),
      '0.05',
    )
    .option('--parallel <n>', 'sizes at a time', positiveInt, 4)
    .action((source, page, o, command) =>
      run(
        command,
        deps,
        async () => {
          const { ok, sizes, notCleanAt, failedAt, lines } = await checkText(source, page, {
            sizes: o.sizes,
            open: o.open,
            trigger: o.trigger,
            'mobile-menu': Boolean(o.mobileMenu),
            scroll: o.scroll,
            scale: o.scale,
            shots: o.shots,
            'hide-css': o.hideCss,
            'source-cache': o.sourceCache,
            baseline: o.baseline,
            band: o.band,
            tolerance: o.tolerance,
            parallel: o.parallel,
          });
          if (failedAt.length) {
            const all = new Set(sizes.map((r) => r.tag.split(' ')[0])).size;
            throw new CliError(
              CHECK_FAILED,
              `${failedAt.length} of ${all} sizes could not be compared (${failedAt.join(',')}); ` +
                `the lines of this run:\n${lines.join('\n')}`,
              { hint: `re-run those with --sizes ${failedAt.join(',')}` },
            );
          }
          return { clean: ok, notCleanAt, sizes, text: lines.join('\n') };
        },
        { images: true },
      ),
    );
}
