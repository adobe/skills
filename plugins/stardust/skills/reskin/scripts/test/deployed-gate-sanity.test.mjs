#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-sanity.test.mjs — A4 of the deployed leg, `deployed-gate sanity`: the hard
// asserts on the preview. The checks that need no browser come first (instrument lookup in both layouts, the CLI's
// setup errors, a protected preview), then runSanity against stand-ins for clip-probe and content-presence (the
// overflow, decoration, image and page-error rows are measured by a real browser on the fake preview of
// fixtures/deployed/; the instruments' argv, their exit mapping), then the CLI in the project-copy layout, then the
// real instruments (a few Chromium page loads each: slow). The browser parts need playwright and print a skip line
// when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';
import { main } from '../deployed-gate.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { diffTools, runSanity, sanityLines } from '../deployed/sanity.mjs';
import { fixturePath, startPreviewServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const DIFF_SCRIPTS = join(SCRIPTS, '..', '..', 'diff', 'scripts');
const HOME = fixturePath('home.html');
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-sanity-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', ...env } });
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
      url: `${origin}/ns/home`, origin, path: '/ns/home', plain: `${origin}/ns/home.plain.html`, namespace: 'ns', sandbox: false, auth: false, checkedAt: new Date().toISOString(), ...record,
    }, null, 2)}\n`);
  }
  return root;
};
const outOf = (root) => deployedDir(join(root, 'stardust'), 'home');
const previewOf = (root) => readJson(join(outOf(root), 'preview.json'));
const sanity = (root, extra = [], opts = {}) => run(['sanity', '--page', 'home', ...extra], { cwd: root, ...opts });

// The reskin page the preview is held to: any page will do for the stand-ins (the static server only has to serve it).
let pageCount = 0;
const smallPage = () => {
  pageCount += 1;
  const file = join(scratch, `page-${pageCount}.html`);
  writeFileSync(file, '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>sanity</title></head><body><main><h1>Body</h1></main></body></html>\n');
  return file;
};

// The home fixture with `pairs` of [from, to] replaced, written to the scratch directory → its absolute path.
const variant = (name, ...pairs) => {
  const file = join(scratch, `${name}.html`);
  let html = readFileSync(HOME, 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(html.includes(from), `home.html has ${from}`);
    html = html.replace(from, () => to);
  }
  writeFileSync(file, html);
  return file;
};
// The same copy as a static reskin page: no decoration script, so it shows its body from the start.
const reskinPage = () => variant('reskin', ['body { display: none;', 'body { display: block;']);

// ---- stand-ins for clip-probe and content-presence -------------------------------------------------------------

const NAMES = { clip: 'clip-probe.mjs', presence: 'content-presence.mjs' };
const CLIP_PASS = { counts: { total: 0, textClipped: 0, textHidden: 0, controlHidden: 0, controlClipped: 0 }, findings: [] };
const PRESENCE_PASS = { totals: { missing: 0, hidden: 0, missingHeadings: 0, hiddenHeadings: 0, missingLinks: 0, hiddenLinks: 0 }, findings: [] };
const DEFAULTS = { clip: { json: CLIP_PASS }, presence: { json: PRESENCE_PASS } };

// Each stand-in logs { tool, argv, token, reskin } to calls.jsonl (reskin: the status the first argument answers to
// while the instrument runs, for the one that takes the reskin page), writes C.json to the file after --json when
// it exits 0 or 2, and prints and exits as `c` says.
const stubSource = (tool, c, calls) => `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const C = ${JSON.stringify(c)};
const argv = process.argv.slice(2);
const flag = (f) => argv[argv.indexOf(f) + 1];
let reskin = null;
if (${JSON.stringify(tool)} === 'presence') { try { reskin = (await fetch(argv[0])).status; } catch (e) { reskin = String(e); } }
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, argv, reskin, token: process.env.DEPLOYED_GATE_SITE_TOKEN ?? null }) + '\\n');
const exit = C.exit ?? 0;
if (C.json !== undefined && [0, 2].includes(exit)) {
  mkdirSync(dirname(flag('--json')), { recursive: true });
  writeFileSync(flag('--json'), typeof C.json === 'string' ? C.json : JSON.stringify(C.json));
}
process.stdout.write(C.stdout ?? '');
process.stderr.write(C.stderr ?? '');
process.exit(exit);
`;

// The two stand-ins in `at`, under the instruments' file names; `cfg[tool]` overrides DEFAULTS[tool].
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

const brief = (rows) => rows.map(({ check: c, width, value, bar, status }) => ({ check: c, width, value, bar, status }));
const pick = (rows, c, width) => rows.find((r) => r.check === c && r.width === width);
const BROWSER_CHECKS = ['overflow', 'decoration', 'broken images', 'page errors'];

// ---- no browser ------------------------------------------------------------------------------------------------

await check('diffTools finds clip-probe and content-presence in the plugin tree and in the project copy, and names what is missing', () => {
  const real = diffTools();
  assert.deepEqual(Object.keys(real).sort(), ['clip', 'presence']);
  for (const [tool, file] of Object.entries(NAMES)) {
    assert.equal(real[tool], join(DIFF_SCRIPTS, file));
    assert.ok(existsSync(real[tool]), `${file} exists in the plugin tree`);
  }
  const copy = join(scratch, 'layout');
  mkdirSync(join(copy, 'reskin', 'deployed'), { recursive: true });
  stubTools('layout-stubs', {}, join(copy, 'diff'));
  const found = diffTools(join(copy, 'reskin', 'deployed'));
  for (const [tool, file] of Object.entries(NAMES)) assert.equal(found[tool], join(copy, 'diff', file));
  const bare = join(scratch, 'layout-bare');
  mkdirSync(join(bare, 'reskin', 'deployed'), { recursive: true });
  mkdirSync(join(bare, 'diff'));
  writeFileSync(join(bare, 'diff', 'clip-probe.mjs'), '');
  assert.throws(() => diffTools(join(bare, 'reskin', 'deployed')), (e) => e instanceof UsageError && e.code === 2
    && /content-presence\.mjs/.test(e.message) && !/clip-probe/.test(e.message) && /stardust\/scripts\/diff/.test(e.message), 'the missing file is named');
});

await check('--help documents sanity; its usage errors exit 2 and write nothing; the record is needed (absent, problems), a skipped leg is "not run: skipped", the reskin page must exist', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  const r = await run(['--help'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /deployed-gate\.mjs sanity --page <slug> \[--reskin <file>\] \[--dir stardust\]/);
  for (const re of [/overflow/, /4px/, /decoration/, /broken images/, /page errors/, /clip-probe/, /content-presence/, /1440 and 360/, /never waivable/i, /FAIL sanity \(hard\)/, /protected preview/, /not run: skipped/]) assert.match(r.stdout, re);
  const help = r.stdout.replace(/\s+/g, ' ');
  assert.ok(help.includes('prints only the one line "n/a: protected preview (<rows>)" (verdict "n/a", exit 0, no PASS or FAIL)'), 'the help says what a protected preview prints');
  assert.ok(help.includes('inside all the row reads "ADVISORY sanity n/a: protected preview"'), 'and what all prints');
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');

  const root = project('sanity-usage', { preview: false });
  for (const [args, re] of [
    [['sanity'], /sanity needs --page <slug>/],
    [['sanity', '--page', '../x'], /--page must be a slug/],
    [['sanity', '--page', 'home', '--org', 'o'], /unknown flag --org for sanity/],
    [['sanity', '--page', 'home', '--auth-header', 'token x'], /unknown flag --auth-header for sanity/],
    [['sanity', '--page', 'home', 'stray'], /unexpected argument "stray"/],
    [['sanity', '--page'], /--page needs a value/],
    [['sanity', '--page', 'home', '--reskin', '--dir', 'x'], /--reskin needs a value/],
  ]) {
    const got = await run(args, { cwd: root });
    assert.equal(got.status, 2, `${args.join(' ')}: ${got.all}`);
    assert.match(got.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');

  const none = await sanity(root);
  assert.equal(none.status, 2, none.all);
  assert.match(none.stderr, /deployed-gate preview/);
  const problems = project('sanity-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  const refused = await sanity(problems);
  assert.equal(refused.status, 2, refused.all);
  assert.match(refused.stderr, /preview has problems: run deployed-gate preview again/);
  const skipped = project('sanity-skipped', { record: { skipped: true, reason: 'not an aem-boilerplate project: missing head.html at the project root', url: null, origin: null, plain: null } });
  const idle = await sanity(skipped);
  assert.equal(idle.status, 0, idle.all);
  assert.equal(idle.stdout.trim(), 'not run: skipped');
  assert.ok(!existsSync(join(outOf(skipped), 'sanity.json')), 'nothing written');
  const noPage = project('sanity-no-page');
  const missing = await sanity(noPage);
  assert.equal(missing.status, 2, missing.all);
  assert.match(missing.stderr, /missing .*reskin[\\/]pages[\\/]home\.html.*--reskin/);
  const named = await sanity(noPage, ['--reskin', join(scratch, 'no-such-page.html')]);
  assert.equal(named.status, 2, named.all);
  assert.match(named.stderr, /no-such-page\.html/);
  assert.ok(!existsSync(join(outOf(noPage), 'sanity.json')));
});

await check('a protected preview: every row is "n/a: protected preview", nothing is run or served, sanity.json says so (hard), and the CLI prints the one n/a line with exit 0', async () => {
  const root = project('protected', { record: { auth: true } });
  const stub = stubTools('protected-stubs');
  const result = await runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: smallPage(), tools: stub.tools });
  assert.equal(result.verdict, 'n/a');
  assert.equal(result.exit, 0);
  assert.deepEqual(result.rows.map((r) => `${r.check}@${r.width}`), [
    ...BROWSER_CHECKS.map((c) => `${c}@1440`), 'clip-probe@1440', 'content-presence@1440', ...BROWSER_CHECKS.map((c) => `${c}@360`),
  ]);
  for (const r of result.rows) {
    assert.equal(r.status, 'n/a');
    assert.equal(r.value, 'n/a: protected preview');
    assert.equal(r.artifact, null);
  }
  assert.deepEqual(stub.calls(), [], 'nothing was run');
  assert.deepEqual(readJson(join(outOf(root), 'sanity.json')), { verdict: 'n/a', hard: true, rows: result.rows });
  const lines = sanityLines(result);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^n\/a: protected preview \(overflow @1440, decoration @1440, broken images @1440, page errors @1440, clip-probe @1440, content-presence @1440, overflow @360, /);

  const cli = await sanity(root, ['--reskin', smallPage()]);
  assert.equal(cli.status, 0, cli.all);
  assert.equal(cli.stdout.trim(), lines[0]);
  assert.ok(!/PASS|FAIL/.test(cli.stdout));
});

await check('main dispatches sanity to a replaceable step and returns its exit code; --help runs before it', async () => {
  const lines = [];
  const code = await main(['sanity', '--page', 'home'], { log: (m) => lines.push(m), steps: { sanity: async ({ opts, log }) => { log(`stub ${opts.page}`); return 5; } } });
  assert.equal(code, 5);
  assert.deepEqual(lines, ['stub home']);
  assert.equal(await main(['sanity', '--help'], { log: () => {}, steps: { sanity: async () => { throw new Error('must not run'); } } }), 0);
});

// ---- runSanity: the browser rows measured, the instruments stood in for ------------------------------------------

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

// One runSanity against a fake preview serving `previewPage`; the browser rows are measured for real, with a short
// EDS bound. → { result | error, stub, root, previewUrl }: no throw.
const scenario = async (name, cfg = {}, { reskin = smallPage(), previewPage = HOME, widths = [1440], serverOptions = {}, env = process.env } = {}) => {
  const server = await startPreviewServer({ pages: { '/ns/home': previewPage }, ...serverOptions });
  try {
    const root = project(name, { origin: server.origin });
    const stub = stubTools(name, cfg);
    const got = await attempt(() => runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: reskin, widths, tools: stub.tools, env, edsTimeoutMs: 1500 }));
    return { result: got.value, error: got.error, stub, root, previewUrl: `${server.origin}/ns/home` };
  } finally { await server.close(); }
};
const fails = (result) => brief(result.rows).filter((r) => r.status === 'FAIL').map((r) => `${r.check}@${r.width}`);

if (playwrightOk) {
  await check('a clean preview: every row passes at both widths, clip-probe and content-presence run once at 1440 as shipped, the reskin page is served to the latter over http, and sanity.json says hard', async () => {
    const reskin = smallPage();
    const { result, stub, root, previewUrl, error } = await scenario('clean', {}, { reskin, widths: [1440, 360], env: { ...process.env, DEPLOYED_GATE_SITE_TOKEN: 'stray' } });
    assert.ifError(error);
    const calls = stub.calls();
    assert.deepEqual(calls.map((c) => c.tool), ['clip', 'presence'], 'each once, clip-probe first');
    const out = join(outOf(root), 'sanity');
    assert.deepEqual(calls[0].argv, [previewUrl, '--width', '1440', '--plain', '--json', join(out, 'clip-probe-1440.json')]);
    const reskinUrl = calls[1].argv[0];
    assert.match(reskinUrl, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/${reskin.split('/').pop()}$`), 'the reskin page is served over http, never file://');
    assert.deepEqual(calls[1].argv, [reskinUrl, previewUrl, '--width', '1440', '--plain', '--json', join(out, 'content-presence-1440.json')]);
    assert.equal(calls[1].reskin, 200, 'served while the instrument ran');
    for (const c of calls) assert.equal(c.token, null, 'no site token travels to an instrument, not even an inherited one');
    await assert.rejects(fetch(reskinUrl), 'the static server of the reskin page is stopped');

    assert.equal(result.verdict, 'PASS');
    assert.equal(result.exit, 0);
    assert.equal(result.hard, true);
    const widthRows = (width) => [
      { check: 'overflow', width, value: '0px', bar: '≤ 4px', status: 'PASS' },
      { check: 'decoration', width, value: 'loaded', bar: 'all loaded', status: 'PASS' },
      { check: 'broken images', width, value: '0', bar: '0', status: 'PASS' },
      { check: 'page errors', width, value: '0', bar: '0', status: 'PASS' },
    ];
    assert.deepEqual(brief(result.rows), [
      ...widthRows(1440),
      { check: 'clip-probe', width: 1440, value: '0', bar: '0', status: 'PASS' },
      { check: 'content-presence', width: 1440, value: '0', bar: '0', status: 'PASS' },
      ...widthRows(360),
    ]);
    assert.equal(pick(result.rows, 'clip-probe', 1440).artifact, join(out, 'clip-probe-1440.json'));
    assert.equal(pick(result.rows, 'content-presence', 1440).artifact, join(out, 'content-presence-1440.json'));
    assert.deepEqual(Object.keys(result.rows[0]).sort(), ['artifact', 'bar', 'check', 'detail', 'status', 'value', 'width']);
    assert.deepEqual(readJson(join(outOf(root), 'sanity.json')), { verdict: 'PASS', hard: true, rows: result.rows });
    assert.deepEqual(sanityLines(result), ['PASS sanity']);
  });

  await check('overflow: scrollWidth − clientWidth at most 4px at each width; a 600px element at 360 is 240px over, and 4px over passes', async () => {
    const wide = variant('wide', ['<body>', '<body>\n<div style="width:600px;height:10px"></div>']);
    const bad = await scenario('overflow', {}, { previewPage: wide, widths: [1440, 360] });
    assert.ifError(bad.error);
    assert.equal(bad.result.verdict, 'FAIL');
    assert.equal(bad.result.exit, 1);
    assert.deepEqual(fails(bad.result), ['overflow@360']);
    assert.deepEqual(brief(bad.result.rows).filter((r) => r.check === 'overflow'), [
      { check: 'overflow', width: 1440, value: '0px', bar: '≤ 4px', status: 'PASS' },
      { check: 'overflow', width: 360, value: '240px', bar: '≤ 4px', status: 'FAIL' },
    ]);
    const lines = sanityLines(bad.result);
    assert.deepEqual(lines, ['FAIL sanity (hard)', '  overflow 240px > 4px @360']);
    assert.deepEqual(readJson(join(outOf(bad.root), 'sanity.json')).hard, true);

    const edge = await scenario('overflow-4', {}, { previewPage: variant('wide-364', ['<body>', '<body>\n<div style="width:364px;height:10px"></div>']), widths: [360] });
    assert.equal(pick(edge.result.rows, 'overflow', 360).value, '4px');
    assert.equal(pick(edge.result.rows, 'overflow', 360).status, 'PASS', 'exactly 4px passes');
    const over = await scenario('overflow-5', {}, { previewPage: variant('wide-365', ['<body>', '<body>\n<div style="width:365px;height:10px"></div>']), widths: [360] });
    assert.equal(pick(over.result.rows, 'overflow', 360).value, '5px');
    assert.equal(pick(over.result.rows, 'overflow', 360).status, 'FAIL');
  });

  await check('decoration: a block that never reaches "loaded" fails and is named; a page that never gets body.appear is named too; the other rows are still measured', async () => {
    const stalled = await scenario('stall', {}, { serverOptions: { stallBlock: 'cards' } });
    assert.ifError(stalled.error);
    assert.equal(stalled.result.verdict, 'FAIL');
    assert.deepEqual(fails(stalled.result), ['decoration@1440']);
    assert.equal(pick(stalled.result.rows, 'decoration', 1440).value, 'block cards');
    assert.equal(pick(stalled.result.rows, 'overflow', 1440).status, 'PASS');
    assert.equal(pick(stalled.result.rows, 'clip-probe', 1440).status, 'PASS', 'the instruments ran');
    assert.deepEqual(sanityLines(stalled.result), ['FAIL sanity (hard)', '  decoration: block cards @1440']);

    const never = await scenario('never-appear', {}, { serverOptions: { decorateDelayMs: 600000 } });
    assert.ifError(never.error);
    assert.deepEqual(fails(never.result), ['decoration@1440']);
    assert.match(pick(never.result.rows, 'decoration', 1440).value, /^body\.appear, section 0, section 1, section 2, block header, block cards, block footer$/);
  });

  await check('broken images: an <img> that is complete with no natural width counts once the page has been scrolled through (a lazy one far down too); a hidden one, and one that loads, do not', async () => {
    const page = variant('images',
      ['</main>', `<div><img src="/ns/missing-eager.png" alt="eager" width="40" height="40"><img src="/ns/missing-hidden.png" alt="" style="display:none">
<div style="height:4000px"></div><img loading="lazy" src="/ns/missing-lazy.png" alt="lazy" width="40" height="40"><img loading="lazy" src="./media_ab12.png" alt="ok" width="40" height="40"></div></main>`]);
    const { result, error } = await scenario('images', {}, { previewPage: page });
    assert.ifError(error);
    assert.deepEqual(fails(result), ['broken images@1440']);
    const found = pick(result.rows, 'broken images', 1440);
    assert.equal(found.value, '2');
    const srcs = found.detail.split('\n');
    assert.equal(srcs.length, 2, found.detail);
    assert.match(srcs[0], /^http:\/\/127\.0\.0\.1:\d+\/ns\/missing-eager\.png$/);
    assert.match(srcs[1], /^http:\/\/127\.0\.0\.1:\d+\/ns\/missing-lazy\.png$/);
    const lines = sanityLines(result);
    assert.equal(lines[0], 'FAIL sanity (hard)');
    assert.equal(lines[1], '  broken images 2 > 0 @1440');
    assert.match(lines[2], /^ {4}http:\/\/127\.0\.0\.1:\d+\/ns\/missing-eager\.png$/);
  });

  await check('page errors: an uncaught script error counts, once per page load, with its message; the reskin page\'s own errors are not counted', async () => {
    const page = variant('throws', ['</body>', '<script>throw new Error("boom from the page");</script>\n</body>']);
    const { result, error } = await scenario('page-error', {}, { previewPage: page, widths: [1440, 360] });
    assert.ifError(error);
    assert.deepEqual(fails(result), ['page errors@1440', 'page errors@360']);
    assert.equal(pick(result.rows, 'page errors', 1440).value, '1');
    assert.match(pick(result.rows, 'page errors', 1440).detail, /boom from the page/);
    assert.equal(pick(result.rows, 'decoration', 1440).status, 'PASS', 'the decoration still ran');
    const lines = sanityLines(result);
    assert.deepEqual(lines.slice(0, 3), ['FAIL sanity (hard)', '  page errors 1 > 0 @1440', lines[2]]);
    assert.match(lines[2], /^ {4}.*boom from the page/);
    assert.ok(lines.includes('  page errors 1 > 0 @360'));

    const reskinThrows = join(scratch, 'reskin-throws.html');
    writeFileSync(reskinThrows, '<!doctype html><html><body><main><h1>Body</h1></main><script>throw new Error("reskin boom");</script></body></html>\n');
    const clean = await scenario('page-error-reskin', {}, { reskin: reskinThrows });
    assert.equal(clean.result.verdict, 'PASS');
  });

  await check('clip-probe and content-presence: exit 2 is a FAIL row with the instrument\'s count and its findings; the exit is the verdict, the number comes from the JSON', async () => {
    const clipJson = {
      counts: { total: 2, textClipped: 2 },
      findings: [
        { kind: 'TEXT CLIPPED', text: 'First line of the note', clipper: 'div.card-note', path: 'main > div > p' },
        { kind: 'TEXT HIDDEN', text: 'Second line', clipper: 'div.card-note', path: 'main > div > p' },
        { kind: 'TEXT CLAMPED', advisory: true, text: 'quiet', clipper: 'p.clamp', path: 'main > p' },
      ],
    };
    const presenceJson = {
      totals: { missing: 1, hidden: 2, missingHeadings: 0, hiddenHeadings: 1, missingLinks: 1, hiddenLinks: 1 },
      findings: [
        { sev: '🔴', kind: 'MISSING LINK', msg: 'link "Pricing" has no served link' },
        { sev: '🔴', kind: 'HIDDEN HEADING', msg: 'h2 "Plans" is in the served DOM but clipped away (main > h2)' },
        { sev: '🔴', kind: 'HIDDEN LINK', msg: 'link "Buy" is in the served DOM but clipped away' },
        { sev: '🟠', kind: 'MISSING BUTTON', msg: 'button "Go" has no served button' },
      ],
    };
    const { result, error } = await scenario('exit-2', { clip: { json: clipJson, exit: 2 }, presence: { json: presenceJson, exit: 2 } });
    assert.ifError(error);
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.exit, 1);
    assert.deepEqual(fails(result), ['clip-probe@1440', 'content-presence@1440']);
    assert.equal(pick(result.rows, 'clip-probe', 1440).value, '2');
    assert.equal(pick(result.rows, 'content-presence', 1440).value, '3');
    const lines = sanityLines(result);
    assert.deepEqual(lines, [
      'FAIL sanity (hard)',
      '  clip-probe 2 > 0 @1440',
      '    TEXT CLIPPED "First line of the note" in div.card-note',
      '    TEXT HIDDEN "Second line" in div.card-note',
      '  content-presence 3 > 0 @1440',
      '    HIDDEN 2, MISSING 1',
      '    MISSING LINK: link "Pricing" has no served link',
      '    HIDDEN HEADING: h2 "Plans" is in the served DOM but clipped away (main > h2)',
      '    HIDDEN LINK: link "Buy" is in the served DOM but clipped away',
    ]);
    const lying = await scenario('exit-2-none', { clip: { json: CLIP_PASS, exit: 2 } });
    assert.equal(pick(lying.result.rows, 'clip-probe', 1440).status, 'FAIL', 'the instrument\'s exit is its verdict');
    assert.equal(pick(lying.result.rows, 'clip-probe', 1440).value, '0');
  });

  await check('exit mapping: a bot challenge (3) is a thrown error with code 3 and writes no verdict; 124, 1, 4 or any other exit is that row "ERROR (exit N)" and the step\'s exit 124; the rows measured stay', async () => {
    const clipChallenge = await scenario('exit-3-clip', { clip: { exit: 3, stderr: 'clip-probe error: bot challenge at the preview\n' } });
    assert.equal(clipChallenge.error?.code, 3, String(clipChallenge.error));
    assert.match(clipChallenge.error.message, /clip-probe/);
    assert.match(clipChallenge.error.message, /bot challenge/);
    assert.ok(!existsSync(join(outOf(clipChallenge.root), 'sanity.json')), 'no verdict');
    const presenceChallenge = await scenario('exit-3-presence', { presence: { exit: 3, stderr: 'content-presence error: bot challenge\n' } });
    assert.equal(presenceChallenge.error?.code, 3);

    const deadline = await scenario('exit-124', { clip: { exit: 124, stderr: 'clip-probe: no verdict\n' } });
    assert.ifError(deadline.error);
    assert.equal(deadline.result.verdict, 'ERROR');
    assert.equal(deadline.result.exit, 124);
    assert.deepEqual(brief(deadline.result.rows).filter((r) => r.status === 'ERROR'), [{ check: 'clip-probe', width: 1440, value: 'ERROR (exit 124)', bar: '0', status: 'ERROR' }]);
    assert.equal(pick(deadline.result.rows, 'clip-probe', 1440).detail, 'clip-probe: no verdict');
    assert.equal(pick(deadline.result.rows, 'overflow', 1440).status, 'PASS', 'the rest was measured');
    assert.deepEqual(readJson(join(outOf(deadline.root), 'sanity.json')), { verdict: 'ERROR', hard: true, rows: deadline.result.rows });
    assert.deepEqual(sanityLines(deadline.result), ['ERROR (exit 124) sanity: 1 check gave no verdict', '  clip-probe @1440: ERROR (exit 124)', '    clip-probe: no verdict']);

    const origin = await scenario('exit-4', { presence: { exit: 4, stderr: 'content-presence error: HTTP 404 at the reskin page\n' } });
    assert.equal(origin.result.exit, 124);
    assert.equal(pick(origin.result.rows, 'content-presence', 1440).value, 'ERROR (exit 4)');
    const crash = await scenario('exit-1', { clip: { exit: 1, stderr: 'clip-probe error: x\n' } });
    assert.equal(pick(crash.result.rows, 'clip-probe', 1440).value, 'ERROR (exit 1)');
    const noJson = await scenario('no-json', { presence: { json: 'not json' } });
    assert.equal(pick(noJson.result.rows, 'content-presence', 1440).value, 'ERROR (exit 0)', 'an exit that gave no number is no verdict');
    const noFile = await scenario('no-file', { clip: { json: undefined } });
    assert.equal(pick(noFile.result.rows, 'clip-probe', 1440).value, 'ERROR (exit 0)');

    const both = await scenario('exit-mixed', { clip: { exit: 1, stderr: 'clip-probe: down\n' }, presence: { json: { totals: { missing: 1, hidden: 0 }, findings: [] }, exit: 2 } });
    assert.equal(both.result.verdict, 'ERROR', 'a row in error outranks a failing one');
    assert.equal(both.result.exit, 124);
    const text = sanityLines(both.result);
    assert.equal(text[0], 'ERROR (exit 124) sanity: 1 check gave no verdict');
    assert.ok(text.includes('FAIL sanity (hard)') && text.includes('  content-presence 1 > 0 @1440'), text.join('\n'));
  });

  await check('a browser that cannot load the preview is that width\'s four rows "ERROR (exit 124)" with the reason; a bot challenge at the preview is exit 3 with no verdict', async () => {
    const closed = createServer();
    await new Promise((done) => { closed.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${closed.address().port}`;
    await new Promise((done) => { closed.close(done); });
    const root = project('unreachable', { origin });
    const stub = stubTools('unreachable-stubs');
    const result = await runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: smallPage(), widths: [1440, 360], tools: stub.tools, edsTimeoutMs: 1500 });
    assert.equal(result.verdict, 'ERROR');
    assert.equal(result.exit, 124);
    for (const width of [1440, 360]) {
      for (const c of BROWSER_CHECKS) {
        const r = pick(result.rows, c, width);
        assert.equal(r.value, 'ERROR (exit 124)', `${c} @${width}`);
        assert.match(r.detail, /ERR_CONNECTION_REFUSED/);
      }
    }
    assert.equal(pick(result.rows, 'clip-probe', 1440).status, 'PASS', 'the instruments are asked regardless');

    const challenged = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }); res.end('<html><body>just a moment</body></html>'); });
    await new Promise((done) => { challenged.listen(0, '127.0.0.1', done); });
    try {
      const gate = project('challenged', { origin: `http://127.0.0.1:${challenged.address().port}` });
      const got = await attempt(() => runSanity({ dir: join(gate, 'stardust'), slug: 'home', preview: previewOf(gate), reskinPage: smallPage(), widths: [1440], tools: stubTools('challenged-stubs').tools, edsTimeoutMs: 1500 }));
      assert.equal(got.error?.code, 3, String(got.error));
      assert.match(got.error.message, /bot challenge/);
      assert.ok(!existsSync(join(outOf(gate), 'sanity.json')), 'no verdict');
    } finally { await new Promise((done) => { challenged.close(done); challenged.closeAllConnections(); }); }
  });

  await check('a preview that answers HTTP 404 or 500 gives no verdict: the four rows of each width are "ERROR (exit 124)" with "HTTP <n> at <url>", never a pass', async () => {
    for (const status of [404, 500]) {
      const failing = createServer((req, res) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end('<!doctype html><html><body class="appear"><main><h1>Oops</h1></main></body></html>'); });
      await new Promise((done) => { failing.listen(0, '127.0.0.1', done); });
      try {
        const origin = `http://127.0.0.1:${failing.address().port}`;
        const root = project(`http-${status}`, { origin });
        const result = await runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: smallPage(), widths: [1440, 360], tools: stubTools(`http-${status}-stubs`).tools, edsTimeoutMs: 1500 });
        assert.equal(result.verdict, 'ERROR', `${status}: ${JSON.stringify(brief(result.rows))}`);
        assert.equal(result.exit, 124);
        for (const width of [1440, 360]) {
          for (const c of BROWSER_CHECKS) {
            const r = pick(result.rows, c, width);
            assert.deepEqual([r.status, r.value, r.detail], ['ERROR', 'ERROR (exit 124)', `HTTP ${status} at ${origin}/ns/home`], `${status} ${c} @${width}`);
          }
        }
        assert.deepEqual(sanityLines(result).slice(0, 2), ['ERROR (exit 124) sanity: 8 checks gave no verdict', `  overflow @1440: ERROR (exit 124)`]);
        assert.equal(readJson(join(outOf(root), 'sanity.json')).verdict, 'ERROR', 'the record says no verdict');
      } finally { await new Promise((done) => { failing.close(done); failing.closeAllConnections(); }); }
    }
  });

  await check('runSanity clears the evidence of the last run first, and a missing tool, a record without a url or a missing page is a setup error before anything is measured', async () => {
    const root = project('stale', { origin: 'http://127.0.0.1:9' });
    const out = outOf(root);
    mkdirSync(join(out, 'sanity'), { recursive: true });
    writeFileSync(join(out, 'sanity', 'clip-probe-1440.json'), '{}');
    writeFileSync(join(out, 'sanity.json'), '{"verdict":"PASS","hard":true,"rows":[]}\n');
    const stub = stubTools('stale-stubs');
    rmSync(stub.tools.presence);
    const gone = await attempt(() => runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: smallPage(), widths: [1440], tools: stub.tools }));
    assert.ok(gone.error instanceof UsageError && /content-presence\.mjs/.test(gone.error.message), String(gone.error));
    assert.deepEqual(stub.calls(), [], 'nothing was run');
    assert.ok(!existsSync(join(out, 'sanity.json')) && !existsSync(join(out, 'sanity')), 'no stale record or artifact');
    const noUrl = await attempt(() => runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: { auth: false }, reskinPage: smallPage(), tools: stub.tools }));
    assert.ok(noUrl.error instanceof UsageError && /has no url/.test(noUrl.error.message), String(noUrl.error));
    const noPage = await attempt(() => runSanity({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), reskinPage: join(scratch, 'no-such-page.html'), tools: stub.tools }));
    assert.ok(noPage.error instanceof UsageError && /no-such-page\.html/.test(noPage.error.message), String(noPage.error));
  });

  await check('the project-copy layout: the CLI finds the instruments and measure-live beside the reskin scripts; 3 is exit 3, a row in error is exit 124, a failing row is exit 1, a missing instrument is exit 2', async () => {
    const copy = join(scratch, 'copy');
    cpSync(SCRIPTS, join(copy, 'reskin'), { recursive: true, filter: (src) => src !== join(SCRIPTS, 'test') });
    cpSync(DIFF_SCRIPTS, join(copy, 'diff'), { recursive: true, filter: (src) => src !== join(DIFF_SCRIPTS, 'test') });
    symlinkSync(join(dirname(fileURLToPath(import.meta.resolve('playwright'))), '..'), join(copy, 'node_modules'));
    const gate = join(copy, 'reskin', 'deployed-gate.mjs');
    const server = await startPreviewServer({ pages: { '/ns/home': HOME } });
    try {
      const root = project('copy-proj', { origin: server.origin });
      const page = smallPage();
      const go = async (name, cfg) => {
        stubTools(name, cfg, join(copy, 'diff'));
        return run(['sanity', '--page', 'home', '--reskin', page], { cwd: root, script: gate });
      };
      const challenge = await go('copy-3', { clip: { exit: 3, stderr: 'clip-probe error: challenge\n' } });
      assert.equal(challenge.status, 3, challenge.all);
      assert.match(challenge.stderr, /^deployed-gate: clip-probe.*challenge/);
      const lost = await go('copy-124', { clip: { exit: 124 } });
      assert.equal(lost.status, 124, lost.all);
      assert.match(lost.stdout, /^ERROR \(exit 124\) sanity: 1 check gave no verdict$/m);
      const bad = await go('copy-fail', { clip: { json: { counts: { total: 1 }, findings: [{ kind: 'TEXT CLIPPED', text: 't', clipper: 'div', path: 'p' }] }, exit: 2 } });
      assert.equal(bad.status, 1, bad.all);
      assert.equal(bad.stdout.split('\n')[0], 'FAIL sanity (hard)');
      assert.ok(bad.stdout.includes('  clip-probe 1 > 0 @1440'), bad.stdout);
      const good = await go('copy-pass', {});
      assert.equal(good.status, 0, good.all);
      assert.equal(good.stdout.trim(), 'PASS sanity');
      const record = readJson(join(outOf(root), 'sanity.json'));
      assert.equal(record.verdict, 'PASS');
      assert.equal(record.hard, true);
      assert.deepEqual([...new Set(record.rows.map((r) => r.width))], [1440, 360], 'both default widths were measured');
      rmSync(join(copy, 'diff', 'content-presence.mjs'));
      const missing = await run(['sanity', '--page', 'home', '--reskin', page], { cwd: root, script: gate });
      assert.equal(missing.status, 2, missing.all);
      assert.match(missing.stderr, /content-presence\.mjs not found/);
    } finally { await server.close(); }
  });

  // ---- the real instruments, against the fake preview --------------------------------------------------------------

  await check('the real instruments on the fixture page: PASS sanity against a reskin page with the same content; a card of 20px with overflow hidden around two lines of text FAILs the clip-probe row', async () => {
    const reskin = reskinPage();
    const server = await startPreviewServer({ pages: { '/ns/home': HOME, '/ns/clipped': variant('clipped', ['</div></div></div>\n</main>', '<div class="card-note" style="width:200px;height:20px;padding:0;margin-top:12px;overflow:hidden"><p>First line of the note, long enough to wrap onto a second line</p></div></div></div></div>\n</main>']) } });
    try {
      const root = project('real', { origin: server.origin });
      const clean = await sanity(root, ['--reskin', reskin]);
      assert.equal(clean.status, 0, clean.all);
      assert.equal(clean.stdout.trim(), 'PASS sanity', clean.all);
      const record = readJson(join(outOf(root), 'sanity.json'));
      assert.equal(record.hard, true);
      assert.deepEqual(record.rows.filter((r) => r.status !== 'PASS'), []);
      assert.equal(pick(record.rows, 'clip-probe', 1440).value, '0');
      assert.equal(pick(record.rows, 'content-presence', 1440).value, '0');
      for (const r of record.rows) if (r.artifact) assert.ok(existsSync(join(root, r.artifact)), `${r.check}: ${r.artifact}`);

      const clippedRoot = project('real-clipped', { origin: server.origin, record: { url: `${server.origin}/ns/clipped`, path: '/ns/clipped', plain: `${server.origin}/ns/clipped.plain.html` } });
      const result = await runSanity({ dir: join(clippedRoot, 'stardust'), slug: 'home', preview: previewOf(clippedRoot), reskinPage: reskin });
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.exit, 1);
      assert.deepEqual(fails(result), ['clip-probe@1440']);
      const clip = pick(result.rows, 'clip-probe', 1440);
      assert.ok(Number(clip.value) >= 1, clip.value);
      assert.match(clip.detail, /TEXT (CLIPPED|HIDDEN) "first line of the note/);
      assert.equal(pick(result.rows, 'content-presence', 1440).status, 'PASS', 'no heading or link was lost: the clip is what this row sees');
      assert.ok(sanityLines(result).includes(`  clip-probe ${clip.value} > 0 @1440`));
    } finally { await server.close(); }
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
