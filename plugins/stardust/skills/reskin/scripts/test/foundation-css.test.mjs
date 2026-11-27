#!/usr/bin/env node
// skills/reskin/scripts/test/foundation-css.test.mjs — the base rules written from the donor token sheet into
// styles/styles.css: what deployed-gate tokens asserts, replaced in place on a re-run, --check. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { edsSpec } from '../deployed/eds-spec.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'foundation-css.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'foundation-css-'));
const run = (cwd, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: 'utf8' });
const TOKENS = {
  palette: { pageBg: '#ffffff', bodyFg: '#1a1a1a', headingFg: 'rgb(0, 47, 108)' },
  type: { family: '"Montserrat", sans-serif', body: { fontSize: '16px' }, display: { fontWeight: '700' } },
  buttons: { primary: { background: '#002f6c', color: '#fff', borderRadius: '24px', padding: '14px', fontSize: '16px' } },
};
const project = (name, tokens = TOKENS) => {
  const root = join(scratch, name);
  mkdirSync(join(root, 'stardust', 'reskin'), { recursive: true });
  mkdirSync(join(root, 'styles'), { recursive: true });
  writeFileSync(join(root, 'stardust', 'reskin', 'donor-tokens.json'), JSON.stringify(tokens));
  writeFileSync(join(root, 'styles', 'styles.css'), ':root { --x: 1; }\n\nbody { color: black; }\nh2 { color: white; }\n');
  return root;
};

await check('every value the tokens gate asserts gets a rule on its own selector; the boilerplate is kept; a re-run replaces the block in place', () => {
  const root = project('write');
  const css = join(root, 'styles', 'styles.css');
  let r = run(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^written: /);
  const out = readFileSync(css, 'utf8');
  assert.ok(out.startsWith(':root { --x: 1; }\n\nbody { color: black; }\nh2 { color: white; }\n'), 'the boilerplate stays first');
  for (const row of edsSpec({ tokens: TOKENS, runtimeContract: { buttonClasses: '.button.primary' } })) {
    if (row.selector === ':root') { assert.ok(out.includes(`  ${row.property}: ${row.value};`), row.label); continue; }
    const prop = row.property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    assert.match(out, new RegExp(`${row.selector.replace(/[.]/g, '\\.')} \\{[^}]*\\n  ${prop}: ${row.value.replace(/[()]/g, '\\$&')};`), row.label);
  }
  r = run(root, '--check');
  assert.equal(r.status, 0, r.stdout);
  writeFileSync(join(root, 'stardust', 'reskin', 'donor-tokens.json'), JSON.stringify({ ...TOKENS, palette: { ...TOKENS.palette, headingFg: '#000' } }));
  r = run(root, '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^differs: /);
  r = run(root);
  const again = readFileSync(css, 'utf8');
  assert.equal(again.split('stardust:foundation-css start').length, 2, 'one block, replaced');
  assert.match(again, /main h2 \{\n {2}color: #000;\n\}/);
  assert.match(run(root).stdout, /^current: .*styles\/styles\.css\n$/);
});

await check('no sheet or no stylesheet is exit 2; a value with a CSS-breaking character is exit 2 and writes nothing', () => {
  const root = project('bad', { palette: { pageBg: 'red; } body { x: 1' } });
  const before = readFileSync(join(root, 'styles', 'styles.css'), 'utf8');
  assert.equal(run(root).status, 2);
  assert.equal(readFileSync(join(root, 'styles', 'styles.css'), 'utf8'), before);
  rmSync(join(root, 'styles', 'styles.css'));
  assert.match(run(root).stderr, /missing .*styles\.css/);
  assert.equal(run(scratch, '--dir', 'nope').status, 2);
});

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`${failed} failed`); process.exit(1); }
