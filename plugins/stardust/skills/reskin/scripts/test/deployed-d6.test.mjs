#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-d6.test.mjs — D6: the reskin gates (dom-equality, slot-coverage,
// donor-probe) measure a preview. --wait-eds / --eds-timeout settle the decoration of the rendered page (on by
// default for an EDS host), a stalled decoration exits 2 and measures nothing, and a protected preview is never
// measured as a pass. Against the fake preview and source
// servers of fixtures/deployed/. The --help and usage checks run anywhere; the browser checks need playwright and
// print a skip line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreviewServer } from './fixtures/deployed/servers.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATES = ['dom-equality', 'slot-coverage', 'donor-probe'];
const NEW_FLAGS = ['--wait-eds', '--eds-timeout'];
const TOKEN = 'canary-123';
const scratch = mkdtempSync(join(tmpdir(), 'deployed-d6-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// A gate run: { status, stdout, stderr, all }. Async, so several gates run side by side. DEPLOY_VERIFY_ORIGIN is
// pinned empty: an inherited one would make its host an EDS host and flip the "fails without --wait-eds" case.
const run = (gate, args, { env = {}, cwd = scratch, script = join(SCRIPTS, `${gate}.mjs`) } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

await check('--help answers from a directory holding only the script: exit 0, usage names the new flags, nothing written', async () => {
  for (const gate of GATES) {
        const dir = mkdtempSync(join(scratch, `help-${gate}-`));
    copyFileSync(join(SCRIPTS, `${gate}.mjs`), join(dir, `${gate}.mjs`));
    const r = await run(gate, ['--help'], { cwd: dir, script: join(dir, `${gate}.mjs`) });
    assert.equal(r.status, 0, `${gate}: ${r.stderr}`);
    assert.match(r.stdout, /usage/i, gate);
    for (const f of NEW_FLAGS) assert.ok(r.stdout.includes(f), `${gate} usage names ${f}`);
    assert.deepEqual(readdirSync(dir), [`${gate}.mjs`], `${gate} wrote nothing`);
  }
});

const BASE = {
  'dom-equality': ['--source', 'a.html', '--rendered', 'b.html', '--report', 'r.md'],
  'slot-coverage': ['--model', 'm.json', '--rendered', 'b.html'],
  'donor-probe': ['--tokens', 't.json', '--rendered', 'b.html'],
};

await check('the new flags are validated: a value flag never takes a following --flag, --eds-timeout is a positive integer', async () => {
  for (const gate of GATES) {
    for (const [extra, re] of [
      [['--eds-timeout'], /--eds-timeout needs a value/],
      [['--eds-timeout', '--wait-eds'], /--eds-timeout needs a value/],
      [['--eds-timeout', 'soon'], /--eds-timeout needs a positive integer/],
      [['--eds-timeout', '0'], /--eds-timeout needs a positive integer/],
    ]) {
      const r = await run(gate, [...BASE[gate], ...extra]);
      assert.equal(r.status, 2, `${gate} ${extra.join(' ')}: ${r.all}`);
      assert.match(r.stderr, re, `${gate} ${extra.join(' ')}`);
    }
  }
});

let pw = null;
try { pw = await import('playwright'); } catch { /* no browser here */ }
if (!pw) console.log('- browser checks skipped: playwright does not resolve from here');
else {
  // The pages the gates read: the delivered preview page (home.html, decorating after the server's delay) and a
  // content model / donor spec / token file that match it exactly, so a pass means "measured the decorated page".
  const write = (name, body) => { const p = join(scratch, name); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); return p; };
  const gridSpec = write('grid-spec.json', [{ label: 'cards grid', selector: 'main .cards', property: 'display', value: 'grid' }]);
  const tokens = write('tokens.json', {});
  const modelFor = (origin) => ({
    sections: [
      { slot: 's01', visibleText: 'Welcome to the kit', ctas: [{ text: 'Get started', absHref: `${origin}/start` }], images: [{ currentSrc: `${origin}/ns/media_5f2c0a9d4b7e1a63.png` }] },
      { slot: 's02', visibleText: 'Everything in one place', ctas: [], images: [] },
    ],
    metadata: {
      title: 'Sample kit home',
      description: 'A calm, readable starting point for every page in the sample kit.',
      canonical: `${origin}/ns/home`,
      ogTags: { 'og:title': 'Sample kit home' },
      twitterTags: { 'twitter:card': 'summary_large_image' },
      jsonLd: [{}],
    },
  });
  await check('donor-probe on a late-decorating non-EDS origin: fails without --wait-eds (measured before decoration), passes with it, passes by default on the DEPLOY_VERIFY_ORIGIN host', async () => {
    const preview = await startPreviewServer({ decorateDelayMs: 5000 });
    try {
      const url = `${preview.origin}/ns/home`;
      const base = ['--tokens', tokens, '--rendered', url, '--spec', gridSpec, '--no-sanity'];
      const [bare, waited, byHost] = await Promise.all([
        run('donor-probe', base),
        run('donor-probe', [...base, '--wait-eds', '--eds-timeout', '10000']),
        run('donor-probe', [...base, '--eds-timeout', '10000'], { env: { DEPLOY_VERIFY_ORIGIN: preview.origin } }),
      ]);
      assert.equal(bare.status, 1, bare.all);
      assert.match(bare.stdout, /FAIL cards grid.*block/, 'measured the undecorated block');
      assert.equal(waited.status, 0, waited.all);
      assert.equal(byHost.status, 0, byHost.all);
    } finally { await preview.close(); }
  });

  await check('a protected preview (401 without a header) is never measured as a pass', async () => {
    const preview = await startPreviewServer({ token: TOKEN });
    try {
      const url = `${preview.origin}/ns/home`;
      const model = write('anon-model.json', modelFor(preview.origin));
      const anon = await run('slot-coverage', ['--model', model, '--rendered', url]);
      assert.notEqual(anon.status, 0, anon.all);
    } finally { await preview.close(); }
  });

  await check('a stalled decoration exits 2 naming what stalled, and no gate writes a report or measures anything', async () => {
    const preview = await startPreviewServer({ stallBlock: 'cards' });
    const source = await startPreviewServer();
    try {
      const url = `${preview.origin}/ns/home`;
      const model = write('stall-model.json', modelFor(preview.origin));
      const out = { de: join(scratch, 'stall-de.md'), sc: join(scratch, 'stall-sc.md'), dp: join(scratch, 'stall-dp.md'), dpj: join(scratch, 'stall-dp.json') };
      const stall = ['--wait-eds', '--eds-timeout', '1500'];
      const [de, sc, dp] = await Promise.all([
        run('dom-equality', ['--source', `${source.origin}/ns/home`, '--rendered', url, '--report', out.de, ...stall]),
        run('slot-coverage', ['--model', model, '--rendered', url, '--report', out.sc, ...stall]),
        run('donor-probe', ['--tokens', tokens, '--rendered', url, '--spec', gridSpec, '--report', out.dp, '--json', out.dpj, ...stall]),
      ]);
      for (const [gate, r] of [['dom-equality', de], ['slot-coverage', sc], ['donor-probe', dp]]) {
        assert.equal(r.status, 2, `${gate}: ${r.all}`);
        assert.match(r.all, /stalled decoration: block cards/, gate);
        assert.ok(!/PASS|FAIL/.test(r.all), `${gate} measured nothing: ${r.all}`);
      }
      for (const f of Object.values(out)) assert.ok(!existsSync(f), `${f} not written`);
    } finally { await preview.close(); await source.close(); }
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
