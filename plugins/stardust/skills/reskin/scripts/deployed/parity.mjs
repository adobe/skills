// skills/reskin/scripts/deployed/parity.mjs — A3 of the deployed leg, `parity`: the preview held to the local reskin
// page with replica's instruments, each called as shipped (a child process, the preview side of the stitched capture
// given --wait 3000 for the EDS decoration). Per width (1440 and 360):
//   pixel          stitch-shot of both sides, then pixel-compare: differing pixels ≤ 10%
//   height         |Δh| ≤ 5% of the reskin page's height (the pixel number only covers the overlap)
//   header crop    crop-compare of the header band ≤ 2%, from the top of both captures
//   footer crop    crop-compare of the footer band ≤ 2%, from the bottom of both captures
//                  the band is the reskin page's measured header / footer height, measured in a browser at that
//                  width; where the reskin page has none, the row is "n/a: reskin page renders no chrome", and where
//                  only the preview has none it is a FAIL, "preview renders no <header>"
// and at 1440 also
//   chrome-parity  computed-style parity of the regions the reskin page has: advisory, never a FAIL
//   cap-probe      the reskin page's content caps captured to <deployed>/design.json, then compared with the
//                  preview's: ✗ is a FAIL, caps within ±20px
// A protected preview gets every row "n/a: protected preview": replica's capture instruments carry no site auth.
// The reskin page is served by a small static server on 127.0.0.1 for the run (serve.mjs: its own directory, so
// relative assets resolve), never file://, which stitch-shot and cap-probe treat as live-unsafe.
//   runParity({ dir, slug, preview, reskinPage, widths, tools, env })  writes parity.json ({ verdict, rows }) and
//        returns { verdict: 'PASS' | 'FAIL' | 'ERROR' | 'n/a', exit, rows }. A row is { check, width, value, bar,
//        status: 'PASS' | 'FAIL' | 'ADVISORY' | 'ERROR' | 'n/a', artifact, detail }. An instrument that gives no verdict
//        (exit 124, 1 or any other unexpected exit, or a result without its number) makes its row "ERROR (exit N)",
//        the verdict ERROR and the exit 124; a bot challenge (exit 3) throws an error with code 3. `tools` maps
//        stitch, pixel, crop, chrome and cap to script paths (default: replicaTools()), for tests.
//   replicaTools(from)  the five instruments in either layout of the scripts, or a UsageError naming what is missing
//   parityLines(result) the lines the CLI prints
// Evidence: <deployed>/parity/ (the two captures and the diffs per width, chrome-parity-1440.json,
// cap-probe-1440.json), <deployed>/design.json and <deployed>/parity.json.
import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { loadChromium } from '../figma-gate/target.mjs';
import { callTool as call, childEnv, exitOf, firstLine, outputOf, parseJson } from './child.mjs';
import { edsSettle, loadLiveSession } from './eds.mjs';
import { deployedDir } from './io.mjs';
import { serveReskinPage } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts, one level deeper than the top-level scripts: the plugin tree (skills/reskin/scripts/deployed ↔
// skills/replica/scripts) and the project copy (stardust/scripts/reskin/deployed ↔ stardust/scripts/replica).
const REPLICA = ['../../../replica/scripts', '../../replica'];
const TOOL_FILES = { stitch: 'stitch-shot.mjs', pixel: 'pixel-compare.mjs', crop: 'crop-compare.mjs', chrome: 'chrome-parity.mjs', cap: 'cap-probe.mjs' };

const BARS = { pixel: 10, height: 5, crop: 2, cap: 20 };
const BAR_OF = {
  pixel: `≤ ${BARS.pixel}%`,
  height: `≤ ${BARS.height}%`,
  'header crop': `≤ ${BARS.crop}%`,
  'footer crop': `≤ ${BARS.crop}%`,
  'chrome-parity': 'advisory',
  'cap-probe': `±${BARS.cap}px`,
};
const WIDE = 1440;
const PREVIEW_WAIT_MS = 3000;
const PIXEL_TIMEOUT_S = 120;
const NAV_TIMEOUT_MS = 30000;
const EDS_TIMEOUT_MS = 20000;
const MAX_ADVISORIES = 10;
const NO_CHROME = 'reskin page renders no chrome';
const EXIT = { PASS: 0, 'n/a': 0, FAIL: 1, ERROR: 124 };

function missingTools(names) {
  return new UsageError(`${names.join(', ')} not found (looked in ../../../replica/scripts/ and ../../replica/): copy the replica skill's scripts beside the reskin scripts (stardust/scripts/replica/)`);
}

// The five instruments by role, from `from` (the directory of this file) in whichever layout holds them.
export function replicaTools(from = HERE) {
  const dirs = REPLICA.map((p) => resolve(from, p));
  const tools = {};
  const missing = [];
  for (const [role, file] of Object.entries(TOOL_FILES)) {
    const dir = dirs.find((d) => existsSync(join(d, file)));
    if (dir) tools[role] = join(dir, file); else missing.push(file);
  }
  if (missing.length) throw missingTools(missing);
  return tools;
}

function checkTools(tools) {
  const missing = Object.entries(TOOL_FILES).filter(([role]) => !tools[role] || !existsSync(tools[role])).map(([, file]) => file);
  if (missing.length) throw missingTools(missing);
  return tools;
}

// The pixel size of a PNG, from its IHDR chunk.
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try { readSync(fd, head, 0, 24, 0); } finally { closeSync(fd); }
  if (head.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// In the page: the heights of the first header and footer element, 0 where there is none.
const chromeHeights = () => {
  const heightOf = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : 0; };
  return { header: heightOf('header'), footer: heightOf('footer') };
};

// { [width]: { reskin: { header, footer }, preview: { header, footer } } } as each side renders at that width: the
// reskin page after networkidle, the preview once its EDS decoration has settled (a stall is A4's finding, not this one's).
async function measureChrome({ widths, urls }) {
  const chromium = await loadChromium();
  const { newLiveContext } = await loadLiveSession();
  const browser = await chromium.launch();
  const heights = {};
  try {
    for (const width of widths) {
      heights[width] = {};
      for (const side of ['reskin', 'preview']) {
        const ctx = await newLiveContext(browser, { viewport: { width, height: 900 } });
        try {
          const page = await ctx.newPage();
          await page.goto(urls[side], { waitUntil: side === 'preview' ? 'domcontentloaded' : 'networkidle', timeout: NAV_TIMEOUT_MS });
          if (side === 'preview') await edsSettle(page, { timeoutMs: EDS_TIMEOUT_MS }); else await page.evaluate(() => document.fonts.ready);
          heights[width][side] = await page.evaluate(chromeHeights);
        } finally { await ctx.close(); }
      }
    }
  } finally { await browser.close(); }
  return heights;
}

const row = (check, width, status, value, { artifact = null, detail = null } = {}) => ({ check, width, value, bar: BAR_OF[check], status, artifact, detail });
const naRow = (check, width, reason) => row(check, width, 'n/a', `n/a: ${reason}`);

const errorRow = (check, width, name, r) => row(check, width, 'ERROR', `ERROR (exit ${exitOf(r)})`, { detail: firstLine(outputOf(r, null)) || `${name} exited ${exitOf(r)} without a message` });

// The rows of one width that come from the two stitched captures: pixel, height, header crop, footer crop.
async function captureRows({ width, urls, out, chrome, tools, env }) {
  const png = { reskin: join(out, `reskin-${width}.png`), preview: join(out, `preview-${width}.png`) };
  let broken = null;
  for (const side of ['reskin', 'preview']) {
    const extra = side === 'preview' ? ['--wait', String(PREVIEW_WAIT_MS)] : [];
    const r = await call('stitch-shot', tools.stitch, [urls[side], png[side], '--width', String(width), '--settle', ...extra], env);
    if (r.status !== 0) { broken = r; break; }
  }
  const rows = [];

  const diff = join(out, `diff-${width}.png`);
  let measured = null;
  let pixelError = broken;
  if (!broken) {
    const r = await call('pixel-compare', tools.pixel, [png.reskin, png.preview, '--out', diff, '--threshold', String(BARS.pixel), '--json', '--timeout', String(PIXEL_TIMEOUT_S)], env);
    const j = r.status === 0 || r.status === 2 ? parseJson(r.stdout) : null;
    if (Number.isFinite(j?.pct) && Number.isFinite(j?.heightDelta)) measured = { r, j }; else pixelError = r;
  }
  if (!measured) {
    rows.push(errorRow('pixel', width, 'pixel-compare', pixelError), errorRow('height', width, 'pixel-compare', pixelError));
  } else {
    const { r, j } = measured;
    rows.push(row('pixel', width, r.status === 0 ? 'PASS' : 'FAIL', `${j.pct.toFixed(2)}%`, { artifact: diff }));
    const reskinH = pngSize(png.reskin).height;
    const delta = -j.heightDelta;
    const over = Math.abs(delta) * 100 > BARS.height * reskinH;
    rows.push(row('height', width, over ? 'FAIL' : 'PASS', `Δh ${delta > 0 ? '+' : ''}${delta}px (${((Math.abs(delta) / reskinH) * 100).toFixed(1)}% of ${reskinH}px)`));
  }

  for (const part of ['header', 'footer']) {
    const check = `${part} crop`;
    if (!chrome.reskin[part]) { rows.push(naRow(check, width, NO_CHROME)); continue; }
    if (!chrome.preview[part]) { rows.push(row(check, width, 'FAIL', `preview renders no <${part}>`)); continue; }
    if (broken) { rows.push(errorRow(check, width, 'stitch-shot', broken)); continue; }
    const size = { reskin: pngSize(png.reskin), preview: pngSize(png.preview) };
    const height = Math.min(chrome.reskin[part], size.reskin.height, size.preview.height);
    const [y, yB] = part === 'header' ? [0, 0] : [size.reskin.height - height, size.preview.height - height];
    const file = join(out, `${part}-diff-${width}.png`);
    const r = await call('crop-compare', tools.crop, [png.reskin, png.preview, '--y', String(y), '--y-b', String(yB), '--height', String(height), '--out', file, '--threshold', String(BARS.crop), '--json'], env);
    const j = r.status === 0 || r.status === 2 ? parseJson(r.stdout) : null;
    if (!Number.isFinite(j?.diffPct)) { rows.push(errorRow(check, width, 'crop-compare', r)); continue; }
    rows.push(row(check, width, r.status === 0 ? 'PASS' : 'FAIL', `${j.diffPct.toFixed(2)}%`, { artifact: file, detail: r.status === 2 && j.texture?.label ? `diff texture: ${j.texture.label}` : null }));
  }
  return rows;
}

// chrome-parity of the regions the reskin page has, at 1440. Advisory: deltas are never a FAIL.
async function chromeParityRow({ urls, out, chrome, tools, env }) {
  const parts = ['header', 'footer'].filter((p) => chrome.reskin[p]);
  if (!parts.length) return naRow('chrome-parity', WIDE, NO_CHROME);
  const r = await call('chrome-parity', tools.chrome, [urls.reskin, urls.preview, '--width', String(WIDE), '--no-defaults', ...parts.flatMap((p) => ['--region', `${p}=${p}`]), '--json'], env);
  const j = r.status === 0 || r.status === 2 ? parseJson(r.stdout) : null;
  if (!Array.isArray(j?.regions)) return errorRow('chrome-parity', WIDE, 'chrome-parity', r);
  const file = join(out, `chrome-parity-${WIDE}.json`);
  writeFileSync(file, r.stdout);
  if (r.status === 0) return row('chrome-parity', WIDE, 'PASS', 'no deltas', { artifact: file });
  const findings = j.regions.flatMap((g) => g.findings.map((f) => `${g.name} ${f.kind}${f.text ? ` "${f.text.slice(0, 40)}"` : ''} ${f.msg}`));
  const shown = findings.slice(0, MAX_ADVISORIES);
  if (findings.length > shown.length) shown.push(`… ${findings.length - shown.length} more in ${file}`);
  return row('chrome-parity', WIDE, 'ADVISORY', `${findings.length} delta(s): ${j.regions.map((g) => `${g.name} ${g.findings.length}`).join(', ')}`, { artifact: file, detail: shown.join('\n') });
}

// cap-probe at 1440: the reskin page's caps captured into <deployed>/design.json, then the preview's compared with them.
async function capProbeRow({ urls, out, deployed, tools, env }) {
  const design = join(deployed, 'design.json');
  const captured = await call('cap-probe', tools.cap, [urls.reskin, '--write-design', design], env);
  if (captured.status !== 0) return errorRow('cap-probe', WIDE, 'cap-probe', captured);
  const file = join(out, `cap-probe-${WIDE}.json`);
  const r = await call('cap-probe', tools.cap, [urls.reskin, '--against', urls.preview, '--design', design, '--tolerance', String(BARS.cap), '--json', '--out', file], env);
  const rows = r.status === 0 || r.status === 2 ? parseJson(r.stdout)?.compare?.rows : null;
  if (!Array.isArray(rows)) return errorRow('cap-probe', WIDE, 'cap-probe', r);
  const differing = rows.filter((x) => x.ok === false);
  return row('cap-probe', WIDE, r.status === 0 ? 'PASS' : 'FAIL', `${differing.length} of ${rows.length} rows differ`, {
    artifact: file,
    detail: r.status === 2 ? differing.map((x) => `${x.label}: ${x.detail}`).join('\n') || null : null,
  });
}

const plan = (widths) => widths.flatMap((width) => [
  ['pixel', width], ['height', width], ['header crop', width], ['footer crop', width],
  ...(width === WIDE ? [['chrome-parity', width], ['cap-probe', width]] : []),
]);

// preview is the record of `deployed-gate preview`; reskinPage the file of the local reskin page (default
// <dir>/reskin/pages/<slug>.html).
export async function runParity({ dir, slug, preview, reskinPage = join(dir, 'reskin', 'pages', `${slug}.html`), widths = [1440, 360], tools = null, env = process.env }) {
  const deployed = deployedDir(dir, slug);
  const out = join(deployed, 'parity');
  const record = join(deployed, 'parity.json');
  for (const stale of [record, out, join(deployed, 'design.json')]) rmSync(stale, { recursive: true, force: true });
  const seal = (rows, verdict = rows.some((r) => r.status === 'ERROR') ? 'ERROR' : rows.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS') => {
    writeJson(record, { verdict, rows });
    return { verdict, exit: EXIT[verdict], rows };
  };

  if (preview.auth) return seal(plan(widths).map(([check, width]) => naRow(check, width, 'protected preview')), 'n/a');
  if (typeof preview.url !== 'string' || !preview.url) throw new UsageError(`${join(deployed, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  if (!existsSync(reskinPage)) throw new UsageError(`missing ${reskinPage}: the reskin page the preview is held to (deployed-gate parity --reskin <file>)`);
  const instruments = tools ? checkTools(tools) : replicaTools();
  mkdirSync(out, { recursive: true });

  const server = await serveReskinPage(reskinPage);
  try {
    const urls = { reskin: server.url, preview: preview.url };
    const run = { urls, out, tools: instruments, env: childEnv(env, null) };
    const chrome = await measureChrome({ widths, urls });
    const rows = [];
    for (const width of widths) {
      rows.push(...await captureRows({ ...run, width, chrome: chrome[width] }));
      if (width === WIDE) rows.push(await chromeParityRow({ ...run, chrome: chrome[width] }), await capProbeRow({ ...run, deployed }));
    }
    return seal(rows);
  } finally { await server.close(); }
}

const labelOf = (r) => `${r.check}${r.width ? ` @${r.width}` : ''}`;
const detailLines = (r, indent) => (r.detail ? r.detail.split('\n').map((l) => `${indent}${l}`) : []);

// The lines the CLI prints: the verdict line, one indented line per failing row (its findings below), the advisory
// lines, and one n/a line per distinct reason.
export function parityLines({ verdict, rows }) {
  const errors = rows.filter((r) => r.status === 'ERROR');
  const fails = rows.filter((r) => r.status === 'FAIL');
  const lines = [];
  if (errors.length) {
    lines.push(`ERROR (exit ${EXIT.ERROR}) parity: ${errors.length} check${errors.length === 1 ? '' : 's'} gave no verdict`);
    for (const r of errors) lines.push(`  ${labelOf(r)}: ${r.value}`, ...detailLines(r, '    '));
  }
  if (fails.length) {
    lines.push('FAIL parity');
    for (const r of fails) lines.push(`  ${labelOf(r)}: ${r.value} (bar ${r.bar})`, ...detailLines(r, '    '));
  }
  if (verdict === 'PASS') lines.push('PASS parity');
  for (const r of rows.filter((x) => x.status === 'ADVISORY')) lines.push(`ADVISORY ${labelOf(r)}: ${r.value}`, ...detailLines(r, '  '));
  const reasons = new Map();
  for (const r of rows.filter((x) => x.status === 'n/a')) reasons.set(r.value, [...(reasons.get(r.value) ?? []), labelOf(r)]);
  for (const [value, labels] of reasons) lines.push(`${value} (${labels.join(', ')})`);
  return lines;
}
