#!/usr/bin/env node
// skills/reskin/scripts/figma-gate.mjs — Figma checks on a reskin page. One CLI, steps in ./figma-gate/,
// the Figma capture helpers of figma-donor.mjs in ./figma/:
//   boxes  the Figma box trees of the included modules, built once from the cached capture
//          (.work/reskin/figma/, never the network) and cached in .work/reskin/gates/figma-boxes/.
//   join   B0: every mapping.md slot that renders as a module is one section of the page, in order, with
//          its module's Figma frame; a page that drifted from the mapping stops here.
//   geometry  B1: the sizes, offsets, gaps and paddings the checks file pairs with Figma nodes or tokens.
//   ramp   B3: the :root token block and the type of every Type entry, through donor-probe.mjs.
//   pixel  B2: advisory pixel share of each section against its slice of the frame image, where the
//          frame's copy is the page's copy (replica's pixel-compare.mjs).
// Writes go only under <dir>/.work/reskin/gates/. Under a sticky --confidential capture, every
// subcommand first checks that .work/ and reskin/figma-checks/ are git-ignored.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 pass · 1 a blocking check failed · 2 usage or setup · 3 bot challenge on a live target
// · 124 no verdict (a step crashed or timed out: re-run, never a fix iteration).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export const HELP = `Usage:
  node figma-gate.mjs boxes [--module Mn | --node <id>] [--depth 3] [--dir stardust]
  node figma-gate.mjs join --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs geometry --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs ramp --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs pixel --page <slug> --url <url|file> [--dir stardust]

Figma checks on a reskin page, against the capture figma-donor.mjs made (offline: no token, no network).

boxes    the Figma box trees of the modules curation-rules.json includes. Reads the current capture's
         nodes.json once per file version and caches one tree per root under
         <dir>/.work/reskin/gates/figma-boxes/<file-key>/<version>.json; later runs are answered from
         that cache, even after nodes.json is gone. A box is { id, name, type, x, y, w, h, layout,
         text, fill, fillKind, children }: x and y are relative to the root, layout is
         { mode, padding [t, r, b, l], gap } on an auto-layout frame, hidden layers are dropped.
         --module Mn   print that module's outline (id, type, name, x,y, w×h, layout, text)
         --node <id>   print the outline of any captured node id, nested I…;… ids included
         --depth <n>   outline depth, 0 = the root only (default 3)
         neither       build the cache for every included module and print "<Mn> <frame id> <w>×<h>"
join     B0, the section join. Opens the page (a file path, a file: or localhost URL, or an http(s) URL) in
         plain Chromium at 1440 and reads its main section[data-slot] elements in document order. Every
         mapping.md row that renders (status mapped or new-module) must be exactly one top-level section, in
         the table's order, whose data-module is the row's Donor module and whose text holds the slot's first
         heading (content-model.json); a Donor module must be included in curation-rules.json. Chrome and
         carried-invisible rows need no section. Each problem starts "section drift:". Writes
         <dir>/.work/reskin/gates/<slug>/figma/join.json (each section's slot, module, Figma frame, selector
         and document index), prints one PASS or FAIL line and exits 1 on drift.
geometry B1. Runs the join first (drift stops here, exit 1), validates the checks file, then measures every
         geometry entry on the page (one page load per width) against the same measure taken from its Figma
         node (relative to the module root) or its token: width, height, left, right, top, gapX, gapY and
         the paddings, within tolerancePx (default 1: measure-live rounds to whole px, Figma has half pixels).
         Prints "geometry PASS n/n" or "geometry FAIL k/n" plus one indented line per failing entry
         ("<slot> <id> <measure> (node <id>): 540 vs 560 (±1)", or "unmeasurable: <why>" when the selector
         matched nothing, a gap has fewer than two matches or the box has no size); writes
         <dir>/.work/reskin/gates/<slug>/figma/geometry.json; exit 1 on any FAIL.
ramp     B3. Runs the join first (drift stops here, exit 1), validates the checks file, then asserts through
         donor-probe.mjs (one run per width, no overflow sanity): the :root block that donor-tokens.json
         yields (every custom property verbatim, at the first section's width) and, for every type entry,
         six computed styles of the section's selector against the Figma text node: fontSize, fontWeight,
         lineHeight and letterSpacing in px (the last two within 0.1px), fontFamily (first family) and
         color; the rules' weightMap and familyEquivalence apply to the Figma side. Prints "ramp PASS n/n"
         or "ramp FAIL k/n" plus one indented line per failing entry ("<slot> <id> <property> (node <id>):
         16px vs 14px", ":root <name>: ..." for a custom property); writes ramp-spec.<w>.json, ramp.<w>.md,
         ramp.<w>.json and ramp.json under <dir>/.work/reskin/gates/<slug>/figma/; exit 1 on any FAIL.
         A property the Figma node gives no value for (no font size, a fill that is not one visible solid
         color, ...) is recorded as UNASSERTED in ramp.json, never failed: the verdict reads "ramp PASS n/n
         (k unasserted)" with one indented "advisory" line per property.
         Token values written as literals outside :root (a color that equals a :root value) are listed in
         one "advisory" line and never change the exit code. A probe that cannot run is exit 124.
pixel    B2, advisory. Runs the join first (drift stops here, exit 1), validates the checks file, then for
         every section crops its slice out of the cached frame image (the PNG figma-donor.mjs captured,
         taken at 1×: any other size is n/a) and compares it with an element screenshot of the section
         at its width through replica's pixel-compare.mjs (a = Figma slice, b = page; the number never
         fails). Only where the frame's copy is the section's copy (visible text, whitespace and case
         ignored): otherwise the section is "n/a: frame content differs". Also n/a: no frame image
         (re-run figma-donor.mjs capture), a PNG of another size, pixel mode off (needs why). Mode
         fixture screenshots the same selector on fixtureUrl instead of the page (a hand-made stand-in).
         Prints "pixel advisory", the uncalibrated reference classes (light text 3%, inverted 3.5%,
         raster ground 4%: orientation, not a bar) and one line per section: "<slot> 0.42% (text 1.10%,
         Δh 0)" (differing pixels overall and over the frame's text boxes, height delta Figma − page)
         or "<slot> n/a: <why>"; an indented line names each font the section uses that the page's
         font set does not serve. Writes <slot>.figma.png, <slot>.page.png, <slot>.diff.png,
         <slot>.text-boxes.json and pixel.json under <dir>/.work/reskin/gates/<slug>/figma/. Exit 0,
         or 124 when a comparison hit its deadline (no verdict: re-run).
--dir <d>  the stardust directory (default stardust).

Checks file <dir>/reskin/figma-checks/<slug>.json (written by the agent from the boxes outlines):
  { "version": 1, "page": "<slug>", "sections": { "<slot>": {
      "node"?: "<id>"                    the section root, default the join's module frame
      "width"?: 1440                     default the root's width
      "roots"?: { "<width>": "<id>" }    another capture of the module, for entries with that width
      "skip"?: "<why>"                   replaces the required geometry and type entries
      "geometry": [ { id, selector, measure, node | nodes: [a, b] | token, index?: 0, width?, tolerancePx?: 1, why? } ],
      "type": [ { id, selector, node, width? } ],
      "pixel"?: { "mode": "auto" | "fixture" | "off", "fixtureUrl"?, "why"? } } } }
  selector is scoped to the section, ":scope" is the section itself; ids are g1.. and t1.. per section.
  measure: width left right top height gapX gapY paddingTop paddingRight paddingBottom paddingLeft.
  gapX and gapY take exactly two nodes; token is a path in donor-tokens.json holding one px value.
  top and height are content-dependent: they need tolerancePx and why. tolerancePx above 1 needs why.
  A padding measure needs an auto-layout node; a type node must be TEXT; every node sits inside the root
  of its width. fixture needs fixtureUrl, off needs why. Every problem is listed at once (exit 2).
Writes go only under <dir>/.work/reskin/gates/. After a capture --confidential, every subcommand first
asserts that <dir>/.work/ and <dir>/reskin/figma-checks/ are git-ignored (exit 2 with the lines to add).
Exit codes: 0 pass · 1 a blocking check failed · 2 usage or setup (missing input or capture)
            · 3 bot challenge on a live target · 124 no verdict: a step crashed or timed out, re-run.`;

const SPEC = {
  boxes: { values: ['--module', '--node', '--depth', '--dir'], bools: [], positional: [] },
  join: { values: ['--page', '--url', '--dir'], bools: [], positional: [] },
  geometry: { values: ['--page', '--url', '--dir'], bools: [], positional: [] },
  ramp: { values: ['--page', '--url', '--dir'], bools: [], positional: [] },
  pixel: { values: ['--page', '--url', '--dir'], bools: [], positional: [] },
};

export function parseArgs(argv, UsageError) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError(`no command\n${HELP}`);
  const spec = SPEC[cmd];
  if (!spec) throw new UsageError(`unknown command "${cmd}"\n${HELP}`);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (spec.values.includes(a)) {
      const val = rest[i + 1];
      if (val === undefined || val.startsWith('--')) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = val;
      i += 1;
    } else if (spec.bools.includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown flag ${a} for ${cmd}`);
    else positional.push(a);
  }
  if (positional.length < spec.positional.length) throw new UsageError(`${cmd} needs ${spec.positional.join(' ')}`);
  if (positional.length > spec.positional.length) throw new UsageError(`unexpected argument "${positional[spec.positional.length]}"`);
  return { cmd, positional, opts };
}

// A partial copy of the scripts is a setup error with the fix, not a module stack trace.
async function helper(name, sub = 'figma-gate') {
  try { return await import(`./${sub}/${name}.mjs`); } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes(`${sub}/${name}.mjs`)) throw e;
    const err = new Error(`the ${sub}/ helpers are missing beside figma-gate.mjs: copy the reskin scripts recursively (cp -R <plugin>/skills/reskin/scripts/. stardust/scripts/reskin/)`);
    err.code = 2;
    throw err;
  }
}

async function boxesStep({ dir, opts, log, UsageError }) {
  const [{ loadBoxes, outline }, { readInputs, includedModules }] = await Promise.all([helper('boxes'), helper('io')]);
  const depth = opts.depth === undefined ? 3 : Number(opts.depth);
  if (!Number.isInteger(depth) || depth < 0) throw new UsageError(`--depth must be a non-negative integer, got "${opts.depth}"`);
  if (opts.module && opts.node) throw new UsageError('--module and --node are alternatives: pass one');

  if (opts.node) {
    const { roots, missing } = loadBoxes(dir, [opts.node]);
    if (missing.length) throw new UsageError(`node ${opts.node} is not in the capture: capture its frame with figma-donor.mjs capture <figma-url> --frames <ids>`);
    for (const line of outline(roots[opts.node].box, depth)) log(line);
    return 0;
  }

  const modules = includedModules(readInputs(dir, null, ['rules']).rules);
  if (opts.module) {
    const id = modules.get(opts.module);
    if (!id) throw new UsageError(`no included module ${opts.module} in ${dir}/reskin/curation-rules.json (included: ${[...modules.keys()].join(', ') || 'none'})`);
    const { roots, missing } = loadBoxes(dir, [id]);
    if (missing.length) throw new UsageError(`${opts.module} (${id}) is not in the capture: capture its frame with figma-donor.mjs capture <figma-url> --frames <ids>`);
    for (const line of outline(roots[id].box, depth)) log(line);
    return 0;
  }

  const { roots, missing } = loadBoxes(dir, [...modules.values()]);
  if (missing.length) {
    const lost = [...modules].filter(([, f]) => missing.includes(f)).map(([m, f]) => `${m} (${f})`);
    throw new UsageError(`included module frame(s) not in the capture: ${lost.join(', ')}: capture them with figma-donor.mjs capture <figma-url> --frames <ids>`);
  }
  for (const [m, f] of modules) log(`${m} ${f} ${roots[f].box.w}×${roots[f].box.h}`);
  return 0;
}

function logDrift(result, log) {
  log(`FAIL join: ${result.problems.length} problem(s), the page drifted from mapping.md`);
  for (const p of result.problems) log(`  ${p}`);
}

async function joinStep({ dir, opts, log, UsageError }) {
  if (!opts.page) throw new UsageError('join needs --page <slug>');
  if (!opts.url) throw new UsageError('join needs --url <url|file>: the page to join');
  const [{ readInputs, workDir }, { runJoin }, { localTarget }] = await Promise.all([helper('io'), helper('join'), helper('target')]);
  const inputs = readInputs(dir, opts.page, ['mapping', 'contentModel', 'rules']);
  const result = await runJoin({ target: localTarget(opts.url), inputs, out: workDir(dir, opts.page) });
  if (result.pass) {
    log(`PASS join: ${result.sections.length} section(s) joined to Figma modules (${result.sections.map((s) => `${s.slot} → ${s.module ?? 'new module'}`).join(', ')})`);
    return 0;
  }
  logDrift(result, log);
  return 1;
}

async function geometryStep({ dir, opts, log, UsageError }) {
  if (!opts.page) throw new UsageError('geometry needs --page <slug>');
  if (!opts.url) throw new UsageError('geometry needs --url <url|file>: the page to measure');
  const [{ prepare }, { runGeometry }] = await Promise.all([helper('prepare'), helper('geometry')]);
  const ready = await prepare({ dir, slug: opts.page, url: opts.url });
  if (ready.drift) {
    logDrift(ready.join, log);
    return 1;
  }
  const { pass, results } = await runGeometry({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, out: ready.out });
  const failing = results.filter((r) => r.status !== 'PASS');
  log(pass ? `geometry PASS ${results.length}/${results.length}` : `geometry FAIL ${failing.length}/${results.length}`);
  for (const r of failing) log(`  ${r.slot} ${r.id} ${r.measure}${r.node ? ` (node ${r.node})` : ''}: ${r.detail}`);
  return pass ? 0 : 1;
}

async function rampStep({ dir, opts, log, UsageError }) {
  if (!opts.page) throw new UsageError('ramp needs --page <slug>');
  if (!opts.url) throw new UsageError('ramp needs --url <url|file>: the page to probe');
  const [{ prepare }, { runRamp }] = await Promise.all([helper('prepare'), helper('ramp')]);
  const ready = await prepare({ dir, slug: opts.page, url: opts.url });
  if (ready.drift) {
    logDrift(ready.join, log);
    return 1;
  }
  const { pass, results, literals } = await runRamp({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, rules: ready.rules, out: ready.out });
  const failing = results.filter((r) => r.status === 'FAIL');
  const unasserted = results.filter((r) => r.status === 'UNASSERTED');
  const asserted = results.length - unasserted.length;
  const note = unasserted.length ? ` (${unasserted.length} unasserted)` : '';
  log(pass ? `ramp PASS ${asserted}/${asserted}${note}` : `ramp FAIL ${failing.length}/${asserted}${note}`);
  for (const r of failing) log(r.slot === null ? `  :root ${r.id}: ${r.detail}` : `  ${r.slot} ${r.id} ${r.property}${r.node ? ` (node ${r.node})` : ''}: ${r.detail}`);
  for (const r of unasserted) log(`  ${r.slot} ${r.id} ${r.property} (node ${r.node}): advisory, ${r.detail}`);
  if (literals.length) {
    const shown = literals.slice(0, 5).map((l) => `line ${l.line} ${l.literal} → ${l.token}`).join('; ');
    log(`advisory ramp: ${literals.length} token literal(s) outside :root (${shown}${literals.length > 5 ? '; …' : ''}): use var(<token>)`);
  }
  return pass ? 0 : 1;
}

async function pixelStep({ dir, opts, log, UsageError }) {
  if (!opts.page) throw new UsageError('pixel needs --page <slug>');
  if (!opts.url) throw new UsageError('pixel needs --url <url|file>: the page to screenshot');
  const [{ prepare }, { REFERENCE_CLASSES, runPixel }] = await Promise.all([helper('prepare'), helper('pixel')]);
  const ready = await prepare({ dir, slug: opts.page, url: opts.url });
  if (ready.drift) {
    logDrift(ready.join, log);
    return 1;
  }
  const { results } = await runPixel({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, dir, out: ready.out });
  const ref = REFERENCE_CLASSES;
  log(`pixel advisory: ${results.length} section(s); uncalibrated reference: light text ${ref.lightText}%, inverted ${ref.inverted}%, raster ground ${ref.rasterGround}%`);
  for (const r of results) {
    if (r.verdict === 'advisory') log(`  ${r.slot} ${r.pct.toFixed(2)}% (text ${r.textPct === null ? 'n/a' : `${r.textPct.toFixed(2)}%`}, Δh ${r.heightDelta})`);
    else log(`  ${r.slot} ${r.verdict === 'n/a' ? `n/a: ${r.reason}` : `no verdict: ${r.reason}`}`);
    const unserved = r.fonts.filter((f) => !f.served).map((f) => f.family);
    if (unserved.length) log(`  ${r.slot} advisory: font not served by the page: ${unserved.join(', ')}`);
  }
  return results.some((r) => r.verdict === 'no verdict') ? 124 : 0;
}

// steps lets a test replace a step function.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {} } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  const run = { boxes: boxesStep, join: joinStep, geometry: geometryStep, ramp: rampStep, pixel: pixelStep, ...steps }[cmd];
  const { confidentialGuard } = await helper('io');
  confidentialGuard(dir);
  return run({ dir, opts, env, log, warn, UsageError });
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`figma-gate: ${String(e?.message ?? e)}`);
    process.exitCode = e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 124);
  });
}
