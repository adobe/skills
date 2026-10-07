import { Link } from '@react-spectrum/s2/Link';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fmt, fmtViews, pct } from '../api';
import { BarList, MetricGrid, type Metric } from '../custom';
import { RichHtml, rich } from '../richtext';
import { useSite } from '../site';
import { Columns, Legend, Loading, PageHeader, Section, Stack, useApi } from '../ui';

export default function Overview() {
  const { data } = useApi('/api/overview');
  const site = useSite();
  if (!data) return <Loading />;
  const t = data.totals; const m = data.meta;
  const sitemap = data.outcomes.filter((o: any) => o.in_sitemap === 1);
  const sm = (o: string) => sitemap.find((x: any) => x.outcome === o)?.n ?? 0;
  const v = (k: string) => data.verdicts.find((x: any) => x.verdict === k)?.blocks ?? 0;
  const br = (src: string, us = 1) => data.broken.filter((b: any) => b.source === src && (us === -1 || b.in_scope === us)).reduce((a: number, b: any) => a + b.n, 0);
  const findings: string[] = site.json<string[]>('findings', []).filter((f) => typeof f === 'string');
  const sitemapUrls = Number(m.sitemap_urls) || sitemap.reduce((a: number, o: any) => a + o.n, 0);
  const blocks = data.blocks.filter((b: any) => b.kind !== 'global');
  const redirecting = sm('redirect') + sm('redirect-broken') + sm('redirect-external') + sm('loop');

  const size: Metric[] = [
    { id: 'live', label: 'Live pages to migrate', value: fmt(t.live), note: `of ${fmt(sitemapUrls)} sitemap URLs`, href: '/urls?sitemap=1' },
    { id: 'templates', label: 'Templates / layout variants', value: `${t.templates} / ${t.variants}`, note: 'Plan and QA by variant', href: '/templates' },
    { id: 'blocks', label: 'EDS blocks proposed', value: t.blocks, note: `${v('reuse')} reuse · ${v('variant')} variant · ${v('new')} new`, href: '/blocks' },
    ...(site.rum ? [{ id: 'views', label: 'Page views, 90 days', value: fmtViews(t.views), note: 'Estimate, human views on live pages', href: '/urls?sort=views' }] : []),
  ];
  const risks: Metric[] = [
    { id: 'redirecting', label: 'Sitemap URLs that redirect', value: fmt(redirecting), note: `${sm('redirect-broken')} into a 404 · ${sm('redirect-external')} off-site · ${sm('loop')} loop`, href: '/redirects?kind=legacy&in_sitemap=1' },
    { id: 'migration', label: 'Redirects the move creates', value: fmt(t.migration_redirects), note: 'Paths that change beyond .html', href: '/redirects?kind=migration' },
    site.rum
      ? { id: 'rum404', label: '404s hit by real users', value: fmt(br('rum')), note: `Plus ${fmt(br('link'))} dead links in pages`, href: '/broken?source=rum', tone: 'negative' }
      : { id: 'links404', label: 'Dead links in pages', value: fmt(br('link')), note: `${fmt(br('sitemap', -1))} sitemap URLs end in a 404`, href: '/broken?source=link', tone: 'negative' },
    { id: 'nested', label: 'Blocks inside tabs or accordions', value: fmt(t.nested_pages), note: 'Pages that need fragments', href: '/urls?nested=1' },
    { id: 'dynamic', label: 'Data-driven blocks', value: fmt(t.dynamic_pages), note: 'Pages with grids, lists, apps', href: '/urls?dynamic=1' },
    ...(site.rum ? [{ id: 'zero', label: 'No sampled traffic', value: fmt(t.zero_traffic), note: `${pct(t.zero_traffic, t.live)} of live pages: retire?`, href: '/urls?sitemap=1&traffic=none' }] : []),
    { id: 'empty', label: 'Empty pages', value: fmt(t.empty_pages), note: 'Header and footer only', href: '/urls?flag=empty' },
  ];

  return (
    <Stack>
      <PageHeader
        title="Overview"
        description={`${site.scopeLabel} to Edge Delivery Services.${m.built_at ? ` Built ${String(m.built_at).slice(0, 10)}` : ' Built'} from ${fmt(sitemapUrls)} sitemap URLs${site.rum ? `, a full link check, and ${m.rum_window ?? '90 days'} of real-user telemetry (${fmt(Number(m.rum_bundles) || 0)} sampled views).` : ' and a full link check. Real-user telemetry was not available.'}`} />

      <Section id="size" title="Size of the migration" description="What has to be built and moved. Each number opens the rows behind it."
        ask={['How many pages of the largest template need only reused or variant blocks?', 'Which new blocks unlock the most pages? Rank them.']}>
        <MetricGrid label="Size of the migration" items={size} />
      </Section>

      <Section id="risks" title="Risks and clean-up" description="Redirects, broken links and content that needs a decision before or during the move."
        ask={site.rum ? ['Which 404s do real users hit most, and where do they come from?', 'How many pages with no traffic could be retired, by template?'] : ['Which dead links appear on the most pages?', 'Which sitemap URLs redirect into a 404?']}>
        <MetricGrid label="Risks and clean-up" items={risks} />
      </Section>

      {findings.length > 0 && (
        <Section id="findings" title="What this scope says" count={findings.length}>
          <ul className={rich.ul}>
            {/* findings are authored HTML snippets from the scoping pipeline */}
            {findings.map((f, i) => <li key={i} className={style({ font: 'body-sm' })}><RichHtml html={f} /></li>)}
          </ul>
        </Section>
      )}

      <Columns>
        <Section id="blocks" title="Blocks by pages" count={blocks.length} description="Build once, reuse on many pages."
          ask={['Which URLs use the tabs block, and on which templates?']}>
          <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
            <Legend />
            <BarList label="Blocks by pages" rows={blocks.map((b: any) => ({ id: b.name, label: b.name, textValue: b.name, value: b.url_count, tone: b.verdict, href: `/blocks/${b.name}`, right: fmt(b.url_count) }))} />
          </div>
        </Section>
        <Stack>
          <Section id="templates" title="Templates by pages" count={data.templates.length} description={site.rum ? 'Live pages and page views in 90 days.' : 'Live pages per template.'}>
            <BarList label="Templates by pages" rows={data.templates.map((tp: any) => ({ id: tp.id, label: `${tp.label} · ${tp.variant_count} var.`, textValue: tp.label, value: tp.url_count, href: `/templates/${encodeURIComponent(tp.id)}`, right: site.rum ? `${fmt(tp.url_count)} · ${fmtViews(tp.pageviews_90d)}` : fmt(tp.url_count) }))} />
          </Section>
          <Section id="outcomes" title="Sitemap URLs today" description="What each sitemap URL returns on the current site now.">
            <BarList label="Sitemap URLs by outcome" rows={[...sitemap].sort((a: any, b: any) => b.n - a.n).map((o: any) => ({ id: o.outcome, label: o.outcome, textValue: o.outcome, value: o.n, href: `/urls?sitemap=1&outcome=${o.outcome}` }))} />
          </Section>
          <p className={style({ font: 'body-xs', color: 'neutral-subdued', margin: 0, paddingX: 8 })}>
            Block mapping and reuse verdicts are a proposal made by the scoping agent. See <Link href="/about">method and caveats</Link>.
          </p>
        </Stack>
      </Columns>
    </Stack>
  );
}
