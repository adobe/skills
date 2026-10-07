// Generated views: the chat model turns a chat question into a declarative page spec (sections bound to read-only SQL).
// The spec is validated by running every query, stored in D1 (view_spec), and rendered by the client. Data is
// always fetched through /api/views/:id/data, which runs the stored queries, never client-supplied SQL.
import type { Context } from 'hono';
import type { Env } from './index';
import { checkSql, runTool, schemaDoc } from './chat';
import { loadMeta } from './site';

const MAX_TURNS = 8;
const VIEW_ROWS = 500;

const VIEW_DOC = `
You are building a full-page VIEW for the scope explorer, answering the user's question from the conversation.
Explore with query_sql if needed, then call create_view exactly once with a declarative spec. Sections render in order:
- {"type":"kpis","items":[{"label","sql","link"?,"note"?}]}  each sql returns ONE row with ONE value (2-6 items)
- {"type":"table","title","note"?,"sql","columns"?:[{"key","label","format"?}],"link"?}  format: number|views|path|verdict|text;
  link is a template using column names, e.g. "/urls/{id}" or "/blocks/{block}" or "/urls?template={aem_template}&block={block}"
- {"type":"bar","title","note"?,"sql"}  sql returns columns label, value and optionally link and verdict (colours bars)
- {"type":"matrix","title","note"?,"sql","link"?}  sql returns row, col, value: rendered as a pivot heat table (e.g. blocks x templates); link may use {row} and {col}
- {"type":"gallery","title","note"?,"sql"}  sql returns crop (page_block.crop, or a crop from block_variant.examples), caption, link?
- {"type":"text","markdown"}  short framing or conclusions (no numbers that are not backed by a section)
Rules: 3-8 sections; lead with KPIs; every number comes from a section query; prefer links into /urls?... so rows are explorable;
queries must be valid SQLite, SELECT/WITH only, return at most ${VIEW_ROWS} rows; use u.in_sitemap=1 for page counts.
If a query fails you will get the error back; fix it and call create_view again.`;

const CREATE_VIEW_TOOL = {
  name: 'create_view',
  description: 'Create the page. Every SQL is executed to validate it; errors are returned for fixing.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string', description: '1-2 sentence markdown summary shown under the title' },
      sections: { type: 'array', items: { type: 'object' } },
    },
    required: ['title', 'summary', 'sections'],
  },
};
const QUERY_TOOL = {
  name: 'query_sql',
  description: 'Run one read-only SQL query (SELECT/WITH) to explore the data before designing the view. Returns up to 200 rows.',
  input_schema: { type: 'object', properties: { sql: { type: 'string' }, why: { type: 'string' } }, required: ['sql'] },
};

type Section = { type: string; sql?: string; items?: { label: string; sql: string; link?: string; note?: string }[]; [k: string]: unknown };
type Spec = { title: string; summary: string; sections: Section[] };

const TYPES = new Set(['kpis', 'table', 'bar', 'matrix', 'gallery', 'text']);

async function validate(env: Env, spec: Spec): Promise<string[]> {
  const errors: string[] = [];
  if (!spec.title || !Array.isArray(spec.sections) || !spec.sections.length) return ['title and a non-empty sections array are required'];
  if (spec.sections.length > 12) errors.push('at most 12 sections');
  for (const [i, s] of spec.sections.entries()) {
    if (!TYPES.has(s.type)) { errors.push(`section ${i}: unknown type ${s.type}`); continue; }
    const sqls = s.type === 'kpis' ? (s.items ?? []).map((it) => it.sql) : s.type === 'text' ? [] : [s.sql];
    if (s.type === 'kpis' && !(s.items ?? []).length) errors.push(`section ${i}: kpis needs items`);
    for (const q of sqls) {
      try {
        await env.DB.prepare(checkSql(String(q ?? ''), 1)).all();
      } catch (e) { errors.push(`section ${i} (${s.type}): ${(e as Error).message}`); }
    }
    for (const l of [s.link, ...(s.items ?? []).map((it) => it.link)]) {
      if (l && !String(l).startsWith('/')) errors.push(`section ${i}: links must be relative paths starting with /`);
    }
  }
  return errors;
}

async function callModel(env: Env, system: unknown, tools: unknown[], messages: unknown[]) {
  const res = await fetch(env.FOUNDRY_ENDPOINT, {
    method: 'POST',
    headers: { 'x-api-key': env.FOUNDRY_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CHAT_MODEL, max_tokens: 6000, system, tools, messages }),
  });
  if (!res.ok) throw new Error(`Model error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json<{ content: any[]; stop_reason: string; usage: Record<string, number> }>();
}

export async function createView(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  const ip = c.req.header('cf-connecting-ip') ?? 'anon';
  const { success } = await env.CHAT_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: 'Too many requests in a short time. Please wait a minute.' }, 429);
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare('SELECT tokens FROM usage WHERE day = ?').bind(day).first<{ tokens: number }>();
  if (used && used.tokens > Number(env.DAILY_TOKEN_BUDGET)) return c.json({ error: 'The daily AI budget is used up; it resets at 00:00 UTC.' }, 429);

  const body = await c.req.json<{ messages: { role: string; content: string }[]; title?: string; description?: string }>();
  const convo = (body.messages ?? []).slice(-8).map((m) => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 3000)}`).join('\n\n');
  const ask = `Conversation so far:\n${convo}\n\nBuild the view "${body.title ?? 'Custom view'}": ${body.description ?? ''}`;
  const system = [{ type: 'text', text: schemaDoc(await loadMeta(env.DB)) + VIEW_DOC, cache_control: { type: 'ephemeral' } }];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter(); const enc = new TextEncoder();
  const send = (o: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`));

  const run = async () => {
    let tokens = 0;
    try {
      const messages: any[] = [{ role: 'user', content: ask }];
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        await send({ type: 'step', text: turn === 0 ? 'Designing the page…' : 'Refining…' });
        const out = await callModel(env, system, [QUERY_TOOL, CREATE_VIEW_TOOL], messages);
        tokens += (out.usage.input_tokens ?? 0) + (out.usage.output_tokens ?? 0) + (out.usage.cache_creation_input_tokens ?? 0);
        messages.push({ role: 'assistant', content: out.content });
        const uses = out.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) { await send({ type: 'error', error: 'The model did not produce a view. Try rephrasing the question.' }); break; }
        const results = []; let created: string | null = null;
        for (const u of uses) {
          if (u.name === 'query_sql') {
            await send({ type: 'step', text: `Querying: ${u.input.why ?? 'data'}` });
            const r = await runTool(env, 'query_sql', u.input);
            results.push({ type: 'tool_result', tool_use_id: u.id, content: r.text });
          } else if (u.name === 'create_view') {
            const spec = u.input as Spec;
            await send({ type: 'step', text: `Checking ${spec.sections?.length ?? 0} sections…` });
            const errors = await validate(env, spec);
            if (errors.length) {
              await send({ type: 'step', text: `Fixing ${errors.length} issue(s)…` });
              results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: errors.join('\n') });
            } else {
              const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
              await env.DB.prepare('INSERT INTO view_spec(id, title, summary, question, spec, created_at, tokens) VALUES (?,?,?,?,?,?,?)')
                .bind(id, spec.title.slice(0, 120), spec.summary ?? '', convo.slice(-4000), JSON.stringify(spec), new Date().toISOString(), tokens).run();
              created = id;
              results.push({ type: 'tool_result', tool_use_id: u.id, content: 'created' });
            }
          } else results.push({ type: 'tool_result', tool_use_id: u.id, content: 'unknown tool' });
        }
        if (created) { await send({ type: 'created', id: created }); break; }
        messages.push({ role: 'user', content: results });
        if (turn === MAX_TURNS - 1) await send({ type: 'error', error: 'Could not build a valid view in time. Try a narrower question.' });
      }
    } catch (e) {
      await send({ type: 'error', error: (e as Error).message });
    } finally {
      await send({ type: 'done' });
      await writer.close();
      await env.DB.prepare('INSERT INTO usage(day, tokens, questions) VALUES (?, ?, 0) ON CONFLICT(day) DO UPDATE SET tokens = tokens + excluded.tokens')
        .bind(day, tokens).run();
    }
  };
  c.executionCtx.waitUntil(run());
  return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}

export async function getView(c: Context<{ Bindings: Env }>) {
  const row = await c.env.DB.prepare('SELECT id, title, summary, spec, created_at FROM view_spec WHERE id = ?').bind(c.req.param('id')).first<{ spec: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ...row, spec: JSON.parse(row.spec) });
}

// runs the stored queries of a view; results[i] matches sections[i] (kpis: array of values)
export async function viewData(c: Context<{ Bindings: Env }>) {
  const row = await c.env.DB.prepare('SELECT spec FROM view_spec WHERE id = ?').bind(c.req.param('id')).first<{ spec: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const spec = JSON.parse(row.spec) as Spec;
  const run = async (q?: string) => {
    try { return { rows: (await c.env.DB.prepare(checkSql(String(q ?? ''), VIEW_ROWS)).all()).results }; } catch (e) { return { error: (e as Error).message }; }
  };
  const results = [];
  for (const s of spec.sections) {
    if (s.type === 'text') results.push(null);
    else if (s.type === 'kpis') results.push(await Promise.all((s.items ?? []).map(async (it) => { const r = await run(it.sql); return r.rows ? Object.values(r.rows[0] ?? {})[0] ?? null : null; })));
    else results.push(await run(s.sql));
  }
  return c.json({ results });
}
