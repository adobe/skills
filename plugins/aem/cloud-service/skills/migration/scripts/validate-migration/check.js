#!/usr/bin/env node
'use strict';

/**
 * validate-migration check — verify one or more migrated patterns on the customer's local Cloud SDK.
 *
 *   validate-migration check                                 (auto: diff branch vs main, verify what changed)
 *   validate-migration check <pattern>                       (manual: verify one pattern, flags auto-resolved)
 *   validate-migration check <pattern> --finding <id> --project-id <pid> --project <dir>
 *
 * Auto mode diffs the current branch against `main`/`origin/main` (see plan.js),
 * classifies changed files into supported patterns, and runs each as its own
 * build → deploy → verify task — each task produces its own outcome and MCP payload.
 *
 * Config, all optional (never persisted to disk):
 *   AEM_SDK_URL      SDK base URL (default http://localhost:4602)
 *   --sdk            CLI override
 *
 * The scripts never contact AEM directly or handle AEM credentials: deploy
 * runs the project's own auto-install Maven profile, and runtime state comes
 * from the AEM Quickstart MCP `diagnose-osgi-bundle` tool.
 *
 * Reads the CAM project (if any) from the nearest migration-runbook.json written by the
 * analyze / migration skill, and <cwd>/pom.xml as the default project root.
 *
 * Pipeline (per task): build → discover class → deploy → verify → emit outcome via MCP.
 * Exits 0 validated and recorded, 1 validation failed, 2 usage/error,
 * 3 incomplete (awaiting MCP diagnosis or reporting acknowledgement).
 * Never modifies customer code.
 */
if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('[validate-migration] Node 18+ required.');
  process.exit(2);
}
const fs = require('fs');
const path = require('path');
const { FAILURE_CLASSES } = require('./failure-classes.js');
const { build } = require('./build.js');
const { deploy } = require('./deploy.js');
const { computeValidationPlan } = require('./plan.js');
const { clearDiagnosisMap } = require('./check/lib/diagnosis.js');
const { writeLocalReport, finalizeReporting, resolveSdkUrl, camReportingNote, normalizeBundleState, buildMcpPayload, validationChecks } = require('./reporting.js');

const PATTERNS = require('./check/patterns');
const { canonicalPattern } = require('./check/patterns/aliases.js');

// Wall-clock start of this run, captured in main(), used for started_at on
// every outcome so run duration is honest.
let RUN_STARTED_AT = null;

async function main() {
  RUN_STARTED_AT = new Date().toISOString();
  const args = parseArgs(process.argv.slice(2));
  if (args.pattern && !PATTERNS[args.pattern]) fatal(`unknown pattern: ${args.pattern}\nsupported: ${Object.keys(PATTERNS).join(', ')}`);

  const stage = args.stage || 'all';
  if (!['prepare', 'verify', 'all', 'finalize'].includes(stage)) {
    fatal(`unknown --stage: ${stage}. Use one of: prepare, verify, all, finalize.`);
  }

  if (stage === 'finalize') {
    if (!args.report || !args.receipt) fatal('--stage finalize requires --report <json> and --receipt <json>');
    const record = JSON.parse(fs.readFileSync(args.report, 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(args.receipt, 'utf8'));
    const finalized = finalizeReporting(record, receipt);
    const report = writeLocalReport(finalized, args.project || process.cwd());
    console.log(`reporting: ${finalized.reporting.status}\nlocal report: ${report.mdPath}`);
    process.exit(finalized.reporting.status !== 'recorded' ? 3 : finalized.result === 'pass' ? 0 : 1);
  }

  const context = readContext(args);

  // Local validation does not require a CAM project-id. When one is available
  // (either --project-id or auto-loaded from the nearest migration-runbook.json),
  // we emit the submit-migration-validation-result payload; otherwise we skip that reporting
  // step and just print the local outcome.
  const explicitProject = args['project-id'] || args['project-name'];
  if (!explicitProject && context.projectId) {
    args['project-id'] = context.projectId;
    console.log(`(auto) project-id = ${args['project-id']}`);
  }
  if (!explicitProject && context.projectName) {
    args['project-name'] = context.projectName;
  }

  const cwd = args.project || process.cwd();
  const statePath = path.join(cwd, '.validate-migration', 'state.json');

  // ---- stage: verify (consume persisted state + agent-supplied MCP diagnosis) ----
  if (stage === 'verify') {
    if (!fs.existsSync(statePath)) {
      fatal(`no ${path.relative(cwd, statePath)} found. Run --stage prepare first.`);
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    RUN_STARTED_AT = state.started_at || RUN_STARTED_AT;
    const records = [];
    for (const t of state.prepared) {
      records.push(await verifyPreparedTask(t, args));
    }
    return finishAll(records, args);
  }

  // ---- stage: prepare | all ----
  // A fresh prepare rebuilds + redeploys, so any diagnosis map from a prior run
  // is stale. Clear the default map so verify can't read stale bundle state
  // (an explicit --diagnosis-map is left as-is — it may be a fixture).
  if (!args['diagnosis-map']) {
    clearDiagnosisMap(cwd);
  }

  // Resolve tasks: either the pattern the caller pinned, or an auto-detected
  // set from diffing the branch against main (plan.js).
  let tasks;
  if (args.pattern) {
    if (!args.project && !args.jar) {
      if (fs.existsSync(path.join(process.cwd(), 'pom.xml'))) {
        args.project = process.cwd();
        console.log(`(auto) project    = ${args.project}`);
      } else {
        fatal('no --project or --jar and current directory has no pom.xml — cd into your project or pass --project <dir>');
      }
    }
    tasks = [{ module: args.project, jar: args.jar, pattern: args.pattern, fqcn: args.fqcn, template: args.template }];
  } else {
    const plan = computeValidationPlan({ cwd, baseRef: args.base });
    if (plan.error) fatal(`could not auto-detect what to verify: ${plan.error} — pass --pattern <name> to run one pattern manually`);
    if (plan.tasks.length === 0) {
      console.log(`[validate-migration] no validate-migration-relevant changes vs ${plan.baseRef} — nothing to verify.`);
      process.exit(0);
    }
    console.log(`[validate-migration] auto-detected ${plan.tasks.length} task(s) from diff vs ${plan.baseRef}:`);
    for (const t of plan.tasks) console.log(`  • ${t.pattern} — ${path.relative(cwd, t.module) || '.'} (${t.files.length} file(s) changed)`);
    tasks = plan.tasks;
  }

  const anyNeedsSdk = tasks.some((t) => PATTERNS[t.pattern].mode !== 'source-only');
  const sdkUrl = anyNeedsSdk ? resolveSdkUrl(args) : null;
  if (anyNeedsSdk && !sdkUrl) {
    fatal('no usable Cloud SDK URL; see the diagnostic above and pass --sdk <url>.');
  }
  const prepared = [];
  for (const task of tasks) {
    const p = await prepareTask(task, { sdkUrl });
    if (p.pattern === 'custom-templates') p.requireRuntime = args['template-mode'] === 'runtime' || !!args['template-evidence'];
    if (p.pattern === 'custom-templates' && p.discovered?.templates) {
      for (const template of p.discovered.templates) {
        prepared.push({ ...p, discovered: { template } });
      }
    } else prepared.push(p);
  }

  // Persist prepared state so `--stage verify` (potentially re-invoked after
  // the agent gathers MCP diagnosis) doesn't have to rebuild + redeploy.
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ started_at: RUN_STARTED_AT, prepared }, null, 2));

  // Bundle-runtime patterns need the agent to gather MCP diagnosis BETWEEN
  // prepare and verify. `--stage all` gives no such window, so when bundle
  // tasks are present (and no explicit map was supplied) we stop after prepare
  // with guidance instead of running — and failing — verify.
  const bundleTasks = prepared.filter((p) => p.mode === 'bundle-runtime' && !p.failure);

  // Give DS components time to settle after deploy before the agent diagnoses.
  const settleMs = Number(args['settle-ms'] ?? 5000);
  if (bundleTasks.length && !args['diagnosis-map'] && settleMs > 0) {
    step(`settle ${settleMs}ms for DS activation`);
    await sleep(settleMs);
  }

  const { stop: stopAfterPrepare, exitCode: prepareExitCode } = prepareStopDecision(stage, bundleTasks.length, !!args['diagnosis-map']);

  if (stopAfterPrepare) {
    console.log(`\n[validate-migration] prepare complete. ${prepared.length} task(s) staged.`);
    const bsns = [...new Set(prepared.map((p) => p.symbolicName).filter(Boolean))];
    if (bsns.length) {
      const next = verifyGuidance({ projectDir: cwd });
      console.log('Have the coding assistant call the AEM Quickstart MCP tool `diagnose-osgi-bundle` (argument `bundleSymbolicName`) for each of these bundles:');
      for (const b of bsns) console.log(`  - ${b}`);
      console.log(`then write the raw tool outputs to ${next.mapPath} as a { "<BSN>": "<raw text>" } map,`);
      console.log(`and finally re-run:  ${next.command}`);
    }
    if (stage === 'all' && bundleTasks.length) {
      console.warn(`[validate-migration] --stage all can't verify ${bundleTasks.length} bundle-runtime pattern(s) in one shot — stopped after prepare. Gather MCP diagnosis, then re-run --stage verify.`);
    }
    process.exit(prepareExitCode);
  }

  // Only source-only tasks (or an explicit --diagnosis-map): verify now.
  const records = [];
  for (const t of prepared) {
    records.push(await verifyPreparedTask(t, args));
  }
  return finishAll(records, args);
}

// prepareTask: build → discover → (source-only verify | deploy). Returns a
// serializable record persisted to .validate-migration/state.json and later
// consumed by verifyPreparedTask.
async function prepareTask(task, { sdkUrl }) {
  const pat = PATTERNS[task.pattern];
  console.log(`\n=== validate-migration prepare · ${task.pattern} ===`);
  console.log(task.jar ? `jar    : ${task.jar}` : `project: ${task.module}`);
  if (pat.mode !== 'source-only') console.log(`sdk    : ${sdkUrl}`);
  console.log(`pattern: ${pat.describe}\n`);

  // 1. build (unless a pre-built jar was supplied)
  let artifactPath;
  if (task.jar) {
    if (!fs.existsSync(task.jar)) {
      return { pattern: task.pattern, module: task.module, jar: task.jar,
        failure: { result: 'fail', failure_class: FAILURE_CLASSES.INPUT_JAR_MISSING, verification_level: 'source-only', evidence: `no file at ${task.jar}` } };
    }
    artifactPath = task.jar;
    console.log(`▸ skip build (using --jar)\n  ok (${path.basename(artifactPath)})\n`);
  } else {
    step('build customer project');
    const b = build({ projectDir: task.module, artifact: pat.mode === 'source-only' ? 'content-package' : 'bundle' });
    if (!b.ok) {
      return { pattern: task.pattern, module: task.module,
        failure: { result: 'fail', failure_class: FAILURE_CLASSES.BUILD_FAILED, verification_level: 'source-only', evidence: b.log } };
    }
    artifactPath = b.artifactPath;
    console.log(`  ok (${path.basename(artifactPath)}, ${b.elapsedMs}ms)\n`);
  }

  // 2. auto-discover
  step('discover migrated class');
  const discovered = pat.discover(artifactPath, task);
  if (!discovered) {
    return { pattern: task.pattern, module: task.module, artifactPath,
      failure: { result: 'fail', failure_class: FAILURE_CLASSES.DISCOVERY_NO_MATCH, verification_level: 'source-only', evidence: `no DS component in ${artifactPath} matches the ${task.pattern} signature` } };
  }
  console.log(`  ok → ${JSON.stringify(discovered)}\n`);

  // Source-only patterns: no deploy; verify runs off the artifact only.
  if (pat.mode === 'source-only') {
    return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'source-only' };
  }

  // 3. deploy the customer bundle
  step('deploy customer bundle');
  const d = await deploy({ projectDir: task.module, artifactPath, sdkUrl });
  if (!d.ok) {
    const unreachable = isSdkUnreachable(d.log);
    return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'bundle-runtime',
      symbolicName: d.symbolicName || null,
      failure: { result: 'fail', failure_class: unreachable ? FAILURE_CLASSES.SDK_UNREACHABLE : FAILURE_CLASSES.DEPLOY_FAILED,
        verification_level: 'runtime',
        evidence: unreachable ? `Cloud SDK not reachable at ${sdkUrl}; start it and rerun prepare.\n${d.log}` : d.log,
        ...(d.symbolicName ? { bundle: { symbolic_name: d.symbolicName, state: normalizeBundleState() } } : {}) } };
  }
  console.log(`  ok (bundle ${d.symbolicName}${d.mode ? ' via ' + d.mode : ''})\n`);
  return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'bundle-runtime', symbolicName: d.symbolicName, deployMode: d.mode };
}

// verifyPreparedTask: source-only patterns verify off the artifact; runtime
// patterns require the agent-supplied MCP diagnosis-map.
async function verifyPreparedTask(prepared, args) {
  if (prepared.failure) {
    return { pattern: prepared.pattern, ...prepared.failure, discovered: prepared.discovered };
  }
  const pat = PATTERNS[prepared.pattern];
  if (prepared.mode === 'source-only') {
    step(`source verify · ${prepared.pattern}`);
    const outcome = await pat.verify({ artifactPath: prepared.artifactPath, discovered: prepared.discovered,
      ...(prepared.pattern === 'custom-templates' ? {
        requireRuntime: prepared.requireRuntime || args['template-mode'] === 'runtime' || !!args['template-evidence'],
        runtimeEvidencePath: args['template-evidence'],
        runStartedAt: RUN_STARTED_AT,
        projectDir: prepared.module,
        staticTemplate: args['static-template'],
        baselineRef: args['baseline-ref'],
      } : {}) });
    console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'}${outcome.evidence ? ' — ' + outcome.evidence : ''}\n`);
    return { pattern: prepared.pattern, ...outcome, verification_level: outcome.verification_level || 'source-only', discovered: prepared.discovered };
  }

  step(`runtime verify · ${prepared.pattern}`);
  const outcome = await pat.verify({ bundleBSN: prepared.symbolicName, discovered: prepared.discovered, args });
  console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'} — bundle=${outcome.bundle_state} component=${outcome.component_state}${outcome.evidence ? '  ' + outcome.evidence : ''}\n`);

  return {
    pattern: prepared.pattern,
    ...outcome,
    verification_level: outcome.verification_level || 'runtime',
    discovered: prepared.discovered,
    bundle: { symbolic_name: prepared.symbolicName, state: normalizeBundleState(outcome.bundle_state) },
  };
}

// ---- orchestration helpers ----

function step(name) { console.log(`▸ ${name}`); }

function fatal(msg) { console.error(msg); process.exit(2); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Decide whether prepare stops before verify, and the exit code if it does.
// `--stage prepare` completing is success (0); an `all` run that stops early
// (bundle-runtime tasks, no diagnosis map) verified nothing → 3 (incomplete).
function prepareStopDecision(stage, bundleTaskCount, hasDiagnosisMap) {
  const stop = stage === 'prepare' || (bundleTaskCount > 0 && !hasDiagnosisMap);
  return { stop, exitCode: stage === 'prepare' ? 0 : 3 };
}

// Next step printed after prepare. Paths are relative to where the user runs the
// command, and --project is repeated so verify reads the same state.json.
function verifyGuidance({ projectDir, runDir = process.cwd(), script = __filename }) {
  const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const rel = path.relative(runDir, path.resolve(runDir, projectDir));
  return {
    mapPath: path.join(rel, '.validate-migration', 'diagnosis-map.json'),
    command: `node ${quote(script)} --stage verify${rel ? ` --project ${quote(rel)}` : ''}`,
  };
}

// Aggregates every task's outcome record into one run, prints it, emits the
// MCP payload once for the whole run. Reporting is optional: with no linked CAM
// project the run is complete locally; with one, a pass awaits acknowledgement.
function finishAll(records, args) {
  const linked = Boolean(args && (args['project-id'] || args['project-name']));
  const initialReporting = linked ? { status: 'pending' } : { status: 'not_reported' };
  // Each template is an independent run/receipt: a failed sibling cannot make
  // another template look passed or prevent its outcome from being submitted.
  if (records.length > 1 || records.some((r) => r.pattern === 'custom-templates')) {
    const finishedAt = new Date().toISOString();
    const runBase = Date.now() * 1000;
    for (const [index, outcome] of records.entries()) {
      const record = { run_id: `vm-${runBase + index}`, started_at: RUN_STARTED_AT || finishedAt, finished_at: finishedAt,
        result: outcome.result, verification_level: outcome.verification_level || 'runtime',
        classes: [{ ...outcome, checks: validationChecks(outcome) }], reporting: initialReporting };
      const report = writeLocalReport(record, args.project || process.cwd());
      console.log(`\n${outcome.discovered?.template || outcome.pattern}: ${outcome.result}; local report: ${report.mdPath}`);
      if (linked) {
        console.log('\n=== submit-migration-validation-result payload ===');
        console.log(JSON.stringify(buildMcpPayload(record, args)));
        console.log('=== end payload ===');
      } else console.log(camReportingNote(args));
    }
    process.exit(records.some((r) => r.result === 'fail') ? 1 : linked ? 3 : 0);
  }
  const finishedAt = new Date().toISOString();
  const record = {
    run_id: 'vm-' + Date.now(),
    started_at: RUN_STARTED_AT || finishedAt,
    finished_at: finishedAt,
    result: records.some((r) => r.result === 'fail') ? 'fail' : 'pass',
    verification_level: records.some((r) => r.verification_level === 'runtime') ? 'runtime' : 'source-only',
    classes: records.map((outcome) => ({ ...outcome, checks: validationChecks(outcome) })),
    reporting: initialReporting,
  };
  console.log('=== outcome ===');
  console.log(JSON.stringify(record, null, 2));

  // Always leave a local record next to the code, even when no CAM project is linked.
  const cwd = (args && args.project) || process.cwd();
  const report = writeLocalReport(record, cwd);
  console.log(`\nlocal report: ${report.mdPath}`);

  // Emit the submit-migration-validation-result payload when a CAM project (id or name) is available.
  // The agent submits this block through MCP and finalizes with its receipt.
  if (linked) {
    const payload = buildMcpPayload(record, args);
    console.log('\n=== submit-migration-validation-result payload ===');
    console.log(JSON.stringify(payload));
    console.log('=== end payload ===');
  } else {
    console.log(`\n${camReportingNote(args)}`);
  }

  if (!linked) process.exit(record.result === 'pass' ? 0 : 1);
  console.log('\ncompletion: incomplete — save the MCP acknowledgement and run --stage finalize');
  process.exit(record.result === 'pass' ? 3 : 1);
}

// Human- and machine-readable record written to <project>/.validate-migration/<run_id>.{md,json}.

function parseArgs(argv) {
  const out = {};
  if (argv[0] && !argv[0].startsWith('--')) out.pattern = argv[0];
  const rest = out.pattern ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const k = rest[i].replace(/^--/, '');
    out[k] = rest[++i];
  }
  if (out.pattern) out.pattern = canonicalPattern(out.pattern);
  return out;
}

// ---- CAM project link (from migration-runbook.json written by the analyze / migration skill) ----
// Shape in that file: { project: { id: string, name?: string }, ... }
// Nearest migration-runbook.json wins, searching up from the project so a module (core/) finds the repo-root one.
function readContext(args) {
  let dir = path.resolve((args && args.project) || process.cwd());
  for (let i = 0; i < 6; i++) {
    const runbookPath = path.join(dir, 'migration-runbook.json');
    if (fs.existsSync(runbookPath)) {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(runbookPath, 'utf8')); } catch { return {}; }
      const project = parsed && parsed.project;
      if (!project || !project.id) return {};
      return { projectId: project.id, projectName: project.name || undefined };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}


if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(2); });
}

// A Maven install that cannot open a connection means the SDK is not running at the selected URL.
function isSdkUnreachable(log) {
  return /Connection refused|ConnectException|UnknownHostException|No route to host/i.test(log || '');
}

module.exports = { parseArgs, readContext, prepareStopDecision, isSdkUnreachable, verifyGuidance };
