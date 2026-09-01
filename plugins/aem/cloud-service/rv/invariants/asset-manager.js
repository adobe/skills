'use strict';

/**
 * Asset Manager RUNTIME invariant — proves the migrated delete (Path B,
 * resolver.delete() + commit()) actually works on a live Cloud SDK.
 *
 * This is the "trigger → observe repository change" oracle: unlike the
 * self-firing scheduler, asset ops only run when invoked, so RV pokes the
 * migrated code (via a test servlet) and asserts the node is gone.
 *
 *   setup   → create a test node
 *   before  → node exists (200)
 *   trigger → GET the migrated delete servlet
 *   after   → node gone (404)
 *
 * ctx: { probe, target }
 * target: { testPath, triggerPath }   e.g. /content/rv-test/probe, /bin/rv/deleteasset
 */
module.exports = {
  pattern: 'asset-manager',

  async check({ probe, target }) {
    const checks = {};
    const { testPath, triggerPath } = target;

    // setup + precondition
    await probe.createNode(testPath);
    checks.exists_before = await probe.exists(testPath);
    if (!checks.exists_before) return fail('setup.node_not_created', checks);

    // trigger the migrated delete
    const resp = await probe.callGet(`${triggerPath}?path=${encodeURIComponent(testPath)}`);
    checks.delete_invoked = resp.status === 200 && /"deleted":true/.test(resp.body);
    if (!checks.delete_invoked) return fail('runtime.delete_failed', checks, resp.body);

    // observable signal: the node is gone
    checks.gone_after = !(await probe.exists(testPath));
    if (!checks.gone_after) return fail('runtime.node_not_deleted', checks,
      'resolver.delete()+commit() did not remove the node');

    return { result: 'pass', failure_class: null, checks };
  },
};

function fail(failure_class, checks, evidence = '') {
  return { result: 'fail', failure_class, checks, evidence };
}
