#!/usr/bin/env node
// skills/replica/scripts/test/foundation-freeze.test.mjs — the foundation-freeze.mjs contract: a sorted
// sha256 manifest over the frozen set (existing default entries only, dot-entries and node_modules skipped,
// no file contents), `check` exit 0 while nothing moved, exit 1 with one line per changed / missing / added
// file under a frozen path, silence for files outside the set, symlinks recorded by link text and never followed
// (file, directory, loop, dangling), a filesystem error mapped to exit 2 (exit 1 stays "changed"),
// --paths/--out/--manifest/--root, --help that touches nothing, usage errors on exit 2 with one stderr line.
// Run: node plugins/stardust/skills/replica/scripts/test/foundation-freeze.test.mjs   (about 1 s)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, DEFAULT_PATHS, compare, snapshot } from '../foundation-freeze.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'foundation-freeze.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'foundation-freeze-test-')));
const MANIFEST = join(root, DEFAULT_OUT);

let failed = 0; let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const manifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));
const lines = (out) => out.trim().split('\n');

// An EDS-shaped project: the default frozen set minus fonts/ (absent on purpose), one non-frozen block, content,
// and the entries the walk must skip — a dot-file, a dot-dir and a node_modules tree INSIDE frozen dirs.
const FIXTURE = {
  'styles/styles.css': ':root { --page-max-width: 1200px; }\nbody { margin: 0; }\n',
  'styles/fonts.css': '@font-face { font-family: Body; src: url(../fonts/body.woff2); }\n',
  'styles/lazy-styles.css': '/* lazy */\n',
  'head.html': '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n',
  'scripts/aem.js': 'export function sampleRUM() {}\n',
  'scripts/scripts.js': 'import { sampleRUM } from \'./aem.js\';\nsampleRUM();\n',
  'blocks/header/header.css': 'header nav { display: grid; }\n',
  'blocks/header/header.js': 'export default async function decorate(block) { block.textContent = \'\'; }\n',
  'blocks/footer/footer.css': 'footer { padding: 2rem; }\n',
  'blocks/hero/hero.css': '.hero { min-height: 40vh; }\n',
  'content/index.html': '<body><main><h1>Home</h1></main></body>\n',
};
const SKIPPED = { 'styles/.env': 'DA_TOKEN=not-a-real-token\n', 'styles/.cache/x.css': 'x{}\n', 'scripts/node_modules/dep/index.js': 'module.exports = 1;\n' };
for (const [rel, text] of Object.entries({ ...FIXTURE, ...SKIPPED })) write(rel, text);
const FROZEN = Object.keys(FIXTURE).filter((p) => /^(styles|scripts)\/|^blocks\/(header|footer)\/|^head\.html$/.test(p)).sort();

check('freeze writes a sorted sha256 manifest over the existing default entries and prints the count', () => {
  const r = run('freeze');
  assert.equal(r.code, 0, r.err); assert.equal(r.out, `frozen ${FROZEN.length} files → ${DEFAULT_OUT}\n`);
  const m = manifest();
  assert.match(m.frozenAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); assert.equal(m.root, '.');
  assert.deepEqual(m.paths, DEFAULT_PATHS.filter((p) => p !== 'fonts/'), 'fonts/ does not exist here and is not recorded');
  assert.deepEqual(Object.keys(m.files), FROZEN, 'sorted by path, frozen entries only');
  for (const p of FROZEN) assert.equal(m.files[p], sha(FIXTURE[p]), p);
  assert.deepEqual(Object.keys(manifest()), ['frozenAt', 'root', 'paths', 'files']);
});
check('the manifest never carries a skipped entry or a file\'s contents', () => {
  const text = readFileSync(MANIFEST, 'utf8');
  for (const p of Object.keys(SKIPPED)) assert.doesNotMatch(text, new RegExp(p.replace(/[.]/g, '\\.')), p);
  assert.doesNotMatch(text, /not-a-real-token|page-max-width|sampleRUM|device-width/);
  assert.equal(text.endsWith('}\n'), true, 'pretty JSON with a trailing newline');
});
check('check passes while nothing under the frozen set moved', () => {
  const r = run('check');
  assert.equal(r.code, 0, r.out); assert.equal(r.out, `foundation unchanged (${FROZEN.length} files)\n`); assert.equal(r.err, '');
});
check('an edited frozen file: exit 1, `changed <path>`, the summary line', () => {
  write('styles/styles.css', ':root { --page-max-width: 1440px; }\nbody { margin: 0; }\n');
  const r = run('check');
  assert.equal(r.code, 1, r.out); assert.deepEqual(lines(r.out), ['changed styles/styles.css', 'foundation changed: 1 changed, 0 missing, 0 added']);
  write('styles/styles.css', FIXTURE['styles/styles.css']); assert.equal(run('check').code, 0, 'reverted → unchanged');
});
check('a deleted frozen file: exit 1, `missing <path>`', () => {
  unlinkSync(join(root, 'blocks/footer/footer.css'));
  const r = run('check');
  assert.equal(r.code, 1, r.out); assert.deepEqual(lines(r.out), ['missing blocks/footer/footer.css', 'foundation changed: 0 changed, 1 missing, 0 added']);
  write('blocks/footer/footer.css', FIXTURE['blocks/footer/footer.css']); assert.equal(run('check').code, 0);
});
check('a new file under blocks/header/: exit 1, `added <path>`', () => {
  write('blocks/header/extra.css', 'header .extra { color: red; }\n');
  const r = run('check');
  assert.equal(r.code, 1, r.out); assert.deepEqual(lines(r.out), ['added blocks/header/extra.css', 'foundation changed: 0 changed, 0 missing, 1 added']);
  unlinkSync(join(root, 'blocks/header/extra.css')); assert.equal(run('check').code, 0);
});
check('all three at once, grouped changed → missing → added, sorted inside each group', () => {
  write('scripts/scripts.js', '// rewritten\n'); write('head.html', '<meta charset="utf-8"/>\n');
  unlinkSync(join(root, 'styles/lazy-styles.css'));
  write('scripts/delayed.js', '// new\n'); write('blocks/footer/footer.js', 'export default function decorate() {}\n');
  const r = run('check');
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(lines(r.out), ['changed head.html', 'changed scripts/scripts.js', 'missing styles/lazy-styles.css', 'added blocks/footer/footer.js', 'added scripts/delayed.js', 'foundation changed: 2 changed, 1 missing, 2 added']);
  write('scripts/scripts.js', FIXTURE['scripts/scripts.js']); write('head.html', FIXTURE['head.html']); write('styles/lazy-styles.css', FIXTURE['styles/lazy-styles.css']);
  unlinkSync(join(root, 'scripts/delayed.js')); unlinkSync(join(root, 'blocks/footer/footer.js'));
  assert.equal(run('check').code, 0, 'restored → unchanged');
});
check('a path outside the frozen set changes freely — a cluster\'s own block, new blocks, content', () => {
  write('blocks/hero/hero.css', '.hero { min-height: 60vh; }\n'); write('blocks/cards/cards.css', '.cards { display: grid; }\n');
  write('content/about.html', '<body><main><h1>About</h1></main></body>\n'); unlinkSync(join(root, 'content/index.html'));
  const r = run('check'); assert.equal(r.code, 0, r.out); assert.match(r.out, /^foundation unchanged/);
});
check('dot-entries and node_modules appearing under a frozen dir are not `added`', () => {
  write('styles/.DS_Store', 'junk'); write('blocks/header/.cache/tmp.css', 'x{}'); write('scripts/node_modules/other/index.js', '1');
  write('scripts/.env', 'DA_TOKEN=x');
  const r = run('check'); assert.equal(r.code, 0, r.out);
});
check('symlinks are recorded by link text, never followed: a file link, a directory link, a loop, a dangling link', () => {
  symlinkSync('styles.css', join(root, 'styles/link.css')); // file link
  symlinkSync('../blocks', join(root, 'scripts/vendor')); // directory link — blocks/hero must not be pulled in
  symlinkSync('.', join(root, 'scripts/loop')); // a loop: stat would ELOOP, lstat does not
  symlinkSync('nowhere.css', join(root, 'styles/gone.css')); // dangling
  const f = run('freeze'); assert.equal(f.code, 0, f.err);
  const m = manifest();
  assert.equal(m.files['styles/link.css'], 'symlink:styles.css'); assert.equal(m.files['scripts/vendor'], 'symlink:../blocks');
  assert.equal(m.files['scripts/loop'], 'symlink:.'); assert.equal(m.files['styles/gone.css'], 'symlink:nowhere.css');
  assert.equal(Object.keys(m.files).some((p) => p.startsWith('scripts/vendor/')), false, 'the linked directory is not walked');
  assert.equal(f.out, `frozen ${FROZEN.length + 4} files → ${DEFAULT_OUT}\n`);
  assert.equal(run('check').code, 0, 'unchanged with the links in place');
  write('styles/styles.css', ':root { --x: 1 }\n');
  let c = run('check'); assert.equal(c.code, 1); assert.deepEqual(lines(c.out), ['changed styles/styles.css', 'foundation changed: 1 changed, 0 missing, 0 added'], 'the link to it is not `changed`: its text did not move');
  write('styles/styles.css', FIXTURE['styles/styles.css']);
  unlinkSync(join(root, 'styles/link.css')); symlinkSync('fonts.css', join(root, 'styles/link.css'));
  c = run('check'); assert.equal(c.code, 1); assert.deepEqual(lines(c.out), ['changed styles/link.css', 'foundation changed: 1 changed, 0 missing, 0 added'], 'a re-pointed link is a change');
  unlinkSync(join(root, 'styles/link.css')); write('styles/link.css', FIXTURE['styles/styles.css']);
  c = run('check'); assert.equal(c.code, 1); assert.match(c.out, /^changed styles\/link\.css$/m, 'a link replaced by a real file is a change');
  for (const l of ['styles/link.css', 'scripts/vendor', 'scripts/loop', 'styles/gone.css']) unlinkSync(join(root, l));
  assert.equal(run('freeze').code, 0);
  assert.deepEqual(Object.keys(manifest().files), FROZEN, 'back to the plain set');
});
check('a frozen top-level entry that is itself a symlink is one `symlink:` entry (not walked), with or without the trailing slash', () => {
  symlinkSync('blocks', join(root, 'fonts'));
  const f = run('freeze'); assert.equal(f.code, 0, f.err);
  assert.deepEqual(manifest().paths.filter((p) => p === 'fonts/'), ['fonts/']); assert.equal(manifest().files.fonts, 'symlink:blocks');
  assert.equal(Object.keys(manifest().files).some((p) => p.startsWith('fonts/')), false);
  assert.equal(run('check').code, 0);
  unlinkSync(join(root, 'fonts')); assert.equal(run('freeze').code, 0); assert.equal('fonts' in manifest().files, false);
});
check('a filesystem error while hashing is exit 2 with one line naming the path — never exit 1 (changed)', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { console.log('  (skipped: running as root, chmod 000 does not deny)'); return; }
  const before = readFileSync(MANIFEST, 'utf8');
  mkdirSync(join(root, 'styles/locked')); write('styles/locked/x.css', 'x{}'); chmodSync(join(root, 'styles/locked'), 0o000);
  try {
    const f = run('freeze'); assert.equal(f.code, 2, f.out); assert.equal(f.out, ''); assert.match(f.err, /^foundation-freeze: EACCES .*styles\/locked: /); assert.equal(lines(f.err).length, 1); assert.doesNotMatch(f.err, /\n\s+at /);
    assert.equal(readFileSync(MANIFEST, 'utf8'), before, 'the previous manifest is intact (no partial write)');
    const c = run('check'); assert.equal(c.code, 2, c.out); assert.match(c.err, /^foundation-freeze: EACCES/); assert.doesNotMatch(c.out, /foundation changed/);
    assert.equal(readdirSync(join(root, 'stardust/rollout')).some((f2) => f2.endsWith('.tmp')), false, 'no temp file left behind');
  } finally { chmodSync(join(root, 'styles/locked'), 0o755); rmSync(join(root, 'styles/locked'), { recursive: true, force: true }); }
  assert.equal(run('check').code, 0, 'restored → unchanged');
});
check('--paths / --out / --root / --manifest: an explicit set from another working directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'foundation-freeze-cwd-'));
  const go = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: 'utf8' });
  const out = join(cwd, 'freeze.json');
  const f = go('freeze', '--root', root, '--paths', './blocks/hero/, head.html', '--out', out);
  assert.equal(f.status, 0, f.stderr); assert.equal(f.stdout, `frozen 2 files → ${out}\n`);
  const m = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(m.root, root, 'root recorded as given'); assert.deepEqual(m.paths, ['blocks/hero/', 'head.html'], 'entries normalised, ./ stripped');
  assert.deepEqual(Object.keys(m.files), ['blocks/hero/hero.css', 'head.html']);
  assert.equal(go('check', '--root', root, '--manifest', out).status, 0);
  write('blocks/hero/hero.css', '.hero { min-height: 70vh; }\n');
  const c = go('check', '--root', root, '--manifest', out); assert.equal(c.status, 1); assert.match(c.stdout, /^changed blocks\/hero\/hero\.css$/m);
  assert.deepEqual(readdirSync(cwd), ['freeze.json'], 'nothing else written in the working directory');
  rmSync(cwd, { recursive: true, force: true });
});
check('--paths refuses a missing entry, an absolute path and a climb out of --root (exit 2)', () => {
  for (const spec of ['styles/,nope/', '/etc', '../x', ' , ']) {
    const r = run('freeze', '--paths', spec, '--out', join(root, 'never.json'));
    assert.equal(r.code, 2, spec); assert.match(r.err, /^foundation-freeze: --paths /); assert.equal(lines(r.err).length, 1, r.err);
  }
  assert.equal(readdirSync(root).includes('never.json'), false, 'a refused freeze writes nothing');
});
check('--help (and -h, in any position) exits 0 with the usage and touches nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'foundation-freeze-help-'));
  for (const args of [['--help'], ['-h'], ['freeze', '--help'], ['check', '--root', 'x', '-h']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, args.join(' ')); assert.match(r.stdout, /Usage:/); assert.match(r.stdout, /freeze \[--root <dir>\]/); assert.match(r.stdout, /check \[--root <dir>\]/);
    assert.match(r.stdout, /foundation-requests\.md/); assert.equal(r.stderr, '');
  }
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true, force: true });
});
check('usage errors exit 2 with one stderr line, no stack trace, nothing on stdout', () => {
  const cases = [[], ['bogus'], ['freeze', '--bogus'], ['freeze', '--root'], ['freeze', '--out', '--paths'], ['check', '--out', 'x'], ['check', '--paths', 'styles/'], ['check', '--manifest', 'nowhere.json'], ['freeze', '--root', 'no-such-dir']];
  for (const args of cases) {
    const r = run(...args);
    assert.equal(r.code, 2, args.join(' ') || '(no args)'); assert.equal(r.out, ''); assert.match(r.err, /^foundation-freeze: .*\(see --help\)\n$/); assert.doesNotMatch(r.err, /\n\s+at /);
  }
  assert.match(run().err, /command required: freeze \| check/); assert.match(run('check', '--manifest', 'nowhere.json').err, /manifest not found: nowhere\.json — run `freeze` first/);
  assert.match(run('check', '--out', 'x').err, /unknown argument for check: --out/);
});
check('a manifest that is not JSON or not a freeze manifest is a usage error, not a crash', () => {
  write('bad.json', '{ not json'); write('shape.json', '{"files": 1}');
  const a = run('check', '--manifest', 'bad.json'); assert.equal(a.code, 2); assert.match(a.err, /manifest is not JSON: bad\.json/);
  const b = run('check', '--manifest', 'shape.json'); assert.equal(b.code, 2); assert.match(b.err, /not a foundation-freeze manifest/);
});
check('freeze is idempotent: a second run records the same paths and hashes', () => {
  const before = manifest(); const r = run('freeze'); assert.equal(r.code, 0, r.err);
  const after = manifest(); assert.deepEqual(after.paths, before.paths); assert.deepEqual(after.files, before.files);
});
check('exported helpers: snapshot() is sorted, skips absent entries and records a symlink by text; compare() classifies', () => {
  const s = snapshot(root, ['head.html', 'fonts/', 'blocks/footer/']);
  assert.deepEqual(Object.keys(s), ['blocks/footer/footer.css', 'head.html']); assert.equal(s['head.html'], sha(FIXTURE['head.html']));
  symlinkSync('head.html', join(root, 'head-link.html'));
  assert.deepEqual(snapshot(root, ['head-link.html']), { 'head-link.html': 'symlink:head.html' }); unlinkSync(join(root, 'head-link.html'));
  assert.equal(existsSync(join(root, 'head-link.html')), false);
  const d = compare({ files: { a: '1', b: '2', c: '3' } }, { a: '1', b: 'x', d: '4' });
  assert.deepEqual(d, { changed: ['b'], missing: ['c'], added: ['d'] });
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${checks} checks failing` : `\nfoundation-freeze: all ${checks} checks passed`);
process.exit(failed ? 1 : 0);
