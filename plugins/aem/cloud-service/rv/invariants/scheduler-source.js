'use strict';

/**
 * Scheduler SOURCE invariant — the instance-free half of RV.
 *
 * Reads the migrated .java and proves the skill produced Cloud-Service-correct
 * code, straight from code-assessment/scheduler/SKILL.md + path-a.md:
 *   - declared as a Runnable OSGi component
 *   - scheduler.expression present (trigger preserved)
 *   - scheduler.concurrent carries the :Boolean type hint
 *   - scheduler.runOn scoped to SINGLE | LEADER (not implicit ALL)
 *   - migrated off Felix SCR to OSGi DS annotations
 *
 * This runs with zero infrastructure — no build, no instance. The runtime
 * "did it fire" check (scheduler.js) layers on once a quickstart exists.
 */
function checkSchedulerSource(src) {
  const checks = {
    runnable_component:  /service\s*=\s*Runnable\.class/.test(src),
    has_expression:      /scheduler\.expression\s*[=]/.test(src),
    concurrent_boolean:  /scheduler\.concurrent:Boolean\s*=/.test(src),
    runOn_scoped:        /scheduler\.runOn\s*=\s*(SINGLE|LEADER)/.test(src),
    no_felix_scr:        !/org\.apache\.felix\.scr\.annotations/.test(src),
    uses_osgi_ds:        /org\.osgi\.service\.component\.annotations/.test(src),
  };

  const order = [
    ['no_felix_scr',       'still imports Felix SCR annotations — SCR→DS not done'],
    ['uses_osgi_ds',       'no OSGi DS annotations found'],
    ['runnable_component', 'not declared as service = Runnable.class'],
    ['has_expression',     'scheduler.expression missing'],
    ['concurrent_boolean', 'scheduler.concurrent missing the :Boolean type hint'],
    ['runOn_scoped',       'scheduler.runOn not set to SINGLE/LEADER (defaults to ALL — every pod)'],
  ];
  for (const [key, msg] of order) {
    if (!checks[key]) return { result: 'fail', failure_class: `source.${key}`, checks, evidence: msg };
  }
  return { result: 'pass', failure_class: null, checks };
}

module.exports = { checkSchedulerSource };
