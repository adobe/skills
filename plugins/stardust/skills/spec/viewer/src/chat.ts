import type { Context } from 'hono';
import type { Env } from './index';
import { loadMeta, siteFacts, type Meta } from './site';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type Msg = { role: 'user' | 'assistant'; content: string | unknown[] };

const MAX_TURNS = 6;
const MAX_ROWS = 200;
const MAX_RESULT_CHARS = 14000;

// Site-specific facts (name, origin, scope, reference library, telemetry) come from the meta table at request time.
export function schemaDoc(meta: Meta): string {
  const site = siteFacts(meta);
  const where = site.origin ? `${site.origin}${site.scopePath === '/' ? '' : ` (scope ${site.scopePath})`}` : site.name;
  const sitemap = Number(meta.sitemap_urls) > 0 ? `the ${Number(meta.sitemap_urls).toLocaleString('en-US')} sitemap URLs` : 'the sitemap URLs';
  const rumLine = site.rum
    ? `${meta.rum_window ?? '90 days'} of real-user telemetry (RUM/Optel, sampled), `
    : '';
  const reuse = site.refName
    ? `with reuse verdicts against ${site.refPhrase} (block.reference_block names the matching block there)`
    : 'with reuse verdicts against the reference block library (block.reference_block names the matching block)';
  const noRum = site.rum ? '' : `
NO REAL-USER TELEMETRY for this site: pageviews_90d, rum_bundles, rum_views, rum_views_90d are 0 or NULL, traffic_band is
'none' or NULL, broken has no source='rum' rows and rum_redirect_landing is empty. Do not rank or filter by traffic; if asked
about traffic or real-user 404s, say that telemetry was not available for this scope.`;
  return `
You answer questions about the migration scope of ${site.name} (${where}) to Adobe Edge Delivery Services (EDS).
The data was produced by an agent from the live site only (no output of any migration work was used): crawl of ${sitemap}, link check,
${rumLine}source component parsing, and a proposed mapping of source components to EDS blocks
${reuse}.${noRum}

DATABASE (SQLite / Cloudflare D1, read-only)
url(id, url, path, section, depth, in_sitemap 0/1, status, final_url, final_status,
    outcome: 'page' (live, 200) | 'redirect' | 'redirect-broken' (redirects into a 404) | 'redirect-external' | 'loop' | 'http-404' | 'error',
    aem_template (source page template id), variant_code (e.g. 'article#3'), title, eds_path (path after migration),
    needs_migration_redirect 0/1 (EDS path differs beyond dropping .html: case, '--', '_' ...),
    pageviews_90d (estimated human views, 90 days, sampled 1:100 so values are multiples of ~100; 0 = no sampled view),
    rum_bundles, traffic_band 'none'|'low'(<1k)|'medium'(1k-10k)|'high'(>=10k), block_count (distinct EDS blocks), capture_key,
    main_chars (text length of the main area), flag 'empty' (no content) | 'thank-you' (form confirmation) | NULL)
  Scope: in_sitemap=1 are the sitemap URLs of the scope (${site.scopePath}); in_sitemap=0 rows are scope URLs discovered via links (often 404s/redirects).
  "Pages to migrate" = outcome='page' AND in_sitemap=1. ALWAYS add u.in_sitemap=1 when counting pages or blocks unless the
  user asks about discovered URLs. block.url_count, template.url_count and the views already count sitemap pages only.
template(id = source template id, label, url_count, pageviews_90d, variant_count, top_variants_share, rep_url)
variant(code, template_id, rank, label (core blocks), core JSON array, optional JSON [[token, share]], url_count, pageviews_90d,
        distinct_sets, rep_url)  -- layout variants: pages of one template clustered by their EDS block set
block(name, kind 'block'|'dynamic'|'global', description, aem JSON (source components), reference_block (matching block of the reference library or null),
      verdict 'reuse'|'variant'|'new', rationale, url_count, instance_count, template_count, pageviews_90d)
block_variant(id, block, variant (may be NULL = default), verdict, rationale, url_count, instance_count, examples JSON)
page_block(url_id, pos, block, variant, kind 'block'|'dynamic'|'global'|'default'|'section'|'metadata'|'unmapped', aem JSON,
           path, nested_in ('tabs'|'accordion' when the block sits inside one -> needs a fragment), section (bg style), crop)
  kind 'default' rows have block='default-content'; 'section' rows are section styles (block='section-style', variant=bg class).
  To count blocks use kind IN ('block','dynamic') (add 'global' for site chrome such as header and footer).
aem_component(name, url_count, instance_count, maps_to JSON {block: instances})  -- source components
redirect(src, target, status, hops, kind 'legacy' (exists today on the source) | 'migration' (created by the EDS path rules),
         target_status, external 0/1, in_sitemap, inbound_pages (pages linking to src), rum_views, note)
broken(url, status, source 'sitemap'|'link'|'rum', kind 'page'|'asset', in_scope 0/1 (under ${site.scopePath}), inbound_pages, inbound_main (links in main content),
       rum_views, rum_bundles, referrers JSON, note)
link(from_url_id, to_url, zone 'main'|'chrome') -- only links that point to broken or redirecting URLs
rum_redirect_landing(path, views, bundles) -- pages real users reached through a redirect (source unknown)
meta(key, value)   -- build facts; includes i18n_notes (JSON list of multi-language findings)

IMPLEMENTATION LAYER (how each part must be built on EDS; stardust:dynamics taxonomy)
feature(id, class 'L'|'S'|'F'|'M'|'V'|'T'|'A'|'R'|'X'|'I18N'|'CR'|'D', class_name, name, evidence, disposition
        'rebuild-native'|'index-backed'|'data-fed'|'embed-passthrough'|'client-only'|'static-snapshot'|'decided-out',
        reproducibility 'self'|'needs-credential'|'needs-backend'|'needs-human-capture'|'needs-business-decision', status, pattern,
        eds (implementation guidance), decisions JSON (open_question ids), sitewide 0/1, reach_pages, reach_templates, pageviews_90d)
feature_page(feature_id, url_id)  -- only for non-site-wide features
page_signal(url_id, signal)  -- detected page signals, e.g. 'launch', 'hreflang', 'chrome', 'iframe:youtube' (query DISTINCT signal for the full list)
vendor(host, role, class, seen_pages (of the probed pages), via 'runtime'|'launch', in_csp, consent_group (consent platform category), launch_rules)
launch_rule(id, name, vendor, kind 'campaign'|'acdl'|'global', events, path_values JSON, html_paths, selectors JSON, hosts,
            needs_rewrite 0/1, eds_paths JSON, live_pages)  -- tag manager (Adobe Launch) property rules
datalayer_field(path, data_elements JSON, group_name, eds_source)  -- data-layer fields the tag manager reads
metadata_field(name, aem_source (where the source page carries it), used_by JSON, coverage_pages, distinct_values, top_values JSON)
query_index(name, include_paths, exclude_paths, filter, properties, consumers, source, yaml)
locale_tree(tree 'cc/ll', country, language, urls, shared_with_scope (paths shared with the scope tree), shared_pct, rum_views_90d, deep_sampled, live_pages, templates, blocks, unmapped, sitemap)
site_config(key, now, eds, decision)
search_probe(term, expect_count, expect_titles JSON, expect_includes)  -- source search results for parity checks
open_question(id, area, owner 'stakeholder'|'implementer', blocking 0/1, question, context, options JSON, default_assumption, impact, link, features JSON)
question_answer(question_id, answer, decided_option, answered_by, answered_at)  -- recorded decisions (latest wins)
For "how should X be implemented" questions: read feature.eds + evidence + the linked open questions, and say whether it is
decided (answer recorded) or still open (default assumption applies).

Views: v_block_usage(block, variant, instances, urls, templates), v_url_blocks(path, aem_template, variant_code, pos, block, variant, kind, nested_in, section),
       v_template_blocks(aem_template, block, urls)

LINKS INTO THE EXPLORER (use them so the user can open the rows behind every number; relative links, markdown):
  /urls?block=<name>[&bvariant=<variant>]&template=<id>&variant=<code>&section=<s>${site.rum ? '&traffic=<band>' : ''}&verdict=<reuse|variant|new>
       &has=<block>&has=<block> (pages needing ALL listed blocks) &nested=1 &dynamic=1 &flag=<empty|thank-you> &outcome=<outcome|all> &q=<path text>
       (the explorer shows sitemap URLs by default; add &sitemap=all to include discovered URLs or &sitemap=0 for only those)
  /urls?feature=<feature id> (pages where a dynamic feature appears)
  /urls/<id>   /templates/<id>   /blocks/<name>   /redirects?kind=<legacy|migration>   /broken?source=<sitemap|link${site.rum ? '|rum' : ''}>
  /api/spec.md (full migration spec, readable)   /api/spec.json (machine spec)   /api/export/<features|open-questions|launch-rules>.csv
  URL-encode values (e.g. variant=article%233).

RULES
- Always ground numbers in a query. Never invent URLs, counts or blocks. If the data cannot answer, say "not in the data".
- Be brief: lead with the answer, then a short list or table (max ~10 rows; link to the full list instead of dumping).
- If the full answer needs more than ~10 rows, two dimensions (e.g. blocks x templates), several tables, or a dashboard:
  answer in chat with a 3-6 line summary of the key numbers AND call offer_view. Never write long multi-table answers in chat.
- Never generalise beyond the rows you retrieved (e.g. do not say "every template" unless the query shows it).
- Links must be complete; never leave a link half-written.
${site.rum ? '- Traffic is an estimate from sampled RUM; say "about".\n' : ''}- Reuse verdicts and block mapping are a proposal by the scoping agent, not a decision; say so when it matters.
- One SQL statement per call; SELECT/WITH only.`;
}

const TOOLS = [
  {
    name: 'query_sql',
    description: 'Run one read-only SQL query (SELECT or WITH) against the scope database. Returns up to 200 rows as JSON.',
    input_schema: { type: 'object', properties: { sql: { type: 'string' }, why: { type: 'string', description: 'one line: what this query answers' } }, required: ['sql'] },
  },
  {
    name: 'offer_view',
    description: 'Offer the user a full-page view in the main panel for this answer. Call it (once, together with a short chat answer) when the answer needs more structure than a chat message: rankings or lists longer than ~15 rows, breakdowns across two dimensions (e.g. blocks x templates), comparisons, dashboards, or anything the user will want to keep and come back to. Do not call it for simple facts or short lists. The user decides whether to build it.',
    input_schema: { type: 'object', properties: { title: { type: 'string', description: 'short page title, max 60 chars' }, description: { type: 'string', description: 'one sentence: what the page will show' } }, required: ['title', 'description'] },
  },
  {
    name: 'url_blocks',
    description: 'Ordered EDS blocks for one URL (path or full URL), with verdicts, template and variant.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    cache_control: { type: 'ephemeral' },
  },
];

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|chat_log|usage|view_spec)\b/i;

export function checkSql(raw: string, maxRows = MAX_ROWS): string {
  const sql = raw.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(sql)) throw new Error('Only SELECT/WITH queries are allowed.');
  if (sql.includes(';')) throw new Error('One statement only.');
  if (FORBIDDEN.test(sql)) throw new Error('Query uses a forbidden keyword or table.');
  return `SELECT * FROM (${sql}) LIMIT ${maxRows}`;
}

export async function runTool(env: Env, name: string, input: Record<string, unknown>): Promise<{ text: string; rows: number; sql?: string }> {
  try {
    if (name === 'query_sql') {
      const sql = checkSql(String(input.sql ?? ''));
      const res = await env.DB.prepare(sql).all();
      const text = JSON.stringify(res.results);
      return { text: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}... (truncated)` : text, rows: res.results.length, sql: String(input.sql) };
    }
    if (name === 'url_blocks') {
      let u = String(input.url ?? '').trim();
      if (u.startsWith('http')) u = new URL(u).pathname;
      const url = await env.DB.prepare('SELECT id, url, path, outcome, aem_template, variant_code, pageviews_90d, final_url FROM url WHERE path = ? OR path = ? OR eds_path = ?')
        .bind(u, `${u}.html`, u).first();
      if (!url) return { text: 'URL not found in scope.', rows: 0 };
      const blocks = await env.DB.prepare(`SELECT pb.pos, pb.block, pb.variant, pb.kind, pb.nested_in, pb.section, bv.verdict FROM page_block pb
        LEFT JOIN block_variant bv ON bv.block = pb.block AND bv.variant IS pb.variant WHERE pb.url_id = ? ORDER BY pb.pos`).bind(url.id).all();
      return { text: JSON.stringify({ url, blocks: blocks.results }), rows: blocks.results.length };
    }
    return { text: `Unknown tool ${name}`, rows: 0 };
  } catch (e) {
    return { text: `ERROR: ${(e as Error).message}`, rows: 0 };
  }
}

export async function chat(c: Context<{ Bindings: Env }>) {
  const env = c.env;
  const ip = c.req.header('cf-connecting-ip') ?? 'anon';
  const { success } = await env.CHAT_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: 'Too many questions in a short time. Please wait a minute.' }, 429);
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare('SELECT tokens FROM usage WHERE day = ?').bind(day).first<{ tokens: number }>();
  if (used && used.tokens > Number(env.DAILY_TOKEN_BUDGET)) return c.json({ error: 'The daily chat budget is used up. The explorer still works; chat resets at 00:00 UTC.' }, 429);

  const body = await c.req.json<{ messages: { role: 'user' | 'assistant'; content: string }[] }>();
  const history: Msg[] = (body.messages ?? []).slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') return c.json({ error: 'No question.' }, 400);
  const question = String(history[history.length - 1].content);

  const meta = await loadMeta(env.DB);
  const system = [
    { type: 'text', text: schemaDoc(meta), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Build facts: ${Object.entries(meta).map(([k, v]) => `${k}=${v}`).join('; ')}` },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (o: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
  const t0 = Date.now();

  const run = async () => {
    let tokens = 0; const sqls: string[] = []; let answer = ''; let offered = false;
    try {
      const msgs: Msg[] = [...history];
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const res = await fetch(env.FOUNDRY_ENDPOINT, {
          method: 'POST',
          headers: { 'x-api-key': env.FOUNDRY_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: env.CHAT_MODEL, max_tokens: 2000, system, tools: TOOLS, messages: msgs, stream: true }),
        });
        if (!res.ok || !res.body) { await send({ type: 'error', error: `Model error ${res.status}: ${(await res.text()).slice(0, 300)}` }); break; }
        const blocks: Block[] = []; const partial: Record<number, string> = {}; let stop = '';
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            const ev = JSON.parse(line.slice(5));
            if (ev.type === 'content_block_start') {
              blocks[ev.index] = ev.content_block.type === 'tool_use'
                ? { type: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, input: {} }
                : { type: 'text', text: '' };
              partial[ev.index] = '';
            } else if (ev.type === 'content_block_delta') {
              if (ev.delta.type === 'text_delta') {
                (blocks[ev.index] as { text: string }).text += ev.delta.text;
                answer += ev.delta.text;
                await send({ type: 'text', text: ev.delta.text });
              } else if (ev.delta.type === 'input_json_delta') partial[ev.index] += ev.delta.partial_json;
            } else if (ev.type === 'content_block_stop') {
              const b = blocks[ev.index];
              if (b?.type === 'tool_use') b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {};
            } else if (ev.type === 'message_delta') {
              stop = ev.delta.stop_reason ?? stop;
              tokens += ev.usage?.output_tokens ?? 0;
            } else if (ev.type === 'message_start') {
              const u = ev.message.usage ?? {};
              tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + Math.round((u.cache_read_input_tokens ?? 0) / 10);
            } else if (ev.type === 'error') {
              await send({ type: 'error', error: ev.error?.message ?? 'model error' });
            }
          }
        }
        const content = blocks.filter((b) => b && !(b.type === 'text' && !b.text.trim())); // the API rejects empty text blocks
        msgs.push({ role: 'assistant', content });
        if (stop !== 'tool_use') break;
        const results = [];
        for (const b of content) {
          if (b.type !== 'tool_use') continue;
          if (b.name === 'offer_view') {
            offered = true;
            await send({ type: 'offer_view', title: String(b.input.title ?? 'Custom view').slice(0, 80), description: String(b.input.description ?? '').slice(0, 300) });
            results.push({ type: 'tool_result', tool_use_id: b.id, content: 'Offered to the user as a button under your answer. Keep the chat answer short; do not repeat the offer.' });
            continue;
          }
          await send({ type: 'tool', name: b.name, why: b.input.why ?? null, sql: b.input.sql ?? null, url: b.input.url ?? null });
          const r = await runTool(env, b.name, b.input);
          if (r.sql) sqls.push(r.sql);
          await send({ type: 'tool_result', rows: r.rows, error: r.text.startsWith('ERROR') ? r.text : null });
          results.push({ type: 'tool_result', tool_use_id: b.id, content: r.text });
        }
        msgs.push({ role: 'user', content: results });
        if (turn === MAX_TURNS - 1) await send({ type: 'text', text: '\n\n_(Stopped after several lookups; try a narrower question.)_' });
      }
      // fallback auto-trigger: a long or table-heavy answer is better as a page even if the model did not offer one
      const tableRows = (answer.match(/^\|/gm) ?? []).length;
      if (!offered && (answer.length > 1200 || tableRows > 12)) {
        await send({ type: 'offer_view', title: question.replace(/\s+/g, ' ').slice(0, 60), description: 'Turn this answer into a full page with tables and charts you can keep.' });
      }
    } catch (e) {
      await send({ type: 'error', error: (e as Error).message });
    } finally {
      await send({ type: 'done' });
      await writer.close();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO usage(day, tokens, questions) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET tokens = tokens + excluded.tokens, questions = questions + 1').bind(day, tokens),
        env.DB.prepare('INSERT INTO chat_log(at, question, sql, answer, ms, tokens) VALUES (?,?,?,?,?,?)').bind(new Date().toISOString(), question.slice(0, 2000), sqls.join('\n;\n').slice(0, 8000), answer.slice(0, 8000), Date.now() - t0, tokens),
      ]);
    }
  };
  c.executionCtx.waitUntil(run());
  return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}
