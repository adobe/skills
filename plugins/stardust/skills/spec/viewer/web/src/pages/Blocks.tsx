import { useParams } from 'react-router-dom';
import { Badge } from '@react-spectrum/s2/Badge';
import { CardView, Card, CardPreview, Content, Text } from '@react-spectrum/s2/CardView';
import { Image } from '@react-spectrum/s2/Image';
import { LabeledValue } from '@react-spectrum/s2/LabeledValue';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton } from '@react-spectrum/s2/LinkButton';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt, fmtViews, media } from '../api';
import { useSite } from '../site';
import { Code, Detail, Kind, Legend, Loading, PageHeader, Section, Stack, Verdict, useApi, verdictLabel } from '../ui';

const ORDER = ['reuse', 'variant', 'new'];
const thumb = style({ width: 96, height: 56, objectFit: 'cover', objectPosition: 'top', borderRadius: 'sm' });
const facts = style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 24 });

export function Blocks() {
  const { data } = useApi('/api/blocks');
  const site = useSite();
  if (!data) return <Loading />;
  const variantsOf = (b: string) => data.variants.filter((v: any) => v.block === b);
  const firstCrop = (b: string) => {
    for (const v of variantsOf(b)) { const ex = JSON.parse(v.examples || '[]'); if (ex[0]) return ex[0].crop as string; }
    return null;
  };
  return (
    <Stack>
      <PageHeader
        title="Blocks"
        description={`EDS blocks proposed for ${site.name} and how each relates to ${site.refPhrase}.`}
        actions={<LinkButton variant="secondary" size="S" href="/api/export/blocks.csv" download><Download /><Text>Download CSV</Text></LinkButton>} />
      <Legend />
      {ORDER.map((verdict) => {
        const list = data.blocks.filter((b: any) => b.verdict === verdict);
        return (
          <Section key={verdict} id={`blocks-${verdict}`} title={verdictLabel(verdict)} count={list.length} flush
            ask={verdict === 'new' ? ['Which new blocks unlock the most pages? Rank them.'] : undefined}>
            <TableView aria-labelledby={`blocks-${verdict}-title`} isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
              <TableHeader>
                <Column id="example" width={112}>Example</Column>
                <Column id="block" isRowHeader minWidth={200}>Block</Column>
                <Column id="variants" minWidth={160}>Variants</Column>
                <Column id="pages" align="end" width={64}>Pages</Column>
                <Column id="templates" align="end" width={88}>Templates</Column>
                {site.rum && <Column id="views" align="end" width={72}>Views</Column>}
              </TableHeader>
              <TableBody items={list.map((b: any) => ({ ...b, id: b.name }))}>
                {(b: any) => {
                  const crop = firstCrop(b.name);
                  return (
                    <Row id={b.name} href={`/blocks/${b.name}`} textValue={b.name}>
                      <Cell>{crop ? <Image src={media(crop)} alt="" loading="lazy" styles={thumb} /> : <Detail>{b.kind === 'global' ? 'Site chrome' : 'No capture'}</Detail>}</Cell>
                      <Cell>
                        <div className={style({ display: 'flex', flexDirection: 'column', gap: 2, paddingY: 4 })}>
                          <span className={style({ display: 'flex', alignItems: 'center', gap: 8 })}><span className={style({ font: 'ui', fontWeight: 'bold' })}>{b.name}</span><Kind k={b.kind} /></span>
                          <span className={style({ font: 'body-xs', color: 'neutral-subdued' })}>{b.description}</span>
                        </div>
                      </Cell>
                      <Cell><span className={style({ font: 'body-xs', color: 'neutral-subdued' })}>{(() => { const vs = variantsOf(b.name); const shown = vs.slice(0, 3).map((v: any) => `${v.variant ?? 'default'} (${fmt(v.url_count)})`).join(', '); return vs.length > 3 ? `${shown} and ${vs.length - 3} more` : shown; })()}</span></Cell>
                      <Cell align="end">{fmt(b.url_count)}</Cell>
                      <Cell align="end">{b.template_count}</Cell>
                      {site.rum && <Cell align="end">{fmtViews(b.pageviews_90d)}</Cell>}
                    </Row>
                  );
                }}
              </TableBody>
            </TableView>
          </Section>
        );
      })}
    </Stack>
  );
}

export function BlockDetail() {
  const { name } = useParams();
  const { data } = useApi(`/api/blocks/${name}`);
  const site = useSite();
  if (!data) return <Loading />;
  const b = data.block;
  const urlsFor = (variant?: string | null) => `/urls?block=${b.name}${variant ? `&bvariant=${encodeURIComponent(variant)}` : ''}`;
  return (
    <Stack>
      <PageHeader
        crumbs={[{ label: 'Blocks', href: '/blocks' }, { label: b.name }]}
        title={<span className={style({ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 })}>{b.name}<Verdict v={b.verdict} /><Kind k={b.kind} /></span>}
        description={b.description}
        actions={<LinkButton variant="secondary" size="S" href={urlsFor()}>{`All ${fmt(b.url_count)} URLs`}</LinkButton>} />

      <Section id="facts" title="At a glance" ask={[`Which templates use ${b.name} most, and with which variants?`]}>
        <div className={facts}>
          <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
            <LabeledValue label="Pages" value={<Link href={urlsFor()}>{`${fmt(b.url_count)} pages (${fmt(b.instance_count)} instances)`}</Link>} />
            <LabeledValue label="Templates" value={b.template_count} />
            {site.rum && <LabeledValue label="Views, 90 days" value={`About ${fmtViews(b.pageviews_90d)}`} />}
          </div>
          <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
            <LabeledValue label={site.refName ? `${site.refName} block` : 'Reference block'} value={b.reference_block ?? 'None'} />
            <LabeledValue label="Why" value={b.rationale ?? '–'} />
          </div>
          <div className={style({ display: 'flex', flexDirection: 'column', gap: 8 })}>
            <span className={style({ font: 'ui-sm', color: 'neutral-subdued' })}>From source components</span>
            <ul className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, font: 'body-sm' })}>
              {data.aem.map((a: any) => <li key={a.name}><Code>{a.name}</Code> <Detail>{`${fmt(a.url_count)} pages`}</Detail></li>)}
            </ul>
            {data.nested.map((n: any) => <Badge key={n.nested_in} variant="negative" fillStyle="subtle">{`${fmt(n.n)} instances inside ${n.nested_in}`}</Badge>)}
          </div>
        </div>
      </Section>

      {data.variants.map((v: any) => {
        const ex = JSON.parse(v.examples || '[]').slice(0, 3);
        return (
          <Section key={v.id} id={`variant-${v.id}`} title={<span className={style({ display: 'inline-flex', alignItems: 'center', gap: 8 })}>{v.variant ?? 'default'}<Verdict v={v.verdict} /></span>}
            count={`${fmt(v.url_count)} pages`} description={v.rationale}
            actions={<Link href={urlsFor(v.variant)} isStandalone>See URLs</Link>}>
            {ex.length > 0 ? (
              <CardView aria-labelledby={`variant-${v.id}-title`} items={ex.map((e: any) => ({ ...e, id: e.crop }))} size="M" styles={style({ width: 'full' })}>
                {(e: any) => (
                  <Card id={e.crop} href={media(e.crop)} target="_blank" textValue={e.url}>
                    <CardPreview><Image src={media(e.crop)} alt={`${b.name} on ${site.short(e.url)}`} styles={style({ width: 'full', aspectRatio: '4/3', objectFit: 'cover', objectPosition: 'top' })} /></CardPreview>
                    <Content><Text slot="description">{site.short(e.url)}</Text></Content>
                  </Card>
                )}
              </CardView>
            ) : <Detail>No captured example for this variant.</Detail>}
          </Section>
        );
      })}

      <Section id="by-template" title="Where it is used, by template" count={data.templates.length} flush>
        <TableView aria-labelledby="by-template-title" isQuiet density="compact" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="template" isRowHeader>Template</Column>
            <Column id="urls" align="end">Pages with this block</Column>
            <Column id="total" align="end">Template pages</Column>
          </TableHeader>
          <TableBody items={data.templates.map((t: any) => ({ ...t, id: t.aem_template }))}>
            {(t: any) => (
              <Row id={t.aem_template} href={`/urls?block=${b.name}&template=${encodeURIComponent(t.aem_template)}`} textValue={t.aem_template}>
                <Cell>{t.aem_template}</Cell>
                <Cell align="end">{fmt(t.urls)}</Cell>
                <Cell align="end">{fmt(t.url_count)}</Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
    </Stack>
  );
}
