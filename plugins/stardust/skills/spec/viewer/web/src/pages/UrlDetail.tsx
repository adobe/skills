import { useParams } from 'react-router-dom';
import { Badge } from '@react-spectrum/s2/Badge';
import { Image } from '@react-spectrum/s2/Image';
import { InlineAlert, Heading, Content } from '@react-spectrum/s2/InlineAlert';
import { LabeledValue } from '@react-spectrum/s2/LabeledValue';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { fmt, fmtViews, media, pageShot } from '../api';
import { useSite } from '../site';
import { BlockStep } from '../custom';
import { Detail, Loading, PageHeader, PathText, Section, Stack, useApi, type Crumb } from '../ui';

export default function UrlDetail() {
  const { id } = useParams();
  const { data } = useApi(`/api/urls/${id}`);
  const { short, live, rum } = useSite();
  if (!data) return <Loading />;
  const u = data.url;
  const blocks = data.blocks as any[];
  const real = blocks.filter((b) => ['block', 'dynamic', 'global'].includes(b.kind));
  const shot = pageShot(u.capture_key);
  const crumbs: Crumb[] = [{ label: 'URLs', href: '/urls' }];
  if (u.aem_template) crumbs.push({ label: u.aem_template, href: `/templates/${encodeURIComponent(u.aem_template)}` });
  crumbs.push({ label: 'Page' });

  return (
    <Stack>
      <PageHeader
        crumbs={crumbs}
        title={u.title || u.path}
        description={u.path}
        actions={(u.url || live(u.path)) && <LinkButton variant="secondary" size="S" href={u.url || live(u.path)} target="_blank"><OpenIn /><Text>Open live page</Text></LinkButton>} />
      <div className={style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', xl: 'minmax(0, 1fr) 360px' }, gap: 24, alignItems: 'start' })}>
        <div className={style({ minWidth: 0 })}>
          {u.outcome !== 'page' ? (
            <InlineAlert variant="notice">
              <Heading>{`This URL is not a page today: ${u.outcome}`}</Heading>
              <Content>
                <div className={style({ display: 'flex', flexDirection: 'column', gap: 8 })}>
                  <LabeledValue label="Status" value={`${u.status}${u.final_status ? ` to ${u.final_status}` : ''}`} />
                  <LabeledValue label="Final URL" value={u.final_url ?? '–'} />
                </div>
              </Content>
            </InlineAlert>
          ) : (
            <Section id="sequence" title="Blocks needed on this page" count={real.length} description="In page order. Open a capture to see the block as it renders today."
              ask={[`Which other pages use the same block set as ${u.path}?`]}>
              <ol className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' })}>
                {blocks.map((b, i) => {
                  const examples = b.examples ? JSON.parse(b.examples) : [];
                  return (
                    <li key={i}>
                      <BlockStep media={(k) => media(k)!} step={{
                        pos: b.pos, kind: b.kind, block: b.block, variant: b.variant, verdict: b.verdict, nested_in: b.nested_in, section: b.section,
                        aem: JSON.parse(b.aem || '[]'), crop: b.crop,
                        example: examples[0] ? { crop: examples[0].crop, from: short(examples[0].url) } : null,
                      }} />
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}
        </div>
        <aside className={style({ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 })} aria-label="Page facts">
          <Section id="facts" title="Page facts">
            <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
            <LabeledValue label="Template" value={u.aem_template ?? '–'} />
            {data.variant
              ? <LabeledValue label="Layout variant" value={<span className={style({ display: 'flex', flexDirection: 'column' })}><Link href={`/urls?variant=${encodeURIComponent(data.variant.code)}`}>{`Variant ${data.variant.rank}: ${data.variant.label}`}</Link><Detail>{`${fmt(data.variant.url_count)} pages share it`}</Detail></span>} />
              : <LabeledValue label="Layout variant" value="–" />}
            {rum && <LabeledValue label="Views, 90 days" value={`About ${fmtViews(u.pageviews_90d)} (${fmt(u.rum_bundles ?? 0)} sampled)`} />}
            <LabeledValue label="In sitemap" value={u.in_sitemap ? 'Yes' : 'No, found through links'} />
            <LabeledValue label="Path on EDS" value={<span className={style({ display: 'flex', flexDirection: 'column' })}><PathText>{u.eds_path ?? '–'}</PathText>{u.needs_migration_redirect ? <Detail>Changes: needs an explicit redirect</Detail> : null}</span>} />
            </div>
          </Section>
          {data.redirects.length > 0 && (
            <Section id="url-redirects" title="Redirects involving this URL" count={data.redirects.length}>
              <ul className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 })}>
                {data.redirects.map((r: any) => (
                  <li key={r.id} className={style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 4 })}>
                    <Badge variant="neutral" fillStyle="subtle">{r.kind}</Badge>
                    <PathText>{`${short(r.src)} → ${short(r.target)}`}</PathText>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {data.badLinks.length > 0 && (
            <Section id="url-bad-links" title="Links to dead or redirecting URLs" count={data.badLinks.length}>
              <ul className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 })}>
                {data.badLinks.slice(0, 30).map((l: any, i: number) => (
                  <li key={i} className={style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 4 })}>
                    <span className={style({ display: 'flex', alignItems: 'center', gap: 8 })}>
                      <Badge variant={l.broken_status ? 'negative' : 'neutral'} fillStyle="subtle">{l.broken_status ? String(l.broken_status) : 'Redirect'}</Badge>
                      <Detail>{l.zone}</Detail>
                    </span>
                    <PathText>{short(l.to_url)}</PathText>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {shot && (
            <Section id="capture" title="Captured page" description="Desktop capture at 1440 px.">
              <div className={style({ maxHeight: 1200, overflowY: 'auto', borderRadius: 'lg', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200' })}>
                <Image src={shot} alt={`Capture of ${u.path}`} loading="lazy" styles={style({ width: 'full', display: 'block' })} />
              </div>
            </Section>
          )}
        </aside>
      </div>
    </Stack>
  );
}
