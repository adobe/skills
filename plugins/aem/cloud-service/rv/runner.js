'use strict';

const { runStaticGate } = require('./static-gate.js');

/**
 * RV runner — orchestrates verification for one applied pattern and emits the
 * abstracted outcome record (the reward unit for the skill-improvement loop).
 *
 * Flow:  static gate  ->  (deploy happens outside)  ->  pattern invariant  ->  record
 *
 * The record carries NO customer source — only pattern, subtype, verdicts, and
 * a failure class. Safe to pool across projects.
 */
const REGISTRY = {
  scheduler: require('./invariants/scheduler.js'),
  // asset-manager: require('./invariants/asset-manager.js'),   // next
  // event-migration: require('./invariants/event-migration.js'),
};

async function runRv({ pattern, subtype, target, probe, projectDir, staticCommands, skillVersion } = {}) {
  const startedAt = new Date().toISOString();

  // 1. Static gate (no instance needed)
  const staticGate = runStaticGate({ projectDir, pattern, commands: staticCommands });

  // 2. Functional invariant (needs the deployed quickstart via `probe`)
  let invariant = { result: 'skipped', failure_class: null, checks: {} };
  let verificationLevel = 'static-only';
  const mod = REGISTRY[pattern];
  if (mod && probe) {
    invariant = await mod.check({ probe, target });
    verificationLevel = 'runtime';
  } else if (mod && !probe) {
    invariant.result = 'inconclusive';
    invariant.failure_class = 'no_instance';
  } else if (!mod) {
    invariant.result = 'unsupported';
    invariant.failure_class = 'no_invariant_for_pattern';
  }

  // 3. Overall verdict
  const result =
    !staticGate.ok ? 'fail'
    : invariant.result === 'pass' ? 'pass'
    : invariant.result === 'skipped' || invariant.result === 'inconclusive' || invariant.result === 'unsupported' ? 'inconclusive'
    : 'fail';

  return {
    run_id: `rv-${Date.now()}`,
    skill_pattern: pattern,
    subtype: subtype || null,
    skill_version: skillVersion || 'unknown',
    verification_level: verificationLevel,
    result,
    gate_results: {
      ...staticGate.steps,
      invariant: invariant.result,
    },
    invariant_checks: invariant.checks,
    failure_class: result === 'pass' ? null : (invariant.failure_class || (staticGate.ok ? null : 'static_gate')),
    evidence: invariant.evidence || '',   // sanitized; never customer source
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };
}

module.exports = { runRv, REGISTRY };
