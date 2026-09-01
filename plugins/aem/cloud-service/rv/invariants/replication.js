'use strict';

/**
 * Replication RUNTIME invariant — proves the migrated Sling Distribution code
 * runs on the CS runtime (vs. the removed CQ Replicator).
 *
 * Oracle (trigger → observe):
 *   trigger → invoke the migrated Distributor via a test servlet
 *   observe → the Distributor service is present and the call executes with no
 *             removed-API error; the distribution subsystem returns a response
 *
 * Note on scope: actual *delivery* to a publish tier needs a publish instance /
 * configured agent, which a single-instance SDK does not have. RV verifies the
 * migrated code is valid and runnable on CS; `delivered` is reported separately
 * and is expected to be false on an author-only SDK.
 *
 * ctx: { probe, target }  target: { testPath, triggerPath, agent }
 */
module.exports = {
  pattern: 'replication',

  async check({ probe, target }) {
    const checks = {};
    await probe.createNode(target.testPath);
    const agent = target.agent ? `&agent=${target.agent}` : '';
    const resp = await probe.callGet(`${target.triggerPath}?path=${encodeURIComponent(target.testPath)}${agent}`);
    let body = {};
    try { body = JSON.parse(resp.body); } catch {}

    checks.api_present = body.servicePresent === true;   // Distributor OSGi service exists on CS
    checks.migrated_code_runs = body.invoked === true;    // migrated call executed, no removed-API error
    checks.delivered = body.success === true;             // needs a publish tier — informational

    if (!checks.api_present) return fail('runtime.distributor_absent', checks, 'Distributor service not present');
    if (!checks.migrated_code_runs) return fail('runtime.invoke_failed', checks, body.error || 'distribute() threw');

    // migrated code verified on CS; delivery may be pending on a single-instance SDK
    return {
      result: 'pass', failure_class: null, checks,
      note: checks.delivered ? 'distributed' : 'API verified on CS; delivery needs a publish tier',
    };
  },
};

function fail(failure_class, checks, evidence = '') {
  return { result: 'fail', failure_class, checks, evidence };
}
