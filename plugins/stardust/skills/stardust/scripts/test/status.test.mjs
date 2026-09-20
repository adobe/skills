#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/status.mjs — the read-only state report.
 * Run: node skills/stardust/scripts/test/status.test.mjs   (exit 1 on failure; no network)
 *   - `--json --no-probe` on evals/_shared/fixture-post-migrate: 6 migrated pages, 3 archetypes with the recorded
 *     numbers (home 2.14 / 3.87 PASS, article 11.6 / 12.4 FAIL, program `no verdict`), probes "not probed",
 *     reconcile "not reconciled", lastStatus.event "blocked", the missing-`next` warning, exit 0;
 *   - the fixture tree is byte-identical after the run and no stardust/.work/run.lock appears;
 *   - text mode prints the § State report blocks; --markdown opens with the gate table and ends with report-check;
 *   - replica-flow recommendation is `$stardust replica insurance__home` (from gate-ledger-lint), then rollout;
 *   - `Usage:` copies stardust/usage.json totals in the ledger's k / M form (180 requests, fresh 121.1 k, cache read
 *     55.93 M, output 304.1 k, est. USD 32.77, harness-reported USD 34.10) — never recomputed; absent file → no line;
 *   - --reconcile without a token reads `credentials.siteTokenEnv` (state-machine.md § Credentials key), not DA_TOKEN;
 *   - a live host with slug-less migrated pages: the probe sample skips them (warning, no TypeError, no request);
 *     `Preflight:` copies env.json `missing`; --sample must be a positive integer (else exit 2);
 *   - --help exits 0; unknown flag exits 2; no state.json exits 2.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'status.mjs');
const FIX = join(here, '..', '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate');
const snapshot = (d) => { const out = {}; (function walk(p) { for (const e of readdirSync(p)) { const f = join(p, e); if (statSync(f).isDirectory()) walk(f); else out[relative(d, f)] = readFileSync(f); } })(d); return out; };
const run = (...a) => spawnSync(process.execPath, [CLI, '--root', FIX, ...a], { encoding: 'utf8' });

const before = snapshot(FIX);
let r = run('--json', '--no-probe');
assert.equal(r.status, 0, r.stderr);
const j = JSON.parse(r.stdout);
assert.equal(j.pages.total, 6);
assert.deepEqual(Object.keys(j.pages.byStatus), ['migrated']);
assert.equal(j.pages.byStatus.migrated.length, 6, 'six migrated pages');
const g = (a, bp) => j.gates.find((x) => x.archetype === a && String(x.bp) === String(bp));
assert.deepEqual([g('home', 1440).verdict, g('home', 1440).pixelPct, g('home', 360).verdict, g('home', 360).pixelPct], ['PASS', 2.14, 'PASS', 3.87]);
assert.deepEqual([g('news__storm-season-checklist', 1440).verdict, g('news__storm-season-checklist', 1440).pixelPct, g('news__storm-season-checklist', 360).pixelPct], ['FAIL', 11.6, 12.4]);
const prog = j.gates.find((x) => x.archetype === 'insurance__home');
assert.equal(prog.verdict, 'no verdict', 'never gated is no verdict, not FAIL');
assert.equal(new Set(j.gates.map((x) => x.archetype)).size, 3, 'three archetypes');
assert.equal(j.probes, 'not probed');
assert.equal(j.delivery.reconcile, 'not reconciled');
assert.equal(j.lastStatus.event, 'blocked');
assert.ok(j.warnings.some((w) => w.startsWith('no `next` on the last blocked line')), `missing-next warning\n${j.warnings}`);
assert.equal(j.flow.flow, 'replica');
assert.equal(j.recommendation.command, '$stardust replica insurance__home', JSON.stringify(j.recommendation));
assert.match(j.recommendation.why, /then \$stardust rollout/);
assert.equal(j.activeRun, null);
assert.equal(j.decisions, null, 'no decisions.md in the fixture');

// nothing written
assert.deepEqual(snapshot(FIX), before, 'fixture byte-identical after the run');
assert.ok(!existsSync(join(FIX, 'stardust', '.work', 'run.lock')), 'no run.lock created');

// text render
r = run('--no-probe');
assert.equal(r.status, 0, r.stderr);
for (const re of [/^stardust state$/m, /^Site:\s+https:\/\/www\.larkspurmutual\.example \(extracted 2026-09-08, 6\/6 pages\)$/m, /^Flow:\s+replica \(chosen 2026-09-14 from the keep-vs-redesign question\)$/m,
  /^Last phase:\s+rollout setup blocked 2026-09-14T08:31:40Z$/m, /^  ✓ migrated\s+home, business, /m, /^  home\s+1440\s+PASS\s+2\.14 %/m, /^  insurance__home\s+—\s+no verdict/m,
  /^Delivery:\s+coverage no rollout coverage · ledger none · admin not reconciled$/m, /^Probes:\s+not probed$/m, /^program: blocked — never gated/m,
  /^Recommended next: \$stardust replica insurance__home$/m, /^warning: no `next` on the last blocked line/m]) assert.match(r.stdout, re);
assert.ok(!/^Repo:/m.test(r.stdout), 'no Repo block: the fixture is not its own git top-level');
assert.match(r.stdout, /^Usage:\s+180 requests · fresh 121\.1 k · cache read 55\.93 M · output 304\.1 k · est\. USD 32\.77 · harness-reported USD 34\.10 \(session\) — 4 window\(s\), copied from stardust\/usage\.json 2026-09-14$/m, 'Usage line copies usage.json in k / M form');
assert.deepEqual([j.usage.turns, j.usage.fresh, j.usage.cacheRead, j.usage.output, j.usage.estCost, j.usage.harnessCostUSD, j.usage.windows], [180, 121100, 55930000, 304100, 32.77, 34.1, 4]);

// markdown render
r = run('--markdown', '--no-probe');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /^\| page \/ archetype \| bp \| verdict \| pixel % \|/, 'gate table first');
assert.match(r.stdout, /^\| home \| 1440 \| PASS \| 2\.14 \|/m);
assert.match(r.stdout, /^\| insurance__home \| — \| no verdict \|/m);
assert.match(r.stdout, /^report-check: \d+ paths ls-verified · \d+ counts re-read from progress\.json\/state\.json$/m);
assert.deepEqual(snapshot(FIX), before, 'still byte-identical');

// exits
r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
assert.equal(r.status, 0); assert.match(r.stdout, /Exit codes: 0 report printed/);
r = run('--bogus');
assert.equal(r.status, 2, 'unknown flag exits 2');
const empty = mkdtempSync(join(tmpdir(), 'status-empty-'));
try {
  r = spawnSync(process.execPath, [CLI, '--root', empty], { encoding: 'utf8' }); assert.equal(r.status, 2, 'no state.json exits 2'); assert.match(r.stderr, /no readable stardust\/state\.json/);
  // minimal project: no usage.json → no Usage line; --reconcile with no token → names credentials.siteTokenEnv, no network
  mkdirSync(join(empty, 'stardust'), { recursive: true });
  writeFileSync(join(empty, 'stardust', 'state.json'), JSON.stringify({ pages: [], credentials: { siteTokenEnv: 'SITE_TOKEN_STATUSTEST' } }));
  const env = { ...process.env }; delete env.SITE_TOKEN_STATUSTEST; env.DA_TOKEN = 'not-the-configured-variable';
  r = spawnSync(process.execPath, [CLI, '--root', empty, '--json', '--no-probe', '--reconcile'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.usage, null, 'no usage.json → no Usage block');
  assert.equal(m.delivery.reconcile, 'not reconciled (no token in $SITE_TOKEN_STATUSTEST)', 'token env comes from credentials.siteTokenEnv, not DA_TOKEN');
  assert.ok(!/not-the-configured-variable/.test(r.stdout), 'token value never printed');
  r = spawnSync(process.execPath, [CLI, '--root', empty, '--no-probe'], { encoding: 'utf8' });
  assert.ok(!/^Usage:/m.test(r.stdout), 'text mode omits the Usage line without the file');
  // slug-less migrated pages + a live host, probes ON: sample is empty (no HEAD, no served-check — no styles.css), exit 0, a warning
  writeFileSync(join(empty, 'stardust', 'state.json'), JSON.stringify({ pages: [{ status: 'migrated' }, { status: 'migrated', url: 'https://x.example/a' }], site: { deployUrl: 'https://main--site--org.aem.page' } }));
  mkdirSync(join(empty, 'stardust', '.work'), { recursive: true });
  writeFileSync(join(empty, 'stardust', '.work', 'env.json'), JSON.stringify({ preflight: 'partial', missing: ['missing: chromium — run: node preflight-runtime.mjs'] }));
  r = spawnSync(process.execPath, [CLI, '--root', empty, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `slug-less pages never throw\n${r.stderr}`);
  const s = JSON.parse(r.stdout);
  assert.deepEqual(s.probes, { host: 'https://main--site--org.aem.page', sample: [], tokens: null }, 'slug-less pages skipped, nothing fetched');
  assert.ok(s.warnings.some((w) => w.startsWith('probes: 2 migrated page(s) without `slug` skipped')), `skip warning\n${s.warnings}`);
  assert.deepEqual(s.preflightMissing, ['missing: chromium — run: node preflight-runtime.mjs']);
  r = spawnSync(process.execPath, [CLI, '--root', empty, '--no-probe'], { encoding: 'utf8' });
  assert.match(r.stdout, /^Preflight:\s+partial — 1 item\(s\): missing: chromium — run: node preflight-runtime\.mjs$/m, 'Preflight line copies the missing items');
  for (const v of ['abc', '0', '-1', '2.5', '']) { r = spawnSync(process.execPath, [CLI, '--root', empty, '--sample', v], { encoding: 'utf8' }); assert.equal(r.status, 2, `--sample ${JSON.stringify(v)} exits 2`); assert.match(r.stderr, /positive integer/); }
  r = spawnSync(process.execPath, [CLI, '--root', empty, '--sample'], { encoding: 'utf8' }); assert.equal(r.status, 2, '--sample without a value exits 2');
} finally { rmSync(empty, { recursive: true, force: true }); }
console.log('status test: ok (6 pages, 3 archetypes copied from the ledger, no verdict for the ungated one, not probed / not reconciled, missing-next warning, replica recommendation, Usage in k / M from usage.json, siteTokenEnv for --reconcile, slug-less probe sample skipped, Preflight copies missing, --sample validated, nothing written, text + markdown, exits)');
