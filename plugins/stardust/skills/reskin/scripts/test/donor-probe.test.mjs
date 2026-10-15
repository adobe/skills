#!/usr/bin/env node
// skills/reskin/scripts/test/donor-probe.test.mjs — donor-probe options for generated specs: custom-property
// assertions, compare "firstFamily", --viewport, --no-sanity, --json, unchanged defaults.
// Browser checks skip with a printed line when playwright does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const PROBE = join(dirname(fileURLToPath(import.meta.url)), '..', 'donor-probe.mjs');
const run = (...a) => spawnSync(process.execPath, [PROBE, ...a], { encoding: 'utf8' });

await check('an unknown flag is still rejected with exit 2', () => {
  const r = run('--tokns', 'x');
  assert.equal(r.status, 2); assert.match(r.stderr, /unknown arg: --tokns/);
});

await check('--help documents the new options and exits 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  for (const f of ['--viewport', '--no-sanity', '--json']) assert.ok(r.stdout.includes(f), `usage names ${f}`);
});

await check('a value flag never takes a following --flag or a missing value: exit 2, usage names the flag, nothing written', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'donor-probe-args-'));
  try {
    const base = ['--tokens', 'tokens.json', '--rendered', 'page.html'];
    const cases = [
      [['--json', '--no-sanity'], '--json'],
      [['--json', '--report', 'r.md'], '--json'],
      [['--json'], '--json'],
      [['--viewport', '--no-sanity'], '--viewport'],
      [['--report', '--headed'], '--report'],
      [['--spec'], '--spec'],
    ];
    for (const [extra, flag] of cases) {
      const r = spawnSync(process.execPath, [PROBE, ...base, ...extra], { encoding: 'utf8', cwd });
      assert.equal(r.status, 2, extra.join(' '));
      assert.match(r.stderr, new RegExp(`${flag} needs a value`), extra.join(' '));
    }
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

let pw = null;
try { pw = await import('playwright'); } catch { /* no browser here */ }
if (!pw) console.log('- browser checks skipped: playwright does not resolve from here');
else {
  const dir = mkdtempSync(join(tmpdir(), 'donor-probe-'));
  try {
    const page = join(dir, 'page.html');
    writeFileSync(page, `<!doctype html><html><head><style>
:root { --max-width: 1200px; --pad:  8px   16px; }
body { font-family: Inter, "Inter-fallback", sans-serif; margin: 0 }
h1 { font-size: 56px } @media (max-width: 600px) { h1 { font-size: 32px } }
</style></head><body><h1>Title</h1></body></html>`);
    const tokens = join(dir, 'tokens.json'); writeFileSync(tokens, '{}');
    const spec = join(dir, 'spec.json');
    writeFileSync(spec, JSON.stringify([
      { label: 'max', selector: ':root', property: '--max-width', value: '1200px' },
      { label: 'fam', selector: 'body', property: 'fontFamily', value: 'inter', compare: 'firstFamily' },
      { label: 'h1', selector: 'h1', property: 'fontSize', value: '32px' },
    ]));
    const base = ['--tokens', tokens, '--rendered', page, '--spec', spec];

    await check('--viewport 360 --no-sanity --json: exit 0, no overflow line, three PASS results', () => {
      const out = join(dir, 'r.json'); const md = join(dir, 'r.md');
      const r = run(...base, '--viewport', '360', '--no-sanity', '--report', md, '--json', out);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!/overflow/.test(readFileSync(md, 'utf8')), 'no overflow line in the report');
      assert.ok(!/overflow/.test(r.stdout));
      const j = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(j.pass, true);
      assert.deepEqual(j.results.map((x) => [x.label, x.status]), [['max', 'PASS'], ['fam', 'PASS'], ['h1', 'PASS']]);
      assert.deepEqual(Object.keys(j.results[0]).sort(), ['check', 'detail', 'label', 'status']);
      assert.equal(j.results[0].check, 'max = 1200px');
    });

    await check('without --viewport the page loads at 1440 and the h1 fails', () => {
      const r = run(...base, '--no-sanity');
      assert.equal(r.status, 1);
      assert.match(r.stdout, /FAIL h1 = 32px — 56px/);
    });

    await check('--json is written without --report, and overflow results carry a null label', () => {
      const out = join(dir, 'r2.json');
      const r = run(...base, '--widths', '1440', '--json', out);
      assert.equal(r.status, 1);
      const j = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(j.pass, false);
      const ov = j.results.find((x) => /overflow/.test(x.check));
      assert.equal(ov.label, null); assert.equal(ov.status, 'PASS');
    });

    await check('custom properties compare whitespace-collapsed; tolerancePx applies', () => {
      const s2 = join(dir, 'spec2.json');
      writeFileSync(s2, JSON.stringify([
        { label: 'pad', selector: ':root', property: '--pad', value: '8px 16px' },
        { label: 'tol', selector: ':root', property: '--max-width', value: '1210px', tolerancePx: 20 },
        { label: 'miss', selector: ':root', property: '--max-width', value: '1100px' },
      ]));
      const r = run('--tokens', tokens, '--rendered', page, '--spec', s2, '--no-sanity');
      assert.equal(r.status, 1);
      assert.match(r.stdout, /FAIL miss = 1100px — 1200px/);
      assert.ok(!/FAIL pad/.test(r.stdout) && !/FAIL tol/.test(r.stdout), r.stdout);
    });

    await check('firstFamily compares only the first family, quote-stripped and case-folded', () => {
      const s3 = join(dir, 'spec3.json');
      writeFileSync(s3, JSON.stringify([
        { label: 'ok', selector: 'body', property: 'fontFamily', value: '"INTER", Arial', compare: 'firstFamily' },
        { label: 'bad', selector: 'body', property: 'fontFamily', value: 'sans-serif', compare: 'firstFamily' },
      ]));
      const r = run('--tokens', tokens, '--rendered', page, '--spec', s3, '--no-sanity');
      assert.equal(r.status, 1);
      assert.match(r.stdout, /FAIL bad = sans-serif/); assert.ok(!/FAIL ok/.test(r.stdout));
    });

    await check('the default spec still FAILs a selector that matches nothing', () => {
      const t2 = join(dir, 'tokens2.json');
      writeFileSync(t2, JSON.stringify({ buttons: { primary: { background: 'rgb(0, 0, 0)' } } }));
      const r = run('--tokens', t2, '--rendered', page);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /FAIL primary button bg — selector "main \.btn" matched nothing/);
    });

    await check('--viewport rejects a non-positive-integer value with exit 2', () => {
      for (const v of ['0', '-5', 'abc', '36.5', '']) {
        const r = run(...base, '--viewport', v);
        assert.equal(r.status, 2, `--viewport "${v}"`);
        assert.match(r.stderr, /--viewport needs a positive integer/);
      }
      assert.equal(run(...base, '--viewport').status, 2);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(failed ? `\n${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
