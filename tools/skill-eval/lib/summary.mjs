import { compareMetric, judge, METRICS } from './lift.mjs';
import { modelLabels, POOLED } from './report.mjs';

export const HIGH_BASELINE = 90;
export const BROKEN_SHARE = 0.5;
export const BUCKETS = ['skill helps', 'no signal', 'flat, headroom', 'not picked up', 'skill hurts', 'broken'];

const pct = (x) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : '—');
const signed = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}` : '—');

export function bucketOf({ label, cand, ref }) {
  const failedShare = (v) => (v?.attempts ? v.failed / v.attempts : 1);
  if (!cand || !ref || failedShare(cand) >= BROKEN_SHARE || failedShare(ref) >= BROKEN_SHARE || label === 'n/a') return 'broken';
  if (label === 'degraded') return 'skill hurts';
  if (label === 'lift') return 'skill helps';
  if (ref.score.avg >= HIGH_BASELINE) return 'no signal';
  if (cand.activation.count === 0) return 'not picked up';
  return 'flat, headroom';
}

export function bucketRows(plugin, variant) {
  const rows = [];
  for (const sc of plugin.scenarios) {
    const cmp = sc.comparisons.find((c) => c.candidate === variant && c.reference === 'baseline');
    if (!cmp) continue;
    const cell = (cand, ref, label) => ({
      bucket: bucketOf({ label, cand, ref }),
      label,
      baseline: ref?.score?.avg ?? null,
      candidate: cand?.score?.avg ?? null,
      delta: cand?.score?.avg != null && ref?.score?.avg != null ? cand.score.avg - ref.score.avg : null,
      skills: cand?.activation?.skills ?? [],
      used: cand?.activation?.count ?? 0,
      solves: cand?.attempts ?? 0,
      failed: (cand?.failed ?? 0) + (ref?.failed ?? 0),
      attempts: (cand?.attempts ?? 0) + (ref?.attempts ?? 0),
      metrics: cmp.pooled.metrics,
    });
    const row = { scenario: sc.name, pooled: cell(sc.variants[variant], sc.variants.baseline, cmp.pooled.label), models: {} };
    for (const m of plugin.models) {
      const g = sc.models[m];
      row.models[m] = cmp.models[m] ? cell(g?.variants[variant], g?.variants.baseline, cmp.models[m].label) : { bucket: 'broken', label: 'n/a', baseline: null, candidate: null, delta: null, skills: [], used: 0, solves: 0, failed: 0, attempts: 0 };
    }
    rows.push(row);
  }
  return rows;
}

export function countBuckets(rows, model) {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const r of rows) out[(model ? r.models[model] : r.pooled).bucket]++;
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const NOISE_METRICS = METRICS;
const unit = { score: (x) => x.toFixed(1), time: (x) => `${(x / 1000).toFixed(1)}s`, turns: (x) => x.toFixed(1), tokens: (x) => Math.round(x).toLocaleString('en-US'), cost: (x) => `$${x.toFixed(3)}` };

export function noiseStats(plugin, variant) {
  const cells = [];
  const comps = [];
  for (const sc of plugin.scenarios) {
    for (const m of plugin.models) {
      const g = sc.models[m];
      if (!g) continue;
      for (const v of ['baseline', variant]) if (g.variants[v]) cells.push({ scenario: sc.name, model: m, variant: v, s: g.variants[v] });
      if (g.variants.baseline && g.variants[variant]) comps.push({ scenario: sc.name, model: m, cand: g.variants[variant], ref: g.variants.baseline });
    }
  }
  const metrics = NOISE_METRICS.map((metric) => {
    const sds = cells.map((c) => metric.get(c.s)).filter((x) => x?.n >= 2).map((x) => x.sd).sort((a, b) => a - b);
    const usable = comps.filter((c) => metric.get(c.cand)?.n >= 2 && metric.get(c.ref)?.n >= 2);
    const floored = usable.filter((c) => Math.sqrt(metric.get(c.cand).sd ** 2 + metric.get(c.ref).sd ** 2) < (metric.floor ?? 0));
    return {
      key: metric.key,
      cells: sds.length,
      zeroSd: sds.filter((x) => x < 1e-9).length,
      median: percentile(sds, 0.5),
      p90: percentile(sds, 0.9),
      max: sds.length ? sds.at(-1) : null,
      comparisons: usable.length,
      floorBinds: floored.length,
      floor: metric.floor ?? 0,
    };
  });
  let changed = 0;
  let labelled = 0;
  const changes = [];
  for (const c of comps) {
    const eff = (floor) => Object.fromEntries(METRICS.map((m) => [m.key, compareMetric(m.get(c.cand), m.get(c.ref), m.better, floor ? m.floor : 0).effect]));
    const withFloor = judge('baseline', eff(true));
    const without = judge('baseline', eff(false));
    labelled++;
    if (withFloor !== without) {
      changed++;
      changes.push(`${c.scenario} / ${c.model}: ${without} → ${withFloor}`);
    }
  }
  return { metrics, labelsChangedByFloor: changed, labelled, changes };
}

export function failureTable(attempts) {
  const rows = new Map();
  for (const a of attempts) {
    const key = `${a.model ?? 'unknown'}\t${a.variant}`;
    if (!rows.has(key)) rows.set(key, { model: a.model ?? 'unknown', variant: a.variant, total: 0, ok: 0, timeout: 0, error: 0, retried: 0 });
    const r = rows.get(key);
    r.total++;
    if (a.status === 'ok') r.ok++;
    else if (a.status === 'timeout') r.timeout++;
    else r.error++;
  }
  return [...rows.values()];
}

export function renderSummary({ meta, variants, plugin, variant, attempts, reportPath }) {
  const labels = modelLabels(plugin.models);
  const rows = bucketRows(plugin, variant);
  const out = [];
  const table = (header, body) => {
    out.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`), '');
  };
  out.push(`# Phase 1 baseline: ${meta.label ?? meta.runId}`, '');
  out.push(`- Run: \`${meta.runId}\`; full report: \`${reportPath}\``);
  out.push(`- Variants: baseline vs \`${variant}\`; workers ${plugin.models.map((m) => `\`${m}\``).join(', ')}; n=${meta.runs} per model and variant; judge \`${meta.scorerModel}\``);
  for (const c of meta.contexts ?? []) out.push(`- Context \`${c.variant}\`: \`${c.dir}\`${c.commit ? ` @ \`${c.commit.slice(0, 12)}\`` : ''}${c.dirty ? ' + uncommitted changes' : ''}`);
  out.push('', '## Bucket rule', '', '- **broken**: ≥ 50% of attempts failed (error or timeout) on either side, or a side has < 2 solves.',
    '- **skill hurts**: label degraded (score down beyond noise).', '- **skill helps**: label lift (score up beyond noise, or score flat with time and turns both down beyond noise).',
    `- **no signal**: flat and baseline avg ≥ ${HIGH_BASELINE}.`, '- **not picked up**: flat, baseline < 90, and no skill used in any with-plugin solve.',
    '- **flat, headroom**: flat, baseline < 90, skills used but no lift.', '- Noise band = max(√(SD₁² + SD₂²), floor); floors 5 score points, 10 s, 1 turn. Pooled needs the same sign on ≥ 2 of 3 models.', '');

  out.push('## Bucket counts', '');
  table(['Bucket', ...plugin.models.map((m) => labels[m]), POOLED], BUCKETS.map((b) => [b, ...plugin.models.map((m) => countBuckets(rows, m)[b]), countBuckets(rows)[b]]));

  out.push('## Scenarios', '', 'Bucket per scenario; score is baseline → with-plugin (avg of solves), then Δ. Per model: bucket, Δ.', '');
  table(['Scenario', 'Pooled bucket', 'Baseline', variant, 'Δ', 'Skills used (solves)', ...plugin.models.map((m) => labels[m])],
    rows.map((r) => [r.scenario, `**${r.pooled.bucket}**`, pct(r.pooled.baseline), pct(r.pooled.candidate), signed(r.pooled.delta), r.pooled.skills.length ? `${r.pooled.skills.join(', ')} (${r.pooled.used}/${r.pooled.solves})` : `none (0/${r.pooled.solves})`,
      ...plugin.models.map((m) => `${r.models[m].bucket} (${signed(r.models[m].delta)})`)]));

  out.push('## Per-model scores', '');
  table(['Scenario', ...plugin.models.flatMap((m) => [`${labels[m]} base`, `${labels[m]} +plugin`])],
    rows.map((r) => [r.scenario, ...plugin.models.flatMap((m) => [pct(r.models[m].baseline), pct(r.models[m].candidate)])]));

  const noise = noiseStats(plugin, variant);
  out.push('## Observed noise', '', 'SD between the repeats of one scenario × model × variant (cells with ≥ 2 solves).', '');
  table(['Metric', 'Cells', 'SD = 0', 'Median SD', 'p90 SD', 'Max SD', 'Floor', 'Floor binds (per-model comparisons)'],
    noise.metrics.map((m) => [m.key, m.cells, `${m.zeroSd} (${m.cells ? Math.round((100 * m.zeroSd) / m.cells) : 0}%)`, m.median == null ? '—' : unit[m.key](m.median), m.p90 == null ? '—' : unit[m.key](m.p90), m.max == null ? '—' : unit[m.key](m.max), m.floor ? unit[m.key](m.floor) : '—', m.floor ? `${m.floorBinds}/${m.comparisons}` : '—']));
  out.push(`Per-model labels changed by the floors: ${noise.labelsChangedByFloor} of ${noise.labelled}.`);
  for (const c of noise.changes) out.push(`- ${c}`);
  out.push('');

  out.push('## Failures', '');
  table(['Model', 'Variant', 'Attempts', 'ok', 'timeout', 'error'], failureTable(attempts).sort((a, b) => a.model.localeCompare(b.model) || a.variant.localeCompare(b.variant)).map((r) => [labels[r.model] ?? r.model, r.variant, r.total, r.ok, r.timeout, r.error]));
  const errs = attempts.filter((a) => a.status !== 'ok');
  if (errs.length) {
    out.push('Failed attempts:', '');
    for (const a of errs) out.push(`- ${a.scenario} / ${labels[a.model] ?? a.model} / ${a.variant} #${a.run}: ${a.status}${a.error ? ` (${a.error})` : ''}`);
    out.push('');
  }
  return out.join('\n');
}
