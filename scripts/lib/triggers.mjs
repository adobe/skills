// Trigger queries: prompts a user would write, each saying whether it should make an agent
// load a skill of the plugin. A plugin keeps one set per skill:
//
//   <plugin>/trigger-queries/<skill>.json
//   { "name", "description"?, "fixture"?: { "repoUrl", "ref", "remote"? },
//     "queries": [{ "id"?, "query", "should_trigger", "skill", "split"?, "note"? }] }
//
// should_trigger true: the request is what the skill's description says it is for.
// false: a near miss, close to it but owned by another skill or by none. The fixture is the
// repository the agent starts in, as a commit fixture of a scenario.
export const THRESHOLD = 0.5;

export function parseTriggerSet(json, name = 'trigger set') {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(data?.queries) || data.queries.length === 0) throw new Error(`${name}: has no queries`);
  if (data.fixture && !(data.fixture.repoUrl && data.fixture.ref)) throw new Error(`${name}: a fixture needs a repoUrl and a ref`);
  const ids = new Set();
  const queries = data.queries.map((entry, index) => {
    const id = entry.id ?? `q${index + 1}`;
    if (ids.has(id)) throw new Error(`${name}: the id ${id} twice`);
    ids.add(id);
    if (typeof entry.query !== 'string' || !entry.query.trim()) throw new Error(`${name}: ${id} has no query`);
    if (typeof entry.should_trigger !== 'boolean') throw new Error(`${name}: ${id}: should_trigger is true or false`);
    if (typeof entry.skill !== 'string' || !entry.skill) throw new Error(`${name}: ${id} names no skill`);
    if (entry.split !== undefined && !['train', 'test'].includes(entry.split)) throw new Error(`${name}: ${id}: split is train or test`);
    return { id, query: entry.query, should_trigger: entry.should_trigger, skill: entry.skill };
  });
  return { name: data.name ?? name, fixture: data.fixture ?? null, queries };
}

// Per query, the share of runs that loaded its skill; per skill, how many queries came out
// as they should. A query counts as loading its skill when at least THRESHOLD of its runs did.
export function summarize(queries, runs) {
  const rows = queries.map((query) => {
    const mine = runs.filter((run) => run.query === query.id && !run.error);
    const rate = mine.length > 0 ? mine.filter((run) => run.loaded.includes(query.skill)).length / mine.length : null;
    const instead = {};
    for (const run of mine) for (const skill of run.loaded) if (skill !== query.skill) instead[skill] = (instead[skill] ?? 0) + 1;
    return { ...query, runs: mine.length, rate, loaded: rate !== null && rate >= THRESHOLD, instead };
  });
  const skills = [...new Set(queries.map((query) => query.skill))].map((skill) => {
    const mine = rows.filter((row) => row.skill === skill && row.rate !== null);
    const count = (should, loaded) => mine.filter((row) => row.should_trigger === should && row.loaded === loaded).length;
    const [tp, fn, fp, tn] = [count(true, true), count(true, false), count(false, true), count(false, false)];
    return { skill, tp, fn, fp, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  });
  return { rows, skills };
}

const percent = (value) => (value === null ? '—' : `${Math.round(100 * value)}%`);

export function markdown({ rows, skills }) {
  const out = ['| Skill | Precision | Recall | TP | FN | FP | TN |', '|---|---|---|---|---|---|---|'];
  for (const s of skills) out.push(`| ${s.skill} | ${percent(s.precision)} | ${percent(s.recall)} | ${s.tp} | ${s.fn} | ${s.fp} | ${s.tn} |`);
  out.push('', '| Query | Should load | Loaded in | Loaded instead |', '|---|---|---|---|');
  for (const row of rows) {
    const wrong = row.rate !== null && row.loaded !== row.should_trigger ? ' ✗' : '';
    const instead = Object.entries(row.instead).map(([skill, n]) => `${skill} ×${n}`).join(', ') || '—';
    out.push(`| ${row.id}: ${row.query.replace(/\s+/g, ' ').slice(0, 70)}${row.query.length > 70 ? '…' : ''} | ${row.should_trigger ? 'yes' : 'no'} | ${percent(row.rate)}${wrong} | ${instead} |`);
  }
  out.push('', `A query counts as loading its skill when ${percent(THRESHOLD)} of its runs or more did.`);
  return out.join('\n');
}
