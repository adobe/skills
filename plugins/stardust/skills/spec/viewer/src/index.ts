import { Hono } from 'hono';
import { chat } from './chat';
import { createView, getView, viewData } from './views';
import { answerRoute, questionsRoute, specRoute } from './spec';
import { loadMeta, parseJson } from './site';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CHAT_LIMITER: RateLimit;
  FOUNDRY_API_KEY: string;
  FOUNDRY_ENDPOINT: string;
  CHAT_MODEL: string;
  DAILY_TOKEN_BUDGET: string;
  ADMIN_TOKEN?: string;
  EDITOR_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

const all = async <T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]) =>
  (await db.prepare(sql).bind(...args).all<T>()).results;
const first = async <T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]) =>
  db.prepare(sql).bind(...args).first<T>();

// ---------- URL filters (shared by list, facets, export, and chat deep links)
type Where = { sql: string; args: unknown[] };
function urlWhere(q: URLSearchParams, skip?: string): Where {
  const w: string[] = []; const a: unknown[] = [];
  const add = (key: string, clause: string, val?: unknown) => {
    const v = q.get(key);
    if (!v || key === skip) return;
    w.push(clause); a.push(val ?? v);
  };
  const outcome = q.get('outcome') ?? 'page';
  if (outcome !== 'all' && skip !== 'outcome') { w.push('u.outcome = ?'); a.push(outcome); }
  // scope = sitemap URLs unless the caller asks for discovered URLs too (sitemap=all) or only those (sitemap=0)
  const sitemap = q.get('sitemap') ?? '1';
  if (sitemap !== 'all' && skip !== 'sitemap') { w.push('u.in_sitemap = ?'); a.push(sitemap === '0' ? 0 : 1); }
  add('template', 'u.aem_template = ?');
  add('variant', 'u.variant_code = ?');
  add('section', 'u.section = ?');
  add('traffic', 'u.traffic_band = ?');
  add('q', 'u.path LIKE ?', `%${q.get('q')}%`);
  add('flag', 'u.flag = ?');
  add('migration', 'u.needs_migration_redirect = ?', q.get('migration') === '1' ? 1 : 0);
  if (q.get('block') && skip !== 'block') {
    const bv = q.get('bvariant');
    w.push(`EXISTS (SELECT 1 FROM page_block pb WHERE pb.url_id = u.id AND pb.block = ?${bv ? ' AND pb.variant = ?' : ''})`);
    a.push(q.get('block')); if (bv) a.push(bv);
  }
  for (const b of q.getAll('has')) { // pages that need ALL of these blocks
    w.push('EXISTS (SELECT 1 FROM page_block pb WHERE pb.url_id = u.id AND pb.block = ?)'); a.push(b);
  }
  if (q.get('verdict') && skip !== 'verdict') {
    w.push(`EXISTS (SELECT 1 FROM page_block pb JOIN block_variant bv ON bv.block = pb.block AND bv.variant IS pb.variant
            WHERE pb.url_id = u.id AND pb.kind IN ('block','dynamic') AND bv.verdict = ?)`);
    a.push(q.get('verdict'));
  }
  if (q.get('feature') && skip !== 'feature') {
    // site-wide features have no page rows: every live page matches
    w.push(`(EXISTS (SELECT 1 FROM feature_page fp WHERE fp.url_id = u.id AND fp.feature_id = ?) OR EXISTS (SELECT 1 FROM feature f WHERE f.id = ? AND f.sitewide = 1))`);
    a.push(q.get('feature'), q.get('feature'));
  }
  if (q.get('nested') === '1') w.push("EXISTS (SELECT 1 FROM page_block pb WHERE pb.url_id = u.id AND pb.nested_in IS NOT NULL)");
  if (q.get('dynamic') === '1') w.push("EXISTS (SELECT 1 FROM page_block pb WHERE pb.url_id = u.id AND pb.kind = 'dynamic')");
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', args: a };
}

const SORTS: Record<string, string> = {
  views: 'u.pageviews_90d DESC, u.path', path: 'u.path', blocks: 'u.block_count DESC, u.path', template: 'u.aem_template, u.path',
};

// Site facts for the UI (names, origin, scope, telemetry availability): read once at startup.
app.get('/api/meta', async (c) => c.json({ meta: await loadMeta(c.env.DB), chatModel: c.env.CHAT_MODEL ?? null }));

app.get('/api/overview', async (c) => {
  const db = c.env.DB;
  const meta = await loadMeta(db);
  const n = async (sql: string) => Object.values((await first(db, sql)) ?? {})[0] as number;
  const outcomes = await all(db, `SELECT in_sitemap, outcome, COUNT(*) n FROM url GROUP BY 1,2`);
  const broken = await all(db, `SELECT source, kind, in_scope, COUNT(*) n, SUM(rum_views) views FROM broken GROUP BY 1,2,3`);
  const redirects = await all(db, `SELECT kind, COUNT(*) n, SUM(target_status >= 400) broken, SUM(external) external FROM redirect GROUP BY 1`);
  const verdicts = await all(db, `SELECT verdict, COUNT(*) blocks, SUM(url_count) url_refs FROM block WHERE kind != 'global' GROUP BY 1`);
  const blocks = await all(db, `SELECT name, kind, verdict, url_count, template_count, pageviews_90d FROM block ORDER BY url_count DESC`);
  const templates = await all(db, `SELECT id, label, url_count, pageviews_90d, variant_count, top_variants_share FROM template ORDER BY url_count DESC`);
  return c.json({
    meta, outcomes, broken, redirects, verdicts, blocks, templates,
    totals: {
      live: await n(`SELECT COUNT(*) FROM url WHERE outcome='page' AND in_sitemap=1`),
      views: await n(`SELECT SUM(pageviews_90d) FROM url WHERE outcome='page' AND in_sitemap=1`),
      zero_traffic: await n(`SELECT COUNT(*) FROM url WHERE outcome='page' AND in_sitemap=1 AND pageviews_90d=0`),
      templates: await n(`SELECT COUNT(*) FROM template`),
      variants: await n(`SELECT COUNT(*) FROM variant`),
      blocks: await n(`SELECT COUNT(*) FROM block WHERE kind != 'global'`),
      block_variants: await n(`SELECT COUNT(*) FROM block_variant bv JOIN block b ON b.name = bv.block WHERE b.kind != 'global'`),
      nested_pages: await n(`SELECT COUNT(DISTINCT pb.url_id) FROM page_block pb JOIN url u ON u.id = pb.url_id WHERE pb.nested_in IS NOT NULL AND u.in_sitemap = 1`),
      dynamic_pages: await n(`SELECT COUNT(DISTINCT pb.url_id) FROM page_block pb JOIN url u ON u.id = pb.url_id WHERE pb.kind='dynamic' AND u.in_sitemap = 1`),
      migration_redirects: await n(`SELECT COUNT(*) FROM redirect WHERE kind='migration'`),
      empty_pages: await n(`SELECT COUNT(*) FROM url WHERE in_sitemap=1 AND flag='empty'`),
    },
  });
});

app.get('/api/urls', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const { sql, args } = urlWhere(q);
  const limit = Math.min(Number(q.get('limit') ?? 50), 500); const offset = Number(q.get('offset') ?? 0);
  const order = SORTS[q.get('sort') ?? 'views'] ?? SORTS.views;
  const rows = await all(c.env.DB, `SELECT u.id, u.path, u.title, u.outcome, u.in_sitemap, u.aem_template, u.variant_code,
    u.block_count, u.pageviews_90d, u.traffic_band, u.final_url, u.needs_migration_redirect, u.capture_key
    FROM url u ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM url u ${sql}`, ...args))!.n;
  return c.json({ total, rows });
});

app.get('/api/facets', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const facet = async (col: string, key: string) => {
    const { sql, args } = urlWhere(q, key);
    return all(c.env.DB, `SELECT ${col} value, COUNT(*) n FROM url u ${sql} GROUP BY 1 ORDER BY n DESC`, ...args);
  };
  const bw = urlWhere(q, 'block');
  const vw = urlWhere(q, 'verdict');
  return c.json({
    outcome: await facet('u.outcome', 'outcome'),
    sitemap: await facet('u.in_sitemap', 'sitemap'),
    template: await facet('u.aem_template', 'template'),
    section: await facet('u.section', 'section'),
    traffic: await facet('u.traffic_band', 'traffic'),
    block: await all(c.env.DB, `SELECT pb.block value, COUNT(DISTINCT pb.url_id) n FROM page_block pb JOIN url u ON u.id = pb.url_id
      ${bw.sql ? `${bw.sql} AND` : 'WHERE'} pb.kind IN ('block','dynamic') GROUP BY 1 ORDER BY n DESC`, ...bw.args),
    verdict: await all(c.env.DB, `SELECT bv.verdict value, COUNT(DISTINCT pb.url_id) n FROM page_block pb
      JOIN block_variant bv ON bv.block = pb.block AND bv.variant IS pb.variant JOIN url u ON u.id = pb.url_id
      ${vw.sql ? `${vw.sql} AND` : 'WHERE'} pb.kind IN ('block','dynamic') GROUP BY 1`, ...vw.args),
    flag: await facet('u.flag', 'flag'),
  });
});

app.get('/api/urls/:id', async (c) => {
  const db = c.env.DB; const id = Number(c.req.param('id'));
  const url = await first(db, 'SELECT * FROM url WHERE id = ?', id);
  if (!url) return c.json({ error: 'not found' }, 404);
  const blocks = await all(db, `SELECT pb.*, bv.verdict, bv.examples, b.reference_block, b.description FROM page_block pb
    LEFT JOIN block_variant bv ON bv.block = pb.block AND bv.variant IS pb.variant LEFT JOIN block b ON b.name = pb.block
    WHERE pb.url_id = ? ORDER BY pb.pos`, id);
  const badLinks = await all(db, `SELECT l.to_url, l.zone, b.status broken_status, r.target redirect_target, r.target_status
    FROM link l LEFT JOIN broken b ON b.url = l.to_url LEFT JOIN redirect r ON r.src = l.to_url AND r.kind = 'legacy'
    WHERE l.from_url_id = ? GROUP BY l.to_url`, id);
  const redirects = await all(db, `SELECT * FROM redirect WHERE src = ? OR src = ? OR target = ?`, url.url, url.path, url.url);
  const variant = url.variant_code ? await first(db, 'SELECT * FROM variant WHERE code = ?', url.variant_code) : null;
  return c.json({ url, blocks, badLinks, redirects, variant });
});

app.get('/api/templates', async (c) => c.json(await all(c.env.DB, `SELECT t.*, v.rep_capture_key FROM template t
  LEFT JOIN variant v ON v.template_id = t.id AND v.rank = 1 ORDER BY t.url_count DESC`)));

app.get('/api/templates/:id', async (c) => {
  const db = c.env.DB; const id = c.req.param('id');
  const t = await first(db, 'SELECT * FROM template WHERE id = ?', id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const variants = await all(db, 'SELECT * FROM variant WHERE template_id = ? ORDER BY rank', id);
  const blocks = await all(db, `SELECT tb.block, tb.urls, b.verdict, b.kind FROM v_template_blocks tb JOIN block b ON b.name = tb.block
    WHERE tb.aem_template = ? ORDER BY tb.urls DESC`, id);
  return c.json({ template: t, variants, blocks });
});

app.get('/api/blocks', async (c) => {
  const blocks = await all(c.env.DB, 'SELECT * FROM block ORDER BY url_count DESC');
  const variants = await all(c.env.DB, 'SELECT id, block, variant, verdict, url_count, instance_count, examples FROM block_variant ORDER BY url_count DESC');
  return c.json({ blocks, variants });
});

app.get('/api/blocks/:name', async (c) => {
  const db = c.env.DB; const name = c.req.param('name');
  const block = await first(db, 'SELECT * FROM block WHERE name = ?', name);
  if (!block) return c.json({ error: 'not found' }, 404);
  const variants = await all(db, 'SELECT * FROM block_variant WHERE block = ? ORDER BY url_count DESC', name);
  const templates = await all(db, `SELECT tb.aem_template, tb.urls, t.url_count FROM v_template_blocks tb JOIN template t ON t.id = tb.aem_template
    WHERE tb.block = ? ORDER BY tb.urls DESC`, name);
  const aem = await all(db, `SELECT name, url_count, instance_count, maps_to FROM aem_component WHERE maps_to LIKE ? ORDER BY url_count DESC`, `%"${name}"%`);
  const nested = await all(db, `SELECT nested_in, COUNT(*) n FROM page_block WHERE block = ? AND nested_in IS NOT NULL GROUP BY 1`, name);
  return c.json({ block, variants, templates, aem, nested });
});

function listWhere(q: URLSearchParams, cols: Record<string, string>, search: string[]): Where {
  const w: string[] = []; const a: unknown[] = [];
  for (const [k, col] of Object.entries(cols)) { const v = q.get(k); if (v !== null && v !== '') { w.push(`${col} = ?`); a.push(v); } }
  const s = q.get('q');
  if (s) { w.push(`(${search.map((c) => `${c} LIKE ?`).join(' OR ')})`); search.forEach(() => a.push(`%${s}%`)); }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', args: a };
}

app.get('/api/redirects', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const { sql, args } = listWhere(q, { kind: 'kind', in_sitemap: 'in_sitemap', external: 'external' }, ['src', 'target']);
  const extra = q.get('broken') === '1' ? `${sql ? ' AND' : 'WHERE'} target_status >= 400` : '';
  const limit = Math.min(Number(q.get('limit') ?? 100), 1000); const offset = Number(q.get('offset') ?? 0);
  const rows = await all(c.env.DB, `SELECT * FROM redirect ${sql}${extra} ORDER BY rum_views DESC, inbound_pages DESC, src LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM redirect ${sql}${extra}`, ...args))!.n;
  const landings = q.get('kind') === 'rum' ? await all(c.env.DB, 'SELECT * FROM rum_redirect_landing ORDER BY views DESC LIMIT 300') : undefined;
  return c.json({ total, rows, landings });
});

app.get('/api/broken', async (c) => {
  const q = new URL(c.req.url).searchParams;
  const { sql, args } = listWhere(q, { source: 'source', kind: 'kind', in_scope: 'in_scope' }, ['url', 'note']);
  const limit = Math.min(Number(q.get('limit') ?? 100), 1000); const offset = Number(q.get('offset') ?? 0);
  const rows = await all(c.env.DB, `SELECT * FROM broken ${sql} ORDER BY rum_views DESC, inbound_pages DESC, url LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) n FROM broken ${sql}`, ...args))!.n;
  return c.json({ total, rows });
});

app.get('/api/linked-from', async (c) => {
  const to = c.req.query('url') ?? '';
  return c.json(await all(c.env.DB, `SELECT u.id, u.path, u.aem_template, l.zone FROM link l JOIN url u ON u.id = l.from_url_id
    WHERE l.to_url = ? ORDER BY u.pageviews_90d DESC LIMIT 500`, to));
});

// ---------- CSV export
const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
};
app.get('/api/export/:what', async (c) => {
  const q = new URL(c.req.url).searchParams; const what = c.req.param('what').replace(/\.csv$/, '');
  let rows: Record<string, unknown>[] = [];
  if (what === 'urls') {
    const { sql, args } = urlWhere(q);
    rows = await all(c.env.DB, `SELECT u.url, u.outcome, u.in_sitemap, u.aem_template, u.variant_code, u.title, u.block_count,
      (SELECT group_concat(block || COALESCE(' (' || variant || ')', ''), ' | ') FROM (SELECT DISTINCT block, variant FROM page_block pb
        WHERE pb.url_id = u.id AND pb.kind IN ('block','dynamic'))) blocks,
      u.pageviews_90d, u.eds_path, u.needs_migration_redirect FROM url u ${sql} ORDER BY u.path`, ...args);
  } else if (what === 'redirects') {
    const { sql, args } = listWhere(q, { kind: 'kind', in_sitemap: 'in_sitemap' }, ['src', 'target']);
    rows = await all(c.env.DB, `SELECT src, target, status, hops, kind, target_status, external, in_sitemap, inbound_pages, rum_views, note FROM redirect ${sql} ORDER BY src`, ...args);
  } else if (what === 'broken') {
    const { sql, args } = listWhere(q, { source: 'source', kind: 'kind', in_scope: 'in_scope' }, ['url']);
    rows = await all(c.env.DB, `SELECT url, status, source, kind, in_scope, inbound_pages, inbound_main, rum_views, note FROM broken ${sql} ORDER BY url`, ...args);
  } else if (what === 'blocks') {
    rows = await all(c.env.DB, `SELECT bv.block, bv.variant, b.kind, bv.verdict, b.reference_block, bv.url_count, bv.instance_count, bv.rationale
      FROM block_variant bv JOIN block b ON b.name = bv.block ORDER BY b.url_count DESC, bv.url_count DESC`);
  } else if (what === 'page-blocks') {
    rows = await all(c.env.DB, `SELECT u.path, u.aem_template, u.variant_code, pb.pos, pb.block, pb.variant, pb.kind, pb.nested_in
      FROM page_block pb JOIN url u ON u.id = pb.url_id WHERE pb.kind != 'default' ORDER BY u.path, pb.pos`);
  } else if (what === 'launch-rules') {
    rows = await all(c.env.DB, `SELECT id, name, vendor, kind, needs_rewrite, live_pages, path_values, eds_paths, selectors FROM launch_rule ORDER BY needs_rewrite DESC, vendor, name`);
  } else if (what === 'features') {
    rows = await all(c.env.DB, `SELECT id, class, class_name, name, disposition, reproducibility, status, pattern, sitewide, reach_pages, reach_templates, decisions, eds, evidence FROM feature`);
  } else if (what === 'open-questions') {
    rows = await all(c.env.DB, `SELECT q.id, q.area, q.owner, q.blocking, q.question, q.context, q.options, q.default_assumption, q.impact,
      (SELECT answer FROM question_answer a WHERE a.question_id = q.id ORDER BY a.id DESC LIMIT 1) answer,
      (SELECT answered_by FROM question_answer a WHERE a.question_id = q.id ORDER BY a.id DESC LIMIT 1) answered_by FROM open_question q ORDER BY q.blocking DESC, q.id`);
  } else return c.text('unknown export', 404);
  return new Response(csv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="spec-${what}.csv"` } });
});

app.post('/api/chat', (c) => chat(c));

// ---------- implementation layer + migration spec
app.get('/api/spec.json', (c) => specRoute(c));
app.get('/api/spec.md', (c) => specRoute(c));
app.get('/api/questions', (c) => questionsRoute(c));
app.post('/api/questions/:id/answer', (c) => answerRoute(c));
app.get('/api/features', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM feature ORDER BY sitewide DESC, reach_pages DESC')));
app.get('/api/features/:id', async (c) => {
  const f = await first(c.env.DB, 'SELECT * FROM feature WHERE id = ?', c.req.param('id'));
  if (!f) return c.json({ error: 'not found' }, 404);
  const templates = await all(c.env.DB, `SELECT u.aem_template, COUNT(*) n FROM feature_page fp JOIN url u ON u.id = fp.url_id WHERE fp.feature_id = ? GROUP BY 1 ORDER BY n DESC`, f.id);
  const questions = await all(c.env.DB, `SELECT id, question, owner, blocking FROM open_question WHERE features LIKE ?`, `%"${f.id}"%`);
  return c.json({ feature: f, templates, questions });
});
app.get('/api/martech', async (c) => c.json({
  vendors: await all(c.env.DB, 'SELECT * FROM vendor ORDER BY seen_pages DESC'),
  rules: await all(c.env.DB, 'SELECT id, name, vendor, kind, html_paths, needs_rewrite, live_pages, path_values, eds_paths, selectors FROM launch_rule ORDER BY kind, vendor, name'),
  datalayer: await all(c.env.DB, 'SELECT * FROM datalayer_field ORDER BY group_name, path'),
}));
app.get('/api/locales', async (c) => c.json({
  notes: parseJson<string[]>((await first<{ value: string }>(c.env.DB, `SELECT value FROM meta WHERE key='i18n_notes'`))?.value, []),
  trees: await all(c.env.DB, 'SELECT * FROM locale_tree ORDER BY rum_views_90d DESC'),
}));
app.get('/api/indexes', async (c) => c.json({
  indexes: await all(c.env.DB, 'SELECT * FROM query_index'),
  metadata: await all(c.env.DB, 'SELECT * FROM metadata_field'),
  probes: await all(c.env.DB, 'SELECT * FROM search_probe'),
}));
app.get('/api/site-config', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM site_config')));
app.post('/api/views', (c) => createView(c));
app.get('/api/views/:id', (c) => getView(c));
app.get('/api/views/:id/data', (c) => viewData(c));

// media loading: active only while the ADMIN_TOKEN secret exists (deleted after each data load)
app.put('/api/admin/media/*', async (c) => {
  if (!c.env.ADMIN_TOKEN || c.req.header('x-admin-token') !== c.env.ADMIN_TOKEN) return c.notFound();
  const key = c.req.path.replace(/^\/api\/admin\/media\//, '');
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: c.req.header('content-type') || (key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp') } });
  return c.json({ ok: true, key });
});

app.get('/media/*', async (c) => {
  const key = c.req.path.replace(/^\/media\//, '');
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? (key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp'), 'cache-control': 'public, max-age=604800, immutable' } });
});

export default app;
