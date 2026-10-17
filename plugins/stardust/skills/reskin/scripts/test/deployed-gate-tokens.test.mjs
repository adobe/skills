#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-tokens.test.mjs — A2 of the deployed leg, `deployed-gate tokens`: the
// donor tokens asserted on the EDS DOM of the preview. edsSpec (pure) first, then runTokens against stub probes
// (the exit mapping, the token handed over by environment), then the CLI against the fake preview of
// fixtures/deployed/ with the real donor-probe. The pure and stub checks run anywhere; the browser checks need
// playwright and print a skip line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';
import { main } from '../deployed-gate.mjs';
import { edsSpec, runTokens } from '../deployed/eds-spec.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { fixturePath, startPreviewServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const GATE = join(SCRIPTS, 'deployed-gate.mjs');
const TOKEN = 'canary-789';
const HEADER = `token ${TOKEN}`;
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-tokens-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const noToken = (...texts) => { for (const t of texts) assert.ok(!t.includes(TOKEN), `the token leaked: …${t.slice(Math.max(0, t.indexOf(TOKEN) - 40), t.indexOf(TOKEN) + 40)}…`); };

const sheet = () => readJson(join(HERE, 'fixtures', 'figma-gate', 'donor-tokens.json'));
const contract = () => readJson(fixturePath('runtime-contract.json'));

// One gate run: { status, stdout, stderr, all }. The ambient hooks are cleared so a run only sees what it is given.
const run = (args, { cwd = scratch, env = {}, script = GATE } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

// A project root: the eligibility files, the token sheet and (unless `preview` is false) the record of the preview
// step, pointed at `origin`. `skip` names the files to leave out, `record` overrides fields of the record.
const project = (name, { origin = 'http://127.0.0.1:9', skip = [], preview = true, record = {} } = {}) => {
  const root = join(scratch, name);
  mkdirSync(join(root, 'stardust', 'reskin'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  const files = {
    'stardust/runtime-contract.json': readFileSync(fixturePath('runtime-contract.json'), 'utf8'),
    'stardust/reskin/donor-tokens.json': readFileSync(join(HERE, 'fixtures', 'figma-gate', 'donor-tokens.json'), 'utf8'),
    'head.html': '<script src="/scripts/aem.js" type="module"></script>\n',
    'scripts/aem.js': '// the boilerplate runtime\n',
  };
  for (const [rel, body] of Object.entries(files)) if (!skip.includes(rel)) writeFileSync(join(root, rel), body);
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
const recordOf = (root) => readJson(join(outOf(root), 'tokens.json'));
const tokens = (root, extra = [], opts = {}) => run(['tokens', '--page', 'home', ...extra], { cwd: root, ...opts });

// The fixture page with strings replaced, served from a file of its own.
const variant = (name, ...pairs) => {
  const file = join(scratch, `${name}.html`);
  let html = readFileSync(fixturePath('home.html'), 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(html.includes(from), `the fixture page has ${from}`);
    html = html.replace(from, () => to);
  }
  writeFileSync(file, html);
  return file;
};

const LABELS = ['page bg', 'body fg', 'font-family token string', 'body font size', 'display weight', 'heading color', 'primary button bg', 'primary button fg', 'primary button radius', 'primary button padding (±2px)', 'primary button font size'];

await check('edsSpec on the fixture tokens: body, heading and primary-button entries on the EDS selectors, then the :root block verbatim', () => {
  const t = sheet();
  const spec = edsSpec({ tokens: t, runtimeContract: contract() });
  assert.deepEqual(spec.filter((e) => e.selector !== ':root').map((e) => e.label), LABELS);
  const by = (label) => spec.find((e) => e.label === label);
  assert.deepEqual(by('page bg'), { label: 'page bg', selector: 'body', property: 'backgroundColor', value: 'rgb(255, 255, 255)' });
  assert.deepEqual(by('body fg'), { label: 'body fg', selector: 'body', property: 'color', value: 'rgb(26, 26, 26)' });
  assert.deepEqual(by('font-family token string'), { label: 'font-family token string', selector: 'body', property: 'fontFamily', value: 'Inter', compare: 'firstFamily' });
  assert.deepEqual(by('body font size'), { label: 'body font size', selector: 'body', property: 'fontSize', value: '18px' });
  assert.deepEqual(by('display weight'), { label: 'display weight', selector: 'main h1', property: 'fontWeight', value: '700' });
  assert.deepEqual(by('heading color'), { label: 'heading color', selector: 'main h2', property: 'color', value: 'rgb(31, 58, 95)' });
  assert.deepEqual(by('primary button bg'), { label: 'primary button bg', selector: 'main a.button.primary', property: 'backgroundColor', value: 'rgb(31, 58, 95)' });
  assert.deepEqual(by('primary button padding (±2px)'), { label: 'primary button padding (±2px)', selector: 'main a.button.primary', property: 'padding', value: '12px 24px', tolerancePx: 2 });
  for (const [label, property, value] of [['primary button fg', 'color', 'rgb(255, 255, 255)'], ['primary button radius', 'borderRadius', '8px'], ['primary button font size', 'fontSize', '16px']]) {
    assert.deepEqual(by(label), { label, selector: 'main a.button.primary', property, value });
  }
  assert.ok(spec.some((e) => e.selector === 'main a.button.primary' && e.property === 'backgroundColor'));

  const root = rootTokens(t).entries;
  assert.ok(root.length > 20, 'the fixture sheet fills most of the :root block');
  assert.deepEqual(spec.filter((e) => e.selector === ':root'), root.map((e) => ({ label: `:root ${e.name}`, selector: ':root', property: e.name, value: e.value })));
  assert.deepEqual(by(':root --max-width'), { label: ':root --max-width', selector: ':root', property: '--max-width', value: '1200px' });
  assert.deepEqual(by(':root --section-padding'), { label: ':root --section-padding', selector: ':root', property: '--section-padding', value: '80px' });
  assert.equal(spec.length, LABELS.length + root.length, 'nothing else');
  assert.deepEqual(spec.slice(0, LABELS.length).map((e) => e.label), LABELS, 'the assertions on the page come before the :root block');
});

await check('edsSpec leaves out layout.containerMaxWidth and layout.sectionPaddingY (A3\'s cap-probe and the real run measure them): no maxWidth, paddingTop or "container"/"rhythm" entry', () => {
  const spec = edsSpec({ tokens: sheet(), runtimeContract: contract() });
  assert.ok(!spec.some((e) => e.property === 'maxWidth' || e.property === 'paddingTop' || /container|rhythm/i.test(e.label)), JSON.stringify(spec.map((e) => e.label)));
  assert.ok(!spec.some((e) => e.selector === 'main .container' || e.selector === 'main section'));
});

await check('edsSpec omits what the sheet does not carry, and an empty sheet gives no entries', () => {
  const t = sheet();
  delete t.palette.headingFg;
  delete t.buttons.primary.padding;
  delete t.layout;
  const labels = edsSpec({ tokens: t, runtimeContract: contract() }).map((e) => e.label);
  assert.ok(!labels.includes('heading color') && !labels.includes('primary button padding (±2px)'));
  assert.ok(labels.includes('page bg') && labels.includes('primary button bg'));
  assert.ok(!labels.includes(':root --max-width') && !labels.includes(':root --section-padding'), 'the :root block follows the sheet too');
  assert.deepEqual(edsSpec({ tokens: {}, runtimeContract: contract() }), []);
  assert.deepEqual(edsSpec({ tokens: { palette: { pageBg: '  ' } }, runtimeContract: contract() }), [], 'a blank value is absent');
});

await check('edsSpec: a runtime contract whose buttonClasses lacks .button.primary is a UsageError naming buttonClasses; one without primary-button tokens to assert is not', () => {
  for (const runtimeContract of [{}, undefined, null, { buttonClasses: '.button / .button.secondary' }, { buttonClasses: '.button.primary-large' }, { buttonClasses: 7 }]) {
    assert.throws(() => edsSpec({ tokens: sheet(), runtimeContract }), (e) => e instanceof UsageError && e.code === 2 && /buttonClasses/.test(e.message), JSON.stringify(runtimeContract));
  }
  assert.doesNotThrow(() => edsSpec({ tokens: sheet(), runtimeContract: { buttonClasses: '.button.primary, .button.secondary' } }));
  assert.doesNotThrow(() => edsSpec({ tokens: sheet(), runtimeContract: { buttonClasses: '.button.primary' } }), 'the end of the string counts');
  const noButtons = sheet();
  delete noButtons.buttons;
  assert.ok(edsSpec({ tokens: noButtons, runtimeContract: {} }).length > 0, 'no primary button in the sheet, nothing that needs the class');
});

await check('edsSpec: a token that is no string, or no value a :root block can hold, is a UsageError naming the path', () => {
  const object = sheet();
  object.palette.bodyFg = { r: 1 };
  assert.throws(() => edsSpec({ tokens: object, runtimeContract: contract() }), (e) => e instanceof UsageError && /palette\.bodyFg/.test(e.message));
  const unsafe = sheet();
  unsafe.palette.pageBg = 'red; } body { display: none';
  assert.throws(() => edsSpec({ tokens: unsafe, runtimeContract: contract() }), (e) => e instanceof UsageError && /palette\.pageBg/.test(e.message));
});

await check('edsSpec labels are donor-probe\'s DEFAULT_SPEC labels for the same token paths, so a failure reads as it does in Phase 5', () => {
  const probe = readFileSync(join(SCRIPTS, 'donor-probe.mjs'), 'utf8');
  const defaults = new Set([...probe.matchAll(/label: '([^']+)'/g)].map((m) => m[1]));
  for (const label of LABELS) assert.ok(defaults.has(label), `donor-probe's default spec has no "${label}"`);
});

// ---- runTokens against stub probes ----------------------------------------------------------------------------

// A stand-in for donor-probe: records what it was given, then writes `json` (when set), prints `stderr` and exits.
// It lives in scratch, or at `at`.
const stubProbe = (name, { exit = 0, stderr = '', json = null, at = join(scratch, `${name}.mjs`) } = {}) => {
  const file = at;
  const seen = join(scratch, `${name}.seen.json`);
  writeFileSync(file, `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv, token: process.env.DEPLOYED_GATE_SITE_TOKEN ?? null, siteToken: process.env.SITE_TOKEN ?? null }));
${json ? `writeFileSync(argv[argv.indexOf('--json') + 1], ${JSON.stringify(JSON.stringify(json))});` : ''}
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exit});
`);
  return { file, seen: () => readJson(seen) };
};
const PASSING = { pass: true, results: [{ check: 'page bg = rgb(255, 255, 255)', label: 'page bg', status: 'PASS', detail: 'rgb(255, 255, 255)' }] };
const attempt = async (fn) => { try { return { value: await fn() }; } catch (e) { return { error: e }; } };

await check('runTokens hands donor-probe the spec, the preview URL and --wait-eds; the token goes by environment, never argv', async () => {
  const root = project('stub-args');
  const dir = join(root, 'stardust');
  const preview = readJson(join(outOf(root), 'preview.json'));
  const stub = stubProbe('probe-args', { exit: 0, json: PASSING });
  const r = await runTokens({ dir, slug: 'home', preview, auth: HEADER, donorProbe: stub.file, env: { ...process.env, DEPLOYED_GATE_SITE_TOKEN: 'stale' } });
  const { argv, token } = stub.seen();
  const arg = (flag) => argv[argv.indexOf(flag) + 1];
  assert.equal(arg('--tokens'), join(dir, 'reskin', 'donor-tokens.json'));
  assert.equal(arg('--spec'), join(outOf(root), 'tokens-spec.json'));
  assert.equal(arg('--rendered'), preview.url);
  assert.equal(arg('--token-env'), 'DEPLOYED_GATE_SITE_TOKEN');
  assert.ok(argv.includes('--wait-eds') && argv.includes('--no-sanity'));
  assert.equal(arg('--json'), r.json);
  assert.equal(arg('--report'), r.report);
  assert.equal(token, HEADER, 'the token arrived by environment');
  noToken(argv.join(' '));
  assert.ok(!argv.includes('--auth-header'));
  assert.deepEqual(readJson(join(outOf(root), 'tokens-spec.json')), edsSpec({ tokens: sheet(), runtimeContract: contract() }));
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.exit, 0);
  assert.equal(r.total, 1);
  assert.deepEqual(recordOf(root), { verdict: 'PASS', exit: 0, report: r.report, json: r.json, skipped: r.skipped });
});

await check('runTokens without a token passes no token flag and clears an inherited DEPLOYED_GATE_SITE_TOKEN', async () => {
  const root = project('stub-noauth');
  const stub = stubProbe('probe-noauth', { exit: 0, json: PASSING });
  await runTokens({ dir: join(root, 'stardust'), slug: 'home', preview: readJson(join(outOf(root), 'preview.json')), donorProbe: stub.file, env: { ...process.env, DEPLOYED_GATE_SITE_TOKEN: 'stray' } });
  const { argv, token } = stub.seen();
  assert.ok(!argv.includes('--token-env') && !argv.includes('--auth-header'), argv.join(' '));
  assert.equal(token, null);
});

await check('runTokens: donor-probe exit 1 with its JSON is the FAIL verdict with one line per failing assertion; the record says so', async () => {
  const root = project('stub-fail');
  const json = { pass: false, results: [
    { check: 'page bg = rgb(255, 255, 255)', label: 'page bg', status: 'PASS', detail: 'rgb(255, 255, 255)' },
    { check: 'primary button bg = rgb(31, 58, 95)', label: 'primary button bg', status: 'FAIL', detail: 'rgb(200, 30, 30)' },
    { check: 'primary button fg', label: 'primary button fg', status: 'FAIL', detail: 'selector "main a.button.primary" matched nothing' },
  ] };
  const stub = stubProbe('probe-fail', { exit: 1, json });
  const preview = readJson(join(outOf(root), 'preview.json'));
  const r = await runTokens({ dir: join(root, 'stardust'), slug: 'home', preview, donorProbe: stub.file });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.exit, 1);
  assert.equal(r.total, 3);
  assert.equal(r.failures.length, 2);
  assert.match(r.failures[0], /^primary button bg: got rgb\(200, 30, 30\), want rgb\(31, 58, 95\)$/);
  assert.match(r.failures[1], /^primary button fg: selector "main a\.button\.primary" matched nothing$/);
  assert.equal(recordOf(root).verdict, 'FAIL');
  assert.equal(recordOf(root).exit, 1);
});

await check('runTokens exit mapping: probe exit 2 is a UsageError, exit 3 a challenge (code 3), no verdict is code 124; the probe\'s text is redacted and no stale JSON or record survives', async () => {
  const root = project('stub-exits');
  const dir = join(root, 'stardust');
  const preview = readJson(join(outOf(root), 'preview.json'));
  const call = (stub, auth = HEADER) => attempt(() => runTokens({ dir, slug: 'home', preview, auth, donorProbe: stub.file }));
  const setup = await call(stubProbe('probe-2', { exit: 2, stderr: `[donor-probe] HTTP 401 at ${preview.url}: sent ${HEADER}\n` }));
  assert.ok(setup.error instanceof UsageError && setup.error.code === 2, String(setup.error));
  assert.match(setup.error.message, /HTTP 401/);
  assert.match(setup.error.message, /\[redacted\]/);
  noToken(setup.error.message);
  assert.ok(!/pass --auth-header/.test(setup.error.message), 'no hint when the record says no token was used');
  const protectedRecord = { ...preview, auth: true };
  const unauthenticated = await attempt(() => runTokens({ dir, slug: 'home', preview: protectedRecord, auth: null, donorProbe: stubProbe('probe-2b', { exit: 2, stderr: '[donor-probe] stalled decoration: body.appear\n' }).file }));
  assert.match(unauthenticated.error?.message ?? '', /stalled decoration: body\.appear\npreview\.json says .*pass --auth-header or --token-env/);

  const challenge = await call(stubProbe('probe-3', { exit: 3, stderr: `[donor-probe] bot challenge at ${preview.url} (${TOKEN})\n` }));
  assert.ok(challenge.error && challenge.error.code === 3 && !(challenge.error instanceof UsageError), String(challenge.error));
  assert.match(challenge.error.message, /bot challenge/);
  noToken(challenge.error.message);

  for (const [name, stub] of [['exit 1, no JSON', stubProbe('probe-1', { exit: 1, stderr: `boom ${TOKEN}\n` })], ['exit 0, no JSON', stubProbe('probe-0', { exit: 0 })], ['exit 7', stubProbe('probe-7', { exit: 7, json: PASSING })]]) {
    writeFileSync(join(outOf(root), 'tokens-probe.json'), JSON.stringify(PASSING));
    writeFileSync(join(outOf(root), 'tokens.json'), JSON.stringify({ verdict: 'PASS' }));
    const crash = await call(stub);
    assert.ok(crash.error && crash.error.code === 124 && !(crash.error instanceof UsageError), `${name}: ${String(crash.error)}`);
    assert.match(crash.error.message, /did not give a verdict/, name);
    noToken(crash.error.message);
    assert.ok(!existsSync(join(outOf(root), 'tokens.json')), `${name}: no record from an earlier run`);
    if (!/JSON/.test(name)) continue;
    assert.ok(!existsSync(join(outOf(root), 'tokens-probe.json')), `${name}: the earlier JSON was removed before the probe ran, so it is not read as this run's`);
  }
  const lies = await call(stubProbe('probe-lies', { exit: 0, json: { pass: false, results: [{ check: 'x', label: 'x', status: 'FAIL', detail: 'y' }] } }));
  assert.equal(lies.error?.code, 124, 'an exit that contradicts the JSON is no verdict');
});

await check('runTokens: the sheet and the runtime contract are read from <dir>/reskin and <parent of dir>/stardust; missing or unreadable is a UsageError naming the file', async () => {
  const stub = stubProbe('probe-setup', { exit: 0, json: PASSING });
  const attemptAt = async (name, opts) => {
    const root = project(name, opts);
    return attempt(() => runTokens({ dir: join(root, 'stardust'), slug: 'home', preview: readJson(join(outOf(root), 'preview.json')), donorProbe: stub.file }));
  };
  const noSheet = await attemptAt('setup-no-sheet', { skip: ['stardust/reskin/donor-tokens.json'] });
  assert.ok(noSheet.error instanceof UsageError, String(noSheet.error));
  assert.match(noSheet.error.message, /reskin[\\/]donor-tokens\.json/);
  const noContract = await attemptAt('setup-no-contract', { skip: ['stardust/runtime-contract.json'] });
  assert.ok(noContract.error instanceof UsageError, String(noContract.error));
  assert.match(noContract.error.message, /runtime-contract\.json/);

  const bad = project('setup-bad-sheet');
  writeFileSync(join(bad, 'stardust', 'reskin', 'donor-tokens.json'), '{ nope');
  const badSheet = await attempt(() => runTokens({ dir: join(bad, 'stardust'), slug: 'home', preview: readJson(join(outOf(bad), 'preview.json')), donorProbe: stub.file }));
  assert.ok(badSheet.error instanceof UsageError && /donor-tokens\.json is not valid JSON/.test(badSheet.error.message), String(badSheet.error));

  const empty = project('setup-empty-sheet');
  writeFileSync(join(empty, 'stardust', 'reskin', 'donor-tokens.json'), '{}\n');
  const noTokens = await attempt(() => runTokens({ dir: join(empty, 'stardust'), slug: 'home', preview: readJson(join(outOf(empty), 'preview.json')), donorProbe: stub.file }));
  assert.ok(noTokens.error instanceof UsageError && /nothing to assert/.test(noTokens.error.message), `a sheet with no tokens is no pass: ${noTokens.error}`);

  const noButton = project('setup-no-button-class');
  writeFileSync(join(noButton, 'stardust', 'runtime-contract.json'), '{ "buttonClasses": ".button / .button.secondary" }\n');
  const noClass = await attempt(() => runTokens({ dir: join(noButton, 'stardust'), slug: 'home', preview: readJson(join(outOf(noButton), 'preview.json')), donorProbe: stub.file }));
  assert.ok(noClass.error instanceof UsageError && /buttonClasses/.test(noClass.error.message), String(noClass.error));
});

await check('the project copy of the scripts finds donor-probe beside the gate: a probe exit 3 is gate exit 3, no verdict is 124, exit 2 is 2, and the verdict lines come from the probe\'s JSON; the token is redacted throughout', async () => {
  const copy = join(scratch, 'copy');
  cpSync(SCRIPTS, join(copy, 'reskin'), { recursive: true, filter: (src) => src !== join(SCRIPTS, 'test') });
  cpSync(join(SCRIPTS, '..', '..', 'diff', 'scripts'), join(copy, 'diff'), { recursive: true });
  const at = join(copy, 'reskin', 'donor-probe.mjs');
  const gate = (name, probe) => {
    stubProbe(name, { at, ...probe });
    return run(['tokens', '--page', 'home', '--auth-header', HEADER], { cwd: project('copy-proj'), script: join(copy, 'reskin', 'deployed-gate.mjs') });
  };
  const challenge = await gate('copy-3', { exit: 3, stderr: `[donor-probe] bot challenge at x (${HEADER})\n` });
  assert.equal(challenge.status, 3, challenge.all);
  assert.match(challenge.stderr, /^deployed-gate: \[donor-probe\] bot challenge at x \(\[redacted\]\)/);
  const crash = await gate('copy-1', { exit: 1, stderr: `crashed ${TOKEN}\n` });
  assert.equal(crash.status, 124, crash.all);
  assert.match(crash.stderr, /did not give a verdict \(exit 1\): crashed \[redacted\]/);
  const setup = await gate('copy-2', { exit: 2, stderr: `[donor-probe] ${TOKEN} unreachable\n` });
  assert.equal(setup.status, 2, setup.all);
  const fail = await gate('copy-fail', { exit: 1, json: { pass: false, results: [{ check: 'page bg = rgb(255, 255, 255)', label: 'page bg', status: 'FAIL', detail: TOKEN }] } });
  assert.equal(fail.status, 1, fail.all);
  assert.equal(fail.stdout.split('\n')[0], 'FAIL tokens 1/1');
  assert.ok(fail.stdout.includes('  page bg: got [redacted], want rgb(255, 255, 255)'), fail.stdout);
  const pass = await gate('copy-0', { exit: 0, json: PASSING });
  assert.equal(pass.status, 0, pass.all);
  assert.equal(pass.stdout.split('\n')[0], 'PASS tokens 1/1');
  const { token } = readJson(join(scratch, 'copy-0.seen.json'));
  assert.equal(token, HEADER, 'the copy\'s probe ran with the token in its environment');
  noToken(challenge.all, crash.all, setup.all, fail.all, pass.all);
});

await check('--help documents tokens beside preview; the usage errors of tokens exit 2 and write nothing', async () => {
  const dir = mkdtempSync(join(scratch, 'help-'));
  copyFileSync(GATE, join(dir, 'deployed-gate.mjs'));
  const r = await run(['--help'], { cwd: dir, script: join(dir, 'deployed-gate.mjs') });
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /deployed-gate\.mjs tokens --page <slug> \[--auth-header <value> \| --token-env <NAME>\] \[--dir stardust\]/);
  assert.match(r.stdout, /layout\.containerMaxWidth/);
  assert.match(r.stdout, /layout\.sectionPaddingY/);
  assert.match(r.stdout, /not run: skipped/);
  assert.deepEqual(readdirSync(dir), ['deployed-gate.mjs'], 'wrote nothing');

  const root = project('tokens-usage', { preview: false });
  for (const [args, re] of [
    [['tokens'], /tokens needs --page <slug>/],
    [['tokens', '--page', '../x'], /--page must be a slug/],
    [['tokens', '--page', 'home', '--org', 'o'], /unknown flag --org for tokens/],
    [['tokens', '--page', 'home', '--sandbox'], /unknown flag --sandbox for tokens/],
    [['tokens', '--page', 'home', 'stray'], /unexpected argument "stray"/],
    [['tokens', '--page'], /--page needs a value/],
    [['tokens', '--page', 'home', '--auth-header', '--dir', 'x'], /--auth-header needs a value/],
    [['tokens', '--page', 'home', '--token-env', ' '], /--token-env needs a value/],
    [['tokens', '--page', 'home', '--auth-header', ''], /--auth-header needs a value/],
  ]) {
    const got = await run(args, { cwd: root });
    assert.equal(got.status, 2, `${args.join(' ')}: ${got.all}`);
    assert.match(got.stderr, re, args.join(' '));
  }
  assert.ok(!existsSync(join(root, 'stardust', '.work')), 'a usage error wrote nothing');
});

await check('tokens needs the record of `preview`: absent is exit 2 naming deployed-gate preview; problems is exit 2; a skipped leg is "not run: skipped", exit 0, nothing run', async () => {
  const absent = project('rec-absent', { preview: false });
  const none = await tokens(absent);
  assert.equal(none.status, 2, none.all);
  assert.match(none.stderr, /deployed-gate preview/);

  const problems = project('rec-problems', { record: { problems: ['the page path /home is outside /ns/'] } });
  const refused = await tokens(problems);
  assert.equal(refused.status, 2, refused.all);
  assert.match(refused.stderr, /preview has problems: run deployed-gate preview again/);
  assert.ok(!existsSync(join(outOf(problems), 'tokens.json')));

  // The leg is skipped before anything else is looked at: the sheet and contract need not exist either.
  const skipped = project('rec-skipped', { skip: ['stardust/runtime-contract.json', 'stardust/reskin/donor-tokens.json'], record: { skipped: true, reason: 'not an aem-boilerplate project: missing head.html at the project root', url: null, origin: null, plain: null } });
  const idle = await tokens(skipped);
  assert.equal(idle.status, 0, idle.all);
  assert.equal(idle.stdout.trim(), 'not run: skipped');
  assert.ok(!existsSync(join(outOf(skipped), 'tokens.json')) && !existsSync(join(outOf(skipped), 'tokens-spec.json')), 'nothing written');
});

await check('main dispatches tokens to a replaceable step and returns its exit code; --help runs before it', async () => {
  const lines = [];
  const code = await main(['tokens', '--page', 'home'], { log: (m) => lines.push(m), steps: { tokens: async ({ opts, log }) => { log(`stub ${opts.page}`); return 5; } } });
  assert.equal(code, 5);
  assert.deepEqual(lines, ['stub home']);
  assert.equal(await main(['tokens', '--help'], { log: () => {}, steps: { tokens: async () => { throw new Error('must not run'); } } }), 0);
});

// ---- the CLI with the real donor-probe, against the fake preview -----------------------------------------------

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const total = edsSpec({ tokens: sheet(), runtimeContract: contract() }).length;
  const SKIPS = [/^SKIP layout\.containerMaxWidth: measured by parity cap-probe$/m, /^SKIP layout\.sectionPaddingY: EDS section rhythm, measured in the real run$/m];

  await check('preview then tokens on the fake preview: PASS tokens n/n, the two SKIP lines, exit 0; the files and the record are written', async () => {
    const server = await startPreviewServer();
    try {
      const root = project('cli-pass', { preview: false });
      const pv = await run(['preview', '--page', 'home', '--org', 'o', '--repo', 'r', '--branch', 'b', '--path', '/ns/home', '--namespace', 'ns'], { cwd: root, env: { DEPLOY_VERIFY_ORIGIN: server.origin } });
      assert.equal(pv.status, 0, pv.all);
      const elsewhere = join(scratch, 'cli-elsewhere');
      mkdirSync(elsewhere, { recursive: true });
      const r = await tokens(elsewhere, ['--dir', join(root, 'stardust')]);
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, new RegExp(`^PASS tokens ${total}/${total}$`, 'm'));
      for (const re of SKIPS) assert.match(r.stdout, re);
      assert.ok(!/FAIL/.test(r.stdout), r.stdout);
      const out = outOf(root);
      const rec = recordOf(root);
      assert.equal(rec.verdict, 'PASS');
      assert.equal(rec.exit, 0);
      assert.deepEqual(rec.skipped, ['layout.containerMaxWidth: measured by parity cap-probe', 'layout.sectionPaddingY: EDS section rhythm, measured in the real run']);
      assert.ok(existsSync(rec.report) && existsSync(rec.json), 'the probe\'s report and JSON are where the record says');
      assert.deepEqual(Object.keys(rec), ['verdict', 'exit', 'report', 'json', 'skipped']);
      assert.deepEqual(readJson(join(out, 'tokens-spec.json')), edsSpec({ tokens: sheet(), runtimeContract: contract() }));
      assert.equal(readJson(rec.json).results.length, total);
      assert.ok(!existsSync(join(elsewhere, 'stardust')), 'nothing under the cwd');
      assert.ok(server.requests.some((q) => q.path === '/ns/home'), 'the page was asked for');
    } finally { await server.close(); }
  });

  await check('a changed primary-button colour is exit 1: FAIL tokens 1/n naming "primary button bg" with the page\'s and the token\'s value, and the record says FAIL', async () => {
    const page = variant('page-button-colour', ['a.button.primary { background: rgb(31, 58, 95);', 'a.button.primary { background: rgb(200, 30, 30);']);
    const server = await startPreviewServer({ pages: { '/ns/home': page } });
    try {
      const root = project('cli-fail', { origin: server.origin });
      const r = await tokens(root);
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, new RegExp(`^FAIL tokens 1/${total}$`, 'm'));
      const lines = r.stdout.split('\n').filter((l) => l.startsWith('  '));
      assert.deepEqual(lines, ['  primary button bg: got rgb(200, 30, 30), want rgb(31, 58, 95)']);
      for (const re of SKIPS) assert.match(r.stdout, re);
      assert.ok(!/^PASS/m.test(r.stdout));
      assert.equal(recordOf(root).verdict, 'FAIL');
      assert.equal(recordOf(root).exit, 1);
    } finally { await server.close(); }
  });

  await check('a page whose button lost the primary class is a FAIL for each button assertion ("matched nothing"), never a skip; a :root token that moved fails by its name', async () => {
    const page = variant('page-no-primary', ['class="button primary">Get started', 'class="button">Get started'], ['--max-width: 1200px;', '--max-width: 1100px;']);
    const server = await startPreviewServer({ pages: { '/ns/home': page } });
    try {
      const root = project('cli-matched-nothing', { origin: server.origin });
      const r = await tokens(root);
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, new RegExp(`^FAIL tokens 6/${total}$`, 'm'));
      for (const label of ['primary button bg', 'primary button fg', 'primary button radius', 'primary button padding (±2px)', 'primary button font size']) {
        assert.ok(r.stdout.includes(`  ${label}: selector "main a.button.primary" matched nothing`), `${label}: ${r.stdout}`);
      }
      assert.ok(r.stdout.includes('  :root --max-width: got 1100px, want 1200px'), r.stdout);
    } finally { await server.close(); }
  });

  await check('a protected preview: --auth-header and --token-env authenticate (every request carries the header), and the token is in no output or file; without it nothing is measured (exit 2, naming the flags)', async () => {
    const server = await startPreviewServer({ token: TOKEN });
    try {
      const root = project('cli-auth', { origin: server.origin, record: { auth: true } });
      const viaHeader = await tokens(root, ['--auth-header', HEADER]);
      assert.equal(viaHeader.status, 0, viaHeader.all);
      assert.match(viaHeader.stdout, new RegExp(`^PASS tokens ${total}/${total}$`, 'm'));
      assert.ok(server.requests.length > 0 && server.requests.every((q) => q.headers.authorization === HEADER), 'every request carried the header');
      const viaEnv = await tokens(root, ['--token-env', 'STARDUST_T6_TOKEN'], { env: { STARDUST_T6_TOKEN: TOKEN } });
      assert.equal(viaEnv.status, 0, viaEnv.all);
      const anon = await tokens(root);
      assert.equal(anon.status, 2, anon.all);
      assert.match(anon.stderr, /stalled decoration|HTTP 401/, 'the probe measured nothing');
      assert.match(anon.stderr, /pass --auth-header or --token-env/, 'the record says a token was used: the error says so');
      const unset = await tokens(root, ['--token-env', 'STARDUST_T6_NO_SUCH_TOKEN']);
      assert.equal(unset.status, 2, unset.all);
      assert.match(unset.stderr, /no site token: the variable --token-env names is not set/);
      assert.equal(unset.all.includes('STARDUST_T6_NO_SUCH_TOKEN'), false, 'the name is never printed');
      noToken(viaHeader.all, viaEnv.all, anon.all, unset.all);
      for (const f of readdirSync(outOf(root))) noToken(readFileSync(join(outOf(root), f), 'utf8'));
    } finally { await server.close(); }
  });

  await check('a failing assertion on a protected preview never prints the token either', async () => {
    const page = variant('page-auth-fail', ['a.button.primary { background: rgb(31, 58, 95);', 'a.button.primary { background: rgb(200, 30, 30);']);
    const server = await startPreviewServer({ token: TOKEN, pages: { '/ns/home': page } });
    try {
      const root = project('cli-auth-fail', { origin: server.origin, record: { auth: true } });
      const r = await tokens(root, ['--auth-header', HEADER]);
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /^FAIL tokens 1\//m);
      noToken(r.all);
      for (const f of readdirSync(outOf(root))) noToken(readFileSync(join(outOf(root), f), 'utf8'));
    } finally { await server.close(); }
  });

  await check('a preview that does not answer is no verdict and no pass: the probe\'s refusal is exit 2 with the record removed', async () => {
    const root = project('cli-down', { origin: 'http://127.0.0.1:9' });
    writeFileSync(join(outOf(root), 'tokens.json'), '{"verdict":"PASS"}\n');
    const r = await tokens(root);
    assert.equal(r.status, 2, r.all);
    assert.ok(!/^PASS/m.test(r.stdout));
    assert.ok(!existsSync(join(outOf(root), 'tokens.json')), 'a stale record is removed');
  });
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
