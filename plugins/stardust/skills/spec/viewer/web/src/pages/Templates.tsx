import { useParams } from 'react-router-dom';
import { CardView, Card, CardPreview, Content, Image, Text } from '@react-spectrum/s2/CardView';
import { LinkButton } from '@react-spectrum/s2/LinkButton';
import { TagGroup, Tag } from '@react-spectrum/s2/TagGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fmt, fmtViews, pageShot, pct } from '../api';
import { VariantRow } from '../custom';
import { useSite } from '../site';
import { Loading, PageHeader, PathText, Section, Stack, tokenBlock, tokenLabel, useApi, verdictLabel } from '../ui';

export function Templates() {
  const { data } = useApi<any[]>('/api/templates');
  const { rum } = useSite();
  return (
    <Stack>
      <PageHeader title="Templates" description="Page templates of the current site, from the template rule in the scope configuration. Within a template, pages are grouped into layout variants by the set of EDS blocks they need." />
      <Section id="templates" title="All templates" count={data?.length} ask={['Which templates have the most layout variants, and why?']}>
      <CardView aria-label="Templates" size="S" items={data ?? []} loadingState={data ? 'idle' : 'loading'} styles={style({ width: 'full' })}>
        {(t: any) => (
          <Card id={t.id} href={`/templates/${encodeURIComponent(t.id)}`} textValue={t.label}>
            <CardPreview>
              <Image src={t.rep_capture_key ? pageShot(t.rep_capture_key) : undefined} alt="" styles={style({ width: 'full', aspectRatio: '4/3', objectFit: 'cover', objectPosition: 'top' })} />
            </CardPreview>
            <Content>
              <Text slot="title">{t.label}</Text>
              <Text slot="description">
                {`${fmt(t.url_count)} pages · ${t.variant_count} variants${rum ? ` · ${fmtViews(t.pageviews_90d)} views` : ''}`}
                {t.variant_count > 5 ? `. Top 5 variants cover ${pct(t.top_variants_share * 100, 100)}.` : ''}
              </Text>
            </Content>
          </Card>
        )}
      </CardView>
      </Section>
    </Stack>
  );
}

export function TemplateDetail() {
  const { id } = useParams();
  const { data } = useApi(`/api/templates/${encodeURIComponent(id!)}`);
  const { rum, short } = useSite();
  if (!data) return <Loading />;
  const t = data.template;
  const byVerdict = (k: string) => data.blocks.filter((b: any) => b.verdict === k);
  return (
    <Stack>
      <PageHeader
        crumbs={[{ label: 'Templates', href: '/templates' }, { label: t.label }]}
        title={t.label}
        description={<><PathText>{t.id}</PathText>{` · ${fmt(t.url_count)} live pages${rum ? ` · ${fmtViews(t.pageviews_90d)} views in 90 days` : ''} · ${data.variants.length} layout variants`}</>}
        actions={<LinkButton variant="secondary" href={`/urls?template=${encodeURIComponent(t.id)}`}>{`All ${fmt(t.url_count)} URLs`}</LinkButton>} />

      <Section id="tpl-blocks" title="Blocks used by this template" count={data.blocks.length} description="Number of this template's pages that use each block.">
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 16 })}>
        {['reuse', 'variant', 'new'].map((k) => byVerdict(k).length > 0 && (
          <TagGroup key={k} label={verdictLabel(k)} size="S" items={byVerdict(k).map((b: any) => ({ ...b, id: b.block }))}>
            {(b: any) => <Tag id={b.block} href={`/urls?template=${encodeURIComponent(t.id)}&block=${b.block}`} textValue={b.block}>{`${b.block} · ${fmt(b.urls)}`}</Tag>}
          </TagGroup>
        ))}
      </div>
      </Section>

      <Section id="variants" title="Layout variants" count={data.variants.length} description={`Core blocks are on at least half of the variant's pages; optional blocks show their share of pages. The picture is the representative page: the most common block set${rum ? ', highest traffic' : ''}.`}
        ask={[`Which variants of ${t.label} need a new block?`]}>
      <div className={style({ display: 'flex', flexDirection: 'column' })}>
        {data.variants.map((v: any) => (
          <VariantRow key={v.code} v={{
            title: `Variant ${v.rank}`,
            meta: `${fmt(v.url_count)} pages (${pct(v.url_count, t.url_count)})${rum ? ` · ${fmtViews(v.pageviews_90d)} views` : ''}`,
            href: `/urls?variant=${encodeURIComponent(v.code)}`,
            thumb: v.rep_capture_key ? pageShot(v.rep_capture_key) : undefined,
            core: JSON.parse(v.core).map((tok: string) => ({ id: tok, label: tokenLabel(tok), href: `/blocks/${tokenBlock(tok)}` })),
            optional: JSON.parse(v.optional).map(([tok, share]: [string, number]) => ({ id: tok, label: `${tokenLabel(tok)} ${Math.round(share * 100)}%`, href: `/blocks/${tokenBlock(tok)}` })),
            footer: <>Representative: {short(v.rep_url)}{` · ${v.distinct_sets} distinct block combinations`}</>,
          }} />
        ))}
      </div>
      </Section>
    </Stack>
  );
}
