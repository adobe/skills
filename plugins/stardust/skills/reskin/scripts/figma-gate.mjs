#!/usr/bin/env node
// skills/reskin/scripts/figma-gate.mjs — Figma checks on a reskin page. One CLI, steps in ./figma-gate/,
// the Figma capture helpers of figma-donor.mjs in ./figma/:
//   boxes  the Figma box trees of the included modules, built once from the cached capture
//          (.work/reskin/figma/, never the network) and cached in .work/reskin/gates/figma-boxes/.
//   join   B0: every mapping.md slot that renders as a module is one section of the page, in order, with
//          its module's Figma frame; a page that drifted from the mapping stops here.
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
  log(`FAIL join: ${result.problems.length} problem(s), the page drifted from mapping.md`);
  for (const p of result.problems) log(`  ${p}`);
  return 1;
}

// steps lets a test replace a step function.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {} } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  const run = { boxes: boxesStep, join: joinStep, ...steps }[cmd];
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
