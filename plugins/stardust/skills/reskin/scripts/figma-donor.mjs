#!/usr/bin/env node
// skills/reskin/scripts/figma-donor.mjs — Figma as a reskin design donor (reskin --donor-figma <url>;
// contract: skills/reskin/reference/donor-sources.md § 3). One CLI, helpers in ./figma/:
//   capture  Figma REST → raw cache (.work/reskin/figma/) → canon-source/ foundation, role and module
//            candidates, spec tables, frame screenshots and the crawl log. Network only here.
//   curate   offline: foundation + reskin/curation-rules.json → reskin/donor-tokens.json,
//            reskin/donor-modules.md and canon-source/DESIGN.{md,json} + _brand-extraction.json
//            (figma/rules.mjs documents the rules, figma/curate.mjs and figma/design.mjs the outputs).
//   stamp    state.json designSource only, through the master skill's state.mjs (figma/stamp.mjs).
// The token comes from FIGMA_TOKEN only (never a flag, never logged), sent as X-Figma-Token to the
// Figma API base (FIGMA_API_BASE overrides it for tests); image bytes come from signed storage URLs
// fetched without it, and no signed URL is ever written to disk.
// Foundation records: { value, figma, node, count, nodes } (value = normalized CSS; typography and
// components carry an object of CSS strings) — see figma/foundation.mjs for keys and heuristics.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Node older than 22 stops at startup with one line (exit 2). The process exits only after stdout
// and stderr flush, so piped output (--help | less) is never cut short.
// Exit codes: 0 ok · 1 validation or curate assertion failed · 2 usage, setup (Node < 22) or 404 ·
// 3 blocked (401/403, a 429 wait over --max-wait, 5xx after retries).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);

export const HELP = `Usage:
  node figma-donor.mjs capture <figma-url> [--list] [--frames <id,id>] [--max-frames <n>] [--refresh]
                       [--max-wait 60] [--confidential] [--dir stardust]
  node figma-donor.mjs curate [--confidential] [--dir stardust]
  node figma-donor.mjs stamp [--confidential] [--dir stardust]

Figma as a reskin design donor. Token: FIGMA_TOKEN, a Figma personal access token with the
file_content:read scope (file_variables:read is optional; without it variables are recorded as
unavailable). It is read from the environment only and sent only to the Figma API.

capture  reads one version of the file over the Figma REST API (files depth=2, then nodes,
         variables/local and images, each pinned with version=<v>), caches the raw responses and
         frame PNGs under <dir>/.work/reskin/figma/<file-key>/<version>/ (latest.json points at the
         last complete capture), and writes <dir>/canon-source/:
           foundation/{colors,typography,effects,radii,spacing,components}.json
           role-candidates.json  module-candidates.json  spec-tables.json
           assets/screenshots/<frame-slug>.png + index.json   _crawl-log.json
         <figma-url>: https://www.figma.com/design/<file-key>/<name>[?node-id=<a-b>] (also /file/,
         /proto/, /design/<key>/branch/<branch-key>/) or a bare file key.
         Frames: every visible top-level frame, section, instance, component and component set of
         every page, in document order: the whole file, whichever page or frame the URL's node-id
         names (it is recorded as the linked node and its page, never used to drop frames). Large
         selections and node responses warn on stderr; nodes and images go in batches of 5, and a
         frame Figma cannot render is recorded as not renderable, not fatal. --frames <id,id>
         (12:34 or 12-34) narrows to those nodes. --max-frames <n> caps at the first n; the rest
         are listed as cut on stderr and in the log. --list prints every page and its top-level
         nodes (id, type, size, name) and writes no output.
         A re-run without --refresh rebuilds every output from the cache: no network, no token; it
         refuses (exit 2) a cache whose manifest, saved selection and nodes disagree.
         --refresh fetches the file's current version into a staging dir and swaps it in only when
         complete: a failed or stopped refresh leaves the last complete capture (even of the same
         version) in place and served, and re-running the same selection resumes it. If a swap
         itself is cut short, readers (curate, stamp) still get that capture from its backup and
         the next capture restores it.
         --max-wait <s>: the longest Retry-After a 429 may impose before stopping (default 60).
         A frame or section holding only childless instances (remote-library components the REST
         payload did not expand) is marked hollow: true in module-candidates.json and warned on
         stderr: nothing inside it is measured; capture the library's own file for its components.
curate   offline and deterministic: canon-source/foundation + module-candidates.json + the agent-
         authored <dir>/reskin/curation-rules.json → <dir>/reskin/donor-tokens.json (reskin's token
         sheet; nodeRefs cite the Figma node behind every value; coverage lists asserted, absent and
         suspect paths, recommended { curated, missing } and, when any, hollow: included modules
         whose frame holds only childless instances, warned on stderr), <dir>/reskin/donor-modules.md
         (the module vocabulary, one screenshot and node per row) and the descriptive design files
         direct reads: <dir>/canon-source/DESIGN.json, DESIGN.md and _brand-extraction.json (prose
         only from rules.design). Every rule problem is listed at once (exit 1). Re-run after any
         capture or rules change.
stamp    sets <dir>/state.json designSource = { url, capturedAt, path: "<dir>/canon-source/" } and
         nothing else, through the master skill's state.mjs (beside the scripts: the plugin tree, or
         stardust/scripts/stardust/state.mjs in a project copy). Needs state.json (from
         $stardust extract <content-url> --all) and canon-source/DESIGN.{md,json} (from curate); exit 2 otherwise.
--confidential  for a design that must not reach git: capture and curate first check, with
         git check-ignore, every path they would write or move (every foundation file, every
         screenshot, the cache files and the backup of a replaced capture once the file version is
         known) and refuse (exit 2, nothing written to it, no request for the fixed outputs) when
         one is not ignored or is already tracked, or when any file under foundation/, the
         screenshots or the cache is tracked; the message names the path and the exact lines to
         add to <dir>/.gitignore (or the git rm --cached a tracked file needs); capture --list
         writes nothing and is not checked; stamp stores designSource.url as "figma:redacted"
         (state.json stays tracked).
         Sticky: after capture --confidential, curate, stamp and later captures in this dir apply it
         too. Needs a git repository.
--dir <d>  the stardust directory (default stardust).

curation-rules.json:
  { "version": 1,
    "reference": { "<family>": { "frame": "<nodeId>", "mode": null, "breakpoint": 1440 } },
    "roles": {
      "<group>.<path>": { "from": "<foundationFile>/<key>", "field": "<optional>", "evidence": "<nodeId>" },
      "buttons.primary": { "component": "<components key>", "evidence": "<nodeId>" },
      "<group>.<path>": { "absent": "<why>" } },
    "normalizations": [ { "id": "<id>", "kind": "lineHeightUnitless|letterSpacingEm|weightMap|
                          familyEquivalence|fontSmoothing", "params": {}, "why": "<text>" } ],
    "curations": [ { "path": "<token path>", "to": "<value>", "rule": "<proving rule>", "evidence": "<nodeId>" } ],
    "suspect": [ { "path": "<token path>", "why": "<text>" } ],
    "modules": [ { "id": "M1", "name": "<name>", "frame": "<frame or section nodeId>", "family": "<f>",
                   "anatomy": "<slots>", "variants": [], "components": [], "status": "include",
                   "eds": { "block": "<EDS block>|null", "variant": null } },
                 { "name": "<name>", "frame": "<nodeId>", "status": "excluded", "why": "<reason>" } ],
    "notesForReskin": "<casing, link glyphs, band rhythm>", "motifs": [ "<prose>" ],
    "design": { "displayName": "<name>", ... } }
  groups: palette, type, layout, buttons, cards, radii, shadows. Roles apply shallow first; an object
  record (typography, components) gives its field named by "field", by the probe path, or by the
  path's last segment, else its whole object. The 13 default-probe paths (palette.pageBg|bodyFg|
  headingFg, type.family, type.body.fontSize, type.display.fontWeight, buttons.primary.background|
  color|borderRadius|padding|fontSize, layout.containerMaxWidth|sectionPaddingY) must each resolve
  to a string or be marked absent with a why. Optional, noted when unmapped: cards.primary.background|
  borderRadius|padding|titleColor (a component's color), buttons.primary.height,
  layout.mobile.sectionPaddingY|gutter. lineHeightUnitless / letterSpacingEm take an optional
  params.paths scope; weightMap / familyEquivalence take params.map { from: to }; fontSmoothing
  takes params.value. Without radii.* or shadows.* roles every captured radius / shadow is listed,
  except paths marked absent.
  Module ids are M1, M2, …; a composition variant of a module takes a letter suffix (M1b, a variant of M1).
  A module's optional "eds" overrides the EDS block deploy Step 2 (D1/D11) gives its name
  (figma/eds-map.mjs: Q&A → accordion, Teaser → cards teaser, Button → null = default content; a pattern
  word anywhere counts: Accordion Item → accordion, Table – Striped → table striped, Image Top Columns →
  columns image-top).
Needs Node 22+ (an older Node stops at once with exit 2).
Exit codes: 0 ok · 1 validation or curate assertion failed · 2 usage, setup (Node < 22) or not
            found (404) · 3 blocked (401/403, a 429 wait over --max-wait, 5xx after retries).`;

const SPEC = {
  capture: { values: ['--frames', '--max-frames', '--max-wait', '--dir'], bools: ['--refresh', '--confidential', '--list'], positional: ['<figma-url>'] },
  curate: { values: ['--dir'], bools: ['--confidential'], positional: [] },
  stamp: { values: ['--dir'], bools: ['--confidential'], positional: [] },
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

const intFlag = (opts, name, dflt, UsageError) => {
  if (opts[name] === undefined) return dflt;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive integer, got "${opts[name]}"`);
  return n;
};

// A partial copy of the scripts (Setup copied scripts/* without the figma/ directory) is a setup
// error with the fix, not a module stack trace.
async function helper(name) {
  try { return await import(`./figma/${name}.mjs`); } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes(`figma/${name}.mjs`)) throw e;
    const err = new Error(`the figma/ helpers are missing beside figma-donor.mjs: copy the reskin scripts recursively (cp -R <plugin>/skills/reskin/scripts/. stardust/scripts/reskin/)`);
    err.code = 2;
    throw err;
  }
}

// state.mjs lives in the master skill: the plugin tree (skills/stardust/scripts/) or, in a project
// copy, stardust/scripts/stardust/ beside stardust/scripts/reskin/.
async function stateLib() {
  for (const rel of [['..', '..', 'stardust', 'scripts', 'state.mjs'], ['..', 'stardust', 'state.mjs']]) {
    const p = join(HERE, ...rel);
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  const err = new Error('state.mjs not found beside the scripts: copy it with cp <plugin>/skills/stardust/scripts/state.mjs stardust/scripts/stardust/ (reskin Setup step 3)');
  err.code = 2;
  throw err;
}

// --confidential is sticky: once a capture ran with it, curate, stamp and later captures in this
// stardust dir behave as if it were passed (current.json records it).
async function confidentialMode(dir, opts, log) {
  if (opts.confidential) return true;
  const { readCurrent } = await helper('cache');
  if (!readCurrent(dir)?.confidential) return false;
  log('confidential: on (set by an earlier capture --confidential)');
  return true;
}

export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`) } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors');
  const { cmd, positional, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';

  if (cmd === 'capture') {
    const [{ runCapture }, { createClient }] = await Promise.all([helper('capture'), helper('client')]);
    let frames = null;
    if (opts.frames) {
      frames = opts.frames.split(',').map((s) => s.trim().replace(/-/g, ':')).filter(Boolean);
      const bad = frames.find((id) => !/^I?\d+:\d+(?:;\d+:\d+)*$/.test(id));
      if (bad || !frames.length) throw new UsageError(`--frames takes node ids like 12:34 or 12-34, got "${opts.frames}"`);
    }
    const maxFrames = intFlag(opts, 'max-frames', null, UsageError);
    const maxWaitSec = intFlag(opts, 'max-wait', 60, UsageError);
    // --list writes nothing, so --confidential has nothing to check for it.
    if (opts.list) {
      const { listInventory } = await helper('capture');
      const client = createClient({ token: env.FIGMA_TOKEN || '', base: env.FIGMA_API_BASE || undefined, maxWaitSec });
      const { lines } = await listInventory({ url: positional[0], refresh: Boolean(opts.refresh), dir, client });
      for (const l of lines) log(l);
      log('next: capture <figma-url> takes every frame, component and component set listed above; --frames <id,id,…> narrows it');
      return 0;
    }
    const confidential = await confidentialMode(dir, opts, log);
    if (confidential) { const g = await helper('guard'); g.assertIgnored(g.CAPTURE_OUTPUTS, { dir, namespaces: g.CAPTURE_NAMESPACES }); }
    const client = createClient({ token: env.FIGMA_TOKEN || '', base: env.FIGMA_API_BASE || undefined, maxWaitSec });
    const { manifest, written, fromCache } = await runCapture({ url: positional[0], frames, maxFrames, refresh: Boolean(opts.refresh), confidential, dir, client, warn });
    const status = manifest.endpoints.map((e) => `${e.name} ${e.status}`).join(', ');
    log(`capture: ${manifest.frames.length} frame(s) of file version ${manifest.version}${fromCache ? ' from cache (no network)' : ''} → ${written.length} files under ${dir}/canon-source/ · endpoints: ${status}${manifest.cut.length ? ` · cut ${manifest.cut.length}` : ''}`);
    log(`next: read ${dir}/canon-source/role-candidates.json and module-candidates.json, author ${dir}/reskin/curation-rules.json, then run curate`);
    return 0;
  }

  if (cmd === 'curate') {
    const { runCurate } = await helper('curate');
    if (await confidentialMode(dir, opts, log)) { const g = await helper('guard'); g.assertIgnored(g.CURATE_OUTPUTS, { dir }); }
    const { donorTokens, inputs, written } = runCurate({ dir });
    const c = donorTokens.coverage;
    const mods = inputs.rules.modules || [];
    const excluded = mods.filter((m) => m.status === 'excluded').length;
    log(`curate: ${c.asserted}/13 probe paths asserted (${c.absent.filter((a) => a.probe).length} absent, ${c.suspect.length} suspect) · ${mods.length - excluded} module(s), ${excluded} excluded → ${written.join(', ')}`);
    for (const a of c.absent.filter((x) => x.probe)) log(`  absent ${a.path}: ${a.why}`);
    for (const p of c.recommended.missing) log(`note: recommended token not curated: ${p} (map it, or mark it absent with a why)`);
    for (const h of c.hollow || []) warn(`warning: module ${h.id} (${h.name}, frame ${h.frame}) is hollow: ${h.why}`);
    return 0;
  }

  if (cmd === 'stamp') {
    const [{ stampDesignSource }, { readCurrent, cacheFor }, { canonicalFigmaUrl }] = await Promise.all([helper('stamp'), helper('cache'), helper('url')]);
    const current = readCurrent(dir);
    const manifest = current && cacheFor(dir, current.fileKey).version(current.version).read('manifest.json');
    if (!manifest) throw new UsageError(`no capture found under ${dir}/.work/reskin/figma/: run capture and curate before stamp`);
    const lib = await stateLib();
    const { designSource } = stampDesignSource({ dir, donorUrl: canonicalFigmaUrl({ fileKey: manifest.fileKey, nodeId: manifest.nodeId }), capturedAt: manifest.capturedAt, confidential: await confidentialMode(dir, opts, log), stateLib: lib });
    log(`stamp: ${dir}/state.json designSource → ${designSource.url} (captured ${designSource.capturedAt}, path ${designSource.path})`);
    return 0;
  }
  return 2;
}

// The scripts use Node 22 APIs; an older runtime gets one clear line (exit 2) instead of a stack trace.
export const MIN_NODE = 22;
export function nodeVersionProblem(version = process.versions.node) {
  const major = Number.parseInt(String(version).replace(/^v/, ''), 10);
  return Number.isInteger(major) && major >= MIN_NODE ? null : `reskin needs Node ${MIN_NODE}+, found v${String(version).replace(/^v/, '')}`;
}

// Exit only once stdout and stderr have flushed: piped stdout is asynchronous on macOS, and an
// immediate process.exit cut --help short. A write's callback fires after every earlier write.
export function exitAfterFlush(code, { stdout = process.stdout, stderr = process.stderr, exit = process.exit } = {}) {
  process.exitCode = code;
  stdout.write('', () => stderr.write('', () => exit(code)));
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  const tooOld = nodeVersionProblem();
  if (tooOld) {
    console.error(`figma-donor: ${tooOld}`);
    exitAfterFlush(2);
  } else {
    main(process.argv.slice(2)).then((code) => exitAfterFlush(code), (e) => {
      const token = process.env.FIGMA_TOKEN;
      const msg = String(e?.message ?? e);
      console.error(`figma-donor: ${token ? msg.split(token).join('[redacted]') : msg}`);
      exitAfterFlush(e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 1));
    });
  }
}
