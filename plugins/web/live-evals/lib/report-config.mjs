import { join } from 'node:path';
import { loadSkills, models, root } from './results.mjs';

// REPORT_LEVEL=skill: one row per skill (the gist). REPORT_LEVEL=case: one row per case.
const level = process.env.REPORT_LEVEL === 'case' ? 'case' : 'skill';
const skills = loadSkills();

const tests = skills.flatMap((sk) =>
  level === 'skill'
    ? [{ description: sk.skill, vars: { skill: sk.skill, case: '*' }, metadata: { skill: sk.skill } }]
    : [...new Set(sk.rows.map((r) => r.case))].map((c) => ({ description: `${sk.skill}: ${c}`, vars: { skill: sk.skill, case: c }, metadata: { skill: sk.skill } })));

export default {
  description: level === 'skill'
    ? 'Skill evals: does each model meet the skill floor? (cells are pass within the time budget)'
    : 'Skill evals, per case',
  prompts: [{ raw: '{{skill}} {{case}}', label: 'share of runs within the skill floor' }],
  providers: models.map((m) => ({
    id: `file://${join(root, 'lib/replay-provider.mjs')}`,
    label: `${m.label}${m.baseline ? ' (baseline)' : ''}`,
    config: { model_label: m.label },
  })),
  defaultTest: { assert: [{ type: 'javascript', value: `file://${join(root, 'lib/replay-assert.mjs')}:meetsFloor` }] },
  tests,
};
