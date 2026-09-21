/**
 * skills/stardust/scripts/lib/resolve.mjs — how a plugin script finds its
 * runtime dependencies and a sibling skill's script.
 *
 * Plugin scripts live outside any node_modules tree, so a bare
 * `import 'playwright'` only works from a project copy. Every importer goes
 * through this ONE additive chain instead (reference/runtime-preflight.md
 * § Resolution chain) — a script that resolved yesterday resolves today from
 * the same link:
 *   1. the calling script's own directory   (`from: import.meta.url`; Node default, legacy copies)
 *   2. process.cwd()                        (the project root's node_modules)
 *   3. the nearest `stardust/package.json` walking up from cwd (preflight-runtime.mjs's dir)
 *   4. `npm root -g`                        (a global install; local subprocess, no network)
 * Missing at every link → one line, exit 2 through `exit2` — no verdict, the
 * same class as exit 124 ≠ FAIL:
 *   <script>: cannot resolve '<name>' from <cwd> — run node skills/stardust/scripts/preflight-runtime.mjs (master § Setup step 10)
 *
 *   import { resolveDep, resolveDeps, siblingScript, exit2 } from '../../stardust/scripts/lib/resolve.mjs';
 *   const { chromium } = await resolveDep('playwright', { from: import.meta.url }).catch(exit2);
 *   const { pixelmatch, pngjs } = await resolveDeps(['pixelmatch', 'pngjs'], { from: import.meta.url }).catch(exit2);
 *   const live = await import(pathToFileURL(siblingScript('diff', 'live-session.mjs', { from: import.meta.url })).href);
 *
 * siblingScript(skill, file) tries the plugin layout (`../../<skill>/scripts/<file>`
 * from the caller), `$STARDUST_SKILLS_DIR/<skill>/scripts/<file>` (skills-directory
 * installs), then the flat copy layout (`../<skill>/<file>`, legacy project copies —
 * kept for one minor version); it throws naming the three when none exists.
 * Pure resolution: no file is written, no request is made.
 */
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PREFLIGHT_HINT = 'run node skills/stardust/scripts/preflight-runtime.mjs (master § Setup step 10)';

const toPath = (from) => (from ? (from.startsWith('file:') ? fileURLToPath(from) : from) : null);
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** Nearest ancestor of `dir` (inclusive) that holds `stardust/package.json`, or null. A `stardust/` that is the plugin
 *  itself (`.claude-plugin/plugin.json` — the plugin dir is named `stardust`) is skipped: it must never carry a
 *  package.json, and if one leaks in it is not a project's dependency dir. */
export function nearestStardustDir(dir) {
  let d = resolve(dir);
  for (;;) {
    const sd = join(d, 'stardust');
    if (existsSync(join(sd, 'package.json')) && !existsSync(join(sd, '.claude-plugin', 'plugin.json'))) return sd;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** `npm root -g`, or null when npm is absent or prints nothing. */
export function npmRootG({ env = process.env } = {}) {
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', env });
  const out = r.status === 0 ? r.stdout.trim() : '';
  return out && isDir(out) ? out : null;
}

/** The chain's anchors, in order, as directories a createRequire can start from. */
export function chainDirs({ from = null, cwd = process.cwd(), env = process.env, global = true } = {}) {
  const dirs = [];
  const fromPath = toPath(from);
  if (fromPath) dirs.push(dirname(fromPath));
  dirs.push(cwd);
  const sd = nearestStardustDir(cwd);
  if (sd) dirs.push(sd);
  if (global) { const g = npmRootG({ env }); if (g) dirs.push(dirname(g)); }
  return [...new Set(dirs)];
}

/** Absolute path of `name`'s entry file through the chain, or throws the one-line error. */
export function resolveDepPath(name, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  for (const dir of chainDirs({ ...opts, cwd })) {
    try { return createRequire(join(dir, 'noop.js')).resolve(name); } catch { /* next link */ }
  }
  const script = opts.script ?? basename(process.argv[1] ?? 'script');
  throw new Error(`${script}: cannot resolve '${name}' from ${cwd} — ${PREFLIGHT_HINT}`);
}

/**
 * The module's real API: a CJS package imported through ESM carries its exports object under `module.exports`
 * (Node ≥ 22) beside whatever names the lexer detected — playwright's namespace has fifteen keys and no
 * `chromium`; on older Node the `default` object is the superset of every detected name. A true ESM module
 * (named exports not on `default`) is returned as is; a default-only namespace (pixelmatch) yields the default.
 */
const normalize = (m) => {
  if (!m || typeof m !== 'object') return m;
  if ('module.exports' in m) return m['module.exports'];
  const d = m.default;
  if (d && (typeof d === 'object' || typeof d === 'function') && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in d)) return d;
  return m;
};

/** The module for `name` through the chain (`default` normalised), or throws. */
export async function resolveDep(name, opts = {}) {
  return normalize(await import(pathToFileURL(resolveDepPath(name, opts)).href));
}

/** `{ [name]: module }` for every name — the first miss throws, naming that name. */
export async function resolveDeps(names, opts = {}) {
  const out = {};
  for (const n of names) out[n] = await resolveDep(n, opts);
  return out;
}

/** Absolute path of `skills/<skill>/scripts/<file>` from the caller's layout, or throws naming the three tried. */
export function siblingScript(skill, file, { from, env = process.env } = {}) {
  const here = dirname(toPath(from) ?? process.argv[1] ?? process.cwd());
  const tried = [
    resolve(here, '..', '..', skill, 'scripts', file),
    env.STARDUST_SKILLS_DIR ? resolve(env.STARDUST_SKILLS_DIR, skill, 'scripts', file) : null,
    resolve(here, '..', skill, file),
  ].filter(Boolean);
  const hit = tried.find((p) => existsSync(p));
  if (hit) return hit;
  throw new Error(`${basename(process.argv[1] ?? 'script')}: sibling script ${skill}/${file} not found — tried ${tried.join(', ')}${env.STARDUST_SKILLS_DIR ? '' : ' (set STARDUST_SKILLS_DIR for a skills-directory install)'}`);
}

/** CLI wrapper: print the one line and exit 2 (no verdict). */
export function exit2(err) {
  console.error(err?.message ?? String(err));
  process.exit(2);
}
