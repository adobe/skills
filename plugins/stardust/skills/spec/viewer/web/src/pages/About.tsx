import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Link } from '@react-spectrum/s2/Link';
import { fmt } from '../api';
import { restartTour } from '../tour';
import { rich } from '../richtext';
import { useSite } from '../site';
import { Loading, PageHeader, Section, Stack, useApi } from '../ui';

export default function About() {
  const { data } = useApi('/api/overview');
  const site = useSite();
  if (!data) return <Loading />;
  const m = data.meta;
  const sitemapUrls = Number(m.sitemap_urls) > 0 ? fmt(Number(m.sitemap_urls)) : 'the';
  const scope = site.scopePath === '/' ? 'site' : site.scopePath;
  return (
    <div className={style({ maxWidth: 960 })}><Stack>
      <PageHeader title="Method and caveats" description="An AI agent produced this scope from the public site only, without using output from any migration work. The explorer is read-only, and the chat queries the same database." />

      <Section title="How it was built"><div className={rich.flow}>
      <ol className={rich.ol}>
        <li><strong className={rich.strong}>Inventory.</strong> {`The ${sitemapUrls} URLs of the ${scope} sitemap of ${site.name}, plus links found inside pages that are in the scope but not in the sitemap.`}</li>
        <li><strong className={rich.strong}>Fetch.</strong> Every URL fetched without following redirects automatically, so each hop and the final status are recorded. The page template comes from the template rule in the scope configuration.</li>
        <li><strong className={rich.strong}>Link check.</strong> Every internal page and asset link found on the pages was checked (HEAD, then GET).</li>
        {site.rum
          ? <li><strong className={rich.strong}>Real-user telemetry.</strong> {`${m.rum_window ?? '90 days'}, ${fmt(Number(m.rum_bundles) || 0)} sampled human page views from AEM Operational Telemetry (RUM).`} It gives traffic per page and real 404s. Sampling is about 1 in 100, so traffic numbers are estimates and small pages can show 0.</li>
          : <li><strong className={rich.strong}>Real-user telemetry.</strong> Not available for this site. Traffic per page, real-user 404s and redirect landings are not part of this scope, and pages are not ranked by traffic.</li>}
        <li><strong className={rich.strong}>Components.</strong> The component tree of each page's main area was parsed from the server HTML.</li>
        <li><strong className={rich.strong}>Block mapping.</strong> Each source component pattern was mapped to an EDS block and variant, to default content, or to a section style. The rules were set by the agent after reviewing crops of every component type, for example "a one-slide carousel is a hero" or "three image+text columns are cards".</li>
        <li><strong className={rich.strong}>Reuse.</strong> {`Each block was compared with ${site.refPhrase}: reuse as-is, variant (existing block plus a new variant/CSS), or new.`}</li>
        <li><strong className={rich.strong}>Layout variants.</strong> Within a template, pages were clustered by the set of blocks they need{m.variant_cut ? ` (${m.variant_cut})` : ''}. When pages of one template combine blocks freely, the template has several variants.</li>
        <li><strong className={rich.strong}>Visuals.</strong> Representative pages were captured at 1440px; block crops come from those captures. Pages that were not captured show an example crop of the same block from another page.</li>
      </ol>

      </div></Section>
      <Section title="Definitions"><div className={rich.flow}>
      <ul className={rich.ul}>
        <li><strong className={rich.strong}>Live page</strong>: answers 200 directly. Redirecting sitemap URLs are not pages to build, but they need redirect entries.</li>
        <li><strong className={rich.strong}>Legacy redirect</strong>: exists on the current site today. <strong className={rich.strong}>Migration redirect</strong>: needed because the EDS path differs from the current path beyond dropping <code className={rich.code}>.html</code> (EDS paths are lowercase, with no <code className={rich.code}>_</code> and no double dashes).</li>
        <li><strong className={rich.strong}>Nested blocks</strong>: the current site puts tables, resource cards or columns inside tabs and accordions. EDS blocks cannot nest, so those panels become fragments.</li>
        <li><strong className={rich.strong}>Data-driven blocks</strong>: lists rendered from an index or by client-side code (grids, news lists, directories, remote apps). They need data and integration work beyond markup.</li>
      </ul>

      </div></Section>
      <Section title="Caveats"><div className={rich.flow}>
      <ul className={rich.ul}>
        <li>Block mapping and reuse verdicts are a <strong className={rich.strong}>proposal</strong> to discuss, not a decision. They are applied consistently, so changing a rule changes every page at once.</li>
        <li>Default content (text, headings, images, buttons) is listed per page but is not counted as blocks.</li>
        <li>Client-rendered components have no server HTML. They are detected and flagged, but their inner structure is unknown.</li>
        {site.rum
          ? <li>Telemetry shows 404s that users actually hit, but not redirect sources; the "used by real users" redirect list shows landing pages only.</li>
          : <li>Real-user telemetry was not available for this site, so traffic, real-user 404s and redirect landings are not shown.</li>}
        {m.blind_rule && <li>{String(m.blind_rule).replace(/\.$/, '')}.</li>}
      </ul>
      </div></Section>
      {(m.built_at || m.built_by) && <p className={style({ font: 'body-xs', color: 'neutral-subdued', margin: 0 })}>{['Built', m.built_at, m.built_by && `· ${m.built_by}`].filter(Boolean).join(' ')}</p>}
      <p className={rich.p}>New here? <Link onPress={restartTour}>Show the tour again</Link>.</p>
    </Stack></div>
  );
}
