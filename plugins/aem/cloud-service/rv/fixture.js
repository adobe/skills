'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Turn a failed RV outcome into a permanent regression eval, using the repo's
 * existing convention (evals/<name>/{task.md,criteria.json}). Every real-world
 * failure becomes a test the skill must pass forever after — this is the
 * "policy update" half of the improvement loop.
 *
 * Abstracted only: pattern, subtype, failure_class, sanitized evidence. No
 * customer source is written into the fixture.
 */
function generateFixture(outcome, { evalsDir }) {
  const name = `${outcome.skill_pattern}-${(outcome.failure_class || 'failure').replace(/[^a-z0-9]+/gi, '-')}`;
  const dir = path.join(evalsDir, name);
  fs.mkdirSync(dir, { recursive: true });

  const task = `# RV regression — ${outcome.skill_pattern} / ${outcome.failure_class}

Captured from a failed Render-Validate run (${outcome.run_id}).

## Scenario
A \`${outcome.skill_pattern}\` migration (subtype \`${outcome.subtype || 'n/a'}\`) was applied and
failed verification with failure class \`${outcome.failure_class}\`.

Evidence (sanitized): ${outcome.evidence || 'n/a'}

## Expectation
After the skill migrates this pattern, RV must pass:
${Object.keys(outcome.invariant_checks || {}).map(c => `- \`${c}\` must hold`).join('\n') || '- all scheduler contract checks must hold'}
`;

  const criteria = {
    context: `RV regression for ${outcome.skill_pattern}; failure class ${outcome.failure_class}. Must pass after migration.`,
    type: 'rv_invariant',
    pattern: outcome.skill_pattern,
    subtype: outcome.subtype || null,
    must_pass_checks: Object.keys(outcome.invariant_checks || {}),
    origin_run: outcome.run_id,
  };

  fs.writeFileSync(path.join(dir, 'task.md'), task, 'utf8');
  fs.writeFileSync(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2), 'utf8');
  return dir;
}

module.exports = { generateFixture };
