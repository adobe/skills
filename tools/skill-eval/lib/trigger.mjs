import { basename } from 'node:path';
import { detectActivations, LINE_NUMBER_PREFIX } from './session.mjs';

const WRITE_TOOLS = new Set(['write', 'edit']);
export const TRIGGER_THRESHOLD = 0.5;
const MAX_TIMER_MS = 2 ** 31 - 1;

export function timeoutMs(minutes) {
  const ms = Number(minutes) * 60_000;
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMER_MS) throw new Error(`--timeout must be minutes > 0 and <= ${Math.floor(MAX_TIMER_MS / 60_000)}`);
  return ms;
}

function firstLineIndex(text) {
  const first = new Map();
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(LINE_NUMBER_PREFIX, '').trim();
    if (l && !first.has(l)) first.set(l, i);
  });
  return first;
}

function positionIn(lines, skill, shared) {
  let best = Infinity;
  for (const l of [...(skill.header ?? []), ...(skill.signature ?? [])]) {
    if (/^[-=*_`#|\s]*$/.test(l) || shared.has(l)) continue;
    const i = lines.get(l);
    if (i !== undefined && i < best) best = i;
  }
  return best;
}

export function createWatcher(skills, { maxTurns = 6, keepGoing = false } = {}) {
  const triggered = new Set();
  const order = [];
  const seen = (name) => {
    if (triggered.has(name)) return;
    triggered.add(name);
    order.push({ skill: name, turn: turns });
  };
  let buffer = '';
  let turns = 0;
  let reason = null;
  const dirs = skills.map((s) => ({ name: s.name, needle: `/skills/${basename(s.dir)}/` }));
  const lineCount = new Map();
  for (const s of skills) for (const l of new Set(s.header ?? [])) lineCount.set(l, (lineCount.get(l) ?? 0) + 1);
  const shared = new Set([...lineCount].filter(([, n]) => n > 1).map(([l]) => l));

  const handle = (ev) => {
    if (ev.type === 'message_end' && ev.message?.role === 'toolResult') {
      const content = ev.message.content;
      const text = typeof content === 'string' ? content : (content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      const byName = new Map(skills.map((s) => [s.name, s]));
      const lines = firstLineIndex(text);
      const found = detectActivations([text], skills).map((n) => ({ n, at: positionIn(lines, byName.get(n), shared) }));
      for (const { n } of found.sort((a, b) => a.at - b.at)) seen(n);
      return;
    }
    if (ev.type !== 'message_end' || ev.message?.role !== 'assistant') return;
    turns++;
    let writes = false;
    for (const c of Array.isArray(ev.message.content) ? ev.message.content : []) {
      if (c.type !== 'toolCall') continue;
      const args = JSON.stringify(c.arguments ?? {});
      const hits = dirs.map((d) => ({ name: d.name, at: args.indexOf(d.needle) })).filter((h) => h.at >= 0);
      for (const h of hits.sort((a, b) => a.at - b.at)) seen(h.name);
      if (WRITE_TOOLS.has(String(c.name).toLowerCase())) writes = true;
    }
    if (!keepGoing && !triggered.size && writes) reason = 'write';
  };

  return {
    feed(chunk) {
      if (reason) return true;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handle(JSON.parse(line));
        } catch {}
      }
      if (!reason && !keepGoing && triggered.size) reason = 'skill';
      if (!reason && turns >= maxTurns) reason = 'max-turns';
      return reason !== null;
    },
    result: () => ({ triggered: [...triggered].sort(), order: [...order], stopReason: reason ?? 'finished', turns }),
  };
}

export function parseQuerySet(json, name = 'query set') {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(data.queries) || !data.queries.length) throw new Error(`${name}: needs a non-empty "queries" array`);
  if (data.fixture && !(data.fixture.repoUrl && data.fixture.ref)) throw new Error(`${name}: fixture needs repoUrl and ref`);
  if (data.fixture?.remote !== undefined && typeof data.fixture.remote !== 'string') throw new Error(`${name}: fixture remote must be a URL string`);
  const seen = new Set();
  const queries = data.queries.map((q, i) => {
    const id = q.id ?? `q${i + 1}`;
    if (seen.has(id)) throw new Error(`${name}: duplicate query id ${id}`);
    seen.add(id);
    if (typeof q.query !== 'string' || !q.query.trim()) throw new Error(`${name}: ${id} needs a query`);
    if (typeof q.should_trigger !== 'boolean') throw new Error(`${name}: ${id} needs boolean should_trigger`);
    if (typeof q.skill !== 'string' || !q.skill) throw new Error(`${name}: ${id} needs the skill under test`);
    if (q.split !== undefined && q.split !== 'train' && q.split !== 'test') throw new Error(`${name}: ${id} split must be train or test`);
    return { id, query: q.query, should_trigger: q.should_trigger, skill: q.skill, ...(q.split ? { split: q.split } : {}) };
  });
  return { name: data.name ?? name, fixture: data.fixture ?? null, queries };
}

export function summarizeTriggers(queries, results, { threshold = TRIGGER_THRESHOLD } = {}) {
  const rows = [];
  for (const q of queries) {
    const mine = results.filter((r) => r.query === q.id && r.status === 'ok');
    const models = [...new Set(mine.map((r) => r.model))];
    const rate = (rs) => (rs.length ? rs.filter((r) => r.triggered.includes(q.skill)).length / rs.length : null);
    const instead = new Map();
    for (const r of mine) for (const s of r.triggered) if (s !== q.skill) instead.set(s, (instead.get(s) ?? 0) + 1);
    const first = new Map();
    for (const r of mine) {
      const f = r.order?.[0]?.skill ?? 'none';
      first.set(f, (first.get(f) ?? 0) + 1);
    }
    const pooled = rate(mine);
    rows.push({
      ...q,
      runs: mine.length,
      rate: pooled,
      byModel: Object.fromEntries(models.map((m) => [m, rate(mine.filter((r) => r.model === m))])),
      triggeredHit: pooled !== null && pooled >= threshold,
      instead: Object.fromEntries([...instead].sort((a, b) => b[1] - a[1])),
      first: Object.fromEntries([...first].sort((a, b) => b[1] - a[1])),
    });
  }
  const skills = [];
  for (const skill of [...new Set(queries.map((q) => q.skill))]) {
    const qs = rows.filter((r) => r.skill === skill && r.rate !== null);
    const tp = qs.filter((r) => r.should_trigger && r.triggeredHit).length;
    const fn = qs.filter((r) => r.should_trigger && !r.triggeredHit).length;
    const fp = qs.filter((r) => !r.should_trigger && r.triggeredHit).length;
    const tn = qs.filter((r) => !r.should_trigger && !r.triggeredHit).length;
    skills.push({ skill, tp, fn, fp, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null });
  }
  return { rows, skills };
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(100 * x)}%`);

export function renderTriggerMarkdown({ summary, models, labels, meta }) {
  const out = [];
  out.push(`# Trigger report${meta?.name ? `: ${meta.name}` : ''}`, '');
  if (meta?.variant) out.push(`Variant: ${meta.variant}. ${meta.runs} run(s) per query and model; triggered = rate ≥ ${pct(TRIGGER_THRESHOLD)}.`, '');
  const keepGoing = Boolean(meta?.keepGoing);
  if (keepGoing) out.push(`Keep-going: runs continue past the first skill and the first write, up to ${meta.maxTurns} turns; a skill counts if opened at any point. "First opened" counts the first skill per run.`, '');
  out.push('| Skill | Precision | Recall | TP | FN | FP | TN |', '|---|---|---|---|---|---|---|');
  for (const s of summary.skills) out.push(`| ${s.skill} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.tp} | ${s.fn} | ${s.fp} | ${s.tn} |`);
  const firstHead = keepGoing ? ' First opened |' : '';
  out.push('', `| Query | Skill | Should | Pooled | ${models.map((m) => labels[m] ?? m).join(' | ')} | Fired instead |${firstHead}`, `|---|---|---|---|${models.map(() => '---').join('|')}|---|${keepGoing ? '---|' : ''}`);
  for (const r of summary.rows) {
    const ok = r.rate === null ? '' : r.triggeredHit === r.should_trigger ? '' : ' ✗';
    const instead = Object.entries(r.instead).map(([s, n]) => `${s} ×${n}`).join(', ') || '—';
    const first = keepGoing ? ` ${Object.entries(r.first ?? {}).map(([s, n]) => `${s} ×${n}`).join(', ') || '—'} |` : '';
    out.push(`| ${r.id}${r.split ? ` (${r.split})` : ''}: ${r.query.replace(/\s+/g, ' ').slice(0, 70)}${r.query.length > 70 ? '…' : ''} | ${r.skill} | ${r.should_trigger ? 'yes' : 'no'} | ${pct(r.rate)}${ok} | ${models.map((m) => pct(r.byModel[m])).join(' | ')} | ${instead} |${first}`);
  }
  return out.join('\n');
}
