import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionButton } from '@react-spectrum/s2/ActionButton';
import { Badge } from '@react-spectrum/s2/Badge';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { Popover, DialogTrigger } from '@react-spectrum/s2/Popover';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { Tabs, TabList, Tab, TabPanel } from '@react-spectrum/s2/Tabs';
import { ToggleButtonGroup, ToggleButton } from '@react-spectrum/s2/ToggleButtonGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt, fmtViews } from '../api';
import { useSite } from '../site';
import { BodyText, Detail, EmptyState, Loading, PageHeader, PathText, Section, Stack, pagedTable, useApi, useServerList } from '../ui';

function LinkedFromList({ url }: { url: string }) {
  const { data } = useApi<any[]>(`/api/linked-from?url=${encodeURIComponent(url)}`);
  if (!data) return <Loading label="Loading pages" />;
  return (
    <ul className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 })}>
      {data.map((r) => <li key={r.id}><Link href={`/urls/${r.id}`}>{r.path}</Link> <Detail>{r.zone}</Detail></li>)}
    </ul>
  );
}

function LinkedFrom({ url, count }: { url: string; count: number }) {
  const { short } = useSite();
  return (
    <DialogTrigger>
      <ActionButton size="S" aria-label={`Show the ${count} pages that link to ${short(url)}`}>{`${fmt(count)} pages`}</ActionButton>
      <Popover>
        <h3 className={style({ font: 'title', marginTop: 0, marginBottom: 12 })}>Pages that link here</h3>
        <LinkedFromList url={url} />
      </Popover>
    </DialogTrigger>
  );
}

const toggles = (params: URLSearchParams, keys: Record<string, string>) => new Set(Object.entries(keys).filter(([id, v]) => params.get(id) === v).map(([id]) => id));

function FilterToggles({ label, options, params, onChange }: { label: string; options: { id: string; value: string; label: string }[]; params: URLSearchParams; onChange: (p: URLSearchParams) => void }) {
  const values = Object.fromEntries(options.map((o) => [o.id, o.value]));
  return (
    <ToggleButtonGroup aria-label={label} selectionMode="multiple" selectedKeys={toggles(params, values)} size="S"
      onSelectionChange={(keys) => {
        const p = new URLSearchParams(params);
        options.forEach((o) => (keys.has(o.id) ? p.set(o.id, o.value) : p.delete(o.id)));
        onChange(p);
      }}>
      {options.map((o) => <ToggleButton key={o.id} id={o.id}>{o.label}</ToggleButton>)}
    </ToggleButtonGroup>
  );
}

function RedirectTable({ query }: { query: string }) {
  const { list, total } = useServerList<any>(`/api/redirects?${query}`, 100);
  const { short, live, rum } = useSite();
  return (
    <Section id="redirect-list" title="Redirects" count={total === null ? '…' : fmt(total)} flush>
      <TableView aria-labelledby="redirect-list-title" isQuiet density="compact" loadingState={list.loadingState} onLoadMore={list.loadMore} styles={pagedTable}>
        <TableHeader>
          <Column id="from" isRowHeader minWidth={200}>From</Column>
          <Column id="to" minWidth={200}>To</Column>
          <Column id="status" width={150}>Status</Column>
          <Column id="linked" align="end" width={112}>Linked from</Column>
          {rum && <Column id="views" align="end" width={72}>Views</Column>}
        </TableHeader>
        <TableBody items={list.items} renderEmptyState={() => <EmptyState title="No redirects match these filters" />}>
          {(r: any) => (
            <Row id={r.id} textValue={short(r.src)}>
              <Cell><span className={style({ fontWeight: 'bold' })}>{short(r.src)}</span></Cell>
              <Cell>{r.target ? short(r.target) : (r.note ?? '–')}</Cell>
              <Cell>{[r.status ? `${r.status}${r.hops > 1 ? `, ${r.hops} hops` : ''}` : 'Loop', r.external ? 'off-site' : null, r.target_status >= 400 ? `to a ${r.target_status}` : null].filter(Boolean).join(' · ')}</Cell>
              <Cell align="end">{r.inbound_pages ? <LinkedFrom url={r.src.startsWith('http') ? r.src : live(r.src) || r.src} count={r.inbound_pages} /> : '0'}</Cell>
              {rum && <Cell align="end">{fmtViews(r.rum_views)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
    </Section>
  );
}

function RumLandings() {
  const { data } = useApi('/api/redirects?kind=rum&limit=100');
  return (
    <Section id="rum-landings" title="Landing pages reached through a redirect" count={data?.landings?.length} flush>
    <TableView aria-labelledby="rum-landings-title" isQuiet density="compact" loadingState={data ? 'idle' : 'loading'} styles={style({ width: 'full' })}>
      <TableHeader>
        <Column id="path" isRowHeader>Landing page</Column>
        <Column id="views" align="end" width={200}>Views through a redirect (estimate)</Column>
      </TableHeader>
      <TableBody items={(data?.landings ?? []).map((r: any) => ({ ...r, id: r.path }))} renderEmptyState={() => <EmptyState title="No landing pages" />}>
        {(r: any) => (
          <Row id={r.path} href={`/urls?q=${encodeURIComponent(r.path)}&outcome=all`} textValue={r.path}>
            <Cell><PathText>{r.path}</PathText></Cell>
            <Cell align="end">{fmtViews(r.views)}</Cell>
          </Row>
        )}
      </TableBody>
    </TableView>
    </Section>
  );
}

function ListTabs({ label, value, tabs, onChange, children }: { label: string; value: string; tabs: { id: string; label: string }[]; onChange: (id: string) => void; children: ReactNode }) {
  return (
    <Tabs aria-label={label} selectedKey={value} onSelectionChange={(k) => onChange(String(k))}>
      <TabList>{tabs.map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
      {tabs.map((t) => (
        <TabPanel key={t.id} id={t.id}>{t.id === value ? <div className={style({ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 })}>{children}</div> : null}</TabPanel>
      ))}
    </Tabs>
  );
}

export function Redirects() {
  const [params, setParams] = useSearchParams();
  const { rum } = useSite();
  const asked = params.get('kind') ?? 'legacy';
  const kind = !rum && asked === 'rum' ? 'legacy' : asked;
  const qs = new URLSearchParams(params); qs.set('kind', kind); qs.delete('offset');
  return (
    <Stack>
      <PageHeader
        title="Redirects"
        description={`Redirects that exist on the current site today${rum ? ', redirects the move to EDS creates, and pages real users reach through a redirect.' : ' and redirects the move to EDS creates.'}`}
        actions={kind !== 'rum' && <LinkButton variant="secondary" size="S" href={`/api/export/redirects.csv?kind=${kind}`} download><Download /><Text>Download CSV</Text></LinkButton>} />
      <ListTabs label="Redirect lists" value={kind} onChange={(k) => setParams(new URLSearchParams({ kind: k }))} tabs={[
        { id: 'legacy', label: 'Existing today' }, { id: 'migration', label: 'Created by the migration' }, ...(rum ? [{ id: 'rum', label: 'Used by real users' }] : [])]}>
        {kind === 'legacy' && (
          <FilterToggles label="Redirect filters" params={params} onChange={setParams} options={[
            { id: 'in_sitemap', value: '1', label: 'Sitemap URLs only' }, { id: 'broken', value: '1', label: 'Redirects into a 404' }, { id: 'external', value: '1', label: 'Off-site' }]} />
        )}
        {kind === 'migration' && <div><BodyText>EDS serves paths without .html and in lowercase. One rule covers dropping .html. These pages also change case, double dashes, or underscores, so each needs its own redirect entry.</BodyText></div>}
        {kind === 'rum'
          ? <><div><BodyText>Landing pages where real users arrived through a redirect in the last 90 days. Telemetry doesn't record the redirect source. These redirects are in active use: vanity URLs, campaigns, and old links.</BodyText></div><RumLandings /></>
          : <RedirectTable key={qs.toString()} query={qs.toString()} />}
      </ListTabs>
    </Stack>
  );
}

type Col = { id: string; name: string; isRowHeader?: boolean; align?: 'end'; width?: number; minWidth?: number };
const BROKEN_COLS: Record<string, Col[]> = {
  rum: [
    { id: 'url', name: 'URL', isRowHeader: true, minWidth: 280 }, { id: 'status', name: 'Status', width: 120 },
    { id: 'views', name: 'Views', align: 'end', width: 136 }, { id: 'referrers', name: 'Top referrer', minWidth: 200 },
  ],
  other: [
    { id: 'url', name: 'URL', isRowHeader: true, minWidth: 280 }, { id: 'status', name: 'Status', width: 120 },
    { id: 'linked', name: 'Linked from', align: 'end', width: 136 },
  ],
};

function brokenCell(id: string, r: any, short: (u?: string | null) => string) {
  switch (id) {
    case 'url': return <span className={style({ fontWeight: 'bold' })}>{short(r.url)}</span>;
    case 'status': return `${r.status === 310 ? 'Loop' : r.status} · ${r.kind}`;
    case 'views': return `${fmtViews(r.rum_views)} (${r.rum_bundles} sampled)`;
    case 'referrers': {
      const [top] = Object.entries(JSON.parse(r.referrers || '{}'));
      return top ? `${top[0] === '(direct)' ? 'Direct or unknown' : short(top[0])} · ${fmtViews(top[1] as number)}` : '–';
    }
    default: return r.inbound_pages > 0 ? <LinkedFrom url={r.url} count={r.inbound_pages} /> : '0';
  }
}

function BrokenTable({ query, source }: { query: string; source: string }) {
  const { list, total } = useServerList<any>(`/api/broken?${query}`, 100);
  const { short } = useSite();
  const columns = BROKEN_COLS[source === 'rum' ? 'rum' : 'other'];
  return (
    <Section id="broken-list" title="Broken URLs" count={total === null ? '…' : fmt(total)} flush>
      <TableView aria-labelledby="broken-list-title" isQuiet density="compact" loadingState={list.loadingState} onLoadMore={list.loadMore} styles={pagedTable}>
        <TableHeader columns={columns}>
          {(c) => <Column id={c.id} isRowHeader={c.isRowHeader} align={c.align} width={c.width} minWidth={c.minWidth}>{c.name}</Column>}
        </TableHeader>
        <TableBody items={list.items} renderEmptyState={() => <EmptyState title="No broken URLs match these filters" />}>
          {(r: any) => (
            <Row id={r.id} textValue={short(r.url)} columns={columns}>
              {(c) => <Cell align={c.align}>{brokenCell(c.id, r, short)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
    </Section>
  );
}

export function Broken() {
  const [params, setParams] = useSearchParams();
  const { rum, scopePath } = useSite();
  const asked = params.get('source') ?? (rum ? 'rum' : 'link');
  const source = !rum && asked === 'rum' ? 'link' : asked;
  const qs = new URLSearchParams(params); qs.set('source', source); qs.delete('offset');
  return (
    <Stack>
      <PageHeader
        title="404s and broken links"
        description={rum ? "Three independent sources: dead URLs real users hit, dead links found in the site's own pages, and sitemap URLs that end in a 404." : "Two independent sources: dead links found in the site's own pages, and sitemap URLs that end in a 404. Real-user telemetry was not available, so 404s hit by visitors are not known."}
        actions={<LinkButton variant="secondary" size="S" href={`/api/export/broken.csv?source=${source}`} download><Download /><Text>Download CSV</Text></LinkButton>} />
      <ListTabs label="Broken URL sources" value={source} onChange={(k) => setParams(new URLSearchParams({ source: k }))} tabs={[
        ...(rum ? [{ id: 'rum', label: 'Hit by real users' }] : []), { id: 'link', label: 'Linked from pages' }, { id: 'sitemap', label: 'In the sitemap' }]}>
        {source === 'link' && (
          <FilterToggles label="Broken link filters" params={params} onChange={setParams} options={[
            ...(scopePath !== '/' ? [{ id: 'in_scope', value: '1', label: `${scopePath} only` }] : []), { id: 'kind', value: 'asset', label: 'Assets (PDF, images)' }]} />
        )}
        <BrokenTable key={qs.toString()} query={qs.toString()} source={source} />
      </ListTabs>
    </Stack>
  );
}
