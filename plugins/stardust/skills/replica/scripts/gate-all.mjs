#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/replica/scripts/gate-all.mjs — the published-origin gate over EVERY deployed page (#125, D0).
 *
 * Per `deployed` page in stardust/state.json (url = source, liveUrl = served): stitched captures of
 * both sides (stitch-shot, --settle), pixel-compare, then content-presence (D2, carries clip-probe's
 * inventory for both sides, D1) and — for units.json entries — unit-geometry (D3). Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + content.json + clip.json [+ units.json],
 * <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead.
 *
 * VERDICT (all four): pixel % ≤ --threshold AND |Δh| ≤ --height-tol × origin height (a padded/union
 * metric was tried and rejected — white gaps score as matches) AND served clipped ≤ --clip-max +
 * clip-allow.json allowance AND content MISSING + HIDDEN links / headings = 0 (n/a when the origin
 * could not be probed — never a fail) [+ required units within --unit-tol]. The pixel-only verdict is
 * recorded beside it per page and in the totals — every run is calibration data.
 *
 * Sidecars in <out>/, each entry documented: masks.json (printed on the verdict), overrides.json
 * (shown BESIDE the number, never replacing it), clip-allow.json, presence.json (session-variable
 * regions), units.json (repeated units). Origin fallback: live stitch → previous origin
 * (--recapture-origin) → <crawl-shots>/<slug>.png (`crawl-fullpage`, asymmetric, flagged).
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--state f] [--out dir] [--width 1440]
 *        [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--eds-host <h>]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--threshold 10] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>]
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs and
 * pixel-compare.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (overrides count), 2 any FAIL, 1 error. `verdict`, `formatSummary`, `parseArgs` are exported.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --state <file>            stardust/state.json
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched)
  --skip-existing           reuse captures in the page dir
  --recapture-eds           (with --skip-existing) re-shoot eds.png only
  --recapture-origin        re-shoot origin.png (previous kept on failure)
  --eds-host <host>         gate a code branch host against the same content
  --blocked <regex>         origins the edge denies → crawl shot unless --try-blocked
  --try-blocked             attempt the live stitch on --blocked origins too
  --crawl-shots <dir>       stardust/current/assets/screenshots (fallback origin PNGs)
  --origin-concurrency <n>  2      --eds-concurrency <n>  4      --probe-concurrency <n>  2
  --threshold <pct>         10     --height-tol <frac>    0.05   --clip-max <n>  0   --unit-tol <px>  4
  --no-clip | --no-content | --no-probes   drop criteria 3 / 4 / both (pixel-only verdict)
  --units <file>            repeated-unit declarations (default <out>/units.json)
  --compare-only            no captures; recompute from existing PNGs
  --warmup <url>            origin warm-up for the probes
  --vh <px>                 stitch chunk height
  --help                    this text
Verdict = pixel % ≤ threshold AND |Δh| ≤ height-tol × origin height AND clipped ≤ clip-max(+allowance) AND content MISSING+HIDDEN = 0.
Sidecars in <out>/: masks.json, overrides.json, clip-allow.json, presence.json, units.json (see the header).
Exit: 0 all PASS (overrides count), 2 any FAIL, 1 error.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = () => rest[++i];
    if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') o.width = Number(v());
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') o.edsHost = v().replace(/\/$/, ''); else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-concurrency') o.oc = Number(v()); else if (a === '--eds-concurrency') o.ec = Number(v()); else if (a === '--probe-concurrency') o.pc = Number(v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (!o.out) o.out = `stardust/replica/gates/all-${o.width}`;
  return o;
}

// ---- pure: the verdict --------------------------------------------------------------------------------
/**
 * verdict({ pixel, clip, content, units, override, allowance }, opts) → row fields. `pixel` = pixel.json,
 * `clip` = { counts } (served side) or null, `content` = { totals } | { error } | null, `units` = { verdict } | null.
 */
export function verdict({ pixel = {}, clip = null, content = null, units = null, override = null, allowance = 0 }, { threshold = 10, heightTol = 0.05, clipMax = 0, clipOn = true, contentOn = true } = {}) {
  const compared = pixel.compared && Number.isFinite(pixel.heightDelta);
  const originH = compared ? pixel.compared.height + Math.max(0, pixel.heightDelta) : null;
  const edsH = compared ? pixel.compared.height + Math.max(0, -pixel.heightDelta) : null;
  const pixelPass = compared && pixel.pct <= threshold;
  const heightPass = compared && Math.abs(pixel.heightDelta) <= heightTol * originH;
  const clipped = clip && clip.counts ? clip.counts.total : null;
  const clipPass = !clipOn ? null : clipped == null ? null : clipped <= clipMax + allowance;
  const cTot = content && content.totals ? content.totals : null;
  const contentPass = !contentOn ? null : cTot ? (cTot.missing + cTot.hidden) === 0 : null;
  const unitPass = units && units.verdict && units.required ? (units.verdict.off + units.verdict.hidden + units.verdict.missing + units.verdict.errors) === 0 : null;
  const reasons = [];
  if (!compared) reasons.push(pixel.error ? `pixel error: ${pixel.error}` : 'missing capture');
  if (compared && !pixelPass) reasons.push(`pixel ${pixel.pct}% > ${threshold}%`);
  if (compared && !heightPass) reasons.push(`Δh ${pixel.heightDelta}px > ${Math.round(heightTol * 100)}% of ${originH}`);
  if (clipPass === false) reasons.push(`clipped ${clipped}${allowance ? ` > allowance ${allowance}` : ''}${clip.counts ? ` (text ${clip.counts.textClipped + clip.counts.textHidden}, controls ${clip.counts.controlHidden + clip.counts.controlClipped})` : ''}`);
  if (contentPass === false) reasons.push(`content MISSING ${cTot.missing} / HIDDEN ${cTot.hidden}${cTot.controlState ? ` (+${cTot.controlState} control state)` : ''}`);
  if (unitPass === false) reasons.push(`units off ${units.verdict.off} hidden ${units.verdict.hidden} missing ${units.verdict.missing}`);
  const pixelOnlyPass = !!(pixelPass && heightPass);
  const pass = pixelOnlyPass && clipPass !== false && contentPass !== false && unitPass !== false;
  return { originH, edsH, pixelPass: !!pixelPass, heightPass: !!heightPass, clipped, clipPass, clipAllowance: allowance, contentPass, contentNA: contentOn && !cTot ? (content && content.error) || 'not probed' : null, unitPass, pixelOnlyPass, pass, passWithOverride: pass || !!override, reasons };
}

const cell = (v, suffix = '') => (v == null ? 'n/a' : `${v}${suffix}`);
export function formatSummary(summary) {
  const t = summary.totals; const p = summary._provenance;
  const head = [`# Published-origin gate — all deployed pages, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error of ${t.pages}**${t.overridePass ? ` (+${t.overridePass} documented override${t.overridePass > 1 ? 's' : ''} → ${t.passWithOverrides} delivered)` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}; content n/a (origin not probed) ${t.contentNA}.`, ''];
  const rows = ['| page | template | tier | origin | pixel % (text %) | Δh px | clipped | content | units | verdict | reasons |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const content = r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}` : '-';
    const verdictCell = r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${cell(r.pct)}${r.textPct != null ? ` (${r.textPct})` : ''} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? ` → ${r.override.verdict}: ${r.override.reason}` : ''} | ${r.reasons.join('; ') || '-'} |`);
  }
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (cands) => cands.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const DIFF_DIR = firstExisting(['../../diff/scripts', '../diff']);
const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

function run(cmd, args, { timeoutMs = 480000 } = {}) {
  return new Promise((res) => {
    const ch = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { ch.kill('SIGKILL'); err += '\n[gate-all] TIMEOUT'; }, timeoutMs);
    ch.on('close', (code) => { clearTimeout(t); res({ code, out, err }); });
  });
}
async function pool(items, n, fn) { const q = [...items]; const workers = []; for (let i = 0; i < Math.max(1, n); i += 1) workers.push((async () => { while (q.length) await fn(q.shift()); })()); await Promise.all(workers); }
const lastLine = (s) => (s || '').trim().split('\n').filter(Boolean).pop() || '';

async function main() {
  const opts = parseArgs(process.argv);
  if (!existsSync(opts.state)) { console.error(`gate-all: ${opts.state} not found — run from the project root or pass --state`); process.exit(1); }
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = readJson(opts.state);
  let pages = (state.pages || []).filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  if (opts.only) pages = pages.filter((p) => opts.only.includes(p.slug));
  if (!pages.length) { console.error('gate-all: no deployed pages selected'); process.exit(1); }
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  const CLIP_ALLOW = readJson(join(opts.out, 'clip-allow.json'), {}); const PRESENCE = readJson(join(opts.out, 'presence.json'), {});
  const UNITS = readJson(opts.units || join(opts.out, 'units.json'), {});
  const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); writeFileSync(join(opts.out, '_run.log'), `${line}\n`, { flag: 'a' }); };
  const dir = (p) => join(opts.out, p.slug);
  const edsUrl = (p) => (opts.edsHost ? p.liveUrl.replace(/^https?:\/\/[^/]+/, opts.edsHost) : p.liveUrl);
  const results = {};
  const rec = (p, k, v) => { results[p.slug] = { ...(results[p.slug] || {}), [k]: v }; };
  const stitchArgs = (url, out) => [STITCH, url, out, '--width', String(opts.width), '--settle', '--locale', 'en-US', ...(opts.vh ? ['--vh', String(opts.vh)] : [])];

  async function captureOrigin(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'origin.png'); const meta = join(d, 'origin.json');
    if (opts.skip && !opts.recaptureOrigin && existsSync(out) && existsSync(meta)) { rec(p, 'origin', readJson(meta)); return; }
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    let r;
    if (opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked) {
      if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `origin matches --blocked ${opts.blocked}; crawl screenshot used (lazy rails may be placeholders)` }; }
      else r = { instrument: 'none', error: `origin blocked and no crawl shot at ${crawlShot}` };
    } else {
      const s = await run('node', [...stitchArgs(p.url, out), '--headed']);
      if (s.code === 0) r = { instrument: 'stitch-live', url: p.url, log: s.out.trim().split('\n').slice(-2) };
      else if (existsSync(out) && existsSync(meta) && opts.recaptureOrigin) r = { ...readJson(meta), note: `re-shoot failed (exit ${s.code}: ${lastLine(s.err)}) — previous origin kept` };
      else if (existsSync(crawlShot)) { copyFileSync(crawlShot, out); r = { instrument: 'crawl-fullpage', asymmetric: true, note: `stitch exit ${s.code}: ${lastLine(s.err)} — crawl screenshot used` }; }
      else r = { instrument: 'none', error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    }
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'origin', r);
    log(`origin ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  async function captureEds(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'eds.png'); const meta = join(d, 'eds.json');
    if (opts.skip && !opts.recaptureEds && existsSync(out) && existsSync(meta)) { rec(p, 'eds', readJson(meta)); return; }
    const s = await run('node', stitchArgs(edsUrl(p), out));
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  async function probe(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const pr = PRESENCE[p.slug] || {};
    if (opts.content) {
      const args = [join(DIFF_DIR, 'content-presence.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--json', join(d, 'content.json')];
      if (pr.variable && pr.variable.length) args.push('--variable', pr.variable.join(','));
      if (pr.main) args.push('--main', pr.main);
      if (opts.warmup) args.push('--warmup', opts.warmup);
      const s = await run('node', args);
      const content = readJson(join(d, 'content.json'));
      if (content && (s.code === 0 || s.code === 2)) {
        rec(p, 'content', { totals: content.totals, scope: content.scope, variable: pr.variable || [], reason: pr.reason || null });
        rec(p, 'clip', { counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: content.origin.clip.counts, source: 'content-presence' });
        writeFileSync(join(d, 'clip.json'), JSON.stringify({ url: edsUrl(p), at: content._provenance.at, source: 'content-presence', counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: { counts: content.origin.clip.counts } }, null, 1));
        if (content.textBoxes && content.textBoxes.origin) writeFileSync(join(d, 'text-boxes.json'), JSON.stringify({ side: 'origin', boxes: content.textBoxes.origin }));
        log(`content ${p.slug} → MISSING ${content.totals.missing} HIDDEN ${content.totals.hidden} state ${content.totals.controlState}; clipped ${content.eds.clip.counts.total}`);
      } else {
        const why = s.code === 3 ? 'origin bot challenge' : s.code === 4 ? `origin ${lastLine(s.err).replace(/^content-presence error: /, '')}` : `content-presence exit ${s.code}: ${lastLine(s.err)}`;
        rec(p, 'content', { error: why });
        log(`content ${p.slug} → n/a (${why})`);
      }
    }
    if (opts.clip && !(results[p.slug] && results[p.slug].clip)) {
      const s = await run('node', [join(DIFF_DIR, 'clip-probe.mjs'), edsUrl(p), '--width', String(opts.width), '--json', join(d, 'clip.json')]);
      const clip = readJson(join(d, 'clip.json'));
      if (clip && (s.code === 0 || s.code === 2)) { rec(p, 'clip', { counts: clip.counts, groups: clip.groups, source: 'clip-probe' }); log(`clip ${p.slug} → ${clip.counts.total}`); }
      else { rec(p, 'clip', { error: `clip-probe exit ${s.code}: ${lastLine(s.err)}` }); log(`clip ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    const u = UNITS[p.slug];
    if (u && u.units && u.units.length) {
      const args = [join(DIFF_DIR, 'unit-geometry.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--tol', String(opts.unitTol), '--n', String(Math.max(...u.units.map((x) => x.n || 1))), '--json', join(d, 'units.json'), '--slug', p.slug];
      for (const x of u.units) args.push('--unit', `${x.origin}=${x.eds || x.origin}`);
      if (opts.warmup) args.push('--warmup', opts.warmup);
      const s = await run('node', args);
      const res = readJson(join(d, 'units.json'));
      if (res && (s.code === 0 || s.code === 2)) { rec(p, 'units', { verdict: res.verdict, required: u.units.some((x) => x.required) }); log(`units ${p.slug} → off ${res.verdict.off} hidden ${res.verdict.hidden} missing ${res.verdict.missing}`); }
      else { rec(p, 'units', { error: `unit-geometry exit ${s.code}: ${lastLine(s.err)}`, required: u.units.some((x) => x.required) }); log(`units ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
  }
  async function compare(p) {
    const d = dir(p);
    if (!existsSync(join(d, 'origin.png')) || !existsSync(join(d, 'eds.png'))) { rec(p, 'pixel', { error: 'missing capture' }); return; }
    const mk = MASKS[p.slug];
    const args = [PIXEL, join(d, 'origin.png'), join(d, 'eds.png'), '--out', join(d, 'diff.png'), '--threshold', String(opts.threshold), '--json', '--timeout', '300'];
    if (mk && mk.masks && mk.masks.length) args.push('--mask', mk.masks.join(','));
    if (existsSync(join(d, 'text-boxes.json'))) args.push('--text-boxes', join(d, 'text-boxes.json'));
    const r = await run('node', args);
    let px; try { px = JSON.parse(r.out); } catch { px = { error: lastLine(r.err) || `exit ${r.code}` }; }
    if (mk && mk.masks && mk.masks.length && !px.error) px.maskReason = mk.reason || null;
    writeFileSync(join(d, 'pixel.json'), JSON.stringify(px, null, 2)); rec(p, 'pixel', px);
    log(`pixel ${p.slug} → ${px.error ? `ERROR ${px.error}` : `${px.pct}% Δh ${px.heightDelta}${px.textPct != null ? ` text ${px.textPct}%` : ''} ${px.pass ? 'PASS' : 'FAIL'}${px.maskedRows ? ` [MASKED ${px.maskedRows} rows: ${px.maskReason}]` : ''}`}`);
  }

  if (!opts.compareOnly) await Promise.all([pool(pages, opts.oc, captureOrigin), pool(pages, opts.ec, captureEds)]);
  else for (const p of pages) for (const side of ['origin', 'eds']) { const m = readJson(join(dir(p), `${side}.json`)); if (m) rec(p, side, m); }
  if (opts.clip || opts.content || Object.keys(UNITS).length) await pool(pages, opts.pc, probe);
  await pool(pages, 4, compare);

  const rows = pages.map((p) => {
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip && r.clip.counts ? r.clip : null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0 }, { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content });
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument,
      pct: px.pct ?? null, textPct: px.textPct ?? null, unionPct: px.unionPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      override: OVERRIDES[p.slug] || null, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null };
  });
  const n = (f) => rows.filter(f).length;
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && r.override), fail: n((r) => !r.pass && r.pct != null), error: n((r) => r.pct == null),
    failPixel: n((r) => r.pct != null && !r.pixelPass), failHeight: n((r) => r.pct != null && !r.heightPass), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric) };
  totals.passWithOverrides = totals.pass + totals.overridePass;
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: new Date().toISOString(), breakpoint: opts.width, threshold: opts.threshold, heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `overlap pixel % ≤ ${opts.threshold} AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, only: opts.only }, totals, rows };
  const md = formatSummary(summary);
  if (opts.only) { mkdirSync(join(opts.out, 'runs'), { recursive: true }); const f = join(opts.out, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${opts.only[0]}.json`); writeFileSync(f, JSON.stringify(summary, null, 2)); console.log(md); console.log(`run → ${f}`); }
  else { writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2)); writeFileSync(join(opts.out, 'summary.md'), md); console.log(md.split('\n').slice(0, 7).join('\n')); console.log(`summary → ${join(opts.out, 'summary.md')}`); }
  console.log(JSON.stringify(totals));
  process.exitCode = totals.pass + totals.overridePass === totals.pages ? 0 : 2;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main().catch((e) => { console.error(`gate-all error: ${e.message}`); process.exit(1); });
}
