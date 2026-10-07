// Implementation layer: how each part of the site must be built on EDS (stardust:dynamics taxonomy),
// and the migration spec generated from it. Data: /api/features, /api/questions, /api/martech, /api/spec.*
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '@react-spectrum/s2/Badge';
import { LabeledValue } from '@react-spectrum/s2/LabeledValue';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { StatusLight } from '@react-spectrum/s2/StatusLight';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { ToggleButtonGroup, ToggleButton } from '@react-spectrum/s2/ToggleButtonGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt, fmtViews } from '../api';
import { BarList, MetricGrid, Panel, type Metric } from '../custom';
import { Markdown } from '../richtext';
import { useSite } from '../site';
import { BodyText, Detail, EmptyState, Loading, PageHeader, Section, Stack, useApi } from '../ui';

/* ---------- shared vocabulary ---------- */

export const CLASS_LABEL: Record<string, string> = {
  L: 'Listing', S: 'Search', F: 'Form', M: 'Modal / interaction', V: 'Media', T: 'Tag / consent', A: 'API / settings',
  R: 'Relationship', X: 'Auth / commerce', I18N: 'Locale', CR: 'Client-rendered', D: 'Data file',
};
const DISPOSITION: Record<string, string> = {
  'rebuild-native': 'Rebuild natively', 'index-backed': 'Query index', 'data-fed': 'Data feed', 'embed-passthrough': 'Embed as-is',
  'client-only': 'Client-side only', 'static-snapshot': 'Static snapshot', 'decided-out': 'Not migrated',
};
type Light = 'positive' | 'notice' | 'negative' | 'informative' | 'neutral';
const REPRO: Record<string, { label: string; light: Light }> = {
  self: { label: 'Ships autonomously', light: 'positive' },
  'needs-credential': { label: 'Needs a credential', light: 'notice' },
  'needs-backend': { label: 'Needs a backend', light: 'negative' },
  'needs-human-capture': { label: 'Needs a human capture', light: 'notice' },
  'needs-business-decision': { label: 'Needs a decision', light: 'informative' },
};

export function Repro({ r }: { r: string }) {
  const d = REPRO[r] ?? { label: r, light: 'neutral' as Light };
  return <StatusLight size="S" variant={d.light}>{d.label}</StatusLight>;
}
export const Disposition = ({ d }: { d: string }) => <Badge size="S" variant="neutral" fillStyle="subtle">{DISPOSITION[d] ?? d}</Badge>;
export const ClassBadge = ({ c }: { c: string }) => <Badge size="S" variant="indigo" fillStyle="subtle">{`${c} · ${CLASS_LABEL[c] ?? c}`}</Badge>;
const reach = (f: any) => (f.sitewide ? 'Site-wide' : `${fmt(f.reach_pages)} pages`);
const parse = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return s; } };

/* ---------- overview ---------- */

export function ImplementationOverview() {
  const f = useApi<any[]>('/api/features');
  const q = useApi<any[]>('/api/questions');
  const m = useApi<any>('/api/martech');
  const l = useApi<any>('/api/locales');
  const site = useSite();
  if (!f.data || !q.data || !m.data || !l.data) return <Loading />;
  const feats = f.data; const qs = q.data; const rules = m.data.rules;
  const nonSelf = feats.filter((x) => x.reproducibility !== 'self');
  const trees = l.data.trees;
  // site-wide features fill the bar: scale them to the widest page-level reach
  const fullReach = Math.max(1, ...feats.map((x) => Number(x.reach_pages) || 0));
  const metrics: Metric[] = [
    { id: 'features', label: 'Dynamic features', value: feats.length, note: `${feats.filter((x) => x.sitewide).length} site-wide · ${nonSelf.length} need something external`, href: '/features' },
    { id: 'questions', label: 'Open questions', value: qs.length, note: `${qs.filter((x) => x.blocking).length} blocking · ${qs.filter((x) => x.status === 'open').length} unanswered`, href: '/questions', tone: qs.some((x) => x.blocking && x.status === 'open') ? 'negative' : undefined },
    { id: 'rules', label: 'Launch rules to rewrite', value: rules.filter((r: any) => r.needs_rewrite).length, note: `of ${rules.length}; ${rules.filter((r: any) => r.kind === 'campaign' && !r.live_pages).length} target dead pages`, href: '/martech?tab=rules', tone: 'negative' },
    { id: 'datalayer', label: 'Data-layer fields', value: m.data.datalayer.length, note: 'Must be emitted from page metadata', href: '/martech?tab=datalayer' },
    { id: 'vendors', label: 'Third-party hosts', value: m.data.vendors.length, note: `${m.data.vendors.filter((v: any) => v.consent_group).length} mapped to a consent category`, href: '/martech?tab=vendors' },
    { id: 'trees', label: 'Locale trees', value: trees.length, note: `${fmt(trees.reduce((a: number, t: any) => a + t.urls, 0))} URLs across all countries`, href: '/locales' },
  ];
  const counts: Record<string, number> = {};
  feats.forEach((x) => { counts[x.disposition] = (counts[x.disposition] ?? 0) + 1; });
  const byDisp = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <Stack>
      <PageHeader title="Implementation"
        description={`How each part of ${site.name} has to be built on Edge Delivery Services: dynamic features, integrations, martech, data and locales. The migration spec collects all of it, with the open decisions, for an autonomous migration agent.`}
        actions={<>
          <LinkButton variant="primary" size="S" href="/spec"><Text>Open the migration spec</Text></LinkButton>
          <LinkButton variant="secondary" size="S" href="/api/spec.json?download=1" download><Download /><Text>spec.json</Text></LinkButton>
        </>} />
      <Section id="impl-metrics" title="At a glance" ask={['What are the biggest implementation risks, and which open questions block them?', 'Which features cannot ship without something from the stakeholder?']}>
        <MetricGrid label="Implementation at a glance" items={metrics} />
      </Section>
      <Section id="decision-batch" title="Decision batch" count={nonSelf.length} description="Features that cannot ship autonomously. Each needs a credential, a backend, a capture or a business decision; until then the migration ships the interim behaviour named in the feature.">
        <BarList label="Features that need something external" rows={nonSelf.map((x) => ({ id: x.id, label: `${x.name} · ${(REPRO[x.reproducibility]?.label ?? x.reproducibility).toLowerCase()}`, textValue: x.name, value: x.sitewide ? fullReach : Number(x.reach_pages) || 0, href: `/features/${x.id}`, tone: 'new' as const, right: reach(x) }))} />
      </Section>
      <Section id="by-disposition" title="Features by disposition" description="What the migration does with each feature.">
        <BarList label="Features by disposition" rows={byDisp.map(([d, n]) => ({ id: d, label: DISPOSITION[d] ?? d, textValue: d, value: n, href: `/features?disposition=${d}` }))} />
      </Section>
    </Stack>
  );
}

/* ---------- features list ---------- */

export function Features() {
  const { data } = useApi<any[]>('/api/features');
  const [params, setParams] = useSearchParams();
  const repro = params.get('reproducibility');
  const disp = params.get('disposition');
  if (!data) return <Loading />;
  const rows = data.filter((f) => (!repro || f.reproducibility === repro) && (!disp || f.disposition === disp));
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  return (
    <Stack>
      <PageHeader crumbs={[{ label: 'Implementation', href: '/implementation' }]} title="Dynamic features"
        description="Everything the site renders from JavaScript, a service or a data source, classified with the stardust dynamics taxonomy: class, disposition, what it needs to ship, and how to build it on EDS."
        actions={<LinkButton variant="secondary" size="S" href="/api/export/features.csv" download><Download /><Text>Download CSV</Text></LinkButton>} />
      <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' })}>
        <ToggleButtonGroup aria-label="Filter by what a feature needs" size="S" selectionMode="single" selectedKeys={repro ? [repro] : []}
          onSelectionChange={(k) => setParam('reproducibility', [...k][0] ? String([...k][0]) : null)}>
          {Object.entries(REPRO).map(([id, r]) => <ToggleButton key={id} id={id}>{r.label}</ToggleButton>)}
        </ToggleButtonGroup>
        {disp && <Badge variant="neutral" fillStyle="outline">{`Disposition: ${DISPOSITION[disp] ?? disp}`}</Badge>}
        {(repro || disp) && <Link href="/features" isStandalone>Clear filters</Link>}
      </div>
      <Section id="feature-list" title="Features" count={rows.length} flush ask={['How should site search be implemented, and what index does it need?']}>
        <TableView aria-labelledby="feature-list-title" isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="name" isRowHeader minWidth={220}>Feature</Column>
            <Column id="class" width={190}>Class</Column>
            <Column id="reach" align="end" width={104}>Reach</Column>
            <Column id="disposition" width={150}>Disposition</Column>
            <Column id="needs" width={190}>To ship</Column>
            <Column id="decisions" width={150}>Decisions</Column>
          </TableHeader>
          <TableBody items={rows} renderEmptyState={() => <EmptyState title="No features match these filters" />}>
            {(f: any) => (
              <Row id={f.id} href={`/features/${f.id}`} textValue={f.name}>
                <Cell><span className={style({ font: 'ui', fontWeight: 'bold' })}>{f.name}</span></Cell>
                <Cell><ClassBadge c={f.class} /></Cell>
                <Cell align="end">{reach(f)}</Cell>
                <Cell><Disposition d={f.disposition} /></Cell>
                <Cell><Repro r={f.reproducibility} /></Cell>
                <Cell><Detail>{(parse(f.decisions) as string[]).join(', ') || '–'}</Detail></Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      </Section>
    </Stack>
  );
}

/* ---------- feature detail ---------- */

const facts = style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 24 });

export function FeatureDetail() {
  const { id } = useParams();
  const { data, error } = useApi<any>(`/api/features/${id}`);
  const { rum } = useSite();
  if (error) return <EmptyState title="This feature does not exist" />;
  if (!data) return <Loading />;
  const f = data.feature;
  return (
    <Stack>
      <PageHeader crumbs={[{ label: 'Implementation', href: '/implementation' }, { label: 'Dynamic features', href: '/features' }]} title={f.name}
        description={<span className={style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' })}><ClassBadge c={f.class} /><Disposition d={f.disposition} /><Repro r={f.reproducibility} /></span>}
        actions={<LinkButton variant="secondary" size="S" href={`/urls?feature=${f.id}`}><Text>{f.sitewide ? 'All live pages' : `See the ${fmt(f.reach_pages)} pages`}</Text></LinkButton>} />
      <Section id="feature-facts" title="Facts">
        <div className={facts}>
          <LabeledValue label="Reach" value={f.sitewide ? 'Every page (site-wide)' : `${fmt(f.reach_pages)} pages in ${f.reach_templates} templates`} />
          {rum && <LabeledValue label="Traffic on those pages, 90 days" value={`about ${fmtViews(f.pageviews_90d)}`} />}
          <LabeledValue label="Pattern" value={f.pattern} />
        </div>
      </Section>
      <Section id="feature-eds" title="How to build it on EDS" ask={[`How should "${f.name}" be implemented, step by step?`]}>
        <Panel><BodyText>{f.eds}</BodyText></Panel>
      </Section>
      <Section id="feature-evidence" title="Evidence on the current site">
        <BodyText>{f.evidence}</BodyText>
      </Section>
      {data.questions.length > 0 && (
        <Section id="feature-questions" title="Open questions" count={data.questions.length} description="Until these are answered, the migration ships the default assumption.">
          <ul className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 })}>
            {data.questions.map((q: any) => (
              <li key={q.id} className={style({ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' })}>
                <Link href={`/questions?focus=${q.id}`} isStandalone isQuiet>{q.id}</Link>
                <span className={style({ font: 'body-sm' })}>{q.question}</span>
                {q.blocking ? <Badge size="S" variant="negative" fillStyle="subtle">Blocking</Badge> : null}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.templates.length > 0 && (
        <Section id="feature-templates" title="Where it appears, by template" count={data.templates.length}>
          <BarList label="Pages by template" rows={data.templates.map((t: any) => ({ id: t.aem_template, label: t.aem_template, textValue: t.aem_template, value: t.n, href: `/urls?feature=${f.id}&template=${encodeURIComponent(t.aem_template)}` }))} />
        </Section>
      )}
    </Stack>
  );
}

/* ---------- migration spec ---------- */

export function SpecPage() {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/spec.md', { signal: ctrl.signal }).then((r) => (r.ok ? r.text() : '')).then(setSource).catch(() => !ctrl.signal.aborted && setSource(''));
    return () => ctrl.abort();
  }, []);
  return (
    <Stack>
      <PageHeader crumbs={[{ label: 'Implementation', href: '/implementation' }]} title="Migration spec"
        description="Generated live from the scope database. Each open question shows its effective decision: the recorded answer, or the default assumption a hands-off migration ships. The JSON version is the contract for an autonomous migration agent."
        actions={<>
          <LinkButton variant="secondary" size="S" href="/api/spec.md?download=1" download><Download /><Text>MIGRATION-SPEC.md</Text></LinkButton>
          <LinkButton variant="secondary" size="S" href="/api/spec.json?download=1" download><Download /><Text>migration-spec.json</Text></LinkButton>
        </>} />
      <Section id="spec-body">
        {source === null ? <Loading label="Generating the spec" /> : source ? <Markdown source={source} /> : <EmptyState title="The spec could not be generated" />}
      </Section>
    </Stack>
  );
}
