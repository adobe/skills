#!/usr/bin/env node
// skills/reskin/scripts/figma-donor.mjs — Figma as a reskin design donor (reskin --donor-figma <url>;
// contract: skills/reskin/reference/donor-sources.md § 3). One CLI, helpers in ./figma/:
//   capture  Figma REST → raw cache (.work/reskin/figma/) → canon-source/ foundation, role and module
//            candidates, spec tables, frame screenshots and the crawl log. Network only here.
//   curate   offline: foundation + reskin/curation-rules.json → reskin/donor-tokens.json,
//            reskin/donor-modules.md and canon-source/DESIGN.{md,json} + _brand-extraction.json
//            (figma/rules.mjs documents the rules, figma/curate.mjs and figma/design.mjs the outputs).
//   stamp    state.json designSource only, through the master skill's state.mjs (figma/stamp.mjs).
//   init     Figma-only project: a minimal state.json (flow reskin, no pages) through state.mjs.
//   pages    Phase 2′: every page of the file (FULL PAGES canvases) and the kit its blocks come from
//            (TEMPLATE SECTIONS / COMPONENTS canvases) → reskin/figma-pages.json (figma/pages.mjs core,
//            figma/pages-run.mjs I/O).
//   content  Phase 2′: one page frame → reskin/content-model/<slug>/ (figma/content.mjs core,
//            figma/content-run.mjs I/O); --all: every page of figma-pages.json, sections bound to the kit,
//            and reskin/mapping.seed.json; blocklist / ack: the deploy blocklist of flagged items.
// The token comes from FIGMA_TOKEN only (never a flag, never logged), sent as X-Figma-Token to the
// Figma API base (FIGMA_API_BASE overrides it for tests); image bytes come from signed storage URLs
// fetched without it, and no signed URL is ever written to disk.
// Foundation records: { value, figma, node, count, nodes } (value = normalized CSS; typography and
// components carry an object of CSS strings) — see figma/foundation.mjs for keys and heuristics.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 ok · 1 validation or curate assertion failed · 2 usage, setup or 404 · 3 blocked
// (401/403, a 429 wait over --max-wait, 5xx after retries).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);

export const HELP = `Usage:
  node figma-donor.mjs capture <figma-url> [--list] [--frames <id,id>] [--max-frames 25] [--refresh]
                       [--max-wait 60] [--confidential] [--dir stardust]
  node figma-donor.mjs curate [--confidential] [--dir stardust]
  node figma-donor.mjs stamp [--confidential] [--dir stardust]
  node figma-donor.mjs init <figma-url> [--confidential] [--dir stardust]
  node figma-donor.mjs pages <figma-url> [--refresh] [--max-wait 60] [--confidential] [--dir stardust]
  node figma-donor.mjs renders <figma-url> [--only <slug|block,…>] [--scale 1] [--refresh] [--max-wait 60] [--dir stardust]
  node figma-donor.mjs content <figma-url> --frame <id> --slug <slug> [--responsive <id>]
                       [--pages <id=slug,…>] [--no-chrome] [--force] [--confidential] [--dir stardust]
  node figma-donor.mjs content <figma-url> --all [--only <slug,…>] [--force] [--confidential] [--dir stardust]
  node figma-donor.mjs blocklist [<slug,…>] [--dir stardust]
  node figma-donor.mjs ack <slug> (--flag <key|id>[,…] | --all) --why "<reason>" [--by <who>] [--dir stardust]

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
         Frames: --frames <id,id> (12:34 or 12-34) wins; else the URL's node-id (a page → its
         top-level frames; a frame → itself); else every top-level frame of every page, only when
         that fits --max-frames (default 25; past it capture stops with exit 2). From a page, at
         most --max-frames are captured; the rest are listed as cut on stderr and in the log.
         --list prints every page and its top-level nodes (id, type, size, name) and writes no
         output: for a component kit, pick the foundation frames (colour, type, spacing, the button
         set) and one representative frame per module page, then capture them with --frames.
         A re-run without --refresh rebuilds every output from the cache: no network, no token; it
         refuses (exit 2) a cache whose manifest, saved selection and nodes disagree.
         --refresh fetches the file's current version into a staging dir and swaps it in only when
         complete: a failed or stopped refresh leaves the last complete capture (even of the same
         version) in place and served, and re-running the same selection resumes it. If a swap
         itself is cut short, readers (curate, stamp) still get that capture from its backup and
         the next capture restores it.
         --max-wait <s>: the longest Retry-After a 429 may impose before stopping (default 60).
curate   offline and deterministic: canon-source/foundation + module-candidates.json + the agent-
         authored <dir>/reskin/curation-rules.json → <dir>/reskin/donor-tokens.json (reskin's token
         sheet; nodeRefs cite the Figma node behind every value; coverage lists asserted, absent and
         suspect paths and recommended { curated, missing }), <dir>/reskin/donor-modules.md (the module vocabulary, one screenshot and
         node per row) and the descriptive design files direct reads: <dir>/canon-source/DESIGN.json,
         DESIGN.md and _brand-extraction.json (prose only from rules.design). Every rule problem is
         listed at once (exit 1). Re-run after any capture or rules change.
stamp    sets <dir>/state.json designSource = { url, capturedAt, path: "<dir>/canon-source/" } and
         nothing else, through the master skill's state.mjs (beside the scripts: the plugin tree, or
         stardust/scripts/stardust/state.mjs in a project copy). Needs state.json (from
         $stardust extract <content-url>) and canon-source/DESIGN.{md,json} (from curate); exit 2 otherwise.
--confidential  for a design that must not reach git: capture and curate first check, with
         git check-ignore, every path they would write or move (every foundation file, every
         screenshot, the cache files and the backup of a replaced capture once the file version is
         known) and refuse (exit 2, nothing written to it, no request for the fixed outputs) when
         one is not ignored or is already tracked, or when any file under foundation/, the
         screenshots or the cache is tracked; the message names the path and the exact lines to
         add to <dir>/.gitignore (or the git rm --cached a tracked file needs; capture's refusal
         also lists curate's lines, so one edit covers both, and a capture that passes warns when
         curate's are still missing); capture --list writes nothing and is not checked; stamp
         stores designSource.url as "figma:redacted" (state.json stays tracked).
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
                   "anatomy": "<slots>", "variants": [], "components": [], "status": "include" },
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
Figma as the CONTENT source (Figma-only sites, no live URL; reference/content-model.md
§ Figma-sourced models):
init     writes <dir>/state.json when there is none: _provenance, site.contentSource {kind figma},
         flow reskin (flowSource figma-only), pages []. Refuses an existing live-site state.json.
content  reads one page frame (--frame; a COMPONENT_SET variant, not the set) from the capture cache,
         or fetches it once with FIGMA_TOKEN, and writes reskin/content-model/<slug>/:
           content-model.json  source.kind figma: sections in reading order, rendered-case text
                               (characters + textCase kept), headings from donor type roles
           text-ops.json       figma-text-gate's text ops: TITLE caseless, drawn-field placeholders
           flags.json          every flagged item (alt, link targets, inferred fields, placeholder copy,
                               ambiguous order, legibility, derived title); block|review = blocklist
           assets/             image bytes, magic-byte sniffed. Without FIGMA_TOKEN supply them as
                               assets/<node-id-dashed>.<ext> (any channel) and re-run.
         and reskin/deltas/<slug>.json (the shared delta file, version 1: metadata.absent) unless one
         exists, and reskin/content-model/_chrome/content-model.json (header/footer slots) unless --no-chrome.
         Adds the page row (status extracted, source figma). --responsive <id>: the mobile variant;
         differing text is flagged. --pages maps NODE-link targets to slugs (12:34=about,…).
         Refuses to overwrite a live-sourced model or another frame's (--force replaces it).
         Optional rules: reskin/content-rules.json { chrome:{header,footer}, kinds:[{match,kind}],
         pages:{id:slug} } (kind: button|check|select|field|icon|logo|interactive).
pages    discovers every page of a design-system file, not only the linked node. Canvases are grouped by
         marker canvases (FOUNDATIONS, COMPONENTS, TEMPLATE SECTIONS, FULL PAGES) and prefix glyphs
         (❖ component, ❏ template, ↪ foundation); on each pages canvas a COMPONENT_SET is a page family
         (variant Type=Login Landing, Breakpoint=Desktop → page login-landing, desktop frame; the mobile
         or tablet variant is its responsive frame) — without a set, top-level frames are pages, paired
         by name with breakpoint words stripped. Frames beside a set and names like "Page: …", "Cover"
         are documentation, listed as skipped. The block library is every template and component
         canvas (read to kit.depth, default 5), used by a page or not: one EDS block per canvas (name
         from the canvas, its public sets variant classes, its "." sets parts; kit.blockPer "set" for
         one block per public set) and one donor module (M1… in canvas order). Each page binds only the
         blocks it instances (variant classes from the set's non-breakpoint properties); a set no kit
         canvas holds becomes an off-kit block. Writes reskin/figma-pages.json: pages, skipped,
         kit {blockPer, blocks, index, offKit, unused, emptyCanvases}, chromeSource (the commonest header),
         links (every variant id → slug), captureFrames (every block's main set, for capture --frames;
         raise --max-frames past their count) and modules
         (the curation-rules.json modules[] seed). Frames are cached under
         <dir>/.work/reskin/figma/<file-key>/_pages/<version>/. Overrides: content-rules.json kit
         { markers:{group:regex}, prefixes:{glyph:group}, canvases:{id:group}, breakpointProp, exclude,
         blockPer, depth }.
renders  fetches the references the exact-fidelity gates compare against (figma-gate.mjs exact | library,
         reference/gates.md § (f)): a PNG of every breakpoint frame of every page in figma-pages.json and of
         every variant of every kit block's public sets — the whole library, used on a page or not — at
         --scale (default 1), cached under <dir>/.work/reskin/figma/<file-key>/_pages/<version>/png/.
         Writes reskin/figma-renders.json: pages.<slug>[] { breakpoint, id, png }, library.<block>
         { module, used, variants[] { id, set, setClass, name, classes, breakpoint, w, h, texts, png } } —
         texts is the variant's copy in reading order, the content its library page must show. --only
         limits it to pages or blocks (merged into an existing file).
content --all  runs content for every page of figma-pages.json (--only a subset): the chrome page
         first (its chrome becomes _chrome), the others --no-chrome, NODE links resolved through the
         page map, each section bound to its kit block (section.kit; kit.unbound / kit.mixed flags
         when a section has no kit instance or several blocks), then reskin/mapping.seed.json — the
         mapping.json shape with module / block / variant / instance per slot (mapping.json itself is
         never written). A page that fails is reported and the others still run.
blocklist exits 1 while any block|review item of the slugs (default: every figma page) is open.
ack      records an acknowledgement for open items (key "<flag id>@<node>", or a flag id), with --why.
         A placeholder-only page cannot be acknowledged.
Exit codes: 0 ok · 1 validation or curate assertion failed, open blocklist · 2 usage, setup or not found (404)
            · 3 blocked (401/403, a 429 wait over --max-wait, 5xx after retries).`;

const SPEC = {
  capture: { values: ['--frames', '--max-frames', '--max-wait', '--dir'], bools: ['--refresh', '--confidential', '--list'], positional: ['<figma-url>'] },
  curate: { values: ['--dir'], bools: ['--confidential'], positional: [] },
  stamp: { values: ['--dir'], bools: ['--confidential'], positional: [] },
  init: { values: ['--dir'], bools: ['--confidential'], positional: ['<figma-url>'] },
  pages: { values: ['--max-wait', '--dir'], bools: ['--refresh', '--confidential'], positional: ['<figma-url>'] },
  renders: { values: ['--only', '--scale', '--max-wait', '--dir'], bools: ['--refresh'], positional: ['<figma-url>'] },
  content: { values: ['--frame', '--slug', '--responsive', '--pages', '--only', '--max-wait', '--dir'], bools: ['--no-chrome', '--force', '--confidential', '--all'], positional: ['<figma-url>'] },
  blocklist: { values: ['--dir'], bools: [], positional: [], optional: ['<slug,…>'] },
  ack: { values: ['--flag', '--why', '--by', '--dir'], bools: ['--all'], positional: ['<slug>'] },
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
  if (positional.length > spec.positional.length + (spec.optional?.length || 0)) throw new UsageError(`unexpected argument "${positional[spec.positional.length]}"`);
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
    const maxFrames = intFlag(opts, 'max-frames', 25, UsageError);
    const maxWaitSec = intFlag(opts, 'max-wait', 60, UsageError);
    // --list writes nothing, so --confidential has nothing to check for it.
    if (opts.list) {
      const { listInventory } = await helper('capture');
      const client = createClient({ token: env.FIGMA_TOKEN || '', base: env.FIGMA_API_BASE || undefined, maxWaitSec });
      const { lines } = await listInventory({ url: positional[0], refresh: Boolean(opts.refresh), dir, client });
      for (const l of lines) log(l);
      log('next: capture <figma-url> --frames <id,id,…> with the foundation frames and one representative frame per module');
      return 0;
    }
    const confidential = await confidentialMode(dir, opts, log);
    if (confidential) {
      const g = await helper('guard'); g.assertIgnored(g.CAPTURE_OUTPUTS, { dir, namespaces: g.CAPTURE_NAMESPACES, later: g.CURATE_OUTPUTS });
      const missing = g.laterLines(g.CURATE_OUTPUTS, { dir });
      if (missing.length) warn(`--confidential: curate will refuse until ${dir}/.gitignore also has: ${missing.join(' · ')}`);
    }
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

  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nodeFlag = (name) => {
    const id = String(opts[name] || '').trim().replace(/-/g, ':');
    if (!/^I?\d+:\d+(?:;\d+:\d+)*$/.test(id)) throw new UsageError(`--${name} takes a node id like 12:34 or 12-34, got "${opts[name] ?? ''}"`);
    return id;
  };

  if (cmd === 'init') {
    const { runInit } = await helper('content-run');
    const { state, created } = runInit({ dir, url: positional[0], confidential: Boolean(opts.confidential), stateLib: await stateLib(), at });
    log(created ? `init: ${dir}/state.json → flow reskin, content source ${state.site.contentSource.url}, 0 pages` : `init: ${dir}/state.json is already a Figma-only reskin project (nothing written)`);
    log('next: pages <figma-url> (every page + the kit), capture --frames <foundation + captureFrames>, curate, then content <figma-url> --all');
    return 0;
  }

  if (cmd === 'pages') {
    const [{ runPages }, { createClient }] = await Promise.all([helper('pages-run'), helper('client')]);
    const confidential = await confidentialMode(dir, opts, log);
    if (confidential) { const g = await helper('guard'); g.assertIgnored([['reskin/figma-pages.json', 'reskin/figma-pages.json']], { dir }); }
    const client = env.FIGMA_TOKEN ? Object.assign(createClient({ token: env.FIGMA_TOKEN, base: env.FIGMA_API_BASE || undefined, maxWaitSec: intFlag(opts, 'max-wait', 60, UsageError) }), { hasToken: true }) : null;
    const r = await runPages({ dir, url: positional[0], client, at, refresh: Boolean(opts.refresh), confidential, warn });
    const m = r.manifest;
    log(`pages: ${m.pages.length} page(s) on ${m.canvases.filter((c) => c.group === 'pages').length} pages canvas(es), ${m.skipped.length} skipped · ${r.fetched} frame(s) fetched → ${r.file}`);
    for (const p of m.pages) log(`  ${p.slug} ← ${p.frame}${p.responsive ? ` (+${p.responsive})` : ''} · ${(p.bindings || []).map((b) => b.block || '?').join(' + ') || 'no kit instance'}`);
    const used = m.kit.blocks.filter((b) => b.used);
    log(`kit library: ${m.kit.blocks.length} block(s), ${used.length} used on pages, ${m.kit.unused.length} library-only`);
    log(`  used: ${used.map((b) => `${b.block} ${b.module} [${b.group || 'off-kit'}] ×${b.instances}`).join(', ') || 'none'}`);
    if (m.kit.unused.length) log(`  library-only: ${m.kit.unused.map((u) => `${u.block} ${u.module}`).join(', ')}`);
    if (m.kit.offKit.length) log(`  off-kit: ${m.kit.offKit.map((o) => `${o.block} (${o.why})`).join('; ')}`);
    if (m.kit.emptyCanvases?.length) log(`  empty kit canvases: ${m.kit.emptyCanvases.map((e) => `${e.name} (${e.why})`).join('; ')}`);
    log(`chrome from ${m.chromeSource}`);
    log(`next: capture <figma-url> --frames <foundation frames>,${m.captureFrames.join(',')} --max-frames ${m.captureFrames.length + 10}; add figma-pages.json modules[] to curation-rules.json; curate; stamp; content <figma-url> --all`);
    return 0;
  }

  if (cmd === 'renders') {
    const [{ runRenders }, { createClient }] = await Promise.all([helper('renders'), helper('client')]);
    if (await confidentialMode(dir, opts, log)) { const g = await helper('guard'); g.assertIgnored([['reskin/figma-renders.json', 'reskin/figma-renders.json']], { dir }); }
    const client = env.FIGMA_TOKEN ? Object.assign(createClient({ token: env.FIGMA_TOKEN, base: env.FIGMA_API_BASE || undefined, maxWaitSec: intFlag(opts, 'max-wait', 60, UsageError) }), { hasToken: true }) : null;
    const scale = opts.scale === undefined ? 1 : Number(opts.scale);
    const only = opts.only ? opts.only.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const r = await runRenders({ dir, url: positional[0], client, at, scale, refresh: Boolean(opts.refresh), only, warn });
    log(`renders: ${r.counts.pages} page frame(s), ${r.counts.variants} variant(s) of ${r.counts.blocks} block(s) · ${r.fetched} PNG(s) fetched in ${r.calls} call(s) → ${r.file}`);
    if (r.failed.length) { log(`  not rendered by Figma: ${r.failed.join(', ')}`); return 1; }
    log('next: build the pages and one library page per block (every variant as [data-kit-component="<id>"]), then figma-gate.mjs exact --page <slug> and figma-gate.mjs library --url-pattern <…/{block}>');
    return 0;
  }

  if (cmd === 'content' && opts.all) {
    const [{ runContentAll }, { createClient }] = await Promise.all([helper('pages-run'), helper('client')]);
    if (opts.frame || opts.slug || opts.responsive || opts.pages) throw new UsageError('content --all takes its frames, slugs and page map from reskin/figma-pages.json: drop --frame/--slug/--responsive/--pages');
    const only = opts.only ? opts.only.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const confidential = await confidentialMode(dir, opts, log);
    if (confidential) { const g = await helper('guard'); g.assertIgnored([...g.contentOutputs('x'), ['reskin/mapping.seed.json', 'reskin/mapping.seed.json']], { dir }); }
    const client = env.FIGMA_TOKEN ? Object.assign(createClient({ token: env.FIGMA_TOKEN, base: env.FIGMA_API_BASE || undefined, maxWaitSec: intFlag(opts, 'max-wait', 60, UsageError) }), { hasToken: true }) : null;
    const r = await runContentAll({ dir, url: positional[0], client, stateLib: await stateLib(), at, only, force: Boolean(opts.force), confidential, warn });
    let open = 0;
    for (const [slug, x] of Object.entries(r.results)) {
      const c = x.report.counts;
      open += c.open;
      const bound = x.model.sections.map((s) => s.kit?.block || (s.kit?.mixed ? 'mixed' : '—')).join(' + ');
      log(`content: ${slug} · ${x.model.sections.length} section(s) [${bound}], ${x.images.got} image(s)${x.images.missing ? `, ${x.images.missing} missing` : ''} · ${c.open} open${x.placeholderOnly ? ' · PLACEHOLDER-ONLY' : ''}${x.chrome ? ' · chrome' : ''}`);
    }
    for (const f of r.failed) warn(`content: ${f.slug} failed: ${f.why}`);
    log(`content --all: ${Object.keys(r.results).length} page(s), ${r.failed.length} failed, ${open} open flag(s) · mapping seed → ${r.file}`);
    log('next: blocklist / ack; copy mapping.seed.json to mapping.json and add layout per slot (Phase 3); render; Phase 5 gates');
    return r.failed.length || Object.values(r.results).some((x) => x.placeholderOnly) ? 1 : 0;
  }

  if (cmd === 'content') {
    const [{ runContent }, { createClient }] = await Promise.all([helper('content-run'), helper('client')]);
    if (!opts.slug) throw new UsageError('content needs --slug <slug> (or --all for every page of figma-pages.json)');
    const frameId = nodeFlag('frame');
    const responsiveId = opts.responsive ? nodeFlag('responsive') : null;
    const pages = {};
    for (const pair of String(opts.pages || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const m = pair.match(/^(I?\d+[:-]\d+)=([a-z0-9][a-z0-9-/]*)$/);
      if (!m) throw new UsageError(`--pages takes id=slug pairs (12:34=about), got "${pair}"`);
      pages[m[1].replace(/-/g, ':')] = m[2];
    }
    const confidential = await confidentialMode(dir, opts, log);
    if (confidential) { const g = await helper('guard'); g.assertIgnored(g.contentOutputs(opts.slug), { dir }); }
    const client = env.FIGMA_TOKEN ? Object.assign(createClient({ token: env.FIGMA_TOKEN, base: env.FIGMA_API_BASE || undefined, maxWaitSec: intFlag(opts, 'max-wait', 60, UsageError) }), { hasToken: true }) : null;
    const r = await runContent({ dir, url: positional[0], frameId, slug: opts.slug, responsiveId, pages, noChrome: Boolean(opts['no-chrome']), force: Boolean(opts.force), confidential, client, stateLib: await stateLib(), at, warn });
    const c = r.report.counts;
    log(`content: ${opts.slug} ← ${frameId} · ${r.model.sections.length} section(s), ${r.model.visibleTextNormalized.length} chars, ${r.images.got} image(s)${r.images.missing ? `, ${r.images.missing} missing bytes` : ''}${r.chrome ? ` · chrome header ${r.chrome.header.join(',') || '-'} footer ${r.chrome.footer.join(',') || '-'}` : ''} → ${r.out}/`);
    log(`flags: ${c.block} block, ${c.review} review, ${c.info} info · ${c.open} open on the deploy blocklist (figma-donor.mjs blocklist ${opts.slug})`);
    for (const f of r.report.open.slice(0, 12)) log(`  ${f.severity} ${f.key}: ${f.detail}`);
    if (r.report.open.length > 12) log(`  … ${r.report.open.length - 12} more in ${r.out}/flags.json`);
    if (r.placeholderOnly) { warn(`content: ${opts.slug} is placeholder copy only — stop: there is no real content to reskin (#310 real-content rule)`); return 1; }
    log('next: confirm the sections, reading order and canonical variant; map the slots (Phase 3), render, then the Phase 5 gates incl. figma-text-gate.mjs');
    return 0;
  }

  if (cmd === 'blocklist') {
    const { blocklist } = await helper('content-run');
    let slugs = positional[0] ? positional[0].split(',').map((x) => x.trim()).filter(Boolean) : null;
    if (!slugs) {
      const { readState } = await stateLib();
      slugs = readState(dir).state.pages.filter((p) => p.source === 'figma').map((p) => p.slug);
      if (!slugs.length) throw new UsageError(`no Figma-sourced page in ${dir}/state.json`);
    }
    const rows = blocklist(dir, slugs);
    let open = 0;
    for (const r of rows) {
      open += r.open.length;
      log(`${r.slug}: ${r.placeholderOnly ? 'PLACEHOLDER-ONLY · ' : ''}${r.open.length} open (${r.counts.block} block, ${r.counts.review} review, ${r.counts.info} info)`);
      for (const f of r.open) log(`  ${f.severity} ${f.key}: ${f.detail}`);
    }
    if (open || rows.some((r) => r.placeholderOnly)) { log(`blocklist: ${open} open item(s) — fix them in Figma and re-run content, or acknowledge them (figma-donor.mjs ack <slug> --flag <key> --why "…") before deploy`); return 1; }
    log('blocklist: clear — deploy may proceed (isolated preview, never over an existing DA document)');
    return 0;
  }

  if (cmd === 'ack') {
    const { acknowledge } = await helper('content-run');
    if (!opts.all && !opts.flag) throw new UsageError('ack needs --flag <key|id>[,…] or --all');
    const done = acknowledge(dir, positional[0], { keys: String(opts.flag || '').split(',').map((x) => x.trim()).filter(Boolean), all: Boolean(opts.all), why: opts.why, by: opts.by, at });
    log(`ack: ${positional[0]} · ${done.length} item(s) acknowledged: ${done.map((f) => f.key).join(', ')}`);
    return 0;
  }
  return 2;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    const token = process.env.FIGMA_TOKEN;
    const msg = String(e?.message ?? e);
    console.error(`figma-donor: ${token ? msg.split(token).join('[redacted]') : msg}`);
    process.exit(e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 1));
  });
}
