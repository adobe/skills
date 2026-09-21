#!/usr/bin/env node
// Guard: the plugin root (plugins/stardust/) carries no project or runtime residue.
//
// Why: the plugin's own directory is named `stardust`, so any script that found
// its project root as "the nearest ancestor with a stardust/ dir" — run with cwd
// anywhere under plugins/stardust/ — picked `plugins/` as the root and treated the
// plugin as a project (2026-09-21 00:57): it wrote plugins/stardust/package.json +
// package-lock.json, installed a 19 MB plugins/stardust/node_modules (which then
// shadowed resolve-chain-smoke's fixture through Node's parent walk and made it
// OOM), and tests run at that cwd left plugins/stardust/.work/. A broad `git add -A`
// swept the manifest into a release commit. preflight-runtime.mjs findRoot now
// refuses the plugin tree; this lint is the backstop that keeps the tree clean
// whatever wrote into it.
//
// Findings (one line each, exit 1) — any of these at the plugin root:
//   package.json · package-lock.json · node_modules/ · .work/ · stardust/ (a project dir)
// Allowed: evals/runner/node_modules and evals/runner/results — the eval runner's
// own install and output (not at the plugin root; listed here so the rule is explicit).
// `--root <dir>` lints another tree (fixture testing).
//
// Usage: node plugins/stardust/evals/lint/plugin-tree.mjs [--root <plugin dir>]   (exit 1 on findings; exit 2 = usage)
import { existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: node plugin-tree.mjs [--root <plugin dir>]\n  no package.json, package-lock.json, node_modules/, .work/ or stardust/ at the plugin root   exit 1 on findings');
  process.exit(0);
}
const val = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) { console.error(`plugin-tree lint: ${n} needs a value (--help)`); process.exit(2); } return v; };
const unknown = args.filter((a) => a.startsWith('--') && !['--root', '--help'].includes(a));
if (unknown.length) { console.error(`plugin-tree lint: unknown flag ${unknown.join(' ')} (--help)`); process.exit(2); }
const ROOT = val('--root') ? resolve(val('--root')) : join(import.meta.dirname, '..', '..');
if (!existsSync(join(ROOT, '.claude-plugin', 'plugin.json'))) { console.error(`plugin-tree lint: ${ROOT} is not a plugin root (no .claude-plugin/plugin.json)`); process.exit(2); }

export const FORBIDDEN = [
  { name: 'package.json', kind: 'file', why: 'a stardust/package.json seeded by a preflight that took plugins/ for a project — the plugin declares no dependencies (lib/resolve.mjs resolves them)' },
  { name: 'package-lock.json', kind: 'file', why: 'lockfile of the same stray install' },
  { name: 'node_modules', kind: 'dir', why: 'a stray install here shadows every fixture below it through Node\'s parent walk (resolve-chain-smoke OOM)' },
  { name: '.work', kind: 'dir', why: 'project working state left by a script run with cwd inside the plugin' },
  { name: 'stardust', kind: 'dir', why: 'a project dir seeded inside the plugin' },
];
export const ALLOWED = ['evals/runner/node_modules', 'evals/runner/results'];

const show = (p) => { const r = relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };
/** Findings for one plugin root: `<path>: <what>` per forbidden entry present. */
export function lintPluginRoot(root) {
  const out = [];
  for (const { name, kind, why } of FORBIDDEN) {
    const p = join(root, name);
    let st; try { st = statSync(p); } catch { continue; }
    const is = kind === 'dir' ? st.isDirectory() : st.isFile();
    out.push(`${show(p)}: ${is ? kind : (st.isDirectory() ? 'dir' : 'file')} must not exist at the plugin root — ${why}; remove it (git rm --cached if tracked)`);
  }
  return out;
}

const findings = lintPluginRoot(ROOT);
if (findings.length) { console.error(`plugin-tree lint: ${findings.length} finding(s) at ${ROOT}\n${findings.join('\n')}`); process.exit(1); }
console.log(`plugin-tree lint: ${show(ROOT)} clean (no ${FORBIDDEN.map((f) => f.name + (f.kind === 'dir' ? '/' : '')).join(', ')}; ${ALLOWED.join(', ')} allowed)`);
