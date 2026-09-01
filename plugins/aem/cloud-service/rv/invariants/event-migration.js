'use strict';

/**
 * Event migration RUNTIME invariant — proves the migrated handler stays
 * lightweight by offloading to a Sling Job (code-assessment/event-migration).
 *
 * Oracle (trigger → observe side-effect):
 *   trigger → fire an OSGi event (via a test servlet)
 *   observe → the offloaded JobConsumer executed (unique marker appears)
 *
 * The marker check is injected as `observe(id) -> boolean` so the invariant
 * stays transport-agnostic (the runner reads the instance log / a JCR node).
 *
 * ctx: { probe, observe, target }
 * target: { triggerPath, waitMs }   e.g. /bin/rv/fireevent
 */
module.exports = {
  pattern: 'event-migration',

  async check({ probe, observe, target }) {
    const checks = {};
    const id = 'rv-' + Date.now();

    const resp = await probe.callGet(`${target.triggerPath}?id=${encodeURIComponent(id)}`);
    checks.event_fired = resp.status === 200 && /"fired":true/.test(resp.body);
    if (!checks.event_fired) return fail('runtime.event_not_fired', checks, resp.body);

    // Poll for the offloaded job's marker (job scheduling can take a few seconds).
    const deadline = Date.now() + (target.timeoutMs || 15000);
    let ran = false;
    while (Date.now() < deadline) {
      if (await observe(id)) { ran = true; break; }
      await probe.wait(target.pollMs || 2000);
    }
    checks.offloaded_job_ran = ran;
    if (!ran) return fail('runtime.job_not_executed', checks,
      'event fired but the offloaded Sling Job did not execute within timeout');

    return { result: 'pass', failure_class: null, checks };
  },
};

function fail(failure_class, checks, evidence = '') {
  return { result: 'fail', failure_class, checks, evidence };
}
