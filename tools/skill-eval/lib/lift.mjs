import { BASELINE } from './contexts.mjs';

export const METRICS = [
  { key: 'score', better: 'up', floor: 5, get: (v) => v.score },
  { key: 'time', better: 'down', floor: 10_000, get: (v) => v.duration },
  { key: 'turns', better: 'down', floor: 1, get: (v) => v.turns },
  { key: 'tokens', better: 'down', get: (v) => v.tokens.total },
  { key: 'cost', better: 'down', get: (v) => v.cost },
];

export const LABELS = ['lift', 'flat', 'degraded', 'mixed', 'n/a'];

export function comparisonPairs(variants) {
  const contexts = variants.filter((v) => v !== BASELINE);
  const out = [];
  if (variants.includes(BASELINE)) for (const c of contexts) out.push({ candidate: c, reference: BASELINE, rule: 'baseline' });
  for (const c of contexts.slice(1)) out.push({ candidate: c, reference: contexts[0], rule: 'version' });
  return out;
}

export function compareMetric(cand, ref, better, floor = 0) {
  const delta = cand?.avg != null && ref?.avg != null ? cand.avg - ref.avg : null;
  if (delta == null || cand.n < 2 || ref.n < 2) return { delta, band: null, effect: 'n/a' };
  const band = Math.max(Math.sqrt(cand.sd ** 2 + ref.sd ** 2), floor);
  if (!(Math.abs(delta) > band)) return { delta, band, effect: null };
  return { delta, band, effect: delta > 0 === (better === 'up') ? 'better' : 'worse' };
}

export function judge(rule, effects) {
  if (effects.score === 'n/a') return 'n/a';
  if (rule === 'baseline') {
    if (effects.score === 'worse') return 'degraded';
    if (effects.score === 'better') return 'lift';
    return effects.time === 'better' && effects.turns === 'better' ? 'lift' : 'flat';
  }
  const all = METRICS.map((m) => effects[m.key]);
  const better = all.includes('better');
  const worse = all.includes('worse');
  if (better && worse) return 'mixed';
  if (worse) return 'degraded';
  return better ? 'lift' : 'flat';
}

const effectsOf = (metrics) => Object.fromEntries(METRICS.map((m) => [m.key, metrics[m.key].effect]));

function compareAll(cand, ref) {
  return Object.fromEntries(METRICS.map((m) => [m.key, compareMetric(m.get(cand), m.get(ref), m.better, m.floor)]));
}

export function compareVariants({ rule, pooled, models }) {
  const perModel = Object.create(null);
  for (const [m, { cand, ref }] of Object.entries(models)) {
    const metrics = compareAll(cand, ref);
    perModel[m] = { label: judge(rule, effectsOf(metrics)), metrics };
  }
  const n = Object.keys(perModel).length;
  const need = Math.ceil((2 * n) / 3);
  const metrics = compareAll(pooled.cand, pooled.ref);
  for (const m of METRICS) {
    const c = metrics[m.key];
    const sign = Math.sign(c.delta ?? 0);
    const agree = sign ? Object.values(perModel).filter((r) => Math.sign(r.metrics[m.key].delta ?? 0) === sign).length : 0;
    const counts = c.effect === 'better' || c.effect === 'worse';
    metrics[m.key] = { ...c, effect: counts && agree < need ? null : c.effect, agree, models: n };
  }
  return { pooled: { label: judge(rule, effectsOf(metrics)), metrics }, models: perModel };
}

export function countLabels(labels) {
  const out = Object.fromEntries(LABELS.map((l) => [l, 0]));
  for (const l of labels) out[l]++;
  return out;
}
