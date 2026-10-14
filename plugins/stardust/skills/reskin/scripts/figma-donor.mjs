#!/usr/bin/env node
// skills/reskin/scripts/figma-donor.mjs — Figma as a reskin design donor (reskin --donor-figma <url>;
// contract: skills/reskin/reference/donor-sources.md § 3). One CLI, helpers in ./figma/:
//   capture  Figma REST → raw cache (.work/reskin/figma/) → canon-source/ foundation, role and module
//            candidates, spec tables, frame screenshots and the crawl log. Network only here.
// The token comes from FIGMA_TOKEN only (never a flag, never logged), sent as X-Figma-Token to the
// Figma API base (FIGMA_API_BASE overrides it for tests); image bytes come from signed storage URLs
// fetched without it, and no signed URL is ever written to disk.
// Foundation records: { value, figma, node, count, nodes } (value = normalized CSS; typography and
// components carry an object of CSS strings) — see figma/foundation.mjs for keys and heuristics.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 ok · 1 validation or curate assertion failed · 2 usage, setup or 404 · 3 blocked
// (401/403, a 429 wait over --max-wait, 5xx after retries).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export const HELP = `Usage:
  node figma-donor.mjs capture <figma-url> [--frames <id,id>] [--max-frames 25] [--refresh]
                       [--max-wait 60] [--dir stardust]

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
         top-level frames; a frame → itself); else every top-level frame of every page. At most
         --max-frames (default 25) are captured; the rest are listed as cut on stderr and in the log.
         A re-run without --refresh rebuilds every output from the cache: no network, no token.
         --refresh fetches the file's current version into its own cache dir.
         --max-wait <s>: the longest Retry-After a 429 may impose before stopping (default 60).
--dir <d>  the stardust directory (default stardust).
Exit codes: 0 ok · 1 validation or curate assertion failed · 2 usage, setup or not found (404)
            · 3 blocked (401/403, a 429 wait over --max-wait, 5xx after retries).`;

const SPEC = {
  capture: { values: ['--frames', '--max-frames', '--max-wait', '--dir'], bools: ['--refresh'], positional: ['<figma-url>'] },
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
    const client = createClient({ token: env.FIGMA_TOKEN || '', base: env.FIGMA_API_BASE || undefined, maxWaitSec });
    const { manifest, written, fromCache } = await runCapture({ url: positional[0], frames, maxFrames, refresh: Boolean(opts.refresh), dir, client, warn });
    const status = manifest.endpoints.map((e) => `${e.name} ${e.status}`).join(', ');
    log(`capture: ${manifest.frames.length} frame(s) of file version ${manifest.version}${fromCache ? ' from cache (no network)' : ''} → ${written.length} files under ${dir}/canon-source/ · endpoints: ${status}${manifest.cut.length ? ` · cut ${manifest.cut.length}` : ''}`);
    log(`next: read ${dir}/canon-source/role-candidates.json and module-candidates.json, author ${dir}/reskin/curation-rules.json, then run curate`);
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
