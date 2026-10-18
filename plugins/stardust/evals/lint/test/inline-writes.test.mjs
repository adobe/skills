#!/usr/bin/env node
// evals/lint/test/inline-writes.test.mjs — the inline-writes lint contract: a unit (fenced block or
// paragraph; list items and headings start a new one) is a finding when it holds both an inline
// interpreter marker and a file-write call, reported at the write call's line; read-only probes,
// `python3 -m`, prohibitions and a marker and a write in different units stay clean; the CLI scans
// SKILL.md and reference/**/*.md only, sorts its findings, and answers --help and usage errors.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKERS, WRITES, scanText } from '../inline-writes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, '..', 'inline-writes.mjs');
const REPO = resolve(HERE, '..', '..', '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'inline-writes-test-'));
const run = (cwd, ...args) => { const r = spawnSync(process.execPath, [LINT, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const md = (...lines) => lines.join('\n');
const matches = (list, s) => list.some((re) => re.test(s));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const HEREDOC_WRITE = md(
  'Rewrite the stylesheet:',
  '',
  '```bash',
  "python3 - <<'PY'",
  "p = 'styles/site.css'",
  "s = open(p).read().replace('a', 'b')",
  "open(p, 'w').write(s)",
  'PY',
  '```',
);

// ---- the regex lists ---------------------------------------------------------------------------
check('MARKERS: inline programs (-c, lone -, heredoc, -e/--eval/-p/--print), not -m or a script file', () => {
  for (const s of ['python -c "x"', 'python3 -c "x"', 'python3.12 -c "x"', 'python3 -I -c "x"', "python3 - <<'PY'", 'cat a | python3 -', 'python3 <<EOF',
    'node -e "x"', 'node --eval "x"', 'node -p "x"', 'node --print "x"', "node - <<'JS'", 'node <<JS', 'node --input-type=module -e "x"']) {
    assert.ok(matches(MARKERS, s), `marker expected: ${s}`);
  }
  for (const s of ['python3 -m http.server 8765', 'python3 tools/fix.py <<EOF', 'python3 --version', 'node scripts/state.mjs set x',
    'node --version', 'node_modules -e', 'a DOM node']) {
    assert.ok(!matches(MARKERS, s), `no marker expected: ${s}`);
  }
});
check('WRITES: open with a w/a/x/+ mode (positional or mode=), the pathlib, json and fs writers; not reads or json.dumps', () => {
  for (const s of ["open(p, 'w')", 'open(p, "a")', "open(p, 'x')", "open(p, 'r+')", "open(p, mode='wb')", "open(os.path.join(d, f), 'w', encoding='utf-8')",
    "Path(p).open('w')", 'p.write_text(s)', 'p.write_bytes(b)', 'json.dump(d, f)', 'fs.writeFileSync(p, s)', 'fs.appendFileSync(p, s)',
    'await writeFile(p, s)', 'fs.createWriteStream(p)']) {
    assert.ok(matches(WRITES, s), `write expected: ${s}`);
  }
  for (const s of ['open(p)', "open(p, 'r')", "open(p, 'rb')", "open(p, encoding='ascii')", 'print(json.dumps(d))', 'fs.readFileSync(p)',
    "import { writeFile } from 'node:fs/promises'", 'p.read_text()']) {
    assert.ok(!matches(WRITES, s), `no write expected: ${s}`);
  }
});

// ---- findings ----------------------------------------------------------------------------------
check('finding: a fenced python3 - heredoc that opens a file with mode w, at the write call line', () => {
  assert.deepEqual(scanText(HEREDOC_WRITE), [{ line: 7, marker: 'python3 -', write: "open(p, 'w')" }]);
});
check('finding: an inline node -e span calling writeFileSync', () => {
  const text = md('Record the verdict with', '`node -e "require(\'fs\').writeFileSync(\'out.json\', s)"` and move on.');
  assert.deepEqual(scanText(text), [{ line: 2, marker: 'node -e', write: 'writeFileSync' }]);
});
check('finding: python3 -c with json.dump into open(p, w) — one finding per unit, at the first write call', () => {
  const text = md('Intro paragraph.', '', '`python3 -c "import json; json.dump(d, open(p, \'w\'))"`');
  assert.deepEqual(scanText(text), [{ line: 3, marker: 'python3 -c', write: 'json.dump' }]);
});
check('finding: pathlib .write_text under python3 -', () => {
  const text = md('```', "python3 - <<'PY'", 'import pathlib', "p = pathlib.Path('blocks/hero/hero.css')", "p.write_text(p.read_text().replace('a', 'b'))", 'PY', '```');
  assert.deepEqual(scanText(text), [{ line: 5, marker: 'python3 -', write: '.write_text' }]);
});
check('finding: a ~~~ fence, node --input-type=module -e with writeFile(, a ``` line inside does not close it', () => {
  const text = md('~~~js', 'node --input-type=module -e "', "  import { writeFile } from 'node:fs/promises';", '```', '  await writeFile(p, s)"', '~~~');
  assert.deepEqual(scanText(text), [{ line: 5, marker: 'node --input-type=module -e', write: 'writeFile' }]);
});
check('findings: one per unit, lines ascending', () => {
  const text = md(HEREDOC_WRITE, '', 'Then `node -p "fs.appendFileSync(log, line)"`.');
  assert.deepEqual(scanText(text).map((f) => [f.line, f.write]), [[7, "open(p, 'w')"], [11, 'appendFileSync']]);
});

// ---- clean -------------------------------------------------------------------------------------
check('clean: a read-only node -e probe', () => {
  assert.deepEqual(scanText('Check the version: `node -e "console.log(require(\'./package.json\').version)"`.'), []);
});
check('clean: json.dumps under python3 -c', () => {
  assert.deepEqual(scanText('`python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))"`'), []);
});
check('clean: open(p) and open(p, r) under a heredoc', () => {
  assert.deepEqual(scanText(md('```', "python3 - <<'PY'", 'print(open(p).read())', "print(open(p, 'r').read())", "print(open(q, encoding='utf-8').read())", 'PY', '```')), []);
});
check('clean: python3 -m http.server beside a writeFileSync comment in one fenced block', () => {
  const text = md('```bash', '( cd samples/<proto> && python3 -m http.server 8765 --bind 127.0.0.1 & )',
    "#    fs.writeFileSync('stardust/.work/prerender/<proto>.html', root.innerHTML)", '```');
  assert.deepEqual(scanText(text), []);
});
check('clean: a prohibition sentence names the marker but no write call', () => {
  assert.deepEqual(scanText(md('Ledger edits go through `progress.mjs unit`,', 'never a `node -e` edit.')), []);
});
check('clean: marker and write call in two different paragraphs, list items or a heading between', () => {
  assert.deepEqual(scanText(md('Never `python3 -c` for this.', '', 'The script calls `writeFileSync` once.')), []);
  assert.deepEqual(scanText(md('- probe with `node -e "…"`', '- the writer uses `writeFileSync`', '1. `python3 -c`', '2. `.write_text(`')), []);
  assert.deepEqual(scanText(md('Use `node -e` to look.', '## Writing', '`writeFileSync` lives in the script.')), []);
  assert.deepEqual(scanText(md('Use `node -e` to look:', '```', "fs.writeFileSync(p, s)", '```')), []);
});

// ---- CLI ---------------------------------------------------------------------------------------
check('CLI: the plugin tree is clean (exit 0, one summary line)', () => {
  const r = run(REPO);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^inline-writes lint: \d+ files clean\n$/);
});
const skills = join(root, 'skills');
put(join(skills, 'a', 'SKILL.md'), md('# a', '', 'Run `node scripts/a.mjs`.', ''));
put(join(skills, 'a', 'notes.md'), HEREDOC_WRITE);
check('CLI --root: a violating notes.md outside reference/ is not scanned', () => {
  const r = run(root, '--root', skills);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'inline-writes lint: 1 files clean\n');
});
check('CLI --root: violations in reference/ and SKILL.md fail with exit 1, files sorted, path:line', () => {
  put(join(skills, 'b', 'SKILL.md'), md('# b', '', '`node -e "fs.writeFileSync(p, s)"`', ''));
  put(join(skills, 'a', 'reference', 'deep', 'x.md'), HEREDOC_WRITE);
  const r = run(root, '--root', skills);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.out, '');
  const tail = ' — show the edit tool, replace.mjs or json-edit.mjs instead';
  assert.deepEqual(r.err.trimEnd().split('\n'), [
    'inline-writes lint: 2 finding(s)',
    `skills/a/reference/deep/x.md:7: inline interpreter writes a file (python3 - … open(p, 'w'))${tail}`,
    `skills/b/SKILL.md:3: inline interpreter writes a file (node -e … writeFileSync)${tail}`,
  ]);
});
check('CLI: usage errors exit 2 (unknown flag, --root missing, --root not a directory)', () => {
  assert.equal(run(root, '--bogus').code, 2);
  assert.equal(run(root, '--root').code, 2);
  assert.equal(run(root, '--root', join(skills, 'a', 'SKILL.md')).code, 2);
  assert.equal(run(root, '--root', join(root, 'missing')).code, 2);
});
check('CLI --help / -h: exit 0, usage on stdout', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(root, flag);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Usage/);
  }
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\ninline-writes: all checks passed');
process.exit(failed ? 1 : 0);
