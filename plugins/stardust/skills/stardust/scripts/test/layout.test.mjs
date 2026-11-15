#!/usr/bin/env node
// skills/stardust/scripts/test/layout.test.mjs — the project-copy layout works: a temp project gets every skill's
// scripts/ at stardust/scripts/<skill>/ — the master's at stardust/scripts/stardust/ (Setup step 7: browser.mjs,
// contracts.mjs, lib/) — then every non-test *.mjs in the copy is `node --check`ed and run with `--help` from an empty
// cwd: that links its static imports (./lib.mjs, sibling files) and runs its import-time lookups of contracts.mjs and
// browser.mjs, so a cross-skill path that only resolves in the plugin tree fails HERE, not in the field. A script that
// answers with its usage is a CLI; one that exits 0 silently is a library (imported clean); one whose import fails on a
// bare package the plugin does not ship (playwright, sharp, …) is listed as skipped. Then four probes exercise the
// dynamic paths: delivery-lint on a page (its shared rules through rollout/lib.mjs), lib/resolve.mjs (layout and sibling
// lookup from the copy and from the plugin tree), spec lib.mjs loadSibling → deploy/eds-path.mjs → contracts.mjs, and a
// copy without the master's scripts stopping with the copy instruction.
// Offline, no browser, no node_modules; ~100 child processes. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = realpathSync(join(HERE, '..', '..', '..'));
const TIMEOUT_MS = 20000;
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const walk = (dir, acc = []) => { for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'test') walk(p, acc); } else if (e.name.endsWith('.mjs')) acc.push(p); } return acc; };

const root = realpathSync(mkdtempSync(join(tmpdir(), 'layout-test-'))); // realpath: a module's import.meta.url is the resolved path
const proj = join(root, 'proj'); mkdirSync(proj);
const to = join(proj, 'stardust', 'scripts');
// every skill's copy step (stardust/scripts/<skill>/), the master's being Setup step 7 (stardust/scripts/stardust/)
const copied = readdirSync(SKILLS).filter((s) => existsSync(join(SKILLS, s, 'scripts')));
for (const s of copied) cpSync(join(SKILLS, s, 'scripts'), join(to, s), { recursive: true });
check(`the temp project holds every skill's scripts, the master's with contracts.mjs and lib/ (${copied.length} skills)`, () => {
  assert.ok(copied.includes('stardust') && existsSync(join(to, 'stardust', 'contracts.mjs')) && existsSync(join(to, 'stardust', 'lib', 'paths.mjs')));
});

const scripts = walk(to);
check(`every staged script passes node --check (${scripts.length} files)`, () => {
  const bad = scripts.map((f) => [f, spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })]).filter(([, r]) => r.status !== 0);
  assert.ok(!bad.length, bad.map(([f, r]) => `${relative(to, f)}: ${r.stderr.trim().split('\n')[0]}`).join('\n'));
});

const cli = []; const libraries = []; const skipped = []; const broken = [];
for (const f of scripts) {
  const cwd = mkdtempSync(join(root, 'cwd-'));
  const r = spawnSync(process.execPath, [f, '--help'], { cwd, encoding: 'utf8', timeout: TIMEOUT_MS });
  const wrote = readdirSync(cwd); rmSync(cwd, { recursive: true, force: true });
  const name = relative(to, f); const out = r.stdout || ''; const err = r.stderr || '';
  if (r.error && r.error.code === 'ETIMEDOUT') { broken.push(`${name}: no exit within ${TIMEOUT_MS / 1000} s`); continue; }
  if (/contracts\.mjs not found/.test(err)) { broken.push(`${name}: contracts.mjs unresolved in the project copy — ${err.trim().split('\n').find((l) => /contracts\.mjs/.test(l))}`); continue; }
  const missing = err.match(/Cannot find (?:package|module) '([^']+)'/);
  if (r.status !== 0 && missing && /ERR_MODULE_NOT_FOUND/.test(err)) {
    if (/^[./#]/.test(missing[1])) { broken.push(`${name}: relative import does not resolve in the project copy: ${missing[1]}`); continue; }
    skipped.push(`${name} (needs ${missing[1]})`); continue;
  }
  if (r.status !== 0) { broken.push(`${name}: exit ${r.status} — ${(err.trim().split('\n').find((l) => l.trim()) || 'no stderr').slice(0, 160)}`); continue; }
  if (wrote.length) { broken.push(`${name}: --help wrote into the cwd: ${wrote.join(', ')}`); continue; }
  if (/usage/i.test(out) || out.includes(basename(f))) cli.push(name);
  else if (!out.trim() && !err.trim()) libraries.push(name);
  else broken.push(`${name}: exit 0 with output that is neither a usage text nor silence (${out.length}+${err.length} chars)`);
}
check(`every staged script links its imports from the copy: ${cli.length} CLIs answered --help, ${libraries.length} libraries imported clean, ${skipped.length} skipped`, () => {
  assert.ok(!broken.length, broken.join('\n'));
  assert.ok(cli.includes(join('rollout', 'delivery-lint.mjs')) && cli.includes(join('stardust', 'ledger.mjs')), 'the known CLIs are classified as such');
  assert.ok(['rollout/lib.mjs', 'deploy/eds-path.mjs', 'stardust/contracts.mjs', 'stardust/lib/paths.mjs'].every((f) => libraries.includes(join(...f.split('/')))), 'the known libraries are classified as such');
});
if (skipped.length) console.log(`  skipped (a package the plugin does not ship; verify in a project that has it):\n    ${skipped.join('\n    ')}`);
console.log(`  libraries imported from the copy: ${libraries.join(', ')}`);

const importIn = (file, expr) => spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify(${expr}));`], { encoding: 'utf8' });
check('probe: delivery-lint from the copy lints a page through the shared paths/kinds/names', () => {
  const content = join(proj, 'content'); mkdirSync(content, { recursive: true });
  const page = join(proj, 'page.html');
  writeFileSync(page, '<html><body><main><h1>t</h1><p><a href="/widgets/search/site-search.html?q=1">s</a></p><p><a href="/about.html">a</a></p><div class="metadata"><div><div>title</div><div>t</div></div></div></main></body></html>');
  const r = spawnSync(process.execPath, [join(to, 'rollout', 'delivery-lint.mjs'), '--file', page, '--path', '/About_Us/', '--content', content, '--json'], { cwd: proj, encoding: 'utf8' });
  assert.ok(r.stdout, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.type, 'page');
  const rules = out.findings.map((f) => f.rule);
  assert.ok(rules.includes('path-safety'), `path-safety from lib/paths.mjs safePath: ${rules}`);
  assert.ok(rules.includes('html-extension'), `html-extension on the page link: ${rules}`);
  assert.ok(!rules.includes('unknown-widget') && !rules.includes('widget-name'), 'the widget mount passes (no widgets/ dir → existence check skipped, stem not reserved)');
});
check('probe: lib/resolve.mjs knows its layout and finds siblings in both trees', () => {
  let r = importIn(join(to, 'stardust', 'lib', 'resolve.mjs'), '[m.layout(), m.siblingPath("diff", "content-diff.mjs"), m.siblingPath("stardust", "browser.mjs"), m.siblingPath("nope", "x.mjs")]');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), ['project', join(to, 'diff', 'content-diff.mjs'), join(to, 'stardust', 'browser.mjs'), null]);
  r = importIn(join(SKILLS, 'stardust', 'scripts', 'lib', 'resolve.mjs'), '[m.layout(), m.siblingPath("diff", "content-diff.mjs")]');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), ['plugin', join(SKILLS, 'diff', 'scripts', 'content-diff.mjs')]);
  r = importIn(join(to, 'stardust', 'lib', 'resolve.mjs'), '(() => { try { m.sibling("nope", "x.mjs"); return "no throw"; } catch (e) { return e.message; } })()');
  assert.equal(r.status, 0, r.stderr); assert.match(JSON.parse(r.stdout), /nope\/x\.mjs not found .*copy the nope skill's scripts dir to stardust\/scripts\/nope\//);
});
check('probe: spec lib.mjs loadSibling → deploy/eds-path.mjs → contracts.mjs resolves from the copy', () => {
  const r = importIn(join(to, 'spec', 'lib.mjs'), '[(await m.loadSibling("deploy", "eds-path.mjs")).pathKey("/A/b/index.html"), (await m.loadSibling("dynamics", "lib.mjs")).TAXONOMY.class.length]');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), ['/a/b', 12]);
});

check('probe: a copy without the master\'s scripts stops with the copy instruction (no stardust/scripts/stardust/)', () => {
  const bare = join(root, 'bare', 'stardust', 'scripts'); mkdirSync(bare, { recursive: true });
  cpSync(join(SKILLS, 'rollout', 'scripts'), join(bare, 'rollout'), { recursive: true });
  const r = spawnSync(process.execPath, [join(bare, 'rollout', 'inventory.mjs'), '--help'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /contracts\.mjs not found .*stardust\/scripts\/stardust\//);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
