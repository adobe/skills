'use strict';

/**
 * Demo: RV on the WKND legacy scheduler `SimpleScheduledTask`.
 *
 * Source (aem-guides-wknd-legacy):
 *   @Service(Runnable.class), a "every 30s" cron expression,
 *   scheduler.concurrent (no :Boolean hint), NO scheduler.runOn  -> fires on ALL pods.
 *
 * We run the same RV invariant against three simulated quickstart states to show
 * it catches the real failure modes and only passes a correct CS migration.
 */
const { runRv } = require('./runner.js');
const { MockProbe } = require('./mock-probe.js');

const PID = 'com.adobe.aem.guides.core.schedulers.SimpleScheduledTask';
const MARKER = '/var/rv/scheduler/SimpleScheduledTask';

const target = { componentPid: PID, markerPath: MARKER, markerProp: 'lastRun', intervalMs: 1000 };

// A) Legacy, not migrated: Felix SCR component never registers on CS SDK.
const legacy = new MockProbe({ components: {} });

// B) Bad migration: registers, but concurrent is a String and runOn is unset (ALL).
const badMigration = new MockProbe({
  components: { [PID]: { active: true, properties: {
    'scheduler.expression': '0 0/30 * * * ?',
    'scheduler.concurrent': 'false',   // <-- String, missing :Boolean hint
    // scheduler.runOn missing -> ALL
  } } },
  markers: { [MARKER]: { lastRun: 1000 } },
  firing: { [MARKER]: 'lastRun' },
});

// C) Correct CS migration: Boolean hint, runOn=LEADER, and it fires.
const good = new MockProbe({
  components: { [PID]: { active: true, properties: {
    'scheduler.expression': '0 0/30 * * * ?',
    'scheduler.concurrent': false,     // Boolean
    'scheduler.runOn': 'LEADER',
  } } },
  markers: { [MARKER]: { lastRun: 1000 } },
  firing: { [MARKER]: 'lastRun' },
});

(async () => {
  const cases = [['A: legacy (unmigrated)', legacy], ['B: bad migration', badMigration], ['C: correct CS migration', good]];
  for (const [name, probe] of cases) {
    const record = await runRv({
      pattern: 'scheduler', subtype: 'sling.commons.scheduler',
      target, probe, skillVersion: 'scheduler@1.0',
    });
    console.log(`\n=== ${name} ===`);
    console.log(`result: ${record.result}   failure_class: ${record.failure_class || '—'}`);
    console.log('checks:', JSON.stringify(record.invariant_checks));
    if (record.evidence) console.log('evidence:', record.evidence);
  }
})();
