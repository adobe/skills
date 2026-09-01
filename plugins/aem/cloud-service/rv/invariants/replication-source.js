'use strict';

/**
 * Replication SOURCE invariant — from code-assessment/replication/SKILL.md.
 * The CQ Replicator + Sling Replication Agent APIs are removed on AEM CS;
 * migrated code must use the Sling Distribution API.
 *   - no com.day.cq.replication.* / org.apache.sling.replication.agent.*
 *   - uses Distributor + SimpleDistributionRequest
 */
function checkReplicationSource(src) {
  const legacy = /com\.day\.cq\.replication|org\.apache\.sling\.replication\.agent/.test(src);
  const usesDistribution = /\bDistributor\b/.test(src) && /SimpleDistributionRequest/.test(src);
  const checks = { no_legacy_replicator: !legacy, uses_distribution_api: usesDistribution };

  if (legacy) return { result: 'fail', failure_class: 'source.legacy_replicator', checks,
    evidence: 'uses CQ Replicator / Sling Replication Agent — removed on AEMaaCS' };
  if (!usesDistribution) return { result: 'fail', failure_class: 'source.no_distribution_api', checks,
    evidence: 'no Distributor + SimpleDistributionRequest' };
  return { result: 'pass', failure_class: null, checks };
}

module.exports = { checkReplicationSource };
