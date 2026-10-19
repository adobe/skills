#!/usr/bin/env node
// skills/reskin/scripts/figma-gate.mjs — Figma checks on a reskin page. One CLI, steps in ./figma-gate/,
// the Figma capture helpers of figma-donor.mjs in ./figma/:
//   boxes  the Figma box trees of the included modules, built once from the cached capture
//          (.work/reskin/figma/, never the network) and cached in .work/reskin/gates/figma-boxes/.
//   join   B0: every mapping.md slot that renders as a module is one section of the page, in order, with
//          its module's Figma frame; a page that drifted from the mapping stops here. --target preview joins
//          a deployed preview: the reskin page's slots found in the preview's authored form (.plain.html).
//          Every step with a --url takes --target preview: the join's sections of the settled preview are what
//          geometry, ramp and pixel measure, each checks entry by its previewSelector when it has one.
//   geometry  B1: the sizes, offsets, gaps and paddings the checks file pairs with Figma nodes or tokens.
//   ramp   B3: the :root token block and the type of every Type entry, through donor-probe.mjs.
//   pixel  B2: advisory pixel share of each section against its slice of the frame image, where the
//          frame's copy is the page's copy (replica's pixel-compare.mjs).
//   register  B4: the divergence register of the step results already on disk (no browser).
//   all    join → geometry → ramp → pixel → register in one run, with summary.json and the ledger fragment.
// Writes go only under <dir>/.work/reskin/gates/. Under a sticky --confidential capture, every
// subcommand first checks that .work/ and reskin/figma-checks/ are git-ignored.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 pass · 1 a blocking check failed · 2 usage or setup · 3 bot challenge on a live target
// · 124 no verdict (a step crashed or timed out: re-run, never a fix iteration).
import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export const HELP = `Usage:
  node figma-gate.mjs boxes [--module Mn | --node <id>] [--depth 3] [--dir stardust]
  node figma-gate.mjs join --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs join --page <slug> --url <preview url> --target preview --reskin <file>
                           [--auth-header <value> | --token-env <NAME>] [--dir stardust]
  node figma-gate.mjs geometry --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs ramp --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs pixel --page <slug> --url <url|file> [--dir stardust]
  node figma-gate.mjs register --page <slug> [--target preview] [--dir stardust]
  node figma-gate.mjs all --page <slug> --url <url|file> [--dir stardust]
  (geometry, ramp, pixel and all take --target preview --reskin <file> [--auth-header <value> | --token-env <NAME>] like join;
   register takes --target preview alone, to read the preview run's files)

Figma checks on a reskin page, against the capture figma-donor.mjs made (offline: no token, no network).

boxes    the Figma box trees of the modules curation-rules.json includes. Reads the current capture's
         nodes.json once per file version and caches one tree per root under
         <dir>/.work/reskin/gates/figma-boxes/<file-key>/<version>.json; later runs are answered from
         that cache, even after nodes.json is gone. A box is { id, name, type, x, y, w, h, layout,
         text, fill, fillKind, children }: x and y are relative to the root, layout is
         { mode, padding [t, r, b, l], gap } on an auto-layout frame, hidden layers are dropped.
         --module Mn   print that module's outline (id, type, name, x,y, w×h, layout; a TEXT node: family, weight,
                       size/line height, ls <letter spacing>, colour, text: the styles the coverage floor keys by)
         --node <id>   print the outline of any captured node id, nested I…;… ids included
         --depth <n>   outline depth, 0 = the root only (default 3)
         neither       build the cache for every included module and print "<Mn> <frame id> <w>×<h>"
join     B0, the section join. Opens the page (a file path, a file: or localhost URL, or an http(s) URL) in
         plain Chromium at 1440 and reads its main section[data-slot] elements in document order. Every
         mapping.md row that renders (status mapped or new-module) must be exactly one top-level section, in
         the table's order, whose data-module is the row's Donor module and whose text holds the slot's first
         heading (content-model.json); a Donor module must be included in curation-rules.json. Chrome and
         carried-invisible rows need no section. Each problem starts "section drift:". Writes
         <dir>/.work/reskin/gates/<slug>/figma/join.json (figma-preview/ on --target preview; each section's slot, module, Figma frame, selector
         and document index), prints one PASS or FAIL line and exits 1 on drift.
         --target preview joins a deployed preview instead: --url is its http(s) URL, --reskin the reskin page (the file
         whose data-slot sections mapping.md describes). The preview is opened and settled first (a block that never
         decorates is exit 124 "stalled decoration: ..."). The reskin page is joined to mapping.md as above; then each slot
         is found in the preview's authored form (<url>.plain.html, read as text) as the first non-empty top-level <div>
         after the previous slot's whose text holds the slot's first heading (a split sub-slot has its parent's and may
         share one). A <div> holding nothing, or only a metadata or section-metadata block, is empty and keeps its index.
         A slot with no authored section, a slot found before the previous one and a non-empty authored section no slot
         took are "section drift: ..." ("section drift: plain section 3 matches no slot"). Each slot is then found the same
         way in the decorated page, and its selector is "main > div:nth-child(k)" of the decorated div holding its heading
         (index k - 1): decoration may prepend a section (a hero block) or drop an empty one, so k is not the authored
         position. A slot that moved gets one line under the PASS line ("  note: s01: decoration moved plain section 1 to
         main > div:nth-child(3): ...") and an entry in join.json notes; a heading in no decorated div, a slot out of order
         there or two slots in one decorated div are "section drift: s02: anchor "..." not in any decorated main > div"
         and the like. join.json records regime "preview".
geometry B1. Runs the join first (drift stops here, exit 1), validates the checks file, then measures every
         geometry entry on the page (one page load per width) against the same measure taken from its Figma
         node (relative to the module root) or its token: width, height, left, right, top, gapX, gapY and
         the paddings, within tolerancePx (default 1: measure-live rounds to whole px, Figma has half pixels).
         Prints "geometry PASS n/n" or "geometry FAIL k/n" plus one indented line per failing entry
         ("<slot> <id> <measure> (node <id>): 540 vs 560 (±1)", or "unmeasurable: <why>" when the selector
         matched nothing, a gap has fewer than two matches or the box has no size); writes
         <dir>/.work/reskin/gates/<slug>/figma/geometry.json (figma-preview/ on --target preview); exit 1 on any FAIL. Each result carries root, the
         checks root (the section's root node for the entry's width) it was measured against.
ramp     B3. Runs the join first (drift stops here, exit 1), validates the checks file, then asserts through
         donor-probe.mjs (one run per width, no overflow sanity): the :root block that donor-tokens.json
         yields (every custom property verbatim, at the first section's width) and, for every type entry,
         six computed styles of the section's selector against the Figma text node: fontSize, fontWeight,
         lineHeight and letterSpacing in px (the last two within 0.1px), fontFamily (first family) and
         color; the rules' weightMap and familyEquivalence apply to the Figma side. Prints "ramp PASS n/n"
         or "ramp FAIL k/n" plus one indented line per failing entry ("<slot> <id> <property> (node <id>):
         16px vs 14px", ":root <name>: ..." for a custom property); writes ramp-spec.<w>.json, ramp.<w>.md,
         ramp.<w>.json and ramp.json under <dir>/.work/reskin/gates/<slug>/figma/ (figma-preview/ on --target preview); exit 1 on any FAIL.
         A property the Figma node gives no value for (no font size, a fill that is not one visible solid
         color, ...) is recorded as UNASSERTED in ramp.json, never failed: the verdict reads "ramp PASS n/n
         (k unasserted)" with one indented "advisory" line per property.
         Token values written as literals outside :root (a color that equals a :root value) are listed in
         one "advisory" line and never change the exit code. A probe that cannot run is exit 124; one that exits 2 (its own setup error) is exit 2 with its message,
         and a bot challenge is exit 3. Every result carries root (null for a :root entry), the checks root its entry was
         measured against. On --target preview the probe is given --wait-eds (the preview's decoration settles first; a
         stall is exit 124) and the site token in its environment (DEPLOYED_GATE_SITE_TOKEN with --token-env), never in argv.
pixel    B2, advisory. Runs the join first (drift stops here, exit 1), validates the checks file, then for
         every section crops its slice out of the cached frame image (the PNG figma-donor.mjs captured,
         taken at 1×; a size within 1px of the frame box fits, Figma rounds a fractional box up; any
         other size is n/a) and compares it with an element screenshot of the section
         at its width through replica's pixel-compare.mjs (a = Figma slice, b = page; the number never
         fails). Only where the frame's copy is the section's copy (visible text, whitespace and case
         ignored): otherwise the section is "n/a: frame content differs". Also n/a: no frame image
         (re-run figma-donor.mjs capture), a PNG of another size, pixel mode off (needs why). Mode
         fixture screenshots the section's data-slot selector on fixtureUrl instead of the page (a local hand-made
         stand-in, on a preview too).
         Prints "pixel advisory" ("ERROR (exit 124) pixel no verdict" when a comparison hit its deadline), the uncalibrated reference classes (light text 3%, inverted 3.5%,
         raster ground 4%: orientation, not a bar) and one line per section: "<slot> 0.42% (text 1.10%,
         Δh 0)" (differing pixels overall and over the frame's text boxes, height delta Figma − page)
         or "<slot> n/a: <why>"; an indented line names each first font family the section uses
         that the page does not render (no loaded @font-face, not installed; a generic family is
         served). Writes <slot>.figma.png, <slot>.page.png, <slot>.diff.png,
         <slot>.text-boxes.json and pixel.json under <dir>/.work/reskin/gates/<slug>/figma/ (figma-preview/ on --target preview; results carry root).
         Exit 0, or 124 when a comparison hit its deadline (no verdict: re-run). On --target preview the screenshot is
         the decorated section at the join's selector once the decoration has settled; the number stays advisory.
register B4, the divergence register. Reads join.json and whichever of geometry.json, ramp.json and
         pixel.json the earlier steps left under <dir>/.work/reskin/gates/<slug>/figma/ (figma-preview/ with --target
         preview: the run to read; no browser, no --url; a missing join.json is exit 2: run the join first), and the
         checks file as it stands now, for its waivers and coverage (a missing or invalid one is exit 2). A step with no
         file is "not run": the register lists it, and no section is mandated unless both geometry.json and ramp.json exist.
         Six classes: mandated (a joined module section whose geometry and type entries all pass, whose text styles
         all have a type entry and that has no waiver; UNASSERTED ignored; and whose results are of the checks file as it
         stands: one for every entry id, from steps that recorded the section's checksStamp), waived (one row per waiver of a section, a
         skip included: the node's name and id, or the mobile or desktop root, its why in quotes, and how many text styles and text
         nodes it drops at which width; a section with a waiver is never mandated), unmandated (each failing entry, a
         failing :root token included; a "stale" row for a section whose results are not of this checks file: re-run all),
         out-of-kit (each new-module mapping row), conflict (a Figma text color below WCAG contrast in a root the
         section checks, its alpha composited over its solid ground: 4.5, or 3 for large text; gradient and image grounds are
         skipped, and so is a translucent color with no opaque ground behind it, named in a "Contrast not assessed" line)
         and pre-existing (each flag in ledger.json pages.<slug>.flags, the ledger being optional).
         Rows carry the Figma node and a file link; under --confidential the links are left out. A row's node is the
         checks root its results were measured against (their root), the join's module frame for a mandated section
         whose results carry none, the waived node (a mobile or desktop waiver's root; the section's root for a skip or
         when the module frame holds none), and the
         entry's own node for a failing entry with none. The register's regime is the
         join's.
         Writes register.json and register.md (counts, rows, a "Not run" line, then the pixel results as
         an advisory block with the uncalibrated reference classes) beside the step files, prints
         "register written: mandated 1 · waived 0 · unmandated 1 · …" and the register.md path; exit 0.
all      The whole run: join, geometry, ramp, pixel, register. The page is joined and the checks file
         validated once, and every step works from that result. First it deletes the previous geometry.json,
         ramp.json, pixel.json, register.json, register.md, summary.json, floor-problems.txt and the per-width
         ramp files (ramp-spec.<w>.json, ramp.<w>.md, ramp.<w>.json) of its own regime's directory, so a drifted
         or crashed run never feeds stale files to the register or the summary. A join drift ends in exit 1 with geometry, ramp
         and pixel "not run: section drift" (the register still runs, with nothing mandated and "join drift"
         under Not run). A step that throws anything but a usage error or a bot challenge is "CRASH: <message>" (exit 124);
         a usage error (a missing input, an invalid checks file) stops the run with exit 2. Prints one
         verdict line per step: PASS, FAIL, advisory, or for a step with no verdict "ERROR (exit 124) <step> CRASH:
         <message>", "ERROR (exit 3) <step> CHALLENGE: <message>", "FAIL <step> not run: section drift" (every line
         matches run-bg's default verdict filter), then
         the ledger fragment as JSON, then the register.md path. Exit: the first present of 2, 3, 124, 1, 0
         (a step that throws code 3, a bot challenge, is verdict "CHALLENGE: <message>" and exit 3; the
         other steps still run).
         Writes <dir>/.work/reskin/gates/<slug>/figma/summary.json (figma-preview/ on --target preview):
           { _provenance, page, url, regime, figma: { version }, steps: { <step>: { verdict, exit, detail } },
             ledgerFragment, invocation }
         ledgerFragment is what the agent copies to ledger.json pages.<slug>.gates.figma (never a file key); with
         --target preview its regime is "preview" and it goes to pages.<slug>.gates.deployed.figma, and the recorded
         invocation names --target preview and --reskin (a site token flag only as a placeholder, never its value):
           { regime, figmaVersion, join: PASS | FAIL, geometry: "PASS n/n" | "FAIL k/n", ramp (the same over
             asserted results, " (k unasserted)" appended), pixel: "<slot> <pct>%, <slot> n/a: <why>, ...",
             register: the counts line, coverage: "text styles <covered>/<total> · widths <w1>,<w2> · waived <n>"
             (over every module section; a section skip counts as a waiver), literals: <token literals outside :root>, invocation }
         A step that did not run carries its verdict instead ("not run: section drift", "CRASH: <message>").
         Run it under run-bg when it may exceed a shell's limit:
           run-bg.mjs start --name figma-<slug> --dir stardust/.work/reskin/bg -- node <scripts>/figma-gate.mjs all --page <slug> --url <url|file>
           run-bg.mjs wait figma-<slug> --dir stardust/.work/reskin/bg
--dir <d>  the stardust directory (default stardust).
--target local|preview  the regime of --url (default local: the reskin page). preview is a deployed (aem.page) page and takes
         every step with a --url (join, geometry, ramp, pixel, all; register takes it only to say which run to read). A
         preview run keeps its files in <slug>/figma-preview/ beside the local run's <slug>/figma/, so neither
         deletes the other's evidence. The sections are the join's, main > div:nth-child(k) of the decorated page, and each checks entry is
         measured by its previewSelector, else its selector, scoped to that section: a selector that matches nothing there
         is "unmeasurable", a FAIL, never a skip. Each of those steps opens the preview and waits for the EDS decoration
         first (a stall is exit 124), and every step file records regime "preview". preview needs --reskin <file>;
         local takes neither --reskin nor a site token.
--auth-header <value> | --token-env <NAME>  (preview only) the Authorization header value for a protected preview, or the
         environment variable (or .env entry) holding the token; neither may be empty. Sent to the preview origin only, on
         the page and on its .plain.html, never printed (every line the gate prints has it redacted, and a usage error
         never quotes a flag's value or a stray argument next to one: write the value as a separate argument, quoted if it
         has a space: --auth-header "token <value>") and never written. --token-env takes a variable NAME.
         HTTP 401 or 403 from the preview is exit 2.

Checks file <dir>/reskin/figma-checks/<slug>.json (written by the agent from the boxes outlines):
  { "version": 1, "page": "<slug>", "sections": { "<slot>": {
      "node"?: "<id>"                    the section root, default the join's module frame; or an outermost instance/variant in it
      "width"?: 1440                     default the root's width
      "roots"?: { "<width>": "<id>" }    another outermost instance or variant of the module, for entries with that width
      "skip"?: "<why>"                   replaces the required geometry and type entries (and the floor)
      "waive"?: [ { "node": "<id>" | "width": "mobile" | "desktop", "why": "<why>" } ]   lowers the coverage floor below
      "geometry": [ { id, selector, previewSelector?, measure, node | nodes: [a, b] | token, index?: 0, width?, tolerancePx?: 1, why? } ],
      "type": [ { id, selector, previewSelector?, node, width? } ],
      "pixel"?: { "mode": "auto" | "fixture" | "off", "fixtureUrl"?, "why"? } } } }
  selector resolves inside the section: a plain selector as a descendant of it, ":scope" as the section itself (":scope",
  ":scope > .a .b"); a comma list is scoped branch by branch, a comma inside :is(), :where(), :not() or an attribute value
  is not a branch. A branch that begins with a sibling combinator (":scope + p") would leave the section: exit 2.
  ids are g1.. and t1.. per section.
  previewSelector (a string, scoped the same way) is the selector on a deployed preview (--target preview), whose blocks
  rebuild the markup the reskin page was written with; without it the preview uses selector. --target local never reads it.
  measure: width left right top height gapX gapY paddingTop paddingRight paddingBottom paddingLeft.
  gapX and gapY take exactly two nodes; token is a path in donor-tokens.json holding one px value.
  top and height are content-dependent: they need tolerancePx and why. tolerancePx above 1 needs why.
  A padding measure needs an auto-layout node; a type node must be TEXT; every node sits inside the root
  of its width. fixture needs fixtureUrl, off needs why. Every problem is listed at once (exit 2) and also written, one
  per line, to floor-problems.txt beside the step files; the error ends with its path (run-bg wait shows the last lines).
  Coverage floor, computed from Figma (not from this file): at every width a section is checked at (its root and each
  roots entry), every text style of that root (first font family, size, weight, line height and letter spacing to
  0.1px, colour) needs a type entry at that width whose node has the style. Every root (node, each roots entry) is the
  module frame itself or an outermost component or instance inside it (no instance between it and the frame; never a
  TEXT node, a plain frame or a node of another module), at least half as wide as the width it is checked at, and holds
  a text style unless the module frame has none. A module frame that holds a mobile variant (a component or instance
  named "mobile", 320 to 480 wide) needs a roots entry up to 480 wide that is one of those variants (the desktop
  root's own set, when the frame holds several), keyed at the variant's own width (its box's w: "414", not a phone
  width such as 360: geometry and type would be held to a width the variant was not drawn at), and some root is
  checked wider than 480. waive is the only way below the floor, and needs a why: { node } on a frame drops that subtree
  (a documentation panel, notation text), on a TEXT node waives that style; { width: "mobile" } waives the mobile root,
  { width: "desktop" } the root above 480. A module frame that is itself the root holds its documentation frames and
  every variant: name the desktop instance in "node".
Writes go only under <dir>/.work/reskin/gates/. After a capture --confidential, every subcommand first
asserts that <dir>/.work/ and <dir>/reskin/figma-checks/ are git-ignored (exit 2 with the lines to add).
Exit codes: 0 pass · 1 a blocking check failed · 2 usage or setup (missing input or capture)
            · 3 bot challenge on a live target · 124 no verdict: a step crashed or timed out; re-run once, the
            same 124 twice is a residual (needs-owner), never a fix iteration.`;

// The regime and site-token flags of the steps that take a --url.
const TARGET_VALUES = ['--target', '--reskin', '--auth-header', '--token-env'];
const SECRET_FLAGS = new Set(['--auth-header', '--token-env']);

const SPEC = {
  boxes: { values: ['--module', '--node', '--depth', '--dir'], bools: [], positional: [] },
  join: { values: ['--page', '--url', ...TARGET_VALUES, '--dir'], bools: [], positional: [] },
  geometry: { values: ['--page', '--url', ...TARGET_VALUES, '--dir'], bools: [], positional: [] },
  ramp: { values: ['--page', '--url', ...TARGET_VALUES, '--dir'], bools: [], positional: [] },
  pixel: { values: ['--page', '--url', ...TARGET_VALUES, '--dir'], bools: [], positional: [] },
  register: { values: ['--page', '--target', '--dir'], bools: [], positional: [] },
  all: { values: ['--page', '--url', ...TARGET_VALUES, '--dir'], bools: [], positional: [] },
};

// What a usage error may print of an argument it did not understand: the word of a command, never one that starts with
// `-` or holds a space, `=` or `:` (`--auth-header=<token>`, `token <value>` typed ahead of the command), and of a flag
// its name alone, cut at the first character that cannot be part of one (`--flag=<value>`, `--flag:<value>`).
const plainWord = (s) => !/^-|[\s=:]/.test(s);
const flagName = (a) => a.match(/^--[\w-]+/)?.[0] ?? null;

export function parseArgs(argv, UsageError) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError(`no command\n${HELP}`);
  const spec = SPEC[cmd];
  if (!spec) throw new UsageError(`${plainWord(cmd) ? `unknown command "${cmd}"` : 'unknown command (not echoed: it starts with - or holds a space, = or :, and may be part of a secret; a command comes first, its flags after it)'}\n${HELP}`);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (spec.values.includes(a)) {
      const val = rest[i + 1];
      // A blank secret never falls back to $SITE_TOKEN or a .env entry: it is a missing value.
      if (val === undefined || val.startsWith('--') || (SECRET_FLAGS.has(a) && !val.trim())) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = val;
      i += 1;
    } else if (spec.bools.includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) {
      // An unknown --flag=value (or --flag:value) is named by its flag alone: the value may be a secret.
      const name = flagName(a);
      if (!name) throw new UsageError(`unknown flag for ${cmd} (not echoed: it is not a flag name)`);
      throw new UsageError(name === a ? `unknown flag ${a} for ${cmd}` : `unknown flag ${name} for ${cmd}: a flag and its value are separate arguments (${name} <value>)`);
    } else positional.push(a);
  }
  if (positional.length < spec.positional.length) throw new UsageError(`${cmd} needs ${spec.positional.join(' ')}`);
  if (positional.length > spec.positional.length) {
    // Next to a site-token flag the stray argument may be the rest of an unquoted header value: it is not printed.
    throw new UsageError(rest.some((x) => SECRET_FLAGS.has(x))
      ? 'unexpected argument: quote the value of --auth-header ("token <value>"), it has a space; the argument is not shown, it may be part of the secret'
      : plainWord(positional[spec.positional.length]) ? `unexpected argument "${positional[spec.positional.length]}"` : 'unexpected argument (not shown: it holds a space, = or :, and may be part of a secret)');
  }
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

function logJoin(result, log) {
  if (!result.pass) { logDrift(result, log); return; }
  log(`PASS join: ${result.sections.length} section(s) joined to Figma modules (${result.sections.map((s) => `${s.slot} → ${s.module ?? 'new module'}`).join(', ')})`);
  for (const n of result.notes ?? []) log(`  note: ${n}`);
}

// The Target of a step's --url: the reskin page (local) or a deployed preview, which carries the site token.
async function targetFor(opts, auth) {
  const { localTarget, previewTarget } = await helper('target');
  return opts.target === 'preview' ? previewTarget(opts.url, { reskin: opts.reskin, auth }) : localTarget(opts.url);
}

async function joinStep({ dir, opts, log, UsageError, auth }) {
  if (!opts.page) throw new UsageError('join needs --page <slug>');
  if (!opts.url) throw new UsageError('join needs --url <url|file>: the page to join');
  const [{ readInputs, workDir }, { runJoin }] = await Promise.all([helper('io'), helper('join')]);
  const inputs = readInputs(dir, opts.page, ['mapping', 'contentModel', 'rules']);
  const target = await targetFor(opts, auth);
  const result = await runJoin({ target, inputs, out: workDir(dir, opts.page, target.regime), page: opts.page });
  logJoin(result, log);
  return result.pass ? 0 : 1;
}

async function geometryStep({ dir, opts, log, UsageError, ready: given, auth }) {
  if (!opts.page) throw new UsageError('geometry needs --page <slug>');
  if (!opts.url) throw new UsageError('geometry needs --url <url|file>: the page to measure');
  const [{ prepare }, { runGeometry }] = await Promise.all([helper('prepare'), helper('geometry')]);
  const ready = given ?? await prepare({ dir, slug: opts.page, url: opts.url, target: await targetFor(opts, auth) });
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

async function rampStep({ dir, opts, log, UsageError, ready: given, auth }) {
  if (!opts.page) throw new UsageError('ramp needs --page <slug>');
  if (!opts.url) throw new UsageError('ramp needs --url <url|file>: the page to probe');
  const [{ prepare }, { runRamp }] = await Promise.all([helper('prepare'), helper('ramp')]);
  const ready = given ?? await prepare({ dir, slug: opts.page, url: opts.url, target: await targetFor(opts, auth) });
  if (ready.drift) {
    logDrift(ready.join, log);
    return 1;
  }
  const { pass, results, literals } = await runRamp({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, rules: ready.rules, out: ready.out, auth });
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

async function pixelStep({ dir, opts, log, UsageError, ready: given, auth }) {
  if (!opts.page) throw new UsageError('pixel needs --page <slug>');
  if (!opts.url) throw new UsageError('pixel needs --url <url|file>: the page to screenshot');
  const [{ prepare }, { pixelHeadline, runPixel }] = await Promise.all([helper('prepare'), helper('pixel')]);
  const ready = given ?? await prepare({ dir, slug: opts.page, url: opts.url, target: await targetFor(opts, auth) });
  if (ready.drift) {
    logDrift(ready.join, log);
    return 1;
  }
  const { results } = await runPixel({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, dir, out: ready.out });
  log(pixelHeadline(results));
  for (const r of results) {
    if (r.verdict === 'advisory') log(`  ${r.slot} ${r.pct.toFixed(2)}% (text ${r.textPct === null ? 'n/a' : `${r.textPct.toFixed(2)}%`}, Δh ${r.heightDelta})`);
    else log(`  ${r.slot} ${r.verdict === 'n/a' ? `n/a: ${r.reason}` : `no verdict: ${r.reason}`}`);
    const unserved = r.fonts.filter((f) => !f.served).map((f) => f.family);
    if (unserved.length) log(`  ${r.slot} advisory: font not served by the page: ${unserved.join(', ')}`);
  }
  return results.some((r) => r.verdict === 'no verdict') ? 124 : 0;
}

// --target names which run's directory to read (local by default); `all` hands over its prepared checks as ready.
async function registerStep({ dir, opts, log, UsageError, ready: given }) {
  if (!opts.page) throw new UsageError('register needs --page <slug>');
  const [{ readInputs, workDir }, { loadBoxes }, { checksFor }, { buildRegister, countsLine, registerMd }, { readCurrent }, { canonicalFigmaUrl }, { readJsonIf, writeFileAtomic, writeJson }] = await Promise.all([
    helper('io'), helper('boxes'), helper('prepare'), helper('register'), helper('cache', 'figma'), helper('url', 'figma'), helper('io', 'figma'),
  ]);
  const regime = opts.target ?? 'local';
  const out = workDir(dir, opts.page, regime);
  const read = (name) => {
    try { return readJsonIf(join(out, name)); } catch (e) { throw new UsageError(`${join(out, name)} is not valid JSON: ${e.message}`); }
  };
  const joinResult = read('join.json');
  if (!joinResult) {
    const other = regime === 'preview' ? 'local' : 'preview';
    const hint = existsSync(join(workDir(dir, opts.page, other), 'join.json')) ? ` (there is a join.json for --target ${other})` : '';
    throw new UsageError(`no ${join(out, 'join.json')}: run the join first (node figma-gate.mjs all --page ${opts.page} --url <url|file>${regime === 'preview' ? ' --target preview --reskin <file>' : ''}, or join)${hint}`);
  }
  const inputs = readInputs(dir, opts.page, ['mapping', 'ledger', 'checks', 'donorTokens']);
  // The waivers and coverage of the checks file as it stands; a drifted join has no sections to check.
  const prepared = joinResult.pass === false ? null : given && !given.drift ? given : checksFor({ dir, slug: opts.page, inputs, join: joinResult, out });
  const current = readCurrent(dir);
  const sectionNodes = [...new Set((joinResult.sections || []).map((s) => s.node).filter(Boolean))];
  const boxes = prepared?.boxes ?? (sectionNodes.length ? loadBoxes(dir, sectionNodes) : { roots: {} });
  const link = (nodeId) => (current?.confidential || !current?.fileKey ? null : canonicalFigmaUrl({ fileKey: current.fileKey, nodeId }));
  const register = {
    page: opts.page,
    ...buildRegister({
      join: joinResult,
      geometry: read('geometry.json'),
      ramp: read('ramp.json'),
      pixel: read('pixel.json'),
      mapping: (await helper('mapping')).parseMapping(inputs.mapping, opts.page),
      boxes,
      flags: inputs.ledger?.pages?.[opts.page]?.flags || [],
      link,
      checks: prepared?.checks,
      coverage: prepared?.coverage,
    }),
  };
  writeJson(join(out, 'register.json'), register);
  writeFileAtomic(join(out, 'register.md'), registerMd(register));
  log(`register written: ${countsLine(register.counts)}`);
  log(join(out, 'register.md'));
  return 0;
}

const STALE_FILES = ['geometry.json', 'ramp.json', 'pixel.json', 'register.json', 'register.md', 'summary.json', 'floor-problems.txt'];
// The per-width files of a ramp (ramp-spec.<w>.json, ramp.<w>.md, ramp.<w>.json): a width the checks file no longer has leaves its files behind.
const RAMP_WIDTH_FILE = /^ramp(?:-spec)?\.\d+\.(?:json|md)$/;
const NOT_RUN_DRIFT = 'not run: section drift';
const VERDICT_WORDS = { geometry: { 0: 'PASS', 1: 'FAIL' }, ramp: { 0: 'PASS', 1: 'FAIL' }, pixel: { 0: 'advisory', 124: 'no verdict' }, register: { 0: 'written' } };

function geometryFragment(file) {
  const bad = file.results.filter((r) => r.status !== 'PASS').length;
  return bad ? `FAIL ${bad}/${file.results.length}` : `PASS ${file.results.length}/${file.results.length}`;
}

function rampFragment(file) {
  const unasserted = file.results.filter((r) => r.status === 'UNASSERTED').length;
  const asserted = file.results.length - unasserted;
  const bad = file.results.filter((r) => r.status === 'FAIL').length;
  return `${bad ? `FAIL ${bad}` : `PASS ${asserted}`}/${asserted}${unasserted ? ` (${unasserted} unasserted)` : ''}`;
}

function pixelFragment(file) {
  return file.results.map((r) => {
    if (r.verdict === 'advisory') return `${r.slot} ${r.pct.toFixed(2)}%`;
    return r.verdict === 'n/a' ? `${r.slot} n/a: ${r.reason}` : `${r.slot} no verdict`;
  }).join(', ');
}

async function allStep({ dir, opts, env, log, warn, UsageError, steps, auth, redact }) {
  if (!opts.page) throw new UsageError('all needs --page <slug>');
  if (!opts.url) throw new UsageError('all needs --url <url|file>: the page to check');
  const [{ prepare }, { workDir }, { countsLine, coverageLine }, { readCurrent }, { provenance, readJsonIf, writeJson }] = await Promise.all([
    helper('prepare'), helper('io'), helper('register'), helper('cache', 'figma'), helper('io', 'figma'),
  ]);
  const target = await targetFor(opts, auth);
  const regime = target.regime;
  const scrub = (m) => (redact ? redact(m) : m);
  const out = workDir(dir, opts.page, regime);
  for (const f of STALE_FILES) rmSync(join(out, f), { force: true });
  if (existsSync(out)) for (const f of readdirSync(out)) if (RAMP_WIDTH_FILE.test(f)) rmSync(join(out, f), { force: true });

  const isSetup = (e) => e instanceof UsageError || e?.code === 2;
  const recorded = {};
  const exits = [];
  const record = (name, verdict, exit, detail = []) => {
    recorded[name] = { verdict, exit, detail };
    if (exit !== null) exits.push(exit);
  };
  // Lines of a step with no verdict start with a word run-bg's default filter matches (FAIL, ERROR (exit …)).
  const notRun = (name, why, prefix) => {
    record(name, why, null);
    log(`${prefix} ${name} ${why}`);
  };
  // A step that threw: a bot challenge (code 3) is deterministic for the target, anything else but a setup error is a crash.
  // What is recorded in summary.json passes through scrub: it never holds the site token.
  const failureLine = (name, verdict, exit) => `ERROR (exit ${exit}) ${name} ${verdict}`;
  const failure = (e) => (e?.code === 3
    ? { verdict: scrub(`CHALLENGE: ${e.message}`), exit: 3 }
    : { verdict: scrub(`CRASH: ${e?.message ?? e}`), exit: 124 });
  // Runs one step function; its own log lines are kept as the step's detail.
  const exec = async (name, fn, extra = {}, { hide } = {}) => {
    const detail = [];
    const stepLog = (m) => { detail.push(scrub(m)); if (m !== hide) log(m); };
    try {
      const exit = await fn({ dir, opts, env, log: stepLog, warn, UsageError, auth, ...extra });
      record(name, VERDICT_WORDS[name]?.[exit] ?? `exit ${exit}`, exit, detail);
    } catch (e) {
      if (isSetup(e)) throw e;
      const { verdict, exit } = failure(e);
      log(failureLine(name, verdict, exit));
      record(name, verdict, exit, detail);
    }
  };

  let ready = null;
  try {
    ready = await prepare({ dir, slug: opts.page, url: opts.url, target });
    const detail = [];
    logJoin(ready.join, (m) => { detail.push(scrub(m)); log(m); });
    record('join', ready.join.pass ? 'PASS' : 'FAIL', ready.join.pass ? 0 : 1, detail);
  } catch (e) {
    if (isSetup(e)) throw e;
    const { verdict, exit } = failure(e);
    log(failureLine('join', verdict, exit));
    record('join', verdict, exit);
  }

  const joinStopped = recorded.join.exit === 3 ? 'not run: join hit a bot challenge' : 'not run: join crashed';
  const joinStoppedPrefix = `ERROR (exit ${recorded.join.exit})`;
  const runnable = ready && !ready.drift;
  for (const name of ['geometry', 'ramp', 'pixel']) {
    if (runnable) await exec(name, steps[name], { ready });
    else if (ready) notRun(name, NOT_RUN_DRIFT, 'FAIL');
    else notRun(name, joinStopped, joinStoppedPrefix);
  }
  const registerPath = join(out, 'register.md');
  if (ready) await exec('register', steps.register, { ready }, { hide: registerPath });
  else notRun('register', joinStopped, joinStoppedPrefix);

  const read = (name) => readJsonIf(join(out, name));
  const files = { geometry: read('geometry.json'), ramp: read('ramp.json'), pixel: read('pixel.json'), register: read('register.json') };
  const fragmentOf = (name, make) => (/^(CRASH|CHALLENGE)/.test(recorded[name].verdict) || recorded[name].exit === null || !files[name] ? recorded[name].verdict : make(files[name]));
  const current = readCurrent(dir);
  // A site token flag is named in the invocation, never its value.
  const preview = regime === 'preview' ? ` --target preview --reskin ${opts.reskin}${opts['auth-header'] !== undefined ? ' --auth-header <value>' : ''}${opts['token-env'] !== undefined ? ' --token-env <NAME>' : ''}` : '';
  const invocation = `figma-gate.mjs all --page ${opts.page} --url ${opts.url}${preview} --dir ${dir}`;
  const ledgerFragment = {
    regime: ready?.join.regime ?? regime,
    figmaVersion: current?.version ?? null,
    join: recorded.join.verdict,
    geometry: fragmentOf('geometry', geometryFragment),
    ramp: fragmentOf('ramp', rampFragment),
    pixel: fragmentOf('pixel', pixelFragment),
    register: fragmentOf('register', (f) => countsLine(f.counts)),
    coverage: runnable ? coverageLine(ready.coverage) : ready ? NOT_RUN_DRIFT : joinStopped,
    literals: files.ramp ? files.ramp.literals?.length ?? 0 : null,
    invocation,
  };
  writeJson(join(out, 'summary.json'), {
    _provenance: provenance({ at: new Date().toISOString(), readArtifacts: Object.keys(files).filter((k) => files[k]).map((k) => `${k}.json`), note: 'figma-gate.mjs all', writtenBy: 'stardust:reskin/figma-gate.mjs' }),
    page: opts.page,
    url: opts.url,
    regime: ledgerFragment.regime,
    figma: { version: ledgerFragment.figmaVersion },
    steps: recorded,
    ledgerFragment,
    invocation,
  });
  log(`ledger fragment for pages.${opts.page}.gates.${regime === 'preview' ? 'deployed.figma' : 'figma'} in ledger.json:`);
  log(JSON.stringify(ledgerFragment, null, 2));
  if (files.register) log(registerPath);
  return [2, 3, 124, 1].find((c) => exits.includes(c)) ?? 0;
}

// --target names the regime of --url: local (the default) or preview. A flag of the other regime is a usage error.
function checkTarget(opts, UsageError) {
  const regime = opts.target ?? 'local';
  if (regime !== 'local' && regime !== 'preview') throw new UsageError(`--target is local or preview, got "${opts.target}"`);
  if (regime === 'preview') return;
  const flag = ['reskin', 'auth-header', 'token-env'].find((f) => opts[f] !== undefined);
  if (flag) throw new UsageError(`--${flag} applies to --target preview`);
}

// The site token the run was given (--auth-header or --token-env), or null, with the function that takes it out of a
// text: nothing the gate prints or throws may carry it. The token goes to the preview origin through previewTarget only.
async function siteToken(opts, UsageError) {
  if (opts['auth-header'] === undefined && opts['token-env'] === undefined) return null;
  // The variable's name is never printed: a token typed in its place would be echoed.
  if (opts['token-env'] !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts['token-env'])) throw new UsageError('--token-env takes the name of an environment variable (letters, digits and underscores), not the token');
  const eds = await helper('eds', 'deployed');
  await eds.loadLiveSession();
  const auth = eds.siteAuth({ authHeader: opts['auth-header'], tokenEnv: opts['token-env'] });
  if (!auth?.trim()) throw new UsageError('no site token: the variable --token-env names is not set in the environment or .env');
  return { auth, redact: (text) => eds.redact(text, auth) };
}

// steps lets a test replace a step function.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {} } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  checkTarget(opts, UsageError);
  const table = { boxes: boxesStep, join: joinStep, geometry: geometryStep, ramp: rampStep, pixel: pixelStep, register: registerStep, all: allStep, ...steps };
  const { confidentialGuard } = await helper('io');
  confidentialGuard(dir);
  const site = await siteToken(opts, UsageError);
  if (!site) return table[cmd]({ dir, opts, env, log, warn, UsageError, steps: table });
  try {
    return await table[cmd]({ dir, opts, env, log: (m) => log(site.redact(m)), warn: (m) => warn(site.redact(m)), UsageError, steps: table, auth: site.auth, redact: site.redact });
  } catch (e) {
    if (e?.message) e.message = site.redact(e.message);
    throw e;
  }
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`figma-gate: ${String(e?.message ?? e)}`);
    process.exitCode = e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 124);
  });
}
