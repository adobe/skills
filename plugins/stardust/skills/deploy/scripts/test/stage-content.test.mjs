#!/usr/bin/env node
// skills/deploy/scripts/test/stage-content.test.mjs — stage-content.mjs on a synthetic project (fixtures/stage-content/:
// one template whose archetype guide-a has its gated document; guide-b a leaf and guide-f a folder index with encoded
// documents and no delivered one; guide-c a folder index whose leaf form content/guides/c.html is already delivered;
// guide-d an encoded page whose content/ document was authored by hand; guide-e not encoded; guide-g encoded clean
// once, then stopped. Every encoded document has the encoder's provenance: a sidecar where migrate places it, with
// encode.output and audit.encode.status, and an entry in the template's manifest). Covers: the copy and the
// changed-paths list in deploy-batch's --paths form; unchanged → zero writes; the hand-edit guard, adoption of an
// identical document and the override; the record/re-stage cycle across a finaliser's rewrite; the alternate-form
// refusal in both directions; the stale/stopped refusal; --help in an empty directory. No network, no browser.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stage-content.mjs');
const FIXTURE = join(HERE, 'fixtures', 'stage-content');
const LEDGER = join('stardust', 'deploy', 'stage-ledger.json');
const scratch = mkdtempSync(join(tmpdir(), 'stage-content-test-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
let n = 0;
const project = () => { const dir = join(scratch, `p${n += 1}`); cpSync(FIXTURE, dir, { recursive: true }); return dir; };
const run = (args, cwd) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const MANIFEST = 'stardust/import/guide-a/manifest.json';
const SIDECAR = { 'guide-b': 'stardust/migrated/guides/b._meta.json', 'guide-d': 'stardust/migrated/guides/d._meta.json', 'guide-f': 'stardust/migrated/guides/f/_meta.json' };
const ENCODED = { 'guide-b': 'stardust/encoded/guides/b.html', 'guide-d': 'stardust/encoded/guides/d.html', 'guide-f': 'stardust/encoded/guides/f/index.html' };
const editJson = (dir, rel, fn) => { const v = JSON.parse(read(dir, rel)); fn(v); writeFileSync(join(dir, rel), `${JSON.stringify(v, null, 2)}\n`); };
// what a clean re-encode leaves behind: the document, its sidecar's encode.output.sha and the manifest entry, in step
const reEncode = (dir, slug, edit) => {
  const html = edit(read(dir, ENCODED[slug]));
  writeFileSync(join(dir, ENCODED[slug]), html);
  editJson(dir, SIDECAR[slug], (v) => { v.encode.output.sha = sha(html); });
  editJson(dir, MANIFEST, (v) => { v[ENCODED[slug]] = sha(html); });
  return html;
};
const ledger = (dir) => JSON.parse(read(dir, LEDGER));
// a deploy-batch --paths file outside the scanned trees
const pathsFile = (dir, ...paths) => { const f = join(dir, 'batch.paths'); writeFileSync(f, `${paths.join('\n')}\n`); return f; };
const stage = (dir, ...paths) => run(['--paths', pathsFile(dir, ...paths)], dir);
const record = (dir, ...paths) => run(['--record', '--paths', pathsFile(dir, ...paths)], dir);
// every file under the project with its bytes and mtime (the list file excluded): equal snapshots = zero writes
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== 'batch.paths') out[relative(dir, full)] = `${statSync(full).mtimeMs} ${sha(readFileSync(full))}`;
    }
  };
  walk(dir);
  return out;
};
// deploy-batch's web path for a file under content/: its path relative to content, minus .html, with a leading slash
const webPath = (dir, file) => `/${relative(join(dir, 'content'), join(dir, file)).split(sep).join('/').replace(/\.html$/, '')}`;

check('--help answers before any I/O: exit 0, usage on stdout, the empty cwd stays empty', () => {
  const dir = join(scratch, 'empty'); mkdirSync(dir);
  const r = run(['--help'], dir);
  assert.equal(r.code, 0, r.err); assert.match(r.out, /^Usage: node stage-content\.mjs/m);
  assert.deepEqual(readdirSync(dir), [], 'nothing written');
});

check('usage errors exit 1 and write nothing', () => {
  const dir = project(); const before = snapshot(dir);
  assert.match(run([], dir).err, /--template <archetype-slug> or --paths <file>/);
  assert.equal(run([], dir).code, 1);
  assert.equal(run(['--bogus'], dir).code, 1);
  const r = run(['--record', '--template', 'guide-a', '--overwrite-hand-edit', 'guide-b'], dir);
  assert.equal(r.code, 1); assert.match(r.err, /--overwrite-hand-edit stages; --record never overwrites/);
  const stray = run(['--template', 'guide-a', '--overwrite-hand-edit', 'guide-x'], dir);
  assert.equal(stray.code, 1); assert.match(stray.err, /guide-x: not a selected page/);
  const arch = run(['--template', 'guide-a', '--overwrite-hand-edit', 'guide-a'], dir);
  assert.equal(arch.code, 1); assert.match(arch.err, /guide-a: an archetype is never staged/);
  assert.equal(run(['--template', 'no-such'], dir).code, 1);
  assert.deepEqual(snapshot(dir), before);
});

check('copies the encoded documents into content/ and prints their paths in deploy-batch --paths form', () => {
  const dir = project();
  const r = stage(dir, '/guides/f/index', 'guides/b');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '/guides/b\n/guides/f/index\n', 'stdout carries only the paths to deliver, sorted');
  for (const [doc, enc] of [['content/guides/b.html', 'stardust/encoded/guides/b.html'], ['content/guides/f/index.html', 'stardust/encoded/guides/f/index.html']]) {
    assert.equal(read(dir, doc), read(dir, enc), `${doc} is the encoded bytes`);
  }
  assert.deepEqual(r.out.trim().split('\n'), ['content/guides/b.html', 'content/guides/f/index.html'].map((f) => webPath(dir, f)), 'the paths deploy-batch derives from those files');
  assert.match(r.err, /^stage-content: staged 2 · pending 0 · unchanged 0 · skipped 0 · refused 0$/m);
  const text = read(dir, LEDGER);
  assert.deepEqual(JSON.parse(text), {
    'content/guides/b.html': { finalised: null, staged: sha(read(dir, 'stardust/encoded/guides/b.html')) },
    'content/guides/f/index.html': { finalised: null, staged: sha(read(dir, 'stardust/encoded/guides/f/index.html')) },
  });
  assert.ok(text.endsWith('}\n') && text.indexOf('"finalised"') < text.indexOf('"staged"'), 'sorted keys, trailing newline');
  assert.deepEqual(readdirSync(join(dir, 'stardust', 'deploy')), ['stage-ledger.json'], 'no tmp file or lock left');
});

check('--template stages the siblings: skips the archetype and an unencoded page, refuses a duplicate and an unrecorded document (exit 2)', () => {
  const dir = project();
  const archetype = read(dir, 'content/guides/a.html'); const handMade = read(dir, 'content/guides/d.html');
  const r = run(['--template', 'guide-a'], dir);
  assert.equal(r.code, 2, r.err);
  assert.equal(r.out, '/guides/b\n/guides/f/index\n', 'the refused pages are not in the list');
  assert.equal(read(dir, 'content/guides/a.html'), archetype, 'the gated archetype document stays as authored');
  assert.match(r.err, /guide-a skipped: the archetype/);
  assert.match(r.err, /guide-e skipped: not encoded \(no stardust\/encoded\/guides\/e\.html\)/);
  assert.match(r.err, /guide-c duplicate: content\/guides\/c\.html .*content\/guides\/c\/index\.html/);
  assert.ok(!existsSync(join(dir, 'content/guides/c/index.html')), 'the second document is never written');
  assert.match(r.err, /guide-d hand-edit: content\/guides\/d\.html .*never staged.*--overwrite-hand-edit guide-d/);
  assert.equal(read(dir, 'content/guides/d.html'), handMade, 'the hand-authored document is untouched');
  assert.deepEqual(Object.keys(ledger(dir)), ['content/guides/b.html', 'content/guides/f/index.html']);
  assert.match(r.err, /guide-g stopped: stardust\/migrated\/guides\/g\._meta\.json audit\.encode\.status is variance/);
  assert.ok(!existsSync(join(dir, 'content/guides/g.html')), 'the earlier encode of a stopped page is never staged');
  assert.match(r.err, /^stage-content: staged 2 · pending 0 · unchanged 0 · skipped 2 · refused 3$/m);
});

check('the other delivered form refuses the page in both directions, whichever form the list names', () => {
  const dir = project();
  for (const p of ['/guides/c/index', '/guides/c']) {
    const r = stage(dir, p);
    assert.equal(r.code, 2, r.err); assert.equal(r.out, '');
    assert.match(r.err, /guide-c duplicate: content\/guides\/c\.html already delivers this page; staging would add content\/guides\/c\/index\.html/);
  }
  mkdirSync(join(dir, 'content/guides/b')); writeFileSync(join(dir, 'content/guides/b/index.html'), '<body><main><div><h1>Guide B</h1></div></main></body>\n');
  const leaf = stage(dir, '/guides/b');
  assert.equal(leaf.code, 2); assert.match(leaf.err, /guide-b duplicate: content\/guides\/b\/index\.html already delivers this page; staging would add content\/guides\/b\.html/);
  assert.ok(!existsSync(join(dir, 'content/guides/b.html')));
  assert.ok(!existsSync(join(dir, LEDGER)), 'nothing recorded');
});

check('unchanged: a staged page stays listed until --record; then a re-run writes nothing and lists nothing', () => {
  const dir = project();
  assert.equal(stage(dir, '/guides/b').code, 0);
  let before = snapshot(dir);
  const pending = stage(dir, '/guides/b');
  assert.equal(pending.code, 0, pending.err); assert.equal(pending.out, '/guides/b\n', 'still to deliver: not recorded yet');
  assert.match(pending.err, /guide-b pending/);
  assert.deepEqual(snapshot(dir), before, 'zero writes');
  const rec = record(dir, '/guides/b');
  assert.equal(rec.code, 0, rec.err); assert.match(rec.err, /^stage-content --record: recorded 1 · unchanged 0 · skipped 0 · refused 0$/m);
  assert.equal(ledger(dir)['content/guides/b.html'].finalised, sha(read(dir, 'content/guides/b.html')));
  before = snapshot(dir);
  const again = stage(dir, '/guides/b');
  assert.equal(again.code, 0, again.err); assert.equal(again.out, '');
  assert.match(again.err, /^stage-content: staged 0 · pending 0 · unchanged 1 · skipped 0 · refused 0$/m);
  const reRec = record(dir, '/guides/b');
  assert.equal(reRec.code, 0); assert.match(reRec.err, /recorded 0 · unchanged 1/);
  assert.deepEqual(snapshot(dir), before, 'zero writes: neither content/ nor the ledger');
});

check('an unowned content/ document is refused while it differs, adopted without a write once it holds the encoded bytes', () => {
  const dir = project();
  assert.equal(stage(dir, '/guides/d').code, 2, 'differing: refused');
  writeFileSync(join(dir, 'content/guides/d.html'), read(dir, 'stardust/encoded/guides/d.html'));
  const mtime = statSync(join(dir, 'content/guides/d.html')).mtimeMs;
  const r = stage(dir, '/guides/d');
  assert.equal(r.code, 0, r.err); assert.equal(r.out, '/guides/d\n', 'listed: its finalisers and PUT may never have run');
  assert.match(r.err, /guide-d adopted: content\/guides\/d\.html already holds the encoded bytes/);
  assert.equal(statSync(join(dir, 'content/guides/d.html')).mtimeMs, mtime, 'content/ not rewritten');
  assert.deepEqual(ledger(dir), { 'content/guides/d.html': { finalised: null, staged: sha(read(dir, 'stardust/encoded/guides/d.html')) } });
  assert.equal(record(dir, '/guides/d').code, 0);
  assert.equal(stage(dir, '/guides/d').out, '', 'then owned like any staged page');
});

check('record/re-stage cycle: the finalised form is kept while the encoding holds, replaced when it changes', () => {
  const dir = project();
  const doc = 'content/guides/b.html'; const enc = join(dir, 'stardust/encoded/guides/b.html');
  assert.equal(stage(dir, '/guides/b').code, 0);
  // a finaliser rewrites the staged copy in place (sanitise-like: a character becomes an entity)
  const finalised = read(dir, doc).replace('Guide B', 'Guide&#160;B');
  writeFileSync(join(dir, doc), finalised);
  const early = stage(dir, '/guides/b');
  assert.equal(early.code, 2, 'a change not yet recorded reads as a hand edit: --record runs right after the finalisers');
  assert.equal(read(dir, doc), finalised);
  assert.equal(record(dir, '/guides/b').code, 0);
  assert.deepEqual(ledger(dir)[doc], { finalised: sha(finalised), staged: sha(readFileSync(enc, 'utf8')) });
  const same = stage(dir, '/guides/b');
  assert.equal(same.code, 0, same.err); assert.equal(same.out, ''); assert.match(same.err, /guide-b unchanged/);
  assert.equal(read(dir, doc), finalised, 'the finalised form is not replaced by the unfinalised encoding of the same bytes');
  // a re-encode changes the encoded document: the recorded sha proves no hand edit, so the new bytes are staged
  reEncode(dir, 'guide-b', (h) => h.replace('Encoded by the template map.', 'Encoded by the revised map.'));
  const restaged = stage(dir, '/guides/b');
  assert.equal(restaged.code, 0, restaged.err); assert.equal(restaged.out, '/guides/b\n');
  assert.equal(read(dir, doc), readFileSync(enc, 'utf8'));
  assert.deepEqual(ledger(dir)[doc], { finalised: null, staged: sha(readFileSync(enc, 'utf8')) });
  assert.equal(record(dir, '/guides/b').code, 0);
  assert.equal(ledger(dir)[doc].finalised, sha(readFileSync(enc, 'utf8')), 'a no-op chain records the staged bytes');
});

check('guard: an edit after --record refuses the re-stage (exit 2) and --record never absorbs it; --overwrite-hand-edit replaces it', () => {
  const dir = project();
  const doc = 'content/guides/b.html'; const enc = join(dir, 'stardust/encoded/guides/b.html');
  assert.equal(stage(dir, '/guides/b').code, 0); assert.equal(record(dir, '/guides/b').code, 0);
  const edited = read(dir, doc).replace('</p>', ' A sentence added by hand.</p>');
  writeFileSync(join(dir, doc), edited);
  reEncode(dir, 'guide-b', (h) => h.replace('template map', 'revised map'));
  const recorded = read(dir, LEDGER);
  const r = stage(dir, '/guides/b');
  assert.equal(r.code, 2, r.err); assert.equal(r.out, '');
  assert.match(r.err, /guide-b hand-edit: content\/guides\/b\.html changed since it was recorded .*--overwrite-hand-edit guide-b/);
  assert.equal(read(dir, doc), edited, 'the hand edit is kept');
  const rec = record(dir, '/guides/b');
  assert.equal(rec.code, 2); assert.match(rec.err, /guide-b hand-edit/);
  assert.equal(read(dir, LEDGER), recorded, 'neither run touched the ledger');
  const over = run(['--paths', pathsFile(dir, '/guides/b', '/guides/d'), '--overwrite-hand-edit', 'guide-b,guide-d'], dir);
  assert.equal(over.code, 0, over.err); assert.equal(over.out, '/guides/b\n/guides/d\n');
  assert.equal(read(dir, doc), readFileSync(enc, 'utf8'));
  assert.equal(read(dir, 'content/guides/d.html'), read(dir, 'stardust/encoded/guides/d.html'), 'an unrecorded document is replaced too');
});

check('never a stale or stopped document: the bytes must match the sidecar and the manifest, the status must be clean (exit 2)', () => {
  const dir = project();
  const enc = join(dir, ENCODED['guide-b']);
  const refused = (re) => {
    const r = run(['--paths', pathsFile(dir, '/guides/b'), '--overwrite-hand-edit', 'guide-b'], dir);
    assert.equal(r.code, 2, r.err); assert.equal(r.out, ''); assert.match(r.err, re);
    assert.ok(!existsSync(join(dir, 'content/guides/b.html')), 'nothing staged, --overwrite-hand-edit notwithstanding');
  };
  const html = read(dir, ENCODED['guide-b']);
  writeFileSync(enc, html.replace('Guide B', 'Guide B, edited in place'));
  refused(/guide-b stale: stardust\/encoded\/guides\/b\.html is sha256:\w{12}… but stardust\/migrated\/guides\/b\._meta\.json encode\.output\.sha is sha256:\w{12}…/);
  writeFileSync(enc, html);
  editJson(dir, MANIFEST, (v) => { v[ENCODED['guide-b']] = sha('an older encode'); });
  refused(/guide-b stale: stardust\/import\/guide-a\/manifest\.json records sha256:\w{12}… for stardust\/encoded\/guides\/b\.html, the file is sha256:\w{12}…/);
  editJson(dir, MANIFEST, (v) => { delete v[ENCODED['guide-b']]; });
  refused(/guide-b stale: stardust\/import\/guide-a\/manifest\.json has no entry for stardust\/encoded\/guides\/b\.html/);
  editJson(dir, MANIFEST, (v) => { v[ENCODED['guide-b']] = sha(html); });
  editJson(dir, SIDECAR['guide-b'], (v) => { v.audit.encode.status = 'incomplete'; });
  refused(/guide-b stopped: stardust\/migrated\/guides\/b\._meta\.json audit\.encode\.status is incomplete/);
  rmSync(join(dir, SIDECAR['guide-b']));
  refused(/guide-b stale: no sidecar stardust\/migrated\/guides\/b\._meta\.json/);
  assert.ok(!existsSync(join(dir, LEDGER)), 'nothing recorded');
});

check('--paths: a path outside the roster is skipped; a malformed ledger stops the run (exit 1) before any write', () => {
  const dir = project();
  const r = stage(dir, '/nav', '/guides/e');
  assert.equal(r.code, 0, r.err); assert.equal(r.out, '');
  assert.match(r.err, /\/nav skipped: not a roster page/); assert.match(r.err, /guide-e skipped: not encoded/);
  mkdirSync(join(dir, 'stardust', 'deploy'), { recursive: true }); writeFileSync(join(dir, LEDGER), '{"content/guides/b.html": ');
  const before = snapshot(dir);
  const bad = stage(dir, '/guides/b');
  assert.equal(bad.code, 1); assert.match(bad.err, /stage-ledger\.json: invalid JSON/);
  assert.deepEqual(snapshot(dir), before);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nstage-content: all checks passed');
process.exit(failed ? 1 : 0);
