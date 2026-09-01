'use strict';

const { execFileSync } = require('child_process');

/**
 * Static gate — the pattern-agnostic checks that need no running instance:
 *   compile vs AEMaaCS SDK · AEM Analyser · detector re-run -> 0 findings.
 *
 * Each step is optional and configurable; a step with no command configured is
 * reported as 'skipped' (so the harness still runs where Maven/JDK is absent —
 * it just records a lower verification level). Returns { ok, steps }.
 */
function runStaticGate({ projectDir, pattern, commands = {} } = {}) {
  const steps = {};
  const run = (name, cmd) => {
    if (!cmd) { steps[name] = 'skipped'; return; }
    try {
      execFileSync(cmd[0], cmd.slice(1), { cwd: projectDir, stdio: 'pipe' });
      steps[name] = 'pass';
    } catch (e) {
      steps[name] = 'fail';
    }
  };

  run('compile', commands.compile);        // e.g. ['mvn','-q','clean','install','-P','aemaacs']
  run('analyser', commands.analyser);       // e.g. ['mvn','-q','aemanalyser:analyse']
  run('detector_zero', commands.detector);  // re-run analyzer, expect 0 findings for `pattern`

  const ok = Object.values(steps).every(s => s === 'pass' || s === 'skipped');
  return { ok, steps };
}

module.exports = { runStaticGate };
