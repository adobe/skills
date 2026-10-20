import { cell, loadSkills, models, stats } from './results.mjs';

/**
 * promptfoo "provider" that makes no model call: it replays stored results for one model, so
 * promptfoo's own viewer and HTML export can render the benchmark as a models x skills matrix.
 * Test vars: skill, case ('*' = every case of the skill).
 */
export default class ReplayProvider {
  constructor(options) {
    this.label = options.config.model_label;
    this.skills = new Map(loadSkills().map((s) => [s.skill, s]));
  }

  id() {
    return `replay:${this.label}`;
  }

  async callApi(_prompt, context) {
    const { skill, case: caseName } = context.vars;
    const { floor, rows } = this.skills.get(skill);
    const runs = rows.filter((r) => r.model === this.label && (caseName === '*' || r.case === caseName));
    const s = stats(runs, floor);
    if (!s.n) return { output: 'not run', metadata: { ran: false } };
    const output = `${cell(s)}\n${s.avg.toFixed(0)} s avg, ${s.p95.toFixed(0)} s p95${s.timeouts ? `, ${s.timeouts} timeout${s.timeouts > 1 ? 's' : ''}` : ''}, $${s.cost.toFixed(3)}/run`;
    return { output, metadata: { ran: true, meets: s.meets, rate: s.good / s.n, floor: floor.min_pass_rate, models: models.length } };
  }
}
