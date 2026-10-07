// Custom components: patterns with no React Spectrum S2 equivalent. Each one is built from React Aria
// primitives (behavior, accessibility) plus the S2 style macro (tokens only) and S2 components for
// anything inside it. All of them are shown, with the reason they exist, on the /components page.
import type { ReactNode, RefObject } from 'react';
import { Link as AriaLink } from 'react-aria-components/Link';
import { Popover as AriaPopover, OverlayArrow } from 'react-aria-components/Popover';
import { Dialog as AriaDialog } from 'react-aria-components/Dialog';
import { Badge } from '@react-spectrum/s2/Badge';
import { Disclosure, DisclosurePanel, DisclosureTitle } from '@react-spectrum/s2/Disclosure';
import { Image } from '@react-spectrum/s2/Image';
import { Link } from '@react-spectrum/s2/Link';
import { TagGroup, Tag } from '@react-spectrum/s2/TagGroup';
import { css, focusRing, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Code, Kind, Verdict } from './ui';

/* ---------- Panel: a grouped, non-interactive inset inside a section (S2 background layer 1) ---------- */

export function Panel({ title, children, labelledBy }: { title?: ReactNode; children: ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={style({ backgroundColor: 'layer-1', borderRadius: 'lg', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 })}>
      {title && <h3 id={labelledBy} className={style({ font: 'title-sm', margin: 0 })}>{title}</h3>}
      {children}
    </section>
  );
}

/* ---------- Metric tiles: label, value, one line of context; the whole tile navigates ---------- */

export type Metric = { id: string; label: string; value: ReactNode; note?: ReactNode; href?: string; tone?: 'positive' | 'negative' };

const tile = style({
  ...focusRing(),
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  gap: 4,
  padding: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400' },
  backgroundColor: 'elevated',
  textDecoration: 'none',
  color: 'neutral',
  transition: 'default',
  cursor: { default: 'default', isLink: 'pointer' },
});
const tileValue = style({ font: 'title-xl', color: { default: 'title', tone: { positive: 'positive-900', negative: 'negative-900' } } });

export function MetricGrid({ items, label }: { items: Metric[]; label: string }) {
  return (
    <ul aria-label={label} className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 12 })}>
      {items.map((m) => {
        const inner = (
          <>
            <span className={style({ font: 'ui-sm', color: 'neutral-subdued' })}>{m.label}</span>
            <span className={tileValue({ tone: m.tone })}>{m.value}</span>
            {m.note && <span className={style({ font: 'body-xs', color: 'neutral-subdued' })}>{m.note}</span>}
          </>
        );
        return (
          <li key={m.id} className={style({ display: 'flex' })}>
            {m.href
              ? <AriaLink href={m.href} className={(rp) => tile({ ...rp, isLink: true })}>{inner}</AriaLink>
              : <div className={tile({ isLink: false })}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- BarList: dense ranked rows, name left, thin bar, number right; rows navigate ---------- */

export type BarTone = 'reuse' | 'variant' | 'new' | 'plain';
export type BarRow = { id: string; label: ReactNode; textValue: string; value: number; href?: string; tone?: BarTone; right?: ReactNode };

const barRow = style({
  ...focusRing(),
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, 1fr) minmax(40px, 120px) 88px',
  alignItems: 'center',
  columnGap: 12,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  font: 'ui-sm',
  color: 'neutral',
  textDecoration: 'none',
  cursor: { default: 'default', isLink: 'pointer' },
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isPressed: 'gray-200' },
  transition: 'default',
});
const barTrack = style({ height: 6, backgroundColor: 'gray-200', borderRadius: 'full', overflow: 'hidden', display: 'flex' });
const barFill = style({
  height: 'full',
  borderRadius: 'full',
  backgroundColor: { tone: { reuse: 'positive', variant: 'notice', new: 'informative', plain: 'gray-600' } },
});

export function BarList({ rows, max, label }: { rows: BarRow[]; max?: number; label: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className={style({ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' })}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className={style({ truncate: true, fontWeight: 'medium' })}>{r.label}</span>
            <span className={barTrack} aria-hidden>
              {/* width is data, known only at runtime */}
              <span className={barFill({ tone: r.tone ?? 'plain' })} style={{ width: `${(r.value / m) * 100}%` }} />
            </span>
            <span className={style({ textAlign: 'end', color: 'neutral-subdued' })}>{r.right ?? r.value.toLocaleString('en-US')}</span>
          </>
        );
        return (
          <li key={r.id}>
            {r.href
              ? <AriaLink href={r.href} aria-label={`${r.textValue}: ${typeof r.right === 'string' ? r.right : r.value.toLocaleString('en-US')}`} className={(rp) => barRow({ ...rp, isLink: true })}>{inner}</AriaLink>
              : <div className={barRow({ isLink: false })}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- BlockStep: one dense row in a page's ordered block sequence; capture on demand ---------- */

export type BlockStepData = {
  pos: number; kind: string; block?: string; variant?: string | null; verdict?: string | null; nested_in?: string | null;
  section?: string | null; aem?: string[]; crop?: string | null; example?: { crop: string; from: string } | null;
};

const stepRow = style({
  display: 'grid',
  gridTemplateColumns: '24px minmax(0, 1fr)',
  columnGap: 12,
  paddingY: 8,
  paddingStart: { default: 0, isNested: 36 },
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const cropImage = style({ width: 'full', maxHeight: 360, objectFit: 'cover', objectPosition: 'top', borderRadius: 'default', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200' });

export function BlockStep({ step, media }: { step: BlockStepData; media: (key: string) => string }) {
  if (step.kind === 'section') {
    return (
      <div className={style({ display: 'flex', alignItems: 'center', gap: 8, paddingY: 8, paddingStart: 36, font: 'detail', color: 'neutral-subdued' })}>
        <span>Section style</span><Badge variant="neutral" fillStyle="outline">{step.variant}</Badge><span>wraps the next blocks</span>
      </div>
    );
  }
  const isDefault = step.kind === 'default';
  const capture = step.crop ? { src: media(step.crop), note: null } : step.example && !isDefault ? { src: media(step.example.crop), note: `Example from ${step.example.from}. This page was not captured.` } : null;
  return (
    <div className={stepRow({ isNested: !!step.nested_in })}>
      <span className={style({ font: 'ui-sm', color: 'neutral-subdued', paddingTop: 2, textAlign: 'end' })}>{step.pos >= 0 ? step.pos + 1 : '–'}</span>
      <div className={style({ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 })}>
        <div className={style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 })}>
          {isDefault
            ? <span className={style({ font: 'ui', color: 'neutral-subdued' })}>Default content ({step.variant})</span>
            : <>
                <Link href={`/blocks/${step.block}`} isStandalone isQuiet>{step.block}</Link>
                {step.variant && <Badge variant="neutral" fillStyle="subtle">{step.variant}</Badge>}
                <Verdict v={step.verdict} />
                <Kind k={step.kind} />
              </>}
          {step.nested_in && <Badge variant="negative" fillStyle="subtle">Inside {step.nested_in}: needs a fragment</Badge>}
          {step.section && <Badge variant="neutral" fillStyle="outline">{step.section}</Badge>}
          {step.aem && step.aem.length > 0 && <span className={style({ marginStart: 'auto' })}><Code>{step.aem.join(', ')}</Code></span>}
        </div>
        {capture && (
          <Disclosure isQuiet size="S">
            <DisclosureTitle>{capture.note ? 'Example capture' : 'Capture'}</DisclosureTitle>
            <DisclosurePanel>
              <Image src={capture.src} alt={`${step.block ?? 'Default content'} capture`} loading="lazy" styles={cropImage} />
              {capture.note && <p className={style({ font: 'detail-sm', color: 'neutral-subdued', marginTop: 4, marginBottom: 0 })}>{capture.note}</p>}
            </DisclosurePanel>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

/* ---------- VariantRow: a template layout variant with its thumbnail and block tags ---------- */

export type VariantRowData = {
  title: ReactNode; meta: ReactNode; href: string; thumb?: string;
  core: { id: string; label: string; href: string }[];
  optional: { id: string; label: string; href: string }[];
  footer?: ReactNode;
};

const thumbLink = style({ ...focusRing(), display: 'block', borderRadius: 'default', overflow: 'hidden', backgroundColor: 'gray-100', height: 120, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200' });

export function VariantRow({ v }: { v: VariantRowData }) {
  return (
    <article className={style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', md: '160px minmax(0, 1fr)' }, gap: 16, paddingY: 16, borderBottomWidth: 1, borderTopWidth: 0, borderStartWidth: 0, borderEndWidth: 0, borderStyle: 'solid', borderColor: 'gray-200' })}>
      <AriaLink href={v.href} aria-label="Representative page of this variant" className={thumbLink}>
        {v.thumb && <Image src={v.thumb} alt="" loading="lazy" styles={style({ width: 'full', height: 'full', objectFit: 'cover', objectPosition: 'top' })} />}
      </AriaLink>
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 })}>
        <div className={style({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 })}>
          <h3 className={style({ font: 'title', margin: 0 })}>{v.title} <span className={style({ font: 'body-sm', fontWeight: 'normal', color: 'neutral-subdued' })}>{v.meta}</span></h3>
          <Link href={v.href} isStandalone>See URLs</Link>
        </div>
        <TagGroup label="Core blocks" size="S" items={v.core} renderEmptyState={() => 'Default content only'}>
          {(t) => <Tag id={t.id} href={t.href}>{t.label}</Tag>}
        </TagGroup>
        {v.optional.length > 0 && (
          <TagGroup label="Optional blocks (share of pages)" size="S" items={v.optional}>
            {(t) => <Tag id={t.id} href={t.href}>{t.label}</Tag>}
          </TagGroup>
        )}
        {v.footer && <div className={style({ font: 'detail', color: 'neutral-subdued' })}>{v.footer}</div>}
      </div>
    </article>
  );
}

/* ---------- HeatCell: a quantised intensity cell for matrix tables ---------- */

const heat = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'end',
  paddingX: 8,
  minHeight: 24,
  borderRadius: 'sm',
  font: 'ui-sm',
  backgroundColor: { level: { 0: 'transparent', 1: 'blue-100', 2: 'blue-300', 3: 'blue-500', 4: 'blue-700', 5: 'blue-900' } },
  color: { default: 'neutral', isStrong: 'white' },
});

export function HeatCell({ value, max, label, href }: { value: number; max: number; label: string; href?: string }) {
  const level = value ? Math.min(5, Math.max(1, Math.ceil((value / Math.max(1, max)) * 5))) : 0;
  const isStrong = level >= 4;
  return (
    <span className={heat({ level: String(level) as '0', isStrong })}>
      {value ? (href ? <Link href={href} variant="secondary" staticColor={isStrong ? 'white' : undefined}>{label}</Link> : label) : ''}
    </span>
  );
}

/* ---------- TourBubble: dark, slightly transparent coachmark for the onboarding tour ---------- */
// S2 has no coachmark and the S2 Popover's background can't be restyled, so this is the React Aria
// Popover + Dialog with Spectrum tokens: a static near-black translucent surface with white content, the same in
// light and dark mode so the tour reads as guidance layered over the app rather than part of it.

const bubble = style({
  backgroundColor: 'transparent-black-900',
  color: 'white',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent-white-300',
  boxShadow: 'elevated',
  padding: 16,
  width: 360,
  maxWidth: '[calc(100vw - 32px)]',
  outlineStyle: 'none',
  opacity: { default: 1, isEntering: 0, isExiting: 0 },
  transition: 'opacity',
  transitionDuration: 150,
});
const bubbleBlur = css('backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);');
const bubbleArrow = style({ fill: 'transparent-black-900', display: 'block', rotate: { placement: { top: 0, bottom: 180, left: -90, right: 90 } } });

export function TourBubble({ triggerRef, placement, label, onClose, children }: {
  triggerRef: RefObject<Element | null>; placement: 'top' | 'bottom' | 'left' | 'right'; label: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <AriaPopover triggerRef={triggerRef} isOpen placement={placement} offset={12} onOpenChange={(open) => { if (!open) onClose(); }}
      className={(rp) => `${bubble(rp)} ${bubbleBlur}`}>
      <OverlayArrow>
        {({ placement: p }) => (
          <svg width={14} height={8} viewBox="0 0 14 8" className={bubbleArrow({ placement: (p ?? 'top') as 'top' })} aria-hidden><path d="M0 0 L7 8 L14 0 Z" /></svg>
        )}
      </OverlayArrow>
      <AriaDialog aria-label={label} className={style({ outlineStyle: 'none' })}>{children}</AriaDialog>
    </AriaPopover>
  );
}
