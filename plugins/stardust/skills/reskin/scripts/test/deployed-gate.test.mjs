#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate.test.mjs — deployed-gate.mjs, its A0 step `preview` and `all`: the preview
// origin of a branch, the eligibility of the project, the poll for the page's authored form, the isolation of a
// shared repo, and the preview.json the later steps read. Pure functions first, then the CLI against the fake
// preview server of fixtures/deployed/ (DEPLOY_VERIFY_ORIGIN points the gate at it). No browser, no network.
// Then `all`, the whole leg in one run: the verdict lines, summary.json and its ledger fragment, the exit mapping and
// the figma-gate child against stand-in steps and stand-in figma-gate scripts (no browser), the secret scan, and — in
// the part that needs playwright (a skip line when it does not resolve; slow: every step opens Chromium) — real runs
// against the fake servers: a clean public preview, one with an overflow, a protected preview with the real figma-gate.
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
import { runChild } from '../deployed/child.mjs';
import { runContent } from '../deployed/content.mjs';
import { runTokens } from '../deployed/eds-spec.mjs';
import { deployedDir, readPreview } from '../deployed/io.mjs';
import { eligibility, headMetadata, isolation, previewOrigin } from '../deployed/preview.mjs';
import { runSanity } from '../deployed/sanity.mjs';
import { VERDICT_RE } from '../../../replica/scripts/run-bg.mjs';
import { fixturePath, loadSourceModel, solidPng, startPreviewServer, startSourceServer } from './fixtures/deployed/servers.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

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

await check('--help answers from a directory holding only the script: exit 0, usage, every subcommand, nothing written; -h too', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  for (const flag of ['--help', '-h']) {
    const r = await run([flag], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /usage/i);
    assert.match(r.stdout, /deployed-gate\.mjs preview --page <slug> --org <o> --repo <r> --branch <b> --path <\/ns\/slug>/);
    for (const flagName of ['--namespace', '--sandbox', '--auth-header', '--token-env', '--max-wait', '--dir']) assert.ok(r.stdout.includes(flagName), `usage names ${flagName}`);
    for (const cmd of ['content', 'tokens', 'parity', 'sanity', 'inherited', 'all']) assert.match(r.stdout, new RegExp(`deployed-gate\\.mjs ${cmd} --page <slug>`), `usage names ${cmd}`);
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

await check('a folder path (/ns/) is polled at its index.plain.html, as figma-gate finds it, and recorded so; /ns/.plain.html is never asked for', async () => {
  const plain = readFileSync(fixturePath('home.plain.html'), 'utf8');
  const page = readFileSync(fixturePath('home.html'), 'utf8');
  const asked = [];
  const server = createServer((req, res) => {
    asked.push(req.url);
    const body = { '/ns/index.plain.html': plain, '/ns/': page }[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('folder');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const r = await run(['preview', ...PAGE.slice(0, 8), '--path', '/ns/', '--namespace', 'ns', '--max-wait', '5'], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: origin } });
    assert.equal(r.status, 0, r.all);
    assert.equal(r.stdout.trim(), `PASS preview ${origin}/ns/`);
    assert.equal(recordOf(root).plain, `${origin}/ns/index.plain.html`);
    assert.deepEqual(asked, ['/ns/index.plain.html', '/ns/']);
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

await check('--auth-header: the preview refuses the first, anonymous request and the header goes with the rest; preview.json holds auth: true, and the token is in no output or file', async () => {
  const server = await startPreviewServer({ token: TOKEN });
  try {
    const root = project('auth-header');
    const r = await preview(root, server.origin, ['--namespace', 'ns', '--auth-header', HEADER]);
    assert.equal(r.status, 0, r.all);
    assert.equal(recordOf(root).auth, true);
    assert.equal('tokenUnused' in recordOf(root), false);
    noToken(r.stdout, r.stderr, readFileSync(recordPath(root), 'utf8'));
    const [first, ...rest] = server.requests;
    assert.equal(first.headers.authorization, undefined, 'the first request is the anonymous one that finds the preview protected');
    assert.ok(rest.length > 0 && rest.every((q) => q.headers.authorization === HEADER), 'every request after it carried the header');
    for (const f of readdirSync(deployedDir(join(root, 'stardust'), 'home'))) noToken(readFileSync(join(deployedDir(join(root, 'stardust'), 'home'), f), 'utf8'));
  } finally { await server.close(); }
});

await check('a token given for a public preview is recorded as unused: auth: false, tokenUnused: true, and it is never sent', async () => {
  const server = await startPreviewServer();
  try {
    for (const [name, extra, env] of [['unused-header', ['--auth-header', HEADER], {}], ['unused-env', ['--token-env', 'STARDUST_T4_TOKEN'], { STARDUST_T4_TOKEN: TOKEN }]]) {
      const root = project(name);
      const r = await preview(root, server.origin, ['--namespace', 'ns', ...extra], { env });
      assert.equal(r.status, 0, `${name}: ${r.all}`);
      assert.equal(r.stdout.trim(), `PASS preview ${server.origin}/ns/home`);
      const rec = recordOf(root);
      assert.equal(rec.auth, false, `${name}: auth means the preview refused an anonymous request`);
      assert.equal(rec.tokenUnused, true, name);
      noToken(r.all, readFileSync(recordPath(root), 'utf8'));
    }
    assert.ok(server.requests.length > 0 && server.requests.every((q) => q.headers.authorization === undefined), 'no request carried the token');
    const none = project('unused-none');
    await preview(none, server.origin);
    assert.equal('tokenUnused' in recordOf(none), false, 'no token given, nothing to call unused');
  } finally { await server.close(); }
});

await check('a token still reaches a preview that refuses an anonymous request later than the first: a 503 first, then 401 without it, 200 with it: auth: true', async () => {
  const plain = readFileSync(fixturePath('home.plain.html'), 'utf8');
  const page = readFileSync(fixturePath('home.html'), 'utf8');
  let seen = 0;
  const server = createServer((req, res) => {
    seen += 1;
    if (seen === 1) { res.writeHead(503); return res.end('warming up'); }
    if (req.headers.authorization !== HEADER) { res.writeHead(401); return res.end('unauthorized'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(req.url.endsWith('.plain.html') ? plain : page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = project('late-refusal');
    const r = await preview(root, `http://127.0.0.1:${server.address().port}`, ['--namespace', 'ns', '--auth-header', HEADER, '--max-wait', '10']);
    assert.equal(r.status, 0, r.all);
    const rec = recordOf(root);
    assert.equal(rec.auth, true);
    assert.equal('tokenUnused' in rec, false);
    noToken(r.all, readFileSync(recordPath(root), 'utf8'));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

await check('--token-env reads the token from the environment; without a token a protected preview is never a pass; an unset variable is a setup error', async () => {
  const server = await startPreviewServer({ token: TOKEN });
  try {
    const root = project('auth-env');
    const viaEnv = await preview(root, server.origin, ['--namespace', 'ns', '--token-env', 'STARDUST_T4_TOKEN'], { env: { STARDUST_T4_TOKEN: TOKEN } });
    assert.equal(viaEnv.status, 0, viaEnv.all);
    assert.equal(recordOf(root).auth, true);
    noToken(viaEnv.stdout, viaEnv.stderr, readFileSync(recordPath(root), 'utf8'));
    const started = Date.now();
    const anon = await preview(root, server.origin, ['--namespace', 'ns', '--max-wait', '30']);
    assert.equal(anon.status, 2, anon.all);
    assert.match(anon.stderr, /the preview needs a site token: pass --token-env <NAME>/);
    assert.ok(Date.now() - started < 10000, 'a refusal is no poll: it is not waited out until 124');
    assert.ok(!existsSync(recordPath(root)), 'no preview.json without a verdict');
    const unset = await preview(root, server.origin, ['--namespace', 'ns', '--token-env', 'STARDUST_T4_NO_SUCH_TOKEN']);
    assert.equal(unset.status, 2, unset.all);
    assert.match(unset.stderr, /no site token: the variable --token-env names is not set in the environment or \.env/);
    assert.equal(unset.all.includes('STARDUST_T4_NO_SUCH_TOKEN'), false, 'the name is never printed: a token typed in its place would be echoed');
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
  const redirecting = createServer((req, res) => {
    if (!req.headers.authorization) { res.writeHead(401); return res.end(); }
    res.writeHead(302, { location: `${elsewhere.origin}/ns/home.plain.html` });
    return res.end();
  });
  const pageRedirecting = createServer((req, res) => {
    if (!req.headers.authorization) { res.writeHead(401); return res.end(); }
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

// ---- all: the whole leg in one run, against stand-in steps and stand-in figma-gate scripts -----------------------------

const STEPS = ['content', 'tokens', 'parity', 'sanity', 'inherited', 'figma'];
const VERDICT_WORD = /^(PASS|FAIL|ADVISORY|ERROR \(exit \d+\)) /;
const verdictLines = (lines) => lines.filter((l) => VERDICT_WORD.test(l));
const stepOf = (line) => line.replace(VERDICT_WORD, '').split(/[ :]/)[0];
const ALL_URL = 'http://127.0.0.1:9/ns/home';
const ALL_TOKEN = 'canary-777';

// A project root holding the record of the preview step, and the page's checks file when `checks` is set.
const allRoot = (name, { record = {}, checks = false } = {}) => {
  const root = join(scratch, name);
  const dir = join(root, 'stardust');
  mkdirSync(deployedDir(dir, 'home'), { recursive: true });
  writeFileSync(join(deployedDir(dir, 'home'), 'preview.json'), `${JSON.stringify({
    url: ALL_URL, origin: 'http://127.0.0.1:9', path: '/ns/home', plain: `${ALL_URL}.plain.html`, namespace: 'ns', sandbox: false, auth: false, checkedAt: new Date().toISOString(), ...record,
  }, null, 2)}\n`);
  if (checks) {
    mkdirSync(join(dir, 'reskin', 'figma-checks'), { recursive: true });
    writeFileSync(join(dir, 'reskin', 'figma-checks', 'home.json'), '{}\n');
  }
  return root;
};
const dirOf = (root) => join(root, 'stardust');
const summaryAt = (root) => JSON.parse(readFileSync(join(deployedDir(dirOf(root), 'home'), 'summary.json'), 'utf8'));

// What each step's run function answers when it passes, in the shape the real one has.
const gateOf = (name, exit = 0, extra = {}) => ({ name, exit, report: `${name}.md`, advisory: false, lines: [], ...extra });
const rowOf = (check, width, status, value = '0', bar = '≤ 4px') => ({ check, width, value, bar, status, artifact: null, detail: null });
const passing = (...checks) => checks.map((c) => rowOf(c, 1440, 'PASS'));
const STUB = {
  content: () => ({ verdict: 'PASS', unusedDeltas: [], gates: [gateOf('dom-equality'), gateOf('slot-coverage')] }),
  tokens: () => ({ verdict: 'PASS', exit: 0, total: 12, failures: [], skipped: ['layout.containerMaxWidth: measured by parity cap-probe'] }),
  parity: () => ({ verdict: 'PASS', exit: 0, rows: passing('pixel', 'height') }),
  sanity: () => ({ verdict: 'PASS', exit: 0, hard: true, rows: passing('overflow', 'decoration') }),
  inherited: () => ({ verdict: 'PASS', exit: 0, rows: passing('.plain.html') }),
};

// One in-process `all` with stand-in steps (`over` replaces the ones it names): { code, error, lines, called, args }.
const runAll = async (root, { over = {}, extra = [], figmaGate, env = {} } = {}) => {
  const started = [];
  const runners = Object.fromEntries(Object.keys(STUB).map((name) => [name, async (args) => { started.push({ name, args }); return (over[name] ?? STUB[name])(args); }]));
  const lines = [];
  let code = null; let error = null;
  try { code = await main(['all', '--page', 'home', '--dir', dirOf(root), ...extra], { env, log: (m) => lines.push(m), runners, figmaGate }); } catch (e) { error = e; }
  return { code, error, lines, called: started.map((s) => s.name), args: Object.fromEntries(started.map((s) => [s.name, s.args])) };
};

// A stand-in for figma-gate.mjs: logs its argv and the token variable, writes `summary` where figma-gate does, prints
// stdout and stderr and exits with `exit`.
const FRAGMENT = {
  regime: 'preview', figmaVersion: '100', join: 'PASS', geometry: 'PASS 10/10', ramp: 'PASS 8/8', pixel: 's01 0.00%, s02 0.00%',
  register: 'mandated 2 · unmandated 0 · out-of-kit 0 · conflict 0 · pre-existing 0', literals: 0, invocation: 'figma-gate.mjs all --page home',
};
let stubCount = 0;
const stubFigma = ({ exit = 0, summary = { regime: 'preview', ledgerFragment: FRAGMENT }, stdout = '', stderr = '' } = {}) => {
  stubCount += 1;
  const file = join(scratch, `figma-stub-${stubCount}.mjs`);
  const log = join(scratch, `figma-stub-${stubCount}.jsonl`);
  writeFileSync(file, [
    "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const argv = process.argv.slice(2);',
    'const flag = (f) => argv[argv.indexOf(f) + 1];',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, token: process.env.DEPLOYED_GATE_SITE_TOKEN ?? null }) + '\\n');`,
    `const summary = ${JSON.stringify(summary)};`,
    "if (summary) {",
    "  const out = join(flag('--dir'), '.work', 'reskin', 'gates', flag('--page'), 'figma');",
    '  mkdirSync(out, { recursive: true });',
    "  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary));",
    '}',
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    `process.exit(${exit});`,
    '',
  ].join('\n'));
  return { file, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) };
};

await check('all: content, tokens, parity, sanity, inherited, then figma-gate as a child; one verdict line per step, each matching run-bg\'s VERDICT_RE; summary.json carries the ledger fragment', async () => {
  const root = allRoot('all-pass', { checks: true });
  const out = deployedDir(dirOf(root), 'home');
  for (const f of ['content.json', 'tokens.json', 'parity.json', 'sanity.json', 'inherited.json', 'summary.json']) writeFileSync(join(out, f), '{"stale":true}\n');
  const figma = stubFigma();
  const r = await runAll(root, { figmaGate: figma.file });
  assert.equal(r.error, null, String(r.error));
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(r.called, ['content', 'tokens', 'parity', 'sanity', 'inherited']);
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.map(stepOf), STEPS, verdicts.join('\n'));
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  assert.deepEqual(verdicts, ['PASS content', 'PASS tokens 12/12', 'PASS parity', 'PASS sanity', 'PASS inherited', 'PASS figma']);
  assert.match(r.lines.at(-1), /^summary written: .*summary\.json/);
  assert.deepEqual(['content', 'tokens', 'parity', 'sanity', 'inherited'].map((s) => existsSync(join(out, `${s}.json`))), [false, false, false, false, false], 'the previous step records were deleted first');
  const s = summaryAt(root);
  assert.equal(s.stale, undefined, 'the previous summary.json was replaced');
  assert.equal(s._provenance.writtenBy, 'stardust:reskin/deployed-gate.mjs');
  assert.deepEqual([s.page, s.url, s.regime], ['home', ALL_URL, 'preview']);
  assert.deepEqual(Object.keys(s.steps), STEPS);
  assert.deepEqual(Object.values(s.steps).map((x) => [x.verdict, x.exit]), STEPS.map(() => ['PASS', 0]));
  assert.equal(s.invocation, `deployed-gate.mjs all --page home --dir ${dirOf(root)}`);
  assert.deepEqual(s.ledgerFragment, {
    regime: 'preview', url: ALL_URL, content: 'PASS', tokens: 'PASS', parity: 'PASS', sanity: { verdict: 'PASS', hard: true }, inherited: 'PASS', figma: FRAGMENT, invocation: s.invocation,
  });
  assert.deepEqual(figma.calls(), [{
    argv: ['all', '--page', 'home', '--url', ALL_URL, '--target', 'preview', '--reskin', join(dirOf(root), 'reskin', 'pages', 'home.html'), '--dir', dirOf(root)],
    token: null,
  }]);
  assert.equal(r.args.content.auth, null);
});

await check('all: --reskin reaches parity, sanity and figma-gate and the invocation; without a checks file figma is "not run: no figma checks" and no child starts', async () => {
  const root = allRoot('all-reskin');
  const figma = stubFigma();
  const r = await runAll(root, { figmaGate: figma.file, extra: ['--reskin', 'my page.html'] });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(r.args.parity.reskinPage, 'my page.html');
  assert.equal(r.args.sanity.reskinPage, 'my page.html');
  assert.deepEqual(figma.calls(), []);
  const figmaLine = verdictLines(r.lines).at(-1);
  assert.equal(figmaLine.startsWith('ADVISORY figma not run: no figma checks'), true, figmaLine);
  assert.match(figmaLine, VERDICT_RE);
  const s = summaryAt(root);
  assert.equal(s.ledgerFragment.figma, 'not run: no figma checks');
  assert.deepEqual([s.steps.figma.verdict, s.steps.figma.exit], ['not run: no figma checks', null]);
  assert.equal(s.invocation, `deployed-gate.mjs all --page home --dir ${dirOf(root)} --reskin 'my page.html'`);
  const withChecks = allRoot('all-reskin-figma', { checks: true });
  const figma2 = stubFigma();
  await runAll(withChecks, { figmaGate: figma2.file, extra: ['--reskin', 'my page.html'] });
  assert.equal(figma2.calls()[0].argv[figma2.calls()[0].argv.indexOf('--reskin') + 1], 'my page.html');
});

await check('all: failing steps are "FAIL k/n" in the fragment (sanity with hard: true), their findings sit indented under one verdict line each, and the exit is 1', async () => {
  const root = allRoot('all-fail');
  const r = await runAll(root, {
    over: {
      content: () => ({ verdict: 'FAIL', unusedDeltas: ['T9'], gates: [gateOf('dom-equality', 1, { lines: ['FAIL text diverges at char 12'] }), gateOf('slot-coverage')] }),
      tokens: () => ({ verdict: 'FAIL', exit: 1, total: 12, failures: ['page bg: got rgb(0, 0, 0), want rgb(255, 255, 255)', 'body fg: got red, want blue'], skipped: [] }),
      parity: () => ({ verdict: 'FAIL', exit: 1, rows: [rowOf('pixel', 1440, 'FAIL', '13%', '≤ 10%'), rowOf('pixel', 360, 'PASS', '1%', '≤ 10%'), rowOf('height', 1440, 'PASS', 'Δh 0px', '≤ 5%'), rowOf('height', 360, 'FAIL', 'Δh +90px', '≤ 5%'), rowOf('header crop', 1440, 'n/a', 'n/a: reskin page renders no chrome'), rowOf('chrome-parity', 1440, 'ADVISORY', '2 delta(s)')] }),
      sanity: () => ({ verdict: 'FAIL', exit: 1, hard: true, rows: [rowOf('overflow', 1440, 'PASS'), rowOf('overflow', 360, 'FAIL', '240px', '≤ 4px'), rowOf('decoration', 360, 'PASS')] }),
      inherited: () => ({ verdict: 'FAIL', exit: 1, rows: [rowOf('.plain.html', null, 'FAIL', '2 <h1>', 'one <h1>'), rowOf('ai-readability', null, 'PASS', '99', '≥ 98'), rowOf('qa-gate', null, 'n/a', 'n/a: run deploy Step 2b')] }),
    },
  });
  assert.equal(r.code, 1, r.lines.join('\n'));
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.map(stepOf), STEPS, r.lines.join('\n'));
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  assert.deepEqual(verdicts.slice(0, 5), ['FAIL content: dom-equality', 'FAIL tokens 2/12', 'FAIL parity 2/4', 'FAIL sanity (hard) 1/3', 'FAIL inherited 1/2']);
  for (const finding of ['  dom-equality — report dom-equality.md', '    FAIL text diverges at char 12', '  WARNING unused delta T9', '  page bg: got rgb(0, 0, 0), want rgb(255, 255, 255)', '  pixel @1440: 13% (bar ≤ 10%)', '  height @360: Δh +90px (bar ≤ 5%)', '  overflow 240px > 4px @360', '  .plain.html: 2 <h1>']) {
    assert.ok(r.lines.includes(finding), `${finding}\n${r.lines.join('\n')}`);
  }
  assert.ok(r.lines.some((l) => /^ {2}ADVISORY chrome-parity @1440/.test(l)), 'an advisory row stays visible, indented');
  const f = summaryAt(root).ledgerFragment;
  assert.deepEqual([f.content, f.tokens, f.parity, f.inherited], ['FAIL 1/2', 'FAIL 2/12', 'FAIL 2/4', 'FAIL 1/2']);
  assert.deepEqual(f.sanity, { verdict: 'FAIL 1/3', hard: true });
  assert.equal(f.figma, 'not run: no figma checks');
  assert.deepEqual(Object.values(summaryAt(root).steps).map((x) => x.exit).slice(0, 5), [1, 1, 1, 1, 1]);
});

await check('all: an advisory content gate is "ADVISORY …" and a protected preview\'s parity and sanity are "n/a: protected preview": exit 0, every line still matches VERDICT_RE', async () => {
  const root = allRoot('all-advisory', { record: { auth: true } });
  const na = (...checks) => checks.map((c) => rowOf(c, 1440, 'n/a', 'n/a: protected preview'));
  const r = await runAll(root, {
    extra: ['--auth-header', `token ${ALL_TOKEN}`],
    over: {
      content: () => ({ verdict: 'ADVISORY', unusedDeltas: [], gates: [gateOf('dom-equality', 0, { advisory: true, lines: ['FAIL text diverges at char 12'] }), gateOf('slot-coverage')] }),
      parity: () => ({ verdict: 'n/a', exit: 0, rows: na('pixel', 'height') }),
      sanity: () => ({ verdict: 'n/a', exit: 0, hard: true, rows: na('overflow') }),
    },
  });
  assert.equal(r.code, 0, r.lines.join('\n'));
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.map(stepOf), STEPS);
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  assert.match(verdicts[0], /^ADVISORY content: dom-equality/);
  assert.match(verdicts[2], /^ADVISORY parity n\/a: protected preview/);
  assert.match(verdicts[3], /^ADVISORY sanity n\/a: protected preview/);
  assert.ok(r.lines.includes('    FAIL text diverges at char 12'));
  const f = summaryAt(root).ledgerFragment;
  assert.deepEqual([f.content, f.parity, f.sanity], ['ADVISORY dom-equality (deltas.blocking false)', 'n/a: protected preview', { verdict: 'n/a: protected preview', hard: true }]);
  assert.deepEqual([r.args.content.auth, r.args.tokens.auth, r.args.inherited.auth], Array(3).fill(`token ${ALL_TOKEN}`), 'the steps that take the token get it');
  for (const name of ['parity', 'sanity']) assert.equal('auth' in r.args[name], false, `${name} takes no token`);
  assert.equal(JSON.stringify([r.lines, summaryAt(root)]).includes(ALL_TOKEN), false);
});

await check('all: a step that throws is "ERROR (exit 124) <step>: <message>" (redacted) and the run goes on; a step whose rows gave no verdict is the same; the exit is 124', async () => {
  const root = allRoot('all-error');
  const r = await runAll(root, {
    extra: ['--auth-header', `token ${ALL_TOKEN}`],
    over: {
      tokens: () => { throw new Error(`donor-probe did not start: ${ALL_TOKEN} is not a command`); },
      sanity: () => ({ verdict: 'ERROR', exit: 124, hard: true, rows: [rowOf('overflow', 1440, 'ERROR', 'ERROR (exit 124)'), rowOf('decoration', 1440, 'PASS'), rowOf('clip-probe', 1440, 'ERROR', 'ERROR (exit 124)')] }),
      parity: () => ({ verdict: 'FAIL', exit: 1, rows: [rowOf('pixel', 1440, 'FAIL', '13%', '≤ 10%')] }),
    },
  });
  assert.equal(r.code, 124, r.lines.join('\n'));
  assert.deepEqual(r.called, ['content', 'tokens', 'parity', 'sanity', 'inherited'], 'the run went on after the throw');
  const verdicts = verdictLines(r.lines);
  assert.equal(verdicts[1], 'ERROR (exit 124) tokens: donor-probe did not start: [redacted] is not a command');
  assert.equal(verdicts[3], 'ERROR (exit 124) sanity: 2 checks gave no verdict');
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  const s = summaryAt(root);
  assert.equal(s.ledgerFragment.tokens, 'ERROR (exit 124): donor-probe did not start: [redacted] is not a command');
  assert.deepEqual(s.ledgerFragment.sanity, { verdict: 'ERROR (exit 124): 2 checks gave no verdict', hard: true });
  assert.deepEqual([s.steps.tokens.verdict, s.steps.tokens.exit, s.steps.parity.exit], ['ERROR', 124, 1]);
  assert.equal(JSON.stringify([r.lines, s]).includes(ALL_TOKEN), false, 'the token is in neither the lines nor summary.json');
});

await check('all: a bot challenge (exit 3) in any step stops the rest: "ERROR (exit 3) <step> not run: bot challenge", the run exits 3 over a 124 or a 1', async () => {
  const root = allRoot('all-challenge', { checks: true });
  const figma = stubFigma();
  const r = await runAll(root, {
    figmaGate: figma.file,
    over: {
      content: () => ({ verdict: 'FAIL', unusedDeltas: [], gates: [gateOf('dom-equality', 1), gateOf('slot-coverage')] }),
      tokens: () => { throw Object.assign(new Error('bot challenge at the preview'), { code: 3 }); },
    },
  });
  assert.equal(r.code, 3, r.lines.join('\n'));
  assert.deepEqual(r.called, ['content', 'tokens'], 'no step after the challenge started');
  assert.deepEqual(figma.calls(), [], 'figma-gate was not started either');
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.slice(1), [
    'ERROR (exit 3) tokens: bot challenge at the preview',
    'ERROR (exit 3) parity not run: bot challenge',
    'ERROR (exit 3) sanity not run: bot challenge',
    'ERROR (exit 3) inherited not run: bot challenge',
    'ERROR (exit 3) figma not run: bot challenge',
  ]);
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  const f = summaryAt(root).ledgerFragment;
  assert.deepEqual([f.content, f.tokens, f.parity, f.inherited, f.figma], ['FAIL 1/2', 'ERROR (exit 3): bot challenge at the preview', 'not run: bot challenge', 'not run: bot challenge', 'not run: bot challenge']);
  assert.deepEqual(f.sanity, { verdict: 'not run: bot challenge', hard: true });
});

await check('all: the exit is the first present of 2, 3, 124, 1, 0; a setup error (exit 2) in a step stops the run and writes no summary', async () => {
  const lost = () => ({ verdict: 'ERROR', exit: 124, rows: [rowOf('pixel', 1440, 'ERROR', 'ERROR (exit 124)')] });
  const bad = () => ({ verdict: 'FAIL', exit: 1, rows: [rowOf('pixel', 1440, 'FAIL', '13%', '≤ 10%')] });
  const root = allRoot('all-order');
  assert.equal((await runAll(root, { over: { parity: lost, sanity: () => ({ ...bad(), hard: true }) } })).code, 124, '124 over 1');
  assert.equal((await runAll(root, { over: { parity: bad } })).code, 1);
  assert.equal((await runAll(root, { over: { parity: lost, inherited: () => { throw Object.assign(new Error('challenge'), { code: 3 }); } } })).code, 3, '3 over 124');

  const stopped = allRoot('all-usage');
  writeFileSync(join(deployedDir(dirOf(stopped), 'home'), 'summary.json'), '{"stale":true}\n');
  const r = await runAll(stopped, { over: { tokens: () => { throw new UsageError('missing donor-tokens.json: …'); }, parity: lost } });
  assert.ok(r.error instanceof UsageError && r.error.code === 2 && /donor-tokens\.json/.test(r.error.message), String(r.error));
  assert.deepEqual(r.called, ['content', 'tokens'], 'nothing ran after the setup error');
  assert.ok(!existsSync(join(deployedDir(dirOf(stopped), 'home'), 'summary.json')), 'no summary of a run that did not complete, and the old one is gone');
});

await check('all: a step whose gate stalls on the decoration (exit 2 "stalled decoration: …") is that step\'s FAIL, not a setup error: the run goes on, summary.json is written, the exit is 1', async () => {
  const stall = (gate) => () => { throw new UsageError(`[${gate}] stalled decoration: block cards`); };
  const hardRows = [rowOf('overflow', 1440, 'PASS'), rowOf('decoration', 1440, 'FAIL', 'block cards', 'all loaded')];
  const root = allRoot('all-stalled', { checks: true });
  const figma = stubFigma({ exit: 2, summary: null, stderr: 'figma-gate: [donor-probe] stalled decoration: block cards, block hero\n' });
  const r = await runAll(root, { figmaGate: figma.file, over: { content: stall('dom-equality'), tokens: stall('donor-probe'), sanity: () => ({ verdict: 'FAIL', exit: 1, hard: true, rows: hardRows }) } });
  assert.equal(r.error, null, String(r.error));
  assert.equal(r.code, 1, r.lines.join('\n'));
  assert.deepEqual(r.called, ['content', 'tokens', 'parity', 'sanity', 'inherited'], 'the run went on after the stall');
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.map(stepOf), STEPS, r.lines.join('\n'));
  for (const l of verdicts) assert.match(l, VERDICT_RE, l);
  assert.deepEqual(verdicts, [
    'FAIL content: stalled decoration: block cards', 'FAIL tokens: stalled decoration: block cards', 'PASS parity', 'FAIL sanity (hard) 1/2', 'PASS inherited',
    'FAIL figma: stalled decoration: block cards, block hero',
  ]);
  assert.ok(r.lines.includes('  decoration: block cards @1440'), 'sanity records its hard decoration FAIL');
  const s = summaryAt(root);
  assert.deepEqual(Object.values(s.steps).map((x) => [x.verdict, x.exit]), [['FAIL', 1], ['FAIL', 1], ['PASS', 0], ['FAIL', 1], ['PASS', 0], ['FAIL', 1]]);
  assert.deepEqual(s.ledgerFragment, {
    regime: 'preview', url: ALL_URL, content: 'FAIL stalled decoration: block cards', tokens: 'FAIL stalled decoration: block cards', parity: 'PASS', sanity: { verdict: 'FAIL 1/2', hard: true },
    inherited: 'PASS', figma: 'FAIL stalled decoration: block cards, block hero', invocation: s.invocation,
  });

  const lone = await runAll(allRoot('all-stalled-lone'), { over: { content: stall('slot-coverage') } });
  assert.equal(lone.error, null, String(lone.error));
  assert.equal(lone.code, 1, 'one stalled step is exit 1, not 2');
});

await check('all: a protected preview with no token is exit 2 before anything starts: no step, no figma-gate, no summary.json', async () => {
  const protectedRoot = allRoot('all-protected-no-token', { record: { auth: true }, checks: true });
  const figma = stubFigma();
  writeFileSync(join(deployedDir(dirOf(protectedRoot), 'home'), 'summary.json'), '{"stale":true}\n');
  const missing = await runAll(protectedRoot, { figmaGate: figma.file });
  assert.ok(missing.error instanceof UsageError && missing.error.code === 2, String(missing.error));
  assert.match(missing.error.message, /^all needs the site token to read a protected preview\npreview\.json says .*pass --auth-header or --token-env/);
  assert.deepEqual(missing.called, [], 'no step ran');
  assert.deepEqual(figma.calls(), [], 'no figma-gate child started');
  assert.ok(!existsSync(join(deployedDir(dirOf(protectedRoot), 'home'), 'summary.json')));
  const served = await runAll(protectedRoot, { figmaGate: figma.file, extra: ['--auth-header', `token ${ALL_TOKEN}`] });
  assert.equal(served.error, null, String(served.error));
  assert.deepEqual(served.called, ['content', 'tokens', 'parity', 'sanity', 'inherited'], 'with a token the run starts');
});

await check('all: a step that passed with n/a rows is "PASS (n/a: <checks>)" in the fragment, one without is "PASS"; the verdict line and the step record stay PASS and the reasons stay in the detail', async () => {
  const root = allRoot('all-na');
  const na = (check, width, reason) => rowOf(check, width, 'n/a', reason);
  const crop = 'n/a: reskin page renders no chrome';
  const r = await runAll(root, {
    over: {
      parity: () => ({ verdict: 'PASS', exit: 0, rows: [rowOf('pixel', 1440, 'PASS'), na('header crop', 1440, crop), na('header crop', 360, crop), na('footer crop', 1440, crop)] }),
      inherited: () => ({ verdict: 'PASS', exit: 0, rows: [rowOf('.plain.html', null, 'PASS'), na('ai-readability', null, 'n/a: protected preview'), na('qa-gate', null, 'n/a: run deploy Step 2b')] }),
    },
  });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(verdictLines(r.lines).slice(0, 5), ['PASS content', 'PASS tokens 12/12', 'PASS parity', 'PASS sanity', 'PASS inherited']);
  const s = summaryAt(root);
  const f = s.ledgerFragment;
  assert.deepEqual([f.content, f.tokens, f.parity, f.sanity, f.inherited], ['PASS', 'PASS', 'PASS (n/a: header crop, footer crop)', { verdict: 'PASS', hard: true }, 'PASS (n/a: ai-readability, qa-gate)']);
  assert.deepEqual([s.steps.parity.verdict, s.steps.inherited.verdict], ['PASS', 'PASS']);
  assert.ok(s.steps.parity.detail.some((l) => l.includes(crop)), s.steps.parity.detail.join('\n'));
  assert.ok(s.steps.inherited.detail.some((l) => l.includes('n/a: run deploy Step 2b')), s.steps.inherited.detail.join('\n'));
});

await check('all: a skipped preview is every step "not run: skipped", figma included, exit 0, and nothing is started', async () => {
  const root = allRoot('all-skipped', { checks: true, record: { skipped: true, reason: 'not an aem-boilerplate project (no head.html at the project root)', url: null, origin: null, plain: null } });
  const figma = stubFigma();
  const r = await runAll(root, { figmaGate: figma.file });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(r.called, []);
  assert.deepEqual(figma.calls(), []);
  const verdicts = verdictLines(r.lines);
  assert.deepEqual(verdicts.map(stepOf), STEPS);
  for (const l of verdicts) {
    assert.match(l, /^ADVISORY \S+ not run: skipped/, l);
    assert.match(l, VERDICT_RE, l);
  }
  assert.ok(r.lines.some((l) => /not an aem-boilerplate project/.test(l)), 'the reason is shown');
  const s = summaryAt(root);
  assert.deepEqual(s.ledgerFragment, {
    regime: 'preview', url: null, content: 'not run: skipped', tokens: 'not run: skipped', parity: 'not run: skipped', sanity: { verdict: 'not run: skipped', hard: true }, inherited: 'not run: skipped', figma: 'not run: skipped', invocation: s.invocation,
  });
  assert.deepEqual(Object.values(s.steps).map((x) => [x.verdict, x.exit]), STEPS.map(() => ['not run: skipped', null]));
});

await check('all: figma-gate\'s exit 1 is "FAIL figma" with its fragment; 3 and 124 are ERROR lines with those exits; an exit 2, any other exit or no summary.json are as documented', async () => {
  const failing = { ...FRAGMENT, geometry: 'FAIL 2/10', ramp: 'FAIL 1/8' };
  const run = async (name, stub, extra = []) => {
    const root = allRoot(name, { checks: true });
    const figma = stubFigma(stub);
    const stale = join(dirOf(root), '.work', 'reskin', 'gates', 'home', 'figma');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'summary.json'), JSON.stringify({ regime: 'preview', ledgerFragment: { stale: true } }));
    const r = await runAll(root, { figmaGate: figma.file, extra });
    return { ...r, root, figma, line: verdictLines(r.lines).at(-1), fragment: existsSync(join(deployedDir(dirOf(root), 'home'), 'summary.json')) ? summaryAt(root).ledgerFragment : null };
  };
  const one = await run('fig-1', { exit: 1, summary: { regime: 'preview', ledgerFragment: failing } });
  assert.equal(one.code, 1);
  assert.equal(one.line, 'FAIL figma: geometry FAIL 2/10, ramp FAIL 1/8');
  assert.deepEqual(one.fragment.figma, failing);
  const three = await run('fig-3', { exit: 3, summary: null, stdout: 'ERROR (exit 3) join CHALLENGE: bot challenge\n' });
  assert.equal(three.code, 3);
  assert.equal(three.line, 'ERROR (exit 3) figma: join CHALLENGE: bot challenge');
  assert.equal(three.fragment.figma, 'ERROR (exit 3): join CHALLENGE: bot challenge');
  const lost = await run('fig-124', { exit: 124, summary: null, stdout: 'PASS join: 2 section(s)\nERROR (exit 124) geometry CRASH: page crashed\n' });
  assert.equal(lost.code, 124);
  assert.equal(lost.line, 'ERROR (exit 124) figma: geometry CRASH: page crashed');
  const other = await run('fig-7', { exit: 7, summary: null, stderr: 'figma-gate: something odd\n' });
  assert.equal(other.code, 124);
  assert.equal(other.line, 'ERROR (exit 124) figma: figma-gate exited 7: figma-gate: something odd');
  const quiet = await run('fig-nosummary', { exit: 0, summary: null });
  assert.equal(quiet.code, 124, 'a stale summary.json from an earlier run is no verdict');
  assert.equal(quiet.line, 'ERROR (exit 124) figma: figma-gate exited 0 but wrote no summary.json for the preview run');
  const local = await run('fig-local', { exit: 0, summary: { regime: 'local', ledgerFragment: FRAGMENT } });
  assert.equal(local.code, 124, 'a local-regime summary is not the deployed leg\'s');
  const setup = await run('fig-2', { exit: 2, summary: null, stderr: 'figma-gate: missing donor-tokens.json: write it first\n' });
  assert.ok(setup.error instanceof UsageError && setup.error.code === 2 && /missing donor-tokens\.json: write it first/.test(setup.error.message), String(setup.error));
  assert.ok(!existsSync(join(deployedDir(dirOf(setup.root), 'home'), 'summary.json')), 'a setup error writes no summary');
  assert.deepEqual(setup.called, ['content', 'tokens', 'parity', 'sanity', 'inherited']);
});

await check('all: the site token reaches the figma-gate child by environment and --token-env, never argv, and is redacted from what the child prints', async () => {
  const root = allRoot('all-figma-token', { checks: true, record: { auth: true } });
  const figma = stubFigma({ exit: 3, summary: null, stdout: `ERROR (exit 3) join CHALLENGE: the preview answered token ${ALL_TOKEN}\n`, stderr: `warning ${ALL_TOKEN}\n` });
  const r = await runAll(root, { figmaGate: figma.file, extra: ['--auth-header', `token ${ALL_TOKEN}`] });
  assert.equal(r.code, 3);
  const [call] = figma.calls();
  assert.equal(call.token, `token ${ALL_TOKEN}`);
  assert.deepEqual(call.argv.slice(call.argv.indexOf('--token-env')), ['--token-env', 'DEPLOYED_GATE_SITE_TOKEN', '--dir', dirOf(root)]);
  assert.equal(call.argv.some((a) => a.includes(ALL_TOKEN) || a === '--auth-header'), false, 'no token in argv');
  assert.equal(JSON.stringify([r.lines, summaryAt(root)]).includes(ALL_TOKEN), false, 'the token is in neither the lines nor summary.json');
  assert.equal(summaryAt(root).invocation, `deployed-gate.mjs all --page home --dir ${dirOf(root)} --auth-header [redacted]`);
  assert.equal(summaryAt(root).ledgerFragment.figma, 'ERROR (exit 3): join CHALLENGE: the preview answered [redacted]');
  process.env.STARDUST_T12_TOKEN = ALL_TOKEN;
  try {
    const viaEnv = await runAll(root, { figmaGate: stubFigma().file, extra: ['--token-env', 'STARDUST_T12_TOKEN'] });
    assert.equal(viaEnv.code, 0, viaEnv.lines.join('\n'));
    assert.equal(summaryAt(root).invocation, `deployed-gate.mjs all --page home --dir ${dirOf(root)} --token-env [redacted]`);
  } finally { delete process.env.STARDUST_T12_TOKEN; }
});

await check('all: setup errors are exit 2 and write nothing but the removal of the old summary: no --page, no record, a record with problems; --help documents all', async () => {
  const root = project('all-setup');
  const noPage = await run(['all', '--dir', 'stardust'], { cwd: root });
  assert.equal(noPage.status, 2, noPage.all);
  assert.match(noPage.stderr, /all needs --page <slug>/);
  const noRecord = await run(['all', '--page', 'home'], { cwd: root });
  assert.equal(noRecord.status, 2, noRecord.all);
  assert.match(noRecord.stderr, /preview\.json: run deployed-gate preview --page home first/);
  const slug = await run(['all', '--page', '../x'], { cwd: root });
  assert.equal(slug.status, 2, slug.all);
  assert.match(slug.stderr, /--page must be a slug/);
  const problems = allRoot('all-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  writeFileSync(join(deployedDir(dirOf(problems), 'home'), 'summary.json'), '{"stale":true}\n');
  const bad = await run(['all', '--page', 'home'], { cwd: problems });
  assert.equal(bad.status, 2, bad.all);
  assert.match(bad.stderr, /preview has problems: run deployed-gate preview again \(1 recorded/);
  assert.ok(!existsSync(join(deployedDir(dirOf(problems), 'home'), 'summary.json')), 'the old summary.json is gone');
  const unknown = await run(['all', '--page', 'home', '--org', 'o'], { cwd: problems });
  assert.equal(unknown.status, 2, unknown.all);
  assert.match(unknown.stderr, /unknown flag --org for all/);
  const help = await run(['--help']);
  assert.equal(help.status, 0);
  for (const text of ['all --page <slug> [--reskin <file>]', 'run-bg.mjs start --name deployed-<slug>', 'ledgerFragment', 'summary.json', 'first present of 2, 3, 124, 1, 0']) assert.ok(help.stdout.includes(text), `the help says ${text}`);
});

await check('a site token never echoes in a usage error: not as --flag=value, not as --flag:value, not as the stray rest of an unquoted header, not as a "command" ahead of the real one', async () => {
  const root = allRoot('all-echo');
  const header = `token ${ALL_TOKEN}`;
  const cases = [
    [['all', '--page', 'home', `--auth-header=${ALL_TOKEN}`], /unknown flag --auth-header for all: a flag and its value are separate arguments/],
    [['all', '--page', 'home', `--token-env=${ALL_TOKEN}`], /unknown flag --token-env for all/],
    [['all', '--page', 'home', `--auth-header:${header}`], /unknown flag --auth-header for all: a flag and its value are separate arguments \(--auth-header <value>\)/],
    [['all', '--page', 'home', `--token-env:${ALL_TOKEN}`], /unknown flag --token-env for all/],
    [['all', '--page', 'home', '--auth-header', 'token', ALL_TOKEN], /unexpected argument: quote the value of --auth-header/],
    [['content', '--page', 'home', '--auth-header', 'token', ALL_TOKEN], /unexpected argument: quote the value of --auth-header/],
    [[`--auth-header=${header}`, 'all', '--page', 'home'], /unknown command \(not echoed/],
    [[`--auth-header:${header}`, 'all', '--page', 'home'], /unknown command \(not echoed/],
    [[`--token-env=${ALL_TOKEN}`, 'all', '--page', 'home'], /unknown command \(not echoed/],
    [[header, 'all', '--page', 'home'], /unknown command \(not echoed/],
    [[`secret:${ALL_TOKEN}`, '--page', 'home'], /unknown command \(not echoed/],
  ];
  for (const [args, re] of cases) {
    const r = await run(args, { cwd: root, env: { SITE_TOKEN: '' } });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.all}`);
    assert.match(r.stderr, re);
    assert.equal(r.all.includes(ALL_TOKEN), false, `the token was echoed for ${args.join(' ')}`);
  }
  const plain = await run(['frobnicate', '--page', 'home'], { cwd: root });
  assert.match(plain.stderr, /unknown command "frobnicate"/, 'a plain word is still named');
});

await check('a token typed as the --token-env name is never echoed: not a name is exit 2 without the value, an unset name is reported without it, for every step that takes the flag', async () => {
  const root = allRoot('all-token-name');
  const notAName = 'hlxtok-canary-7f3a91';
  const nameShaped = 'hlxtokcanary7f3a91';
  const steps = [['preview', ...PAGE, '--namespace', 'ns'], ['content', '--page', 'home'], ['tokens', '--page', 'home'], ['inherited', '--page', 'home'], ['all', '--page', 'home']];
  const cases = [
    [notAName, /--token-env takes the name of an environment variable \(letters, digits and underscores\), not the token/],
    ['9starts-with-a-digit', /--token-env takes the name of an environment variable/],
    [nameShaped, /no site token: the variable --token-env names is not set in the environment or \.env/],
  ];
  for (const step of steps) {
    for (const [value, pattern] of cases) {
      const r = await run([...step, '--token-env', value], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: 'http://127.0.0.1:9' } });
      assert.equal(r.status, 2, `${step[0]} ${value}: ${r.all}`);
      assert.match(r.stderr, pattern, `${step[0]} ${value}`);
      assert.equal(r.all.includes(value) || r.all.includes(value.slice(4, -2)), false, `${step[0]}: the value of --token-env was echoed:\n${r.all}`);
    }
  }
});

// ---- all, for real: the fake servers, real browsers, the real instruments and the real figma-gate ---------------------------

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  the real runs of all (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const TESTS = dirname(fileURLToPath(import.meta.url));
  const HOME = fixturePath('home.html');
  const FIGMA_FIXTURES = join(TESTS, 'fixtures', 'figma-gate');
  const CANARY = 'canary-123';
  const walk = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

  // The home fixture with `pairs` of [from, to] replaced → the path of a file in the scratch directory.
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
  // The same copy as a static reskin page: shown from the start, every section and block already decorated, the image
  // inline (the preview serves the same pixels from its media URL).
  const reskinPage = () => {
    const file = join(scratch, 'reskin-static.html');
    const hero = `data:image/png;base64,${solidPng(320, 180, [198, 214, 232]).toString('base64')}`;
    writeFileSync(file, readFileSync(HOME, 'utf8')
      .replace('body { display: none;', 'body { display: block;')
      .replaceAll('data-section-status="initialized"', 'data-section-status="loaded"')
      .replaceAll('data-block-status="initialized"', 'data-block-status="loaded"')
      .replace(/src="\.\/media_[0-9a-f]+\.png[^"]*"/, () => `src="${hero}"`));
    return file;
  };

  // An eligible project holding what every step reads: the content model of the live source (at `source`), the delta file,
  // the donor tokens and, with `figma`, M2b's capture of the kit, its page and its checks file (the deployed DOM's selectors added).
  const PREVIEW_SELECTORS = { '.container': '.default-content-wrapper', '.btn': 'a.button', '.card': '.cards > div', '.feature': '.cards > p', '.card-label': '.badge' };
  const realProject = (name, source, { figma = false } = {}) => {
    const root = project(name);
    const reskin = join(root, 'stardust', 'reskin');
    if (figma) makeProject(root);
    mkdirSync(join(reskin, 'content-model', 'home'), { recursive: true });
    mkdirSync(join(reskin, 'deltas'), { recursive: true });
    writeFileSync(join(reskin, 'content-model', 'home', 'content-model.json'), `${JSON.stringify(loadSourceModel(source.origin), null, 2)}\n`);
    writeFileSync(join(reskin, 'deltas', 'home.json'), readFileSync(fixturePath('deltas.json')));
    writeFileSync(join(reskin, 'donor-tokens.json'), readFileSync(join(FIGMA_FIXTURES, 'donor-tokens.json')));
    if (figma) {
      const checks = read(FIGMA_FIXTURES, 'checks.json');
      for (const section of Object.values(checks.sections)) {
        for (const e of [...section.geometry, ...section.type]) if (PREVIEW_SELECTORS[e.selector]) e.previewSelector = PREVIEW_SELECTORS[e.selector];
      }
      writeFileSync(join(reskin, 'figma-checks', 'home.json'), `${JSON.stringify(checks, null, 2)}\n`);
    }
    return root;
  };
  const allIn = (root, origin, extra = [], env = {}) => run(['all', '--page', 'home', ...extra], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: origin, ...env } });

  await check('real run on a clean public preview: preview then all exits 0, six verdict lines match VERDICT_RE, every step measured and recorded, the fragment is PASS throughout (a step with n/a rows lists them)', async () => {
    const source = await startSourceServer();
    const server = await startPreviewServer({ pages: { '/ns/home': HOME } });
    try {
      const root = realProject('real-pass', source);
      const reskin = reskinPage();
      const p = await preview(root, server.origin);
      assert.equal(p.status, 0, p.all);
      const r = await allIn(root, server.origin, ['--reskin', reskin]);
      assert.equal(r.status, 0, r.all);
      const verdicts = verdictLines(r.stdout.split('\n'));
      assert.deepEqual(verdicts.map(stepOf), STEPS, r.stdout);
      for (const l of verdicts) assert.match(l, VERDICT_RE, l);
      assert.deepEqual(verdicts.slice(0, 5).map((l) => l.split(' ')[0]), Array(5).fill('PASS'), r.stdout);
      assert.match(verdicts[1], /^PASS tokens (\d+)\/\1$/);
      assert.equal(verdicts[5].startsWith('ADVISORY figma not run: no figma checks'), true, verdicts[5]);
      const s = summaryAt(root);
      const out = deployedDir(dirOf(root), 'home');
      // A step that passed with n/a rows lists their checks (the clean public preview has no eds-schema, so qa-gate is one).
      const passWith = (file) => {
        const checks = [...new Set(read(out, file).rows.filter((x) => x.status === 'n/a').map((x) => x.check))];
        return checks.length ? `PASS (n/a: ${checks.join(', ')})` : 'PASS';
      };
      assert.equal(passWith('inherited.json'), 'PASS (n/a: qa-gate)', 'qa-gate has no schema to read here');
      assert.deepEqual(s.ledgerFragment, {
        regime: 'preview', url: `${server.origin}/ns/home`, content: 'PASS', tokens: 'PASS', parity: passWith('parity.json'), sanity: { verdict: passWith('sanity.json'), hard: true }, inherited: passWith('inherited.json'), figma: 'not run: no figma checks', invocation: s.invocation,
      });
      assert.equal(s.invocation, `deployed-gate.mjs all --page home --reskin ${reskin}`);
      for (const f of ['content.json', 'tokens.json', 'parity.json', 'sanity.json', 'inherited.json', 'summary.json']) assert.ok(existsSync(join(out, f)), f);
      assert.equal(read(out, 'sanity.json').hard, true);
      assert.deepEqual(s._provenance.readArtifacts, ['preview.json', 'content.json', 'tokens.json', 'parity.json', 'sanity.json', 'inherited.json']);
    } finally { await server.close(); await source.close(); }
  });

  await check('real run on a preview that overflows at 360 (parity, the slow instrument, stands in as passed): all exits 1, "FAIL sanity (hard)", the fragment\'s sanity is "FAIL k/n" with hard: true, the other real steps still pass', async () => {
    const source = await startSourceServer();
    const wide = variant('overflowing', ['<body>', '<body>\n<div style="width:600px;height:10px"></div>']);
    const server = await startPreviewServer({ pages: { '/ns/home': wide } });
    try {
      const root = realProject('real-overflow', source);
      assert.equal((await preview(root, server.origin)).status, 0);
      const lines = [];
      const parity = async () => ({ verdict: 'PASS', exit: 0, rows: passing('pixel') });
      const code = await main(['all', '--page', 'home', '--dir', dirOf(root), '--reskin', reskinPage()], { env: { DEPLOY_VERIFY_ORIGIN: server.origin }, log: (m) => lines.push(m), runners: { parity } });
      assert.equal(code, 1, lines.join('\n'));
      const verdicts = verdictLines(lines);
      assert.deepEqual(verdicts.map((l) => l.split(' ')[0]).slice(0, 5), ['PASS', 'PASS', 'PASS', 'FAIL', 'PASS'], lines.join('\n'));
      assert.match(verdicts[3], /^FAIL sanity \(hard\) \d+\/\d+$/);
      for (const l of verdicts) assert.match(l, VERDICT_RE, l);
      assert.ok(lines.includes('  overflow 240px > 4px @360'), lines.join('\n'));
      const f = summaryAt(root).ledgerFragment;
      assert.match(f.sanity.verdict, /^FAIL \d+\/\d+$/);
      assert.equal(f.sanity.hard, true);
      assert.equal(read(deployedDir(dirOf(root), 'home'), 'sanity.json').hard, true);
    } finally { await server.close(); await source.close(); }
  });

  await check('real run on a preview whose cards block never decorates (parity and inherited stand in as passed, the gates\' settle shortened): content and tokens are "FAIL <step>: stalled decoration", sanity\'s hard decoration row fails, exit 1, summary.json is written', async () => {
    const source = await startSourceServer();
    const server = await startPreviewServer({ pages: { '/ns/home': 'home.html' }, stallBlock: 'cards' });
    try {
      const root = realProject('real-stalled', source);
      assert.equal((await preview(root, server.origin)).status, 0);
      const fastProbe = join(scratch, 'donor-probe-fast.mjs');
      writeFileSync(fastProbe, [
        "import { spawn } from 'node:child_process';",
        `const child = spawn(process.execPath, [${JSON.stringify(join(SCRIPTS, 'donor-probe.mjs'))}, ...process.argv.slice(2), '--eds-timeout', '1500'], { stdio: 'inherit' });`,
        "child.on('close', (code) => process.exit(code ?? 1));",
        '',
      ].join('\n'));
      const passed = (...checks) => async () => ({ verdict: 'PASS', exit: 0, rows: passing(...checks) });
      const runners = {
        content: (a) => runContent({ ...a, run: (cmd, args, o) => runChild(cmd, [...args, '--eds-timeout', '1500'], o) }),
        tokens: (a) => runTokens({ ...a, donorProbe: fastProbe }),
        parity: passed('pixel'),
        sanity: (a) => runSanity({ ...a, edsTimeoutMs: 1500 }),
        inherited: passed('.plain.html'),
      };
      const lines = [];
      const code = await main(['all', '--page', 'home', '--dir', dirOf(root), '--reskin', reskinPage()], { env: { DEPLOY_VERIFY_ORIGIN: server.origin }, log: (m) => lines.push(m), runners });
      assert.equal(code, 1, lines.join('\n'));
      const verdicts = verdictLines(lines);
      for (const l of verdicts) assert.match(l, VERDICT_RE, l);
      assert.equal(verdicts[0], 'FAIL content: stalled decoration: block cards', lines.join('\n'));
      assert.equal(verdicts[1], 'FAIL tokens: stalled decoration: block cards', lines.join('\n'));
      assert.match(verdicts[3], /^FAIL sanity \(hard\) \d+\/\d+$/);
      assert.ok(lines.some((l) => /^ {2}decoration: block cards @1440$/.test(l)), lines.join('\n'));
      const s = summaryAt(root);
      assert.deepEqual([s.ledgerFragment.content, s.ledgerFragment.tokens], Array(2).fill('FAIL stalled decoration: block cards'));
      assert.match(s.ledgerFragment.sanity.verdict, /^FAIL \d+\/\d+$/);
      assert.equal(s.ledgerFragment.sanity.hard, true);
      assert.deepEqual([s.steps.content.exit, s.steps.tokens.exit, s.steps.sanity.exit], [1, 1, 1]);
    } finally { await server.close(); await source.close(); }
  });

  await check('real run on a protected preview with the real figma-gate: --auth-header and --token-env both pass, the figma fragment is the ledger\'s, and no file, line or stream holds the token', async () => {
    const source = await startSourceServer();
    const server = await startPreviewServer({ token: CANARY, pages: { '/ns/home': HOME } });
    try {
      const root = realProject('real-protected', source, { figma: true });
      const page = join(root, 'page.html');
      const header = `token ${CANARY}`;
      const p = await preview(root, server.origin, ['--namespace', 'ns', '--auth-header', header]);
      assert.equal(p.status, 0, p.all.replaceAll(CANARY, '[token]'));
      const scanFiles = () => {
        const files = walk(join(dirOf(root), '.work'));
        assert.ok(files.some((f) => f.endsWith(join('deployed', 'summary.json'))) && files.some((f) => f.endsWith(join('figma', 'summary.json'))), 'the scan covers deployed/ and figma/');
        return files.filter((f) => readFileSync(f).includes(CANARY)).map((f) => f.slice(root.length));
      };
      for (const [label, extra, env] of [['--auth-header', ['--auth-header', header], {}], ['--token-env', ['--token-env', 'STARDUST_T12_PREVIEW_TOKEN'], { STARDUST_T12_PREVIEW_TOKEN: CANARY }]]) {
        const r = await allIn(root, server.origin, ['--reskin', page, ...extra], env);
        assert.equal(r.status, 0, `${label}: ${r.all.replaceAll(CANARY, '[token]')}`);
        const verdicts = verdictLines(r.stdout.split('\n'));
        assert.deepEqual(verdicts.map(stepOf), STEPS, r.stdout.replaceAll(CANARY, '[token]'));
        assert.match(verdicts[2], /^ADVISORY parity n\/a: protected preview/);
        assert.match(verdicts[3], /^ADVISORY sanity n\/a: protected preview/);
        assert.equal(verdicts[5], 'PASS figma', verdicts[5]);
        const s = summaryAt(root);
        assert.equal(s.ledgerFragment.parity, 'n/a: protected preview');
        assert.deepEqual(s.ledgerFragment.sanity, { verdict: 'n/a: protected preview', hard: true });
        assert.equal(s.ledgerFragment.figma.regime, 'preview');
        assert.equal(s.ledgerFragment.figma.join, 'PASS');
        assert.equal(s.invocation.includes(CANARY), false);
        assert.match(s.invocation, /--(auth-header|token-env) \[redacted\]/);
        // Scanned after each run: the next one rewrites the files, so a leak of the first would be gone by then.
        assert.deepEqual(scanFiles(), [], `${label}: a file holds the token`);
        assert.deepEqual([r.stdout, r.stderr].filter((text) => text.includes(CANARY)), [], `${label}: stdout or stderr holds the token`);
      }
      assert.ok(server.requests.some((q) => q.headers.authorization === header), 'the token went to the preview');
      assert.deepEqual(server.requests.filter((q) => q.headers.authorization !== header).map((q) => q.path), ['/ns/home.plain.html'], 'only the preview step\'s anonymous first request lacked the token');
    } finally { await server.close(); await source.close(); }
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
