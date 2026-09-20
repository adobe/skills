#!/usr/bin/env node
// Fixture test: reference/trees.schema.json — the stardust/trees.json manifest schema (T38.1a).
//
//   doc block   the fenced JSON in reference/multilingual.md § Manifest precondition uses only schema keys (key-walk,
//               no validator dependency), carries every `required` key, every tree has lang/root/source, every strings
//               entry has value + lifted (NEGATIVE: no schema file existed — the eval criterion had nothing to check)
//   negatives   an unknown top-level key, a tree without `source`, a strings entry without `lifted` → listed
//   shape       ≤ 150 lines; $defs tree/string present; the runtime-hook snippet in the doc names getMetadata('lang')
//
// Usage: node plugins/stardust/skills/rollout/scripts/test/trees-schema.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const REF = join(HERE, '..', '..', 'reference');
const schema = JSON.parse(readFileSync(join(REF, 'trees.schema.json'), 'utf8'));
const doc = readFileSync(join(REF, 'multilingual.md'), 'utf8');
const block = (doc.match(/```json\n([\s\S]*?)\n```/) || [])[1];
assert.ok(block, 'multilingual.md carries the fenced manifest block');
const manifest = JSON.parse(block.replace(/"<ISO>"/, '"2026-09-20T00:00:00Z"').replace(/"<v>"/, '"0.25.0"'));

// key-walk: written keys ⊆ schema keys; required keys present; additionalProperties schemas followed
const defs = schema.$defs;
const deref = (node) => (node && node.$ref ? defs[node.$ref.replace('#/$defs/', '')] : node);
export function problems(obj, node, at = 'trees.json', out = []) {
  node = deref(node);
  if (!node || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { for (const [i, v] of obj.entries()) problems(v, node.items, `${at}[${i}]`, out); return out; }
  for (const k of node.required || []) if (!(k in obj)) out.push(`${at}: missing required ${k}`);
  for (const [k, v] of Object.entries(obj)) {
    const sub = node.properties && node.properties[k];
    if (sub) { problems(v, sub, `${at}.${k}`, out); continue; }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') { problems(v, node.additionalProperties, `${at}.${k}`, out); continue; }
    if (node.additionalProperties === false) out.push(`${at}.${k}: not a schema key`);
  }
  if (node.pattern && typeof obj === 'string' && !new RegExp(node.pattern).test(obj)) out.push(`${at}: ${obj} fails ${node.pattern}`);
  return out;
}
const check = (o) => { const out = problems(o, schema); for (const t of o.trees || []) for (const k of ['lang', 'root']) if (typeof t[k] === 'string' && !new RegExp(defs.tree.properties[k].pattern).test(t[k])) out.push(`${k} ${t[k]} fails its pattern`); return out; };
assert.deepEqual(check(manifest), [], `the documented manifest validates: ${check(manifest)}`);
assert.deepEqual(manifest.trees.map((t) => t.lang), ['en', 'es']);
assert.ok(manifest.trees.every((t) => t.source && /^(hreflang|sitemap:\/|bfs|pages)/.test(t.source)), 'source per tree');
assert.ok(Object.values(manifest.trees[1].strings).every((x) => typeof x.lifted === 'boolean' && ('value' in x)), 'strings carry value + lifted');
assert.ok(Object.values(manifest.trees[1].strings).some((x) => x.owner === true && x.value === null), 'an owner-pending string has value null + owner true');

// negatives
assert.deepEqual(check({ ...manifest, extra: 1 }), ['trees.json.extra: not a schema key']);
{ const m = JSON.parse(JSON.stringify(manifest)); delete m.trees[1].source; assert.deepEqual(check(m), ['trees.json.trees[1]: missing required source']); }
{ const m = JSON.parse(JSON.stringify(manifest)); delete m.trees[1].strings.menu.lifted; assert.deepEqual(check(m), ['trees.json.trees[1].strings.menu: missing required lifted']); }
{ const m = JSON.parse(JSON.stringify(manifest)); m.trees[0].root = 'en'; assert.ok(check(m).some((x) => /root en fails/.test(x)), 'root must be a folder path'); }
{ const m = JSON.parse(JSON.stringify(manifest)); m.trees[0].strings.menu.translated = 'Menú'; assert.deepEqual(check(m), ['trees.json.trees[0].strings.menu.translated: not a schema key'], 'a translation is not a field — lifted or owner only'); }

// shape
assert.ok(readFileSync(join(REF, 'trees.schema.json'), 'utf8').split('\n').length <= 150, 'new reference file ≤ 150 lines');
assert.ok(defs.tree && defs.string && schema.properties.trees.items.$ref === '#/$defs/tree');
assert.match(doc, /reference\/trees\.schema\.json/, 'multilingual.md points at the schema file');
assert.match(doc, /getMetadata\('lang'\)/, 'the two-line hook snippet is in the doc');
console.log('trees-schema.test: ok (documented manifest validates; unknown key / missing source / missing lifted / bad root / translation field listed; ≤ 150 lines; doc pointer)');
