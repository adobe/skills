'use strict';

/** Reporting + MCP-outcome builders for validate-migration (extracted from check.js). */
const fs = require('fs');
const path = require('path');
const { FAILURE_CLASSES } = require('./failure-classes.js');
const { readSetup, sameInstance, SDK_URL } = require('./setup.js');

function writeLocalReport(record, cwd) {
  // vm-<timestamp>; rvc-<timestamp> is accepted so earlier reports can still be finalized.
  if (typeof record.run_id !== 'string' || !/^(?:vm|rvc)-[0-9]+$/.test(record.run_id)) {
    throw new Error('invalid run_id: expected vm-<timestamp>');
  }
  const dir = path.join(cwd, '.validate-migration');
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, `${record.run_id}.md`);
  const jsonPath = path.join(dir, `${record.run_id}.json`);
  fs.writeFileSync(mdPath, renderLocalReport(record, dir), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');
  return { mdPath, jsonPath };
}

function renderLocalReport(record, reportDir) {
  const reporting = record.reporting || { status: 'pending' };
  const lines = [
    '# validate-migration report',
    '',
    `- run: ${record.run_id}`,
    `- validation result: ${record.result}`,
    `- verification level: ${record.verification_level}`,
    record.classes.some((c) => c.pattern === 'custom-templates')
      ? record.classes.some((c) => c.checks?.template_comparison)
        ? '- validation scope: template package contracts and source-to-target content/rendering comparison'
        : '- validation scope: editable-template package contracts only; rendering not verified'
      : '- validation scope: migration contracts and activation only',
    '- business behavior: not tested',
    `- reporting: ${reporting.status}`,
    `- completion: ${['recorded', 'not_reported'].includes(reporting.status) ? 'complete' : 'incomplete'}`,
    '- event delivery: unconfirmed (outcome acknowledgement does not confirm downstream delivery)',
    ...(reporting.stored_at ? [`- recorded at: ${reporting.stored_at}`] : []),
    ...(reporting.error ? [`- reporting error: ${reporting.error}`] : []),
    `- started: ${record.started_at}`,
    `- finished: ${record.finished_at}`,
    '',
    '| pattern | class | result | bundle | component | failure |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of record.classes || []) {
    const cls = (c.discovered && (c.discovered.fqcn || c.discovered.template)) || c.class_name || '—';
    const bundle = (c.bundle && c.bundle.state) || c.bundle_state || '—';
    lines.push(
      `| ${c.pattern || '—'} | ${cls} | ${c.result || '—'} | ${bundle} | ${c.component_state || '—'} | ${c.failure_class || '—'} |`,
    );
  }
  for (const entry of record.classes.filter((item) => item.pattern === 'custom-templates')) {
    const comparison = entry.checks?.template_comparison;
    lines.push('', '## Template Comparison', '', `- template: ${entry.discovered?.template || entry.class_name}`);
    if (!comparison) {
      lines.push('- runtime comparison: not verified', ...(entry.evidence ? [`- evidence: ${entry.evidence}`] : []));
      continue;
    }
    lines.push(`- source: ${comparison.source_url}`, `- target: ${comparison.target_url}`,
      `- captured: ${comparison.captured_at}`, `- cleanup: ${comparison.cleanup?.status || 'not_verified'}`, `- coverage: ${comparison.coverage}`);
    for (const capture of comparison.captures) {
      const directory = path.resolve(reportDir || process.cwd());
      const canonicalDirectory = fs.existsSync(directory) ? fs.realpathSync(directory)
        : path.join(fs.realpathSync(path.dirname(directory)), path.basename(directory));
      const screenshotLink = (file) => encodeURI(path.relative(canonicalDirectory, file).split(path.sep).join('/'));
      lines.push(`- ${capture.viewport.width}x${capture.viewport.height}: ${capture.result}; [source screenshot](${screenshotLink(capture.source)}); [target screenshot](${screenshotLink(capture.target)})`);
    }
    for (const difference of comparison.differences) lines.push(`- ${difference}`);
  }
  const restricted = (record.classes || []).filter((entry) => entry.restricted || entry.checks?.restricted);
  if (restricted.length) {
    lines.push('', '## Unverified Checks', '');
    for (const entry of restricted) {
      const className = entry.discovered?.fqcn || entry.class_name || entry.pattern;
      const reason = entry.restricted_reason || entry.checks?.restricted_reason || 'runtime contract not fully verified';
      lines.push(`- ${className}: ${reason}`);
    }
  }
  return lines.join('\n') + '\n';
}

function finalizeReporting(record, receipt) {
  const acknowledged = typeof record.run_id === 'string' && record.run_id.length > 0
    && receipt?.ok === true && receipt.run_id === record.run_id;
  const error = receipt?.error
    ? 'MCP submission failed; inspect the tool response without persisting credentials'
    : 'missing or mismatched MCP acknowledgement';
  const reporting = acknowledged
    ? stripEmpty({ status: 'recorded', run_id: receipt.run_id, stored_at: receipt.stored_at, duplicate: receipt.duplicate })
    : { status: 'failed', error };
  return { ...record, reporting };
}

// ---- SDK config (never persisted to disk) ----
// URL: honors --sdk / AEM_SDK_URL, then the saved setup, then the fixed SDK port 4602.
// The URL only targets the Maven deployment; AEM is never contacted from here.
// Refuses the AEM 6.5 source URL when one was given or saved.
function resolveSdkUrl(args) {
  const explicit = args.sdk || process.env.AEM_SDK_URL;
  // init.js may have run from the reactor root while check.js targets a module.
  const setups = [readSetup(args.project || process.cwd()), readSetup(process.cwd())];
  const saved = setups.map((s) => s.sdk_url).find(Boolean);
  const source = args.quickstart || setups.map((s) => s.quickstart_url).find(Boolean);
  const url = String(explicit || saved || SDK_URL).replace(/\/$/, '');
  try { new URL(url); } catch {
    console.error(`[validate-migration] invalid SDK URL: ${url}`);
    return null;
  }
  if (source && sameInstance(url, source)) {
    console.error(`[validate-migration] SDK URL ${url} is the AEM 6.5 source instance; pass the Cloud SDK URL with --sdk <url>.`);
    return null;
  }
  console.log(`(${explicit ? 'explicit' : saved ? 'setup' : 'default'}) SDK = ${url}`);
  return url;
}

function camReportingNote(args) {
  if (args && (args['project-id'] || args['project-name'])) return null;
  return 'not reported to CAM: no project linked (run analyze against a CAM project, or pass --project-id).';
}

// ---- MCP telemetry ----
// The version reported with each outcome is the validator's package version.
function declaredSkillVersion() {
  return require('./package.json').version;
}

const EVIDENCE_MAX = 2048;
const BUNDLE_STATE_ENUM = new Set(['Installed', 'Resolved', 'Active', 'Fragment', 'Unknown']);

function normalizeBundleState(s) {
  if (!s) return 'Unknown';
  const v = String(s);
  return BUNDLE_STATE_ENUM.has(v) ? v : 'Unknown';
}

// The submit-migration-validation-result tool accepts `checks` as a flat map of
// scalar values whose keys contain no dots. verify() may stash nested objects
// (e.g. `properties`) — flatten one level, drop non-scalar values, and replace
// `.` with `_` in keys.
function flattenChecks(checks) {
  if (!checks || typeof checks !== 'object') return undefined;
  const safeKey = (k) => String(k).replace(/\./g, '_');
  const out = {};
  for (const [k, v] of Object.entries(checks)) {
    if (['string', 'number', 'boolean'].includes(typeof v)) out[safeKey(k)] = v;
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        if (['string', 'number', 'boolean'].includes(typeof v2)) out[`${safeKey(k)}_${safeKey(k2)}`] = v2;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function buildMcpPayload(record, args) {
  const classes = record.classes.map(toClassEntry);
  const bundleEntry = record.classes.find((r) => r.bundle);
  const patterns = [...new Set(record.classes.map((r) => r.pattern).filter(Boolean))];

  const payload = {
    run_id: record.run_id,
    project_id: args['project-id'],
    project_name: args['project-name'],
    skill_pattern: args.pattern || patterns.join('+'),
    skill_version: args['skill-version'] || declaredSkillVersion(),
    result: record.result,
    verification_level: record.verification_level,
    started_at: record.started_at,
    finished_at: record.finished_at,
    summary: {
      classes_total: classes.length,
      classes_pass: record.classes.filter((r) => r.result === 'pass').length,
      classes_fail: record.classes.filter((r) => r.result === 'fail').length,
    },
    classes,
  };
  if (bundleEntry) payload.bundle = bundleEntry.bundle;
  if (record.skill_decisions) payload.skill_decisions = record.skill_decisions;
  return stripEmpty(payload);
}

// Builds one `classes[]` entry (submit-migration-validation-result schema) from one task's outcome.
function validationChecks(outcome) {
  const contractFailed = [FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, FAILURE_CLASSES.CONTRACT_MISMATCH].includes(outcome.failure_class);
  return {
    ...outcome.checks,
    ...(outcome.checks?.template_comparison ? {
      template_screenshots: JSON.stringify(outcome.checks.template_comparison.captures.map((capture) => (
        { ...capture, source: path.basename(capture.source), target: path.basename(capture.target) }))),
      template_differences: JSON.stringify(outcome.checks.template_comparison.differences),
      template_cleanup: JSON.stringify(outcome.checks.template_comparison.cleanup),
      template_component_mapping: JSON.stringify(outcome.checks.template_comparison.component_mapping),
    } : {}),
    migration_contract: outcome.result === 'pass' ? 'pass' : contractFailed ? 'fail' : 'not_verified',
    business_behavior: 'not_tested',
  };
}

function toClassEntry(outcome) {
  const className = (outcome.discovered && (outcome.discovered.fqcn || outcome.discovered.template)) || `(${outcome.pattern})`;
  const cls = { class_name: className, result: outcome.result };

  if (outcome.result === 'fail') {
    cls.failure_class = outcome.failure_class || FAILURE_CLASSES.UNKNOWN;
    if (outcome.bundle_state) cls.bundle_state = outcome.bundle_state;
    if (outcome.component_state) cls.component_state = outcome.component_state;
    if (outcome.unsatisfied_references && outcome.unsatisfied_references.length) cls.unsatisfied_references = outcome.unsatisfied_references;
    if (outcome.activation_error) cls.activation_error = outcome.activation_error;
    if (outcome.evidence) cls.evidence = truncate(outcome.evidence, EVIDENCE_MAX);
  } else {
    if (outcome.bundle_state) cls.bundle_state = outcome.bundle_state;
    if (outcome.component_state) cls.component_state = outcome.component_state;
  }
  const checks = flattenChecks(validationChecks(outcome)) || {};
  // restricted = a pass the MCP tool couldn't fully verify (e.g. scheduler DS
  // props). Record it in checks so it isn't lost as a clean pass.
  if (outcome.restricted) {
    checks.restricted = true;
    if (outcome.restricted_reason) checks.restricted_reason = outcome.restricted_reason;
  }
  if (Object.keys(checks).length) cls.checks = checks;
  return stripEmpty(cls);
}

function truncate(s, max) {
  if (typeof s !== 'string' || s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Strip both undefined and null so optional fields are omitted rather than
// sent as null, which the tool's schema rejects.
function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

module.exports = {
  writeLocalReport,
  renderLocalReport,
  finalizeReporting,
  resolveSdkUrl,
  camReportingNote,
  normalizeBundleState,
  flattenChecks,
  buildMcpPayload,
  validationChecks,
  toClassEntry,
  truncate,
  stripEmpty,
};
