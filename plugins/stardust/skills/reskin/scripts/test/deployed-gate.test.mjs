#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate.test.mjs — deployed-gate.mjs and its A0 step, `preview`: the preview
// origin of a branch, the eligibility of the project, the poll for the page's authored form, the isolation of a
// shared repo, and the preview.json the later steps read. Pure functions first, then the CLI against the fake
// preview server of fixtures/deployed/ (DEPLOY_VERIFY_ORIGIN points the gate at it). No browser, no network.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { main } from '../deployed-gate.mjs';
import { deployedDir, readPreview } from '../deployed/io.mjs';
import { eligibility, headMetadata, isolation, previewOrigin } from '../deployed/preview.mjs';
import { fixturePath, startPreviewServer } from './fixtures/deployed/servers.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const TOKEN = 'canary-456';
const HEADER = `token ${TOKEN}`;
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

// A project root with the three files that make a project eligible; `skip` names the ones to leave out.
const project = (name, { skip = [] } = {}) => {
  const root = join(scratch, name);
  mkdirSync(join(root, 'stardust'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  const files = {
    'stardust/runtime-contract.json': readFileSync(fixturePath('runtime-contract.json'), 'utf8'),
    'head.html': '<script src="/scripts/aem.js" type="module"></script>\n',
    'scripts/aem.js': '// the boilerplate runtime\n',
  };
  for (const [rel, body] of Object.entries(files)) if (!skip.includes(rel)) writeFileSync(join(root, rel), body);
  return root;
};
const PAGE = ['--page', 'home', '--org', 'o', '--repo', 'r', '--branch', 'b', '--path', '/ns/home'];
const preview = (root, origin, extra = ['--namespace', 'ns'], opts = {}) => run(['preview', ...PAGE, ...extra], { cwd: root, ...opts, env: { DEPLOY_VERIFY_ORIGIN: origin, ...opts.env } });
const recordOf = (root) => JSON.parse(readFileSync(join(deployedDir(join(root, 'stardust'), 'home'), 'preview.json'), 'utf8'));
const recordPath = (root) => join(deployedDir(join(root, 'stardust'), 'home'), 'preview.json');
const noToken = (...texts) => { for (const t of texts) assert.ok(!t.includes(TOKEN), `the token leaked: …${t.slice(Math.max(0, t.indexOf(TOKEN) - 40), t.indexOf(TOKEN) + 40)}…`); };

// The delivered fixture page with its head's nav and footer metas changed (null drops one), served from a file of its own.
const pageWithChrome = (name, { nav = '/ns/nav', footer = '/ns/footer' } = {}) => {
  const html = join(scratch, `${name}.html`);
  const meta = (key, value) => (value === null ? '' : `<meta name="${key}" content="${value}">`);
  writeFileSync(html, readFileSync(fixturePath('home.html'), 'utf8')
    .replace('<meta name="nav" content="/ns/nav">', () => meta('nav', nav))
    .replace('<meta name="footer" content="/ns/footer">', () => meta('footer', footer)));
  return html;
};
const pageWithNav = (name, nav) => pageWithChrome(name, { nav });

await check('previewOrigin: <branch>--<repo>--<org> on aem.page; a host label over 63 characters is refused naming 63', () => {
  assert.equal(previewOrigin({ org: 'o', repo: 'r', branch: 'b' }), 'https://b--r--o.aem.page');
  const label63 = 'b'.repeat(63 - 'r--o'.length - 2);
  assert.equal(previewOrigin({ org: 'o', repo: 'r', branch: label63 }), `https://${label63}--r--o.aem.page`, 'a 63-character label passes');
  assert.throws(() => previewOrigin({ org: 'o', repo: 'r', branch: `${label63}b` }), (e) => e instanceof UsageError && /63/.test(e.message) && /branch/.test(e.message));
});

const ORIGIN = 'https://b--r--o.aem.page';
const CHROME = { nav: '/ns/nav', footer: '/ns/footer' };

await check('isolation: path, nav and footer problems listed together; none with --sandbox; a clean page has none', () => {
  const bad = isolation({ path: '/home', meta: { nav: '/nav' }, origin: ORIGIN, namespace: 'ns' });
  assert.equal(bad.length, 3, bad.join(' | '));
  assert.match(bad[0], /\/home/);
  assert.match(bad.find((p) => /nav/.test(p)), /\/nav.*\/ns\/nav/);
  assert.match(bad.find((p) => /footer/.test(p)), /absent.*\/ns\/footer/);
  assert.deepEqual(isolation({ path: '/home', meta: { nav: '/nav' }, origin: ORIGIN, namespace: 'ns', sandbox: true }), []);
  assert.deepEqual(isolation({ path: '/ns/home', meta: CHROME, origin: ORIGIN, namespace: 'ns' }), []);
  assert.equal(isolation({ path: '/ns/home', meta: { nav: '/ns/nav', footer: '/other/footer' }, origin: ORIGIN, namespace: 'ns' }).length, 1);
  assert.equal(isolation({ path: '/nsx/home', meta: CHROME, origin: ORIGIN, namespace: 'ns' }).length, 1, '/nsx/ is not inside /ns/');
});

await check('isolation: nav and footer are compared by pathname: a full URL on the page\'s origin is accepted, another origin or a normalised-away path is a problem', () => {
  const at = (meta) => isolation({ path: '/ns/home', meta, origin: ORIGIN, namespace: 'ns' });
  assert.deepEqual(at({ nav: `${ORIGIN}/ns/nav`, footer: `${ORIGIN}/ns/footer?v=2` }), [], 'same-origin full URLs');
  assert.deepEqual(at({ nav: '/ns/x/../nav', footer: '/ns/./footer' }), [], 'resolved as the header block resolves it');
  const other = at({ nav: 'https://other.test/ns/nav', footer: '/ns/footer' });
  assert.equal(other.length, 1, other.join(' | '));
  assert.match(other[0], /nav.*other\.test/);
  const up = at({ nav: '/ns/../nav', footer: '/ns/footer' });
  assert.equal(up.length, 1, up.join(' | '));
  assert.match(up[0], /nav/);
  assert.equal(at({ nav: '/NS/nav', footer: '/ns/footer' }).length, 1, 'the namespace is case-sensitive');
  assert.equal(at({ nav: '', footer: '/ns/footer' }).length, 1, 'an empty value falls back to /nav in the header block');
  assert.equal(at({ nav: 'http://', footer: '/ns/footer' }).length, 1, 'a value that is no URL');
});

await check('isolation: a path that a fetch would normalise, and so could leave the namespace, is a problem on its own; /ns/ stays accepted', () => {
  const at = (path) => isolation({ path, meta: CHROME, origin: ORIGIN, namespace: 'ns' });
  for (const path of ['/ns/../home', '/ns/%2e%2e/home', '/ns/%2E%2E/home', '/ns/..\\home', '/ns\\..\\home', '/ns/./home', '/ns/a/../../home', '/ns//home', '//evil.test/ns/home', '/ns/ho%6de', '/ns/home?x=1', '/ns/home#x', 'ns/home', '', '/ns/ home']) {
    const problems = at(path);
    assert.equal(problems.length, 1, `${JSON.stringify(path)}: ${problems.join(' | ')}`);
    assert.ok(problems[0].includes(path), `names the path: ${problems[0]}`);
  }
  assert.equal(at('/NS/home').length, 1, '/NS/ is not /ns/');
  assert.equal(at('/ns').length, 1, '/ns is not inside /ns/');
  assert.deepEqual(at('/ns/'), []);
  assert.deepEqual(at('/ns/a/b-c_d.e'), []);
  assert.deepEqual(isolation({ path: '/ns/../home', meta: {}, origin: ORIGIN, namespace: 'ns', sandbox: true }), [], '--sandbox waives it');
});

await check('headMetadata: the first <meta name="nav"> and <meta name="footer"> of the head, in any attribute order, quoting or case, entities decoded', () => {
  assert.deepEqual(headMetadata(readFileSync(fixturePath('home.html'), 'utf8')), CHROME);
  const head = (inner, body = '') => `<!doctype html><html><head><title>t</title>${inner}</head><body>${body}</body></html>`;
  assert.deepEqual(headMetadata(head('<meta content="/a/nav" name="nav"><meta NAME=\'footer\' CONTENT=\'/a/f&#x6f;oter\'>')), { nav: '/a/nav', footer: '/a/footer' });
  assert.deepEqual(headMetadata(head('<meta name=nav content=/ns/nav />')), { nav: '/ns/nav' }, 'unquoted values');
  assert.deepEqual(headMetadata(head('<meta name="nav" content="/first"><meta name="nav" content="/second">')), { nav: '/first' }, 'the first one wins');
  assert.deepEqual(headMetadata(head('<meta name="nav" content="/a?x=1&amp;y=2>3">')), { nav: '/a?x=1&y=2>3' }, 'a > inside a quoted value');
  assert.deepEqual(headMetadata(head('<meta name="nav" content="">')), { nav: '' }, 'present and empty');
  assert.deepEqual(headMetadata(head('<meta property="nav" content="/p"><meta name="Nav" content="/q"><meta name="navigation" content="/r"><meta name="nav">')), {}, 'only name="nav" with a content counts');
  assert.deepEqual(headMetadata(head('<!-- <meta name="nav" content="/c"> --><script>var s = \'<meta name="nav" content="/s">\';</script><style>/* <meta name="footer" content="/t"> */</style>', '<meta name="footer" content="/body">')), {}, 'comments, scripts, styles and the body are not the head');
  assert.deepEqual(headMetadata('<meta name="nav" content="/bare">'), { nav: '/bare' }, 'a fragment without <head> is read whole');
  assert.deepEqual(headMetadata(''), {});
  assert.deepEqual(headMetadata(undefined), {});
});

await check('eligibility: needs stardust/runtime-contract.json, head.html and scripts/aem.js at the project root, and names what is missing', () => {
  assert.deepEqual(eligibility(project('elig-ok')), { ok: true });
  for (const rel of ['stardust/runtime-contract.json', 'head.html', 'scripts/aem.js']) {
    const r = eligibility(project(`elig-no-${rel.replace(/\W/g, '-')}`, { skip: [rel] }));
    assert.equal(r.ok, false, rel);
    assert.ok(r.reason.includes(rel), `${rel}: ${r.reason}`);
  }
  assert.equal(eligibility(join(scratch, 'no-such-root')).ok, false);
});

await check('readPreview: absent is a setup error naming `deployed-gate preview`; deployedDir is the page\'s deployed evidence directory', () => {
  assert.equal(deployedDir('stardust', 'home'), join('stardust', '.work', 'reskin', 'gates', 'home', 'deployed'));
  assert.throws(() => readPreview(join(scratch, 'nowhere'), 'home'), (e) => e instanceof UsageError && e.code === 2 && /deployed-gate preview/.test(e.message));
  const dir = join(scratch, 'rp');
  mkdirSync(deployedDir(dir, 'home'), { recursive: true });
  writeFileSync(join(deployedDir(dir, 'home'), 'preview.json'), '{ nope');
  assert.throws(() => readPreview(dir, 'home'), (e) => e instanceof UsageError && /not valid JSON/.test(e.message) && /deployed-gate preview/.test(e.message));
  writeFileSync(join(deployedDir(dir, 'home'), 'preview.json'), '{"url":"u"}');
  assert.deepEqual(readPreview(dir, 'home'), { url: 'u' });
});

await check('--help answers from a directory holding only the script: exit 0, usage, only the wired subcommand, nothing written; -h too', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  for (const flag of ['--help', '-h']) {
    const r = await run([flag], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /usage/i);
    assert.match(r.stdout, /deployed-gate\.mjs preview --page <slug> --org <o> --repo <r> --branch <b> --path <\/ns\/slug>/);
    for (const flagName of ['--namespace', '--sandbox', '--auth-header', '--token-env', '--max-wait', '--dir']) assert.ok(r.stdout.includes(flagName), `usage names ${flagName}`);
    assert.ok(!/deployed-gate\.mjs (sanity|inherited|all)\b/.test(r.stdout), 'no unwired subcommand in the usage');
  }
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');
  const bare = await run(['preview', ...PAGE, '--namespace', 'ns'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(bare.status, 2, bare.all);
  assert.match(bare.stderr, /helpers are missing beside deployed-gate\.mjs.*cp -R/);
});

await check('usage errors exit 2: no or unknown command, unknown flag, a value flag followed by a flag, missing flags, --namespace with --sandbox, bad --max-wait and --path', async () => {
  const root = project('usage');
  const base = ['preview', ...PAGE, '--namespace', 'ns'];
  const without = (flag) => { const i = base.indexOf(flag); return [...base.slice(0, i), ...base.slice(i + 2)]; };
  const cases = [
    [[], /no command/],
    [['frobnicate'], /unknown command "frobnicate"/],
    [[...base, '--frob', 'x'], /unknown flag --frob for preview/],
    [[...base, 'stray'], /unexpected argument "stray"/],
    [['preview', '--page', '--org', 'o'], /--page needs a value/],
    [[...base, '--auth-header', '--sandbox'], /--auth-header needs a value/],
    [[...base, '--token-env'], /--token-env needs a value/],
    [without('--page'), /--page/],
    [without('--org'), /--org/],
    [without('--repo'), /--repo/],
    [without('--branch'), /--branch/],
    [without('--path'), /--path/],
    [without('--namespace'), /--namespace <ns> or --sandbox/],
    [[...base, '--sandbox'], /--namespace.*--sandbox/],
    [[...base, '--max-wait', 'soon'], /--max-wait needs a positive integer/],
    [[...base, '--max-wait', '0'], /--max-wait needs a positive integer/],
    [[...without('--path'), '--path', 'ns/home'], /--path must start with \//],
    [[...without('--path'), '--path', '/ns/home.html'], /without \.html/],
    [[...without('--page'), '--page', '../x'], /--page must be a slug/],
    [[...without('--namespace'), '--namespace', 'a/b'], /--namespace must be a single path segment/],
  ];
  for (const [args, re] of cases) {
    const r = await run(args, { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: 'http://127.0.0.1:9' } });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.all}`);
    assert.match(r.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');
});

await check('a branch whose host label is over 63 characters is a setup error naming 63, before any request', async () => {
  const root = project('long-label');
  const r = await run(['preview', ...PAGE.slice(0, 6), '--branch', 'b'.repeat(60), '--path', '/ns/home', '--namespace', 'ns'], { cwd: root });
  assert.equal(r.status, 2, r.all);
  assert.match(r.stderr, /63/);
  assert.ok(!existsSync(recordPath(root)));
});

await check('preview against the fake preview, in an eligible project: PASS <url>, exit 0, preview.json holds the origin, path, authored form and settings', async () => {
  const server = await startPreviewServer();
  try {
    const root = project('pass');
    const r = await preview(root, server.origin);
    assert.equal(r.status, 0, r.all);
    assert.equal(r.stdout.trim(), `PASS preview ${server.origin}/ns/home`);
    const rec = recordOf(root);
    assert.ok(rec.url.endsWith('/ns/home'), rec.url);
    assert.deepEqual({ ...rec, checkedAt: typeof rec.checkedAt }, {
      url: `${server.origin}/ns/home`,
      origin: server.origin,
      path: '/ns/home',
      plain: `${server.origin}/ns/home.plain.html`,
      namespace: 'ns',
      sandbox: false,
      auth: false,
      checkedAt: 'string',
    });
    assert.ok(!Number.isNaN(Date.parse(rec.checkedAt)));
    assert.deepEqual(readPreview(join(root, 'stardust'), 'home'), rec, 'readPreview returns what the CLI wrote');
    assert.deepEqual(server.requests.map((q) => q.path), ['/ns/home.plain.html', '/ns/home'], 'the authored form, then the delivered page for its head');
    assert.ok(server.requests.every((q) => q.method === 'GET'));
  } finally { await server.close(); }
});

await check('the project root is the parent of --dir: --dir <project>/stardust works from any cwd, and a parent without the files is skipped', async () => {
  const server = await startPreviewServer();
  try {
    const root = project('dir-root');
    const elsewhere = join(scratch, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const ok = await preview(root, server.origin, ['--namespace', 'ns', '--dir', join(root, 'stardust')], { cwd: elsewhere });
    assert.equal(ok.status, 0, ok.all);
    assert.match(ok.stdout, /^PASS preview /);
    assert.ok(existsSync(recordPath(root)));
    assert.ok(!existsSync(join(elsewhere, 'stardust')), 'nothing written under the cwd');
    const bare = join(scratch, 'dir-bare');
    mkdirSync(join(bare, 'stardust'), { recursive: true });
    const skipped = await preview(root, server.origin, ['--namespace', 'ns', '--dir', join(bare, 'stardust')], { cwd: elsewhere });
    assert.equal(skipped.status, 0, skipped.all);
    assert.match(skipped.stdout, /^SKIPPED deployed leg: /);
  } finally { await server.close(); }
});

await check('a page whose head nav meta is /nav fails naming nav (exit 1); the record is still written and lists the problem', async () => {
  const server = await startPreviewServer({ pages: { '/ns/home': pageWithNav('nav-shared', '/nav') } });
  try {
    const root = project('nav');
    const r = await preview(root, server.origin);
    assert.equal(r.status, 1, r.all);
    assert.match(r.stdout, /^FAIL preview: .*nav.*\/nav.*\/ns\/nav/m);
    assert.ok(!/^PASS/m.test(r.stdout));
    const rec = recordOf(root);
    assert.equal(rec.url, `${server.origin}/ns/home`);
    assert.equal(rec.problems.length, 1);
    assert.match(rec.problems[0], /nav/);
  } finally { await server.close(); }
});

await check('the chrome comes from the delivered page\'s head: absent metas fail for both, a same-origin full URL passes, another origin fails', async () => {
  const server = await startPreviewServer({ pages: {
    '/ns/none': pageWithChrome('chrome-none', { nav: null, footer: null }),
    '/ns/full': pageWithChrome('chrome-full', { nav: '__ORIGIN__/ns/nav', footer: '__ORIGIN__/ns/footer' }),
    '/ns/away': pageWithChrome('chrome-away', { nav: 'https://other.test/ns/nav', footer: '/ns/footer' }),
  } });
  try {
    const root = project('chrome');
    const at = (slug) => run(['preview', ...PAGE.slice(0, 8), '--path', `/ns/${slug}`, '--namespace', 'ns'], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: server.origin } });
    const none = await at('none');
    assert.equal(none.status, 1, none.all);
    assert.match(none.stdout, /^FAIL preview: .*nav.*absent.*\/ns\/nav/m);
    assert.match(none.stdout, /^FAIL preview: .*footer.*absent.*\/ns\/footer/m);
    const full = await at('full');
    assert.equal(full.status, 0, full.all);
    assert.equal(full.stdout.trim(), `PASS preview ${server.origin}/ns/full`);
    const away = await at('away');
    assert.equal(away.status, 1, away.all);
    assert.match(away.stdout, /^FAIL preview: .*nav.*other\.test/m);
    assert.ok(!/footer/.test(away.stdout), 'the footer is fine');
  } finally { await server.close(); }
});

await check('a path that normalises out of the namespace fails naming it, asks the preview for nothing and records the problem', async () => {
  const server = await startPreviewServer({ pages: { '/home': 'home.html', '/ns/home': 'home.html' } });
  try {
    const root = project('traversal');
    for (const path of ['/ns/../home', '/ns/%2e%2e/home', '/ns/..\\home']) {
      const r = await run(['preview', ...PAGE.slice(0, 8), '--path', path, '--namespace', 'ns'], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: server.origin } });
      assert.equal(r.status, 1, `${path}: ${r.all}`);
      assert.match(r.stdout, /^FAIL preview: the page path .*not a plain path/m, path);
      assert.ok(r.stdout.includes(path), `names ${path}: ${r.stdout}`);
      assert.ok(!/^PASS/m.test(r.stdout));
      assert.equal(server.requests.length, 0, `${path}: a path that is refused is never fetched`);
      const rec = recordOf(root);
      assert.equal(rec.problems.length, 1);
      assert.equal(rec.path, path);
    }
  } finally { await server.close(); }
});

await check('a page outside the namespace fails naming the path; --sandbox waives the path and nav/footer checks and records it', async () => {
  const server = await startPreviewServer({ pages: { '/home': pageWithNav('flat-shared', '/nav') } });
  try {
    const root = project('sandbox');
    const flat = ['preview', '--page', 'home', '--org', 'o', '--repo', 'r', '--branch', 'b', '--path', '/home'];
    const env = { DEPLOY_VERIFY_ORIGIN: server.origin };
    const shared = await run([...flat, '--namespace', 'ns'], { cwd: root, env });
    assert.equal(shared.status, 1, shared.all);
    assert.match(shared.stdout, /^FAIL preview: .*\/home.*\/ns\//m);
    assert.match(shared.stdout, /^FAIL preview: .*nav/m);
    assert.equal(recordOf(root).problems.length, 2);
    const waived = await run([...flat, '--sandbox'], { cwd: root, env });
    assert.equal(waived.status, 0, waived.all);
    assert.equal(waived.stdout.trim(), `PASS preview ${server.origin}/home`);
    const rec = recordOf(root);
    assert.equal(rec.sandbox, true);
    assert.equal(rec.namespace, null);
    assert.equal(rec.problems, undefined);
  } finally { await server.close(); }
});

await check('without stardust/runtime-contract.json the leg is skipped: SKIPPED deployed leg: <reason>, exit 0, preview.json.skipped, no request made', async () => {
  const server = await startPreviewServer();
  try {
    for (const rel of ['stardust/runtime-contract.json', 'head.html', 'scripts/aem.js']) {
      const root = project(`skip-${rel.replace(/\W/g, '-')}`, { skip: [rel] });
      const r = await preview(root, server.origin);
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^SKIPPED deployed leg: .*not an aem-boilerplate project/);
      assert.ok(r.stdout.includes(rel), `the reason names ${rel}: ${r.stdout}`);
      const rec = recordOf(root);
      assert.equal(rec.skipped, true);
      assert.ok(rec.reason.includes(rel));
      assert.equal(rec.auth, false);
      assert.equal(rec.path, '/ns/home');
    }
    assert.equal(server.requests.length, 0, 'a skipped leg asks for nothing');
  } finally { await server.close(); }
});

await check('a page that stays 404 is exit 124 after --max-wait: ERROR (exit 124) preview: <path>.plain.html not 200 after 2 s; a stale preview.json is removed', async () => {
  const server = await startPreviewServer();
  try {
    const root = project('timeout');
    const first = await preview(root, server.origin);
    assert.equal(first.status, 0, first.all);
    assert.ok(existsSync(recordPath(root)));
    const started = Date.now();
    const r = await run(['preview', ...PAGE.slice(0, 8), '--path', '/ns/missing', '--namespace', 'ns', '--max-wait', '2'], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: server.origin } });
    const took = Date.now() - started;
    assert.equal(r.status, 124, r.all);
    assert.match(r.stdout, /^ERROR \(exit 124\) preview: \/ns\/missing\.plain\.html not 200 after 2 s$/m);
    assert.match(r.stdout, /last response: HTTP 404/);
    assert.ok(took >= 1800 && took < 8000, `bounded by --max-wait: ${took} ms`);
    assert.ok(server.requests.filter((q) => q.path === '/ns/missing.plain.html').length >= 2, 'it polled');
    assert.ok(!existsSync(recordPath(root)), 'no verdict leaves no preview.json behind');
  } finally { await server.close(); }
});

await check('the poll waits for the page: 404 twice, then 200 is a PASS', async () => {
  const plain = readFileSync(fixturePath('home.plain.html'), 'utf8');
  const page = readFileSync(fixturePath('home.html'), 'utf8');
  let seen = 0;
  const server = createServer((req, res) => {
    const isPlain = req.url.endsWith('.plain.html');
    if (isPlain) seen += 1;
    if (isPlain && seen <= 2) { res.writeHead(404); return res.end('not yet'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(isPlain ? plain : page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('poll');
    const r = await preview(root, `http://127.0.0.1:${server.address().port}`, ['--namespace', 'ns', '--max-wait', '10']);
    assert.equal(r.status, 0, r.all);
    assert.equal(seen, 3);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

await check('the delivered page is polled too: an authored form that answers while the page stays 404 is exit 124 naming the page', async () => {
  const server = createServer((req, res) => {
    if (req.url.endsWith('.plain.html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<body><main><div></div></main></body>'); }
    res.writeHead(404);
    return res.end('not yet');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('page-404');
    const r = await preview(root, `http://127.0.0.1:${server.address().port}`, ['--namespace', 'ns', '--max-wait', '2']);
    assert.equal(r.status, 124, r.all);
    assert.match(r.stdout, /^ERROR \(exit 124\) preview: \/ns\/home not 200 after 2 s$/m);
    assert.match(r.stdout, /last response: HTTP 404/);
    assert.ok(!existsSync(recordPath(root)), 'no verdict leaves no preview.json behind');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

await check('a server that never answers cannot overrun --max-wait: each request is clamped to the time left, exit 124 within the bound', async () => {
  const hung = createServer(() => {});
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('hung');
    const started = Date.now();
    const r = await preview(root, `http://127.0.0.1:${hung.address().port}`, ['--namespace', 'ns', '--max-wait', '2']);
    const took = Date.now() - started;
    assert.equal(r.status, 124, r.all);
    assert.match(r.stdout, /^ERROR \(exit 124\) preview: \/ns\/home\.plain\.html not 200 after 2 s$/m);
    assert.match(r.stdout, /last response: no response/);
    assert.ok(took >= 1800 && took < 5000, `bounded by --max-wait, not by the 10 s request timeout: ${took} ms`);
  } finally { hung.closeAllConnections(); await new Promise((resolve) => hung.close(resolve)); }
});

await check('--auth-header: the header goes to the preview, preview.json holds auth: true, and the token is in no output or file', async () => {
  const server = await startPreviewServer({ token: TOKEN });
  try {
    const root = project('auth-header');
    const r = await preview(root, server.origin, ['--namespace', 'ns', '--auth-header', HEADER]);
    assert.equal(r.status, 0, r.all);
    assert.equal(recordOf(root).auth, true);
    noToken(r.stdout, r.stderr, readFileSync(recordPath(root), 'utf8'));
    assert.ok(server.requests.length > 0 && server.requests.every((q) => q.headers.authorization === HEADER), 'every request carried the header');
    for (const f of readdirSync(deployedDir(join(root, 'stardust'), 'home'))) noToken(readFileSync(join(deployedDir(join(root, 'stardust'), 'home'), f), 'utf8'));
  } finally { await server.close(); }
});

await check('--token-env reads the token from the environment; without a token a protected preview is never a pass; an unset variable is a setup error', async () => {
  const server = await startPreviewServer({ token: TOKEN });
  try {
    const root = project('auth-env');
    const viaEnv = await preview(root, server.origin, ['--namespace', 'ns', '--token-env', 'STARDUST_T4_TOKEN'], { env: { STARDUST_T4_TOKEN: TOKEN } });
    assert.equal(viaEnv.status, 0, viaEnv.all);
    assert.equal(recordOf(root).auth, true);
    noToken(viaEnv.stdout, viaEnv.stderr, readFileSync(recordPath(root), 'utf8'));
    const anon = await preview(root, server.origin, ['--namespace', 'ns', '--max-wait', '1']);
    assert.equal(anon.status, 124, anon.all);
    assert.match(anon.stdout, /last response: HTTP 401/);
    assert.ok(!existsSync(recordPath(root)), 'no preview.json without a verdict');
    const unset = await preview(root, server.origin, ['--namespace', 'ns', '--token-env', 'STARDUST_T4_NO_SUCH_TOKEN']);
    assert.equal(unset.status, 2, unset.all);
    assert.match(unset.stderr, /STARDUST_T4_NO_SUCH_TOKEN/);
  } finally { await server.close(); }
});

await check('an empty or blank --auth-header / --token-env is exit 2 "needs a value", never a fallback to $SITE_TOKEN or a .env', async () => {
  const server = await startPreviewServer({ token: TOKEN });
  try {
    const root = project('auth-blank');
    writeFileSync(join(root, '.env'), `SITE_TOKEN=${TOKEN}\n`);
    for (const flag of ['--auth-header', '--token-env']) {
      for (const blank of ['', ' ', '\t']) {
        const r = await preview(root, server.origin, ['--namespace', 'ns', flag, blank, '--max-wait', '1'], { env: { SITE_TOKEN: TOKEN } });
        assert.equal(r.status, 2, `${flag} ${JSON.stringify(blank)}: ${r.all}`);
        assert.match(r.stderr, new RegExp(`${flag} needs a value`));
        noToken(r.all);
      }
    }
    assert.equal(server.requests.length, 0, 'nothing was asked: no fallback token was read');
    assert.ok(!existsSync(recordPath(root)));
  } finally { await server.close(); }
});

await check('the header never leaves the preview origin: a redirect elsewhere is not followed, for the authored form or the page, and is no verdict', async () => {
  const elsewhere = await startPreviewServer();
  const redirecting = createServer((req, res) => { res.writeHead(302, { location: `${elsewhere.origin}/ns/home.plain.html` }); res.end(); });
  const pageRedirecting = createServer((req, res) => {
    if (req.url.endsWith('.plain.html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<body><main><div></div></main></body>'); }
    res.writeHead(302, { location: `${elsewhere.origin}/ns/home` });
    return res.end();
  });
  await new Promise((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => pageRedirecting.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('redirect');
    const r = await preview(root, `http://127.0.0.1:${redirecting.address().port}`, ['--namespace', 'ns', '--auth-header', HEADER, '--max-wait', '1']);
    assert.equal(r.status, 124, r.all);
    assert.match(r.stdout, /last response: HTTP 302/);
    assert.equal(elsewhere.requests.length, 0, 'the redirect target was never asked');
    noToken(r.all);
    const p = await preview(root, `http://127.0.0.1:${pageRedirecting.address().port}`, ['--namespace', 'ns', '--auth-header', HEADER, '--max-wait', '1']);
    assert.equal(p.status, 124, p.all);
    assert.match(p.stdout, /^ERROR \(exit 124\) preview: \/ns\/home not 200 after 1 s$/m);
    assert.match(p.stdout, /last response: HTTP 302/);
    assert.equal(elsewhere.requests.length, 0, 'the page\'s redirect target was never asked');
    noToken(p.all);
  } finally {
    for (const s of [redirecting, pageRedirecting]) { s.closeAllConnections(); await new Promise((resolve) => s.close(resolve)); }
    await elsewhere.close();
  }
});

await check('main dispatches to a replaceable step and returns its exit code; the help guard runs before any step', async () => {
  const lines = [];
  const code = await main(['preview', ...PAGE, '--namespace', 'ns'], { log: (m) => lines.push(m), steps: { preview: async ({ opts, log }) => { log(`stub ${opts.page}`); return 7; } } });
  assert.equal(code, 7);
  assert.deepEqual(lines, ['stub home']);
  const help = [];
  assert.equal(await main(['preview', '--help'], { log: (m) => help.push(m), steps: { preview: async () => { throw new Error('must not run'); } } }), 0);
  assert.match(help.join('\n'), /usage/i);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
