import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@react-spectrum/s2/Badge';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { Picker, PickerItem } from '@react-spectrum/s2/Picker';
import { SearchField } from '@react-spectrum/s2/SearchField';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { TagGroup, Tag } from '@react-spectrum/s2/TagGroup';
import { Text as ItemText } from '@react-spectrum/s2/Picker';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt, fmtViews } from '../api';
import { useSite } from '../site';
import { Detail, EmptyState, PageHeader, pagedTable, Section, Stack, useApi, useServerList } from '../ui';

const LABELS: Record<string, string> = {
  outcome: 'Status', template: 'Template', variant: 'Variant', section: 'Section', traffic: 'Traffic', block: 'Block',
  bvariant: 'Block variant', verdict: 'Reuse verdict', has: 'Needs block', nested: 'Nested blocks', dynamic: 'Data-driven',
  sitemap: 'Scope', flag: 'Page flag', q: 'Path contains', migration: 'Migration redirect', sort: 'Sort',
};
const ANY = '__any';
type FacetRow = { value: string | number | null; n: number; label?: string };

function Facet({ label, k, rows, value, onChange }: { label: string; k: string; rows: FacetRow[]; value: string; onChange: (k: string, v: string | null) => void }) {
  const items = rows.map((r) => ({ id: r.value === null ? 'null' : String(r.value), label: r.label ?? (r.value === null ? '(none)' : String(r.value)), n: r.n }));
  return (
    <Picker label={label} items={items} value={value} onChange={(v) => onChange(k, v === ANY ? null : String(v))} size="S" styles={style({ width: 184 })}>
      {(it) => (
        <PickerItem id={it.id} textValue={it.label}>
          <ItemText slot="label">{it.label}</ItemText>
          <ItemText slot="description">{`${fmt(it.n)} URLs`}</ItemText>
        </PickerItem>
      )}
    </Picker>
  );
}

function UrlTable({ query }: { query: string }) {
  const { list, total } = useServerList<any>(`/api/urls?${query}`);
  const { rum, inScope } = useSite();
  return (
    <Section id="url-list" title="Matching URLs" count={total === null ? '…' : fmt(total)} flush>
      <TableView aria-labelledby="url-list-title" isQuiet density="compact" loadingState={list.loadingState} onLoadMore={list.loadMore} styles={pagedTable}>
        <TableHeader>
          <Column id="path" isRowHeader minWidth={220}>Path</Column>
          <Column id="title" minWidth={120}>Title</Column>
          <Column id="template" minWidth={120}>Template</Column>
          <Column id="blocks" align="end" width={64}>Blocks</Column>
          {rum && <Column id="views" align="end" width={72}>Views</Column>}
          <Column id="status" width={120}>Status</Column>
        </TableHeader>
        <TableBody items={list.items} renderEmptyState={() => <EmptyState title="No URLs match these filters">Remove a filter or clear them all.</EmptyState>}>
          {(r: any) => (
            <Row id={r.id} href={`/urls/${r.id}`} textValue={r.path}>
              <Cell><span className={style({ fontWeight: 'bold' })}>{inScope(r.path)}</span></Cell>
              <Cell><span className={style({ color: 'neutral-subdued' })}>{r.title || '–'}</span></Cell>
              <Cell>{r.aem_template ? `${r.aem_template}${r.variant_code ? ` · v${r.variant_code.split('#')[1]}` : ''}` : '–'}</Cell>
              <Cell align="end">{r.block_count ?? '–'}</Cell>
              {rum && <Cell align="end">{fmtViews(r.pageviews_90d)}</Cell>}
              <Cell>
                {r.outcome === 'page'
                  ? (r.needs_migration_redirect ? <Badge variant="notice" fillStyle="subtle">Path changes</Badge> : `200${r.in_sitemap ? '' : ', off sitemap'}`)
                  : <Badge variant={/broken|404|loop/.test(r.outcome) ? 'negative' : 'neutral'} fillStyle="subtle">{r.outcome}</Badge>}
              </Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Section>
  );
}

export default function Urls() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const filters = new URLSearchParams(params); filters.delete('offset');
  const facets = useApi(`/api/facets?${filters.toString()}`);
  const { rum } = useSite();
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params); p.delete('offset');
    if (v === null || v === '') p.delete(k); else p.set(k, v);
    if (k === 'block') p.delete('bvariant');
    setParams(p);
  };
  const removeValue = (k: string, v: string) => {
    const p = new URLSearchParams(params); p.delete('offset');
    const rest = p.getAll(k).filter((x) => x !== v); p.delete(k); rest.forEach((x) => p.append(k, x));
    if (k === 'q') setQ('');
    setParams(p);
  };
  const active = [...filters.entries()].filter(([k]) => !['sort', 'limit'].includes(k));
  const f = facets.data;
  const sum = (rows: FacetRow[]) => rows.reduce((a, r) => a + r.n, 0);

  return (
    <Stack>
      <PageHeader
        title="URLs"
        description="Filter by any combination. Every view is a shareable link. By default the list shows live sitemap pages (status 200)."
        actions={<LinkButton variant="secondary" size="S" href={`/api/export/urls.csv?${filters.toString()}`} download><Download /><Text>Download CSV</Text></LinkButton>} />

      <Section id="filters" title="Filters" ask={['Which URLs use the tabs block, and on which templates?']}>
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 16 })}>
        <div className={style({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 16 })}>
          <SearchField label="Path contains" placeholder="/products/" value={q} onChange={setQ} onSubmit={(v) => set('q', v)} onClear={() => set('q', null)} size="S" styles={style({ width: 320 })} />
          <Picker label="Sort by" size="S" value={params.get('sort') ?? (rum ? 'views' : 'path')} onChange={(v) => set('sort', String(v))} styles={style({ width: 176 })}>
            {rum && <PickerItem id="views">Traffic</PickerItem>}
            <PickerItem id="path">Path</PickerItem>
            <PickerItem id="blocks">Block count</PickerItem>
            <PickerItem id="template">Template</PickerItem>
          </Picker>
        </div>
        {f && (
          <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 16 })}>
            <Facet label="Status" k="outcome" value={params.get('outcome') ?? 'page'} onChange={set} rows={[{ value: 'all', n: sum(f.outcome), label: 'All statuses' }, ...f.outcome]} />
            <Facet label="Scope" k="sitemap" value={params.get('sitemap') ?? '1'} onChange={set}
              rows={[{ value: 'all', n: sum(f.sitemap) }, ...f.sitemap].map((r: FacetRow) => ({ ...r, value: String(r.value), label: String(r.value) === '1' ? 'Sitemap URLs' : String(r.value) === '0' ? 'Found through links only' : 'All URLs' }))} />
            <Facet label="Reuse verdict (any block)" k="verdict" value={params.get('verdict') ?? ANY} onChange={set} rows={[{ value: ANY, n: sum(f.verdict), label: 'Any' }, ...f.verdict]} />
            <Facet label="Template" k="template" value={params.get('template') ?? ANY} onChange={set} rows={[{ value: ANY, n: sum(f.template), label: 'Any' }, ...f.template]} />
            <Facet label="Block" k="block" value={params.get('block') ?? ANY} onChange={set} rows={[{ value: ANY, n: sum(f.block), label: 'Any' }, ...f.block]} />
            {rum && <Facet label="Traffic, 90 days" k="traffic" value={params.get('traffic') ?? ANY} onChange={set} rows={[{ value: ANY, n: sum(f.traffic), label: 'Any' }, ...f.traffic]} />}
            <Facet label="Page flag" k="flag" value={params.get('flag') ?? ANY} onChange={set}
              rows={[{ value: ANY, n: sum(f.flag.filter((r: FacetRow) => r.value)), label: 'Any' }, ...f.flag.filter((r: FacetRow) => r.value).map((r: FacetRow) => ({ ...r, label: r.value === 'empty' ? 'Empty page (no content)' : 'Form thank-you page' }))]} />
            <Facet label="Section" k="section" value={params.get('section') ?? ANY} onChange={set} rows={[{ value: ANY, n: sum(f.section), label: 'Any' }, ...f.section]} />
          </div>
        )}
        {active.length > 0 && (
          <TagGroup
            label="Active filters"
            size="S"
            items={active.map(([k, v]) => ({ id: `${k}=${v}`, k, v }))}
            onRemove={(keys) => keys.forEach((key) => { const [k, ...rest] = String(key).split('='); removeValue(k, rest.join('=')); })}
            groupActionLabel="Clear all"
            onGroupAction={() => { setQ(''); setParams(new URLSearchParams()); }}>
            {(t) => <Tag id={t.id} textValue={`${LABELS[t.k] ?? t.k}: ${t.v}`}>{`${LABELS[t.k] ?? t.k}: ${t.v}`}</Tag>}
          </TagGroup>
        )}
      </div>
      </Section>

      <UrlTable key={filters.toString()} query={filters.toString()} />
    </Stack>
  );
}
