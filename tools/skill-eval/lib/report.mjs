import { comparisonPairs, compareVariants, countLabels, LABELS, METRICS } from './lift.mjs';

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function sd(xs) {
  if (xs.length < 2) return xs.length ? 0 : null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function stats(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return { n: 0, avg: null, min: null, max: null, sd: null };
  return { n: v.length, avg: mean(v), min: Math.min(...v), max: Math.max(...v), sd: sd(v) };
}

export function diff(a, b) {
  const d = (k) => (a?.[k] == null || b?.[k] == null ? null : a[k] - b[k]);
  return { avg: d('avg'), min: d('min'), max: d('max') };
}

export function isScored(a) {
  return a.status === 'ok' && Boolean(a.score);
}

export function failedAttempts(results) {
  return results.filter((r) => r.status !== 'ok');
}

function groupBy(xs, key) {
  const m = new Map();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function solveOf(a) {
  return {
    run: a.run,
    status: a.status,
    score: isScored(a) ? a.score.pct : null,
    skillsUsed: a.activatedSkills ?? [],
    durationMs: a.durationMs ?? null,
    turns: a.turns ?? null,
    tokens: {
      input: a.tokens ? (a.tokens.input ?? 0) + (a.tokens.cacheRead ?? 0) + (a.tokens.cacheWrite ?? 0) : null,
      output: a.tokens?.output ?? null,
      cacheRead: a.tokens?.cacheRead ?? null,
      total: a.tokens?.total ?? null,
    },
    cost: a.cost ?? null,
    judgeCost: a.score?.judgeCost ?? null,
    error: a.error ?? null,
  };
}

function summarizeVariant(attempts) {
  const solves = attempts.map(solveOf).sort((a, b) => a.run - b.run);
  const scored = attempts.filter(isScored);
  const checks = new Map();
  for (const a of scored) {
    for (const c of a.score.checks) {
      if (!checks.has(c.name)) checks.set(c.name, { name: c.name, max: c.max, scores: [] });
      checks.get(c.name).scores.push(c.score);
    }
  }
  const activated = solves.filter((s) => s.skillsUsed.length);
  const ran = solves.filter((s) => s.turns);
  return {
    attempts: attempts.length,
    scored: scored.length,
    failed: attempts.filter((a) => a.status !== 'ok').length,
    score: stats(scored.map((a) => a.score.pct)),
    duration: stats(ran.map((s) => s.durationMs)),
    turns: stats(ran.map((s) => s.turns)),
    tokens: {
      total: stats(ran.map((s) => s.tokens.total)),
      input: stats(ran.map((s) => s.tokens.input)),
      output: stats(ran.map((s) => s.tokens.output)),
    },
    cost: stats(ran.map((s) => s.cost)),
    judgeCost: stats(solves.map((s) => s.judgeCost)),
    checks: [...checks.values()].map((c) => ({ name: c.name, max: c.max, avg: mean(c.scores) })),
    activation: {
      count: activated.length,
      skills: [...new Set(activated.flatMap((s) => s.skillsUsed))].sort(),
    },
    solves,
  };
}

function pluginSummary(scenarios, name) {
  const present = scenarios.filter((s) => s.variants[name]);
  if (!present.length) return null;
  const vs = present.map((s) => s.variants[name]);
  const solves = vs.flatMap((v) => v.solves).filter((s) => s.turns);
  const summary = {
    scenarioScore: stats(vs.map((v) => v.score.avg)),
    attempts: vs.reduce((a, v) => a + v.attempts, 0),
    failed: vs.reduce((a, v) => a + v.failed, 0),
    activation: vs.reduce((a, v) => a + v.activation.count, 0),
    duration: stats(solves.map((s) => s.durationMs)),
    turns: stats(solves.map((s) => s.turns)),
    tokens: stats(solves.map((s) => s.tokens.total)),
    cost: stats(solves.map((s) => s.cost)),
    totalCost: solves.reduce((a, s) => a + (s.cost ?? 0), 0),
    totalJudgeCost: vs.flatMap((v) => v.solves).reduce((a, s) => a + (s.judgeCost ?? 0), 0),
  };
  if (name !== 'baseline') {
    const deltas = present.map((s) => s.differential?.[name]?.avg).filter((x) => x != null);
    summary.differential = { avg: mean(deltas), worstScenario: deltas.length ? Math.min(...deltas) : null, bestScenario: deltas.length ? Math.max(...deltas) : null };
  }
  return summary;
}

export const POOLED = 'pooled';
export const modelOf = (a) => a.model ?? 'unknown';
const shortName = (m) => m.slice(m.lastIndexOf('/') + 1);

export function modelLabels(models) {
  const counts = new Map();
  for (const m of models) counts.set(shortName(m), (counts.get(shortName(m)) ?? 0) + 1);
  return Object.fromEntries(models.map((m) => [m, counts.get(shortName(m)) > 1 ? m : shortName(m)]));
}

function aggregateScenarios(attempts, variants) {
  const scenarios = [];
  for (const [scenario, sAttempts] of groupBy(attempts, (a) => a.scenario)) {
    const byVariant = groupBy(sAttempts, (a) => a.variant);
    const v = Object.create(null);
    for (const name of variants) if (byVariant.has(name)) v[name] = summarizeVariant(byVariant.get(name));
    const differential = Object.create(null);
    if (v.baseline) {
      for (const name of variants) if (name !== 'baseline' && v[name]) differential[name] = diff(v[name].score, v.baseline.score);
    }
    scenarios.push({ name: scenario, variants: v, differential });
  }
  return scenarios;
}

function summarize(scenarios, variants) {
  const summary = Object.create(null);
  for (const name of variants) {
    const s = pluginSummary(scenarios, name);
    if (s) summary[name] = s;
  }
  return summary;
}

function compareScenario(sc, models, variants) {
  return comparisonPairs(variants)
    .filter((p) => sc.variants[p.candidate] && sc.variants[p.reference])
    .map((p) => {
      const perModel = Object.create(null);
      for (const m of models) {
        const g = sc.models[m];
        if (g?.variants[p.candidate] && g.variants[p.reference]) perModel[m] = { cand: g.variants[p.candidate], ref: g.variants[p.reference] };
      }
      return { ...p, ...compareVariants({ rule: p.rule, pooled: { cand: sc.variants[p.candidate], ref: sc.variants[p.reference] }, models: perModel }) };
    });
}

function countResults(scenarios, models, variants) {
  return comparisonPairs(variants).flatMap((p) => {
    const found = scenarios.flatMap((sc) => sc.comparisons.filter((c) => c.candidate === p.candidate && c.reference === p.reference));
    if (!found.length) return [];
    const byModel = Object.create(null);
    for (const m of models) {
      const labels = found.flatMap((c) => (c.models[m] ? [c.models[m].label] : []));
      if (labels.length) byModel[m] = countLabels(labels);
    }
    return [{ ...p, pooled: countLabels(found.map((c) => c.pooled.label)), models: byModel }];
  });
}

export function aggregate(attempts, variants) {
  const plugins = [];
  for (const [plugin, pAttempts] of groupBy(attempts, (a) => a.plugin)) {
    const byModel = groupBy(pAttempts, modelOf);
    const models = [...byModel.keys()].sort();
    const perModel = Object.fromEntries(models.map((m) => [m, aggregateScenarios(byModel.get(m), variants)]));
    const scenarios = aggregateScenarios(pAttempts, variants).map((sc) => {
      const withModels = {
        ...sc,
        models: Object.fromEntries(models.flatMap((m) => {
          const found = perModel[m].find((x) => x.name === sc.name);
          return found ? [[m, { variants: found.variants, differential: found.differential }]] : [];
        })),
      };
      return { ...withModels, comparisons: compareScenario(withModels, models, variants) };
    });
    const summaryByModel = Object.fromEntries(models.map((m) => [m, summarize(perModel[m], variants)]));
    plugins.push({ plugin, models, scenarios, summary: summarize(scenarios, variants), summaryByModel, results: countResults(scenarios, models, variants) });
  }
  return plugins;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pct = (x) => (isNum(x) ? `${x.toFixed(1)}%` : '—');
const num = (x, d = 1) => (isNum(x) ? x.toFixed(d) : '—');
const int = (x) => (isNum(x) ? Math.round(x).toLocaleString('en-US') : '—');
const secs = (ms) => (isNum(ms) ? `${(ms / 1000).toFixed(0)}s` : '—');
const usd = (x) => (isNum(x) ? `$${x.toFixed(3)}` : '—');
const signed = (x) => (isNum(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}` : '—');
const sign = (x) => (x < 0 ? '-' : '+');
const DELTA_FORMAT = {
  score: [(x) => `${sign(x)}${Math.abs(x).toFixed(1)}`, (b) => b.toFixed(1)],
  time: [(x) => `${sign(x)}${Math.abs(x / 1000).toFixed(0)}s`, (b) => `${(b / 1000).toFixed(0)}s`],
  turns: [(x) => `${sign(x)}${Math.abs(x).toFixed(1)}`, (b) => b.toFixed(1)],
  tokens: [(x) => `${sign(x)}${int(Math.abs(x))}`, (b) => int(b)],
  cost: [(x) => `${sign(x)}$${Math.abs(x).toFixed(3)}`, (b) => `$${b.toFixed(3)}`],
};

function deltaCell(key, c, withAgreement) {
  if (!isNum(c?.delta)) return '—';
  const [fmt, fmtBand] = DELTA_FORMAT[key];
  const d = c.effect === 'better' || c.effect === 'worse' ? `**${fmt(c.delta)}**` : fmt(c.delta);
  const band = isNum(c.band) ? ` ±${fmtBand(c.band)}` : '';
  return `${d}${band}${withAgreement ? ` (${c.agree}/${c.models})` : ''}`;
}
const range = (s, fmt) => (s?.n ? (s.n > 1 ? `${fmt(s.avg)} (${fmt(s.min)}–${fmt(s.max)})` : fmt(s.avg)) : '—');
const cell = (s) => String(s).replace(/\|/g, '\\|');

function table(out, header, rows) {
  out.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${r.map(cell).join(' | ')} |`);
  out.push('');
}

export function renderMarkdown({ meta, plugins, variants }) {
  const out = [];
  const workers = meta.models ?? (meta.model ? [meta.model] : []);
  out.push(`# Skill eval: ${meta.label ?? meta.runId}`, '');
  out.push(`- Workers: ${workers.map((m) => `\`${m}\``).join(', ') || '—'}${meta.thinking ? ` (thinking ${meta.thinking})` : ''}`);
  out.push(`- Judge: \`${meta.scorerModel ?? 'skipped'}\``);
  out.push(`- Repeats: ${meta.runs}, forced activation: ${meta.forceActivation ? 'yes' : 'no'}`);
  out.push(`- Variants: ${variants.join(', ')}`);
  for (const c of meta.contexts ?? []) {
    const at = c.commit ? ` @ \`${c.commit.slice(0, 12)}\`${c.dirty ? ' + uncommitted changes' : ''}` : '';
    out.push(`- Context \`${c.variant}\` (${c.plugin}): \`${c.dir}\`${at}`);
  }
  out.push('- Ranges are shown as avg (min–max) per solve. Cost is pi\'s list-price estimate.');
  out.push('- Results: Δ = candidate − reference, ± = noise band √(SD₁² + SD₂²), at least 5 score points, 10 s, 1 turn; **bold** = beyond the band (pooled: and the same sign on k/N ≥ ⅔ of models). vs baseline: lift = score up, or score flat with time and turns both down. vs another version: lift = any metric better, none worse; mixed = some better, some worse. n/a = fewer than 2 solves on a side.', '');
  for (const p of plugins) {
    const models = p.models ?? [];
    const pooled = models.length > 1;
    const labels = modelLabels(models);
    out.push(`## ${p.plugin}`, '');
    const summaries = [...models.map((m) => [labels[m], p.summaryByModel[m]]), ...(pooled ? [[POOLED, p.summary]] : [])];
    table(
      out,
      ['Model', 'Variant', 'Avg score', 'Δ avg', 'Worst Δ', 'Best Δ', 'Skills used', 'Failed', 'Time', 'Turns', 'Tokens', 'Cost', 'Total cost'],
      summaries.flatMap(([label, summary]) =>
        variants
          .filter((v) => summary[v])
          .map((v) => {
            const s = summary[v];
            return [
              label,
              v,
              pct(s.scenarioScore.avg),
              signed(s.differential?.avg),
              signed(s.differential?.worstScenario),
              signed(s.differential?.bestScenario),
              `${s.activation}/${s.attempts}`,
              s.failed,
              range(s.duration, secs),
              range(s.turns, (x) => num(x)),
              range(s.tokens, int),
              range(s.cost, usd),
              usd(s.totalCost),
            ];
          }),
      ),
    );
    if (p.results?.length) {
      table(
        out,
        ['Comparison', 'Model', ...LABELS],
        p.results.flatMap((r) => {
          const rows = [...models.filter((m) => r.models[m]).map((m) => [labels[m], r.models[m]]), ...(pooled ? [[POOLED, r.pooled]] : [])];
          return rows.map(([label, counts]) => [`${r.candidate} vs ${r.reference}`, label, ...LABELS.map((l) => (l === 'mixed' && r.rule === 'baseline' ? '—' : counts[l]))]);
        }),
      );
    }
    for (const sc of p.scenarios) {
      out.push(`### ${sc.name}`, '');
      const shown = variants.filter((v) => sc.variants[v]);
      const groups = [...models.filter((m) => sc.models[m]).map((m) => [m, sc.models[m]]), ...(pooled ? [[null, sc]] : [])];
      table(
        out,
        ['Model', 'Variant', 'Score', 'SD', 'Δ avg', 'Δ min', 'Δ max', 'Skills used', 'Time', 'Turns', 'Tokens', 'Cost'],
        groups.flatMap(([m, g]) =>
          shown
            .filter((v) => g.variants[v])
            .map((v) => {
              const s = g.variants[v];
              const d = g.differential[v];
              const act = `${s.activation.count}/${s.attempts}${s.activation.skills.length ? ` (${s.activation.skills.join(', ')})` : ''}`;
              return [m ? labels[m] : POOLED, v, range(s.score, pct), num(s.score.sd), signed(d?.avg), signed(d?.min), signed(d?.max), act, range(s.duration, secs), range(s.turns, (x) => num(x)), range(s.tokens.total, int), range(s.cost, usd)];
            }),
        ),
      );
      if (sc.comparisons?.length) {
        table(
          out,
          ['Comparison', 'Model', 'Result', 'Score', 'Time', 'Turns', 'Tokens', 'Cost'],
          sc.comparisons.flatMap((c) => {
            const rows = [...models.filter((m) => c.models[m]).map((m) => [labels[m], c.models[m], false]), ...(pooled ? [[POOLED, c.pooled, true]] : [])];
            return rows.map(([label, r, agreement]) => [`${c.candidate} vs ${c.reference}`, label, r.label, ...METRICS.map((x) => deltaCell(x.key, r.metrics[x.key], agreement))]);
          }),
        );
      }
      table(
        out,
        ['Model', 'Solve', 'Status', 'Score', 'Skills used', 'Time', 'Turns', 'Tokens in / out / total', 'Cost'],
        models
          .filter((m) => sc.models[m])
          .flatMap((m) =>
            shown
              .filter((v) => sc.models[m].variants[v])
              .flatMap((v) =>
                sc.models[m].variants[v].solves.map((s) => [
                  labels[m],
                  `${v} #${s.run}`,
                  s.status === 'ok' ? 'ok' : `${s.status}${s.error ? `: ${s.error}` : ''}`,
                  pct(s.score),
                  s.skillsUsed.length ? s.skillsUsed.join(', ') : '—',
                  secs(s.durationMs),
                  num(s.turns, 0),
                  `${int(s.tokens.input)} / ${int(s.tokens.output)} / ${int(s.tokens.total)}`,
                  usd(s.cost),
                ]),
              ),
          ),
      );
      const names = [...new Set(shown.flatMap((v) => sc.variants[v].checks.map((c) => c.name)))];
      if (names.length) {
        table(
          out,
          ['Check', ...shown],
          names.map((n) => [
            n,
            ...shown.map((v) => {
              const c = sc.variants[v].checks.find((x) => x.name === n);
              return c ? `${num(c.avg)}/${c.max}` : '—';
            }),
          ]),
        );
      }
    }
  }
  return out.join('\n');
}
