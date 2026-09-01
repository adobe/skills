'use strict';

/**
 * pipeline.js — the RV verification pipeline for a single pattern.
 *
 *   source gate  →  build  →  deploy to SDK  →  preflight  →  runtime gate  →  outcome record
 *
 * Usage:
 *   node pipeline.js <pattern> [flags]
 *
 *   pattern: scheduler | asset-manager | event-migration | replication
 *
 * Flags:
 *   --sdk       <url>     SDK URL   (default http://localhost:4602)
 *   --sdk-home  <path>    Filesystem path to the Cloud SDK install so RV can
 *                         tail crx-quickstart/logs/error.log for scheduler
 *                         firing + event-migration offload markers. Also honored
 *                         via env RV_SDK_HOME. Without this scheduler/event
 *                         runtime checks WILL be reported as log_unreadable
 *                         rather than silently failing.
 *   --project   <dir>     Bundle project (default projects/<pattern>/)
 *   --source    <file>    Source-gate input (default example/*.migrated.*)
 *   --verbose             Print build + deploy logs even on success
 *
 * Exits 0 on pass, 1 on any gate failure. Writes a regression eval fixture on fail.
 */
if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
  console.error('[rv] Node 18+ required (needs global fetch / FormData / Blob). Current: ' + process.version);
  process.exit(2);
}
const fs = require('fs');
const path = require('path');
const { verify } = require('./verify.js');
const { build } = require('./build.js');
const { deploy } = require('./deploy.js');
const { Probe } = require('./probe.js');
const { generateFixture } = require('./fixture.js');

const PATTERN_META = {
  scheduler:        { source: 'SimpleScheduledTask.migrated.java',     runtimeCheck: schedulerRuntime,   needsPostDeployWait: 4000, trigger: null, needsLog: true  },
  'asset-manager':  { source: 'AssetCleanupService.migrated.java',      runtimeCheck: assetRuntime,       needsPostDeployWait: 1500, trigger: '/bin/rv/deleteasset', needsLog: false },
  'event-migration':{ source: 'ReplicationEventHandler.migrated.java',  runtimeCheck: eventRuntime,       needsPostDeployWait: 2000, trigger: '/bin/rv/fireevent',   needsLog: true  },
  replication:      { source: 'ContentActivator.migrated.java',         runtimeCheck: replicationRuntime, needsPostDeployWait: 1500, trigger: '/bin/rv/distribute',  needsLog: false },
};

// Global run state (populated by main). Kept module-scoped so runtime checks
// can reach sdkHome/verbose without threading them through every function.
const RUN = { sdkHome: null, verbose: false };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = PATTERN_META[args.pattern];
  if (!meta) fatal(`unknown pattern: ${args.pattern}\nsupported: ${Object.keys(PATTERN_META).join(', ')}`);

  const RV = __dirname;
  const projectDir = args.project || path.join(RV, 'projects', args.pattern);
  const sourceFile = args.source || path.join(RV, 'example', meta.source);
  const sdkUrl = (args.sdk || 'http://localhost:4602').replace(/\/$/, '');
  RUN.sdkHome = args['sdk-home'] || process.env.RV_SDK_HOME || null;
  RUN.verbose = args.verbose === true || args.verbose === '';

  console.log(`\n=== RV pipeline · ${args.pattern} ===`);
  console.log(`project : ${projectDir}`);
  console.log(`source  : ${sourceFile}`);
  console.log(`sdk     : ${sdkUrl}`);
  if (meta.needsLog && !RUN.sdkHome) {
    console.log(`sdk-home: (not set) — this pattern reads the SDK log; pass --sdk-home <path> or set RV_SDK_HOME`);
  } else if (RUN.sdkHome) {
    console.log(`sdk-home: ${RUN.sdkHome}`);
  }
  console.log('');

  // 1. source gate
  step('source gate');
  const src = verify({ pattern: args.pattern, sourceFile, fixturesDir: path.join(RV, 'evals') });
  if (src.outcome.result !== 'pass') return finish(src.outcome, src.fixture);
  console.log(`  ok (${Object.keys(src.outcome.invariant_checks).length} checks)\n`);

  // 2. build
  step('build');
  const b = build({ projectDir });
  if (!b.ok) { if (b.log) console.log(indent(b.log)); return finish(mkOutcome(args.pattern, 'build', 'build.failed', b.log), null); }
  console.log(`  ok (${b.artifactPath.split('/').pop()}, ${b.elapsedMs}ms)`);
  if (RUN.verbose && b.log) console.log(indent(b.log));
  console.log('');

  // 3. deploy
  step('deploy');
  const d = await deploy({ artifactPath: b.artifactPath, sdkUrl });
  if (!d.ok) return finish(mkOutcome(args.pattern, 'deploy', 'deploy.failed', `${d.log} state=${d.state}`), null);
  console.log(`  ok (bundle id ${d.bundleId} · ${d.symbolicName} · Active in ${d.elapsedMs}ms)`);
  if (RUN.verbose && d.log) console.log(indent(d.log));
  console.log('');

  const probe = new Probe({ baseUrl: sdkUrl });

  // 4. preflight — ensure the RV trigger servlet actually exists (fails loudly
  //    instead of masquerading as a runtime.* fault)
  if (meta.trigger) {
    step('preflight');
    const check = await preflightTrigger(sdkUrl, meta.trigger);
    if (!check.ok) return finish(mkOutcome(args.pattern, 'preflight', 'preflight.trigger_missing',
      `${meta.trigger} not registered (HTTP ${check.status}) — bundle deployed but the RV trigger servlet did not activate`), null);
    console.log(`  ok (trigger ${meta.trigger} registered)\n`);
  }

  // 4b. preflight — ensure the SDK log is readable when a runtime check needs it
  if (meta.needsLog) {
    step('log preflight');
    const l = readLog('___rv_probe_never_matches___');
    if (!l.ok) return finish(mkOutcome(args.pattern, 'preflight', 'runtime.log_unreadable',
      `cannot read SDK log (${l.error}). Pass --sdk-home <path> or set RV_SDK_HOME so RV can observe scheduler/event markers.`), null);
    console.log(`  ok (${l.path})\n`);
  }

  // 5. runtime gate — pattern-specific
  step('runtime gate');
  if (meta.needsPostDeployWait) await sleep(meta.needsPostDeployWait);
  const r = await meta.runtimeCheck({ probe, sdkUrl });
  const runtimeOutcome = mkRuntimeOutcome(args.pattern, r);
  console.log(`  ${r.result === 'pass' ? 'ok' : 'FAIL'} — ${JSON.stringify(r.checks)}\n`);

  return finish(runtimeOutcome, r.result !== 'pass'
    ? generateFixture(runtimeOutcome, { evalsDir: path.join(RV, 'evals') }) : null);
}

// A servlet that exists but rejects the request (400/500) still returns
// non-404 — that's enough to prove it's registered. 404 means DS didn't wire it.
async function preflightTrigger(sdkUrl, triggerPath) {
  const auth = 'Basic ' + Buffer.from('admin:admin').toString('base64');
  try {
    const res = await fetch(`${sdkUrl}${triggerPath}`, { method: 'GET', headers: { Authorization: auth } });
    return { ok: res.status !== 404, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// ------- pattern runtime checks (thin: reuse invariant modules where they exist) -------
async function schedulerRuntime({ probe }) {
  const cmp = await probe.osgiComponent('com.adobe.aem.guides.core.schedulers.SimpleScheduledTask');
  const props = cmp.properties || {};
  const activeAsDs = cmp.found && cmp.active;
  const contractOk = props['scheduler.expression'] && (props['scheduler.runOn'] === 'LEADER' || props['scheduler.runOn'] === 'SINGLE');

  // Poll-with-early-exit: exits as soon as the run count advances (typical ~a few
  // seconds after a 30s cron ticks) or gives up at deadline. Fast on green, bounded on red.
  const NEEDLE = 'SimpleScheduledTask is now running';
  const before = readLog(NEEDLE);
  if (!before.ok) return { result: 'fail', failure_class: 'runtime.log_unreadable',
    checks: { active_as_ds: activeAsDs, contract_ok: !!contractOk }, evidence: before.error };

  const deadline = Date.now() + 40000;
  let after = before, fires = false;
  while (Date.now() < deadline) {
    await sleep(3000);
    after = readLog(NEEDLE);
    if (after.count > before.count) { fires = true; break; }
  }
  return {
    result: activeAsDs && contractOk && fires ? 'pass' : 'fail',
    checks: { active_as_ds: activeAsDs, contract_ok: !!contractOk, fires, fires_delta: after.count - before.count },
    failure_class: !activeAsDs ? 'runtime.component_not_active' : !contractOk ? 'runtime.contract_mismatch' : !fires ? 'runtime.not_firing' : null,
  };
}
async function assetRuntime({ probe }) {
  const mod = require('./invariants/asset-manager.js');
  return mod.check({ probe, target: { testPath: `/content/rv-test/probe-${Date.now()}`, triggerPath: '/bin/rv/deleteasset' } });
}
async function eventRuntime({ probe }) {
  const mod = require('./invariants/event-migration.js');
  // preflight already ensured RUN.sdkHome resolves an existing log file — but
  // return the honest error class if it disappears mid-run.
  const observe = async (id) => {
    const r = readLog(`RV EVENT JOB EXECUTED ${id}`);
    if (!r.ok) throw Object.assign(new Error(r.error), { rvFailureClass: 'runtime.log_unreadable' });
    return r.count > 0;
  };
  return mod.check({ probe, observe, target: { triggerPath: '/bin/rv/fireevent', pollMs: 2000, timeoutMs: 15000 } });
}
async function replicationRuntime({ probe }) {
  const mod = require('./invariants/replication.js');
  return mod.check({ probe, target: { testPath: `/content/rv-test/repl-${Date.now()}`, triggerPath: '/bin/rv/distribute' } });
}

// Read the SDK error.log from RV_SDK_HOME (or --sdk-home). Returns a structured
// result so callers can distinguish "no matches" from "cannot read the log at all".
function readLog(needle) {
  if (!RUN.sdkHome) return { ok: false, count: 0, path: null, error: 'no --sdk-home / RV_SDK_HOME set' };
  const p = path.join(RUN.sdkHome, 'crx-quickstart/logs/error.log');
  try {
    const content = fs.readFileSync(p, 'utf8');
    const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    return { ok: true, count: (content.match(rx) || []).length, path: p };
  } catch (e) {
    return { ok: false, count: 0, path: p, error: `${e.code || 'ERR'}: ${p}` };
  }
}

function indent(s) { return s.split('\n').map(l => '    ' + l).join('\n'); }

// ------- helpers -------
function step(name) { console.log(`▸ ${name}`); }
function fatal(msg) { console.error(msg); process.exit(2); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function mkOutcome(pattern, gate, failure_class, evidence) {
  return { run_id: 'rv-' + Date.now(), skill_pattern: pattern, verification_level: 'pipeline',
           result: 'fail', gate_results: { [gate]: 'fail' }, invariant_checks: {}, failure_class, evidence, finished_at: new Date().toISOString() };
}
function mkRuntimeOutcome(pattern, r) {
  return { run_id: 'rv-' + Date.now(), skill_pattern: pattern, verification_level: 'runtime',
           result: r.result, gate_results: { runtime: r.result }, invariant_checks: r.checks || {},
           failure_class: r.failure_class || null, evidence: r.evidence || '', finished_at: new Date().toISOString() };
}
function finish(outcome, fixture) {
  console.log('=== outcome ===');
  console.log(JSON.stringify(outcome, null, 2));
  if (fixture) console.log(`\nregression eval written: ${fixture}`);
  process.exit(outcome.result === 'pass' ? 0 : 1);
}
function parseArgs(argv) {
  const out = { pattern: argv[0] };
  const boolFlags = new Set(['verbose']);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.replace(/^--/, '');
    if (boolFlags.has(k)) { out[k] = true; continue; }
    out[k] = argv[++i];
  }
  return out;
}

main().catch(e => { console.error(e); process.exit(2); });
