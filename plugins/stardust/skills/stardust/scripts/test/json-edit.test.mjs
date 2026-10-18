#!/usr/bin/env node
// skills/stardust/scripts/test/json-edit.test.mjs — the json-edit.mjs contract: the path syntax (dots,
// a quoted key holding dots, [n] indexes, . for the root), the value rule (JSON when it parses, else the
// string), set / merge / append / delete and their refusals, __proto__ / constructor / prototype refused
// in the path and inside a value, the guards (outside the project, a symlink leaving it, an owned
// ledger, an absent file without --create, malformed JSON), the write keeping the file's indent and
// trailing newline, `unchanged` writing nothing, parallel writers losing no key, both script layouts,
// a missing file-lock.mjs, `--` before a value starting with --, and --help before any I/O.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdit, formatLine, parseArgs, parsePath } from '../json-edit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'json-edit.mjs');
const REPLACE = join(HERE, '..', 'replace.mjs');
const LOCK_LIB = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'file-lock.mjs');
const root = mkdtempSync(join(tmpdir(), 'json-edit-test-'));
let seq = 0;
const project = () => { seq += 1; const d = join(root, `p${seq}`); mkdirSync(d); return d; };
const runWith = (script, cwd, args) => { const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const run = (cwd, ...args) => runWith(SCRIPT, cwd, args);
const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); return p; };
const read = (p) => readFileSync(p, 'utf8');
const readJ = (p) => JSON.parse(read(p));
const oneLine = (s) => { assert.equal(s.split('\n').filter(Boolean).length, 1, `one line expected, got: ${s}`); return s.trimEnd(); };
const noLeftovers = (dir) => assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock')), [], `temp file or lock left in ${dir}`);
const refusedCli = (r, re) => { assert.equal(r.code, 2, `exit 2 expected, got ${r.code}: ${r.err}`); assert.equal(r.out, ''); assert.match(oneLine(r.err), re); };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// ---- pure helpers -------------------------------------------------------------------------------
check('parsePath: dots, a quoted key holding dots (\\" and \\\\ escaped), [n] indexes, . = the root', () => {
  assert.deepEqual(parsePath('a.b.c'), ['a', 'b', 'c']);
  assert.deepEqual(parsePath('a."b.c".d'), ['a', 'b.c', 'd']);
  assert.deepEqual(parsePath('"x\\"y\\\\z"'), ['x"y\\z']);
  assert.deepEqual(parsePath('a[0].b'), parsePath('a.0.b'));
  assert.deepEqual(parsePath('a[0][12]'), ['a', '0', '12']);
  assert.deepEqual(parsePath('[2].x'), ['2', 'x']);
  assert.deepEqual(parsePath('"a.b"[1]'), ['a.b', '1']);
  assert.deepEqual(parsePath('.'), []);
});
check('parsePath: empty segments, unbalanced quotes or brackets, a bad index → usage error (exit 2)', () => {
  const bad = (text, re) => assert.throws(() => parsePath(text), (e) => e.code === 2 && re.test(e.message), `${text} → ${re}`);
  for (const t of ['', 'a..b', '.a', 'a.', 'a.[0]', '..']) bad(t, /empty/);
  bad('a."b', /unbalanced quote/);
  bad('a[0', /unbalanced bracket/);
  bad('a]', /unbalanced bracket/);
  bad('a[x]', /not an index/);
  bad('a[]', /not an index/);
  bad('a"b"', /quote/);
  bad('"a"b', /after/);
  bad('"a\\x"', /escape/);
});
check('parseArgs: the four forms, --create anywhere, the value rule (JSON when it parses, else the string), -5 a positional, -- ends the options', () => {
  const s = parseArgs(['f.json', 'set', 'a.b', '12', '--create']);
  assert.equal(s.file, 'f.json'); assert.equal(s.op, 'set'); assert.equal(s.path, 'a.b'); assert.deepEqual(s.segments, ['a', 'b']); assert.equal(s.value, 12); assert.equal(s.create, true);
  assert.equal(parseArgs(['f.json', 'set', 'a', 'true']).value, true);
  assert.deepEqual(parseArgs(['f.json', 'set', 'a', '{"x":[1]}']).value, { x: [1] });
  assert.equal(parseArgs(['f.json', 'set', 'a', 'hello world']).value, 'hello world');
  assert.equal(parseArgs(['f.json', 'set', 'a', '"12"']).value, '12');
  assert.equal(parseArgs(['f.json', 'set', 'a', '-5']).value, -5);
  assert.equal(parseArgs(['--create', 'f.json', 'append', '.', 'x']).create, true);
  const d = parseArgs(['f.json', 'delete', 'a[1]']);
  assert.equal(d.op, 'delete'); assert.deepEqual(d.segments, ['a', '1']); assert.equal(d.value, undefined); assert.equal(d.create, false);
  const dash = parseArgs(['f.json', 'set', 'flag', '--', '--create']);
  assert.equal(dash.value, '--create'); assert.equal(dash.create, false);
  assert.deepEqual(parseArgs(['f.json', 'merge', '.', '{"a":{"b":1}}']).value, { a: { b: 1 } });
});
check('parseArgs: usage errors (exit 2)', () => {
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad([], /usage/i);
  bad(['f.json'], /usage/i);
  bad(['f.json', 'put', 'a', '1'], /unknown operation "put"/);
  bad(['f.json', 'set'], /set needs a <path>/);
  bad(['f.json', 'set', 'a'], /set needs a <value>/);
  bad(['f.json', 'merge', 'a'], /merge needs a <json-object>/);
  bad(['f.json', 'set', 'a', '1', '2'], /unexpected argument/);
  bad(['f.json', 'delete', 'a', 'b'], /unexpected argument/);
  bad(['f.json', 'set', 'a', '--value', '1'], /unknown option --value/);
  bad(['f.json', 'set', 'a', '--create=yes', '1'], /unknown option --create=yes/);
  bad(['f.json', 'merge', 'a', '[1]'], /merge needs a JSON object/);
  bad(['f.json', 'merge', 'a', 'plain'], /merge needs a JSON object/);
  bad(['f.json', 'set', '.', '1'], /set on the root/);
  bad(['f.json', 'delete', '.'], /delete on the root/);
  bad(['f.json', 'set', 'a..b', '1'], /empty/);
});
check('applyEdit set: intermediates created, the input left as it was, a quoted key with dots, an index replaced; refusals', () => {
  const doc = { a: { keep: 1 } };
  const r = applyEdit(doc, 'set', 'a.b.c', 1);
  assert.deepEqual(r.doc, { a: { keep: 1, b: { c: 1 } } }); assert.equal(r.before, undefined); assert.equal(r.after, 1);
  assert.deepEqual(doc, { a: { keep: 1 } }, 'pure: the input is not mutated');
  assert.deepEqual(applyEdit({}, 'set', 'a."b.c".d', true).doc, { a: { 'b.c': { d: true } } });
  const arr = applyEdit({ list: [{ n: 'a' }, { n: 'b' }] }, 'set', 'list[1].n', 'x');
  assert.deepEqual(arr.doc, { list: [{ n: 'a' }, { n: 'x' }] }); assert.equal(arr.before, 'b');
  assert.deepEqual(applyEdit([1, 2], 'set', '[0]', 9).doc, [9, 2]);
  const bad = (d, path, re) => assert.throws(() => applyEdit(d, 'set', path, 1), (e) => e.code === 2 && re.test(e.message), `${path} → ${re}`);
  bad({ a: { b: 5 } }, 'a.b.c', /^a\.b is a number, not an object$/);
  bad({ a: null }, 'a.b', /^a is null, not an object$/);
  bad({ 'x.y': 'text' }, '"x.y".z', /^"x\.y" is a string, not an object$/);
  bad({ list: [1, 2] }, 'list[2]', /^list\[2\]: index 2 out of range \(length 2\)$/);
  bad({ list: [1, 2] }, 'list.x', /"x" is not an index/);
  bad('text', 'a', /^the root \(\.\) is a string, not an object$/);
});
check('applyEdit merge: deep — a nested object kept, a scalar replaced, an array replaced; absent target created; a non-object target refused', () => {
  const doc = { cfg: { keep: { x: 1 }, n: 1, list: [1, 2], sub: { a: 1, b: 2 } }, other: true };
  const r = applyEdit(doc, 'merge', 'cfg', { n: 2, list: [3], sub: { b: 3, c: 4 }, gone: null });
  assert.deepEqual(r.doc, { cfg: { keep: { x: 1 }, n: 2, list: [3], sub: { a: 1, b: 3, c: 4 }, gone: null }, other: true });
  assert.deepEqual(r.before, { keep: { x: 1 }, n: 1, list: [1, 2], sub: { a: 1, b: 2 } });
  assert.deepEqual(applyEdit({}, 'merge', 'a.b', { c: 1 }).doc, { a: { b: { c: 1 } } });
  assert.deepEqual(applyEdit({ a: 1 }, 'merge', '.', { b: { c: 2 } }).doc, { a: 1, b: { c: 2 } });
  assert.throws(() => applyEdit({ a: [1] }, 'merge', 'a', { b: 1 }), (e) => e.code === 2 && /^a is an array, not an object$/.test(e.message));
  assert.throws(() => applyEdit([], 'merge', '.', { b: 1 }), (e) => e.code === 2 && /^the root \(\.\) is an array, not an object$/.test(e.message));
  assert.throws(() => applyEdit({}, 'merge', 'a', [1]), (e) => e.code === 2 && /merge needs a JSON object/.test(e.message));
});
check('applyEdit append: to an existing array, an absent one ([value]), the root array; a non-array refused', () => {
  const r = applyEdit({ a: [1] }, 'append', 'a', { b: 2 });
  assert.deepEqual(r.doc, { a: [1, { b: 2 }] }); assert.deepEqual(r.before, [1]); assert.deepEqual(r.after, [1, { b: 2 }]);
  assert.deepEqual(applyEdit({}, 'append', 'x.y', 'v').doc, { x: { y: ['v'] } });
  assert.deepEqual(applyEdit([1], 'append', '.', 2).doc, [1, 2]);
  assert.throws(() => applyEdit({ a: { b: 1 } }, 'append', 'a', 1), (e) => e.code === 2 && /^a is an object, not an array$/.test(e.message));
  assert.throws(() => applyEdit({}, 'append', '.', 1), (e) => e.code === 2 && /^the root \(\.\) is an object, not an array$/.test(e.message));
});
check('applyEdit delete: an object key, an array element (spliced); a missing path refused naming the file', () => {
  const r = applyEdit({ a: { b: 1, c: 2 } }, 'delete', 'a.b');
  assert.deepEqual(r.doc, { a: { c: 2 } }); assert.equal(r.before, 1); assert.equal(r.after, undefined);
  assert.deepEqual(applyEdit({ l: ['x', 'y', 'z'] }, 'delete', 'l[1]').doc, { l: ['x', 'z'] });
  assert.throws(() => applyEdit({ a: {} }, 'delete', 'a.b', undefined, { file: 'f.json' }), (e) => e.code === 2 && e.message === 'no a.b in f.json');
  assert.throws(() => applyEdit({ a: 1 }, 'delete', 'a.b', undefined, { file: 'f.json' }), (e) => e.code === 2 && e.message === 'no a.b in f.json');
  assert.throws(() => applyEdit({ l: [] }, 'delete', 'l[0]'), (e) => e.code === 2 && /index 0 out of range \(length 0\)/.test(e.message));
});
check('applyEdit: __proto__ / constructor / prototype refused in the path and at any depth of a value; Object.prototype untouched', () => {
  const refused = (fn, re) => assert.throws(fn, (e) => e.code === 2 && re.test(e.message), String(re));
  refused(() => applyEdit({}, 'set', '__proto__.polluted', 1), /"__proto__"/);
  refused(() => applyEdit({}, 'set', 'a.constructor.prototype.polluted', 1), /"constructor"/);
  refused(() => applyEdit({}, 'set', 'a."prototype"', 1), /"prototype"/);
  refused(() => applyEdit({}, 'delete', 'a.__proto__'), /"__proto__"/);
  refused(() => applyEdit({}, 'merge', 'a', JSON.parse('{"a":{"__proto__":{"polluted":1}}}')), /"__proto__" at a\.__proto__/);
  refused(() => applyEdit({}, 'merge', '.', JSON.parse('{"__proto__":{"polluted":1}}')), /"__proto__"/);
  refused(() => applyEdit({}, 'set', 'a', JSON.parse('[{"constructor":{"polluted":1}}]')), /"constructor"/);
  refused(() => applyEdit({}, 'append', 'a', JSON.parse('{"x":{"prototype":1}}')), /"prototype"/);
  assert.equal({}.polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
});
check('formatLine: compact JSON before → after, cut to 120 characters with …, (absent) / (deleted), unchanged', () => {
  assert.equal(formatLine('f.json', 'set', 'a.b', { before: undefined, after: { x: 1 }, written: true }), 'json-edit f.json set a.b: (absent) → {"x":1}');
  assert.equal(formatLine('f.json', 'delete', 'a', { before: [1], after: undefined, written: true }), 'json-edit f.json delete a: [1] → (deleted)');
  assert.equal(formatLine('f.json', 'set', 'a', { before: 1, after: 1, written: false }), 'json-edit f.json set a: 1 → 1 unchanged');
  const long = formatLine('f.json', 'set', 'a', { before: undefined, after: 'x'.repeat(200), written: true });
  assert.equal(long, `json-edit f.json set a: (absent) → "${'x'.repeat(119)}…`);
});

// ---- the CLI -----------------------------------------------------------------------------------
check('--help in an empty cwd: exit 0, Usage on stdout, nothing written; -h before -- wins over bad arguments', () => {
  const p = project();
  const h = run(p, '--help');
  assert.equal(h.code, 0, h.err); assert.match(h.out, /Usage:/); assert.match(h.out, /json-edit\.mjs <file> set <path> <value>/);
  assert.match(h.out, /Writes:/); assert.match(h.out, /Exit codes: 0/);
  assert.deepEqual(readdirSync(p), []);
  assert.equal(run(p, 'missing.json', 'frob', '--bogus', '-h').code, 0);
  assert.deepEqual(readdirSync(p), []);
});
check('set: nested, intermediates created, one output line, the file\'s 2-space style kept, no lock or temp file left', () => {
  const p = project();
  const f = put(join(p, 'data.json'), '{\n  "a": 1\n}\n');
  const r = run(p, 'data.json', 'set', 'b.c.d', '5');
  assert.equal(r.code, 0, r.err); assert.equal(oneLine(r.out), 'json-edit data.json set b.c.d: (absent) → 5');
  assert.equal(read(f), '{\n  "a": 1,\n  "b": {\n    "c": {\n      "d": 5\n    }\n  }\n}\n');
  noLeftovers(p);
});
check('set: value typing (number, boolean, object, string fallback, "12" a string), a quoted key with dots, an [n] index', () => {
  const p = project();
  const f = put(join(p, 'v.json'), '{ "list": [{ "n": "a" }, { "n": "b" }] }\n');
  for (const [k, v] of [['num', '12'], ['bool', 'true'], ['obj', '{"x":[1,2]}'], ['str', 'hello world'], ['quoted', '"12"']]) {
    const r = run(p, 'v.json', 'set', k, v);
    assert.equal(r.code, 0, r.err);
  }
  const q = run(p, 'v.json', 'set', 'site."a.b".c', '1');
  assert.equal(q.code, 0, q.err); assert.equal(oneLine(q.out), 'json-edit v.json set site."a.b".c: (absent) → 1');
  const i = run(p, 'v.json', 'set', 'list[1].n', 'x');
  assert.equal(i.code, 0, i.err); assert.equal(oneLine(i.out), 'json-edit v.json set list[1].n: "b" → "x"');
  const j = readJ(f);
  assert.equal(j.num, 12); assert.equal(j.bool, true); assert.deepEqual(j.obj, { x: [1, 2] }); assert.equal(j.str, 'hello world'); assert.equal(j.quoted, '12');
  assert.deepEqual(j.site, { 'a.b': { c: 1 } }); assert.deepEqual(j.list, [{ n: 'a' }, { n: 'x' }]);
  const o = run(p, 'v.json', 'set', 'list[5].n', 'x');
  refusedCli(o, /^json-edit: refused — list\[5\]\.n: index 5 out of range \(length 2\)$/);
});
check('merge: deep (a nested object kept, a scalar replaced, an array replaced); a non-object payload → usage error, nothing written', () => {
  const p = project();
  const f = put(join(p, 'm.json'), `${JSON.stringify({ cfg: { keep: { x: 1 }, n: 1, list: [1, 2] } }, null, 2)}\n`);
  const r = run(p, 'm.json', 'merge', 'cfg', '{"n":2,"list":[3],"keep":{"y":2}}');
  assert.equal(r.code, 0, r.err);
  assert.equal(oneLine(r.out), 'json-edit m.json merge cfg: {"keep":{"x":1},"n":1,"list":[1,2]} → {"keep":{"x":1,"y":2},"n":2,"list":[3]}');
  assert.deepEqual(readJ(f), { cfg: { keep: { x: 1, y: 2 }, n: 2, list: [3] } });
  const before = read(f);
  const u = run(p, 'm.json', 'merge', 'cfg', '[1]');
  assert.equal(u.code, 2); assert.match(oneLine(u.err), /^json-edit: merge needs a JSON object/);
  assert.equal(read(f), before);
});
check('append: to an existing array, an absent one, a non-array refused (nothing written)', () => {
  const p = project();
  const f = put(join(p, 'a.json'), '{"notes":["one"],"meta":{}}\n');
  const r = run(p, 'a.json', 'append', 'notes', 'two');
  assert.equal(r.code, 0, r.err); assert.equal(oneLine(r.out), 'json-edit a.json append notes: ["one"] → ["one","two"]');
  const n = run(p, 'a.json', 'append', 'log', '{"at":1}');
  assert.equal(n.code, 0, n.err); assert.equal(oneLine(n.out), 'json-edit a.json append log: (absent) → [{"at":1}]');
  assert.equal(read(f), '{"notes":["one","two"],"meta":{},"log":[{"at":1}]}\n');
  refusedCli(run(p, 'a.json', 'append', 'meta', '1'), /^json-edit: refused — meta is an object, not an array$/);
  assert.equal(read(f), '{"notes":["one","two"],"meta":{},"log":[{"at":1}]}\n');
});
check('delete: an object key, an array element; a missing path refused naming the file', () => {
  const p = project();
  const f = put(join(p, 'd.json'), '{"a":{"b":1,"c":2},"l":[1,2,3]}');
  const k = run(p, 'd.json', 'delete', 'a.b');
  assert.equal(k.code, 0, k.err); assert.equal(oneLine(k.out), 'json-edit d.json delete a.b: 1 → (deleted)');
  const e = run(p, 'd.json', 'delete', 'l[0]');
  assert.equal(e.code, 0, e.err); assert.equal(oneLine(e.out), 'json-edit d.json delete l[0]: 1 → (deleted)');
  assert.equal(read(f), '{"a":{"c":2},"l":[2,3]}');
  refusedCli(run(p, 'd.json', 'delete', 'a.zz'), /^json-edit: refused — no a\.zz in d\.json$/);
  assert.equal(read(f), '{"a":{"c":2},"l":[2,3]}');
});
check('unsafe keys: __proto__ / constructor / prototype in the path or inside a merge payload refused, exit 2, file untouched', () => {
  const p = project();
  const f = put(join(p, 'u.json'), '{"a":{}}\n');
  for (const path of ['__proto__.polluted', 'a.constructor', 'a.prototype.x', '"__proto__"']) refusedCli(run(p, 'u.json', 'set', path, '1'), /^json-edit: refused — .*"(__proto__|constructor|prototype)"/);
  refusedCli(run(p, 'u.json', 'merge', '.', '{"a":{"__proto__":{"x":1}}}'), /^json-edit: refused — .*"__proto__" at a\.__proto__/);
  refusedCli(run(p, 'u.json', 'set', 'b', '{"constructor":{"prototype":{"x":1}}}'), /^json-edit: refused — .*"constructor"/);
  assert.equal(read(f), '{"a":{}}\n');
  assert.equal({}.x, undefined);
});
check('guards: outside the project, a symlink leaving it (file or directory), not a regular file — refused, nothing written', () => {
  const p = project();
  const other = project();
  const ext = put(join(other, 'x.json'), '{"a":1}\n');
  refusedCli(run(p, `../${basename(other)}/x.json`, 'set', 'a', '2'), /^json-edit: refused — \.\.\/.*x\.json is outside the project \(/);
  refusedCli(run(p, ext, 'set', 'a', '2'), /is outside the project/);
  refusedCli(run(p, `../${basename(other)}/new.json`, 'set', 'a', '2', '--create'), /is outside the project/);
  symlinkSync(ext, join(p, 'link.json'));
  refusedCli(run(p, 'link.json', 'set', 'a', '2'), /^json-edit: refused — link\.json resolves outside the project \(/);
  symlinkSync(other, join(p, 'ext'));
  refusedCli(run(p, 'ext/x.json', 'set', 'a', '2'), /resolves outside the project/);
  refusedCli(run(p, 'ext/sub/new.json', 'set', 'a', '2', '--create'), /^json-edit: refused — ext\/sub\/new\.json resolves outside the project \(/);
  mkdirSync(join(p, 'dir.json'));
  refusedCli(run(p, 'dir.json', 'set', 'a', '2'), /dir\.json is not a regular file/);
  symlinkSync('loop.json', join(p, 'loop.json'));
  refusedCli(run(p, 'loop.json', 'set', 'a', '2'), /^json-edit: refused — loop\.json: symlink loop$/);
  refusedCli(run(p, 'loop.json/new.json', 'set', 'a', '2', '--create'), /^json-edit: refused — loop\.json\/new\.json: symlink loop$/);
  assert.equal(read(ext), '{"a":1}\n');
  assert.deepEqual(readdirSync(other).sort(), ['x.json']);
  assert.deepEqual(readdirSync(p).sort(), ['dir.json', 'ext', 'link.json', 'loop.json']);
});
check('guards: a ledger with a dedicated writer refused naming the writer (also through --create, and differently cased on a case-insensitive disk)', () => {
  const p = project();
  const led = put(join(p, 'stardust', 'rollout', 'progress.json'), '{"units":{}}\n');
  refusedCli(run(p, 'stardust/rollout/progress.json', 'set', 'units.c1', '{}'), /^json-edit: refused — stardust\/rollout\/progress\.json is written by stardust\/progress\.mjs — use it$/);
  refusedCli(run(p, 'stardust/state.json', 'set', 'a', '1', '--create'), /is written by stardust\/state\.mjs/);
  if (existsSync(join(p, 'STARDUST'))) {
    refusedCli(run(p, 'Stardust/Rollout/Progress.json', 'set', 'units.c1', '{}'), /stardust\/rollout\/progress\.json is written by stardust\/progress\.mjs/);
    refusedCli(run(p, 'STARDUST/state.json', 'set', 'a', '1', '--create'), /stardust\/state\.json is written by stardust\/state\.mjs/);
  }
  assert.equal(read(led), '{"units":{}}\n');
  assert.deepEqual(readdirSync(join(p, 'stardust')), ['rollout']);
});
check('absent file: refused without --create (nothing created); --create starts {} with parent dirs, [] for append .', () => {
  const p = project();
  refusedCli(run(p, 'notes/n.json', 'set', 'a', '1'), /^json-edit: refused — no such file notes\/n\.json — pass --create to start one$/);
  assert.deepEqual(readdirSync(p), []);
  const c = run(p, 'notes/deep/n.json', 'set', 'a.b', '1', '--create');
  assert.equal(c.code, 0, c.err); assert.equal(oneLine(c.out), 'json-edit notes/deep/n.json set a.b: (absent) → 1');
  assert.equal(read(join(p, 'notes', 'deep', 'n.json')), '{\n  "a": {\n    "b": 1\n  }\n}\n');
  const a = run(p, '--create', 'list.json', 'append', '.', '"x"');
  assert.equal(a.code, 0, a.err); assert.equal(read(join(p, 'list.json')), '[\n  "x"\n]\n');
  refusedCli(run(p, 'fresh/f.json', 'delete', 'a', '--create'), /^json-edit: refused — no a in fresh\/f\.json$/);
  assert.deepEqual(readdirSync(p).sort(), ['list.json', 'notes'], 'a refused --create leaves no directory');
  noLeftovers(join(p, 'notes', 'deep'));
});
check('style: a tab, 4 spaces, a compact one-line file, no trailing newline, CRLF — each kept', () => {
  const p = project();
  const tab = put(join(p, 'tab.json'), '{\n\t"a": 1\n}\n');
  const four = put(join(p, 'four.json'), '{\n    "a": [\n        1\n    ]\n}\n');
  const compact = put(join(p, 'compact.json'), '{"a":1,"b":{"c":2}}\n');
  const bare = put(join(p, 'bare.json'), '{\n  "a": 1\n}');
  const crlf = put(join(p, 'crlf.json'), '{\r\n  "a": 1\r\n}\r\n');
  for (const f of ['tab.json', 'four.json', 'compact.json', 'bare.json', 'crlf.json']) assert.equal(run(p, f, 'set', 'z', '{"k":true}').code, 0, f);
  assert.equal(read(tab), '{\n\t"a": 1,\n\t"z": {\n\t\t"k": true\n\t}\n}\n');
  assert.equal(read(four), '{\n    "a": [\n        1\n    ],\n    "z": {\n        "k": true\n    }\n}\n');
  assert.equal(read(compact), '{"a":1,"b":{"c":2},"z":{"k":true}}\n');
  assert.equal(read(bare), '{\n  "a": 1,\n  "z": {\n    "k": true\n  }\n}');
  assert.equal(read(crlf), '{\r\n  "a": 1,\r\n  "z": {\r\n    "k": true\r\n  }\r\n}\r\n');
});
check('unchanged: the same value again writes nothing (mtime kept) and the line says unchanged', () => {
  const p = project();
  const f = put(join(p, 's.json'), '{\n  "a": {\n    "b": 1\n  }\n}\n');
  const past = new Date('2020-01-01T00:00:00Z');
  utimesSync(f, past, past);
  const r = run(p, 's.json', 'set', 'a.b', '1');
  assert.equal(r.code, 0, r.err); assert.equal(oneLine(r.out), 'json-edit s.json set a.b: 1 → 1 unchanged');
  assert.equal(statSync(f).mtimeMs, past.getTime());
  const m = run(p, 's.json', 'merge', 'a', '{"b":1}');
  assert.equal(m.code, 0, m.err); assert.match(oneLine(m.out), / unchanged$/);
  assert.equal(statSync(f).mtimeMs, past.getTime());
  noLeftovers(p);
});
check('malformed JSON: refused with the parser\'s first line, the file untouched', () => {
  const p = project();
  const f = put(join(p, 'bad.json'), '{"a": 1,}\n');
  refusedCli(run(p, 'bad.json', 'set', 'a', '2'), /^json-edit: refused — bad\.json is not JSON \(.+\) — nothing written$/);
  assert.equal(read(f), '{"a": 1,}\n');
  noLeftovers(p);
});
check('--: a value starting with -- after it; before it an unknown --option is a usage error', () => {
  const p = project();
  const f = put(join(p, 'o.json'), '{}\n');
  const r = run(p, 'o.json', 'set', 'prop', '--', '--brand-new');
  assert.equal(r.code, 0, r.err); assert.equal(readJ(f).prop, '--brand-new');
  const u = run(p, 'o.json', 'set', 'prop', '--brand-new');
  assert.equal(u.code, 2); assert.match(oneLine(u.err), /^json-edit: unknown option --brand-new/);
  const n = run(p, 'o.json', 'set', 'n', '-5');
  assert.equal(n.code, 0, n.err); assert.equal(readJ(f).n, -5);
});
check('layouts: the project copy (stardust/scripts/stardust + ../deploy/file-lock.mjs) works; no file-lock.mjs → exit 2 naming both paths, nothing written', () => {
  const d = project();
  const copy = join(d, 'stardust', 'scripts', 'stardust', 'json-edit.mjs');
  mkdirSync(dirname(copy), { recursive: true }); mkdirSync(join(d, 'stardust', 'scripts', 'deploy'));
  copyFileSync(SCRIPT, copy); copyFileSync(REPLACE, join(dirname(copy), 'replace.mjs'));
  copyFileSync(LOCK_LIB, join(d, 'stardust', 'scripts', 'deploy', 'file-lock.mjs'));
  const ok = runWith(copy, d, ['stardust/notes.json', 'set', 'a', '1', '--create']);
  assert.equal(ok.code, 0, ok.err); assert.deepEqual(readJ(join(d, 'stardust', 'notes.json')), { a: 1 });
  const lone = project();
  const bare = join(lone, 'bin', 'json-edit.mjs');
  mkdirSync(dirname(bare)); copyFileSync(SCRIPT, bare); copyFileSync(REPLACE, join(lone, 'bin', 'replace.mjs'));
  const f = put(join(lone, 'x.json'), '{"a":1}\n');
  assert.equal(runWith(bare, lone, ['--help']).code, 0, '--help answers without the lock library');
  const r = runWith(bare, lone, ['x.json', 'set', 'a', '2']);
  assert.equal(r.code, 2); assert.match(oneLine(r.err), /file-lock\.mjs not found.*deploy\/scripts\/file-lock\.mjs.*deploy\/file-lock\.mjs.*nothing written/);
  assert.equal(read(f), '{"a":1}\n');
  assert.deepEqual(readdirSync(lone).sort(), ['bin', 'x.json']);
});

// ---- parallel writers --------------------------------------------------------------------------
// Eight writers set eight keys on one file, all launched at once: the lock and the re-read inside it
// keep every key.
const par = project();
put(join(par, 'shared.json'), '{}\n');
const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((res) => {
  const c = spawn(process.execPath, [SCRIPT, 'shared.json', 'set', `k${i}`, String(i)], { cwd: par, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  c.stderr.on('data', (b) => { err += b; });
  c.on('close', (code) => res({ code, err }));
})));
check('parallel: 8 concurrent sets on one file lose no key, leave no lock or temp file', () => {
  for (const r of results) assert.equal(r.code, 0, r.err);
  assert.deepEqual(readJ(join(par, 'shared.json')), Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, i])));
  assert.deepEqual(readdirSync(par), ['shared.json']);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\njson-edit: all checks passed');
process.exit(failed ? 1 : 0);
