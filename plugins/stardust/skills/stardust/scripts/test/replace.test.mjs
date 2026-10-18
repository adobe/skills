#!/usr/bin/env node
// skills/stardust/scripts/test/replace.test.mjs — the replace.mjs contract: literal matching ($& and
// regex metacharacters stay literal) and --regex (the engine's replacement syntax), the per-file
// expectation (default exactly 1, --all, --count) with nothing written anywhere when one file misses
// it, the refusal report (count line, grep -C2 context with > on matching lines, long lines cut),
// --dry-run, --json, --files-from globs, the guards (outside the project, symlinks, owned ledgers,
// binary and non-UTF-8 files, an empty regex match), the value-flag rules (--to --brand-new vs
// --to --json, --from=<v>), the atomic write keeping mode, line endings and a BOM, and --help
// before any I/O. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReplace, contextLines, expandBraces, expandGlob, findMatches, ownedBy, parseArgs, resolveInside } from '../replace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'replace.mjs');
const root = mkdtempSync(join(tmpdir(), 'replace-test-'));
let seq = 0;
const project = () => { seq += 1; const d = join(root, `p${seq}`); mkdirSync(d); return d; };
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); return p; };
const read = (p) => readFileSync(p, 'utf8');
const oneLine = (s) => { assert.equal(s.split('\n').filter(Boolean).length, 1, `one line expected, got: ${s}`); return s.trimEnd(); };
const noTmp = (dir) => assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], `temp file left in ${dir}`);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// ---- pure helpers -------------------------------------------------------------------------------
check('parseArgs: files, value flags, defaults, the expectation', () => {
  const a = parseArgs(['a.html', 'b.html', '--from', 'x', '--to', 'y']);
  assert.deepEqual(a.files, ['a.html', 'b.html']);
  assert.equal(a.from, 'x'); assert.equal(a.to, 'y'); assert.equal(a.regex, false); assert.equal(a.flags, '');
  assert.equal(a.filesFrom, null); assert.equal(a.dryRun, false); assert.equal(a.json, false);
  assert.deepEqual(a.expect, { op: 'exactly', n: 1 });
  assert.deepEqual(parseArgs(['a', '--from', 'x', '--to', 'y', '--all']).expect, { op: 'atLeast', n: 1 });
  assert.deepEqual(parseArgs(['a', '--from', 'x', '--to', 'y', '--count', '3']).expect, { op: 'exactly', n: 3 });
  const g = parseArgs(['--files-from', 'src/**/*.html', '--from', '(a)', '--to', '$1', '--regex', '--flags', 'im', '--dry-run', '--json']);
  assert.deepEqual(g.files, []); assert.equal(g.filesFrom, 'src/**/*.html'); assert.equal(g.regex, true); assert.equal(g.flags, 'im');
  assert.equal(g.dryRun, true); assert.equal(g.json, true);
  assert.equal(parseArgs(['a', '--from', 'x', '--to', '']).to, '', 'an empty --to deletes');
});
check('parseArgs: a value that starts with "-" is a value unless it is one of this script\'s flags; --flag=<v> is verbatim', () => {
  const css = parseArgs(['a.css', '--from', '--brand-old', '--to', '--brand-new']);
  assert.equal(css.from, '--brand-old'); assert.equal(css.to, '--brand-new');
  assert.equal(parseArgs(['a', '--from', '-x', '--to', 'y']).from, '-x');
  const eq = parseArgs(['a', '--from=--json', '--to=a=b', '--count=2']);
  assert.equal(eq.from, '--json'); assert.equal(eq.to, 'a=b'); assert.deepEqual(eq.expect, { op: 'exactly', n: 2 });
});
check('parseArgs: usage errors (exit 2)', () => {
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad(['--from', 'x', '--to', 'y'], /no file/);
  bad(['a'], /--from/);
  bad(['a', '--from', '', '--to', 'y'], /--from/);
  bad(['a', '--from=', '--to', 'y'], /--from/);
  bad(['a', '--from', 'x'], /--to/);
  bad(['a', '--from', 'x', '--to'], /--to needs a value/);
  bad(['a', '--from', 'x', '--to', '--json'], /--to needs a value \(got --json/);
  bad(['a', '--from', '--to', 'y'], /--from needs a value \(got --to/);
  bad(['a', '--from', 'x', '--to', 'y', '--all', '--count', '2'], /--all.*--count|--count.*--all/);
  bad(['a', '--from', 'x', '--to', 'y', '--count', '0'], /--count/);
  bad(['a', '--from', 'x', '--to', 'y', '--count', '1.5'], /--count/);
  bad(['a', '--from', 'x', '--to', 'y', '--count', 'two'], /--count/);
  bad(['a', '--from', 'x', '--to', 'y', '--flags', 'i'], /--flags.*--regex/);
  bad(['a', '--from', 'x', '--to', 'y', '--regex', '--flags', 'g'], /--flags/);
  bad(['a', '--from', 'x', '--to', 'x'], /same/);
  bad(['a', '--from', '(', '--to', 'y', '--regex'], /Invalid regular expression/);
  bad(['a', '--from', 'x', '--to', 'y', '--frm', 'z'], /unknown option --frm/);
  bad(['a', '--from', 'x', '--to', 'y', '--json=1'], /unknown option --json=1/);
  bad(['a', '--from', 'x', '--from', 'z', '--to', 'y'], /--from given twice/);
  bad(['a', '--from=x', '--from', 'z', '--to', 'y'], /--from given twice/);
});
check('findMatches: literal — non-overlapping, left to right, 1-based line and column; a BOM is not a column', () => {
  const m = findMatches('a.b a.b\nxa.b\r\n', { from: 'a.b' });
  assert.deepEqual(m.map(({ index, line, column }) => [index, line, column]), [[0, 1, 1], [4, 1, 5], [9, 2, 2]]);
  assert.deepEqual(findMatches('aaaa', { from: 'aa' }).map((x) => x.index), [0, 2]);
  assert.deepEqual(findMatches('a*b', { from: '*' }).map((x) => [x.index, x.length]), [[1, 1]]);
  assert.deepEqual(findMatches('\uFEFFab', { from: 'a' }).map((x) => [x.line, x.column]), [[1, 1]]);
  assert.deepEqual(findMatches('nothing', { from: 'x' }), []);
});
check('findMatches: regex — every match, an empty match anywhere refused', () => {
  const m = findMatches('a1 b22\nc333', { from: '\\d+', regex: true, flags: '' });
  assert.deepEqual(m.map((x) => [x.index, x.length, x.line, x.column]), [[1, 1, 1, 2], [4, 2, 1, 5], [8, 3, 2, 2]]);
  assert.equal(findMatches('A a', { from: 'a', regex: true, flags: 'i' }).length, 2);
  assert.throws(() => findMatches('bbb', { from: 'a*', regex: true, flags: '' }), (e) => e.code === 2 && /matches the empty string/.test(e.message));
  assert.throws(() => findMatches('aaa', { from: 'a*', regex: true, flags: '' }), /matches the empty string/);
});
check('applyReplace: literal inserts --to verbatim; regex uses $1, $<name>, $&, $$', () => {
  assert.deepEqual(applyReplace('x.y(1) x.y(1)', { from: 'x.y(1)', to: '[$&$1]' }), { text: '[$&$1] [$&$1]', count: 2 });
  assert.deepEqual(applyReplace('a@b c@d', { from: '(\\w)@(?<h>\\w)', to: '$<h>:$1 $& $$', regex: true, flags: '' }), { text: 'b:a a@b $ d:c c@d $', count: 2 });
  assert.deepEqual(applyReplace('keep', { from: 'k', to: '', }), { text: 'eep', count: 1 });
});
check('contextLines: grep -C2 windows, > on matching lines, overlapping windows merged, groups split by --, "… k more"', () => {
  const text = `${Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n')}\n`;
  const at = (n) => findMatches(text, { from: `l${n}\n` }).find((x) => x.line === n);
  assert.deepEqual(contextLines(text, [at(5)]), ['  3: l3', '  4: l4', '  5> l5', '  6: l6', '  7: l7']);
  assert.deepEqual(contextLines(text, [at(2), at(4)]), ['  1: l1', '  2> l2', '  3: l3', '  4> l4', '  5: l5', '  6: l6']);
  assert.deepEqual(contextLines(text, [at(1), at(9)]), ['  1> l1', '  2: l2', '  3: l3', '  --', '  7: l7', '  8: l8', '  9> l9', '  10: l10', '  11: l11']);
  assert.deepEqual(contextLines(text, [at(29)]).at(-1), '  30: l30', 'the window stops at the last line');
  const seven = [1, 5, 10, 15, 20, 25, 30].map(at);
  const out = contextLines(text, seven);
  assert.equal(out.at(-1), '  … 2 more');
  assert.ok(!out.some((l) => l.startsWith('  25') || l.startsWith('  30')), 'only the first 5 matches get context');
  assert.deepEqual(contextLines(text, []), []);
});
check('contextLines: a match over two lines marks both; CR and BOM are not shown', () => {
  const text = '\uFEFFx\r\nab\r\ncd\r\ny\r\n';
  const m = findMatches(text, { from: 'b\r\nc' });
  assert.deepEqual(contextLines(text, m), ['  1: x', '  2> ab', '  3> cd', '  4: y']);
});
check('contextLines: long lines cut — 60 characters either side of the match start on a matching line, 120 elsewhere', () => {
  const hit = `${'a'.repeat(200)}MATCH${'b'.repeat(200)}`;
  const other = 'c'.repeat(300);
  const text = `${other}\n${hit}\nshort\n`;
  const lines = contextLines(text, findMatches(text, { from: 'MATCH' }));
  assert.equal(lines[0], `  1: ${'c'.repeat(120)}…`);
  assert.equal(lines[1], `  2> …${'a'.repeat(60)}MATCH${'b'.repeat(55)}…`);
  assert.equal(lines[2], '  3: short');
  const near = `x${'y'.repeat(150)}`;
  assert.equal(contextLines(near, findMatches(near, { from: 'x' }))[0], `  1> x${'y'.repeat(59)}…`);
  const fits = `${'q'.repeat(100)}Z`;
  assert.equal(contextLines(fits, findMatches(fits, { from: 'Z' }))[0], `  1> ${fits}`, 'a line of ≤ 120 characters is shown whole');
});
check('expandBraces: {a,b} alternation, nested, unbalanced kept literal', () => {
  assert.deepEqual(expandBraces('src/{a,b}/*.{html,css}'), ['src/a/*.html', 'src/a/*.css', 'src/b/*.html', 'src/b/*.css']);
  assert.deepEqual(expandBraces('{x,{y,z}}.md'), ['x.md', 'y.md', 'z.md']);
  assert.deepEqual(expandBraces('a{b.md'), ['a{b.md']);
  assert.deepEqual(expandBraces('plain/*.js'), ['plain/*.js']);
});
check('ownedBy: the dedicated writers; * is one segment', () => {
  assert.equal(ownedBy('stardust/state.json'), 'stardust/state.mjs');
  for (const l of ['rollout', 'migrate', 'replica']) assert.equal(ownedBy(`stardust/${l}/progress.json`), 'stardust/progress.mjs');
  assert.equal(ownedBy('stardust/replica/presence.json'), 'replica/presence.mjs');
  assert.equal(ownedBy('stardust/rollout/foundation-freeze.json'), 'replica/foundation-freeze.mjs');
  assert.equal(ownedBy('stardust/rollout/coverage/home.json'), 'rollout/update-coverage.mjs');
  assert.equal(ownedBy('stardust/rollout/rollout.json'), 'rollout/update-coverage.mjs');
  assert.equal(ownedBy('stardust/rollout/templates.json'), 'rollout/update-coverage.mjs');
  assert.equal(ownedBy('stardust/migrate/encode/hero.json'), 'migrate/encode-attempt.mjs');
  assert.equal(ownedBy('stardust/status.jsonl'), 'stardust/ledger.mjs');
  assert.equal(ownedBy('stardust/rollout/coverage/a/b.json'), null);
  assert.equal(ownedBy('stardust/state.json.bak'), null);
  assert.equal(ownedBy('src/stardust/state.json'), null);
  assert.equal(ownedBy('styles/site.css'), null);
});
check('resolveInside: inside → { abs, real, rel }; outside, missing, resolving outside, not a regular file refused', () => {
  const p = project();
  const other = project();
  put(join(p, 'src', 'a.html'), 'x');
  put(join(other, 'x.html'), 'x');
  const r = resolveInside('src/a.html', p);
  assert.equal(r.rel, 'src/a.html'); assert.equal(r.abs, join(p, 'src', 'a.html'));
  assert.equal(readFileSync(r.real, 'utf8'), 'x');
  const refused = (file, re) => assert.throws(() => resolveInside(file, p), (e) => e.code === 2 && re.test(e.message), `${file} → ${re}`);
  refused(`../${basename(other)}/x.html`, new RegExp(`^\\.\\./${basename(other)}/x\\.html is outside the project \\(`));
  refused(join(other, 'x.html'), /is outside the project/);
  refused('src/b.html', /^no such file src\/b\.html$/);
  symlinkSync(join(other, 'x.html'), join(p, 'out.html'));
  refused('out.html', /^out\.html resolves outside the project \(.*x\.html\)$/);
  refused('src', /^src is not a regular file$/);
});

// ---- CLI ----------------------------------------------------------------------------------------
check('--help in an empty cwd: exit 0, Usage on stdout, nothing written; -h anywhere', () => {
  const p = project();
  const r = run(p, '--help');
  assert.equal(r.code, 0, r.err); assert.match(r.out, /Usage/); assert.match(r.out, /Exit codes/);
  assert.deepEqual(readdirSync(p), []);
  const h = run(p, 'missing.html', '--from', 'x', '-h');
  assert.equal(h.code, 0); assert.match(h.out, /Usage/); assert.deepEqual(readdirSync(p), []);
});
check('usage error: exit 2, one stderr line "replace: …", nothing on stdout', () => {
  const p = project();
  const r = run(p, 'a.html', '--from', 'x');
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.match(oneLine(r.err), /^replace: .*--to/);
});
check('literal: regex metacharacters in --from and $& in --to stay literal; file rewritten, no temp file left', () => {
  const p = project();
  const f = put(join(p, 'a.css'), '.x(1)+[a] { }\n.y { }\n');
  const r = run(p, 'a.css', '--from', '.x(1)+[a]', '--to', '.z$&$1');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'replace a.css: 1 replaced\n');
  assert.equal(read(f), '.z$&$1 { }\n.y { }\n');
  noTmp(p);
});
check('regex: numbered and named groups', () => {
  const p = project();
  const f = put(join(p, 'a.html'), '<a href="/en/about">About</a>\n<a href="/en/contact">Contact</a>\n');
  const r = run(p, 'a.html', '--regex', '--from', 'href="/en/(?<page>\\w+)">(\\w+)<', '--to', 'href="/de/$<page>">$2!<', '--all');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'replace a.html: 2 replaced\n');
  assert.equal(read(f), '<a href="/de/about">About!</a>\n<a href="/de/contact">Contact!</a>\n');
});
check('count mismatch: default exactly 1 vs 2 → exit 2, file byte-identical, count line + grep -C2 context, one stderr line', () => {
  const p = project();
  const lines = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);
  lines[2] = '<p class="x">A</p>'; lines[9] = '<p class="x">B</p>';
  const body = `${lines.join('\n')}\n`;
  const f = put(join(p, 'page.html'), body);
  const r = run(p, 'page.html', '--from', 'class="x"', '--to', 'class="y"');
  assert.equal(r.code, 2);
  assert.equal(read(f), body);
  assert.equal(r.out, [
    'page.html: 2 matches (expected exactly 1)',
    '  1: l1', '  2: l2', '  3> <p class="x">A</p>', '  4: l4', '  5: l5',
    '  --',
    '  8: l8', '  9: l9', '  10> <p class="x">B</p>', '  11: l11', '  12: l12',
  ].join('\n') + '\n');
  assert.equal(oneLine(r.err), 'replace: refused — expected exactly 1 match per file; 1 of 1 file differs');
  noTmp(p);
});
check('--all: 0 matches refused, 3 matches all replaced', () => {
  const p = project();
  const f = put(join(p, 'a.txt'), 'one two one three one\n');
  const zero = run(p, 'a.txt', '--from', 'four', '--to', '4', '--all');
  assert.equal(zero.code, 2); assert.equal(zero.out, 'a.txt: 0 matches (expected at least 1)\n');
  assert.match(oneLine(zero.err), /^replace: refused — expected at least 1 match per file; 1 of 1 file differs$/);
  const all = run(p, 'a.txt', '--from', 'one', '--to', '1', '--all');
  assert.equal(all.code, 0, all.err); assert.equal(all.out, 'replace a.txt: 3 replaced\n');
  assert.equal(read(f), '1 two 1 three 1\n');
});
check('--count 2: exactly 2 replaced; 3 refused', () => {
  const p = project();
  const f = put(join(p, 'a.txt'), 'x x\n');
  const ok = run(p, 'a.txt', '--from', 'x', '--to', 'y', '--count', '2');
  assert.equal(ok.code, 0, ok.err); assert.equal(read(f), 'y y\n');
  put(f, 'y y y\n');
  const off = run(p, 'a.txt', '--from', 'y', '--to', 'z', '--count', '2');
  assert.equal(off.code, 2); assert.match(off.out, /^a\.txt: 3 matches \(expected exactly 2\)\n/);
  assert.match(off.err, /expected exactly 2 matches per file/);
  assert.equal(read(f), 'y y y\n');
});
check('--dry-run: nothing written, the would-be line and the context shown; a miss is still a refusal', () => {
  const p = project();
  const f = put(join(p, 'a.html'), 'a\nb\n<h1>Old</h1>\nc\n');
  const r = run(p, 'a.html', '--from', 'Old', '--to', 'New', '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'replace a.html: 1 would be replaced\n  1: a\n  2: b\n  3> <h1>Old</h1>\n  4: c\n');
  assert.equal(read(f), 'a\nb\n<h1>Old</h1>\nc\n');
  const miss = run(p, 'a.html', '--from', 'Gone', '--to', 'New', '--dry-run');
  assert.equal(miss.code, 2); assert.match(miss.err, /refused/);
  noTmp(p);
});
check('multi-file: two of three files off → no file written', () => {
  const p = project();
  const a = put(join(p, 'a.html'), 'old\n');
  const b = put(join(p, 'b.html'), 'old old\n');
  const c = put(join(p, 'c.html'), 'new\n');
  const r = run(p, 'a.html', 'b.html', 'c.html', '--from', 'old', '--to', 'new');
  assert.equal(r.code, 2);
  assert.equal(read(a), 'old\n'); assert.equal(read(b), 'old old\n'); assert.equal(read(c), 'new\n');
  assert.equal(oneLine(r.err), 'replace: refused — expected exactly 1 match per file; 2 of 3 files differ');
  assert.deepEqual(r.out.split('\n').filter((l) => !l.startsWith('  ')), ['a.html: 1 match (expected exactly 1)', 'b.html: 2 matches (expected exactly 1)', 'c.html: 0 matches (expected exactly 1)', '']);
  const ok = run(p, 'a.html', 'c.html', 'a.html', '--from', '\n', '--to', '!\n', '--all');
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, 'replace a.html: 1 replaced\nreplace c.html: 1 replaced\n', 'a duplicate is processed once');
  assert.equal(read(a), 'old!\n'); assert.equal(read(c), 'new!\n');
});
check('--files-from: ** matches nested and top-level files; node_modules and dot-directories skipped; {a,b}; nothing matched → refused', () => {
  const p = project();
  const top = put(join(p, 'src', 'index.html'), '<p>old</p>\n');
  const deep = put(join(p, 'src', 'a', 'b', 'deep.html'), '<p>old</p>\n');
  const nm = put(join(p, 'src', 'node_modules', 'pkg', 'x.html'), '<p>old</p>\n');
  const dot = put(join(p, 'src', '.cache', 'y.html'), '<p>old</p>\n');
  const dotfile = put(join(p, 'src', '.hidden.html'), '<p>old</p>\n');
  const css = put(join(p, 'src', 'site.css'), 'old\n');
  const outside = put(join(p, 'top.html'), '<p>old</p>\n');
  assert.deepEqual(expandGlob('src/**/*.html', p), ['src/a/b/deep.html', 'src/index.html']);
  assert.deepEqual(expandGlob('src/*.{html,css}', p), ['src/index.html', 'src/site.css']);
  assert.deepEqual(expandGlob('src/.cache/*.html', p), ['src/.cache/y.html'], 'a pattern segment starting with "." enters the dot-directory');
  const r = run(p, '--files-from', 'src/**/*.html', '--from', 'old', '--to', 'new');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'replace src/a/b/deep.html: 1 replaced\nreplace src/index.html: 1 replaced\n');
  assert.equal(read(top), '<p>new</p>\n'); assert.equal(read(deep), '<p>new</p>\n');
  for (const f of [nm, dot, dotfile, outside]) assert.equal(read(f), '<p>old</p>\n', f);
  assert.equal(read(css), 'old\n');
  const both = run(p, 'src/site.css', '--files-from', 'src/*.{html,css}', '--from', 'new', '--to', 'newer', '--count', '1', '--json');
  assert.equal(both.code, 2, 'site.css holds no "new"');
  assert.deepEqual(JSON.parse(both.out).files.map((x) => x.file), ['src/site.css', 'src/index.html'], 'positional first, the duplicate dropped');
  const none = run(p, '--files-from', 'src/**/*.md', '--from', 'x', '--to', 'y');
  assert.equal(none.code, 2); assert.match(oneLine(none.err), /^replace: refused — --files-from src\/\*\*\/\*\.md matches no file/);
});
check('guards: outside path and symlink leaving the project refused, nothing written', () => {
  const p = project();
  const other = project();
  const ext = put(join(other, 'x.html'), 'old\n');
  const own = put(join(p, 'a.html'), 'old\n');
  for (const args of [[`../${basename(other)}/x.html`], [ext]]) {
    const r = run(p, ...args, '--from', 'old', '--to', 'new');
    assert.equal(r.code, 2); assert.match(oneLine(r.err), /^replace: refused — .* is outside the project \(/);
  }
  symlinkSync(ext, join(p, 'link.html'));
  symlinkSync(other, join(p, 'ext'));
  for (const f of ['link.html', 'ext/x.html']) {
    const r = run(p, 'a.html', f, '--from', 'old', '--to', 'new');
    assert.equal(r.code, 2); assert.match(oneLine(r.err), new RegExp(`^replace: refused — ${f.replace('.', '\\.')} resolves outside the project \\(`));
  }
  assert.equal(read(ext), 'old\n'); assert.equal(read(own), 'old\n');
  const missing = run(p, 'nope.html', '--from', 'old', '--to', 'new');
  assert.equal(missing.code, 2); assert.equal(oneLine(missing.err), 'replace: refused — no such file nope.html');
});
check('guards: a symlink inside the project is followed — the link stays, its target is edited', () => {
  const p = project();
  const target = put(join(p, 'real', 'target.html'), 'old\n');
  symlinkSync(join('real', 'target.html'), join(p, 'link.html'));
  const r = run(p, 'link.html', '--from', 'old', '--to', 'new');
  assert.equal(r.code, 0, r.err); assert.equal(r.out, 'replace link.html: 1 replaced\n');
  assert.ok(lstatSync(join(p, 'link.html')).isSymbolicLink());
  assert.equal(read(target), 'new\n');
  noTmp(join(p, 'real')); noTmp(p);
});
check('guards: an owned ledger is refused, named or globbed, and names its writer', () => {
  const p = project();
  const f = put(join(p, 'stardust', 'rollout', 'progress.json'), '{"units":{}}\n');
  const r = run(p, 'stardust/rollout/progress.json', '--from', 'units', '--to', 'x');
  assert.equal(r.code, 2);
  assert.equal(oneLine(r.err), 'replace: refused — stardust/rollout/progress.json is written by stardust/progress.mjs — use it');
  const g = run(p, '--files-from', 'stardust/**/*.json', '--from', 'units', '--to', 'x');
  assert.equal(g.code, 2); assert.match(g.err, /progress\.json is written by stardust\/progress\.mjs/);
  symlinkSync(join('stardust', 'rollout', 'progress.json'), join(p, 'alias.json'));
  const l = run(p, 'alias.json', '--from', 'units', '--to', 'x');
  assert.equal(l.code, 2); assert.match(l.err, /is written by stardust\/progress\.mjs/);
  assert.equal(read(f), '{"units":{}}\n');
});
check('guards: a NUL byte → looks binary; bytes that are not UTF-8 → refused', () => {
  const p = project();
  writeFileSync(join(p, 'img.bin'), Buffer.from([0x6f, 0x6c, 0x64, 0x00]));
  writeFileSync(join(p, 'latin.txt'), Buffer.from([0x6f, 0x6c, 0x64, 0xe9]));
  const b = run(p, 'img.bin', '--from', 'old', '--to', 'new');
  assert.equal(b.code, 2); assert.equal(oneLine(b.err), 'replace: refused — img.bin looks binary');
  const l = run(p, 'latin.txt', '--from', 'old', '--to', 'new');
  assert.equal(l.code, 2); assert.equal(oneLine(l.err), 'replace: refused — latin.txt is not UTF-8 text');
});
check('--json: one object, keys in order, matches capped at 20 (1-based), refusal sets refused and keeps the stderr line', () => {
  const p = project();
  put(join(p, 'a.txt'), `${'x\n'.repeat(25)}`);
  put(join(p, 'b.txt'), 'x\n');
  const r = run(p, 'a.txt', 'b.txt', '--from', 'x', '--to', 'y', '--all', '--json');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trimEnd().split('\n').length, 1);
  const j = JSON.parse(r.out);
  assert.deepEqual(Object.keys(j), ['ok', 'dryRun', 'mode', 'expect', 'refused', 'files']);
  assert.equal(j.ok, true); assert.equal(j.dryRun, false); assert.equal(j.mode, 'literal'); assert.equal(j.refused, null);
  assert.deepEqual(j.expect, { op: 'atLeast', n: 1 });
  assert.deepEqual(Object.keys(j.files[0]), ['file', 'count', 'written', 'matches', 'matchesOmitted']);
  assert.equal(j.files[0].file, 'a.txt'); assert.equal(j.files[0].count, 25); assert.equal(j.files[0].written, true);
  assert.equal(j.files[0].matches.length, 20); assert.equal(j.files[0].matchesOmitted, 5);
  assert.deepEqual(j.files[0].matches[1], { line: 2, column: 1 });
  assert.deepEqual(j.files[1], { file: 'b.txt', count: 1, written: true, matches: [{ line: 1, column: 1 }], matchesOmitted: 0 });
  const off = run(p, 'a.txt', '--regex', '--from', 'y', '--to', 'z', '--json');
  assert.equal(off.code, 2);
  const k = JSON.parse(off.out);
  assert.equal(k.ok, false); assert.equal(k.mode, 'regex'); assert.deepEqual(k.expect, { op: 'exactly', n: 1 });
  assert.match(k.refused, /^expected exactly 1 match per file/); assert.equal(k.files[0].written, false);
  assert.match(oneLine(off.err), /^replace: refused — expected exactly 1 match/);
  const dry = JSON.parse(run(p, 'b.txt', '--from', 'y', '--to', 'z', '--dry-run', '--json').out);
  assert.equal(dry.ok, true); assert.equal(dry.dryRun, true); assert.equal(dry.files[0].written, false);
  const guard = run(p, 'missing.txt', '--from', 'y', '--to', 'z', '--json');
  assert.equal(guard.code, 2); assert.deepEqual(JSON.parse(guard.out).files, []); assert.equal(JSON.parse(guard.out).refused, 'no such file missing.txt');
});
check('value flags: --to --brand-new renames a CSS custom property; --to --json is refused; --from=--json form', () => {
  const p = project();
  const f = put(join(p, 'a.css'), ':root { --brand-old: red; }\n.x { color: var(--brand-old); }\n');
  const r = run(p, 'a.css', '--from', '--brand-old', '--to', '--brand-new', '--all');
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f), ':root { --brand-new: red; }\n.x { color: var(--brand-new); }\n');
  const j = run(p, 'a.css', '--from', '--brand-new', '--to', '--json');
  assert.equal(j.code, 2); assert.match(oneLine(j.err), /^replace: --to needs a value \(got --json/);
  const t = put(join(p, 'notes.txt'), 'pass --json here\n');
  const e = run(p, 'notes.txt', '--from=--json', '--to=--text');
  assert.equal(e.code, 0, e.err); assert.equal(read(t), 'pass --text here\n');
});
check('regex: an empty match is refused; a replacement that leaves the text identical is "unchanged", not written', () => {
  const p = project();
  const f = put(join(p, 'a.txt'), 'abc\n');
  const r = run(p, 'a.txt', '--regex', '--from', 'x*', '--to', 'y');
  assert.equal(r.code, 2); assert.match(oneLine(r.err), /^replace: refused — --from matches the empty string/);
  const ino = statSync(f).ino;
  const u = run(p, 'a.txt', '--regex', '--from', '(b)', '--to', '$1');
  assert.equal(u.code, 0, u.err); assert.match(oneLine(u.out), /^replace a\.txt: unchanged/);
  assert.equal(statSync(f).ino, ino, 'not rewritten');
});
check('atomic write keeps the file mode, CRLF line endings and a BOM byte-for-byte', () => {
  const p = project();
  const f = put(join(p, 'run.sh'), '\uFEFFecho old\r\nexit 0\r\n');
  chmodSync(f, 0o751);
  const r = run(p, 'run.sh', '--from', 'old', '--to', 'new');
  assert.equal(r.code, 0, r.err);
  assert.equal(statSync(f).mode & 0o7777, 0o751);
  assert.deepEqual(readFileSync(f), Buffer.from('\uFEFFecho new\r\nexit 0\r\n', 'utf8'));
  const g = put(join(p, 'ro.txt'), 'old\n');
  chmodSync(g, 0o640);
  assert.equal(run(p, 'ro.txt', '--from', 'old', '--to', 'new').code, 0);
  assert.equal(statSync(g).mode & 0o7777, 0o640);
});
check('I/O failure (directory not writable): exit 1, the temp file removed, the file unchanged', () => {
  if (process.getuid?.() === 0) { console.log('  (skipped as root: permissions do not apply)'); return; }
  const p = project();
  const f = put(join(p, 'locked', 'a.txt'), 'old\n');
  chmodSync(join(p, 'locked'), 0o555);
  try {
    const r = run(p, 'locked/a.txt', '--from', 'old', '--to', 'new');
    assert.equal(r.code, 1, r.err); assert.match(oneLine(r.err), /^replace: .*locked\/a\.txt/);
    assert.equal(read(f), 'old\n');
    assert.deepEqual(readdirSync(join(p, 'locked')), ['a.txt']);
  } finally { chmodSync(join(p, 'locked'), 0o755); }
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nreplace: all checks passed');
process.exit(failed ? 1 : 0);
