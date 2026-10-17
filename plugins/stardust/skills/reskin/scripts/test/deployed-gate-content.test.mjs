#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-content.test.mjs — A1 of the deployed leg, `deployed-gate content`: the
// preview against the live source, through dom-equality and slot-coverage. runContent first against a stub `run`
// (the argv and environment each gate is started with, the verdict from the exits, the unused deltas, the exit
// mapping), then the CLI against stub gates in the project-copy layout, then the CLI with the real gates against
// the fake preview and the fake source of fixtures/deployed/. The stub checks run anywhere; the browser checks
// need playwright and print a skip line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';
import { main } from '../deployed-gate.mjs';
import { runContent } from '../deployed/content.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { fixturePath, loadSourceModel, startPreviewServer, startSourceServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const TOKEN = 'canary-456';
const HEADER = `token ${TOKEN}`;
const SOURCE = 'http://127.0.0.1:9';
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-content-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const noToken = (...texts) => { for (const t of texts) assert.ok(!t.includes(TOKEN), `the token leaked: …${t.slice(Math.max(0, t.indexOf(TOKEN) - 40), t.indexOf(TOKEN) + 40)}…`); };
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };
const fixtureDeltas = () => readJson(fixturePath('deltas.json'));

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

// A project root with the record of the preview step (unless `preview` is false), the page's content model (its
// _provenance.url at `sourceOrigin`; `model: null` leaves it out) and its delta file (`deltas: null` leaves it
// out; an object is written as it is). `normalize` adds the page's normalization ledger.
const project = (name, { previewUrl = `${SOURCE}/ns/home`, sourceOrigin = SOURCE, preview = true, record = {}, model = loadSourceModel(sourceOrigin), deltas = fixtureDeltas(), normalize = false } = {}) => {
  const root = join(scratch, name);
  const reskin = join(root, 'stardust', 'reskin');
  const write = (rel, body) => { mkdirSync(dirname(join(reskin, rel)), { recursive: true }); writeFileSync(join(reskin, rel), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`); };
  if (model) write('content-model/home/content-model.json', model);
  if (deltas) write('deltas/home.json', deltas);
  if (normalize) write('normalize/home.mjs', 'export const ledger = [];\n');
  if (preview) {
    const out = deployedDir(join(root, 'stardust'), 'home');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'preview.json'), `${JSON.stringify({
      url: previewUrl, origin: new URL(previewUrl).origin, path: '/ns/home', plain: `${previewUrl}.plain.html`, namespace: 'ns', sandbox: false, auth: false, checkedAt: new Date().toISOString(), ...record,
    }, null, 2)}\n`);
  }
  return root;
};
const dirOf = (root) => join(root, 'stardust');
const outOf = (root) => deployedDir(dirOf(root), 'home');
const previewOf = (root) => readJson(join(outOf(root), 'preview.json'));
const recordOf = (root) => readJson(join(outOf(root), 'content.json'));
const modelPath = (root) => join(dirOf(root), 'reskin', 'content-model', 'home', 'content-model.json');
const deltasPath = (root) => join(dirOf(root), 'reskin', 'deltas', 'home.json');
const content = (root, extra = [], opts = {}) => run(['content', '--page', 'home', ...extra], { cwd: root, ...opts });

// A `run` for runContent: records what each gate is started with, writes the report it is asked for (unless
// `report` is false) and answers with the next exit, stdout and stderr.
const stubRun = ({ exits = [0, 0], stdout = ['', ''], stderr = ['', ''], report = true, throws = null } = {}) => {
  const calls = [];
  const stub = async (command, args, options) => {
    const i = calls.length;
    calls.push({ command, args: [...args], env: { ...options.env } });
    if (throws) throw throws;
    const path = args[args.indexOf('--report') + 1];
    if (report) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '# stub report\n'); }
    return { status: exits[i], signal: null, stdout: stdout[i] ?? '', stderr: stderr[i] ?? '' };
  };
  return { run: stub, calls };
};
const ADVISORY_LINE = '[dom-equality] ADVISORY (deltas.blocking false): the failed checks are reported, not enforced — exit 0\n';
const go = (root, opts = {}) => runContent({ dir: dirOf(root), slug: 'home', preview: previewOf(root), ...opts });

// ---- runContent against a stub `run` ----------------------------------------------------------------------------

await check('runContent starts dom-equality, then slot-coverage, beside the CLI with the brief\'s flags; the token goes by environment, an inherited one is replaced, and no argv carries it', async () => {
  const root = project('stub-args', { normalize: true });
  const preview = previewOf(root);
  const { run: stub, calls } = stubRun();
  const r = await go(root, { auth: HEADER, run: stub, env: { ...process.env, DEPLOYED_GATE_SITE_TOKEN: 'stale' } });
  assert.equal(calls.length, 2);
  const out = outOf(root);
  const tokenFlags = ['--token-env', 'DEPLOYED_GATE_SITE_TOKEN'];
  assert.deepEqual(calls[0].args, [join(SCRIPTS, 'dom-equality.mjs'), '--source', `${SOURCE}/`, '--source-scope', 'main', '--normalize', join(dirOf(root), 'reskin', 'normalize', 'home.mjs'),
    '--rendered', preview.url, '--rendered-scope', 'main', '--deltas', deltasPath(root), '--wait-eds', '--report', join(out, 'content-dom-equality.md'), ...tokenFlags]);
  assert.deepEqual(calls[1].args, [join(SCRIPTS, 'slot-coverage.mjs'), '--model', modelPath(root),
    '--rendered', preview.url, '--deltas', deltasPath(root), '--wait-eds', '--report', join(out, 'content-slot-coverage.md'), ...tokenFlags]);
  for (const c of calls) {
    assert.equal(c.command, process.execPath);
    assert.equal(c.env.DEPLOYED_GATE_SITE_TOKEN, HEADER, 'the token arrived by environment');
    assert.ok(!c.args.includes('--auth-header'));
    noToken(c.args.join(' '));
  }
  assert.deepEqual(Object.keys(r).filter((k) => !['gates'].includes(k)), ['verdict', 'domEquality', 'slotCoverage', 'unusedDeltas']);
  assert.deepEqual(r.domEquality, { exit: 0, report: join(out, 'content-dom-equality.md') });
  assert.deepEqual(r.slotCoverage, { exit: 0, report: join(out, 'content-slot-coverage.md') });
});

await check('runContent without a token, a ledger or a delta file passes none of them: no --normalize, no --deltas, no token flag, and an inherited DEPLOYED_GATE_SITE_TOKEN is cleared', async () => {
  const root = project('stub-bare', { deltas: null });
  const { run: stub, calls } = stubRun();
  await go(root, { run: stub, env: { ...process.env, DEPLOYED_GATE_SITE_TOKEN: 'stray' } });
  for (const c of calls) {
    for (const flag of ['--normalize', '--deltas', '--token-env', '--auth-header']) assert.ok(!c.args.includes(flag), `${flag} in ${c.args.join(' ')}`);
    assert.ok(c.args.includes('--wait-eds'));
    assert.equal(c.env.DEPLOYED_GATE_SITE_TOKEN, undefined);
  }
});

await check('the source scope is the model\'s _provenance.scope verbatim, and the source URL its _provenance.url', async () => {
  const model = loadSourceModel('https://src.test');
  model._provenance.scope = 'main,header!';
  const root = project('stub-scope', { model });
  const { run: stub, calls } = stubRun();
  await go(root, { run: stub });
  const arg = (flag) => calls[0].args[calls[0].args.indexOf(flag) + 1];
  assert.equal(arg('--source'), 'https://src.test/');
  assert.equal(arg('--source-scope'), 'main,header!');
  assert.equal(arg('--rendered-scope'), 'main');
});

await check('the verdict follows the exits: both 0 is PASS; both 0 with an ADVISORY line from either gate is ADVISORY; an exit 1 from either is FAIL, advisory or not; both gates always run', async () => {
  const root = project('stub-verdict');
  const verdict = async (opts) => { const { run: stub, calls } = stubRun(opts); const r = await go(root, { run: stub }); assert.equal(calls.length, 2, 'both gates ran'); return r; };
  const pass = await verdict({});
  assert.equal(pass.verdict, 'PASS');
  assert.deepEqual(pass.unusedDeltas, []);
  assert.equal(recordOf(root).verdict, 'PASS');

  const first = await verdict({ stdout: [ADVISORY_LINE, ''] });
  assert.equal(first.verdict, 'ADVISORY');
  assert.deepEqual(first.gates.map((g) => g.advisory), [true, false]);
  const second = await verdict({ stdout: ['', '[slot-coverage] ADVISORY (deltas.blocking false): 2 failed check(s) reported, not enforced — exit 0\n'] });
  assert.equal(second.verdict, 'ADVISORY');
  assert.deepEqual(second.gates.map((g) => g.advisory), [false, true]);
  assert.deepEqual(recordOf(root), { verdict: 'ADVISORY', domEquality: { exit: 0, report: second.domEquality.report }, slotCoverage: { exit: 0, report: second.slotCoverage.report }, unusedDeltas: [] });

  for (const exits of [[1, 0], [0, 1], [1, 1]]) {
    const failing = await verdict({ exits, stdout: [ADVISORY_LINE, ''] });
    assert.equal(failing.verdict, 'FAIL', exits.join());
    assert.deepEqual([failing.domEquality.exit, failing.slotCoverage.exit], exits);
    assert.deepEqual(recordOf(root).verdict, 'FAIL');
    assert.deepEqual([recordOf(root).domEquality.exit, recordOf(root).slotCoverage.exit], exits);
  }
  const noAdvisory = await verdict({ exits: [1, 0], stdout: [ADVISORY_LINE, ''] });
  assert.deepEqual(noAdvisory.gates.map((g) => g.advisory), [false, false], 'an advisory line from a gate that exited 1 is not an advisory');
});

await check('unusedDeltas is the union of the ids the gates warned of, in the order met, each once: an allow id (even one holding ": ") and a metadata.ignore key', async () => {
  const deltas = fixtureDeltas();
  deltas.text.allow.push({ id: 'T2', from: 'zzz', to: '', why: 'nobody needs it' }, { id: 'A: b', from: 'yyy', to: '', why: 'an id with a colon' });
  const root = project('stub-unused', { deltas });
  const { run: stub } = stubRun({
    stdout: [
      '  deltas applied: T1 ×1\n  WARNING unused delta T2: "zzz" matched nothing (nobody needs it)\n  WARNING unused delta A: b: "yyy" matched nothing (an id with a colon)\n',
      '  deltas applied: T1 ×1\n  WARNING unused delta T2: "zzz" matched nothing (nobody needs it)\n  WARNING unused delta metadata.ignore "og:imge": matched nothing\n',
    ],
  });
  const r = await go(root, { run: stub });
  assert.deepEqual(r.unusedDeltas, ['T2', 'A: b', 'metadata.ignore "og:imge"']);
  assert.equal(r.verdict, 'PASS', 'an unused delta is a warning, not a verdict');
  assert.deepEqual(recordOf(root).unusedDeltas, r.unusedDeltas);
});

await check('runContent exit mapping: a gate exit 2 is a UsageError and stops there; exit 3 from either is code 3; any other exit, a missing report or a gate that cannot start is code 124; the gate\'s text is redacted and nothing stale is left', async () => {
  const root = project('stub-exits');
  const out = outOf(root);
  const FILES = ['content.json', 'content-dom-equality.md', 'content-slot-coverage.md'];
  const leave = () => { for (const f of FILES) writeFileSync(join(out, f), 'STALE\n'); };
  const call = (opts, auth = HEADER) => { leave(); const stub = stubRun(opts); return attempt(() => go(root, { auth, run: stub.run })).then((r) => ({ ...r, calls: stub.calls })); };
  // No record, and no report left from an earlier run (a gate that ran this time wrote its own).
  const staleGone = () => {
    assert.ok(!existsSync(join(out, 'content.json')), 'no record after a gate that gave no verdict');
    for (const f of FILES.slice(1)) assert.ok(!existsSync(join(out, f)) || readFileSync(join(out, f), 'utf8') !== 'STALE\n', `stale ${f} was removed`);
  };

  const setup = await call({ exits: [2, 0], stderr: [`[dom-equality] stalled decoration: body.appear (${HEADER})\n`, ''], report: false });
  assert.ok(setup.error instanceof UsageError && setup.error.code === 2, String(setup.error));
  assert.match(setup.error.message, /stalled decoration: body\.appear \(\[redacted\]\)/);
  noToken(setup.error.message);
  assert.equal(setup.calls.length, 1, 'slot-coverage did not run after a setup error');
  staleGone();
  const protectedRecord = { ...previewOf(root), auth: true };
  const never = stubRun({ exits: [2, 0], stderr: ['[dom-equality] HTTP 401\n', ''] });
  const hint = await attempt(() => go(root, { run: never.run, preview: protectedRecord }));
  assert.ok(hint.error instanceof UsageError && hint.error.code === 2, String(hint.error));
  assert.match(hint.error.message, /^content needs the site token to read a protected preview\npreview\.json says .*pass --auth-header or --token-env/);
  assert.equal(never.calls.length, 0, 'a protected preview with no token is refused before the live source is crawled');
  const withToken = stubRun({ exits: [2, 0], stderr: ['[dom-equality] HTTP 401\n', ''], report: false });
  const refused = await attempt(() => go(root, { auth: HEADER, run: withToken.run, preview: protectedRecord }));
  assert.match(refused.error?.message ?? '', /^\[dom-equality\] HTTP 401$/, 'with a token the gates run and a refusal is theirs to report');
  assert.equal(withToken.calls.length, 1);

  const second = await call({ exits: [0, 2], stderr: ['', `[slot-coverage] ${TOKEN} refused\n`] });
  assert.ok(second.error instanceof UsageError, String(second.error));
  noToken(second.error.message);
  staleGone();

  for (const [name, opts] of [['dom-equality', { exits: [3, 0] }], ['slot-coverage', { exits: [1, 3] }]]) {
    const halt = await call({ ...opts, stderr: ['', ''].map((_, i) => (opts.exits[i] === 3 ? `[${i ? 'slot-coverage' : 'dom-equality'}] bot challenge (${TOKEN})\n` : '')) });
    assert.ok(halt.error && halt.error.code === 3 && !(halt.error instanceof UsageError), `${name}: ${String(halt.error)}`);
    assert.match(halt.error.message, /bot challenge \(\[redacted\]\)/, name);
    noToken(halt.error.message);
    staleGone();
  }
  const silent = await call({ exits: [3, 0], stderr: ['', ''] });
  assert.equal(silent.error?.code, 3);
  assert.match(silent.error.message, /^dom-equality exited 3: bot challenge$/);

  for (const [name, opts] of [
    ['exit 7', { exits: [7, 0], stderr: [`crashed ${TOKEN}\n`, ''] }],
    ['exit 124', { exits: [0, 124] }],
    ['no report', { exits: [0, 0], report: false }],
    ['unable to start', { throws: new Error(`spawn failed ${TOKEN}`) }],
  ]) {
    const crash = await call(opts);
    assert.ok(crash.error && crash.error.code === 124 && !(crash.error instanceof UsageError), `${name}: ${String(crash.error)}`);
    noToken(crash.error.message);
    staleGone();
  }
  assert.match((await call({ exits: [7, 0], stderr: [`crashed ${TOKEN}\n`, ''] })).error.message, /^dom-equality did not give a verdict \(exit 7\): crashed \[redacted\]$/);
});

await check('runContent setup errors, each before any gate starts: no content model, no _provenance.url, an invalid delta file, a preview record without a url', async () => {
  const never = () => { throw new Error('a gate must not start'); };
  const errorOf = async (root, opts = {}) => (await attempt(() => go(root, { run: never, ...opts }))).error;
  const noModel = await errorOf(project('setup-no-model', { model: null }));
  assert.ok(noModel instanceof UsageError && /reskin[\\/]content-model[\\/]home[\\/]content-model\.json/.test(noModel.message), String(noModel));
  const sourceless = loadSourceModel('https://src.test');
  delete sourceless._provenance.url;
  const noUrl = await errorOf(project('setup-no-url', { model: sourceless }));
  assert.ok(noUrl instanceof UsageError && /_provenance\.url/.test(noUrl.message), String(noUrl));
  const badDeltas = await errorOf(project('setup-bad-deltas', { deltas: { version: 2 } }));
  assert.ok(badDeltas instanceof UsageError && /deltas .*home\.json/.test(badDeltas.message) && /version must be 1/.test(badDeltas.message), String(badDeltas));
  const noPreviewUrl = await errorOf(project('setup-no-preview-url'), { preview: { origin: 'x' } });
  assert.ok(noPreviewUrl instanceof UsageError && /preview\.json has no url/.test(noPreviewUrl.message), String(noPreviewUrl));
});

// ---- the CLI --------------------------------------------------------------------------------------------------

await check('content on a protected preview with no token is exit 2 before the live source is asked for anything, and writes no record', async () => {
  const source = await startSourceServer();
  try {
    const root = project('cli-protected-no-token', { sourceOrigin: source.origin, previewUrl: 'http://127.0.0.1:9/ns/home', record: { auth: true } });
    const r = await content(root);
    assert.equal(r.status, 2, r.all);
    assert.match(r.stderr, /content needs the site token to read a protected preview/);
    assert.match(r.stderr, /pass --auth-header or --token-env/);
    assert.equal(source.requests.length, 0, 'the live source was not crawled');
    assert.ok(!existsSync(join(outOf(root), 'content.json')));
  } finally { await source.close(); }
});

await check('--help documents content beside preview and tokens; the usage errors of content exit 2 and write nothing', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  const r = await run(['--help'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /deployed-gate\.mjs content --page <slug> \[--auth-header <value> \| --token-env <NAME>\] \[--dir stardust\]/);
  for (const re of [/dom-equality/, /slot-coverage/, /reskin\/content-model\/<slug>\/content-model\.json/, /reskin\/deltas\/<slug>\.json/, /reskin\/normalize\/<slug>\.mjs/, /"blocking": false/, /ADVISORY content:/, /FAIL content:/, /PASS content/, /WARNING unused delta/, /content\.json/, /not run: skipped/]) assert.match(r.stdout, re);
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');

  const root = project('content-usage', { preview: false });
  for (const [args, re] of [
    [['content'], /content needs --page <slug>/],
    [['content', '--page', '../x'], /--page must be a slug/],
    [['content', '--page', 'home', '--org', 'o'], /unknown flag --org for content/],
    [['content', '--page', 'home', '--deltas', 'x.json'], /unknown flag --deltas for content/],
    [['content', '--page', 'home', 'stray'], /unexpected argument "stray"/],
    [['content', '--page'], /--page needs a value/],
    [['content', '--page', 'home', '--auth-header', '--dir', 'x'], /--auth-header needs a value/],
    [['content', '--page', 'home', '--token-env', ' '], /--token-env needs a value/],
    [['content', '--page', 'home', '--auth-header', ''], /--auth-header needs a value/],
  ]) {
    const got = await run(args, { cwd: root });
    assert.equal(got.status, 2, `${args.join(' ')}: ${got.all}`);
    assert.match(got.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');
});

await check('content needs the record of `preview` and the content model: absent record is exit 2 naming deployed-gate preview; problems is exit 2; no model is exit 2 naming the file; a skipped leg is "not run: skipped", exit 0, nothing run', async () => {
  const none = await content(project('rec-absent', { preview: false }));
  assert.equal(none.status, 2, none.all);
  assert.match(none.stderr, /deployed-gate preview/);

  const problems = project('rec-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  const refused = await content(problems);
  assert.equal(refused.status, 2, refused.all);
  assert.match(refused.stderr, /preview has problems: run deployed-gate preview again/);
  assert.ok(!existsSync(join(outOf(problems), 'content.json')));

  const noModel = project('rec-no-model', { model: null });
  const missing = await content(noModel);
  assert.equal(missing.status, 2, missing.all);
  assert.match(missing.stderr, /content-model[\\/]home[\\/]content-model\.json/);
  assert.ok(!existsSync(join(outOf(noModel), 'content.json')));

  // The leg is skipped before anything else is looked at: the model need not exist either.
  const skipped = project('rec-skipped', { model: null, deltas: null, record: { skipped: true, reason: 'not an aem-boilerplate project: missing head.html at the project root', url: null, origin: null, plain: null } });
  const idle = await content(skipped);
  assert.equal(idle.status, 0, idle.all);
  assert.equal(idle.stdout.trim(), 'not run: skipped');
  assert.ok(!existsSync(join(outOf(skipped), 'content.json')), 'nothing written');
});

await check('main dispatches content to a replaceable step and returns its exit code; --help runs before it', async () => {
  const lines = [];
  const code = await main(['content', '--page', 'home'], { log: (m) => lines.push(m), steps: { content: async ({ opts, log }) => { log(`stub ${opts.page}`); return 4; } } });
  assert.equal(code, 4);
  assert.deepEqual(lines, ['stub home']);
  assert.equal(await main(['content', '--help'], { log: () => {}, steps: { content: async () => { throw new Error('must not run'); } } }), 0);
});

await check('the project copy of the scripts finds the gates beside deployed-gate.mjs: a gate exit 3 is exit 3, 2 is 2, an unknown exit 124; FAIL and ADVISORY name the gate and its findings; the token is redacted throughout and reaches the gates by environment', async () => {
  const copy = join(scratch, 'copy');
  cpSync(SCRIPTS, join(copy, 'reskin'), { recursive: true, filter: (src) => src !== join(SCRIPTS, 'test') });
  cpSync(join(SCRIPTS, '..', '..', 'diff', 'scripts'), join(copy, 'diff'), { recursive: true });
  const stubGate = (gate, { exit = 0, stdout = '', stderr = '' } = {}) => {
    const seen = join(scratch, `copy-${gate}.seen.json`);
    writeFileSync(join(copy, 'reskin', `${gate}.mjs`), `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv, token: process.env.DEPLOYED_GATE_SITE_TOKEN ?? null }));
const report = argv[argv.indexOf('--report') + 1];
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, '# stub\\n');
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exit});
`);
    return () => readJson(seen);
  };
  const gates = (dom, slot) => {
    const seen = [stubGate('dom-equality', dom), stubGate('slot-coverage', slot)];
    return run(['content', '--page', 'home', '--auth-header', HEADER], { cwd: project('copy-proj'), script: join(copy, 'reskin', 'deployed-gate.mjs') }).then((r) => ({ ...r, seen }));
  };

  const challenge = await gates({ exit: 3, stderr: `[dom-equality] bot challenge at x (${HEADER})\n` });
  assert.equal(challenge.status, 3, challenge.all);
  assert.match(challenge.stderr, /^deployed-gate: \[dom-equality\] bot challenge at x \(\[redacted\]\)/);
  const setup = await gates({}, { exit: 2, stderr: `[slot-coverage] ${TOKEN} unreachable\n` });
  assert.equal(setup.status, 2, setup.all);
  const crash = await gates({ exit: 9, stderr: `crashed ${TOKEN}\n` });
  assert.equal(crash.status, 124, crash.all);
  assert.match(crash.stderr, /dom-equality did not give a verdict \(exit 9\): crashed \[redacted\]/);

  const fail = await gates({ exit: 1, stderr: `[dom-equality] FAIL — report: x\n  text diverges @12: src="a ${TOKEN}" rnd="b"\n` }, { exit: 1, stdout: `[slot-coverage] FAIL — 17/18 checks — report: y\n  FAIL slot-coverage: s02 text present — missing\n  WARNING unused delta T2: "zzz" matched nothing (why)\n` });
  assert.equal(fail.status, 1, fail.all);
  const lines = fail.stdout.split('\n');
  assert.equal(lines[0], `FAIL content: dom-equality — report ${join('stardust', '.work', 'reskin', 'gates', 'home', 'deployed', 'content-dom-equality.md')}`);
  assert.ok(lines.includes('  text diverges @12: src="a [redacted]" rnd="b"'), fail.stdout);
  assert.ok(lines.some((l) => /^FAIL content: slot-coverage — report .*content-slot-coverage\.md$/.test(l)), fail.stdout);
  assert.ok(lines.includes('  FAIL slot-coverage: s02 text present — missing'), fail.stdout);
  assert.ok(lines.includes('WARNING unused delta T2'), fail.stdout);

  const advisory = await gates({ stdout: ADVISORY_LINE, stderr: '[dom-equality] FAIL — report: x\n' });
  assert.equal(advisory.status, 0, advisory.all);
  assert.match(advisory.stdout.split('\n')[0], /^ADVISORY content: dom-equality — report .*content-dom-equality\.md \(deltas\.blocking false: reported, not enforced\)$/);
  assert.ok(!/^(PASS|FAIL)/m.test(advisory.stdout), advisory.stdout);

  const pass = await gates();
  assert.equal(pass.status, 0, pass.all);
  assert.equal(pass.stdout.trim(), 'PASS content');
  for (const seen of pass.seen) {
    const { argv, token } = seen();
    assert.equal(token, HEADER, 'the copy\'s gate ran with the token in its environment');
    noToken(argv.join(' '));
  }
  noToken(challenge.all, setup.all, crash.all, fail.all, advisory.all, pass.all);
});

// ---- the CLI with the real gates, against the fake preview and the fake source ----------------------------------

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  // The fixture page with one sentence changed, served from a file of its own.
  const changed = join(scratch, 'changed.html');
  const homeHtml = readFileSync(fixturePath('home.html'), 'utf8');
  assert.ok(homeHtml.includes('Everything in one place'), 'the fixture page has its second heading');
  writeFileSync(changed, homeHtml.replace('Everything in one place', 'Everything in one spot'));

  const preview = await startPreviewServer({ pages: { '/ns/home': 'home.html', '/ns/changed': changed } });
  const guarded = await startPreviewServer({ token: TOKEN });
  const source = await startSourceServer();
  const live = (server, path = '/ns/home') => ({ previewUrl: `${server.origin}${path}`, sourceOrigin: source.origin });
  const withDeltas = (change) => { const d = fixtureDeltas(); change(d); return d; };
  const noAuthorization = (server) => server.requests.every((q) => q.headers.authorization === undefined);

  try {
    // Every real run starts together: each is slow, none shares anything with another.
    const runs = {
      pass: content(project('cli-pass', live(preview))),
      guarded: content(project('cli-guarded', { ...live(guarded), record: { auth: true } }), ['--auth-header', HEADER]),
      guardedEnv: content(project('cli-guarded-env', { ...live(guarded), record: { auth: true } }), ['--token-env', 'CONTENT_TEST_TOKEN'], { env: { CONTENT_TEST_TOKEN: TOKEN } }),
      advisory: content(project('cli-advisory', live(preview, '/ns/changed'))),
      blocking: content(project('cli-blocking', { ...live(preview, '/ns/changed'), deltas: withDeltas((d) => { d.blocking = true; }) })),
      undeclared: content(project('cli-undeclared', { ...live(preview), deltas: null })),
      down: (async () => {
        const dead = project('cli-down', { previewUrl: `${SOURCE}/ns/home`, sourceOrigin: source.origin });
        writeFileSync(join(outOf(dead), 'content.json'), '{"verdict":"PASS"}\n');
        return content(dead);
      })(),
      unused: content(project('cli-unused', { ...live(preview), deltas: withDeltas((d) => { d.text.allow.push({ id: 'T2', from: 'zzz', to: '', why: 'a delta nobody needs' }); d.metadata.ignore.push('og:imge'); }) })),
    };
    const done = Object.fromEntries(await Promise.all(Object.entries(runs).map(async ([k, p]) => [k, await p])));
    const root = (name) => join(scratch, name);

    await check('the fixture delta file passes on the fake preview: PASS content, exit 0, no unused delta; content.json holds the verdict, both exits and reports, unusedDeltas []; the reports declare T1 applied', () => {
      const r = done.pass;
      assert.equal(r.status, 0, r.all);
      assert.equal(r.stdout.trim(), 'PASS content');
      const rec = recordOf(root('cli-pass'));
      assert.deepEqual(rec, { verdict: 'PASS', domEquality: { exit: 0, report: rec.domEquality.report }, slotCoverage: { exit: 0, report: rec.slotCoverage.report }, unusedDeltas: [] });
      assert.deepEqual(Object.keys(rec), ['verdict', 'domEquality', 'slotCoverage', 'unusedDeltas']);
      for (const [file, name] of [[rec.domEquality.report, 'content-dom-equality.md'], [rec.slotCoverage.report, 'content-slot-coverage.md']]) {
        assert.equal(file, join('stardust', '.work', 'reskin', 'gates', 'home', 'deployed', name));
        const md = readFileSync(join(root('cli-pass'), file), 'utf8');
        assert.match(md, /\*\*Overall: PASS\*\*|\[x\]/);
        assert.match(md, /## Declared deltas/);
        assert.match(md, /T1 ×1/);
      }
      assert.ok(source.requests.some((q) => q.path === '/') && preview.requests.some((q) => q.path === '/ns/home'), 'both pages were read');
    });

    await check('a protected preview: --auth-header and --token-env both pass; the token reached the preview only, and is in no output, report or record', () => {
      for (const [name, r] of [['cli-guarded', done.guarded], ['cli-guarded-env', done.guardedEnv]]) {
        assert.equal(r.status, 0, `${name}: ${r.all}`);
        assert.equal(r.stdout.trim(), 'PASS content', name);
        noToken(r.all);
        for (const f of readdirSync(outOf(root(name)))) noToken(readFileSync(join(outOf(root(name)), f), 'utf8'));
        assert.equal(recordOf(root(name)).verdict, 'PASS');
      }
      assert.ok(guarded.requests.some((q) => q.headers.authorization === HEADER), 'the preview received the header');
      assert.ok(guarded.requests.every((q) => q.headers.authorization === HEADER), 'every request to the preview carried it: none was refused');
      assert.ok(noAuthorization(source), 'the source never received an Authorization header');
    });

    await check('changed text with "blocking": false is ADVISORY: exit 0, one ADVISORY line per failed gate with its findings, the verdict in content.json', () => {
      const r = done.advisory;
      assert.equal(r.status, 0, r.all);
      const lines = r.stdout.split('\n');
      assert.match(lines[0], /^ADVISORY content: dom-equality — report .*content-dom-equality\.md \(deltas\.blocking false: reported, not enforced\)$/);
      assert.ok(lines.some((l) => /^ADVISORY content: slot-coverage — report .*content-slot-coverage\.md /.test(l)), r.stdout);
      assert.ok(lines.some((l) => /^ {2}text diverges @\d+: /.test(l)), 'dom-equality\'s divergence');
      assert.ok(lines.some((l) => /^ {2}FAIL slot-coverage: .*s02 text present/.test(l)), 'slot-coverage\'s failed check');
      assert.ok(!/^(PASS|FAIL) content/m.test(r.stdout), r.stdout);
      const rec = recordOf(root('cli-advisory'));
      assert.equal(rec.verdict, 'ADVISORY');
      assert.deepEqual([rec.domEquality.exit, rec.slotCoverage.exit], [0, 0]);
      assert.deepEqual(rec.unusedDeltas, []);
      assert.match(readFileSync(join(root('cli-advisory'), rec.domEquality.report), 'utf8'), /\*\*Overall: FAIL\*\*/, 'the report still says the gate failed');
    });

    await check('the same text with "blocking": true is FAIL: exit 1, a FAIL line per failed gate, exits 1 and 1 in content.json', () => {
      const r = done.blocking;
      assert.equal(r.status, 1, r.all);
      const lines = r.stdout.split('\n');
      assert.match(lines[0], /^FAIL content: dom-equality — report .*content-dom-equality\.md$/);
      assert.ok(lines.some((l) => /^FAIL content: slot-coverage — report .*content-slot-coverage\.md$/.test(l)), r.stdout);
      assert.ok(lines.some((l) => /^ {2}text diverges @\d+: /.test(l)) && lines.some((l) => /^ {2}FAIL slot-coverage: .*s02 text present/.test(l)));
      assert.ok(!/ADVISORY|^PASS/m.test(r.stdout), r.stdout);
      const rec = recordOf(root('cli-blocking'));
      assert.equal(rec.verdict, 'FAIL');
      assert.deepEqual([rec.domEquality.exit, rec.slotCoverage.exit], [1, 1]);
    });

    await check('a page without a delta file runs without --deltas and blocks: the source\'s own image URL and text differ from the preview\'s, so it is FAIL, exit 1', () => {
      const r = done.undeclared;
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /^FAIL content: dom-equality/m);
      assert.ok(!/ADVISORY/.test(r.all));
      const rec = recordOf(root('cli-undeclared'));
      assert.equal(rec.verdict, 'FAIL');
      assert.ok(!/Declared deltas/.test(readFileSync(join(root('cli-undeclared'), rec.domEquality.report), 'utf8')), 'no deltas, no section about them');
    });

    await check('an allow entry that matches nothing and an ignore key that names no check land in unusedDeltas, once each, and print one WARNING unused delta line each; the verdict stays PASS', () => {
      const r = done.unused;
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(r.stdout.trim().split('\n'), ['PASS content', 'WARNING unused delta T2', 'WARNING unused delta metadata.ignore "og:imge"']);
      assert.deepEqual(recordOf(root('cli-unused')).unusedDeltas, ['T2', 'metadata.ignore "og:imge"']);
    });

    await check('a preview that does not answer is a setup error (exit 2): no record, no PASS, and a stale one is removed', () => {
      const r = done.down;
      assert.equal(r.status, 2, r.all);
      assert.ok(!/^PASS/m.test(r.stdout));
      assert.ok(!existsSync(join(outOf(root('cli-down')), 'content.json')), 'a stale record is removed');
    });
  } finally { await Promise.all([preview.close(), guarded.close(), source.close()]); }
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
