#!/usr/bin/env node
// rounds.mjs contract test: the round ledger of the source-fidelity gate — the cap (3 counted rounds per
// (slug, width, stage): the first + two fix rounds), confirmations free, the three decisions, no-verdict rounds
// never recorded, stages and widths apart, reconstruction from verdict-*.json, the atomic write, --help before
// any I/O — and gate.sh's wiring with stub instruments: a refused round exits 6 before any curl or capture, a
// verdict round is recorded, a no-verdict round is not, STARDUST_ROUND_CAP=0 turns the refusal off. No browser.
// Run: node skills/replica/scripts/test/rounds.test.mjs
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAP, decide, emptyLedger, kindOf, mayRun, reconstruct, record, stageOfVerdict, tally, verdictOf } from '../rounds.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, '..');
const ROUNDS = join(scripts, 'rounds.mjs');
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}
const root = realpathSync(mkdtempSync(join(tmpdir(), 'rounds-test-')));
const cli = (args, env = {}) => spawnSync(process.execPath, [ROUNDS, ...args], { encoding: 'utf8', cwd: root, env: { ...process.env, STARDUST_ROUND_CAP: '', ...env } });
const gateDir = (name) => { const d = join(root, 'stardust/replica/gates', name); mkdirSync(d, { recursive: true }); return d; };
const read = (d) => JSON.parse(readFileSync(join(d, 'rounds.json'), 'utf8'));

// ── pure ──────────────────────────────────────────────────────────────────────────────────────────────────────
check('the cap is 3 counted rounds', CAP === 3);
let L = emptyLedger();
check('an empty triple may run (the map)', mayRun(L, 'prototype').ok);
check('kinds: first, then fix; a PASS after a PASS is confirm, a FAIL after a PASS is fix',
  kindOf([], 'fail') === 'first' && kindOf([{ verdict: 'fail' }], 'pass') === 'fix' && kindOf([{ verdict: 'pass' }], 'pass') === 'confirm' && kindOf([{ verdict: 'pass' }], 'fail') === 'fix');
record(L, 'prototype', 'iter1', 'fail');
record(L, 'prototype', 'iter2', 'fail');
check('first + one fix: the third counted round may run', mayRun(L, 'prototype').ok && tally(L, 'prototype').counted === 2);
record(L, 'prototype', 'iter3', 'fail');
let m = mayRun(L, 'prototype');
check('first + two fix rounds, the last a FAIL: the next round is refused (cap)', !m.ok && m.why === 'cap' && m.t.counted === 3 && m.t.fix === 2);
check('the other stage of the same gate dir is untouched', mayRun(L, 'published').ok && tally(L, 'published').counted === 0);

L = emptyLedger();
for (const [l, v] of [['iter1', 'fail'], ['iter2', 'fail'], ['iter3', 'pass']]) record(L, 'prototype', l, v);
m = mayRun(L, 'prototype');
check('at the cap with a passing last round: the confirmation may run', m.ok && m.why === 'confirmation');
const conf = record(L, 'prototype', 'confirm', 'pass');
check('a PASS after a PASS is recorded as confirm and not counted', conf.kind === 'confirm' && tally(L, 'prototype').counted === 3 && tally(L, 'prototype').confirm === 1);
const regress = record(L, 'prototype', 'final', 'fail');
check('a FAIL after a PASS counts as a fix round (over the cap, reported)', regress.kind === 'fix' && tally(L, 'prototype').over === 1 && !mayRun(L, 'prototype').ok);

L = emptyLedger();
check('extend before the cap is refused', Boolean(decide(L, 'prototype', 'extend', 'live.capture.json was a challenge page', ['live.capture.json']).error));
for (const l of ['a', 'b', 'c']) record(L, 'prototype', l, 'fail');
check('extend without a reason naming an evidence file is refused', /evidence/.test(decide(L, 'prototype', 'extend', 'the instrument felt wrong', ['live.capture.json']).error || ''));
check('a decision without a reason is refused', Boolean(decide(L, 'prototype', 'accept-residual', '  ', []).error));
check('extend naming the evidence grants one round', !decide(L, 'prototype', 'extend', 'round b measured a challenge page: live.capture.json', ['live.capture.json', 'rounds.json']).error && mayRun(L, 'prototype').ok && tally(L, 'prototype').allowance === 4);
record(L, 'prototype', 'd', 'fail');
check('… exactly one: the round after it is refused again', !mayRun(L, 'prototype').ok && tally(L, 'prototype').over === 0);
check('accept-residual closes the triple', !decide(L, 'prototype', 'accept-residual', '2 % residual in the hero band, logged', []).error && mayRun(L, 'prototype').why === 'closed');
check('a closed triple takes no further decision', Boolean(decide(L, 'prototype', 're-prototype', 'again', []).error));
L = emptyLedger();
record(L, 'published', 'pub1', 'pass');
decide(L, 'published', 're-prototype', 'banded layout flattened', []);
check('re-prototype starts both stages again and keeps the spent rounds in history', mayRun(L, 'published').ok && mayRun(L, 'prototype').ok && tally(L, 'published').rounds === 0 && L.history.length === 1 && L.history[0].stages.published.rounds.length === 1);
check('a page is re-prototyped once: a second re-prototype is refused', Boolean(decide(L, 'published', 're-prototype', 'again', []).error));
L = emptyLedger();
for (const [l, v] of [['a', 'fail'], ['b', 'fail'], ['c', 'fail']]) record(L, 'prototype', l, v);
decide(L, 'prototype', 'extend', 'live.capture.json: the capture stalled', ['live.capture.json']);
record(L, 'prototype', 'd', 'fail');
check('one extension per triple: a second extend is refused', Boolean(decide(L, 'prototype', 'extend', 'live.capture.json again', ['live.capture.json']).error));

const V = (o = {}) => ({ round: 'x', width: 1440, pixel: { rc: 0 }, probes: { 'content-diff': { rc: 0 }, 'visual-diff': { rc: 0 }, 'chrome-parity': { rc: 0 }, 'clip-probe': { rc: 0 } }, structural: 0, nothingLost: 0, at: '2026-01-01T00:00:00.000Z', ...o });
check('verdictOf: pass', verdictOf(V()) === 'pass');
check('verdictOf: fail on pixel 2, a structural finding, a nothing-lost finding, a chrome delta',
  verdictOf(V({ pixel: { rc: 2 } })) === 'fail' && verdictOf(V({ structural: 1 })) === 'fail' && verdictOf(V({ nothingLost: 2 })) === 'fail'
  && verdictOf(V({ probes: { 'chrome-parity': { rc: 2 } } })) === 'fail');
check('verdictOf: an advisory visual-diff exit 2 is not a fail', verdictOf(V({ probes: { 'visual-diff': { rc: 2 } } })) === 'pass');
check('verdictOf: no verdict on a probe deadline (124), a probe error (1), a blocked probe (3), junk',
  verdictOf(V({ probes: { 'content-diff': { rc: 124 } } })) === null && verdictOf(V({ probes: { 'clip-probe': { rc: 1 } } })) === null
  && verdictOf(V({ probes: { 'chrome-parity': { rc: 3 } } })) === null && verdictOf({}) === null && verdictOf(null) === null);
check('stageOfVerdict: pub* labels and content-presence rounds are published, the rest prototype',
  stageOfVerdict('pub1', V()) === 'published' && stageOfVerdict('pubF1', V()) === 'published'
  && stageOfVerdict('eds2', V({ probes: { 'content-presence': { rc: 0 } } })) === 'published'
  && stageOfVerdict('iter1', V()) === 'prototype' && stageOfVerdict('final', V()) === 'prototype');

// ── reconstruction from verdict-*.json ────────────────────────────────────────────────────────────────────────
const rdir = gateDir('home-1440');
const at = (n) => `2026-01-01T00:${String(n).padStart(2, '0')}:00.000Z`;
const put = (label, o) => writeFileSync(join(rdir, `verdict-${label}.json`), JSON.stringify(V({ round: label, ...o })));
put('map0', { at: at(1), pixel: { rc: 2 } });
put('iter2', { at: at(2), pixel: { rc: 2 } });
put('iter2b', { at: at(3), probes: { 'content-diff': { rc: 124 } } }); // deadline: no verdict
put('iter3', { at: at(4), structural: 3 });
put('iter4', { at: at(5) });
put('confirm', { at: at(6) });
put('final', { at: at(7), pixel: { rc: 2 } });
put('pub1', { at: at(8), pixel: { rc: 2 } });
put('pub2', { at: at(9) });
writeFileSync(join(rdir, 'verdict-torn.json'), '{ "round": ');
let R = reconstruct(rdir);
const kinds = (s) => R.stages[s].rounds.map((r) => `${r.label}:${r.kind}`).join(' ');
check('reconstruction: prototype rounds in `at` order, the no-verdict and unreadable files dropped, kinds from order + verdict',
  kinds('prototype') === 'map0:first iter2:fix iter3:fix iter4:fix confirm:confirm final:fix', kinds('prototype'));
check('reconstruction: pub* labels form the published stage', kinds('published') === 'pub1:first pub2:fix', kinds('published'));
check('reconstruction: counts — 5 counted (4 fix), 1 confirmation, over the cap by 2', (() => { const t = tally(R, 'prototype'); return t.counted === 5 && t.fix === 4 && t.confirm === 1 && t.over === 2; })());
check('reconstruction marks the ledger', typeof R.reconstructed === 'string');
check('reconstruction of a dir without verdict files is an empty ledger', Object.keys(reconstruct(gateDir('empty-360')).stages).length === 0);

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────
let r = spawnSync(process.execPath, [ROUNDS, '--help'], { encoding: 'utf8', cwd: join(root, 'stardust') });
check('--help exits 0 with the usage, before any I/O (nothing written)', r.status === 0 && /Usage:/.test(r.stdout) && /exit 6|exits 6/.test(r.stdout) && readdirSync(join(root, 'stardust')).join() === 'replica');
r = cli(['check', rdir, '--help']);
check('--help anywhere wins: no ledger written', r.status === 0 && !existsSync(join(rdir, 'rounds.json')));
r = cli(['frobnicate', rdir]);
check('unknown subcommand: exit 125', r.status === 125 && /--help/.test(r.stderr));
r = cli(['check', rdir, '--stage', 'local', '--label', 'x']);
check('unknown stage: exit 125', r.status === 125);

r = cli(['status', rdir]);
check('status without a ledger reconstructs, one line per stage, writes nothing', r.status === 0 && /home-1440 prototype — 5 of 3 counted rounds.*OVER the cap by 2/.test(r.stdout) && /home-1440 published — 2 of 3/.test(r.stdout) && /reconstructed/.test(r.stdout) && !existsSync(join(rdir, 'rounds.json')), r.stdout);
r = cli(['check', rdir, '--stage', 'prototype', '--label', 'iter9']);
check('check on a reconstructed over-cap dir: exit 6, ONE stderr line with the count and both ways forward',
  r.status === 6 && r.stderr.trim().split('\n').length === 1 && /5 of 3 counted rounds/.test(r.stderr) && /--decision accept-residual\|re-prototype/.test(r.stderr) && /--decision extend/.test(r.stderr) && /rounds\.mjs decide .*home-1440 --stage prototype/.test(r.stderr), r.stderr);
check('… and check wrote the reconstructed ledger', existsSync(join(rdir, 'rounds.json')) && read(rdir).stages.prototype.rounds.length === 6);
r = cli(['check', rdir, '--stage', 'prototype', '--label', 'iter9'], { STARDUST_ROUND_CAP: '0' });
check('STARDUST_ROUND_CAP=0: check exits 0 and says the round would be refused', r.status === 0 && /cap check off/.test(r.stdout) && /would be refused/.test(r.stdout));
r = cli(['check', rdir, '--stage', 'published', '--label', 'pub3']);
check('the published stage of the same dir still has a round', r.status === 0 && /may run/.test(r.stdout));

// a fresh triple through the CLI: first + two fix rounds, then refused; widths apart
const d1440 = gateDir('news-1440');
const d360 = gateDir('news-360');
const step = (dir, label, verdict, stage = 'prototype') => {
  const c = cli(['check', dir, '--stage', stage, '--label', label]);
  if (c.status === 0) cli(['record', dir, '--stage', stage, '--label', label, '--verdict', verdict]);
  return c.status;
};
check('first + two fix rounds run', step(d1440, 'iter1', 'fail') === 0 && step(d1440, 'iter2', 'fail') === 0 && step(d1440, 'iter3', 'fail') === 0);
check('the next fix round is refused with exit 6', step(d1440, 'iter4', 'fail') === 6 && read(d1440).stages.prototype.rounds.length === 3);
check('a no-verdict round (check, no record) is not counted', (() => { cli(['check', d360, '--stage', 'prototype', '--label', 'iter1']); return read(d360).stages.prototype === undefined; })());
check('the other width has its own budget', step(d360, 'iter1', 'fail') === 0 && read(d360).stages.prototype.rounds.length === 1);
check('the published stage has its own budget', step(d1440, 'pub1', 'fail', 'published') === 0 && step(d1440, 'pub2', 'pass', 'published') === 0 && step(d1440, 'pub3', 'pass', 'published') === 0 && read(d1440).stages.published.rounds.map((x) => x.kind).join() === 'first,fix,confirm');
r = cli(['decide', d1440, '--stage', 'prototype', '--decision', 'extend', '--reason', 'felt wrong']);
check('decide extend without evidence: exit 1, nothing recorded', r.status === 1 && read(d1440).stages.prototype.decisions.length === 0, r.stderr);
writeFileSync(join(d1440, 'overflow-iter2.txt'), 'x');
r = cli(['decide', d1440, '--stage', 'prototype', '--decision', 'extend', '--reason', 'iter2 measured a consent wall — overflow-iter2.txt']);
check('decide extend naming an evidence file: recorded, one more round runs, then exit 6 again', r.status === 0 && step(d1440, 'iter4', 'fail') === 0 && step(d1440, 'iter5', 'fail') === 6);
r = cli(['decide', d1440, '--stage', 'prototype', '--decision', 'accept-residual', '--reason', 'hero band 2 %, logged']);
const closed = cli(['check', d1440, '--stage', 'prototype', '--label', 'iter6']);
check('decide accept-residual closes: exit 6 naming the decision', r.status === 0 && closed.status === 6 && /closed by the recorded decision accept-residual/.test(closed.stderr));
check('the ledger keeps rounds { label, at, verdict, kind } and decisions { decision, reason, at, counted }', (() => {
  const s = read(d1440).stages.prototype; const x = s.rounds[0]; const y = s.decisions[1];
  return x.label === 'iter1' && !Number.isNaN(Date.parse(x.at)) && x.verdict === 'fail' && x.kind === 'first' && y.decision === 'accept-residual' && y.counted === 4 && Boolean(y.reason);
})());
check('atomic write: no temp file left beside the ledger', !readdirSync(d1440).some((f) => /\.tmp$/.test(f)));
writeFileSync(join(d360, 'rounds.json'), '{ "version": 1, "stages": ');
r = cli(['status', d360]);
check('an unreadable ledger is rebuilt from the verdict files, and said so', r.status === 0 && /unreadable/.test(r.stdout));
const ro = gateDir('ro-1440');
writeFileSync(join(ro, 'rounds.json'), JSON.stringify({ version: 1, stages: { prototype: { rounds: [], decisions: [] } } }));
chmodSync(ro, 0o555);
r = cli(['record', ro, '--stage', 'prototype', '--label', 'iter1', '--verdict', 'fail']);
chmodSync(ro, 0o755);
check('a failed write exits 1 and leaves the previous ledger intact', process.getuid?.() === 0 || (r.status === 1 && read(ro).stages.prototype.rounds.length === 0 && readdirSync(ro).join() === 'rounds.json'), `status ${r.status}`);

r = cli(['count', join(root, 'stardust/replica/gates')]);
check('count: one row per (gate dir, stage) with rounds, and the over-cap total', r.status === 0 && /home-1440\s+prototype\s+6\s+5\s+4\s+1\s+3\s+2/.test(r.stdout) && /news-1440\s+published/.test(r.stdout) && !/empty-360/.test(r.stdout) && /over the cap/.test(r.stdout), r.stdout);
r = cli(['count', join(root, 'stardust/replica/gates'), '--json']);
check('count --json parses', r.status === 0 && Array.isArray(JSON.parse(r.stdout)));

// ── gate.sh wiring (stub instruments, no browser) ─────────────────────────────────────────────────────────────
const replica = join(root, 'stardust/scripts/replica');
mkdirSync(replica, { recursive: true });
for (const f of ['gate.sh', 'run-capped.mjs', 'rounds.mjs']) cpSync(join(scripts, f), join(replica, f));
chmodSync(join(replica, 'gate.sh'), 0o755);
const calls = join(root, 'calls.txt');
const stub = (name, body) => writeFileSync(join(replica, name), `#!/usr/bin/env node\nimport { appendFileSync, writeFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, '${name}\\n');\n${body}\n`);
stub('stitch-shot.mjs', `const rc = Number(process.env.STUB_STITCH_RC || 0); if (rc) process.exit(rc);
  writeFileSync(process.argv[3], 'png'); writeFileSync(process.argv[3].replace(/\\.png$/, '.capture.json'), JSON.stringify({ fontsFailed: [], fixedLayers: {} }));`);
stub('measure.mjs', `console.log('  root  scrollWidth 1440  viewport 1440  scrollHeight 5410');`);
stub('pixel-compare.mjs', `console.log('differing 1.20%'); process.exit(Number(process.env.STUB_PIXEL_RC || 0));`);
let hits = 0;
const server = createServer((_req, res) => { hits++; res.end('<html><body>wired-proposed</body></html>'); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const buildUrl = `http://127.0.0.1:${server.address().port}/wired-proposed.html`;
const gate = (label, env = {}, marker = 'wired-proposed') => new Promise((resolve) => {
  const child = spawn('bash', [join(replica, 'gate.sh'), 'wired', 'https://live.example/', buildUrl, '1440', label, '--marker', marker], { cwd: root, env: { ...process.env, GATE_REAP_MIN: '0', STARDUST_ROUND_CAP: '', GATE_REGIME: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (x) => (stdout += x));
  child.stderr.on('data', (x) => (stderr += x));
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
const wdir = join(root, 'stardust/replica/gates/wired-1440');
const stageRounds = (s = 'prototype') => (existsSync(join(wdir, 'rounds.json')) ? read(wdir).stages[s]?.rounds || [] : []);
const callCount = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0);

r = spawnSync('bash', [join(replica, 'gate.sh'), '--help'], { encoding: 'utf8' });
check('gate.sh --help documents exit 6 and STARDUST_ROUND_CAP=0', /6 round refused by the cap/.test(r.stdout) && /STARDUST_ROUND_CAP=0/.test(r.stdout));
r = await gate('iter1', { STUB_STITCH_RC: '124' });
check('gate.sh: a deadline round (exit 124) records nothing', r.status === 124 && stageRounds().length === 0, `status ${r.status} ${r.stderr}`);
r = await gate('iter1', { STUB_STITCH_RC: '3' });
check('gate.sh: a blocked round (exit 3) records nothing', r.status === 3 && stageRounds().length === 0);
r = await gate('iter1', {}, 'another-project');
check('gate.sh: an identity failure (exit 4) records nothing', r.status === 4 && stageRounds().length === 0, `status ${r.status}`);
r = await gate('iter1', { STUB_PIXEL_RC: '2' });
check('gate.sh: a FAIL round (exit 2) is recorded as first', r.status === 2 && stageRounds().map((x) => `${x.label}:${x.verdict}:${x.kind}`).join() === 'iter1:fail:first' && /rounds: wired-1440 prototype — recorded "iter1" fail as first/.test(r.stdout), `status ${r.status} ${r.stdout} ${r.stderr}`);
r = await gate('iter2', { STUB_PIXEL_RC: '1' });
check('gate.sh: a compare error (exit 1) records nothing', r.status === 1 && stageRounds().length === 1);
await gate('iter2', { STUB_PIXEL_RC: '2' });
r = await gate('iter3', { STUB_PIXEL_RC: '2' });
check('gate.sh: first + two fix rounds recorded', r.status === 2 && stageRounds().length === 3);
const before = { calls: callCount(), hits, files: readdirSync(wdir).sort().join() };
r = await gate('iter4', { STUB_PIXEL_RC: '0' });
check('gate.sh: the round after the cap exits 6 with the decide command on stderr', r.status === 6 && /rounds\.mjs decide stardust\/replica\/gates\/wired-1440 --stage prototype/.test(r.stderr), `status ${r.status} ${r.stderr}`);
check('… before any work: no instrument started, the build URL not fetched, no evidence written', callCount() === before.calls && hits === before.hits && readdirSync(wdir).sort().join() === before.files);
r = await gate('pub1', { STUB_PIXEL_RC: '0', GATE_REGIME: 'published' });
check('gate.sh: the published stage runs and records apart (PASS)', r.status === 0 && stageRounds('published').map((x) => `${x.verdict}:${x.kind}`).join() === 'pass:first' && stageRounds().length === 3, `status ${r.status} ${r.stderr}`);
r = await gate('iter4', { STUB_PIXEL_RC: '0', STARDUST_ROUND_CAP: '0' });
check('gate.sh: STARDUST_ROUND_CAP=0 runs the round and still records it', r.status === 0 && stageRounds().length === 4 && /cap check off/.test(r.stdout), `status ${r.status} ${r.stderr}`);
r = await gate('confirm', { STUB_PIXEL_RC: '0' });
check('gate.sh: after a PASS the confirmation runs at the cap and is recorded as confirm', r.status === 0 && stageRounds().at(-1).kind === 'confirm');

server.close();
if (process.env.ROUNDS_TEST_KEEP) console.log(`sandbox kept at ${root}`);
else rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
