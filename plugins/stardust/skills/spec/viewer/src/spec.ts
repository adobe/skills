// Migration spec: generated live from D1 so recorded answers to open questions flow into every export.
// /api/spec.json is the machine contract for an autonomous migration agent (stardust-shaped sections);
// /api/spec.md is the same content for people. Answers: POST /api/questions/:id/answer with x-editor-key.
import type { Context } from 'hono';
import type { Env } from './index';
import { loadMeta, loadingOrder, siteFacts } from './site';

const SPEC_VERSION = '1.0';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1 rows are untyped JSON
type Row = any;

const all = async (db: D1Database, sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<Row>()).results;
const one = async (db: D1Database, sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<Row>();
const J = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return s; } };

export async function buildSpec(db: D1Database) {
  const meta = await loadMeta(db);
  const site = siteFacts(meta);
  const n = async (sql: string) => Object.values((await one(db, sql)) ?? {})[0] as number;
  const answers = await all(db, `SELECT a.* FROM question_answer a JOIN (SELECT question_id, MAX(id) id FROM question_answer GROUP BY 1) l ON l.id = a.id`);
  const answerOf = Object.fromEntries(answers.map((a) => [a.question_id, a]));
  const questions = (await all(db, 'SELECT * FROM open_question ORDER BY blocking DESC, owner DESC, id')).map((q) => ({
    ...q, blocking: !!q.blocking, options: J(q.options), features: J(q.features),
    status: answerOf[q.id] ? 'answered' : 'open', answer: answerOf[q.id] ?? null,
    effective: answerOf[q.id]?.answer ?? q.default_assumption,
  }));

  const templates = await all(db, 'SELECT id, label, url_count, pageviews_90d, variant_count FROM template ORDER BY url_count DESC');
  const archetypes = [];
  for (const t of templates) {
    const vs = await all(db, 'SELECT code, rank, label, url_count, rep_url, core, optional FROM variant WHERE template_id = ? ORDER BY rank', t.id);
    let cum = 0;
    for (const v of vs) {
      archetypes.push({ template: t.id, variant: v.code, pages: v.url_count, blocks: J(v.core), optional: J(v.optional), representative: v.rep_url });
      cum += v.url_count;
      if (cum / t.url_count >= 0.8) break;
    }
  }
  const blocks = await all(db, 'SELECT name, kind, description, reference_block, verdict, rationale, url_count, instance_count, template_count FROM block ORDER BY url_count DESC');
  const bvariants = await all(db, 'SELECT block, variant, verdict, url_count, rationale FROM block_variant ORDER BY url_count DESC');
  const nested = await all(db, `SELECT pb.block, pb.nested_in, COUNT(DISTINCT pb.url_id) pages FROM page_block pb JOIN url u ON u.id = pb.url_id
    WHERE pb.nested_in IS NOT NULL AND u.in_sitemap = 1 GROUP BY 1, 2`);
  const features = (await all(db, 'SELECT * FROM feature ORDER BY sitewide DESC, reach_pages DESC')).map((f) => ({ ...f, decisions: J(f.decisions), sitewide: !!f.sitewide }));
  const rules = await all(db, 'SELECT * FROM launch_rule');
  const vendors = await all(db, 'SELECT * FROM vendor ORDER BY seen_pages DESC');

  return {
    specVersion: SPEC_VERSION,
    generatedAt: new Date().toISOString(),
    site: { name: site.name, origin: site.origin || null, scope: site.scopePath, builtAt: meta.built_at ?? null, rumAvailable: site.rum, rumWindow: site.rum ? meta.rum_window ?? null : null, method: meta.built_by ?? null, referenceBlocks: site.refName ? { name: site.refName, count: site.refCount } : null },
    scope: {
      sitemapUrls: Number(meta.sitemap_urls) || await n(`SELECT COUNT(*) FROM url WHERE in_sitemap=1`),
      livePages: await n(`SELECT COUNT(*) FROM url WHERE outcome='page' AND in_sitemap=1`),
      noTrafficPages: site.rum ? await n(`SELECT COUNT(*) FROM url WHERE outcome='page' AND in_sitemap=1 AND COALESCE(pageviews_90d, 0)=0`) : null,
      emptyPages: await n(`SELECT COUNT(*) FROM url WHERE in_sitemap=1 AND flag='empty'`),
      thankYouPages: await n(`SELECT COUNT(*) FROM url WHERE in_sitemap=1 AND flag='thank-you'`),
      liveNotInSitemap: await n(`SELECT COUNT(*) FROM url WHERE outcome='page' AND in_sitemap=0`),
      rosterCsv: '/api/export/urls.csv', pageBlocksCsv: '/api/export/page-blocks.csv',
    },
    archetypePlan: { rule: 'one archetype per layout variant until 80% of each template is covered; siblings follow their variant', archetypes },
    blockBacklog: blocks.map((b) => ({ ...b, aem: undefined, variants: bvariants.filter((v) => v.block === b.name), nested: nested.filter((x) => x.block === b.name) })),
    metadataContract: (await all(db, 'SELECT * FROM metadata_field')).map((m) => ({ ...m, used_by: J(m.used_by), top_values: J(m.top_values) })),
    queryIndexes: {
      indexes: (await all(db, 'SELECT * FROM query_index')).map((q) => ({ ...q, include_paths: J(q.include_paths), exclude_paths: J(q.exclude_paths), properties: J(q.properties), consumers: J(q.consumers) })),
      helixQueryYaml: `version: 1\nindices:\n${(await all(db, 'SELECT yaml FROM query_index')).map((r) => r.yaml).join('\n')}\n`,
    },
    dynamicFeatures: {
      taxonomy: 'stardust:dynamics classes L S F M V T A R X I18N CR D; dispositions; reproducibility',
      features,
      decisionBatch: features.filter((f) => f.reproducibility !== 'self').map((f) => ({ feature: f.id, needs: f.reproducibility, decisions: f.decisions })),
    },
    martech: {
      loadingOrder: loadingOrder(meta).map((x) => `${x.stage}: ${x.what}`),
      consent: meta.consent_summary ?? null,
      launch: {
        rules: rules.length,
        needsRewrite: rules.filter((r) => r.needs_rewrite).length,
        campaignRulesWithDeadTarget: rules.filter((r) => r.kind === 'campaign' && !r.live_pages).length,
        rewriteSheet: rules.filter((r) => r.needs_rewrite).map((r) => ({ id: r.id, name: r.name, vendor: r.vendor, oldPaths: J(r.path_values), edsPaths: J(r.eds_paths), selectors: J(r.selectors), livePages: r.live_pages })),
      },
      dataLayer: (await all(db, 'SELECT * FROM datalayer_field')).map((f) => ({ ...f, data_elements: J(f.data_elements) })),
      vendors,
    },
    i18n: {
      notes: J(meta.i18n_notes ?? '[]'),
      trees: await all(db, 'SELECT * FROM locale_tree ORDER BY rum_views_90d DESC'),
    },
    siteConfig: await all(db, 'SELECT * FROM site_config'),
    redirects: {
      legacy: await n(`SELECT COUNT(*) FROM redirect WHERE kind='legacy'`),
      migration: await n(`SELECT COUNT(*) FROM redirect WHERE kind='migration'`),
      legacyIntoBroken: await n(`SELECT COUNT(*) FROM redirect WHERE kind='legacy' AND target_status >= 400`),
      realUser404s: site.rum ? await n(`SELECT COUNT(*) FROM broken WHERE source='rum'`) : null,
      csv: '/api/export/redirects.csv',
    },
    parity: { searchProbes: (await all(db, 'SELECT * FROM search_probe')).map((p) => ({ ...p, expect_titles: J(p.expect_titles) })) },
    openQuestions: questions,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function specMarkdown(s: Awaited<ReturnType<typeof buildSpec>>) {
  const L: string[] = [];
  const t = (head: string[], rows: unknown[][]) => { L.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`), ''); };
  const target = s.site.origin ? `${s.site.origin.replace(/^https?:\/\//, '')}${s.site.scope === '/' ? '' : s.site.scope.replace(/\/$/, '')}` : s.site.name;
  L.push(`# Migration spec: \`${target}\` to Edge Delivery Services`, '',
    `Spec ${s.specVersion} · generated ${s.generatedAt.slice(0, 16).replace('T', ' ')} UTC · scope built ${String(s.site.builtAt ?? 'n/a').slice(0, 10)} · telemetry ${s.site.rumAvailable ? s.site.rumWindow ?? 'available' : 'not available'}`, '',
    '> Generated from the scope database. Each open question shows its effective decision: the recorded answer if there is one, otherwise the default assumption a hands-off migration ships.', '');
  const open = s.openQuestions.filter((q) => q.status === 'open');
  const chrome = s.blockBacklog.filter((b) => b.kind === 'global').map((b) => b.name);
  const scopeTree = s.site.scope.replace(/^\/|\/$/g, '');
  L.push('## 1. Summary', '',
    `- ${(s.scope.livePages ?? 0).toLocaleString('en-US')} live pages to migrate (of ${(s.scope.sitemapUrls ?? 0).toLocaleString('en-US')} sitemap URLs); ${s.scope.noTrafficPages === null ? '' : `${s.scope.noTrafficPages} with no traffic in 90 days, `}${s.scope.emptyPages} empty.`,
    `- ${s.archetypePlan.archetypes.length} archetypes (layout variants) cover at least 80% of every template.`,
    `- ${s.blockBacklog.filter((b) => b.kind !== 'global').length} blocks: ${['reuse', 'variant', 'new'].map((v) => `${s.blockBacklog.filter((b) => b.verdict === v && b.kind !== 'global').length} ${v}`).join(', ')}${chrome.length ? `; plus site chrome: ${chrome.join(', ')}` : ''}.`,
    `- ${s.dynamicFeatures.features.length} dynamic features; ${s.dynamicFeatures.decisionBatch.length} need something external (decision batch).`,
    `- Martech: ${s.martech.launch.rules} Launch rules, ${s.martech.launch.needsRewrite} need path/selector rewrites; ${s.martech.dataLayer.length} data-layer fields to emit.`,
    `- Redirects: ${s.redirects.migration} created by the migration, ${s.redirects.legacy} existing (${s.redirects.legacyIntoBroken} into a 404)${s.redirects.realUser404s === null ? '' : `; ${s.redirects.realUser404s} real-user 404s`}.`,
    `- Open questions: ${s.openQuestions.length} (${s.openQuestions.filter((q) => q.blocking).length} blocking, ${open.length} still open).`, '');

  L.push('## 2. Open questions and decision batch', '');
  for (const owner of ['stakeholder', 'implementer']) {
    L.push(`### For the ${owner === 'stakeholder' ? 'stakeholder' : 'implementer (migration team or agent)'}`, '');
    t(['ID', 'Area', 'Question', 'Blocking', 'Impact', 'Effective decision', 'Status'],
      s.openQuestions.filter((q) => q.owner === owner).map((q) => [q.id, q.area, q.question, q.blocking ? 'yes' : 'no', q.impact ?? '', q.effective, q.status === 'answered' ? `answered by ${q.answer.answered_by}` : 'open (default applies)']));
  }

  L.push('## 3. Archetype plan', '', s.archetypePlan.rule, '');
  t(['Template', 'Variant', 'Pages', 'Core blocks', 'Representative'], s.archetypePlan.archetypes.map((a) => [a.template, a.variant, a.pages, (a.blocks ?? []).join(', ') || 'default content', a.representative]));

  L.push('## 4. Block backlog', '');
  t(['Block', 'Kind', 'Verdict', s.site.referenceBlocks ? `${s.site.referenceBlocks.name} block` : 'Reference block', 'Pages', 'Variants'], s.blockBacklog.map((b) => [b.name, b.kind, b.verdict, b.reference_block ?? '—', b.url_count, b.variants.map((v: Row) => `${v.variant ?? 'default'} (${v.url_count}, ${v.verdict})`).join('; ')]));

  L.push('## 5. Metadata contract', '', 'Every page emits these metadata fields; they feed the data layer, the query indexes, tag links and any access gates.', '');
  t(['Field', 'Source', 'Used by', 'Pages with a value', 'Distinct values'], s.metadataContract.map((m) => [m.name, m.aem_source, (m.used_by ?? []).join(', '), m.coverage_pages ?? '', m.distinct_values ?? '']));

  L.push('## 6. Query indexes', '');
  t(['Index', 'Include', 'Filter', 'Properties', 'Consumers'], s.queryIndexes.indexes.map((q) => [q.name, q.include_paths.join(', '), q.filter ?? '', q.properties.join(', '), q.consumers.join(', ')]));
  L.push('```yaml', s.queryIndexes.helixQueryYaml, '```', '');

  L.push('## 7. Dynamic features', '', `Taxonomy: ${s.dynamicFeatures.taxonomy}.`, '');
  t(['Feature', 'Class', 'Reach', 'Disposition', 'Reproducibility', 'Pattern', 'Implementation on EDS', 'Decisions'],
    s.dynamicFeatures.features.map((f) => [f.name, f.class, f.sitewide ? 'site-wide' : `${f.reach_pages} pages`, f.disposition, f.reproducibility, f.pattern, f.eds, (f.decisions ?? []).join(', ')]));

  L.push('## 8. Martech', '', '### Loading order', '', ...s.martech.loadingOrder.map((x) => `1. ${x}`), '',
    ...(s.martech.consent ? ['### Consent', '', s.martech.consent, ''] : []),
    `### Adobe Launch`, '', `${s.martech.launch.rules} rules; ${s.martech.launch.needsRewrite} match .html page paths or DOM selectors and must be rewritten; ${s.martech.launch.campaignRulesWithDeadTarget} campaign rules target pages that no longer exist (candidates to retire). The rewrite sheet is in spec.json (martech.launch.rewriteSheet).`, '',
    '### Data-layer contract', '');
  t(['Field', 'Group', 'EDS source', 'Launch data elements'], s.martech.dataLayer.map((f) => [f.path, f.group_name, f.eds_source, (f.data_elements ?? []).join('; ')]));
  L.push('### Vendors', '');
  t(['Host', 'Role', 'Seen on probed pages', 'Loaded via', 'In CSP', 'Consent group'], s.martech.vendors.map((v) => [v.host, v.role, v.seen_pages, v.via, v.in_csp ? 'yes' : 'no', v.consent_group ?? '']));

  L.push('## 9. Multi-language', '', ...(s.i18n.notes ?? []).map((x: string) => `- ${x}`), '');
  t(['Tree', 'URLs', `Shared paths with ${s.site.scope}`, ...(s.site.rumAvailable ? ['Views 90d'] : []), 'Deep-sampled'], s.i18n.trees.slice(0, 40).map((x) => [x.tree, x.urls, x.tree === scopeTree ? '—' : `${x.shared_with_scope} (${x.shared_pct}%)`, ...(s.site.rumAvailable ? [x.rum_views_90d] : []), x.deep_sampled ? `yes: ${x.live_pages} live, ${x.templates} templates, ${x.blocks} blocks` : '']));

  L.push('## 10. Site configuration', '');
  t(['Item', 'Today', 'On EDS', 'Decision'], s.siteConfig.map((c) => [c.key, c.now, c.eds, c.decision ?? '']));

  L.push('## 11. Redirects and parity', '', `Redirect sheet: ${s.redirects.csv}. Roster: ${s.scope.rosterCsv}. Per-page blocks: ${s.scope.pageBlocksCsv}.`, '', 'Search parity probes (expected on the source):', '');
  t(['Term', 'Expected count', 'Top titles'], s.parity.searchProbes.map((p) => [p.term, p.expect_count, (p.expect_titles ?? []).join(' · ')]));
  return L.join('\n');
}

export async function specRoute(c: Context<{ Bindings: Env }>) {
  const s = await buildSpec(c.env.DB);
  if (c.req.path.endsWith('.md')) {
    return new Response(specMarkdown(s), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': c.req.query('download') ? 'attachment; filename="MIGRATION-SPEC.md"' : 'inline' } });
  }
  return new Response(JSON.stringify(s, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', ...(c.req.query('download') ? { 'content-disposition': 'attachment; filename="migration-spec.json"' } : {}) } });
}

export async function answerRoute(c: Context<{ Bindings: Env }>) {
  if (!c.env.EDITOR_KEY || c.req.header('x-editor-key') !== c.env.EDITOR_KEY) return c.json({ error: 'An editor key is required to record decisions.' }, 403);
  const id = c.req.param('id');
  const q = await one(c.env.DB, 'SELECT id FROM open_question WHERE id = ?', id);
  if (!q) return c.json({ error: 'unknown question' }, 404);
  const body = await c.req.json<{ answer: string; option?: string; by: string }>();
  if (!body.answer?.trim() || !body.by?.trim()) return c.json({ error: 'answer and by are required' }, 400);
  await c.env.DB.prepare('INSERT INTO question_answer(question_id, answer, decided_option, answered_by, answered_at) VALUES (?,?,?,?,?)')
    .bind(id, body.answer.slice(0, 4000), body.option?.slice(0, 300) ?? null, body.by.slice(0, 120), new Date().toISOString()).run();
  return c.json({ ok: true });
}

export async function questionsRoute(c: Context<{ Bindings: Env }>) {
  const s = await buildSpec(c.env.DB);
  return c.json(s.openQuestions);
}
