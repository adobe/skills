import type { ReactNode } from 'react';
import { Badge } from '@react-spectrum/s2/Badge';
import { LabeledValue } from '@react-spectrum/s2/LabeledValue';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { BarList, BlockStep, HeatCell, MetricGrid, Panel, VariantRow } from '../custom';
import { PageHeader, Section, Stack } from '../ui';
import { Button } from '@react-spectrum/s2/Button';
import { restartTour } from '../tour';

// Placeholder thumbnail for the demos: a neutral S2-coloured square, so the page needs no data.
const demoImage = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e1e1e1"/><rect x="40" y="40" width="560" height="120" rx="8" fill="#c6c6c6"/><rect x="40" y="200" width="260" height="240" rx="8" fill="#c6c6c6"/><rect x="340" y="200" width="260" height="240" rx="8" fill="#c6c6c6"/></svg>');

function Spec({ id, name, why, builtWith, critique, children }: { id: string; name: string; why: string; builtWith: string; critique?: string; children: ReactNode }) {
  return (
    <Section id={id} title={name}>
    <div className={style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', xl: '300px minmax(0, 1fr)' }, gap: 24 })}>
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
        <LabeledValue label="Why it's custom" value={why} />
        <LabeledValue label="Built with" value={builtWith} />
        {critique && <LabeledValue label="Open questions" value={critique} />}
      </div>
      <div className={style({ minWidth: 0, padding: 16, borderRadius: 'lg', borderWidth: 1, borderStyle: 'dashed', borderColor: 'gray-300' })}>{children}</div>
    </div>
    </Section>
  );
}

const USED = ['Provider', 'SideNav', 'Breadcrumbs', 'TableView', 'CardView', 'Card', 'TagGroup', 'Tabs', 'ToggleButtonGroup', 'Picker', 'SearchField', 'Badge', 'StatusLight', 'LabeledValue', 'InlineAlert', 'IllustratedMessage', 'ProgressCircle', 'Image', 'Link', 'LinkButton', 'Button', 'ButtonGroup', 'ActionButton', 'Tooltip', 'Popover', 'Toast', 'Disclosure', 'Accordion', 'Dialog', 'Form', 'TextField', 'TextArea', 'RadioGroup', 'AI: Chat, Thread, UserMessage, ResponseStatus, ExecutionTrace, MessageSuggestion, PromptField, Alert, AIButton'];

export default function Components() {
  return (
    <Stack>
      <PageHeader
        title="Custom components"
        description="Everything else in this app is a React Spectrum S2 component. These patterns have no S2 equivalent, so they are built from React Aria primitives and the S2 style macro, using Spectrum tokens only. Review them here, in isolation." />

      <Section id="used" title="S2 components used in this app" count={USED.length}>
        <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 8 })}>
          {USED.map((c) => <Badge key={c} variant="neutral" fillStyle="subtle">{c}</Badge>)}
        </div>
      </Section>

      <Spec id="c-section" name="Section card"
        why="The Sites Optimizer frame groups each page into white cards on a gray page, with a title, a count and inline AI suggestions. S2 has no page-section container."
        builtWith="section element, style macro: backgroundColor elevated, borderRadius xl, gray-200 border, padding 16/24; S2 Badge for the count; MessageSuggestion chips from @react-spectrum/ai."
        critique="Border or soft shadow? Should inline suggestions be limited to one or two per section?">
        <Section id="demo-section" title="Blocks by pages" count={29} description="Build once, reuse on many pages." ask={['Which new blocks unlock the most pages?']}>
          <span className={style({ font: 'body-sm' })}>Section content.</span>
        </Section>
      </Spec>

      <Spec id="c-barlist" name="Bar list"
        why="S2 has no bar chart. Meter shows one quantity with a label; this compares many ranked quantities, and each row navigates."
        builtWith="React Aria Link (focus, keyboard, routing), style macro tokens: semantic fills positive, notice, informative; gray-200 track; focusRing()."
        critique="Should this move to React Spectrum Charts once it supports S2? Are semantic colors right for reuse verdicts, or should they be categorical?">
        <BarList label="Demo bar list" rows={[
          { id: 'a', label: 'hero', textValue: 'hero', value: 1200, tone: 'reuse', href: '/components' },
          { id: 'b', label: 'cards', textValue: 'cards', value: 860, tone: 'variant', href: '/components' },
          { id: 'c', label: 'product-grid', textValue: 'product-grid', value: 410, tone: 'new', href: '/components' },
          { id: 'd', label: 'Not a link', textValue: 'Not a link', value: 120 },
        ]} />
      </Spec>

      <Spec id="c-kpi" name="Metric tile"
        why="S2 Card has asset, user, product and collection layouts but no metric layout, and CardView sizes cards to fixed widths. Tiles fill a responsive grid; the whole tile is a link."
        builtWith="React Aria Link, style macro: elevated background, gray-200 border that darkens on hover, focusRing(); fonts ui-sm label, title-xl value, body-xs note."
        critique="Add a thin trend bar or delta, like the Brand Visibility cards?">
        <MetricGrid label="Demo metrics" items={[
          { id: '1', value: '2,876', label: 'Live pages to migrate', note: 'of 3,102 sitemap URLs', href: '/components' },
          { id: '2', value: '41', label: 'EDS blocks proposed', note: '18 reuse · 9 variant · 14 new', href: '/components' },
          { id: '3', value: '312', label: '404s hit by real users', note: 'Plus 1,204 dead links', tone: 'negative' },
        ]} />
      </Spec>

      <Spec id="c-panel" name="Panel"
        why="A grouped, non-interactive inset inside a section. Card is for objects you select or open, so it doesn't fit."
        builtWith="section element, style macro: backgroundColor layer-1, borderRadius lg, padding 16. Children are S2 components (LabeledValue)."
        critique="Browsing context uses base, then layer-1. Is a panel needed at all, or should spacing alone group these facts?">
        <Panel title="Page facts" labelledBy="demo-panel">
          <LabeledValue label="Template" value="product-detail" />
          <LabeledValue label="Views, 90 days" value="About 12k" />
        </Panel>
      </Spec>

      <Spec id="c-blockstep" name="Block sequence step"
        why="One dense row in a page's ordered list of blocks; the capture opens on demand. ListView rows can't hold badges, a link and an expandable image together."
        builtWith="ol and li, style macro row with a gray-200 rule; S2 Link, Badge, quiet Disclosure and Image."
        critique="Should the capture open in a side panel instead, so the sequence never reflows?">
        <ol className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 })}>
          <li><BlockStep media={() => demoImage} step={{ pos: 0, kind: 'block', block: 'hero', variant: 'dark', verdict: 'reuse', aem: ['carousel'], crop: 'demo' }} /></li>
          <li><BlockStep media={() => demoImage} step={{ pos: -1, kind: 'section', variant: 'gray-background' }} /></li>
          <li><BlockStep media={() => demoImage} step={{ pos: 1, kind: 'default', variant: 'text and image' }} /></li>
          <li><BlockStep media={() => demoImage} step={{ pos: 2, kind: 'block', block: 'table', verdict: 'new', nested_in: 'tabs', aem: ['table'] }} /></li>
        </ol>
      </Spec>

      <Spec id="c-variantrow" name="Layout variant row"
        why="A template variant: representative thumbnail, counts, and two groups of linked block tags. A Card can't contain other links."
        builtWith="article, style macro grid (one column below md), React Aria Link around an S2 Image, S2 TagGroup with href tags, S2 Link."
        critique="Would a TableView with expandable rows be clearer when a template has more than 10 variants?">
        <VariantRow v={{
          title: 'Variant 1', meta: '312 pages (46%) · 40k views', href: '/components', thumb: demoImage,
          core: [{ id: 'hero', label: 'hero', href: '/components' }, { id: 'cards', label: 'cards · 3-up', href: '/components' }],
          optional: [{ id: 'tabs', label: 'tabs 22%', href: '/components' }],
          footer: 'Representative: /products/example.html · 7 distinct block combinations',
        }} />
      </Spec>

      <Spec id="c-heatcell" name="Heat cell"
        why="Matrix answers from the chat (rows by columns, with counts) need an intensity cue. TableView cells take free-form content, but S2 has no heatmap."
        builtWith="span inside a TableView Cell, style macro: five steps of the blue scale (blue-100 to blue-900), white text and a static white Link on the two darkest steps."
        critique="Is blue right, or should the scale follow the reuse verdict color? Five steps or three?">
        <TableView aria-label="Demo matrix" density="compact" styles={style({ width: 'full' })}>
          <TableHeader>
            <Column id="row" isRowHeader>Template</Column>
            <Column id="a" align="end">hero</Column>
            <Column id="b" align="end">cards</Column>
            <Column id="c" align="end">tabs</Column>
          </TableHeader>
          <TableBody>
            <Row id="r1"><Cell>product-detail</Cell><Cell align="end"><HeatCell value={600} max={600} label="600" href="/components" /></Cell><Cell align="end"><HeatCell value={240} max={600} label="240" /></Cell><Cell align="end"><HeatCell value={30} max={600} label="30" /></Cell></Row>
            <Row id="r2"><Cell>article</Cell><Cell align="end"><HeatCell value={120} max={600} label="120" /></Cell><Cell align="end"><HeatCell value={0} max={600} label="0" /></Cell><Cell align="end"><HeatCell value={420} max={600} label="420" /></Cell></Row>
          </TableBody>
        </TableView>
      </Spec>

      <Spec id="c-tourbubble" name="Tour bubble"
        why="The first-visit tour must read as guidance layered over the app, not as app content. S2 has no coachmark, and the S2 Popover's background cannot be restyled."
        builtWith="React Aria Popover + OverlayArrow + Dialog, style macro: transparent-black-900 surface, transparent-white-300 hairline border, 6px backdrop blur, white text, S2 Buttons and ActionButton with staticColor white. Same look in light and dark mode."
        critique="Should the tour dim the rest of the page (spotlight), or is the dark bubble enough?">
        <Button variant="secondary" onPress={restartTour}>Preview the tour</Button>
      </Spec>
    </Stack>
  );
}
