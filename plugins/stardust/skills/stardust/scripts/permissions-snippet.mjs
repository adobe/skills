#!/usr/bin/env node
// Emit a Claude Code `permissions.allow` block for a stardust run.
//
// Why: a permission layer denies the run's own instruments (the shipped
// scripts, the local server, `aem up`, `gh api` reads) as readily as the
// owner's privileged actions. The instrument class can be pre-approved; this
// generator derives the allowlist from the shipped script tree so nothing is
// hand-maintained and a renamed script cannot leave a stale rule behind.
// Rule semantics: Claude Code matches a `Bash(<prefix>:*)` rule against the
// bare command only — no `cd …;` chain, no `&&`, no heredoc in front.
// (`skills/stardust/reference/harness-permissions.md` § Pre-approval)
//
// Usage:
//   node skills/stardust/scripts/permissions-snippet.mjs [--plugin-dir <abs>]
//        [--no-project-copies] [--with-curl] [--allow-only]
//   --plugin-dir        absolute path the rules cite for the plugin's scripts
//                       (default: this plugin's install dir)
//   --no-project-copies omit the `node stardust/scripts/<skill>/<x>` shapes
//                       (project copies made by replica/diff Setup)
//   --with-curl         add `Bash(curl:*)` — a prefix rule cannot be scoped to
//                       admin.da.live / admin.hlx.page, so it is opt-in
//   --allow-only        print the bare `allow` array instead of the settings object
// Prints JSON on stdout; redirect into `.claude/settings.local.json` when the
// file does not exist, otherwise merge the `allow` entries by hand. Exit 0.
// No dependencies.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

// Fixed instrument shapes named in the harness-permissions card. `ships` is the
// plugin file the shape's project copy comes from (checked by evals/lint).
export const FIXED_SHAPES = [
  { rule: 'Bash(stardust/scripts/replica/gate.sh:*)', ships: 'skills/replica/scripts/gate.sh' },
  { rule: 'Bash(bash stardust/scripts/replica/gate.sh:*)', ships: 'skills/replica/scripts/gate.sh' },
  { rule: 'Bash(python3 -m http.server:*)' },
  { rule: 'Bash(aem up:*)' },
  { rule: 'Bash(npx -y @adobe/aem-cli up:*)' },
  { rule: 'Bash(gh api user)' },
  { rule: 'Bash(gh api repos/:*)' },
  { rule: 'Bash(gh api orgs/:*)' },
  { rule: 'Bash(git push --dry-run:*)' },
];
export const CURL_SHAPES = ['Bash(curl:*)'];

const RUNNERS = { '.mjs': 'node', '.js': 'node', '.py': 'python3', '.sh': 'bash' };
const SKIP_DIRS = new Set(['test', 'tests', 'fixtures', 'node_modules']);

/** Every runnable script under skills/<skill>/scripts/**, as { skill, rel, runner }. */
export function scriptInventory(root = PLUGIN_ROOT) {
  const skillsDir = join(root, 'skills');
  const out = [];
  for (const skill of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, skill, 'scripts');
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    (function walk(d) {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(e)) walk(p); continue; }
        const ext = e.slice(e.lastIndexOf('.'));
        if (RUNNERS[ext]) out.push({ skill, rel: relative(dir, p), runner: RUNNERS[ext] });
      }
    })(dir);
  }
  return out;
}

/** The settings object: { permissions: { allow: [...] } }. */
export function generate({ pluginDir = PLUGIN_ROOT, projectCopies = true, withCurl = false, root = PLUGIN_ROOT } = {}) {
  const allow = new Set();
  for (const { skill, rel, runner } of scriptInventory(root)) {
    allow.add(`Bash(${runner} ${pluginDir}/skills/${skill}/scripts/${rel}:*)`);
    if (projectCopies) allow.add(`Bash(${runner} stardust/scripts/${skill}/${rel}:*)`);
  }
  for (const { rule } of FIXED_SHAPES) allow.add(rule);
  if (withCurl) for (const rule of CURL_SHAPES) allow.add(rule);
  return { permissions: { allow: [...allow].sort() } };
}

function main(argv) {
  const opts = { pluginDir: PLUGIN_ROOT, projectCopies: true, withCurl: false };
  let allowOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      const src = fileURLToPath(import.meta.url);
      process.stdout.write(`${relative(process.cwd(), src)} — emit a Claude Code permissions.allow block for a stardust run\n\n`);
      process.stdout.write('  --plugin-dir <abs>    plugin path the rules cite (default: this install)\n  --no-project-copies   omit node stardust/scripts/<skill>/<x> shapes\n  --with-curl           add Bash(curl:*) (opt-in: prefix rules cannot be host-scoped)\n  --allow-only          print the bare allow array\n\nPrints JSON; redirect into .claude/settings.local.json or merge the allow entries. Exit 0.\n');
      return 0;
    }
    if (k === '--plugin-dir') opts.pluginDir = resolve(argv[(i += 1)] || '');
    else if (k === '--no-project-copies') opts.projectCopies = false;
    else if (k === '--with-curl') opts.withCurl = true;
    else if (k === '--allow-only') allowOnly = true;
    else { process.stderr.write(`unknown arg: ${k} (try --help)\n`); return 2; }
  }
  const out = generate(opts);
  process.stdout.write(`${JSON.stringify(allowOnly ? out.permissions.allow : out, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
