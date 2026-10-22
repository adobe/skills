#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-parity.test.mjs — A3 of the deployed leg, `deployed-gate parity`: the
// preview held to the local reskin page with replica's instruments. The checks that need no browser come first
// (tool lookup in both layouts, the CLI's setup errors), then runParity against stand-ins for
// the five instruments (what each is called with, the verdict rows, the exit mapping; the header and footer
// heights are measured in a real browser), then the CLI in the project-copy layout with stand-in instruments, then
// the real instruments on the fake preview of fixtures/deployed/ (several Chromium captures: slow). The browser
// parts need playwright and print a skip line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';
import { main } from '../deployed-gate.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { parityLines, previewExclusion, replicaTools, runParity } from '../deployed/parity.mjs';
import { startPreviewServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const SERVERS = pathToFileURL(join(HERE, 'fixtures', 'deployed', 'servers.mjs')).href;
const RESKIN_FIXTURE = join(HERE, 'fixtures', 'figma-gate', 'page.html');
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-parity-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

// A project root with the record of the preview step (unless `preview` is false), pointed at `origin`.
const project = (name, { origin = 'http://127.0.0.1:9', preview = true, record = {} } = {}) => {
  const root = join(scratch, name);
  mkdirSync(join(root, 'stardust'), { recursive: true });
  if (preview) {
    const out = deployedDir(join(root, 'stardust'), 'home');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'preview.json'), `${JSON.stringify({
      url: `${origin}/ns/home`, origin, path: '/ns/home', plain: `${origin}/ns/home.plain.html`, namespace: 'ns', sandbox: false, checkedAt: new Date().toISOString(), ...record,
    }, null, 2)}\n`);
  }
  return root;
};
const outOf = (root) => deployedDir(join(root, 'stardust'), 'home');
const previewOf = (root) => readJson(join(outOf(root), 'preview.json'));
const parity = (root, extra = [], opts = {}) => run(['parity', '--page', 'home', ...extra], { cwd: root, ...opts });

// A small page: 64px header, 600px main, 40px footer, each left out on request; `css` adds rules, `body` markup before main.
let pageCount = 0;
const smallPage = ({ header = true, footer = true, css = '', body = '' } = {}) => {
  pageCount += 1;
  const file = join(scratch, `page-${pageCount}.html`);
  writeFileSync(file, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>parity</title>
<style>body{margin:0;font:16px/24px sans-serif}header{height:64px}main{height:600px}footer{height:40px}${css}</style></head>
<body>${body}${header ? '<header>Head</header>' : ''}<main><h1>Body</h1></main>${footer ? '<footer>Foot</footer>' : ''}</body></html>
`);
  return file;
};

// ---- stand-ins for the five replica instruments ----------------------------------------------------------------

const NAMES = { stitch: 'stitch-shot.mjs', pixel: 'pixel-compare.mjs', crop: 'crop-compare.mjs', chrome: 'chrome-parity.mjs', cap: 'cap-probe.mjs' };
const CAP_PASS = { compare: { rows: [{ ok: true, label: 'wrapper cap', detail: 'live 1200px = build 1200px (±20)', advisory: false }], fails: 0, pass: true } };
const DEFAULTS = {
  stitch: { height: { reskin: 1000, preview: 1010 } },
  pixel: { stdout: { pct: 1.2, heightDelta: -10, compared: { width: 1440, height: 1000 } } },
  crop: { stdout: { diffPct: 0.4, threshold: 2, pass: true } },
  chrome: { stdout: { regions: [{ name: 'header', findings: [] }, { name: 'footer', findings: [] }] } },
  cap: { stdout: CAP_PASS },
};

// Each stand-in logs { tool, key, argv, token } to calls.jsonl, writes what the real one leaves (the stitched PNG,
// the design file) and prints and exits as `c` says. `exit` is a number or an object by key: the side of a stitch
// (reskin | preview), the band of a crop (header | footer), the mode of cap-probe (capture | compare); `stdoutBy`
// likewise.
const stubSource = (tool, c, calls) => `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { solidPng } from ${JSON.stringify(SERVERS)};
const C = ${JSON.stringify(c)};
const argv = process.argv.slice(2);
const flag = (f) => argv[argv.indexOf(f) + 1];
const key = ${{
  stitch: "basename(argv[1]).startsWith('preview') ? 'preview' : 'reskin'",
  crop: "basename(flag('--out')).startsWith('footer') ? 'footer' : 'header'",
  cap: "argv.includes('--write-design') ? 'capture' : 'compare'",
  pixel: "'all'",
  chrome: "'all'",
}[tool]};
const probes = {};
for (const p of C.probe ?? []) {
  try { const r = await fetch(new URL(p, argv[0])); probes[p] = [r.status, await r.text()]; } catch (e) { probes[p] = [String(e)]; }
}
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, key, argv, probes }) + '\\n');
const exit = (typeof C.exit === 'object' ? C.exit[key] : C.exit) ?? 0;
if (${JSON.stringify(tool)} === 'stitch' && exit === 0) {
  mkdirSync(dirname(argv[1]), { recursive: true });
  writeFileSync(argv[1], solidPng(Number(flag('--width')), C.height[key], [255, 255, 255]));
}
if (${JSON.stringify(tool)} === 'cap' && key === 'capture' && exit === 0) writeFileSync(flag('--write-design'), '{}\\n');
const stdout = C.stdoutBy ? C.stdoutBy[key] : C.stdout;
if (stdout !== undefined && [0, 2].includes(exit) && !(${JSON.stringify(tool)} === 'cap' && key === 'capture')) process.stdout.write(typeof stdout === 'string' ? stdout : JSON.stringify(stdout));
process.stderr.write(C.stderr ?? '');
process.exit(exit);
`;

// The five stand-ins in `at`, under the instruments' file names; `cfg[tool]` overrides DEFAULTS[tool].
const stubTools = (name, cfg = {}, at = join(scratch, name)) => {
  mkdirSync(at, { recursive: true });
  const calls = join(at, 'calls.jsonl');
  const tools = {};
  for (const [tool, file] of Object.entries(NAMES)) {
    tools[tool] = join(at, file);
    writeFileSync(tools[tool], stubSource(tool, { ...DEFAULTS[tool], ...cfg[tool] }, calls));
  }
  return { tools, calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) };
};

const flagOf = (argv, f) => argv[argv.indexOf(f) + 1];
const brief = (rows) => rows.map(({ check, width, value, bar, status }) => ({ check, width, value, bar, status }));
const pick = (rows, check, width) => rows.find((r) => r.check === check && r.width === width);

// The token a fake protected preview demands: a request without it is a 401.
const TOKEN = 'hlxtok-0123456789abcdef';

// ---- no browser ------------------------------------------------------------------------------------------------

await check('replicaTools finds the five instruments in the plugin tree and in the project copy, and names what is missing', () => {
  const real = replicaTools();
  assert.deepEqual(Object.keys(real).sort(), ['cap', 'chrome', 'crop', 'pixel', 'stitch']);
  for (const [tool, file] of Object.entries(NAMES)) {
    assert.equal(real[tool], join(SCRIPTS, '..', '..', 'replica', 'scripts', file));
    assert.ok(existsSync(real[tool]), `${file} exists in the plugin tree`);
  }
  const copy = join(scratch, 'layout');
  mkdirSync(join(copy, 'reskin', 'deployed'), { recursive: true });
  stubTools('layout-stubs', {}, join(copy, 'replica'));
  const found = replicaTools(join(copy, 'reskin', 'deployed'));
  for (const [tool, file] of Object.entries(NAMES)) assert.equal(found[tool], join(copy, 'replica', file));
  const bare = join(scratch, 'layout-bare');
  mkdirSync(join(bare, 'reskin', 'deployed'), { recursive: true });
  mkdirSync(join(bare, 'replica'));
  writeFileSync(join(bare, 'replica', 'stitch-shot.mjs'), '');
  assert.throws(() => replicaTools(join(bare, 'reskin', 'deployed')), (e) => e instanceof UsageError && e.code === 2
    && /pixel-compare\.mjs, crop-compare\.mjs, chrome-parity\.mjs, cap-probe\.mjs/.test(e.message) && !/stitch-shot/.test(e.message) && /stardust\/scripts\/replica/.test(e.message), 'the missing files are named');
});

await check('previewExclusion: the parts of the preview left out of pixel and height are those the reskin page does not render and the preview does, with the --hide selectors and the row detail', () => {
  const sides = (reskin, preview) => ({ reskin: { header: reskin[0], footer: reskin[1] }, preview: { header: preview[0], footer: preview[1] } });
  assert.deepEqual(previewExclusion(sides([0, 0], [64, 40])), {
    parts: ['header', 'footer'], hide: 'header:not(main header),footer:not(main footer)', detail: 'preview header/footer excluded: reskin page renders none',
  });
  assert.deepEqual(previewExclusion(sides([0, 40], [64, 40])), { parts: ['header'], hide: 'header:not(main header)', detail: 'preview header excluded: reskin page renders none' });
  assert.deepEqual(previewExclusion(sides([64, 0], [64, 40])), { parts: ['footer'], hide: 'footer:not(main footer)', detail: 'preview footer excluded: reskin page renders none' });
  const nothing = { parts: [], hide: null, detail: null };
  assert.deepEqual(previewExclusion(sides([64, 40], [80, 48])), nothing, 'a part the reskin page renders stays in both captures');
  assert.deepEqual(previewExclusion(sides([0, 0], [0, 0])), nothing, 'nothing to leave out where the preview has none either');
  assert.deepEqual(previewExclusion(sides([0, 40], [64, 0])), { parts: ['header'], hide: 'header:not(main header)', detail: 'preview header excluded: reskin page renders none' });
});

await check('--help documents parity; its usage errors exit 2 and write nothing; the record is needed (absent, problems), a skipped leg is "not run: skipped", the reskin page must exist', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  const r = await run(['--help'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /deployed-gate\.mjs parity --page <slug> \[--reskin <file>\] \[--dir stardust\]/);
  for (const re of [/stitch-shot/, /pixel-compare/, /crop-compare/, /chrome-parity/, /cap-probe/, /10%/, /5%/, /2%/, /±20px/, /protected preview/, /not run: skipped/, /stitch-shot --hide\)/]) assert.match(r.stdout, re);
  const help = r.stdout.replace(/\s+/g, ' ');
  assert.ok(help.includes('A preview that answers HTTP 401 or 403 to this step\'s browser is exit 2 (a protected preview is out of scope)'), 'the help says a protected preview is out of scope');
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');

  const root = project('parity-usage', { preview: false });
  for (const [args, re] of [
    [['parity'], /parity needs --page <slug>/],
    [['parity', '--page', '../x'], /--page must be a slug/],
    [['parity', '--page', 'home', '--org', 'o'], /unknown flag --org for parity/],
    [['parity', '--page', 'home', '--reskin=p.html'], /unknown flag --reskin for parity: a flag and its value are separate arguments/],
    [['parity', '--page', 'home', 'stray'], /unexpected argument "stray"/],
    [['parity', '--page'], /--page needs a value/],
    [['parity', '--page', 'home', '--reskin', '--dir', 'x'], /--reskin needs a value/],
  ]) {
    const got = await run(args, { cwd: root });
    assert.equal(got.status, 2, `${args.join(' ')}: ${got.all}`);
    assert.match(got.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');

  const none = await parity(root);
  assert.equal(none.status, 2, none.all);
  assert.match(none.stderr, /deployed-gate preview/);
  const problems = project('parity-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  const refused = await parity(problems);
  assert.equal(refused.status, 2, refused.all);
  assert.match(refused.stderr, /preview has problems: run deployed-gate preview again/);
  const skipped = project('parity-skipped', { record: { skipped: true, reason: 'not an aem-boilerplate project: missing head.html at the project root', url: null, origin: null, plain: null } });
  const idle = await parity(skipped);
  assert.equal(idle.status, 0, idle.all);
  assert.equal(idle.stdout.trim(), 'not run: skipped');
  assert.ok(!existsSync(join(outOf(skipped), 'parity.json')), 'nothing written');
  const noPage = project('parity-no-page');
  const missing = await parity(noPage);
  assert.equal(missing.status, 2, missing.all);
  assert.match(missing.stderr, /missing .*reskin[\\/]pages[\\/]home\.html.*--reskin/);
  const named = await parity(noPage, ['--reskin', join(scratch, 'no-such-page.html')]);
  assert.equal(named.status, 2, named.all);
  assert.match(named.stderr, /no-such-page\.html/);
  assert.ok(!existsSync(join(outOf(noPage), 'parity.json')));
});

await check('main dispatches parity to a replaceable step and returns its exit code; --help runs before it', async () => {
  const lines = [];
  const code = await main(['parity', '--page', 'home'], { log: (m) => lines.push(m), steps: { parity: async ({ opts, log }) => { log(`stub ${opts.page}`); return 5; } } });
  assert.equal(code, 5);
  assert.deepEqual(lines, ['stub home']);
  assert.equal(await main(['parity', '--help'], { log: () => {}, steps: { parity: async () => { throw new Error('must not run'); } } }), 0);
});

// ---- runParity against stand-in instruments --------------------------------------------------------------------

let playwrightOk = false;
try { await import('playwright'); await import('pngjs'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright or pngjs not importable here; run this test in an environment that has them)'); }

// One runParity against a fake preview serving `previewPage` (token: it demands one, a protected preview; record:
// preview.json's extra fields); the heights of the page's header and footer are measured by the real browser.
// → { result | error, stub, root, previewUrl, requests }: no throw.
const scenario = async (name, cfg = {}, { reskin = smallPage(), previewPage = reskin, widths = [1440], token = null, record = {}, env = process.env } = {}) => {
  const server = await startPreviewServer({ token, pages: { '/ns/home': previewPage } });
  try {
    const root = project(name, { origin: server.origin, record });
    const stub = stubTools(name, cfg);
    const got = await attempt(() => runParity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: reskin, widths, tools: stub.tools, env }));
    return { result: got.value, error: got.error, stub, root, previewUrl: `${server.origin}/ns/home`, requests: server.requests };
  } finally { await server.close(); }
};

if (playwrightOk) {
  await check('runParity calls each instrument as shipped, at both widths for the captures and at 1440 for chrome-parity and cap-probe, and the preview and the served reskin page are what they are given', async () => {
    const reskin = smallPage();
    const previewPage = smallPage({ css: 'header{height:80px}footer{height:48px}' });
    const { result, stub, root, previewUrl, error } = await scenario('calls', {}, { reskin, previewPage, widths: [1440, 360] });
    assert.ifError(error);
    const calls = stub.calls();
    assert.deepEqual(calls.map((c) => `${c.tool}:${c.key}`), [
      'stitch:reskin', 'stitch:preview', 'pixel:all', 'crop:header', 'crop:footer', 'chrome:all', 'cap:capture', 'cap:compare',
      'stitch:reskin', 'stitch:preview', 'pixel:all', 'crop:header', 'crop:footer',
    ], 'per width: the captures, the comparisons; at 1440 then chrome-parity and cap-probe; the order of the widths as given');
    const out = join(outOf(root), 'parity');
    const at = (i) => calls[i].argv;
    const reskinUrl = at(0)[0];
    assert.match(reskinUrl, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/${reskin.split('/').pop()}$`), 'the reskin page is served over http, never file://');
    assert.notEqual(new URL(reskinUrl).origin, new URL(previewUrl).origin);
    assert.deepEqual(at(0), [reskinUrl, join(out, 'reskin-1440.png'), '--width', '1440', '--settle']);
    assert.deepEqual(at(1), [previewUrl, join(out, 'preview-1440.png'), '--width', '1440', '--settle', '--wait', '3000']);
    assert.deepEqual(at(2), [join(out, 'reskin-1440.png'), join(out, 'preview-1440.png'), '--out', join(out, 'diff-1440.png'), '--threshold', '10', '--json', '--timeout', '120']);
    // The band of the reference page's chrome: the header from the top of both captures, the footer up from the bottom of each.
    assert.deepEqual(at(3), [join(out, 'reskin-1440.png'), join(out, 'preview-1440.png'), '--y', '0', '--y-b', '0', '--height', '64', '--out', join(out, 'header-diff-1440.png'), '--threshold', '2', '--json']);
    assert.deepEqual(at(4), [join(out, 'reskin-1440.png'), join(out, 'preview-1440.png'), '--y', '960', '--y-b', '970', '--height', '40', '--out', join(out, 'footer-diff-1440.png'), '--threshold', '2', '--json']);
    assert.deepEqual(at(5), [reskinUrl, previewUrl, '--width', '1440', '--no-defaults', '--region', 'header=header', '--region', 'footer=footer', '--json']);
    assert.deepEqual(at(6), [reskinUrl, '--write-design', join(outOf(root), 'design.json')], 'capture mode: the URL, no subcommand word');
    assert.deepEqual(at(7), [reskinUrl, '--against', previewUrl, '--design', join(outOf(root), 'design.json'), '--tolerance', '20', '--json', '--out', join(out, 'cap-probe-1440.json')]);
    assert.equal(flagOf(at(8), '--width'), '360');
    assert.equal(flagOf(at(10), '--out'), join(out, 'diff-360.png'));
    assert.ok(!calls.some((c) => c.argv.some((a) => /^file:/.test(a))));

    assert.equal(result.verdict, 'PASS');
    assert.equal(result.exit, 0);
    assert.deepEqual(brief(result.rows), [
      { check: 'pixel', width: 1440, value: '1.20%', bar: '≤ 10%', status: 'PASS' },
      { check: 'height', width: 1440, value: 'Δh +10px (1.0% of 1000px)', bar: '≤ 5%', status: 'PASS' },
      { check: 'header crop', width: 1440, value: '0.40%', bar: '≤ 2%', status: 'PASS' },
      { check: 'footer crop', width: 1440, value: '0.40%', bar: '≤ 2%', status: 'PASS' },
      { check: 'chrome-parity', width: 1440, value: 'no deltas', bar: 'advisory', status: 'PASS' },
      { check: 'cap-probe', width: 1440, value: '0 of 1 rows differ', bar: '±20px', status: 'PASS' },
      { check: 'pixel', width: 360, value: '1.20%', bar: '≤ 10%', status: 'PASS' },
      { check: 'height', width: 360, value: 'Δh +10px (1.0% of 1000px)', bar: '≤ 5%', status: 'PASS' },
      { check: 'header crop', width: 360, value: '0.40%', bar: '≤ 2%', status: 'PASS' },
      { check: 'footer crop', width: 360, value: '0.40%', bar: '≤ 2%', status: 'PASS' },
    ]);
    assert.equal(pick(result.rows, 'pixel', 1440).artifact, join(out, 'diff-1440.png'));
    assert.equal(pick(result.rows, 'header crop', 360).artifact, join(out, 'header-diff-360.png'));
    assert.equal(pick(result.rows, 'footer crop', 1440).artifact, join(out, 'footer-diff-1440.png'));
    assert.equal(pick(result.rows, 'chrome-parity', 1440).artifact, join(out, 'chrome-parity-1440.json'));
    assert.equal(pick(result.rows, 'cap-probe', 1440).artifact, join(out, 'cap-probe-1440.json'));
    assert.deepEqual(Object.keys(result.rows[0]).sort(), ['artifact', 'bar', 'check', 'detail', 'status', 'value', 'width']);
    assert.deepEqual(readJson(join(outOf(root), 'parity.json')), { verdict: 'PASS', rows: result.rows });
    assert.deepEqual(parityLines(result), ['PASS parity']);
    await assert.rejects(fetch(reskinUrl), 'the static server of the reskin page is stopped');
  });

  await check('a protected preview (401 to the step\'s browser) is a setup error (exit 2), not rows of a 401 page: nothing is captured or recorded', async () => {
    const guarded = await scenario('protected', {}, { token: TOKEN });
    assert.ok(guarded.error instanceof UsageError && guarded.error.code === 2, String(guarded.error));
    assert.match(guarded.error.message, /^http:\/\/127\.0\.0\.1:\d+\/ns\/home answered HTTP 401: the preview is protected, and a protected preview is out of scope/);
    assert.deepEqual(guarded.stub.calls(), [], 'no instrument ran');
    assert.ok(!existsSync(join(outOf(guarded.root), 'parity.json')), 'no verdict');
  });

  await check('the bars: pixel and crop follow the instruments\' exit (0 under, 2 over); |Δh| at 5% of the reskin page height passes, above it fails; the Δh row names the preview as taller', async () => {
    const at5 = await scenario('bar-5', { stitch: { height: { reskin: 1000, preview: 1050 } }, pixel: { stdout: { pct: 10, heightDelta: -50, compared: { width: 1440, height: 1000 } } } });
    assert.equal(pick(at5.result.rows, 'height', 1440).status, 'PASS', 'exactly 5%');
    assert.equal(pick(at5.result.rows, 'height', 1440).value, 'Δh +50px (5.0% of 1000px)');
    const above = await scenario('bar-above', { stitch: { height: { reskin: 1000, preview: 1051 } }, pixel: { stdout: { pct: 10.01, heightDelta: -51, compared: { width: 1440, height: 1000 } }, exit: 2 }, crop: { stdout: { diffPct: 2.5, threshold: 2, pass: false }, exit: { footer: 2 } } });
    assert.equal(above.result.verdict, 'FAIL');
    assert.equal(above.result.exit, 1);
    assert.deepEqual(brief(above.result.rows).filter((r) => r.status === 'FAIL'), [
      { check: 'pixel', width: 1440, value: '10.01%', bar: '≤ 10%', status: 'FAIL' },
      { check: 'height', width: 1440, value: 'Δh +51px (5.1% of 1000px)', bar: '≤ 5%', status: 'FAIL' },
      { check: 'footer crop', width: 1440, value: '2.50%', bar: '≤ 2%', status: 'FAIL' },
    ]);
    assert.equal(pick(above.result.rows, 'header crop', 1440).status, 'PASS');
    const shorter = await scenario('bar-shorter', { stitch: { height: { reskin: 1000, preview: 940 } }, pixel: { stdout: { pct: 3, heightDelta: 60, compared: { width: 1440, height: 940 } } } });
    assert.equal(pick(shorter.result.rows, 'height', 1440).value, 'Δh -60px (6.0% of 1000px)');
    assert.equal(pick(shorter.result.rows, 'height', 1440).status, 'FAIL');
    const lines = parityLines(above.result);
    assert.equal(lines[0], 'FAIL parity');
    assert.deepEqual(lines.slice(1), [
      '  pixel @1440: 10.01% (bar ≤ 10%)',
      '  height @1440: Δh +51px (5.1% of 1000px) (bar ≤ 5%)',
      '  footer crop @1440: 2.50% (bar ≤ 2%)',
    ]);
  });

  await check('the reskin page is served from its own directory: relative assets resolve, nothing outside it or missing does (404), and a path out of the directory is never read', async () => {
    const site = join(scratch, 'site');
    mkdirSync(join(site, 'pages', 'css'), { recursive: true });
    writeFileSync(join(site, 'secret.txt'), 'outside the page directory');
    writeFileSync(join(site, 'pages', 'asset.txt'), 'asset body');
    writeFileSync(join(site, 'pages', 'css', 'site.css'), 'body{}');
    const page = join(site, 'pages', 'page.html');
    copyFileSync(smallPage(), page);
    const { stub, error } = await scenario('serve', { stitch: { probe: ['asset.txt', 'css/site.css', 'missing.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt'] } }, { reskin: page });
    assert.ifError(error);
    const { probes } = stub.calls()[0];
    assert.deepEqual(probes['asset.txt'], [200, 'asset body']);
    assert.deepEqual(probes['css/site.css'], [200, 'body{}']);
    assert.equal(probes['missing.txt'][0], 404);
    assert.equal(probes['/..%2fsecret.txt'][0], 404, 'the parent directory is not served');
    assert.equal(probes['/%2e%2e%2fsecret.txt'][0], 404);
  });

  await check('chrome-parity is advisory: deltas make an ADVISORY row and line, never a FAIL; cap-probe ✗ rows are a FAIL and each is named', async () => {
    const chrome = { regions: [{ name: 'header', findings: [{ kind: 'PAIR', text: 'Home', msg: 'fontWeight 500 → 400' }, { kind: 'MISSING', text: 'Docs', msg: 'live <a> "Docs" has no build element with the same text' }] }, { name: 'footer', findings: [] }] };
    const advisory = await scenario('chrome-delta', { chrome: { stdout: chrome, exit: 2 } });
    assert.equal(advisory.result.verdict, 'PASS');
    assert.equal(advisory.result.exit, 0);
    const row = pick(advisory.result.rows, 'chrome-parity', 1440);
    assert.equal(row.status, 'ADVISORY');
    assert.equal(row.value, '2 delta(s): header 2, footer 0');
    assert.deepEqual(row.detail.split('\n'), ['header PAIR "Home" fontWeight 500 → 400', 'header MISSING "Docs" live <a> "Docs" has no build element with the same text']);
    assert.deepEqual(parityLines(advisory.result), [
      'PASS parity',
      'ADVISORY chrome-parity @1440: 2 delta(s): header 2, footer 0',
      '  header PAIR "Home" fontWeight 500 → 400',
      '  header MISSING "Docs" live <a> "Docs" has no build element with the same text',
    ]);

    const rows = [
      { ok: false, label: 'wrapper cap', detail: 'live 1200px → build NONE: content runs 2560px wide at 2560 — fix the sizing rule, not pixels', advisory: false },
      { ok: true, label: 'sections', detail: 'live 3 vs build 4 top-level sections', advisory: true },
      { ok: false, label: 'module 1/3', detail: 'live 800px → build 1000px, Δ200px', advisory: false },
    ];
    const caps = await scenario('cap-fail', { cap: { stdout: { compare: { rows, fails: 2, pass: false } }, exit: { compare: 2 } } });
    assert.equal(caps.result.verdict, 'FAIL');
    const cap = pick(caps.result.rows, 'cap-probe', 1440);
    assert.deepEqual({ status: cap.status, value: cap.value, bar: cap.bar }, { status: 'FAIL', value: '2 of 3 rows differ', bar: '±20px' });
    assert.deepEqual(cap.detail.split('\n'), [`wrapper cap: ${rows[0].detail}`, `module 1/3: ${rows[2].detail}`]);
    assert.deepEqual(parityLines(caps.result), ['FAIL parity', '  cap-probe @1440: 2 of 3 rows differ (bar ±20px)', `    wrapper cap: ${rows[0].detail}`, `    module 1/3: ${rows[2].detail}`]);
  });

  await check('chrome: a reskin page without a header has its header crop "n/a: reskin page renders no chrome"; without any chrome, so are the footer crop and chrome-parity, and no crop is run; its footer alone is still compared', async () => {
    const none = await scenario('no-chrome', {}, { reskin: smallPage({ header: false, footer: false }), previewPage: smallPage() });
    assert.ifError(none.error);
    for (const check of ['header crop', 'footer crop', 'chrome-parity']) {
      const row = pick(none.result.rows, check, 1440);
      assert.deepEqual({ status: row.status, value: row.value }, { status: 'n/a', value: 'n/a: reskin page renders no chrome' }, check);
    }
    assert.equal(none.result.verdict, 'PASS', 'a page without chrome is not a failing page');
    assert.deepEqual(none.stub.calls().map((c) => c.tool), ['stitch', 'stitch', 'pixel', 'cap', 'cap'], 'no crop, no chrome-parity');
    assert.deepEqual(parityLines(none.result), ['PASS parity', 'n/a: reskin page renders no chrome (header crop @1440, footer crop @1440, chrome-parity @1440)']);

    const footerOnly = await scenario('footer-only', {}, { reskin: smallPage({ header: false }), previewPage: smallPage() });
    assert.equal(pick(footerOnly.result.rows, 'header crop', 1440).value, 'n/a: reskin page renders no chrome');
    assert.equal(pick(footerOnly.result.rows, 'footer crop', 1440).status, 'PASS');
    const chromeCall = footerOnly.stub.calls().find((c) => c.tool === 'chrome');
    assert.deepEqual(chromeCall.argv.slice(2), ['--width', '1440', '--no-defaults', '--region', 'footer=footer', '--json'], 'only the regions the reskin page has');
  });

  await check('pixel and height compare main to main: for each part the reskin page does not render at that width the preview side is captured with --hide on it, and both rows say what was excluded; a part it renders stays in both captures', async () => {
    const HIDE = { header: 'header:not(main header)', footer: 'footer:not(main footer)' };
    const stitchOf = (s, side, width) => s.stub.calls().find((c) => c.tool === 'stitch' && c.key === side && flagOf(c.argv, '--width') === String(width)).argv;
    const rowsOf = (s, width) => ['pixel', 'height'].map((c) => pick(s.result.rows, c, width));

    const none = await scenario('hide-none', {}, { reskin: smallPage({ header: false, footer: false }), previewPage: smallPage(), widths: [1440, 360] });
    assert.ifError(none.error);
    for (const width of [1440, 360]) {
      assert.deepEqual(stitchOf(none, 'preview', width).slice(2), ['--width', String(width), '--settle', '--wait', '3000', '--hide', `${HIDE.header},${HIDE.footer}`], `@${width}`);
      assert.ok(!stitchOf(none, 'reskin', width).includes('--hide'), 'the reskin page is captured as it is');
      assert.equal(stitchOf(none, 'preview', width)[0], none.previewUrl);
      for (const r of rowsOf(none, width)) assert.equal(r.detail, 'preview header/footer excluded: reskin page renders none', `${r.check} @${width}`);
      for (const check of ['header crop', 'footer crop']) assert.equal(pick(none.result.rows, check, width).detail, null, 'the crop rows keep their semantics');
    }
    assert.deepEqual(readJson(join(outOf(none.root), 'parity.json')).rows.filter((r) => r.detail).map((r) => `${r.check}@${r.width}`), ['pixel@1440', 'height@1440', 'pixel@360', 'height@360']);

    const footerOnly = await scenario('hide-footer-only', {}, { reskin: smallPage({ header: false }), previewPage: smallPage() });
    assert.deepEqual(stitchOf(footerOnly, 'preview', 1440).slice(7), ['--hide', HIDE.header]);
    assert.ok(!stitchOf(footerOnly, 'reskin', 1440).includes('--hide'));
    for (const r of rowsOf(footerOnly, 1440)) assert.equal(r.detail, 'preview header excluded: reskin page renders none');
    assert.equal(pick(footerOnly.result.rows, 'footer crop', 1440).status, 'PASS', 'its footer is still held to the preview\'s');

    const headerOnly = await scenario('hide-header-only', {}, { reskin: smallPage({ footer: false }), previewPage: smallPage() });
    assert.deepEqual(stitchOf(headerOnly, 'preview', 1440).slice(7), ['--hide', HIDE.footer]);
    for (const r of rowsOf(headerOnly, 1440)) assert.equal(r.detail, 'preview footer excluded: reskin page renders none');

    const both = await scenario('hide-both-rendered', {}, { reskin: smallPage(), previewPage: smallPage() });
    assert.deepEqual(stitchOf(both, 'preview', 1440).slice(2), ['--width', '1440', '--settle', '--wait', '3000'], 'chrome on both sides: captured as before');
    for (const r of rowsOf(both, 1440)) assert.equal(r.detail, null);

    const bare = await scenario('hide-neither', {}, { reskin: smallPage({ header: false, footer: false }), previewPage: smallPage({ header: false, footer: false }) });
    assert.ok(!stitchOf(bare, 'preview', 1440).includes('--hide'), 'nothing to exclude where the preview renders none either');
    for (const r of rowsOf(bare, 1440)) assert.equal(r.detail, null);

    const failing = await scenario('hide-fail', { pixel: { stdout: { pct: 11, heightDelta: 0, compared: { width: 1440, height: 1000 } }, exit: 2 } }, { reskin: smallPage({ header: false, footer: false }), previewPage: smallPage() });
    assert.deepEqual(parityLines(failing.result).slice(0, 3), ['FAIL parity', '  pixel @1440: 11.00% (bar ≤ 10%)', '    preview header/footer excluded: reskin page renders none']);
  });

  await check('chrome: a preview that renders no <header> or <footer> where the reskin page does is a FAIL row naming it, and its crop is not run', async () => {
    const bare = await scenario('preview-bare', {}, { reskin: smallPage(), previewPage: smallPage({ header: false, footer: false }) });
    assert.equal(bare.result.verdict, 'FAIL');
    assert.deepEqual(brief(bare.result.rows).filter((r) => r.status === 'FAIL'), [
      { check: 'header crop', width: 1440, value: 'preview renders no <header>', bar: '≤ 2%', status: 'FAIL' },
      { check: 'footer crop', width: 1440, value: 'preview renders no <footer>', bar: '≤ 2%', status: 'FAIL' },
    ]);
    assert.ok(!bare.stub.calls().some((c) => c.tool === 'crop'), 'nothing to compare');
    assert.deepEqual(parityLines(bare.result).slice(0, 3), ['FAIL parity', '  header crop @1440: preview renders no <header> (bar ≤ 2%)', '  footer crop @1440: preview renders no <footer> (bar ≤ 2%)']);
  });

  await check('exit mapping: a bot challenge (3) is a thrown error with code 3 and writes no verdict; 124, 1 or any other exit is that row "ERROR (exit N)" and the step\'s exit 124; the rows that were measured stay', async () => {
    const challenge = await scenario('exit-3', { stitch: { exit: { preview: 3 }, stderr: 'stitch-shot error: bot challenge\n' } });
    assert.equal(challenge.error?.code, 3, String(challenge.error));
    assert.match(challenge.error.message, /stitch-shot/);
    assert.match(challenge.error.message, /bot challenge/);
    assert.ok(!existsSync(join(outOf(challenge.root), 'parity.json')), 'no verdict');
    const capChallenge = await scenario('exit-3-cap', { cap: { exit: { compare: 3 } } });
    assert.equal(capChallenge.error?.code, 3);

    const deadline = await scenario('exit-124', { pixel: { exit: 124, stderr: 'pixel-compare: no verdict — deadline 120s exceeded (exit 124).\n' } });
    assert.ifError(deadline.error);
    assert.equal(deadline.result.verdict, 'ERROR');
    assert.equal(deadline.result.exit, 124);
    assert.deepEqual(brief(deadline.result.rows).filter((r) => r.status === 'ERROR'), [
      { check: 'pixel', width: 1440, value: 'ERROR (exit 124)', bar: '≤ 10%', status: 'ERROR' },
      { check: 'height', width: 1440, value: 'ERROR (exit 124)', bar: '≤ 5%', status: 'ERROR' },
    ]);
    assert.equal(pick(deadline.result.rows, 'pixel', 1440).detail, 'pixel-compare: no verdict — deadline 120s exceeded (exit 124).');
    assert.equal(pick(deadline.result.rows, 'header crop', 1440).status, 'PASS', 'the rest was measured');
    assert.deepEqual(readJson(join(outOf(deadline.root), 'parity.json')), { verdict: 'ERROR', rows: deadline.result.rows });
    const text = parityLines(deadline.result);
    assert.equal(text[0], 'ERROR (exit 124) parity: 2 checks gave no verdict');
    assert.deepEqual(text.slice(1, 5), ['  pixel @1440: ERROR (exit 124)', '    pixel-compare: no verdict — deadline 120s exceeded (exit 124).', '  height @1440: ERROR (exit 124)', '    pixel-compare: no verdict — deadline 120s exceeded (exit 124).']);

    const crop = await scenario('exit-crop-1', { crop: { exit: { footer: 1 }, stderr: 'crop-compare error: band y 970+40 exceeds height\n' } });
    assert.equal(crop.result.exit, 124);
    assert.equal(pick(crop.result.rows, 'footer crop', 1440).value, 'ERROR (exit 1)');
    assert.equal(pick(crop.result.rows, 'header crop', 1440).status, 'PASS');
    const capture = await scenario('exit-cap-1', { cap: { exit: { capture: 1 }, stderr: 'cap-probe: x failed to load\n' } });
    assert.equal(capture.result.exit, 124);
    assert.equal(pick(capture.result.rows, 'cap-probe', 1440).value, 'ERROR (exit 1)');
    assert.deepEqual(capture.stub.calls().filter((c) => c.tool === 'cap').map((c) => c.key), ['capture'], 'no compare without the design');
    const chromeErr = await scenario('exit-chrome-1', { chrome: { exit: 1 } });
    assert.equal(pick(chromeErr.result.rows, 'chrome-parity', 1440).value, 'ERROR (exit 1)');
    assert.equal(chromeErr.result.exit, 124);
    const capUsage = await scenario('exit-cap-125', { cap: { exit: { compare: 125 } } });
    assert.equal(pick(capUsage.result.rows, 'cap-probe', 1440).value, 'ERROR (exit 125)');

    const stitchFail = await scenario('exit-stitch-1', { stitch: { exit: { reskin: 1 }, stderr: 'stitch-shot error: scroll stall\n' } });
    assert.equal(stitchFail.result.exit, 124);
    assert.deepEqual(brief(stitchFail.result.rows).filter((r) => r.status === 'ERROR').map((r) => r.check), ['pixel', 'height', 'header crop', 'footer crop']);
    assert.equal(pick(stitchFail.result.rows, 'pixel', 1440).detail, 'stitch-shot error: scroll stall');

    const noJson = await scenario('exit-no-json', { pixel: { stdout: 'not json' } });
    assert.equal(pick(noJson.result.rows, 'pixel', 1440).value, 'ERROR (exit 0)', 'an exit that gave no number is no verdict');
    const lying = await scenario('exit-lying', { pixel: { stdout: { pct: 2, heightDelta: 0, compared: { width: 1440, height: 1000 } }, exit: 2 } });
    assert.equal(pick(lying.result.rows, 'pixel', 1440).status, 'FAIL', 'the instrument\'s exit is its verdict');
  });

  await check('runParity clears the evidence of the last run first, and a missing tool is a setup error before anything is captured', async () => {
    const root = project('stale', { origin: 'http://127.0.0.1:9' });
    const out = outOf(root);
    mkdirSync(join(out, 'parity'), { recursive: true });
    writeFileSync(join(out, 'parity', 'old-1440.png'), 'old');
    writeFileSync(join(out, 'parity.json'), '{"verdict":"PASS","rows":[]}\n');
    writeFileSync(join(out, 'design.json'), '{"old":true}\n');
    const stub = stubTools('stale-stubs');
    rmSync(stub.tools.crop);
    const gone = await attempt(() => runParity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: smallPage(), widths: [1440], tools: stub.tools }));
    assert.ok(gone.error instanceof UsageError && /crop-compare\.mjs/.test(gone.error.message), String(gone.error));
    assert.deepEqual(stub.calls(), [], 'nothing was captured');
    assert.ok(!existsSync(join(out, 'parity.json')) && !existsSync(join(out, 'parity')) && !existsSync(join(out, 'design.json')), 'no stale record, artifact or design');
    const noUrl = await attempt(() => runParity({ dir: join(root, 'stardust'), slug: 'home', preview: {}, reskinPage: smallPage(), tools: stub.tools }));
    assert.ok(noUrl.error instanceof UsageError && /has no url/.test(noUrl.error.message), String(noUrl.error));
    const noPage = await attempt(() => runParity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: join(scratch, 'no-such-page.html'), tools: stub.tools }));
    assert.ok(noPage.error instanceof UsageError && /no-such-page\.html/.test(noPage.error.message), String(noPage.error));
  });

  await check('the project-copy layout: the CLI finds the instruments beside the reskin scripts; 3 is exit 3, a row in error is exit 124, a failing row is exit 1, a missing instrument is exit 2', async () => {
    const copy = join(scratch, 'copy');
    cpSync(SCRIPTS, join(copy, 'reskin'), { recursive: true, filter: (src) => src !== join(SCRIPTS, 'test') });
    cpSync(join(SCRIPTS, '..', '..', 'diff', 'scripts'), join(copy, 'diff'), { recursive: true });
    symlinkSync(join(dirname(fileURLToPath(import.meta.resolve('playwright'))), '..'), join(copy, 'node_modules'));
    const gate = join(copy, 'reskin', 'deployed-gate.mjs');
    const server = await startPreviewServer({ pages: { '/ns/home': smallPage() } });
    try {
      const root = project('copy-proj', { origin: server.origin });
      const page = smallPage();
      const go = async (name, cfg) => {
        stubTools(name, cfg, join(copy, 'replica'));
        return run(['parity', '--page', 'home', '--reskin', page], { cwd: root, script: gate });
      };
      const challenge = await go('copy-3', { stitch: { exit: { preview: 3 }, stderr: 'stitch-shot error: challenge\n' } });
      assert.equal(challenge.status, 3, challenge.all);
      assert.match(challenge.stderr, /^deployed-gate: stitch-shot.*challenge/);
      const lost = await go('copy-124', { pixel: { exit: 124 } });
      assert.equal(lost.status, 124, lost.all);
      assert.match(lost.stdout, /^ERROR \(exit 124\) parity: 4 checks gave no verdict$/m);
      const bad = await go('copy-fail', { pixel: { stdout: { pct: 30, heightDelta: -10, compared: { width: 1440, height: 1000 } }, exit: 2 } });
      assert.equal(bad.status, 1, bad.all);
      assert.equal(bad.stdout.split('\n')[0], 'FAIL parity');
      assert.ok(bad.stdout.includes('  pixel @1440: 30.00% (bar ≤ 10%)'), bad.stdout);
      const good = await go('copy-pass', {});
      assert.equal(good.status, 0, good.all);
      assert.equal(good.stdout.trim(), 'PASS parity');
      assert.equal(readJson(join(outOf(root), 'parity.json')).verdict, 'PASS');
      assert.ok(existsSync(join(outOf(root), 'parity', 'reskin-1440.png')) && existsSync(join(outOf(root), 'parity', 'reskin-360.png')), 'both default widths were captured');

      rmSync(join(copy, 'replica', 'cap-probe.mjs'));
      const missing = await run(['parity', '--page', 'home', '--reskin', page], { cwd: root, script: gate });
      assert.equal(missing.status, 2, missing.all);
      assert.match(missing.stderr, /cap-probe\.mjs not found/);
    } finally { await server.close(); }
  });
}

// ---- the real instruments, against the fake preview ------------------------------------------------------------

if (playwrightOk) {
  const slowPage = (name, ...pairs) => {
    const file = join(scratch, `${name}.html`);
    let html = readFileSync(RESKIN_FIXTURE, 'utf8');
    for (const [from, to] of pairs) {
      assert.ok(html.includes(from), `the reskin fixture has ${from}`);
      html = html.replace(from, () => to);
    }
    writeFileSync(file, html);
    return file;
  };

  await check('the reskin fixture page against a preview serving the same page: PASS parity, one pixel row per width, the crop of the header passes, the footer crop is n/a (the page has none), cap-probe and chrome-parity are quiet; every artifact is written', async () => {
    const server = await startPreviewServer({ pages: { '/ns/home': RESKIN_FIXTURE } });
    try {
      const root = project('real-pass', { origin: server.origin });
      const r = await parity(root, ['--reskin', RESKIN_FIXTURE]);
      assert.equal(r.status, 0, r.all);
      assert.equal(r.stdout.split('\n')[0], 'PASS parity', r.stdout);
      assert.match(r.stdout, /^n\/a: reskin page renders no chrome \(footer crop @1440, footer crop @360\)$/m);
      assert.ok(!/FAIL|ERROR|ADVISORY/.test(r.stdout), r.stdout);
      const { verdict, rows } = readJson(join(outOf(root), 'parity.json'));
      assert.equal(verdict, 'PASS');
      assert.deepEqual(rows.filter((x) => x.check === 'pixel').map((x) => [x.width, x.status]), [[1440, 'PASS'], [360, 'PASS']]);
      assert.deepEqual(rows.filter((x) => x.check === 'height').map((x) => x.status), ['PASS', 'PASS']);
      assert.deepEqual(rows.filter((x) => x.check === 'header crop').map((x) => x.status), ['PASS', 'PASS']);
      assert.deepEqual(rows.filter((x) => x.check === 'footer crop').map((x) => [x.status, x.value]), [['n/a', 'n/a: reskin page renders no chrome'], ['n/a', 'n/a: reskin page renders no chrome']]);
      assert.equal(pick(rows, 'chrome-parity', 1440).status, 'PASS');
      assert.equal(pick(rows, 'cap-probe', 1440).status, 'PASS');
      assert.equal(pick(rows, 'pixel', 1440).value, '0.00%');
      assert.equal(pick(rows, 'height', 1440).value.startsWith('Δh 0px (0.0% of '), true, pick(rows, 'height', 1440).value);
      for (const row of rows) if (row.artifact) assert.ok(existsSync(join(root, row.artifact)), `${row.check} @${row.width}: ${row.artifact}`);
      assert.ok(existsSync(join(outOf(root), 'design.json')), 'cap-probe\'s design file');
      assert.equal(readJson(join(outOf(root), 'design.json')).extensions.breakpoints.probeWidth >= 2560, true);
      assert.ok(server.requests.some((q) => q.path === '/ns/home'), 'the preview was asked for');
    } finally { await server.close(); }
  });

  await check('a reskin page without chrome against a preview that wraps the same main in a fixed header and a footer: pixel is about 0% and Δh 0 at 1440 and 360, the rows say what was excluded, and the same pair captured without the exclusion is far over the bar', async () => {
    const stripes = Array.from({ length: 8 }, (_, i) => `<section style="height:420px;background:hsl(${i * 40} 60% 70%)"><h2>Section ${i}</h2></section>`).join('');
    const doc = (css, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>pair</title><style>body{margin:0;font:16px/24px sans-serif}${css}</style></head><body>${inner}</body></html>\n`;
    const reskin = join(scratch, 'pair-reskin.html');
    writeFileSync(reskin, doc('', `<main>${stripes}</main>`));
    const wrapped = join(scratch, 'pair-preview.html');
    writeFileSync(wrapped, doc('header{height:64px}header nav{position:fixed;top:0;left:0;width:100%;height:64px;background:#123;color:#fff;z-index:2}footer{height:120px;background:#345;color:#fff}', `<header><nav>Head</nav></header><main>${stripes}</main><footer>Foot</footer>`));
    const server = await startPreviewServer({ pages: { '/ns/home': wrapped } });
    try {
      const root = project('real-pair', { origin: server.origin });
      const result = await runParity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: reskin });
      for (const width of [1440, 360]) {
        const pixel = pick(result.rows, 'pixel', width);
        assert.equal(pixel.status, 'PASS', `pixel @${width}: ${pixel.value}`);
        assert.ok(Number.parseFloat(pixel.value) < 0.5, `pixel @${width} is main against main: ${pixel.value}`);
        assert.match(pick(result.rows, 'height', width).value, /^Δh 0px /, `height @${width}`);
        for (const check of ['pixel', 'height']) assert.equal(pick(result.rows, check, width).detail, 'preview header/footer excluded: reskin page renders none');
        for (const check of ['header crop', 'footer crop']) assert.equal(pick(result.rows, check, width).value, 'n/a: reskin page renders no chrome');
      }
      const out = join(outOf(root), 'parity');
      const tools = replicaTools();
      const unhidden = join(out, 'unhidden-360.png');
      const shot = await run([`${server.origin}/ns/home`, unhidden, '--width', '360', '--settle', '--wait', '3000'], { script: tools.stitch });
      assert.equal(shot.status, 0, shot.all);
      const compared = await run([join(out, 'reskin-360.png'), unhidden, '--json', '--out', join(out, 'unhidden-diff.png')], { script: tools.pixel });
      assert.ok(JSON.parse(compared.stdout).pct > 10, `without the exclusion: ${compared.stdout}`);
    } finally { await server.close(); }
  });

  await check('a preview with a section 200px taller than the reskin page: FAIL parity naming Δh, at both widths, with the pixel bar blind to it', async () => {
    const taller = slowPage('page-taller', ['.features { width: 1440px; height: 800px;', '.features { width: 1440px; height: 1000px;']);
    const server = await startPreviewServer({ pages: { '/ns/home': taller } });
    try {
      const root = project('real-fail', { origin: server.origin });
      const result = await runParity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: RESKIN_FIXTURE });
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.exit, 1);
      const heights = result.rows.filter((x) => x.check === 'height');
      assert.deepEqual(heights.map((x) => x.status), ['FAIL', 'FAIL']);
      for (const h of heights) assert.match(h.value, /^Δh \+200px \(\d+\.\d% of \d+px\)$/, h.value);
      const lines = parityLines(result);
      assert.equal(lines[0], 'FAIL parity');
      assert.ok(lines.some((l) => /^ {2}height @1440: Δh \+200px/.test(l)), lines.join('\n'));
      assert.ok(lines.some((l) => /^ {2}height @360: Δh \+200px/.test(l)), lines.join('\n'));
    } finally { await server.close(); }
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
