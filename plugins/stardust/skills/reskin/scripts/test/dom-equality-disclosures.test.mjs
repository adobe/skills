#!/usr/bin/env node
// skills/reskin/scripts/test/dom-equality-disclosures.test.mjs — dom-equality's disclosure rest-state check and the
// rendered-side reveal: a source accordion collapsed at rest, expanded by its capture ledger, against renders that
// start closed (hidden="until-found", closed <details>: PASS), start every panel open (FAIL, or PASS under the deltas
// waiver), or hide the panel with display:none (text FAIL). File targets only; needs playwright, prints a skip
// line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'dom-equality.mjs');
const NORMALIZE_LIB = pathToFileURL(join(HERE, '..', 'source-normalize.mjs')).href;
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

try { await import('playwright'); } catch { console.log('- skip: playwright does not resolve'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'dom-eq-disclosures-'));
const page = (main) => `<!doctype html><html><body><main>${main}</main></body></html>`;
const write = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

const source = write('source.html', page(`<h1>Wellbeing</h1>
<div class="acc"><button aria-expanded="false">Student Support Officers</button><div class="acc-body" hidden>SSOs work in schools.</div></div>
<div class="acc"><button aria-expanded="false">Counselling Service</button><div class="acc-body" hidden>Counsellors are trained.</div></div>`));
const ledger = write('ledger.mjs', `import { DEFAULT_NORMALIZE, DEFAULT_LEDGER } from '${NORMALIZE_LIB}';
export const LEDGER = [...DEFAULT_LEDGER, { id: 'N3', what: 'expand every accordion', why: 'capture the hidden panel text' }];
export const NORMALIZE = \`\${DEFAULT_NORMALIZE};(() => {
  document.querySelectorAll('.acc-body').forEach((e) => { e.hidden = false; });
  document.querySelectorAll('.acc button').forEach((e) => e.setAttribute('aria-expanded', 'true'));
})()\`;`);

const item = (title, body, { open, hide }) => `<div class="accordion-item"><div class="accordion-head"><div>${title}</div>
<button aria-expanded="${open}"></button></div><div class="accordion-panel"${hide}>${body}</div></div>`;
const render = (opts) => page(`<h1>Wellbeing</h1>${item('Student Support Officers', 'SSOs work in schools.', opts)}${item('Counselling Service', 'Counsellors are trained.', opts)}`);

const gate = (rendered, extra = []) => {
  const report = join(dir, `report-${Math.random().toString(36).slice(2)}.md`);
  const r = spawnSync(process.execPath, [GATE, '--source', source, '--rendered', rendered, '--report', report, '--normalize', ledger, ...extra], { encoding: 'utf8', env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '' } });
  let md = ''; try { md = readFileSync(report, 'utf8'); } catch { /* no report */ }
  return { status: r.status, all: `${r.stdout}\n${r.stderr}`, md };
};

check('closed at rest with hidden="until-found": the reveal reads the panels, the rest state matches, PASS', () => {
  const r = gate(write('closed.html', render({ open: false, hide: ' hidden="until-found"' })));
  assert.equal(r.status, 0, r.all);
  assert.match(r.md, /Disclosures collapsed at rest \| 2 \(0 open\) \| 4 \(0 open\) \| PASS/);
});

check('a closed <details> counts as collapsed and is read open', () => {
  const det = (t, b) => `<details><summary>${t}</summary>${b}</details>`;
  const r = gate(write('details.html', page(`<h1>Wellbeing</h1>${det('Student Support Officers', 'SSOs work in schools.')}${det('Counselling Service', 'Counsellors are trained.')}`)));
  assert.equal(r.status, 0, r.all);
});

check('every panel open at rest (a capture ledger leaked into the block): FAIL, named on stderr and in the report', () => {
  const r = gate(write('open.html', render({ open: true, hide: '' })));
  assert.equal(r.status, 1, r.all);
  assert.match(r.all, /disclosures: source 2 collapsed at rest, rendered 0 collapsed \(2 open\)/);
  assert.match(r.md, /### Disclosure rest state/);
});

check('the deltas waiver (disclosures.restState "open" with a why) passes the same render', () => {
  const deltas = write('deltas.json', JSON.stringify({ version: 1, disclosures: { restState: 'open', why: 'the redesign shows every answer' } }));
  const r = gate(join(dir, 'open.html'), ['--deltas', deltas]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.md, /waived: deltas disclosures.restState "open"/);
});

check('a waiver without a why is a usage error (exit 2)', () => {
  const deltas = write('bad-deltas.json', JSON.stringify({ version: 1, disclosures: { restState: 'open' } }));
  const r = gate(join(dir, 'open.html'), ['--deltas', deltas]);
  assert.equal(r.status, 2, r.all);
  assert.match(r.all, /disclosures\.why/);
});

check('closed with display:none (not until-found): the panel text is unread, the text check FAILs', () => {
  const r = gate(write('display-none.html', render({ open: false, hide: ' style="display:none"' })));
  assert.equal(r.status, 1, r.all);
  assert.match(r.md, /Visible text .*FAIL/);
});

rmSync(dir, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
