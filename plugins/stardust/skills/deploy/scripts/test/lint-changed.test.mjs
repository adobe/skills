#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/code-sync-verify.mjs --lint (T22.3 — the syntax + lint gate before a code commit).
 * Run: node skills/deploy/scripts/test/lint-changed.test.mjs   (exit 1 on failure)
 *
 * A boilerplate-shaped temp project (package.json WITHOUT "type":"module") with shim executables in
 * node_modules/.bin/{eslint,stylelint} (print one error and exit 1 when a file name contains `bad`,
 * else exit 0; append argv to a log). Pins:
 *   - the ESM-safe stage: a duplicate `const` in blocks/header/header.js → exit 2 naming
 *     `already been declared` WITH THE SHIMS REMOVED — while plain `node --check <file>.js` exits 0 on the
 *     same file (why `--input-type=module` is required);
 *   - unavailable ≠ clean: a clean file with no .bin/eslint → exit 2 "lint: unavailable … npm ci --legacy-peer-deps";
 *     with --syntax-only → exit 0 and stdout carries `lint: unavailable (`; a shim answering
 *     `Failed to load parser` → unavailable too; a tool is required only for a file class in the list
 *     (a CSS-only change passes with stylelint alone; eslint alone lints a JS-only change);
 *   - no silent pass: a root that is not a git work tree (or has no commit yet) without --files → exit 1
 *     "cannot list changed files — pass --files", never "nothing to lint" (a duplicate const sits in the tree);
 *   - scoping: after `git commit` of everything, changing only cards.js + cards.css passes exactly those
 *     two paths to the shims (untracked files count, untouched files never); --files overrides;
 *   - findings block: a changed `bad-cards.js` → exit 2 with the shim's error line; warnings-only (exit 0
 *     from the tool) pass; nothing to lint → exit 0; --json shape; --help 0;
 *   - a crashed toolchain is never clean (the reviewer-reproduced defect): an eslint shim exiting 2 with
 *     `ESLint couldn't find the config "airbnb-base" to extend from` and a stylelint shim exiting 78 with
 *     `Error: No configuration provided` → exit 2 `lint: unavailable (eslint exited 2 — …; stylelint exited
 *     78 — …)`, never `file(s) clean`; a tool exiting 1 with an unmatched message → one `exited 1 — <line>`
 *     finding, exit 2;
 *   - a `--files` entry that does not exist (.js or .css) → `not found` finding, `syntax FAIL` row, exit 2,
 *     the file never passed to a tool, no TypeError.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFiles, syntaxCheck } from '../code-sync-verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'code-sync-verify.mjs');
const root = mkdtempSync(join(tmpdir(), 'lint-changed-'));
const log = join(root, 'shim.log');
const w = (p, body) => { mkdirSync(join(root, dirname(p)), { recursive: true }); writeFileSync(join(root, p), body); };
w('package.json', JSON.stringify({ name: 'site', scripts: { lint: 'eslint . && stylelint blocks/**/*.css' } }, null, 2)); // no "type":"module" — the boilerplate shape
w('blocks/header/header.js', 'export default function decorate(block) {\n  const logoWrap = block.querySelector("p");\n  const logoWrap = document.createElement("div");\n  block.append(logoWrap);\n}\n');
w('blocks/cards/cards.js', 'export default function decorate(block) { block.classList.add("ready"); }\n');
w('blocks/cards/cards.css', '.cards { display: grid; }\n');
w('styles/styles.css', ':root { --brand: #123; }\n');
w('scripts/scripts.js', 'export function buildAutoBlocks() {}\n');
w('head.html', '<meta charset="utf-8">\n');
const shim = (name, mode = 'ok') => {
  const p = join(root, 'node_modules', '.bin', name);
  mkdirSync(dirname(p), { recursive: true });
  const body = mode === 'parser'
    ? `#!/bin/sh\necho "$0 $@" >> "${log}"\necho "Oops! Something went wrong! :(\\nESLint: 8.57.1\\nError: Failed to load parser '@babel/eslint-parser' declared in '.eslintrc.js': Cannot find module '@babel/core/package.json'" >&2\nexit 2\n`
    : mode === 'noconfig-eslint'
    ? `#!/bin/sh\necho "${name} $@" >> "${log}"\necho "\nOops! Something went wrong! :(\n\nESLint: 8.57.1\n\nESLint couldn't find the config \\"airbnb-base\\" to extend from. Please check that the name of the config is correct." >&2\nexit 2\n`
    : mode === 'noconfig-stylelint'
    ? `#!/bin/sh\necho "${name} $@" >> "${log}"\necho "Error: No configuration provided for $1" >&2\nexit 78\n`
    : mode === 'odd-exit'
    ? `#!/bin/sh\necho "${name} $@" >> "${log}"\necho "shim: something unexpected happened" >&2\nexit 1\n`
    : `#!/bin/sh\necho "${name} $@" >> "${log}"\nfor f in "$@"; do case "$f" in *bad*) echo "$f\\n  1:1  error  shim: file named bad  no-bad"; echo "✖ 1 problem (1 error, 0 warnings)"; exit 1;; *warn*) echo "$f\\n  1:1  warning  shim warning  no-warn"; echo "✖ 1 problem (0 errors, 1 warning)";; esac; done\nexit 0\n`;
  writeFileSync(p, body); chmodSync(p, 0o755);
};
const rmShims = () => rmSync(join(root, 'node_modules'), { recursive: true, force: true });
const run = (...args) => spawnSync(process.execPath, [CLI, '--lint', '--root', root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root } });
const g = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.test', ...args], { cwd: root, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const shimPaths = (tool) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith(`${tool} `)).flatMap((l) => l.split(' ').slice(1)) : []);

try {
  // the false negative this gate replaces, pinned: plain node --check passes the duplicate declaration on a CJS-typed repo
  const plain = spawnSync(process.execPath, ['--check', join(root, 'blocks/header/header.js')], { encoding: 'utf8' });
  assert.equal(plain.status, 0, 'plain `node --check <file>.js` must pass here (no "type":"module") — the recorded false negative');
  assert.match(syntaxCheck(root, 'blocks/header/header.js'), /line 3: SyntaxError: Identifier 'logoWrap' has already been declared/);
  assert.equal(syntaxCheck(root, 'blocks/cards/cards.js'), null);

  // 1. syntax stage alone catches it, shims absent
  let r = run('--files', 'blocks/header/header.js');
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /blocks\/header\/header\.js {2}syntax FAIL/);
  assert.match(r.stdout, /✗ blocks\/header\/header\.js: line 3: SyntaxError: Identifier 'logoWrap' has already been declared/);

  // 2. unavailable ≠ clean
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css');
  assert.equal(r.status, 2, 'no eslint/stylelint → exit 2, never a pass');
  assert.match(r.stderr, /lint: unavailable \(eslint, stylelint do not resolve from .*node_modules\/\.bin\) — run `npm ci --legacy-peer-deps` in /);
  assert.match(r.stderr, /Unavailable is never clean \(exit 2\)/);
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css', '--syntax-only');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^lint: unavailable \(eslint, stylelint do not resolve/m, 'the journal line');
  assert.match(r.stdout, /2 file\(s\) clean \(syntax only\)/);
  r = run('--files', 'blocks/header/header.js', '--syntax-only');
  assert.equal(r.status, 2, '--syntax-only never skips the syntax stage');
  shim('eslint', 'parser'); shim('stylelint');
  r = run('--files', 'blocks/cards/cards.js');
  assert.equal(r.status, 2); assert.match(r.stderr, /eslint parser do not resolve .* — .*Failed to load parser '@babel\/eslint-parser'/);
  rmShims(); rmSync(log, { force: true });
  // a tool is required only for a file class present in the list
  shim('stylelint');
  r = run('--files', 'blocks/cards/cards.css'); assert.equal(r.status, 0, `CSS-only change with stylelint alone: ${r.stdout}${r.stderr}`); assert.match(r.stdout, /1 file\(s\) clean$/m);
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css'); assert.equal(r.status, 2, 'a .js in the list still needs eslint'); assert.match(r.stderr, /unavailable \(eslint do not resolve/);
  rmShims(); shim('eslint');
  r = run('--files', 'blocks/cards/cards.js'); assert.equal(r.status, 0, `JS-only change with eslint alone: ${r.stdout}${r.stderr}`);
  r = run('--files', 'blocks/cards/cards.css'); assert.equal(r.status, 2); assert.match(r.stderr, /unavailable \(stylelint do not resolve/);
  rmShims(); rmSync(log, { force: true });

  // 2b. no silent pass: not a git work tree (the header.js duplicate const sits in the tree) and no --files → exit 1, never "nothing to lint"
  r = run();
  assert.equal(r.status, 1, `non-git root without --files must be no verdict: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /cannot list changed files — .* is not a git work tree; pass --files/); assert.doesNotMatch(r.stdout, /nothing to lint/);
  g('init', '-q', '-b', 'main');
  r = run(); assert.equal(r.status, 1, 'a repo with no commit yet (no HEAD) is no verdict too'); assert.match(r.stderr, /cannot list changed files — git diff HEAD failed/);
  assert.deepEqual(lintFiles(root, null).error !== undefined, true);
  assert.deepEqual(lintFiles(root, ['blocks/header/header.js']), { js: ['blocks/header/header.js'], css: [] }, '--files bypasses git');

  // 3. scoping via git: only the files this run touched reach the tools
  shim('eslint'); shim('stylelint');
  w('.gitignore', 'node_modules/\nshim.log\n'); g('add', '-A'); g('commit', '-q', '-m', 'base');
  r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /nothing to lint/);
  w('blocks/cards/cards.js', 'export default function decorate(block) { block.classList.add("ready", "v2"); }\n');
  w('blocks/cards/cards.css', '.cards { display: grid; gap: 1rem; }\n');
  w('blocks/hero/hero.css', '.hero { min-height: 40vh; }\n'); // untracked counts too
  w('README.md', 'not code\n');
  r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(new Set(shimPaths('eslint')), new Set(['blocks/cards/cards.js']), `eslint saw exactly the touched js: ${readFileSync(log, 'utf8')}`);
  assert.deepEqual(new Set(shimPaths('stylelint')), new Set(['blocks/cards/cards.css', 'blocks/hero/hero.css']));
  assert.doesNotMatch(readFileSync(log, 'utf8'), /header\.js|styles\.css|README/, 'untouched files are never passed (no "pre-existing" excuse possible)');
  assert.match(r.stdout, /blocks\/cards\/cards\.js {2}syntax ok · eslint 0/); assert.match(r.stdout, /blocks\/cards\/cards\.css {2}syntax - · stylelint 0/);

  // 4. findings in touched files block; warnings pass; --fix forwarded
  rmSync(log, { force: true });
  g('add', '-A'); g('commit', '-q', '-m', 'cards');
  w('blocks/cards/bad-cards.js', 'export default function decorate() {}\n');
  r = run();
  assert.equal(r.status, 2); assert.match(r.stdout, /✗ eslint: 1:1 {2}error {2}shim: file named bad {2}no-bad/); assert.match(r.stderr, /\d+ finding\(s\) in files this run touched/);
  rmSync(join(root, 'blocks/cards/bad-cards.js'));
  w('blocks/cards/warn-cards.css', '.warn {}\n');
  r = run(); assert.equal(r.status, 0, `warnings pass: ${r.stdout}${r.stderr}`);
  rmSync(log, { force: true }); r = run('--fix'); assert.equal(r.status, 0); assert.match(readFileSync(log, 'utf8'), /stylelint --fix blocks\/cards\/warn-cards\.css/);
  r = run('--json'); const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)); assert.deepEqual(Object.keys(j.files), ['blocks/cards/warn-cards.css']); assert.equal(j.unavailable, null);
  const lf = lintFiles(root, null); assert.deepEqual(lf, { js: [], css: ['blocks/cards/warn-cards.css'] });

  // 5. a crashed toolchain is never clean — the two real failure shapes of a pruned node_modules
  rmShims(); rmSync(log, { force: true });
  shim('eslint', 'noconfig-eslint'); shim('stylelint', 'noconfig-stylelint');
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css');
  assert.equal(r.status, 2, `crashed tools must be exit 2, never clean: ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /file\(s\) clean/);
  assert.match(r.stdout, /^lint: unavailable \(eslint exited 2 — ESLint couldn't find the config "airbnb-base" to extend from.*; stylelint exited 78 — Error: No configuration provided/m);
  assert.match(r.stderr, /toolchain did not reach a verdict .* Unavailable is never clean \(exit 2\)/);
  assert.match(r.stdout, /blocks\/cards\/cards\.js {2}syntax ok · eslint \?/, 'the row shows no verdict, not a pass');
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css', '--json'); assert.equal(r.status, 2); const jc = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)); assert.match(jc.unavailable, /eslint exited 2/);
  // any other non-zero exit with no finding line is still a finding, never silence
  rmShims(); shim('eslint', 'odd-exit'); shim('stylelint');
  r = run('--files', 'blocks/cards/cards.js,blocks/cards/cards.css');
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stdout, /✗ eslint: exited 1 — shim: something unexpected happened/); assert.doesNotMatch(r.stdout, /clean/);
  // 6. a --files entry that does not exist: a finding, never a crash, never handed to a tool
  rmShims(); rmSync(log, { force: true }); shim('eslint'); shim('stylelint');
  r = run('--files', 'blocks/cards/cards.js,blocks/nope/nope.js,blocks/nope/nope.css');
  assert.equal(r.status, 2, `missing files are findings: ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /TypeError/);
  assert.match(r.stdout, /blocks\/nope\/nope\.js {2}syntax FAIL/); assert.match(r.stdout, /blocks\/nope\/nope\.css {2}syntax FAIL/);
  assert.match(r.stdout, /✗ blocks\/nope\/nope\.js: not found under /); assert.match(r.stdout, /✗ blocks\/nope\/nope\.css: not found under /);
  assert.deepEqual(new Set(shimPaths('eslint')), new Set(['blocks/cards/cards.js']), 'the missing .js never reaches eslint');
  assert.deepEqual(shimPaths('stylelint'), [], 'the missing .css never reaches stylelint (no css left → not invoked)');

  // 7. NEGATIVE (listing paths): an EDS root that is a SUBDIRECTORY of the git work tree — `git diff --name-only`
  //    prints repo-root-relative paths, which joined to --root did not exist → every changed file was `not found`
  //    (exit 2 with `not found` findings); with --relative the shims receive root-relative paths and the run is clean.
  //    Also: the parser probe's clean run on the sample file is reused — eslint sees the sample file ONCE.
  const repo2 = mkdtempSync(join(tmpdir(), 'lint-changed-sub-'));
  const site = join(repo2, 'site');
  const w2 = (p, body) => { mkdirSync(join(site, dirname(p)), { recursive: true }); writeFileSync(join(site, p), body); };
  w2('blocks/cards/cards.js', 'export default function decorate(block) { block.classList.add("ready"); }\n');
  w2('blocks/cards/cards.css', '.cards { display: grid; }\n');
  w2('styles/styles.css', ':root { --brand: #123; }\n');
  const log2 = join(repo2, 'shim.log');
  for (const name of ['eslint', 'stylelint']) { const p = join(site, 'node_modules', '.bin', name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `#!/bin/sh\necho "${name} $@" >> "${log2}"\nexit 0\n`); chmodSync(p, 0o755); }
  const g2 = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.test', ...args], { cwd: repo2, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  g2('init', '-q', '-b', 'main'); writeFileSync(join(repo2, '.gitignore'), 'node_modules/\n'); g2('add', '-A'); g2('commit', '-q', '-m', 'base');
  w2('blocks/cards/cards.js', 'export default function decorate(block) { block.classList.add("ready", "v2"); }\n');
  w2('blocks/cards/cards.css', '.cards { display: grid; gap: 1rem; }\n');
  const listed2 = lintFiles(site);
  assert.deepEqual([listed2.js, listed2.css], [['blocks/cards/cards.js'], ['blocks/cards/cards.css']], `root-relative listing from a subdirectory root: ${JSON.stringify(listed2)}`);
  r = spawnSync(process.execPath, [CLI, '--lint', '--root', site], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: repo2 } });
  assert.equal(r.status, 0, `a subdirectory EDS root lints clean: ${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /not found under/);
  assert.match(r.stdout, /blocks\/cards\/cards\.js {2}syntax ok · eslint 0/);
  const eslintRuns = readFileSync(log2, 'utf8').split('\n').filter((l) => l.startsWith('eslint '));
  assert.equal(eslintRuns.length, 1, `the sample file is linted once (probe reused), got: ${eslintRuns.join(' | ')}`);
  rmSync(repo2, { recursive: true, force: true });

  // usage
  assert.equal(run('--help').status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, '--lint', '--root', join(root, 'nope')], { encoding: 'utf8' }).status, 1);
  console.log('lint-changed test: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
