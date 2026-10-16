#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/replica/scripts/gate-all.mjs — the published-origin gate over EVERY deployed page (#125, D0).
 *
 * THE RULE (#125): every crafted prototype and every deployed page is a row in a pixel table —
 * `<out>/summary.{json,md}` at `stardust/replica/gates/prototypes-<w>/` (--stage prototype: pages with
 * a prototypePath, build = the served prototype, origin = the archetype round's cached live.png when
 * present) and `stardust/replica/gates/all-<w>/` (--stage published, default: `deployed` pages, build =
 * liveUrl). gate-evidence.mjs reads these tables as the source of record; a page without a row is ungated.
 *
 * Per page: stitched captures of both sides (stitch-shot, --settle), pixel-compare, then the DOM probes
 * — clip-probe on the served side (D1, both stages), content-presence (D2, published stage; the
 * prototype is authored from the same capture content-diff already reconciles) and unit-geometry (D3)
 * for the repeated-unit families stardust/replica/units.json declares for the page. Writes
 * <out>/<slug>/{origin,eds,diff}.png + pixel.json + clip.json [+ content.json, units.json] + probes.json
 * [+ gate-key.json], <out>/summary.{json,md}; --only runs write <out>/runs/<ts>-<slug>.json instead.
 *
 * VERDICT (all four): pixel % ≤ --threshold AND |Δh| ≤ --height-tol × origin height (a union metric
 * was tried and rejected — white gaps score as matches) AND served clipped ≤ --clip-max +
 * clip-allow.json allowance AND content MISSING + HIDDEN links / headings = 0 (n/a when the origin
 * could not be probed — never a fail) [+ required units within --unit-tol]. The pixel-only verdict is
 * recorded beside it per page and in the totals — every run is calibration data.
 *
 * Sidecars in <out>/, each entry documented: masks.json (printed on the verdict), overrides.json
 * (shown BESIDE the number, never replacing it), clip-allow.json, presence.json (session-variable
 * regions); repeated units come from stardust/replica/units.json (unit-geometry.mjs header; a legacy
 * <out>/units.json per page still reads). Origin fallback: live stitch → previous origin
 * (--recapture-origin) → <crawl-shots>/<slug>.png (`crawl-fullpage`, asymmetric, flagged).
 *
 * REUSE (--skip-existing only; every reuse is printed in the row as `reused`, never silent). Origin captures in the
 * page dir are reused as before; an EDS capture only while its <slug>/gate-key.json proves it current (below).
 * Probes are replayed from <slug>/probes.json while the capture pair they were taken against is the one on disk —
 * same inputs, every probe ok and its JSON the recorded one, origin.json and eds.json no newer than the probes —
 * so the same-minute origin/build pairing holds because the pair is unchanged; --recapture-eds /
 * --recapture-origin invalidate them. Published stage: every row carries `gateKey`, sha256 over the frozen
 * foundation's snapshot + icons/ and plugins/, the shared blocks (no document authors them, or foundation code
 * loads them), the page's blocks with every block they import, its content document plus every nav*, footer* and
 * fragments/ document under content/ (any locale), and the build: EDS origin, source URL, width, criteria and
 * thresholds, the page's sidecar entries and the gate's instrument files with every local module they load. It is
 * issued only while that tree is what the gated host serves (code: no changed, deleted, renamed or untracked file
 * under any hashed code path against the upstream branch; host <ref>--<repo>--<owner> = that branch and remote;
 * documents: the newest deploy-ledger row delivered to that <owner>/<repo> (`verifiedOn`) with the same
 * contentSha), else null with the reason in the run log (a frozen-file edit since the freeze: null until re-frozen).
 * A PASS row whose key holds, from a table written under the same criteria, is reused whole (no stitch, probe or
 * compare). The EDS side is re-shot unless gate-key.json holds the same known key — or, the key unknown now, the
 * same parts, reason, upstream commit and ledger rows; a dir without gate-key.json (legacy) is re-shot once. A
 * fresh row keeps the key of its evidence only while that key is current (unknown now: same build part, probes
 * not re-run).
 *
 * Usage: node skills/replica/scripts/gate-all.mjs [--stage published|prototype] [--proto-base <url>]
 *        [--state f] [--out dir] [--width 1440] [--only <slug,…>] [--skip-existing] [--recapture-eds] [--recapture-origin] [--eds-host <h>]
 *        [--blocked <re>] [--try-blocked] [--crawl-shots <dir>] [--origin-concurrency 2]
 *        [--eds-concurrency 4] [--probe-concurrency 2] [--threshold 10] [--height-tol 0.05]
 *        [--clip-max 0] [--unit-tol 4] [--no-clip] [--no-content] [--no-probes] [--units <f>]
 *        [--compare-only] [--warmup <url>] [--vh <px>]
 * Requires playwright, pixelmatch, pngjs (project devDependencies); stitch-shot.mjs, pixel-compare.mjs
 * and foundation-freeze.mjs next to this file; the diff skill's scripts dir alongside. Exit: 0 all PASS
 * (overrides count), 2 any FAIL, 1 error. `verdict`, `formatSummary`, `parseArgs` and the reuse helpers
 * (`probeInputs`, `probeReuse`, `canon`, `gateKeyParts`, `gateKeyOf`, `foundationPart`, `sharedBlocks`,
 * `blockRefs`, `chromeDocs`, `instrumentFiles`, `edsHostOf`, `codeDeployed`, `hostServes`,
 * `deployedDocs`, `contentDeployed`, `keyChanged`, `skipCapture`, `rowKey`, `latestRows`, `rowReuse`) are exported.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_OUT as FREEZE_MANIFEST, DEFAULT_PATHS as FOUNDATION_PATHS, snapshot } from './foundation-freeze.mjs';

const HELP = `gate-all — published-origin gate over every deployed page: pixel + height + clip + content (#125)

Usage: node gate-all.mjs [options]   (from the project root)
  --stage published|prototype  published (default): deployed pages vs liveUrl → gates/all-<w>/;
                            prototype: pages with a prototypePath vs the served prototype → gates/prototypes-<w>/
  --proto-base <url>        where the prototypes dir is served (prototype stage), e.g. http://localhost:8791
  --state <file>            stardust/state.json
  --out <dir>               stardust/replica/gates/all-<width>
  --width <px>              1440
  --only <slug,…>           subset → runs/<ts>-<slug>.json (summary.* untouched)
  --skip-existing           reuse captures; probes while the capture pair is unchanged; PASS rows
                            while the gate key is unchanged (rows say reused); eds.png only while
                            its key is proven (no local content/<page>.html: no key, re-shot — slower)
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
Reuse sidecars per page: probes.json, gate-key.json (see the header).
Exit: 0 all PASS (overrides count), 2 any FAIL, 1 error.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { stage: 'published', protoBase: null, state: 'stardust/state.json', out: null, width: 1440, only: null, skip: false, recaptureEds: false, recaptureOrigin: false, edsHost: null, blocked: null, tryBlocked: false, crawlShots: 'stardust/current/assets/screenshots', oc: 2, ec: 4, pc: 2, threshold: 10, heightTol: 0.05, clipMax: 0, unitTol: 4, clip: true, content: true, units: null, compareOnly: false, warmup: null, vh: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]; const v = () => rest[++i];
    if (a === '--stage') { o.stage = v(); if (!['published', 'prototype'].includes(o.stage)) { console.error(`--stage must be published or prototype\n\n${HELP}`); process.exit(1); } }
    else if (a === '--proto-base') o.protoBase = v().replace(/\/$/, '');
    else if (a === '--state') o.state = v(); else if (a === '--out') o.out = v(); else if (a === '--width') o.width = Number(v());
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-existing') o.skip = true; else if (a === '--recapture-eds') o.recaptureEds = true; else if (a === '--recapture-origin') o.recaptureOrigin = true;
    else if (a === '--eds-host') o.edsHost = v().replace(/\/$/, ''); else if (a === '--blocked') o.blocked = new RegExp(v()); else if (a === '--try-blocked') o.tryBlocked = true; else if (a === '--crawl-shots') o.crawlShots = v();
    else if (a === '--origin-concurrency') o.oc = Number(v()); else if (a === '--eds-concurrency') o.ec = Number(v()); else if (a === '--probe-concurrency') o.pc = Number(v());
    else if (a === '--threshold') o.threshold = Number(v()); else if (a === '--height-tol') o.heightTol = Number(v()); else if (a === '--clip-max') o.clipMax = Number(v()); else if (a === '--unit-tol') o.unitTol = Number(v());
    else if (a === '--no-clip') o.clip = false; else if (a === '--no-content') o.content = false; else if (a === '--no-probes') { o.clip = false; o.content = false; }
    else if (a === '--units') o.units = v(); else if (a === '--compare-only') o.compareOnly = true; else if (a === '--warmup') o.warmup = v(); else if (a === '--vh') o.vh = Number(v());
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (o.stage === 'prototype' && o.content) o.content = false; // content-diff already reconciles the prototype's text
  if (!o.out) o.out = `stardust/replica/gates/${o.stage === 'prototype' ? 'prototypes' : 'all'}-${o.width}`;
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
  const head = [`# ${p.stage === 'prototype' ? 'Prototype gate — every crafted prototype' : 'Published-origin gate — all deployed pages'}, ${p.breakpoint}px`, '', `${p.writtenAt} · **${t.pass} PASS / ${t.fail} FAIL / ${t.error} error of ${t.pages}**${t.overridePass ? ` (+${t.overridePass} documented override${t.overridePass > 1 ? 's' : ''} → ${t.passWithOverrides} delivered)` : ''}${t.reusedRows || t.reusedProbes ? ` · reused: ${t.reusedRows || 0} rows, ${t.reusedProbes || 0} probe sets` : ''}`, '', `Verdict: ${p.verdict}`, '', `Calibration — pixel-only verdict (criteria 1+2): **${t.pixelOnlyPass} PASS**; full verdict (1–4): **${t.pass} PASS**. Failing by criterion: pixel ${t.failPixel}, height ${t.failHeight}, clip ${t.failClip}, content ${t.failContent}${t.failUnits ? `, units ${t.failUnits}` : ''}; content n/a (origin not probed) ${t.contentNA}${t.degradedTier ? `; **${t.degradedTier} page(s) probed on a degraded browser tier** (Chrome elected, Chromium used — install Chrome for bot-managed origins)` : ''}${t.asymmetricOrigins ? `; ${t.asymmetricOrigins} asymmetric origin(s)` : ''}.`, ''];
  const rows = ['| page | template | tier | origin | browser | pixel % (text %) | Δh px | clipped | content | units | verdict | reasons | reused |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...summary.rows].sort((a, b) => Number(b.pass) - Number(a.pass) || (a.pct ?? 999) - (b.pct ?? 999))) {
    const content = r.contentNA ? `n/a (${r.contentNA})` : r.content ? `MISSING ${r.content.missing} / HIDDEN ${r.content.hidden}${r.content.controlState ? ` / state ${r.content.controlState}` : ''}` : 'n/a';
    const units = r.units ? `off ${r.units.off} hidden ${r.units.hidden} missing ${r.units.missing}${r.unitsRequired ? '' : ' (advisory)'}` : '-';
    const verdictCell = r.error && r.pct == null ? `ERROR ${r.error}` : r.pass ? 'PASS' : r.pixelOnlyPass ? 'FAIL (elements)' : 'FAIL';
    rows.push(`| \`${r.path}\` | ${r.template ?? '-'} | ${r.tier ?? '-'} | ${r.origin || '-'}${r.origin === 'crawl-fullpage' ? ' ⚠asym' : ''} | ${r.browser || '-'} | ${cell(r.pct)}${r.textPct != null ? ` (${r.textPct})` : ''} | ${cell(r.heightDelta)} | ${cell(r.clipped)}${r.clipAllowance ? ` (allow ${r.clipAllowance})` : ''} | ${content} | ${units} | ${verdictCell}${r.masked ? ` (masked ${r.maskedRows} rows: ${r.maskReason})` : ''}${r.override && !r.pass ? ` → ${r.override.verdict}: ${r.override.reason}` : ''} | ${r.reasons.join('; ') || '-'} | ${r.reused ? `${r.reused.what} ${r.reused.at}` : '-'} |`);
  }
  return `${head.join('\n')}${rows.join('\n')}\n`;
}

// ---- pure: evidence reuse under --skip-existing (every reuse is recorded in the row) ---------------------
/** Canonical JSON: object keys sorted at every depth, so equality and hashes never depend on key order. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** What a page's probes were taken with — any change re-runs them. ctx = { opts, edsUrl, presence, unitsOf }. */
export function probeInputs(p, { opts, edsUrl, presence = {}, unitsOf }) {
  return { origin: p.url, eds: edsUrl(p), width: opts.width, warmup: opts.warmup ?? null, stage: opts.stage, content: opts.content, clip: opts.clip, presence: presence[p.slug] ?? null, units: unitsOf(p), unitTol: opts.unitTol };
}
const PROBE_AT = { content: (j) => j && j._provenance && j._provenance.at, clip: (j) => j && j.at, units: (j) => j && j._provenance && j._provenance.at };
/**
 * probeReuse({ sidecar, inputs, originMeta, edsMeta, files, opts }) → { reuse, at, why }. `sidecar` = <slug>/probes.json,
 * `files` = the probe JSONs on disk { content, clip, units }. Replays only under --skip-existing, without
 * --recapture-eds (and without --recapture-origin when a probe loads the origin), with the same inputs, every
 * enabled probe recorded ok and its JSON still the recorded one, and BOTH captures no newer than the probes —
 * the capture pair the probes were taken against is the pair on disk.
 */
export function probeReuse({ sidecar, inputs, originMeta, edsMeta, files = {}, opts }) {
  const no = (why) => ({ reuse: false, at: null, why });
  if (!opts.skip) return no('no --skip-existing');
  if (opts.recaptureEds) return no('--recapture-eds');
  if (opts.recaptureOrigin && (inputs.content || inputs.units.length)) return no('--recapture-origin');
  if (!sidecar || !sidecar.at) return no('no probes.json');
  if (canon(sidecar.inputs) !== canon(inputs)) return no('probe inputs changed');
  const kinds = ['content', 'clip', 'units'].filter((k) => (k === 'units' ? inputs.units.length : inputs[k]));
  if (!kinds.length) return no('nothing to probe');
  for (const k of kinds) {
    const res = sidecar.results && sidecar.results[k];
    if (res !== 'ok') return no(`${k} probe ${res || 'not run'}`);
    if (!PROBE_AT[k](files[k]) || PROBE_AT[k](files[k]) !== (sidecar.ats && sidecar.ats[k])) return no(`${k}.json is not the recorded one`);
  }
  for (const [side, m] of [['origin', originMeta], ['eds', edsMeta]]) {
    if (!m || m.error || !m.at) return no(`no ${side} capture`);
    if (!(sidecar.at >= m.at)) return no(`${side} captured after the probes`);
  }
  return { reuse: true, at: sidecar.at, why: null };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// EDS runtime dirs outside the frozen foundation that still change a render (decorated icons, plugins).
const RUNTIME_PATHS = ['icons/', 'plugins/'];
const FREEZE_WHY = 'foundation changed since freeze';
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const BLOCK_CLASS = /<div\s+class="\s*([^"\s]+)/gi;
// The DA document behind a delivered path — deploy/scripts/eds-path.mjs daPath, inlined (no cross-skill import).
const daPathOf = (pathname) => (pathname.endsWith('/') ? `${pathname}index` : pathname);
// EDS host-label form of a branch, repo or owner name: lower case, every run of other characters → '-'.
const hostLabel = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const filesUnder = (root, paths) => Object.entries(snapshot(root, paths)).filter(([, v]) => !String(v).startsWith('symlink:')).map(([f]) => f);
const blockFiles = (root, n) => snapshot(root, [`blocks/${n}/`]);
/** Block dirs a code file loads: `…/blocks/<name>/…`, a sibling `../<name>/…` from inside a block dir, `buildBlock('<name>'`. */
export function blockRefs(text, inBlockDir = false) {
  const out = new Set();
  for (const m of text.matchAll(/['"`](?:\.{0,2}\/)*blocks\/([a-z0-9][a-z0-9-]*)\//g)) out.add(m[1]);
  if (inBlockDir) for (const m of text.matchAll(/['"`(]\.\.\/([a-z0-9][a-z0-9-]*)\//g)) out.add(m[1]);
  for (const m of text.matchAll(/buildBlock\(\s*['"`]([a-z0-9][a-z0-9-]*)['"`]/g)) out.add(m[1]);
  return out;
}
// The named block dirs plus every block dir their JS / CSS loads, transitively.
function blockClosure(root, start) {
  const seen = new Set(); const queue = [...start];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n) || !NAME.test(n) || !existsSync(join(root, 'blocks', n))) continue;
    seen.add(n);
    for (const f of filesUnder(root, [`blocks/${n}/`])) if (/\.(m?js|css)$/.test(f)) queue.push(...blockRefs(readFileSync(join(root, f), 'utf8'), true));
  }
  return [...seen].sort();
}
/**
 * The shared blocks part (once per run, the same for every page): every blocks/<name>/ dir no content document
 * authors (`<div class>` anywhere under content/, or a coverage row) — auto-blocks, fragment loaders — plus every
 * block the foundation or runtime code loads (imports, `buildBlock`), with what those load. An edit there changes
 * every key (rare; errs safe). Authored blocks stay per page.
 */
export function sharedBlocks(root = '.', coverage = {}) {
  const dir = join(root, 'blocks');
  const all = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && NAME.test(d.name)).map((d) => d.name) : [];
  const authored = new Set(Object.values(coverage).flat());
  for (const f of filesUnder(root, ['content/'])) if (f.endsWith('.html')) for (const m of readFileSync(join(root, f), 'utf8').matchAll(BLOCK_CLASS)) authored.add(m[1]);
  const loaded = [];
  for (const f of filesUnder(root, [...FOUNDATION_PATHS, ...RUNTIME_PATHS])) if (/\.(m?js|css|html)$/.test(f)) loaded.push(...blockRefs(readFileSync(join(root, f), 'utf8'), f.startsWith('blocks/')));
  const names = blockClosure(root, [...all.filter((n) => !authored.has(n)), ...loaded]);
  return { hash: sha256(canon(Object.fromEntries(names.map((n) => [n, blockFiles(root, n)])))), names };
}
// The gate's instruments (this file, stitch-shot, pixel-compare, the diff probes) and every local module they load —
// a new verdict, probe or capture engine is a key change. A relative `.mjs` / `.js` string literal that resolves to a
// file counts as a load (static and dynamic imports, candidate lists such as stitch-shot's live-session paths).
export function instrumentFiles(roots) {
  const seen = new Set(); const queue = roots.filter((f) => existsSync(f)).map((f) => resolve(f));
  while (queue.length) {
    const f = queue.shift();
    if (!seen.has(f)) {
      seen.add(f);
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](\.{1,2}\/[^'"`\s]+\.m?js)['"`]/g)) { const dep = resolve(dirname(f), m[1]); if (existsSync(dep)) queue.push(dep); }
    }
  }
  return [...seen].sort();
}
let instrumentsMemo = null;
function instrumentsHash() {
  if (!instrumentsMemo) {
    const roots = [fileURLToPath(import.meta.url), STITCH, PIXEL, ...(DIFF_DIR ? ['content-presence.mjs', 'clip-probe.mjs', 'unit-geometry.mjs'].map((f) => join(DIFF_DIR, f)) : [])];
    instrumentsMemo = sha256(canon(Object.fromEntries(instrumentFiles(roots).map((f) => [relative(HERE, f).split(sep).join('/'), sha256(readFileSync(f))]))));
  }
  return instrumentsMemo;
}
/**
 * The foundation part of the gate key: the hash of the frozen paths' snapshot (= of the manifest's `files` while
 * `foundation-freeze check` passes; without a manifest, of the default foundation set). `why` = `foundation changed
 * since freeze` when the snapshot left the manifest (no key, but the parts still say what changed). `runtime` = the
 * hash of RUNTIME_PATHS; `paths` = the foundation paths the deploy-state guard diffs against the upstream branch.
 */
export function foundationPart(root = '.') {
  const manifest = join(root, FREEZE_MANIFEST); const runtime = sha256(canon(snapshot(root, RUNTIME_PATHS)));
  const m = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null;
  const paths = m && Array.isArray(m.paths) ? m.paths : FOUNDATION_PATHS;
  const now = canon(snapshot(root, paths.filter((x) => existsSync(join(root, x)))));
  return { hash: sha256(now), runtime, paths, why: m && now !== canon(m.files || {}) ? FREEZE_WHY : null };
}
/**
 * Chrome documents for every key (once per run): every nav*.html and footer*.html anywhere under content/ and every
 * document under a fragments/ dir at any depth — per-locale navs and fragments included (an edit to any re-gates every
 * page; errs safe). → { files: { path: sha256 }, names: block names they author }.
 */
export function chromeDocs(root = '.') {
  const files = {}; const names = new Set();
  for (const f of filesUnder(root, ['content/'])) {
    if (!f.endsWith('.html') || !(/^(nav|footer)/.test(basename(f)) || f.split('/').slice(1, -1).includes('fragments'))) continue;
    const buf = readFileSync(join(root, f)); files[f] = sha256(buf);
    for (const m of buf.toString('utf8').matchAll(BLOCK_CLASS)) names.add(m[1]);
  }
  return { files, names: [...names].sort() };
}
/**
 * gateKeyParts(p, ctx) → { parts, why }: what a published row's verdict depends on (parts null + why
 * only when the page's document is missing; a stale freeze gives parts + why). ctx = { root, opts, edsUrl, masks,
 * clipAllow, presence, unitsOf, foundation, coverage (slug → block names), shared, chrome, instruments }.
 * blocks: coverage/pages.json `blocks` ∪ the first class token of every `<div class>` in the page's document and the
 * chrome documents, with every block dir those load — each file hashed; shared: sharedBlocks(). content: the page's
 * content<daPath>.html + chromeDocs(). build: the EDS origin, the source URL, the width, the gate settings, the
 * page's sidecar entries (a mask or allowance edit is a key change) and the instruments' hash.
 */
export function gateKeyParts(p, { root = '.', opts, edsUrl = (x) => x.liveUrl, masks = {}, clipAllow = {}, presence = {}, unitsOf = () => [], foundation = foundationPart(root), coverage = {}, shared = sharedBlocks(root, coverage), chrome = chromeDocs(root), instruments = instrumentsHash() }) {
  const url = new URL(edsUrl(p)); const page = `content${daPathOf(url.pathname)}.html`;
  if (!existsSync(join(root, page))) return { parts: null, why: `no ${page}` };
  const buf = readFileSync(join(root, page));
  const named = new Set([...(coverage[p.slug] || []), ...chrome.names, ...[...buf.toString('utf8').matchAll(BLOCK_CLASS)].map((m) => m[1])]);
  const blocks = Object.fromEntries(blockClosure(root, named).map((n) => [n, blockFiles(root, n)]));
  const settings = { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, clip: opts.clip, content: opts.content };
  const sidecars = { masks: masks[p.slug] ?? null, clipAllow: clipAllow[p.slug] ?? null, presence: presence[p.slug] ?? null, units: unitsOf(p) };
  const parts = { v: 1, foundation: foundation.hash, runtime: foundation.runtime, shared: shared.hash, blocks, content: { [page]: sha256(buf), ...chrome.files }, build: { origin: url.origin, source: p.url, width: opts.width, settings, sidecars, instruments } };
  return { parts, why: foundation.why || null };
}
/** gateKeyOf(parts) → hex sha256 of the canonical (sorted-key) JSON of the parts (they carry `v`), or null. */
export const gateKeyOf = (parts) => (parts ? sha256(canon(parts)) : null);
/** An EDS host `<ref>--<repo>--<owner>.(aem|hlx).(page|live)` → { ref, repo, owner, tier }, else null. */
export function edsHostOf(host) {
  const m = /^([a-z0-9-]+?)--([a-z0-9-]+?)--([a-z0-9-]+)\.(?:aem|hlx)\.(page|live)$/i.exec(String(host || ''));
  return m ? { ref: m[1].toLowerCase(), repo: m[2].toLowerCase(), owner: m[3].toLowerCase(), tier: m[4].toLowerCase() } : null;
}
/**
 * Deploy-state guard, code half (one git call set per run, for every page): an upstream branch exists and NO file
 * under any hashed code path (git pathspecs, so a manifest entry without a trailing slash covers its whole dir)
 * differs from it — `git diff --no-renames @{u}` lists both sides of a rename and every deletion — and none is
 * untracked → { ok, why, upstream, branch, ref, owner, repo } (ref / owner / repo in EDS host-label form;
 * `upstream` = the upstream commit, recorded even when the key is unknown, so any push re-shoots unproven pages).
 */
export function codeDeployed(paths, root = '.') {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  const named = (l) => `${l.slice(0, 3).join(', ')}${l.length > 3 ? ` (+${l.length - 3})` : ''}`;
  let up; let upstream; let branch; let remoteUrl;
  try { [up] = git('rev-parse', '--abbrev-ref', '@{u}'); [upstream] = git('rev-parse', '@{u}'); } catch { return { ok: false, why: 'no upstream branch (git rev-parse @{u}) — the deployed code cannot be proven', upstream: null }; }
  try {
    const [head] = git('symbolic-ref', '--short', 'HEAD');
    branch = git('config', '--get', `branch.${head}.merge`)[0].replace(/^refs\/heads\//, '');
    [remoteUrl] = git('remote', 'get-url', git('config', '--get', `branch.${head}.remote`)[0]);
  } catch { return { ok: false, why: `cannot read the branch and remote behind ${up}`, upstream }; }
  try {
    const changed = git('diff', '--name-only', '--no-renames', '--relative', '@{u}', '--', ...paths);
    if (changed.length) return { ok: false, why: `code differs from ${up} (not pushed, so not deployed): ${named(changed)}`, upstream };
    const added = git('ls-files', '--others', '--exclude-standard', '--', ...paths);
    if (added.length) return { ok: false, why: `untracked code, not deployed: ${named(added)}`, upstream };
  } catch (e) { return { ok: false, why: `git: ${String(e.message).split('\n')[0]}`, upstream }; }
  const [owner, repo] = remoteUrl.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).slice(-2).map(hostLabel);
  return { ok: true, why: null, upstream, branch, ref: hostLabel(branch), owner, repo };
}
/** Deploy-state guard, per page: the gated host serves the pushed branch of the pushed repo → null, else why. */
export function hostServes(host, code) {
  const h = edsHostOf(host);
  if (!h) return `gated host ${host} is not an EDS <ref>--<repo>--<owner> host — what it serves cannot be proven`;
  if (h.ref !== code.ref) return `gated host serves ref ${h.ref}, the upstream branch is ${code.branch} (${code.ref})`;
  if (h.repo !== code.repo || h.owner !== code.owner) return `gated host serves ${h.owner}/${h.repo}, the upstream remote is ${code.owner}/${code.repo}`;
  return null;
}
/** webPath → { contentSha, status, verifiedOn, ts } of the newest row (by `ts`) across content/.deploy-ledger.json and stardust/deploy/ledger-*.json. */
export function deployedDocs(root = '.') {
  const dl = join(root, 'stardust/deploy');
  const files = [join(root, 'content/.deploy-ledger.json'), ...(existsSync(dl) ? readdirSync(dl).filter((f) => /^ledger-.*\.json$/.test(f)).map((f) => join(dl, f)) : [])];
  const newest = {};
  for (const f of files) {
    let ledger; try { ledger = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const [path, row] of Object.entries(ledger || {})) if (row && typeof row === 'object' && (!newest[path] || String(row.ts || '') > String(newest[path].ts || ''))) newest[path] = row;
  }
  return Object.fromEntries(Object.entries(newest).map(([path, row]) => [path, { contentSha: row.contentSha || null, status: row.status || null, verifiedOn: row.verifiedOn || null, ts: row.ts || null }]));
}
/**
 * Deploy-state guard, content half: every hashed document is the one the gated host serves — its newest ledger row
 * delivered (`live`; `previewed` too on a .page host) to the host's <owner>/<repo> (`verifiedOn`) with contentSha =
 * the file's sha256 → null, else why. A row without verifiedOn proves nothing.
 */
export function contentDeployed(content, docs, host = '') {
  const h = edsHostOf(host);
  if (!h) return `gated host ${host} is not an EDS <ref>--<repo>--<owner> host — the delivered documents cannot be proven`;
  const delivered = h.tier === 'page' ? ['live', 'previewed'] : ['live'];
  for (const [f, hash] of Object.entries(content)) {
    const web = f.replace(/^content/, '').replace(/\.html$/, ''); const row = docs[web];
    if (!row || !row.contentSha) return `${f}: no deploy-ledger contentSha for ${web}`;
    if (!delivered.includes(row.status)) return `${f}: the newest ledger row for ${web} is ${row.status}, not ${delivered.join(' / ')}`;
    if (!row.verifiedOn || row.verifiedOn.split('/').map(hostLabel).join('/') !== `${h.owner}/${h.repo}`) return `${f}: ledger ${web} was delivered to ${row.verifiedOn || 'an unrecorded org/repo (no verifiedOn)'}, not ${h.owner}/${h.repo}`;
    if (row.contentSha !== hash) return `${f} differs from the deployed document (ledger ${web})`;
  }
  return null;
}
/**
 * keyChanged(stored, current) — the stored EDS capture is NOT provably of what the gated host serves now, so it is
 * re-shot. `stored` = gate-key.json, `current` = this run's { gateKey, why, parts, upstream, deployed } (absent:
 * prototype stage, no keys → false). Reused only with the same known key, or — the key unknown now — the same hashed
 * tree (parts), the same reason it is unknown, the same upstream commit (any push re-shoots) and the same
 * deploy-ledger rows for the page's documents. No record
 * (a legacy dir) proves nothing → re-shot.
 */
export function keyChanged(stored, current) {
  if (!current) return false;
  if (!stored) return true;
  if (current.gateKey) return stored.gateKey !== current.gateKey;
  const same = stored.parts && current.parts && canon(stored.parts) === canon(current.parts) && stored.why === current.why && (stored.upstream ?? null) === (current.upstream ?? null) && canon(stored.deployed ?? null) === canon(current.deployed ?? null);
  return !same;
}
/** --skip-existing reuse of one side's capture: on disk, not that side's --recapture-*, for EDS not a changed key. ctx = { opts, has(p, side), keyChanged(p) }. */
export function skipCapture(p, side, { opts, has, keyChanged: changed }) {
  return !!opts.skip && !opts[side === 'eds' ? 'recaptureEds' : 'recaptureOrigin'] && !(side === 'eds' && changed(p)) && has(p, side);
}
/**
 * rowKey(stored, current, probedFresh) — the key a FRESH row is stamped with: its evidence's stored key only while it
 * is the current key; with the current key unknown, only when the row was measured under the same build part
 * (host, criteria, sidecars, instruments) and no probe ran afresh against the unproven deploy. Otherwise null.
 */
export function rowKey(stored, current, probedFresh = false) {
  if (!stored || !stored.gateKey || !current) return null;
  if (current.gateKey) return stored.gateKey === current.gateKey ? stored.gateKey : null;
  const same = stored.parts && current.parts && canon(stored.parts.build) === canon(current.parts.build);
  return same && !probedFresh ? stored.gateKey : null;
}
/** Latest row per slug (by _provenance.writtenAt) across <out>/summary.json and <out>/runs/*.json at this width → { slug: { row, from, at, prov } }. */
export function latestRows(out, width) {
  const runs = join(out, 'runs');
  const files = ['summary.json', ...(existsSync(runs) ? readdirSync(runs).filter((f) => f.endsWith('.json')).sort().map((f) => `runs/${f}`) : [])];
  const latest = {};
  for (const f of files) {
    let s; try { s = JSON.parse(readFileSync(join(out, f), 'utf8')); } catch { continue; }
    const at = s && s._provenance && s._provenance.writtenAt;
    if (!at || s._provenance.breakpoint !== width || !Array.isArray(s.rows)) continue;
    for (const row of s.rows) if (row && row.slug && (!latest[row.slug] || at > latest[row.slug].at)) latest[row.slug] = { row, from: f, at, prov: s._provenance };
  }
  return latest;
}
// The table's own record of what it evaluated equals this run's criteria (the key carries them too; this is the table's word).
const sameCriteria = (prov, opts) => !!prov && prov.stage === 'published' && prov.threshold === opts.threshold && prov.heightTolerance === opts.heightTol && prov.clipMax === opts.clipMax && prov.unitTol === opts.unitTol && !!prov.criteria && prov.criteria.clip === opts.clip && prov.criteria.content === opts.content;
/**
 * rowReuse({ prior, gateKey, edsPng, override, opts }) → the prior row again, marked `reused`, or null. Only under
 * --skip-existing on the published stage without --recapture-*, with a known current key equal to the row's, a
 * PASS (not an override) from a table written under this run's criteria and the page's eds.png on disk. `at` stays
 * the time the row was measured.
 */
export function rowReuse({ prior, gateKey, edsPng, override = null, opts }) {
  if (!opts.skip || opts.stage !== 'published' || opts.recaptureEds || opts.recaptureOrigin || !gateKey || !prior || !edsPng) return null;
  const { row } = prior;
  if (row.gateKey !== gateKey || row.pass !== true || !sameCriteria(prior.prov, opts)) return null;
  const at = row.reused && row.reused.what === 'row' ? row.reused.at : prior.at;
  return { ...row, override, passWithOverride: row.pass || !!override, reused: { what: 'row', from: prior.from, at, gateKey } };
}

// ---- runner ---------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const firstExisting = (cands) => cands.map((p) => resolve(HERE, p)).find((p) => existsSync(p));
const STITCH = join(HERE, 'stitch-shot.mjs');
const PIXEL = join(HERE, 'pixel-compare.mjs');
const DIFF_DIR = firstExisting(['../../diff/scripts', '../diff']);
const { unitsFor } = DIFF_DIR ? await import(pathToFileURL(join(DIFF_DIR, 'unit-geometry.mjs')).href) : { unitsFor: () => [] };
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
  const runStart = new Date().toISOString();
  if (!existsSync(opts.state)) { console.error(`gate-all: ${opts.state} not found — run from the project root or pass --state`); process.exit(1); }
  if ((opts.clip || opts.content) && !DIFF_DIR) { console.error('gate-all: the diff skill\'s scripts dir was not found next to this one (../../diff/scripts or ../diff) — copy it (replica SKILL.md § Setup) or pass --no-probes'); process.exit(1); }
  const state = readJson(opts.state);
  let pages = opts.stage === 'prototype'
    ? (state.pages || []).filter((p) => p.prototypePath && p.url).map((p) => ({ ...p, liveUrl: `${opts.protoBase || 'http://localhost:8791'}/${basename(p.prototypePath)}` }))
    : (state.pages || []).filter((p) => p.status === 'deployed' && p.liveUrl && p.url);
  if (opts.stage === 'prototype' && !opts.protoBase) console.error('gate-all: --stage prototype without --proto-base — assuming http://localhost:8791 (serve the prototypes dir there, replica SKILL.md § Phase 4)');
  if (opts.only) pages = pages.filter((p) => opts.only.includes(p.slug));
  if (!pages.length) { console.error('gate-all: no deployed pages selected'); process.exit(1); }
  mkdirSync(opts.out, { recursive: true });
  const MASKS = readJson(join(opts.out, 'masks.json'), {}); const OVERRIDES = readJson(join(opts.out, 'overrides.json'), {});
  const CLIP_ALLOW = readJson(join(opts.out, 'clip-allow.json'), {}); const PRESENCE = readJson(join(opts.out, 'presence.json'), {});
  const FAMILIES = readJson('stardust/replica/units.json', null);
  const UNITS = readJson(opts.units || join(opts.out, 'units.json'), {});
  const unitsOf = (p) => (FAMILIES ? unitsFor(FAMILIES, p.slug, p.template) : ((UNITS[p.slug] || {}).units || []).map((x) => ({ origin: x.origin, eds: x.eds || x.origin, n: x.n || 1, required: x.required !== false })));
  const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); writeFileSync(join(opts.out, '_run.log'), `${line}\n`, { flag: 'a' }); };
  const dir = (p) => join(opts.out, p.slug);
  const edsUrl = (p) => (opts.edsHost ? p.liveUrl.replace(/^https?:\/\/[^/]+/, opts.edsHost) : p.liveUrl);
  const results = {};
  const rec = (p, k, v) => { results[p.slug] = { ...(results[p.slug] || {}), [k]: v }; };
  const stitchArgs = (url, out) => [STITCH, url, out, '--width', String(opts.width), '--settle', '--locale', 'en-US', ...(opts.vh ? ['--vh', String(opts.vh)] : [])];

  async function captureOrigin(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const out = join(d, 'origin.png'); const meta = join(d, 'origin.json');
    if (skipCapture(p, 'origin', capCtx)) { rec(p, 'origin', readJson(meta)); return; }
    const crawlShot = join(opts.crawlShots, `${p.slug}.png`);
    const cachedLive = join('stardust/replica/gates', `${p.slug}-${opts.width}`, 'live.png');
    let r;
    if (opts.stage === 'prototype' && existsSync(cachedLive)) { copyFileSync(cachedLive, out); r = { instrument: 'stitch-live', note: `reused ${cachedLive} (the archetype round's capture — hit minimisation)` }; }
    else if (opts.blocked && opts.blocked.test(p.url) && !opts.tryBlocked) {
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
    if (skipCapture(p, 'eds', capCtx)) { rec(p, 'eds', readJson(meta)); return; }
    const s = await run('node', stitchArgs(edsUrl(p), out));
    const r = s.code === 0 ? { instrument: 'stitch-live', url: edsUrl(p) } : { instrument: 'none', url: edsUrl(p), error: `stitch exit ${s.code}: ${lastLine(s.err)}` };
    r.at = new Date().toISOString(); writeFileSync(meta, JSON.stringify(r, null, 2)); rec(p, 'eds', r);
    log(`eds ${p.slug} → ${r.instrument}${r.error ? ` ERROR ${r.error}` : ''}`);
  }
  const readSafe = (f) => { try { return readJson(f); } catch { return null; } };
  const probeCtx = { opts, edsUrl, presence: PRESENCE, unitsOf };
  // Gate keys (published stage), once per run before any capture; the deploy-state guard's code half is one git call set.
  const KEYS = {};
  if (opts.stage === 'published') {
    let foundation; let shared; let chrome; let broken = null;
    try { foundation = foundationPart('.'); } catch (e) { foundation = { paths: FOUNDATION_PATHS }; broken = `foundation: ${e.message}`; }
    const codePaths = [...foundation.paths, ...RUNTIME_PATHS, 'blocks/'];
    const code = codeDeployed(codePaths); const docs = deployedDocs('.');
    const coverage = Object.fromEntries(((readSafe('stardust/rollout/coverage/pages.json') || {}).pages || []).filter((x) => x && x.slug && Array.isArray(x.blocks)).map((x) => [x.slug, x.blocks]));
    try { shared = sharedBlocks('.', coverage); chrome = chromeDocs('.'); } catch (e) { broken = broken || `blocks / chrome documents: ${e.message}`; }
    for (const p of pages) {
      let k = { parts: null, why: broken };
      if (!broken) try { k = gateKeyParts(p, { ...probeCtx, masks: MASKS, clipAllow: CLIP_ALLOW, foundation, coverage, shared, chrome }); } catch (e) { k = { parts: null, why: `gate key: ${e.message}` }; }
      const host = k.parts && new URL(k.parts.build.origin).host;
      const why = k.why || code.why || hostServes(host, code) || contentDeployed(k.parts.content, docs, host);
      const deployed = k.parts ? Object.fromEntries(Object.keys(k.parts.content).map((f) => { const web = f.replace(/^content/, '').replace(/\.html$/, ''); return [web, docs[web] || null]; })) : null;
      KEYS[p.slug] = { gateKey: why ? null : gateKeyOf(k.parts), why, parts: k.parts, upstream: code.upstream || null, deployed };
    }
    const na = pages.filter((p) => !KEYS[p.slug].gateKey);
    if (na.length) log(`gate key n/a for ${na.length}/${pages.length} page(s) — ${[...new Set(na.map((p) => KEYS[p.slug].why))].slice(0, 3).join('; ')} (no row reuse; their EDS side is re-shot unless gate-key.json records the same tree, reason, upstream commit and ledger rows)`);
  }
  const storedKey = (p) => readSafe(join(dir(p), 'gate-key.json'));
  const currentKey = (p) => (KEYS[p.slug] ? KEYS[p.slug].gateKey : null);
  const capCtx = { opts, has: (p, side) => existsSync(join(dir(p), `${side}.png`)) && existsSync(join(dir(p), `${side}.json`)), keyChanged: (p) => keyChanged(storedKey(p), KEYS[p.slug]) };
  // The post-spawn record of each probe, shared by the fresh and the replayed path so both build the same row.
  function recordContent(p, content, pr) {
    const d = dir(p);
    rec(p, 'content', { totals: content.totals, scope: content.scope, variable: pr.variable || [], reason: pr.reason || null, tier: content._provenance.tier || null });
    rec(p, 'clip', { counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: content.origin.clip.counts, source: 'content-presence' });
    writeFileSync(join(d, 'clip.json'), JSON.stringify({ url: edsUrl(p), at: content._provenance.at, source: 'content-presence', counts: content.eds.clip.counts, groups: content.eds.clip.groups, origin: { counts: content.origin.clip.counts } }, null, 1));
    if (content.textBoxes && content.textBoxes.origin) writeFileSync(join(d, 'text-boxes.json'), JSON.stringify({ side: 'origin', boxes: content.textBoxes.origin }));
    log(`content ${p.slug} → MISSING ${content.totals.missing} HIDDEN ${content.totals.hidden} state ${content.totals.controlState}; clipped ${content.eds.clip.counts.total}`);
  }
  function recordClip(p, clip) { rec(p, 'clip', { counts: clip.counts, groups: clip.groups, source: 'clip-probe', tier: clip.tier || null }); log(`clip ${p.slug} → ${clip.counts.total}`); }
  function recordUnits(p, res, required) { rec(p, 'units', { verdict: res.verdict, required }); log(`units ${p.slug} → off ${res.verdict.off} hidden ${res.verdict.hidden} missing ${res.verdict.missing}`); }
  async function probe(p) {
    const d = dir(p); mkdirSync(d, { recursive: true });
    const pr = PRESENCE[p.slug] || {};
    const inputs = probeInputs(p, probeCtx); const { units } = inputs;
    if (opts.skip) {
      const files = { content: readSafe(join(d, 'content.json')), clip: readSafe(join(d, 'clip.json')), units: readSafe(join(d, 'units.json')) };
      const originMeta = readSafe(join(d, 'origin.json')); const edsMeta = readSafe(join(d, 'eds.json'));
      const reuse = probeReuse({ sidecar: readSafe(join(d, 'probes.json')), inputs, originMeta, edsMeta, files, opts });
      if (reuse.reuse) {
        if (inputs.content) recordContent(p, files.content, pr);
        if (inputs.clip && !(results[p.slug] && results[p.slug].clip)) recordClip(p, files.clip);
        if (units.length) recordUnits(p, files.units, units.some((x) => x.required));
        rec(p, 'probesReused', reuse.at);
        log(`probes ${p.slug} → reused (taken ${reuse.at}; origin ${originMeta.at}, eds ${edsMeta.at})`);
        return;
      }
    }
    const at = new Date().toISOString();
    if (opts.content) {
      const args = [join(DIFF_DIR, 'content-presence.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--json', join(d, 'content.json')];
      if (pr.variable && pr.variable.length) args.push('--variable', pr.variable.join(','));
      if (pr.main) args.push('--main', pr.main);
      if (opts.warmup) args.push('--warmup', opts.warmup);
      const s = await run('node', args);
      const content = readJson(join(d, 'content.json'));
      if (content && (s.code === 0 || s.code === 2)) recordContent(p, content, pr);
      else {
        const why = s.code === 3 ? 'origin bot challenge' : s.code === 4 ? `origin ${lastLine(s.err).replace(/^content-presence error: /, '')}` : `content-presence exit ${s.code}: ${lastLine(s.err)}`;
        rec(p, 'content', { error: why });
        log(`content ${p.slug} → n/a (${why})`);
      }
    }
    if (opts.clip && !(results[p.slug] && results[p.slug].clip)) {
      const s = await run('node', [join(DIFF_DIR, 'clip-probe.mjs'), edsUrl(p), '--width', String(opts.width), '--json', join(d, 'clip.json')]);
      const clip = readJson(join(d, 'clip.json'));
      if (clip && (s.code === 0 || s.code === 2)) recordClip(p, clip);
      else { rec(p, 'clip', { error: `clip-probe exit ${s.code}: ${lastLine(s.err)}` }); log(`clip ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    if (units.length) {
      const args = [join(DIFF_DIR, 'unit-geometry.mjs'), p.url, edsUrl(p), '--width', String(opts.width), '--tol', String(opts.unitTol), '--n', String(Math.max(...units.map((x) => x.n))), '--json', join(d, 'units.json'), '--slug', p.slug];
      for (const x of units) args.push('--unit', `${x.origin}=${x.eds}`);
      if (opts.warmup) args.push('--warmup', opts.warmup);
      const s = await run('node', args);
      const res = readJson(join(d, 'units.json'));
      const required = units.some((x) => x.required);
      if (res && (s.code === 0 || s.code === 2)) recordUnits(p, res, required);
      else { rec(p, 'units', { error: `unit-geometry exit ${s.code}: ${lastLine(s.err)}`, required }); log(`units ${p.slug} → ERROR ${lastLine(s.err)}`); }
    }
    // probes.json: what these probes were taken with and when — the replay record for the next --skip-existing run.
    const r = results[p.slug] || {}; const state = (x) => (x ? (x.error ? 'error' : 'ok') : null);
    const done = { content: state(r.content), clip: state(r.clip), units: state(r.units) };
    const ats = Object.fromEntries(Object.keys(done).map((k) => [k, done[k] === 'ok' ? PROBE_AT[k](readSafe(join(d, `${k}.json`))) || null : null]));
    writeFileSync(join(d, 'probes.json'), JSON.stringify({ at, inputs, results: done, ats }, null, 1));
    if (Object.values(done).some(Boolean)) rec(p, 'probedAt', at);
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

  // A PASS row whose gate key holds is reused whole: the page leaves all three pools.
  const REUSED = {};
  const prior = opts.skip && opts.stage === 'published' ? latestRows(opts.out, opts.width) : {};
  for (const p of pages) {
    const row = rowReuse({ prior: prior[p.slug], gateKey: currentKey(p), edsPng: existsSync(join(dir(p), 'eds.png')), override: OVERRIDES[p.slug] ?? null, opts });
    if (row) { REUSED[p.slug] = row; log(`row ${p.slug} → reused (gate key ${row.gateKey.slice(0, 12)} unchanged; measured ${row.reused.at}, ${row.reused.from})`); }
  }
  const todo = pages.filter((p) => !REUSED[p.slug]);
  if (!opts.compareOnly) {
    await Promise.all([pool(todo, opts.oc, captureOrigin), pool(todo, opts.ec, captureEds)]);
    // gate-key.json = the key of the EDS capture taken in this run (null while unknown or when the capture failed).
    for (const p of todo) {
      const k = KEYS[p.slug]; const m = readSafe(join(dir(p), 'eds.json'));
      if (k && m && m.at >= runStart) writeFileSync(join(dir(p), 'gate-key.json'), JSON.stringify({ gateKey: m.error ? null : k.gateKey, why: m.error ? `EDS capture failed: ${m.error}` : k.why, parts: k.parts, upstream: k.upstream, deployed: k.deployed, at: m.at }, null, 1));
    }
  } else for (const p of todo) for (const side of ['origin', 'eds']) { const m = readJson(join(dir(p), `${side}.json`)); if (m) rec(p, side, m); }
  if (opts.clip || opts.content || FAMILIES || Object.keys(UNITS).length) await pool(todo, opts.pc, probe);
  await pool(todo, 4, compare);

  const rows = pages.map((p) => {
    if (REUSED[p.slug]) return REUSED[p.slug];
    const r = results[p.slug] || {}; const px = r.pixel || {};
    const v = verdict({ pixel: px, clip: r.clip && r.clip.counts ? r.clip : null, content: r.content || null, units: r.units || null, override: OVERRIDES[p.slug] || null, allowance: (CLIP_ALLOW[p.slug] || {}).max || 0 }, { threshold: opts.threshold, heightTol: opts.heightTol, clipMax: opts.clipMax, clipOn: opts.clip, contentOn: opts.content });
    return { slug: p.slug, path: p.deployedPath || new URL(p.liveUrl).pathname, template: p.template, tier: p.fidelityTier, origin: r.origin && r.origin.instrument, originAsymmetric: !!(r.origin && r.origin.asymmetric), eds: r.eds && r.eds.instrument,
      pct: px.pct ?? null, textPct: px.textPct ?? null, heightDelta: px.heightDelta ?? null, ...v,
      clipGroups: r.clip && r.clip.groups ? r.clip.groups.filter((g) => !g.advisory).slice(0, 6) : [], clipAllowReason: (CLIP_ALLOW[p.slug] || {}).reason || null,
      content: r.content && r.content.totals ? { missing: r.content.totals.missing, hidden: r.content.totals.hidden, controlState: r.content.totals.controlState, missingButtons: r.content.totals.missingButtons, hiddenButtons: r.content.totals.hiddenButtons, findings: r.content.totals.findings, scope: r.content.scope, variable: r.content.variable } : null,
      units: r.units && r.units.verdict ? r.units.verdict : null, unitsRequired: !!(r.units && r.units.required), unitsError: (r.units && r.units.error) || null,
      browser: (r.content && r.content.tier) || (r.clip && r.clip.tier) || null,
      override: OVERRIDES[p.slug] || null, masked: !!px.maskedRows, maskedRows: px.maskedRows || 0, maskReason: px.maskReason || null,
      hotBands: (px.bands || []).filter((b) => b.pct > 15).map((b) => `${b.y0}-${b.y1}:${b.pct}%`), error: px.error || (r.origin && r.origin.error) || (r.eds && r.eds.error) || null,
      gateKey: opts.stage === 'published' ? rowKey(storedKey(p), KEYS[p.slug], !!r.probedAt) : null, reused: r.probesReused ? { what: 'probes', at: r.probesReused } : null };
  });
  const n = (f) => rows.filter(f).length;
  const totals = { pages: rows.length, pass: n((r) => r.pass), pixelOnlyPass: n((r) => r.pixelOnlyPass), overridePass: n((r) => !r.pass && r.override), fail: n((r) => !r.pass && r.pct != null), error: n((r) => r.pct == null),
    failPixel: n((r) => r.pct != null && !r.pixelPass), failHeight: n((r) => r.pct != null && !r.heightPass), failClip: n((r) => r.clipPass === false), failContent: n((r) => r.contentPass === false), failUnits: n((r) => r.unitPass === false), contentNA: n((r) => r.contentNA), asymmetricOrigins: n((r) => r.originAsymmetric), degradedTier: n((r) => r.browser && r.browser !== 'chrome'),
    reusedRows: n((r) => r.reused && r.reused.what === 'row'), reusedProbes: n((r) => r.reused && r.reused.what === 'probes') };
  totals.passWithOverrides = totals.pass + totals.overridePass;
  const originHost = (() => { try { return new URL(pages[0].url).origin; } catch { return null; } })();
  const summary = { _provenance: { writtenBy: 'gate-all.mjs', writtenAt: new Date().toISOString(), stage: opts.stage, breakpoint: opts.width, threshold: opts.threshold, heightTolerance: opts.heightTol, clipMax: opts.clipMax, unitTol: opts.unitTol, criteria: { pixel: true, height: true, clip: opts.clip, content: opts.content }, verdict: `overlap pixel % ≤ ${opts.threshold} AND |Δh| ≤ ${Math.round(opts.heightTol * 100)}% of origin height${opts.clip ? ` AND clipped ≤ ${opts.clipMax} (+ documented allowance)` : ''}${opts.content ? ' AND content MISSING + HIDDEN links/headings = 0' : ''}`, origin: originHost, eds: opts.edsHost || (() => { try { return new URL(pages[0].liveUrl).origin; } catch { return null; } })(), edsHostOverride: opts.edsHost || null, only: opts.only, reuse: { rows: totals.reusedRows, probes: totals.reusedProbes } }, totals, rows };
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
