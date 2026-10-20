#!/usr/bin/env node
// skills/stardust/scripts/test/copy-sets.test.mjs — the documented project copy sets cover every sibling
// a copied script imports. A skill's Setup copies scripts into stardust/scripts/<skill>/ and runs the
// copies (the plugin tree ships no node_modules); a script that resolves a sibling skill's module in the
// project layout (../<skill>/<file>) needs that file copied too — a recorded run hit "json-edit needs
// deploy's file-lock.mjs" and copied it by hand, because extract's copy step named neither.
// Static graph: every skills/*/scripts/**/*.mjs (not test/) → the sibling-skill files it names through a
// relative import (`from '../../x/scripts/y.mjs'`, `import('…')`) or a literal
// join(HERE, '..', '..', '<skill>', 'scripts', …, '<file>') path — the plugin-layout half of the
// two-layout arrays the scripts use. For each documented set, every edge out of a script in the set
// lands in the set, or is declared under `later` with the phase whose copy step adds it; every named
// target exists; the doc passage that states each set names the single files it relies on. The graph
// self-check keeps the extraction honest: the json-edit → file-lock edge must be found. Run: node <this file>.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '..', '..', '..');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const doc = (rel) => readFileSync(join(SKILLS, rel), 'utf8');

// ---- the graph -----------------------------------------------------------------------------------
const scripts = [];
(function walk(d) {
  for (const e of readdirSync(d).sort()) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { if (e !== 'test' && e !== 'node_modules') walk(p); } else if (/\.(mjs|js)$/.test(e) && /\/skills\/[^/]+\/scripts\//.test(p)) scripts.push(p);
  }
})(SKILLS);

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const JOIN_HERE = /join\(HERE((?:\s*,\s*'[^']*')+)\s*\)/g;
const skillOf = (rel) => rel.split('/')[0];
// `<skill>/<file under scripts/>` for a path inside skills/<skill>/scripts/, else null.
const scriptRel = (abs) => { const m = relative(SKILLS, abs).match(/^([a-z][a-z0-9-]*)\/scripts\/(.+)$/); return m ? `${m[1]}/${m[2]}` : null; };

/** Every cross-skill edge of one script: [{ from, to, exists }] with from/to as `<skill>/<file>`. */
export function edgesOf(file) {
  const text = readFileSync(file, 'utf8');
  const from = scriptRel(file);
  const targets = new Set();
  for (const m of text.matchAll(IMPORT)) targets.add(resolve(dirname(file), m[1]));
  for (const m of text.matchAll(JOIN_HERE)) {
    const segs = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    if (/\.(mjs|js|json)$/.test(segs.at(-1) || '')) targets.add(resolve(dirname(file), ...segs));
  }
  const out = [];
  for (const t of targets) {
    const to = scriptRel(t);
    if (!to || skillOf(to) === skillOf(from)) continue;
    out.push({ from, to, exists: existsSync(t) });
  }
  return out;
}

const edges = scripts.flatMap(edgesOf);
const edgeKey = (e) => `${e.from} → ${e.to}`;

// ---- the documented sets -----------------------------------------------------------------------
// `later`: edges a script in the set has whose target a LATER copy step adds — say which.
const PHASE5 = 'replica Phase 5: the handoff copy step adds deploy/ and rollout/ whole (unit done / unit-commit run there)';
const LATER = {
  'stardust/progress.mjs → deploy/eds-path.mjs': PHASE5,
  'stardust/progress.mjs → rollout/lib.mjs': PHASE5,
  'stardust/unit-commit.mjs → deploy/eds-path.mjs': PHASE5,
};
const SETS = [
  { name: 'extract Setup (extract/SKILL.md § Setup, "Script location matters")', dirs: ['extract', 'stardust'], files: ['diff/live-session.mjs', 'deploy/file-lock.mjs'], later: LATER },
  { name: 'replica Setup step 4 (replica/SKILL.md § Setup)', dirs: ['replica', 'stardust', 'migrate', 'diff'], files: ['deploy/file-lock.mjs'], later: LATER },
  { name: 'replica Phase 5 (replica/reference/handoff-contract.md, the copy step)', dirs: ['replica', 'stardust', 'migrate', 'diff', 'deploy', 'rollout', 'dynamics'], files: [], later: {} },
];
const inSet = (set, rel) => set.dirs.includes(skillOf(rel)) || set.files.includes(rel);

check('graph self-check: the two-layout lock and encoder edges are found, every named target exists', () => {
  const keys = new Set(edges.map(edgeKey));
  for (const k of ['stardust/json-edit.mjs → deploy/file-lock.mjs', 'stardust/progress.mjs → deploy/file-lock.mjs', 'deploy/content-count.mjs → migrate/encode/dom.mjs', 'rollout/block-origin.mjs → diff/unit-geometry.mjs']) assert.ok(keys.has(k), `${k} not found — the extraction missed a pattern`);
  const dangling = edges.filter((e) => !e.exists).map(edgeKey);
  assert.deepEqual(dangling, [], 'a literal sibling path names a file that does not exist');
  assert.ok(scripts.length > 100, `${scripts.length} scripts walked`);
});

for (const set of SETS) {
  check(`${set.name}: every sibling a copied script imports is in the set (or declared later)`, () => {
    const missing = [];
    for (const e of edges) {
      if (!inSet(set, e.from) || inSet(set, e.to)) continue;
      if (set.later[edgeKey(e)]) continue;
      missing.push(`${edgeKey(e)} — add ${e.to} to the copy step, or declare when a later step copies it`);
    }
    assert.deepEqual(missing, []);
    const stale = Object.keys(set.later).filter((k) => !edges.some((e) => edgeKey(e) === k));
    assert.deepEqual(stale, [], 'a `later` entry names an edge no script has any more — prune it');
  });
}

check('the copy-step texts name the single files their sets rely on', () => {
  const extract = doc('extract/SKILL.md');
  const setup = extract.slice(extract.indexOf('**Script location matters.**'), extract.indexOf('**Bundled crawler.**'));
  for (const s of ['json-edit.mjs', 'file-lock.mjs', 'stardust/scripts/deploy/', 'live-session.mjs']) assert.ok(setup.includes(s), `extract/SKILL.md § Setup names ${s}`);
  const replica = doc('replica/SKILL.md');
  const step4 = replica.slice(replica.indexOf('4. Copy scripts into the project'), replica.indexOf('5. Seed the site-wide hide list'));
  assert.ok(step4.length > 0, 'replica Setup step 4 found');
  for (const s of ['json-edit.mjs', 'file-lock.mjs', 'stardust/scripts/deploy/', '../migrate/scripts/', '../diff/scripts/']) assert.ok(step4.includes(s), `replica/SKILL.md § Setup step 4 names ${s}`);
  const handoff = doc('replica/reference/handoff-contract.md');
  const copy = handoff.split('\n').find((l) => l.startsWith('This card owns the Phase 5 copy step'));
  assert.ok(copy, 'handoff-contract.md: the Phase 5 copy step paragraph');
  for (const s of ['../../deploy/scripts/', '../../rollout/scripts/', '../../dynamics/scripts/', 'json-edit.mjs', 'file-lock.mjs']) assert.ok(copy.includes(s), `handoff-contract.md copy step names ${s}`);
});

console.log(failed ? `\n${failed} failing` : '\ncopy-sets: all checks passed');
process.exit(failed ? 1 : 0);
