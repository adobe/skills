#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-inherited.test.mjs — A5 of the deployed leg, `deployed-gate inherited`: deploy's
// delivered-page gates run on the preview. The checks that need no browser come first (the `.plain.html` asserts, the
// instrument lookup in both layouts, the CLI's setup errors), then runInherited against stand-ins for ai-readability and
// qa-gate and the fake preview of fixtures/deployed/ (what the instruments are called with, the rows, the exit mapping,
// the site token), then the CLI in the project-copy layout, then the real ai-readability and qa-gate (a Chromium page load each: slow).
// The browser part needs playwright and prints a skip line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';
import { main } from '../deployed-gate.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { deployTools, inheritedLines, plainAsserts, runInherited } from '../deployed/inherited.mjs';
import { fixturePath, startPreviewServer, startSourceServer, watchRequests } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const DEPLOY_SCRIPTS = join(SCRIPTS, '..', '..', 'deploy', 'scripts');
const PLAIN = readFileSync(fixturePath('home.plain.html'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-inherited-'));
const SECRET = 'hlxtok-0123456789abcdef';
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', DEPLOYED_GATE_SITE_TOKEN: '', ...env } });
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
const inherited = (root, extra = [], opts = {}) => run(['inherited', '--page', 'home', ...extra], { cwd: root, ...opts });
const writeSchema = (root) => { mkdirSync(join(root, 'stardust', 'eds-schema'), { recursive: true }); writeFileSync(join(root, 'stardust', 'eds-schema', 'home.json'), '{"sections":[]}\n'); };
const writeDesign = (root) => { mkdirSync(outOf(root), { recursive: true }); writeFileSync(join(outOf(root), 'design.json'), '{}\n'); };

// The home fixture's page and authored form, the authored form with `pairs` of [from, to] replaced → the page's path.
const variant = (name, ...pairs) => {
  const file = join(scratch, `${name}.html`);
  copyFileSync(fixturePath('home.html'), file);
  let plain = PLAIN;
  for (const [from, to] of pairs) {
    assert.ok(plain.includes(from), `home.plain.html has ${from}`);
    plain = plain.replace(from, () => to);
  }
  writeFileSync(join(scratch, `${name}.plain.html`), plain);
  return file;
};

// ---- stand-ins for ai-readability and qa-gate ------------------------------------------------------------------

const NAMES = { readability: 'ai-readability.mjs', qa: 'qa-gate.mjs' };
const readability = (score, { path = '/ns/home', ...rest } = {}) => ({
  exit: score < 98 ? 1 : 0,
  json: {
    origin: 'x', min: 98, pages: [{
      path,
      strict: { score: score - 4 },
      code: { score },
      servedGap: { main: 60, chrome: 0, renderedMain: 400 },
      blocks: [{ block: 'cards', words: 120, servedGap: 45 }, { block: 'hero', words: 80, servedGap: 15 }, { block: 'header', words: 0, servedGap: 0 }],
    }],
  },
  ...rest,
});
const QA_PASS = { stdout: '  ✓ runtime booted\n  ⚠ wide-2560: block cards content spans 1500px\nQA GATE: PASS — 12 ok, 1 warn, 0 fail\n' };
const DEFAULTS = { readability: readability(99), qa: QA_PASS };

// Each stand-in logs { tool, argv, token } to calls.jsonl, writes C.json to the file after --json and prints and exits as `c` says.
const stubSource = (tool, c, calls) => `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const C = ${JSON.stringify(c)};
const argv = process.argv.slice(2);
const flag = (f) => argv[argv.indexOf(f) + 1];
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, argv, token: process.env.DEPLOYED_GATE_SITE_TOKEN ?? null }) + '\\n');
const exit = C.exit ?? 0;
if (C.json !== undefined) {
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

const brief = (rows) => rows.map(({ check: c, value, bar, status }) => ({ check: c, value, bar, status }));
const pick = (rows, c) => rows.find((r) => r.check === c);
const BY_DEPLOY = ['localize-links --check', 'davids-model-lint', 'block-roundtrip --ew'];
const BY_DEPLOY_BAR = 'run by deploy before the DA push';

// One runInherited against a fake preview serving `pages` (token: it demands it; record: preview.json's extra fields, or a
// function of the origin); → { result | error, stub, root, requests, origin }: no throw.
const scenario = async (name, { cfg = {}, record = {}, schema = true, design = true, auth = null, token = null, pages, env = process.env } = {}) => {
  const server = await startPreviewServer({ token, pages });
  try {
    const root = project(name, { origin: server.origin, record: typeof record === 'function' ? record(server.origin) : record });
    if (schema) writeSchema(root);
    if (design) writeDesign(root);
    const stub = stubTools(name, cfg);
    const got = await attempt(() => runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), auth, tools: stub.tools, env }));
    return { result: got.value, error: got.error, stub, root, requests: server.requests, origin: server.origin };
  } finally { await server.close(); }
};

// ---- no browser ------------------------------------------------------------------------------------------------

// A server that answers every request with `status` and records them: { origin, requests, close }.
const statusServer = (status) => new Promise((resolve) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, headers: req.headers });
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end('x');
  });
  server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((done) => { server.close(done); server.closeAllConnections(); }),
  }));
});

await check('plainAsserts: the fixture passes; two <h1>, none, about:error, an /img/ src and no top-level <div> are each a problem naming it', () => {
  assert.deepEqual(plainAsserts(PLAIN), []);
  assert.deepEqual(plainAsserts(PLAIN.replace('<p>A calm', '<h1 class="b">Again</h1><p>A calm')), ['2 <h1>']);
  assert.deepEqual(plainAsserts(PLAIN.replace(/<h1[^>]*>.*?<\/h1>/, '')), ['0 <h1>']);
  assert.deepEqual(plainAsserts(PLAIN.replace('./media_5f2c0a9d4b7e1a63.png?width=750&#x26;format=png&#x26;optimize=medium', 'about:error')), ['about:error']);
  const slash = plainAsserts(PLAIN.replace('./media_5f2c0a9d4b7e1a63.png?width=750&#x26;format=png&#x26;optimize=medium', '/img/x.png'));
  assert.equal(slash.length, 1);
  assert.match(slash[0], /\/img\//);
  assert.match(slash[0], /\/img\/x\.png/);
  for (const quoted of ["src='/img/y.png'", 'src=/img/z.png', 'SRC = "/img/w.png"']) {
    const got = plainAsserts(`<div><h1>t</h1><img ${quoted}></div>`);
    assert.equal(got.length, 1, quoted);
    assert.match(got[0], /\/img\//, quoted);
  }
  const many = plainAsserts('<div><h1>t</h1><img src="/img/a.png"><img src="/img/b.png"><img src="/img/c.png"><img src="/img/d.png"></div>');
  assert.equal(many.length, 1);
  assert.match(many[0], /^4 \/img\/ srcs: \/img\/a\.png, \/img\/b\.png, \/img\/c\.png/);
  assert.deepEqual(plainAsserts('<body><header></header><main><p>x</p><h1>t</h1></main></body>'), ['no top-level <div>']);
  assert.deepEqual(plainAsserts('<main><section><div><h1>t</h1></div></section></main>'), ['no top-level <div>'], 'a div inside another element is not top-level');
  assert.deepEqual(plainAsserts(''), ['0 <h1>', 'no top-level <div>']);
  assert.deepEqual(plainAsserts('<div><h1>t</h1></div><div><p>b</p></div>'), [], 'a bare run of sections, as EDS serves them, is fine');
  assert.deepEqual(plainAsserts('<div><h1>t</h1><br><img src="./media_a.png"><img src="https://cdn.test/img/a.png"><p>see /img/ and a data-src="/img/x.png"</p></div>'), [], 'only a src that starts with /img/ counts');
  assert.deepEqual(plainAsserts('<!-- <h1>x</h1> src="/img/a.png" --><script>var h = "<h1>"; var s = \'src="/img/b.png"\';</script><style>h1 { }</style><div><h1>t</h1></div>'), [], 'comments, scripts and styles are not read');
});

await check('plainAsserts reads real tags only: <h1> and /img/ in attribute text, plain text or a script do not count; <H1> does; srcset candidates, poster and a src with leading spaces do', () => {
  const page = (body) => `<div>${body}</div>`;
  assert.deepEqual(plainAsserts(page('<h1>t</h1><img alt="use <h1> here" src="./a.png">')), [], '<h1> in a double-quoted attribute');
  assert.deepEqual(plainAsserts(page("<h1>t</h1><a title='<h1>'>x</a>")), [], '<h1> in a single-quoted attribute');
  assert.deepEqual(plainAsserts(page('<h1 title="a>b">t</h1>')), [], 'a > inside a quoted attribute does not end the tag');
  assert.deepEqual(plainAsserts(page('<a title="<h1>">x</a><a title=\'<h1>\'>y</a>')), ['0 <h1>'], 'attribute text is the only <h1>: none');
  assert.deepEqual(plainAsserts(page('<H1>t</H1>')), [], '<H1> is an <h1>');
  assert.deepEqual(plainAsserts(page('<H1>a</H1><h1 class="b">b</h1>')), ['2 <h1>']);
  assert.deepEqual(plainAsserts(page('<h1>t</h1><h10>x</h10><h1-x>y</h1-x>')), [], 'h10 and h1-x are not <h1>');
  assert.deepEqual(plainAsserts('<script>var a="<!--";</script><div><h1>t</h1></div><!-- c -->'), [], 'a "<!--" in a script does not open a comment that eats the page');
  assert.deepEqual(plainAsserts('<!-- <script> --><div><h1>t</h1></div><script>var s = 1;</script>'), [], 'a "<script>" in a comment does not open a script');
  assert.deepEqual(plainAsserts('<style>a::after { content: "<!--"; }</style><div><h1>t</h1></div><!-- c -->'), []);
  assert.deepEqual(plainAsserts(page('<h1>t</h1><p>src="/img/a.png" and srcset="/img/b.png 2x" and poster="/img/c.png"</p>')), [], '/img/ in text is not a source');
  assert.deepEqual(plainAsserts(page('<h1>t</h1><textarea>&lt;img src="/img/a.png"&gt;</textarea><code>&lt;img src="/img/a.png"&gt;</code>')), []);

  const imgs = (body) => plainAsserts(page(`<h1>t</h1>${body}`));
  assert.deepEqual(imgs('<img src="./a.png" srcset="/img/a.png 1x, /img/b.png 2x">'), ['2 /img/ srcs: /img/a.png, /img/b.png'], 'every srcset candidate');
  assert.deepEqual(imgs('<picture><source srcset="./a.webp 1x,/img/b.webp 2x" type="image/webp"><img src="./a.png"></picture>'), ['1 /img/ src: /img/b.webp'], 'a candidate with no space after the comma');
  assert.deepEqual(imgs('<img srcset="  /img/a.png  100w ,\n /img/b.png 200w">'), ['2 /img/ srcs: /img/a.png, /img/b.png'], 'spaces and a newline around candidates');
  assert.deepEqual(imgs('<img srcset="./a.png?x=1,2 1x, ./b.png 2x">'), [], 'a comma inside a URL is not a candidate');
  assert.deepEqual(imgs('<video poster="/img/p.png" src="./v.mp4"></video>'), ['1 /img/ src: /img/p.png'], 'poster');
  assert.deepEqual(imgs('<img src=" /img/x.png">'), ['1 /img/ src: /img/x.png'], 'a value with leading spaces');
  assert.deepEqual(imgs('<img src="\n\t/img/x.png ">'), ['1 /img/ src: /img/x.png'], 'a value with a newline and a tab');
  assert.deepEqual(imgs("<IMG SRC = '/img/y.png' POSTER=/img/z.png>"), ['2 /img/ srcs: /img/y.png, /img/z.png'], 'upper-case names, spaces around =, unquoted');
  assert.deepEqual(imgs('<img data-src="/img/a.png" data-srcset="/img/b.png 1x" src="./c.png">'), [], 'data-* attributes are not sources');
  assert.deepEqual(imgs('<img src="/img/a.png"><img alt="/img/b.png" src="./c.png" title=\'src="/img/d.png"\'>'), ['1 /img/ src: /img/a.png'], 'attribute text that looks like a source is not one');
});

await check('deployTools finds ai-readability and qa-gate in the plugin tree and in the project copy, and names what is missing', () => {
  const real = deployTools();
  assert.deepEqual(Object.keys(real).sort(), ['qa', 'readability']);
  for (const [tool, file] of Object.entries(NAMES)) {
    assert.equal(real[tool], join(DEPLOY_SCRIPTS, file));
    assert.ok(existsSync(real[tool]), `${file} exists in the plugin tree`);
  }
  const copy = join(scratch, 'layout');
  mkdirSync(join(copy, 'reskin', 'deployed'), { recursive: true });
  stubTools('layout-stubs', {}, join(copy, 'deploy'));
  const found = deployTools(join(copy, 'reskin', 'deployed'));
  for (const [tool, file] of Object.entries(NAMES)) assert.equal(found[tool], join(copy, 'deploy', file));
  const bare = join(scratch, 'layout-bare');
  mkdirSync(join(bare, 'reskin', 'deployed'), { recursive: true });
  mkdirSync(join(bare, 'deploy'));
  writeFileSync(join(bare, 'deploy', 'ai-readability.mjs'), '');
  assert.throws(() => deployTools(join(bare, 'reskin', 'deployed')), (e) => e instanceof UsageError && e.code === 2
    && /qa-gate\.mjs/.test(e.message) && !/ai-readability/.test(e.message) && /stardust\/scripts\/deploy/.test(e.message), 'the missing file is named');
});

await check('--help documents inherited; its usage errors exit 2 and write nothing; the record is needed (absent, problems), a skipped leg is "not run: skipped"', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  const r = await run(['--help'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /deployed-gate\.mjs inherited --page <slug> \[--auth-header <value> \| --token-env <NAME>\] \[--dir stardust\]/);
  for (const re of [/\.plain\.html/, /about:error/, /\/img\//, /ai-readability/, /98/, /qa-gate/, /eds-schema/, /Step 2b/, /design\.json/, /protected preview/, /by deploy/, /localize-links --check/, /davids-model-lint/, /block-roundtrip --ew/, /inherited\.json/, /not run: skipped/]) assert.match(r.stdout, re);
  const help = r.stdout.replace(/\s+/g, ' ');
  assert.ok(help.includes('ai-readability and qa-gate get the token by --token-env DEPLOYED_GATE_SITE_TOKEN and --auth-origin <preview origin> (the value by environment, never argv), for that origin only'), 'the help says how a protected preview is measured');
  assert.ok(!/n\/a: protected preview|sends its header to every origin/.test(help), 'a protected preview is no longer n/a');
  assert.match(r.stdout, /--auth-header[^]*?preview\s+origin only[^]*?inherited to its \.plain\.html request and to\s+ai-readability and qa-gate/, 'the --auth-header paragraph says what inherited does with the header');
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');

  const root = project('inherited-usage', { preview: false });
  for (const [args, re] of [
    [['inherited'], /inherited needs --page <slug>/],
    [['inherited', '--page', '../x'], /--page must be a slug/],
    [['inherited', '--page', 'home', '--org', 'o'], /unknown flag --org for inherited/],
    [['inherited', '--page', 'home', '--reskin', 'p.html'], /unknown flag --reskin for inherited/],
    [['inherited', '--page', 'home', 'stray'], /unexpected argument "stray"/],
    [['inherited', '--page'], /--page needs a value/],
    [['inherited', '--page', 'home', '--auth-header', '--dir', 'x'], /--auth-header needs a value/],
    [['inherited', '--page', 'home', '--token-env', '  '], /--token-env needs a value/],
  ]) {
    const got = await run(args, { cwd: root });
    assert.equal(got.status, 2, `${args.join(' ')}: ${got.all}`);
    assert.match(got.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');

  const none = await inherited(root);
  assert.equal(none.status, 2, none.all);
  assert.match(none.stderr, /deployed-gate preview/);
  const problems = project('inherited-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  const refused = await inherited(problems);
  assert.equal(refused.status, 2, refused.all);
  assert.match(refused.stderr, /preview has problems: run deployed-gate preview again/);
  const skipped = project('inherited-skipped', { record: { skipped: true, reason: 'not an aem-boilerplate project: missing head.html at the project root', url: null, origin: null, plain: null } });
  const idle = await inherited(skipped);
  assert.equal(idle.status, 0, idle.all);
  assert.equal(idle.stdout.trim(), 'not run: skipped');
  assert.ok(!existsSync(join(outOf(skipped), 'inherited.json')), 'nothing written');
});

await check('main dispatches inherited to a replaceable step and returns its exit code; --help runs before it', async () => {
  const lines = [];
  const code = await main(['inherited', '--page', 'home'], { log: (m) => lines.push(m), steps: { inherited: async ({ opts, log }) => { log(`stub ${opts.page}`); return 5; } } });
  assert.equal(code, 5);
  assert.deepEqual(lines, ['stub home']);
  assert.equal(await main(['inherited', '--help'], { log: () => {}, steps: { inherited: async () => { throw new Error('must not run'); } } }), 0);
});

// ---- runInherited against stand-in instruments and the fake preview --------------------------------------------

await check('a clean preview: .plain.html, ai-readability and qa-gate pass, deploy\'s three gates are "by deploy"; each instrument is called as shipped, with no site token; inherited.json says so', async () => {
  const { result, stub, root, requests, origin, error } = await scenario('pass');
  assert.ifError(error);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.exit, 0);
  assert.deepEqual(brief(result.rows), [
    { check: '.plain.html', value: '200, 1 <h1>', bar: '200, one <h1>, no about:error, no /img/ src', status: 'PASS' },
    { check: 'ai-readability', value: '99', bar: '≥ 98', status: 'PASS' },
    { check: 'qa-gate', value: '12 ok, 1 warn, 0 fail', bar: '0 fail', status: 'PASS' },
    ...BY_DEPLOY.map((c) => ({ check: c, value: 'by deploy', bar: BY_DEPLOY_BAR, status: 'by deploy' })),
  ]);
  for (const row of result.rows) assert.ok(!('width' in row) && !('artifact' in row), `${row.check}: the record's row shape`);
  assert.ok(result.rows.every((r) => !('detail' in r)), 'a passing row has no detail');
  const [ai, qa, ...rest] = stub.calls();
  assert.equal(rest.length, 0, 'each instrument ran once');
  assert.equal(ai.tool, 'readability');
  assert.deepEqual(ai.argv, ['--origin', origin, '/ns/home', '--min', '98', '--json', join(outOf(root), 'inherited', 'ai-readability.json')]);
  assert.equal(ai.token, null);
  assert.equal(qa.tool, 'qa');
  assert.deepEqual(qa.argv, [`${origin}/ns/home`, '--schema', join(root, 'stardust', 'eds-schema', 'home.json'), '--design', join(outOf(root), 'design.json')]);
  assert.equal(qa.token, null);
  assert.deepEqual(requests.map((q) => `${q.method} ${q.path}`), ['GET /ns/home.plain.html']);
  assert.equal(requests[0].headers.authorization, undefined, 'a public preview is sent no Authorization header');
  assert.deepEqual(readJson(join(outOf(root), 'inherited.json')), { verdict: 'PASS', rows: result.rows });
  assert.equal(readFileSync(join(outOf(root), 'inherited', 'qa-gate.txt'), 'utf8'), QA_PASS.stdout, 'qa-gate\'s report is kept');
  assert.equal(readJson(join(outOf(root), 'inherited', 'ai-readability.json')).pages[0].code.score, 99);
  assert.deepEqual(inheritedLines(result), ['PASS inherited', 'by deploy (localize-links --check, davids-model-lint, block-roundtrip --ew)']);
});

await check('ai-readability below 98 is a FAIL naming the score and the blocks the served HTML lacks; the other rows are unchanged', async () => {
  const { result, error } = await scenario('readability-97', { cfg: { readability: readability(97) } });
  assert.ifError(error);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.exit, 1);
  assert.deepEqual(brief(result.rows).filter((r) => r.status !== 'by deploy').map((r) => `${r.check} ${r.value} ${r.status}`), ['.plain.html 200, 1 <h1> PASS', 'ai-readability 97 FAIL', 'qa-gate 12 ok, 1 warn, 0 fail PASS']);
  assert.equal(pick(result.rows, 'ai-readability').detail, 'strict 93%\ncards: 45 of 120 words not in the served HTML\nhero: 15 of 80 words not in the served HTML');
  assert.deepEqual(inheritedLines(result), [
    'FAIL inherited',
    '  ai-readability 97 < 98',
    '    strict 93%',
    '    cards: 45 of 120 words not in the served HTML',
    '    hero: 15 of 80 words not in the served HTML',
    'by deploy (localize-links --check, davids-model-lint, block-roundtrip --ew)',
  ]);
  const edge = await scenario('readability-98', { cfg: { readability: readability(98) } });
  assert.equal(edge.result.verdict, 'PASS', '98 is the bar');
});

await check('qa-gate: without eds-schema/home.json "n/a: run deploy Step 2b" (and it is not run); without design.json "n/a: run deployed-gate parity first (design.json)"; neither is a FAIL', async () => {
  const noSchema = await scenario('no-schema', { schema: false });
  assert.ifError(noSchema.error);
  assert.equal(noSchema.result.verdict, 'PASS');
  assert.deepEqual(pick(noSchema.result.rows, 'qa-gate'), { check: 'qa-gate', value: 'n/a: run deploy Step 2b', bar: '0 fail', status: 'n/a' });
  assert.deepEqual(noSchema.stub.calls().map((c) => c.tool), ['readability'], 'qa-gate did not run');
  assert.ok(!existsSync(join(outOf(noSchema.root), 'inherited', 'qa-gate.txt')));
  assert.ok(inheritedLines(noSchema.result).includes('n/a: run deploy Step 2b (qa-gate)'));

  const noDesign = await scenario('no-design', { design: false });
  assert.equal(noDesign.result.verdict, 'PASS');
  assert.equal(pick(noDesign.result.rows, 'qa-gate').value, 'n/a: run deployed-gate parity first (design.json)');
  assert.deepEqual(noDesign.stub.calls().map((c) => c.tool), ['readability']);
  assert.ok(inheritedLines(noDesign.result).includes('n/a: run deployed-gate parity first (design.json) (qa-gate)'));

  const neither = await scenario('no-schema-no-design', { schema: false, design: false });
  assert.equal(pick(neither.result.rows, 'qa-gate').value, 'n/a: run deploy Step 2b', 'the schema is named first');
});

await check('qa-gate failing: FAIL with its ✗ lines; no verdict (exit 2, or a crash with no QA GATE line): ERROR (exit N), verdict ERROR, exit 124, and ERROR outranks a FAIL', async () => {
  const failing = { exit: 1, stdout: '  ✓ runtime booted\n  ✗ exactly one <h1> — found 2\n  ✗ content cap 1200px holds at 2560 (#124) — build cap 900px (main)\nQA GATE: FAIL — 1 ok, 0 warn, 2 fail\n' };
  const bad = await scenario('qa-fail', { cfg: { qa: failing } });
  assert.ifError(bad.error);
  assert.equal(bad.result.verdict, 'FAIL');
  assert.equal(bad.result.exit, 1);
  const row = pick(bad.result.rows, 'qa-gate');
  assert.deepEqual({ status: row.status, value: row.value, detail: row.detail }, { status: 'FAIL', value: '1 ok, 0 warn, 2 fail', detail: 'exactly one <h1> — found 2\ncontent cap 1200px holds at 2560 (#124) — build cap 900px (main)' });
  assert.deepEqual(inheritedLines(bad.result).slice(0, 4), ['FAIL inherited', '  qa-gate: 1 ok, 0 warn, 2 fail', '    exactly one <h1> — found 2', '    content cap 1200px holds at 2560 (#124) — build cap 900px (main)']);
  assert.match(readFileSync(join(outOf(bad.root), 'inherited', 'qa-gate.txt'), 'utf8'), /QA GATE: FAIL/);

  const usage = await scenario('qa-usage', { cfg: { qa: { exit: 2, stderr: 'usage: qa-gate.mjs <harnessURL>\n' } } });
  assert.equal(pick(usage.result.rows, 'qa-gate').value, 'ERROR (exit 2)');
  assert.equal(pick(usage.result.rows, 'qa-gate').detail, 'usage: qa-gate.mjs <harnessURL>');
  assert.deepEqual([usage.result.verdict, usage.result.exit], ['ERROR', 124]);
  const crash = await scenario('qa-crash', { cfg: { qa: { exit: 1, stdout: '', stderr: 'page.goto: net::ERR_CONNECTION_REFUSED\n    at …\n' } } });
  assert.deepEqual([pick(crash.result.rows, 'qa-gate').status, pick(crash.result.rows, 'qa-gate').value, crash.result.verdict, crash.result.exit], ['ERROR', 'ERROR (exit 1)', 'ERROR', 124]);
  assert.equal(pick(crash.result.rows, 'qa-gate').detail, 'page.goto: net::ERR_CONNECTION_REFUSED');

  const both = await scenario('qa-error-readability-fail', { cfg: { qa: { exit: 2, stderr: 'x\n' }, readability: readability(50) } });
  assert.deepEqual([both.result.verdict, both.result.exit], ['ERROR', 124]);
  const lines = inheritedLines(both.result);
  assert.equal(lines[0], 'ERROR (exit 124) inherited: 1 check gave no verdict');
  assert.equal(lines[1], '  qa-gate: ERROR (exit 2)');
  assert.ok(lines.includes('FAIL inherited') && lines.includes('  ai-readability 50 < 98'), lines.join('\n'));
  assert.equal(readJson(join(outOf(both.root), 'inherited.json')).verdict, 'ERROR');
});

await check('ai-readability with no verdict: exit 2, exit 1 on a page error, an unreadable or missing report, no score — each "ERROR (exit N)" (exit 124), never a PASS', async () => {
  const gave = async (name, cfg) => (await scenario(name, { cfg: { readability: cfg } }));
  const exit2 = await gave('ai-exit-2', { exit: 2, stderr: 'usage: ai-readability.mjs --origin <published origin>\n', json: undefined });
  assert.deepEqual(brief(exit2.result.rows).slice(1, 2), [{ check: 'ai-readability', value: 'ERROR (exit 2)', bar: '≥ 98', status: 'ERROR' }]);
  assert.equal(pick(exit2.result.rows, 'ai-readability').detail, 'usage: ai-readability.mjs --origin <published origin>');
  assert.deepEqual([exit2.result.verdict, exit2.result.exit], ['ERROR', 124]);
  assert.equal(inheritedLines(exit2.result)[0], 'ERROR (exit 124) inherited: 1 check gave no verdict');

  const pageError = await gave('ai-page-error', { exit: 1, json: { pages: [{ path: '/ns/home', error: 'served fetch HTTP 404' }] } });
  assert.equal(pick(pageError.result.rows, 'ai-readability').value, 'ERROR (exit 1)');
  assert.equal(pick(pageError.result.rows, 'ai-readability').detail, '/ns/home: served fetch HTTP 404');
  const crashed = await gave('ai-crash', { exit: 1, stderr: 'Error: playwright not found: install it in the project (npm i -D playwright)\n    at loadPlaywright\n', json: undefined });
  assert.equal(pick(crashed.result.rows, 'ai-readability').value, 'ERROR (exit 1)', 'exit 1 with no report is a crash, not a score under the bar');
  assert.equal(pick(crashed.result.rows, 'ai-readability').detail, 'Error: playwright not found: install it in the project (npm i -D playwright)');
  const noReport = await gave('ai-no-report', { exit: 0, json: undefined });
  assert.equal(pick(noReport.result.rows, 'ai-readability').value, 'ERROR (exit 0)');
  assert.equal(pick(noReport.result.rows, 'ai-readability').detail, 'ai-readability exited 0 without a score');
  const garbled = await gave('ai-garbled', { exit: 0, json: '{"pages": [' });
  assert.equal(pick(garbled.result.rows, 'ai-readability').status, 'ERROR');
  const noScore = await gave('ai-no-score', { exit: 0, json: { pages: [{ path: '/ns/home', code: {} }] } });
  assert.equal(pick(noScore.result.rows, 'ai-readability').status, 'ERROR');
  const other = await gave('ai-exit-4', { exit: 4, json: readability(99).json });
  assert.equal(pick(other.result.rows, 'ai-readability').value, 'ERROR (exit 4)', 'an exit other than 0 and 1 is no verdict, report or not');
  for (const s of [exit2, pageError, crashed, noReport, garbled, noScore, other]) assert.equal(s.result.exit, 124);
});

await check('.plain.html: a second <h1>, about:error and an /img/ src are a FAIL with each problem named; HTTP 404 is a FAIL; no answer is ERROR (exit 124); 401 is a setup error', async () => {
  const two = variant('two-h1', ['<p>A calm', '<h1>Again</h1><p>A calm']);
  const found = await scenario('two-h1', { pages: { '/ns/home': two } });
  assert.ifError(found.error);
  assert.deepEqual([found.result.verdict, found.result.exit], ['FAIL', 1]);
  assert.deepEqual(brief(found.result.rows).slice(0, 1), [{ check: '.plain.html', value: '2 <h1>', bar: '200, one <h1>, no about:error, no /img/ src', status: 'FAIL' }]);
  assert.equal(inheritedLines(found.result)[1], '  .plain.html: 2 <h1>');

  const broken = variant('broken', ['<p>A calm', '<h1>Again</h1><p>A calm'], ['./media_5f2c0a9d4b7e1a63.png?width=750&#x26;format=png&#x26;optimize=medium', 'about:error'], ['<p>New</p>', '<p><img src="/img/x.png"></p>']);
  const many = await scenario('broken', { pages: { '/ns/home': broken } });
  assert.equal(pick(many.result.rows, '.plain.html').value, '2 <h1>; about:error; 1 /img/ src: /img/x.png');
  assert.deepEqual(many.stub.calls().map((c) => c.tool), ['readability', 'qa'], 'the other gates still run, so one run shows every finding');

  const gone = await scenario('plain-404', { record: (origin) => ({ plain: `${origin}/ns/gone.plain.html` }) });
  assert.ifError(gone.error);
  assert.deepEqual([gone.result.verdict, gone.result.exit], ['FAIL', 1]);
  assert.deepEqual(pick(gone.result.rows, '.plain.html'), { check: '.plain.html', value: 'HTTP 404', bar: '200, one <h1>, no about:error, no /img/ src', status: 'FAIL' });
  assert.equal(inheritedLines(gone.result)[1], '  .plain.html: HTTP 404');
  assert.deepEqual(gone.stub.calls().map((c) => c.tool), ['readability', 'qa']);

  const closed = await startPreviewServer();
  await closed.close();
  const dead = project('plain-dead', { origin: closed.origin });
  const stub = stubTools('plain-dead');
  const silent = await attempt(() => runInherited({ dir: join(dead, 'stardust'), slug: 'home', preview: previewOf(dead), tools: stub.tools }));
  assert.ifError(silent.error);
  const row = pick(silent.value.rows, '.plain.html');
  assert.deepEqual([row.status, row.value, row.detail], ['ERROR', 'ERROR (exit 124)', 'no response (ECONNREFUSED)']);
  assert.deepEqual([silent.value.verdict, silent.value.exit], ['ERROR', 124]);

  const guarded = await scenario('plain-401', { token: SECRET });
  assert.ok(guarded.error instanceof UsageError && guarded.error.code === 2, String(guarded.error));
  assert.match(guarded.error.message, /ns\/home\.plain\.html answered HTTP 401/);
  assert.match(guarded.error.message, /run deployed-gate preview again with --auth-header or --token-env/);
  assert.deepEqual(guarded.stub.calls(), [], 'no instrument ran');
  assert.ok(!existsSync(join(outOf(guarded.root), 'inherited.json')), 'no record');
});

await check('.plain.html answering 5xx or 429 is no verdict: ERROR (exit 124), re-run once, the other gates still run; 404 and a redirect stay a FAIL', async () => {
  for (const status of [500, 502, 503, 504, 429]) {
    const server = await statusServer(status);
    try {
      const root = project(`plain-${status}`, { origin: server.origin });
      writeSchema(root);
      writeDesign(root);
      const stub = stubTools(`plain-${status}`);
      const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: stub.tools });
      const row = pick(result.rows, '.plain.html');
      assert.deepEqual([row.status, row.value, row.detail], ['ERROR', 'ERROR (exit 124)', `HTTP ${status}`], String(status));
      assert.deepEqual([result.verdict, result.exit], ['ERROR', 124], String(status));
      assert.deepEqual(inheritedLines(result).slice(0, 3), ['ERROR (exit 124) inherited: 1 check gave no verdict', '  .plain.html: ERROR (exit 124)', `    HTTP ${status}`]);
      assert.deepEqual(stub.calls().map((c) => c.tool), ['readability', 'qa'], 'the other gates ran');
      assert.equal(readJson(join(outOf(root), 'inherited.json')).verdict, 'ERROR');
    } finally { await server.close(); }
  }
  for (const status of [404, 410, 301]) {
    const server = await statusServer(status);
    try {
      const root = project(`plain-${status}`, { origin: server.origin });
      const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: stubTools(`plain-${status}`).tools });
      const row = pick(result.rows, '.plain.html');
      assert.deepEqual([row.status, row.value], ['FAIL', `HTTP ${status}`], String(status));
      assert.deepEqual([result.verdict, result.exit], ['FAIL', 1], String(status));
    } finally { await server.close(); }
  }
});

await check('the site token goes only to the preview origin: a preview.json whose plain URL is on another origin is exit 2 before any request, for a protected or a public preview', async () => {
  const elsewhere = await startPreviewServer();
  const home = await startPreviewServer({ token: SECRET });
  try {
    for (const [name, record, auth] of [
      ['plain-off-origin-protected', { auth: true, plain: `${elsewhere.origin}/ns/home.plain.html` }, `token ${SECRET}`],
      ['plain-off-origin-public', { plain: `${elsewhere.origin}/ns/home.plain.html` }, null],
      ['plain-other-port', { auth: true, plain: `http://127.0.0.1:${Number(new URL(home.origin).port) + 1}/ns/home.plain.html` }, `token ${SECRET}`],
      ['plain-other-scheme', { auth: true, plain: `${home.origin.replace('http:', 'https:')}/ns/home.plain.html` }, `token ${SECRET}`],
      ['plain-not-a-url', { auth: true, plain: '/ns/home.plain.html' }, `token ${SECRET}`],
    ]) {
      const root = project(name, { origin: home.origin, record });
      const stub = stubTools(name);
      const got = await attempt(() => runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), auth, tools: stub.tools }));
      assert.ok(got.error instanceof UsageError && got.error.code === 2, `${name}: ${got.error}`);
      assert.match(got.error.message, /preview\.json plain URL is not on the preview origin/, name);
      assert.ok(!got.error.message.includes(SECRET), `${name}: the token is not echoed`);
      assert.deepEqual(stub.calls(), [], `${name}: no instrument ran`);
      assert.ok(!existsSync(join(outOf(root), 'inherited.json')), `${name}: no record`);
    }
    assert.deepEqual(elsewhere.requests, [], 'the other origin was never asked');
    assert.deepEqual(home.requests, [], 'nor was the preview');
  } finally { await elsewhere.close(); await home.close(); }

  const server = await startPreviewServer({ token: SECRET });
  try {
    const root = project('plain-off-origin-cli', { origin: server.origin, record: { auth: true, plain: 'http://127.0.0.1:9/ns/home.plain.html' } });
    const cli = await inherited(root, ['--token-env', 'MY_SITE_TOKEN'], { env: { MY_SITE_TOKEN: SECRET } });
    assert.equal(cli.status, 2, cli.all);
    assert.match(cli.stderr, /preview\.json plain URL is not on the preview origin/);
    assert.ok(!cli.all.includes(SECRET));
    assert.deepEqual(server.requests, []);
  } finally { await server.close(); }
});

await check('a stale record and artifacts of an earlier run are removed before anything is checked', async () => {
  const root = project('stale');
  const out = outOf(root);
  mkdirSync(join(out, 'inherited'), { recursive: true });
  writeFileSync(join(out, 'inherited.json'), '{"verdict":"PASS","rows":[]}\n');
  writeFileSync(join(out, 'inherited', 'qa-gate.txt'), 'QA GATE: PASS — old\n');
  const gone = stubTools('stale-stubs');
  rmSync(gone.tools.qa);
  const refused = await attempt(() => runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: gone.tools }));
  assert.ok(refused.error instanceof UsageError && /qa-gate\.mjs/.test(refused.error.message), String(refused.error));
  assert.ok(!existsSync(join(out, 'inherited.json')) && !existsSync(join(out, 'inherited')), 'no stale verdict or artifact survives a setup error');
  for (const key of ['url', 'origin', 'path', 'plain']) {
    const record = { ...previewOf(root), [key]: undefined };
    const got = await attempt(() => runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: record, tools: stubTools('stale-ok').tools }));
    assert.ok(got.error instanceof UsageError && new RegExp(`has no ${key}`).test(got.error.message), `${key}: ${got.error}`);
  }
});

// ---- a protected preview ---------------------------------------------------------------------------------------

const TOKEN_FLAGS = ['--token-env', 'DEPLOYED_GATE_SITE_TOKEN'];

await check('a protected preview is measured: .plain.html carries the header, ai-readability and qa-gate run with the token by environment and --token-env (never argv), aimed at the preview origin; the secret appears in no row, record, line or argument', async () => {
  const { result, stub, requests, root, origin, error } = await scenario('protected', { token: SECRET, record: { auth: true }, auth: `token ${SECRET}` });
  assert.ifError(error);
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(brief(result.rows).slice(0, 3).map((r) => `${r.check}: ${r.value} (${r.status})`), ['.plain.html: 200, 1 <h1> (PASS)', 'ai-readability: 99 (PASS)', 'qa-gate: 12 ok, 1 warn, 0 fail (PASS)']);
  assert.deepEqual(requests.map((q) => q.headers.authorization), [`token ${SECRET}`]);
  const [ai, qa, ...rest] = stub.calls();
  assert.equal(rest.length, 0, 'each instrument ran once');
  assert.deepEqual(ai.argv, ['--origin', origin, '/ns/home', '--min', '98', '--json', join(outOf(root), 'inherited', 'ai-readability.json'), ...TOKEN_FLAGS, '--auth-origin', origin]);
  assert.deepEqual(qa.argv, [`${origin}/ns/home`, '--schema', join(root, 'stardust', 'eds-schema', 'home.json'), '--design', join(outOf(root), 'design.json'), ...TOKEN_FLAGS, '--auth-origin', origin]);
  assert.deepEqual([ai.token, qa.token], [`token ${SECRET}`, `token ${SECRET}`], 'the token reaches each by environment');
  for (const c of stub.calls()) assert.ok(!c.argv.some((a) => a.includes(SECRET) || a === '--auth-header'), `${c.tool}: no token in argv`);
  const text = [readFileSync(join(outOf(root), 'inherited.json'), 'utf8'), readFileSync(join(outOf(root), 'inherited', 'qa-gate.txt'), 'utf8'), ...inheritedLines(result)].join('\n');
  assert.ok(!text.includes(SECRET), 'the secret is not recorded or printed');
  assert.deepEqual(inheritedLines(result), ['PASS inherited', 'by deploy (localize-links --check, davids-model-lint, block-roundtrip --ew)']);

  const failing = await scenario('protected-fail', { token: SECRET, record: { auth: true }, auth: `token ${SECRET}`, cfg: { readability: readability(50) } });
  assert.equal(failing.result.verdict, 'FAIL', 'a score of 50 on a protected preview is read, and a FAIL');
  assert.equal(pick(failing.result.rows, 'ai-readability').value, '50');

  const missing = await scenario('protected-no-token', { token: SECRET, record: { auth: true } });
  assert.ok(missing.error instanceof UsageError && missing.error.code === 2, String(missing.error));
  assert.match(missing.error.message, /^inherited needs the site token to read a protected preview\npreview\.json says the preview was reached with a site token: pass --auth-header or --token-env/);
  assert.deepEqual(missing.requests, [], 'nothing was requested without the token');
  assert.deepEqual(missing.stub.calls(), []);

  const wrong = await scenario('protected-wrong-token', { token: SECRET, record: { auth: true }, auth: 'token not-the-one' });
  assert.ok(wrong.error instanceof UsageError && /answered HTTP 401: the site token was not accepted/.test(wrong.error.message), String(wrong.error));
  assert.ok(!wrong.error.message.includes('not-the-one'), 'the offered token is not echoed');
  assert.deepEqual(wrong.stub.calls(), [], 'no instrument ran with a token the preview refused');
});

await check('an instrument that echoes the token has it redacted from its row and from the error of a bot challenge; no flag, no token: a SITE_TOKEN in the environment is never handed on', async () => {
  const leaky = await scenario('protected-leak', { token: SECRET, record: { auth: true }, auth: `token ${SECRET}`, cfg: { readability: { exit: 2, stderr: `request failed: token ${SECRET}\n`, json: undefined } } });
  assert.ifError(leaky.error);
  assert.deepEqual([pick(leaky.result.rows, 'ai-readability').status, pick(leaky.result.rows, 'ai-readability').detail], ['ERROR', 'request failed: [redacted]']);
  assert.ok(!readFileSync(join(outOf(leaky.root), 'inherited.json'), 'utf8').includes(SECRET));
  const challenged = await scenario('protected-challenge', { token: SECRET, record: { auth: true }, auth: `token ${SECRET}`, cfg: { qa: { exit: 3, stdout: '', stderr: `bot challenge for ${SECRET}\n` } } });
  assert.equal(challenged.error?.code, 3, String(challenged.error));
  assert.equal(challenged.error.message, 'bot challenge for [redacted]');

  const ambient = { ...process.env, SITE_TOKEN: 'ambient-secret', DEPLOYED_GATE_SITE_TOKEN: 'ambient-secret' };
  const unneeded = await scenario('public-with-token', { auth: `token ${SECRET}`, env: ambient });
  assert.ifError(unneeded.error);
  assert.equal(unneeded.result.verdict, 'PASS');
  assert.equal(unneeded.requests[0].headers.authorization, undefined);
  assert.deepEqual(unneeded.stub.calls().map((c) => [c.tool, c.token]), [['readability', null], ['qa', null]], 'a public preview is handed no token, and both instruments ran');
  for (const c of unneeded.stub.calls()) assert.ok(!c.argv.some((a) => a === '--token-env' || a === '--auth-origin'), `${c.tool}: no auth flag`);
});

await check('a non-"token" scheme is sent as given to .plain.html and to the instruments (by environment)', async () => {
  const open = await startPreviewServer();
  try {
    const root = project('bearer-open', { origin: open.origin, record: { auth: true } });
    writeSchema(root);
    writeDesign(root);
    const stub = stubTools('bearer-open');
    const got = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), auth: `bearer ${SECRET}`, tools: stub.tools });
    assert.equal(got.verdict, 'PASS');
    assert.equal(open.requests[0].headers.authorization, `bearer ${SECRET}`, '.plain.html is fetched with the header as given');
    assert.deepEqual(stub.calls().map((c) => c.token), [`bearer ${SECRET}`, `bearer ${SECRET}`]);
  } finally { await open.close(); }
});

// ---- the CLI in the project-copy layout ------------------------------------------------------------------------

await check('the project-copy layout: the CLI finds the instruments beside the reskin scripts; a score of 97 is FAIL inherited, no eds-schema/home.json reads "n/a: run deploy Step 2b", a row in error is exit 124, a missing instrument is exit 2', async () => {
  const copy = join(scratch, 'copy');
  cpSync(SCRIPTS, join(copy, 'reskin'), { recursive: true, filter: (src) => src !== join(SCRIPTS, 'test') });
  cpSync(join(SCRIPTS, '..', '..', 'diff', 'scripts'), join(copy, 'diff'), { recursive: true });
  const gate = join(copy, 'reskin', 'deployed-gate.mjs');
  const server = await startPreviewServer();
  try {
    const root = project('copy-proj', { origin: server.origin });
    const go = (name, cfg, extra = [], opts = {}) => {
      stubTools(name, cfg, join(copy, 'deploy'));
      return run(['inherited', '--page', 'home', ...extra], { cwd: root, script: gate, ...opts });
    };
    const low = await go('copy-97', { readability: readability(97) });
    assert.equal(low.status, 1, low.all);
    assert.equal(low.stdout.split('\n')[0], 'FAIL inherited');
    assert.ok(low.stdout.includes('  ai-readability 97 < 98'), low.stdout);
    assert.ok(low.stdout.includes('n/a: run deploy Step 2b (qa-gate)'), low.stdout);
    assert.ok(low.stdout.includes('by deploy (localize-links --check, davids-model-lint, block-roundtrip --ew)'), low.stdout);
    assert.equal(readJson(join(outOf(root), 'inherited.json')).verdict, 'FAIL');
    assert.equal(pick(readJson(join(outOf(root), 'inherited.json')).rows, 'qa-gate').value, 'n/a: run deploy Step 2b');

    const lost = await go('copy-124', { readability: { exit: 2, stderr: 'boom\n', json: undefined } });
    assert.equal(lost.status, 124, lost.all);
    assert.match(lost.stdout, /^ERROR \(exit 124\) inherited: 1 check gave no verdict$/m);
    assert.match(lost.stdout, /^ {2}ai-readability: ERROR \(exit 2\)$/m);

    writeSchema(root);
    writeDesign(root);
    const good = await go('copy-pass', {});
    assert.equal(good.status, 0, good.all);
    assert.equal(good.stdout.split('\n')[0], 'PASS inherited');
    assert.ok(!/n\/a/.test(good.stdout), 'the schema and the design are there: qa-gate ran');
    assert.equal(readJson(join(outOf(root), 'inherited.json')).verdict, 'PASS');

    rmSync(join(copy, 'deploy', 'qa-gate.mjs'));
    const missing = await run(['inherited', '--page', 'home'], { cwd: root, script: gate });
    assert.equal(missing.status, 2, missing.all);
    assert.match(missing.stderr, /qa-gate\.mjs not found/);
  } finally { await server.close(); }

  const guarded = await startPreviewServer({ token: SECRET });
  try {
    const root = project('copy-protected', { origin: guarded.origin, record: { auth: true } });
    writeSchema(root);
    writeDesign(root);
    stubTools('copy-protected-stubs', { readability: readability(99) }, join(copy, 'deploy'));
    const gate2 = (extra, env = {}) => run(['inherited', '--page', 'home', ...extra], { cwd: root, script: gate, env });
    const callsFile = join(copy, 'deploy', 'calls.jsonl');
    const ran = () => readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const before = ran().length;
    const bare = await gate2([]);
    assert.equal(bare.status, 2, bare.all);
    assert.match(bare.stderr, /pass --auth-header or --token-env/);
    const ok = await gate2(['--token-env', 'MY_SITE_TOKEN'], { MY_SITE_TOKEN: SECRET });
    assert.equal(ok.status, 0, ok.all);
    assert.equal(ok.stdout.trim().split('\n')[0], 'PASS inherited');
    assert.ok(!/n\/a/.test(ok.stdout), `both instruments ran on the protected preview: ${ok.stdout}`);
    assert.ok(!ok.all.includes(SECRET) && !readFileSync(join(outOf(root), 'inherited.json'), 'utf8').includes(SECRET));
    assert.deepEqual(guarded.requests.map((q) => q.headers.authorization), [`token ${SECRET}`], 'the one request of this step carried the header');
    assert.deepEqual(ran().slice(before).map((c) => [c.tool, c.token, c.argv.includes('--auth-origin')]), [['readability', `token ${SECRET}`, true], ['qa', `token ${SECRET}`, true]], 'no instrument ran without the token, both with it');
  } finally { await guarded.close(); }
});

// ---- the real ai-readability, against the fake preview ---------------------------------------------------------

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  await check('the real ai-readability on the fake preview: its report is read (score 100, a page that serves its text), --json lands in inherited/, and a page whose text only JavaScript writes scores below 98', async () => {
    const real = deployTools();
    const server = await startPreviewServer();
    try {
      const root = project('real-pass', { origin: server.origin });
      const stub = stubTools('real-pass');
      const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: { readability: real.readability, qa: stub.tools.qa } });
      assert.equal(result.verdict, 'PASS', JSON.stringify(result.rows));
      assert.deepEqual([pick(result.rows, 'ai-readability').value, pick(result.rows, 'ai-readability').status], ['100', 'PASS']);
      const report = readJson(join(outOf(root), 'inherited', 'ai-readability.json'));
      assert.equal(report.min, 98);
      assert.equal(report.pages[0].path, '/ns/home');
      assert.equal(report.pages[0].code.score, 100);
    } finally { await server.close(); }

    const script = join(scratch, 'js-only.html');
    writeFileSync(script, `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><main><div><h1>Short</h1></div></main>
<script>document.querySelector('main div').insertAdjacentHTML('beforeend', '<p>${'every word of this paragraph is written by script only, so a crawler never reads it. '.repeat(12)}</p>');</script></body></html>
`);
    const lean = await startPreviewServer({ pages: { '/ns/home': script } });
    try {
      const root = project('real-js-only', { origin: lean.origin });
      const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: { readability: real.readability, qa: stubTools('real-js-only').tools.qa } });
      const row = pick(result.rows, 'ai-readability');
      assert.equal(row.status, 'FAIL', JSON.stringify(row));
      assert.ok(Number(row.value) < 98, row.value);
      assert.deepEqual([result.verdict, result.exit], ['FAIL', 1]);
    } finally { await lean.close(); }
  });

  await check('the real qa-gate on the fake preview with the schema and the design: the cap the page keeps passes, one it does not is a FAIL carrying qa-gate\'s own ✗ line', async () => {
    const real = deployTools();
    const server = await startPreviewServer();
    try {
      const measured = async (name, cap) => {
        const root = project(name, { origin: server.origin });
        writeSchema(root);
        writeFileSync(join(outOf(root), 'design.json'), `${JSON.stringify({ extensions: { breakpoints: { containerMaxWidth: `${cap}px`, probeWidth: 2560 } } })}\n`);
        const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), tools: { readability: stubTools(name).tools.readability, qa: real.qa } });
        return { root, row: pick(result.rows, 'qa-gate'), result };
      };
      const kept = await measured('real-qa-pass', 1200);
      assert.equal(kept.row.status, 'PASS', JSON.stringify(kept.row));
      assert.match(kept.row.value, /^\d+ ok, \d+ warn, 0 fail$/);
      assert.equal(kept.result.verdict, 'PASS');
      assert.match(readFileSync(join(outOf(kept.root), 'inherited', 'qa-gate.txt'), 'utf8'), /^QA GATE: PASS — /m);
      const broken = await measured('real-qa-fail', 900);
      assert.equal(broken.row.status, 'FAIL', JSON.stringify(broken.row));
      assert.match(broken.row.value, /, 1 fail$/);
      assert.match(broken.row.detail, /content cap 900px holds at 2560/);
      assert.deepEqual([broken.result.verdict, broken.result.exit], ['FAIL', 1]);
    } finally { await server.close(); }
  });

  await check('the real ai-readability and qa-gate on a protected preview: both measure it, and only the preview origin receives the token, not an image host on a second origin', async () => {
    const real = deployTools();
    const watch = watchRequests();
    const asset = await startSourceServer();
    const page = join(scratch, 'protected-third-party.html');
    writeFileSync(page, readFileSync(fixturePath('home.html'), 'utf8').replace('<body>', () => `<body><img alt="" width="8" height="8" src="${asset.origin}/images/hero.png">`));
    const server = await startPreviewServer({ token: SECRET, pages: { '/ns/home': page } });
    try {
      const root = project('real-protected', { origin: server.origin, record: { auth: true } });
      writeSchema(root);
      writeFileSync(join(outOf(root), 'design.json'), `${JSON.stringify({ extensions: { breakpoints: { containerMaxWidth: '1200px', probeWidth: 2560 } } })}\n`);
      const result = await runInherited({ dir: join(root, 'stardust'), slug: 'home', preview: previewOf(root), auth: `token ${SECRET}`, tools: real });
      assert.equal(result.verdict, 'PASS', JSON.stringify(result.rows));
      assert.deepEqual([pick(result.rows, 'ai-readability').value, pick(result.rows, 'ai-readability').status], ['100', 'PASS']);
      assert.equal(pick(result.rows, 'qa-gate').status, 'PASS', JSON.stringify(pick(result.rows, 'qa-gate')));
      const at = (port) => watch.seen.filter((q) => q.port === Number(port));
      const previewSeen = at(new URL(server.origin).port);
      assert.ok(previewSeen.length >= 3, `the preview was read by the step and both instruments: ${previewSeen.length} requests`);
      assert.deepEqual([...new Set(previewSeen.map((q) => q.authorization))], [`token ${SECRET}`], 'every request to the preview carried the token');
      const imageSeen = at(new URL(asset.origin).port);
      assert.ok(imageSeen.some((q) => q.path === '/images/hero.png'), 'the image on the second origin was requested');
      assert.deepEqual(imageSeen.map((q) => q.authorization), imageSeen.map(() => undefined), 'and it was sent no Authorization');
      assert.ok(!readFileSync(join(outOf(root), 'inherited.json'), 'utf8').includes(SECRET));
    } finally { watch.stop(); await server.close(); await asset.close(); }
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
