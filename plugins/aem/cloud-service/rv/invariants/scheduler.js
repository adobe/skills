'use strict';

/**
 * Scheduler invariant — proves a migrated Sling scheduler is Cloud-Service
 * correct AND actually fires.
 *
 * Ties directly to code-assessment/scheduler/SKILL.md:
 *   - scheduler.expression present (valid trigger)
 *   - scheduler.concurrent declared as Boolean (type hint, not String)
 *   - scheduler.runOn = SINGLE | LEADER for anything that writes/calls out
 *     (default ALL fires on every publish pod — the classic CS bug)
 *   - component actually registered + active (not stuck on a legacy SCR import)
 *   - fires on schedule (observable marker advances)
 *
 * ctx: { probe, target }
 * target: { componentPid, markerPath, markerProp, intervalMs }
 */
module.exports = {
  pattern: 'scheduler',

  async check({ probe, target }) {
    const checks = {};
    const { componentPid, markerPath, markerProp = 'lastRun', intervalMs = 120000 } = target;

    // 1. Registered + active?
    const cmp = await probe.osgiComponent(componentPid);
    checks.component_active = cmp.active;
    if (!cmp.found) return fail('component.not_found', checks, `${componentPid} not registered — legacy SCR not migrated?`);
    if (!cmp.active) return fail('component.inactive', checks, `state=${cmp.state}`);

    // 2. Cloud-Service scheduler contract (the SKILL.md rules)
    const p = cmp.properties || {};
    checks.has_expression = !!p['scheduler.expression'];
    checks.concurrent_is_boolean = typeof p['scheduler.concurrent'] === 'boolean';
    checks.runOn_scoped = p['scheduler.runOn'] === 'SINGLE' || p['scheduler.runOn'] === 'LEADER';

    if (!checks.has_expression) return fail('config.missing_expression', checks);
    if (!checks.concurrent_is_boolean) return fail('config.concurrent_not_boolean', checks,
      'scheduler.concurrent must carry the :Boolean type hint');
    if (!checks.runOn_scoped) return fail('config.runOn_all', checks,
      'scheduler.runOn defaults to ALL — fires on every pod; set SINGLE or LEADER');

    // 3. Does it actually fire? (observable-signal probe)
    if (markerPath) {
      const t0 = await probe.jcrProp(markerPath, markerProp);
      await probe.wait(intervalMs * 2);
      const t1 = await probe.jcrProp(markerPath, markerProp);
      checks.fired = t1 != null && t0 != null && t1 > t0;
      if (!checks.fired) return fail('runtime.not_triggered', checks,
        `marker ${markerPath}.${markerProp} did not advance (${t0} -> ${t1})`);
    } else {
      checks.fired = 'skipped_no_marker';
    }

    return { result: 'pass', failure_class: null, checks };
  },
};

function fail(failure_class, checks, evidence = '') {
  return { result: 'fail', failure_class, checks, evidence };
}
