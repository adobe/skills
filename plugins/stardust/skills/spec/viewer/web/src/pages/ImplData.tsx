// Martech, multi-language, and data & config pages of the implementation layer.
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@react-spectrum/s2/Badge';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { Tabs, TabList, Tab, TabPanel } from '@react-spectrum/s2/Tabs';
import { ToggleButtonGroup, ToggleButton } from '@react-spectrum/s2/ToggleButtonGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt, fmtViews } from '../api';
import { BarList, MetricGrid, Panel, type Metric } from '../custom';
import { rich } from '../richtext';
import { useSite } from '../site';
import { loadingOrder } from '../../../src/site';
import { BodyText, Code, Detail, EmptyState, Loading, PageHeader, PathText, Section, Stack, pagedTable, useApi } from '../ui';

const parse = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return s; } };
const list = (s: unknown) => ((parse(s) as unknown[]) ?? []).filter(Boolean).join(', ');
const crumbs = [{ label: 'Implementation', href: '/implementation' }];
const tabPanel = style({ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 });


/* ---------- martech ---------- */

export function Martech() {
  const { data } = useApi<any>('/api/martech');
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const rewriteOnly = params.get('rewrite') === '1';
  if (!data) return <Loading />;
  const rules: any[] = data.rules; const dl: any[] = data.datalayer; const vendors: any[] = data.vendors;
  const metrics: Metric[] = [
    { id: 'rules', label: 'Launch rules', value: rules.length, note: `${rules.filter((r) => r.kind === 'campaign').length} campaign · ${rules.filter((r) => r.kind === 'acdl').length} data layer · ${rules.filter((r) => r.kind === 'global').length} global`, href: '/martech?tab=rules' },
    { id: 'rewrite', label: 'Need a rewrite', value: rules.filter((r) => r.needs_rewrite).length, note: 'Match .html paths or DOM selectors', href: '/martech?tab=rules&rewrite=1', tone: 'negative' },
    { id: 'dead', label: 'Campaign rules on dead pages', value: rules.filter((r) => r.kind === 'campaign' && !r.live_pages).length, note: 'Candidates to retire', href: '/martech?tab=rules&rewrite=1' },
    { id: 'dl', label: 'Data-layer fields', value: dl.length, note: 'Read by Launch data elements', href: '/martech?tab=datalayer' },
    { id: 'vendors', label: 'Third-party hosts', value: vendors.length, note: `${vendors.filter((v) => v.in_csp).length} in the CSP allow-list`, href: '/martech?tab=vendors' },
  ];
  const shown = rewriteOnly ? rules.filter((r) => r.needs_rewrite) : rules;
  const setTab = (t: string) => setParams(new URLSearchParams({ tab: t }));
  const order = loadingOrder(site.meta);
  const consent = site.meta.consent_summary?.trim();
  const mapped = vendors.filter((v) => v.consent_group).length;
  return (
    <Stack>
      <PageHeader crumbs={crumbs} title="Martech"
        description="Tag management, consent, analytics and pixels as configured today (tag manager property, consent platform, data layer), and what changes when the pages move to EDS."
        actions={<LinkButton variant="secondary" size="S" href="/api/export/launch-rules.csv" download><Download /><Text>Launch rewrite sheet</Text></LinkButton>} />
      <Tabs aria-label="Martech" selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
        <TabList>
          <Tab id="overview">Overview</Tab><Tab id="rules">Launch rules</Tab><Tab id="datalayer">Data layer</Tab><Tab id="vendors">Vendors</Tab>
        </TabList>
        <TabPanel id="overview">
          <div className={tabPanel}>
            <MetricGrid label="Martech at a glance" items={metrics} />
            <Section id="loading-order" title="Loading order on EDS" description="Consent first, analytics data next, tag manager after the largest paint, heavy vendors on demand.">
              <ol className={rich.ol}>
                {order.map((s) => <li key={s.stage}><strong className={rich.strong}>{s.stage}.</strong> {s.what}</li>)}
              </ol>
            </Section>
            <Section id="consent" title="Consent" ask={['How is cookie consent implemented today, and how should it load on EDS?']}>
              <BodyText>{consent || `No consent summary was recorded for this scope. ${mapped} of ${vendors.length} third-party hosts are mapped to a consent category; see the Vendors tab.`}</BodyText>
            </Section>
          </div>
        </TabPanel>
        <TabPanel id="rules">
          <div className={tabPanel}>
            <ToggleButtonGroup aria-label="Rule filter" size="S" selectionMode="single" selectedKeys={rewriteOnly ? ['rewrite'] : []}
              onSelectionChange={(k) => setParams(new URLSearchParams({ tab: 'rules', ...(k.has('rewrite') ? { rewrite: '1' } : {}) }))}>
              <ToggleButton id="rewrite">Needs a rewrite only</ToggleButton>
            </ToggleButtonGroup>
            <Section id="rule-list" title="Launch rules" count={shown.length} flush ask={['Which Launch rules break when the URLs lose .html, by vendor?']}>
              <TableView aria-labelledby="rule-list-title" isQuiet density="compact" overflowMode="wrap" styles={pagedTable}>
                <TableHeader>
                  <Column id="name" isRowHeader minWidth={240}>Rule</Column>
                  <Column id="vendor" width={112}>Vendor</Column>
                  <Column id="kind" width={96}>Kind</Column>
                  <Column id="paths" minWidth={360}>Page condition today, then on EDS</Column>
                  <Column id="status" width={136}>Status</Column>
                </TableHeader>
                <TableBody items={shown} renderEmptyState={() => <EmptyState title="No rules" />}>
                  {(r: any) => {
                    const old = (parse(r.path_values) as string[]) ?? []; const eds = (parse(r.eds_paths) as (string | null)[]) ?? [];
                    return (
                      <Row id={r.id} textValue={r.name}>
                        <Cell><span className={style({ font: 'ui-sm' })}>{r.name}</span></Cell>
                        <Cell>{r.vendor}</Cell>
                        <Cell>{r.kind}</Cell>
                        <Cell>{old.length ? old.slice(0, 2).map((p, i) => (
                          <div key={i} className={style({ display: 'flex', flexDirection: 'column', paddingY: 2 })}><PathText>{p}</PathText><Detail>{`on EDS: ${eds[i] ?? 'no live page'}`}</Detail></div>
                        )) : <Detail>All pages</Detail>}{old.length > 2 && <Detail>{`and ${old.length - 2} more`}</Detail>}</Cell>
                        <Cell>{r.needs_rewrite ? <Badge size="S" variant="negative" fillStyle="subtle">{r.kind === 'campaign' && !r.live_pages ? 'Target page gone' : 'Rewrite'}</Badge> : <Badge size="S" variant="positive" fillStyle="subtle">Unchanged</Badge>}</Cell>
                      </Row>
                    );
                  }}
                </TableBody>
              </TableView>
            </Section>
          </div>
        </TabPanel>
        <TabPanel id="datalayer">
          <div className={tabPanel}>
            <BodyText>Tag manager data elements read these data-layer fields. The current site seeds them from page attributes; on EDS a data-layer script builds the page fields from metadata and blocks push the interaction events with the same names.</BodyText>
            <Section id="dl-list" title="Data-layer contract" count={dl.length} flush>
              <TableView aria-labelledby="dl-list-title" isQuiet density="compact" overflowMode="wrap" styles={pagedTable}>
                <TableHeader>
                  <Column id="path" isRowHeader minWidth={260}>Field</Column>
                  <Column id="group" width={140}>Group</Column>
                  <Column id="eds" minWidth={220}>Source on EDS</Column>
                  <Column id="elements" minWidth={220}>Launch data elements</Column>
                </TableHeader>
                <TableBody items={dl.map((f) => ({ ...f, id: f.path }))}>
                  {(f: any) => (
                    <Row id={f.path} textValue={f.path}>
                      <Cell><Code>{f.path}</Code></Cell><Cell>{f.group_name}</Cell><Cell>{f.eds_source}</Cell><Cell><Detail>{list(f.data_elements)}</Detail></Cell>
                    </Row>
                  )}
                </TableBody>
              </TableView>
            </Section>
          </div>
        </TabPanel>
        <TabPanel id="vendors">
          <div className={tabPanel}>
            <Section id="vendor-list" title="Third-party hosts" count={vendors.length} flush description="Seen at runtime on the probed pages or loaded by Launch custom code, with their consent category and CSP status.">
              <TableView aria-labelledby="vendor-list-title" isQuiet density="compact" overflowMode="wrap" styles={pagedTable}>
                <TableHeader>
                  <Column id="host" isRowHeader minWidth={220}>Host</Column>
                  <Column id="role" minWidth={200}>Role</Column>
                  <Column id="seen" align="end" width={96}>Probed pages</Column>
                  <Column id="via" width={120}>Loaded via</Column>
                  <Column id="consent" width={200}>Consent category</Column>
                  <Column id="csp" width={80}>In CSP</Column>
                </TableHeader>
                <TableBody items={vendors.map((v) => ({ ...v, id: v.host }))}>
                  {(v: any) => (
                    <Row id={v.host} textValue={v.host}>
                      <Cell><Code>{v.host}</Code></Cell><Cell>{v.role}</Cell><Cell align="end">{v.seen_pages}</Cell><Cell>{v.via}</Cell>
                      <Cell>{v.consent_group ?? <Detail>not categorised</Detail>}</Cell><Cell>{v.in_csp ? 'Yes' : 'No'}</Cell>
                    </Row>
                  )}
                </TableBody>
              </TableView>
            </Section>
          </div>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

/* ---------- multi-language ---------- */

export function Locales() {
  const { data } = useApi<any>('/api/locales');
  const { rum, scopePath, scopeTree } = useSite();
  if (!data) return <Loading />;
  const trees: any[] = data.trees;
  const countries = new Set(trees.map((t) => t.country)).size;
  const total = trees.reduce((a, t) => a + t.urls, 0);
  const metrics: Metric[] = [
    { id: 'trees', label: 'Locale trees', value: trees.length, note: `${countries} countries` },
    { id: 'urls', label: 'Sitemap URLs, all trees', value: fmt(total), note: `${scopePath} is the scope of this wave` },
    { id: 'sampled', label: 'Trees fetched in full', value: trees.filter((t) => t.deep_sampled).length, note: 'Mapped with the block catalogue of the scope' },
  ];
  return (
    <Stack>
      <PageHeader crumbs={crumbs} title="Multi-language"
        description={`How the ${countries} country sites are structured today, how much they share with ${scopePath}, and what changes per locale on EDS.`} />
      <MetricGrid label="Locales at a glance" items={metrics} />
      <Section id="i18n-notes" title="What the analysis found" ask={['How should content inheritance between locales be handled on EDS?', rum ? `Which locale trees should follow ${scopePath}, by traffic?` : `Which locale trees share the most paths with ${scopePath}?`]}>
        <ul className={rich.ul}>{((data.notes ?? []) as string[]).map((n, i) => <li key={i} className={style({ font: 'body-sm' })}>{n}</li>)}</ul>
      </Section>
      {rum && (
        <Section id="tree-traffic" title="Traffic by tree" description="Human page views in 90 days (estimate).">
          <BarList label="Traffic by locale tree" rows={trees.slice(0, 15).map((t) => ({ id: t.tree, label: t.tree, textValue: t.tree, value: Number(t.rum_views_90d) || 0, right: fmtViews(t.rum_views_90d) }))} />
        </Section>
      )}
      <Section id="tree-list" title="All trees" count={trees.length} flush>
        <TableView aria-labelledby="tree-list-title" isQuiet density="compact" styles={pagedTable}>
          <TableHeader>
            <Column id="tree" isRowHeader width={110}>Tree</Column>
            <Column id="urls" align="end" width={96}>URLs</Column>
            <Column id="shared" align="end" width={190}>{`Paths shared with ${scopePath}`}</Column>
            {rum && <Column id="views" align="end" width={110}>Views 90d</Column>}
            <Column id="sample" minWidth={240}>Deep sample</Column>
          </TableHeader>
          <TableBody items={trees.map((t) => ({ ...t, id: t.tree }))}>
            {(t: any) => (
              <Row id={t.tree} textValue={t.tree}>
                <Cell><span className={style({ fontWeight: 'bold' })}>{t.tree}</span></Cell>
                <Cell align="end">{fmt(t.urls)}</Cell>
                <Cell align="end">{t.tree === scopeTree ? '–' : `${fmt(t.shared_with_scope)} (${t.shared_pct}%)`}</Cell>
                {rum && <Cell align="end">{fmtViews(t.rum_views_90d)}</Cell>}
                <Cell>{t.deep_sampled ? `${fmt(t.live_pages)} live pages · ${t.templates} templates · ${t.blocks} blocks${t.unmapped && t.unmapped !== '{}' ? ` · unmapped: ${Object.keys(parse(t.unmapped) as object).join(', ')}` : ''}` : <Detail>Not sampled</Detail>}</Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
    </Stack>
  );
}

/* ---------- data, indexes and site config ---------- */

export function DataConfig() {
  const { data } = useApi<any>('/api/indexes');
  const cfg = useApi<any[]>('/api/site-config');
  if (!data || !cfg.data) return <Loading />;
  const yaml = `version: 1\nindices:\n${data.indexes.map((i: any) => i.yaml).join('\n')}\n`;
  return (
    <Stack>
      <PageHeader crumbs={crumbs} title="Data and configuration"
        description="The metadata every page must carry, the query indexes that feed listings and search, the search baselines for parity checks, and site-level configuration." />
      <Section id="metadata" title="Metadata contract" count={data.metadata.length} flush description="Taken from the current pages' data attributes and meta tags. It feeds the data layer, the indexes, tag links and any access gates."
        ask={['Which metadata fields must every page carry, and where do they come from today?']}>
        <TableView aria-labelledby="metadata-title" isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="name" isRowHeader width={190}>Field</Column>
            <Column id="aem" minWidth={200}>Source today</Column>
            <Column id="used" minWidth={240}>Used by</Column>
            <Column id="cov" align="end" width={110}>Pages with it</Column>
            <Column id="vals" align="end" width={96}>Values</Column>
          </TableHeader>
          <TableBody items={data.metadata.map((m: any) => ({ ...m, id: m.name }))}>
            {(m: any) => (
              <Row id={m.name} textValue={m.name}>
                <Cell><span className={style({ fontWeight: 'bold' })}>{m.name}</span></Cell><Cell><Detail>{m.aem_source}</Detail></Cell>
                <Cell>{list(m.used_by)}</Cell><Cell align="end">{fmt(m.coverage_pages)}</Cell><Cell align="end">{m.distinct_values ?? '–'}</Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
      <Section id="indexes" title="Query indexes" count={data.indexes.length} flush ask={['Which blocks read which query index, and with which filters?']}>
        <TableView aria-labelledby="indexes-title" isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="name" isRowHeader width={120}>Index</Column>
            <Column id="incl" minWidth={180}>Pages</Column>
            <Column id="filter" minWidth={160}>Filter</Column>
            <Column id="props" minWidth={260}>Properties</Column>
            <Column id="cons" minWidth={160}>Read by</Column>
          </TableHeader>
          <TableBody items={data.indexes.map((i: any) => ({ ...i, id: i.name }))}>
            {(i: any) => (
              <Row id={i.name} textValue={i.name}>
                <Cell><span className={style({ fontWeight: 'bold' })}>{i.name}</span></Cell><Cell><Code>{list(i.include_paths)}</Code></Cell>
                <Cell>{i.filter ?? '–'}</Cell><Cell><Detail>{list(i.properties)}</Detail></Cell><Cell>{list(i.consumers)}</Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
      <Section id="yaml" title="helix-query.yaml (draft)" description="Committed to the code repository; the indexes are built when pages are published.">
        <pre className={rich.pre}>{yaml}</pre>
      </Section>
      <Section id="probes" title="Search parity baselines" count={data.probes.length} flush description="What the current site search returns. The rebuilt search is checked against the count and the top titles.">
        <TableView aria-labelledby="probes-title" isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="term" isRowHeader width={140}>Term</Column>
            <Column id="count" align="end" width={96}>Results</Column>
            <Column id="titles" minWidth={320}>Top titles</Column>
          </TableHeader>
          <TableBody items={data.probes.map((p: any) => ({ ...p, id: p.term }))}>
            {(p: any) => <Row id={p.term} textValue={p.term}><Cell>{p.term}</Cell><Cell align="end">{p.expect_count}</Cell><Cell>{list(p.expect_titles)}</Cell></Row>}
          </TableBody>
        </TableView>
      </Section>
      <Section id="site-config" title="Site configuration" count={cfg.data.length} flush>
        <TableView aria-labelledby="site-config-title" isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="key" isRowHeader width={190}>Item</Column>
            <Column id="now" minWidth={240}>Today</Column>
            <Column id="eds" minWidth={240}>On EDS</Column>
            <Column id="decision" width={110}>Decision</Column>
          </TableHeader>
          <TableBody items={cfg.data.map((c: any) => ({ ...c, id: c.key }))}>
            {(c: any) => (
              <Row id={c.key} textValue={c.key}>
                <Cell><span className={style({ fontWeight: 'bold' })}>{c.key}</span></Cell><Cell>{c.now}</Cell><Cell>{c.eds}</Cell>
                <Cell>{c.decision ? <Link href={`/questions?focus=${c.decision}`}>{c.decision}</Link> : '–'}</Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
      <Panel><BodyText>All of this is also in the migration spec: <Link href="/spec">read it here</Link>.</BodyText></Panel>
    </Stack>
  );
}
