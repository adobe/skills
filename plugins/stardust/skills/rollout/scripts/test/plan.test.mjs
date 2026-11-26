#!/usr/bin/env node
// skills/rollout/scripts/test/plan.test.mjs — plan.mjs on hand-written coverage files (no network): a first run
// converts each block on the first page that uses it in representative-first order and reuses it after; a
// later pass whose new, larger template sorts first is told to REUSE a block a delivered page already runs
// (deployed or verified), never to convert it again; --pending-only lists only the undelivered pages with those
// reuse lines; a resumed rollout whose representative failed while a sibling was deployed gets reuse for the
// sibling's blocks (and loses ◆ rep when nothing is left to convert); a missing input is exit 1; --help writes
// nothing. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'plan.mjs');
const root = mkdtempSync(join(tmpdir(), 'rollout-plan-test-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const block = (id, kind = 'block') => ({ id, kind, delivery: { edsBlockName: id, blockPath: `blocks/${id}`, status: 'pending' } });
const pg = (slug, templateId, blocks, status = 'pending') => ({ slug, path: `/${slug}`, templateId, blocks, widgets: [], delivery: { status } });
function project(name, pages) {
  const out = join(root, name);
  mkdirSync(join(out, 'coverage'), { recursive: true });
  const byTemplate = new Map();
  for (const p of pages) byTemplate.set(p.templateId, [...(byTemplate.get(p.templateId) || []), p.slug]);
  const templates = [...byTemplate].map(([id, slugs]) => ({ id, pageCount: slugs.length, representativeSlug: slugs[0], pages: slugs }));
  const ids = [...new Set(pages.flatMap((p) => p.blocks))];
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages }));
  writeFileSync(join(out, 'coverage', 'templates.json'), JSON.stringify({ templates }));
  writeFileSync(join(out, 'coverage', 'blocks.json'), JSON.stringify({ blocks: [...ids.map((id) => block(id)), block('header', 'chrome')] }));
  return out;
}
const plan = (out, ...flags) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--out', out, ...flags], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { stdout: r.stdout, doc: JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8')) };
};
const step = (doc, slug) => doc.steps.find((s) => s.slug === slug);
const ids = (list) => list.map((b) => b.id);

check('a first run: the first page in representative-first order converts a block, later pages reuse it, chrome is not a page block', () => {
  const out = project('first', [pg('a1', 'article', ['hero', 'cards', 'header']), pg('a2', 'article', ['cards']), pg('h', 'home', ['hero', 'quote'])]);
  const { doc } = plan(out);
  assert.deepEqual(doc.deliveryOrder, ['a1', 'a2', 'h']);
  assert.deepEqual(ids(step(doc, 'a1').convert), ['hero', 'cards']);
  assert.deepEqual(ids(step(doc, 'a2').reuse), ['cards']);
  assert.deepEqual(ids(step(doc, 'h').convert), ['quote']);
  assert.deepEqual(step(doc, 'h').reuse.map((b) => [b.id, b.convertedBy]), [['hero', 'a1']]);
});
check('a later pass: a new template that sorts first reuses the blocks delivered pages run (converted by the delivered page), converts only its new ones', () => {
  const out = project('extend', [
    pg('home', 'home', ['hero', 'cards'], 'verified'), pg('about', 'about', ['hero', 'hero'], 'deployed'),
    pg('s1', 'story', ['hero', 'quote']), pg('s2', 'story', ['quote', 'cards']), pg('s3', 'story', ['quote']),
  ]);
  const { doc } = plan(out);
  assert.equal(doc.deliveryOrder[0], 's1', 'the new template has the most pages and sorts first');
  assert.deepEqual(ids(step(doc, 's1').convert), ['quote']);
  assert.deepEqual(step(doc, 's1').reuse.map((b) => [b.id, b.convertedBy]), [['hero', 'about']]);
  assert.deepEqual(step(doc, 's2').reuse.map((b) => [b.id, b.convertedBy]), [['quote', 's1'], ['cards', 'home']]);
  assert.deepEqual(ids(step(doc, 'about').convert), ['hero'], 'a block listed twice on a page converts once');
  const pending = plan(out, '--pending-only');
  assert.deepEqual(pending.doc.steps.map((s) => s.slug), ['s1', 's2', 's3']);
  assert.ok(pending.doc.steps.every((s) => !ids(s.convert).includes('hero') && !ids(s.convert).includes('cards')), 'no pending page converts delivered code');
  assert.match(pending.stdout, /s1\s+pending\s+convert: quote {2}\| {2}reuse: hero/);
});
check('a resumed rollout whose representative failed while a sibling was deployed: the sibling\'s blocks are reuse on the representative, which loses ◆ rep; its own new block is still convert', () => {
  const out = project('failed-rep', [pg('r1', 'article', ['hero', 'quote'], 'failed'), pg('r2', 'article', ['hero'], 'deployed'), pg('r3', 'article', ['quote'])]);
  const { doc, stdout } = plan(out);
  assert.deepEqual(step(doc, 'r1').reuse.map((b) => [b.id, b.convertedBy]), [['hero', 'r2']], 'hero is the deployed sibling\'s live code');
  assert.deepEqual(ids(step(doc, 'r1').convert), ['quote']);
  assert.equal(step(doc, 'r1').isRepresentative, true, 'still converts quote');
  const onlyReuse = project('failed-rep-2', [pg('q1', 'article', ['hero'], 'failed'), pg('q2', 'article', ['hero'], 'verified')]);
  const second = plan(onlyReuse);
  assert.equal(step(second.doc, 'q1').isRepresentative, false, 'nothing left to convert: not a representative');
  assert.deepEqual(ids(step(second.doc, 'q2').convert), ['hero']);
  assert.match(second.stdout, /^ {2}sib q1 +failed +reuse: hero$/m);
  assert.match(stdout, /◆ rep r1 +failed +convert: quote {2}\| {2}reuse: hero/);
});
check('a missing coverage input is exit 1 with the order to run inventory then blocks', () => {
  const out = join(root, 'empty'); mkdirSync(out);
  const r = spawnSync(process.execPath, [SCRIPT, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /run inventory\.mjs then blocks\.mjs first/);
});
check('--help prints the usage and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rollout-plan-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node skills\/rollout\/scripts\/plan\.mjs/);
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true, force: true });
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nplan: all checks passed');
process.exit(failed ? 1 : 0);
