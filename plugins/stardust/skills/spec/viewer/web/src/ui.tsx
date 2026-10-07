// Shared building blocks: S2 components and thin compositions of them. Custom visuals live in
// ./custom and are listed on /components. Frame: gray page, white section cards (Sites Optimizer).
import { useEffect, useState, type ReactNode } from 'react';
import { MessageSuggestion } from '@react-spectrum/ai';
import { Badge } from '@react-spectrum/s2/Badge';
import { Breadcrumbs, Breadcrumb } from '@react-spectrum/s2/Breadcrumbs';
import { IllustratedMessage, Heading, Content as MessageContent } from '@react-spectrum/s2/IllustratedMessage';
import { ProgressCircle } from '@react-spectrum/s2/ProgressCircle';
import { StatusLight } from '@react-spectrum/s2/StatusLight';
import { useAsyncList } from '@react-spectrum/s2/useAsyncList';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import NoSearchResults from '@react-spectrum/s2/illustrations/linear/NoSearchResults';
import { get } from './api';
import { askScope } from './ask';

export function useApi<T = any>(path: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    get<T>(path).then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e) => live && setState({ data: null, error: String(e), loading: false }));
    return () => { live = false; };
  }, [path]);
  return state;
}

// Server-paged list for TableView infinite scrolling. Key the consuming component by `path` so a
// filter change starts a fresh list.
export function useServerList<T extends { id?: unknown }>(path: string, pageSize = 50) {
  const [total, setTotal] = useState<number | null>(null);
  const list = useAsyncList<T>({
    async load({ signal, cursor }) {
      const offset = cursor ? Number(cursor) : 0;
      const sep = path.includes('?') ? '&' : '?';
      const data = await get<{ rows: T[]; total: number }>(`${path}${sep}limit=${pageSize}&offset=${offset}`, signal);
      setTotal(data.total);
      const next = offset + data.rows.length;
      return { items: data.rows, cursor: next < data.total ? String(next) : undefined };
    },
  });
  return { list, total };
}

export const Loading = ({ label = 'Loading' }: { label?: string }) => (
  <div className={style({ display: 'flex', justifyContent: 'center', paddingY: 64 })}>
    <ProgressCircle isIndeterminate aria-label={label} />
  </div>
);

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <IllustratedMessage>
      <NoSearchResults />
      <Heading>{title}</Heading>
      {children && <MessageContent>{children}</MessageContent>}
    </IllustratedMessage>
  );
}

const VERDICTS = {
  reuse: { variant: 'positive', label: 'Reuse', long: 'Reuse a reference block as-is' },
  variant: { variant: 'notice', label: 'Variant', long: 'Variant of a reference block' },
  new: { variant: 'informative', label: 'New', long: 'New block' },
} as const;
type VerdictKey = keyof typeof VERDICTS;
export const verdictLabel = (v: string) => VERDICTS[v as VerdictKey]?.long ?? v;

export function Verdict({ v }: { v?: string | null }) {
  const d = v ? VERDICTS[v as VerdictKey] : null;
  if (!d) return null;
  return <Badge variant={d.variant} fillStyle="subtle">{d.label}</Badge>;
}

export function Kind({ k }: { k?: string | null }) {
  if (k === 'dynamic') return <Badge variant="cyan" fillStyle="subtle">Data-driven</Badge>;
  if (k === 'global') return <Badge variant="gray" fillStyle="subtle">Site chrome</Badge>;
  return null;
}

export function Legend() {
  return (
    <div className={style({ display: 'flex', flexWrap: 'wrap', columnGap: 16 })}>
      {(Object.keys(VERDICTS) as VerdictKey[]).map((k) => <StatusLight key={k} size="S" variant={VERDICTS[k].variant}>{VERDICTS[k].long}</StatusLight>)}
    </div>
  );
}

export type Crumb = { label: string; href?: string };

export function PageHeader({ crumbs, title, description, actions }: { crumbs?: Crumb[]; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={style({ display: 'flex', flexWrap: 'wrap', alignItems: 'end', justifyContent: 'space-between', gap: 16, paddingTop: 8 })}>
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexGrow: 1, flexBasis: 0 })}>
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumbs">
            <Breadcrumbs aria-label="Breadcrumbs" styles={style({ width: 'full' })}>{crumbs.map((c) => <Breadcrumb key={c.label} id={c.label} href={c.href}>{c.label}</Breadcrumb>)}</Breadcrumbs>
          </nav>
        )}
        <h1 className={style({ font: 'heading-lg', margin: 0, overflowWrap: 'anywhere' })}>{title}</h1>
        {description && <div className={style({ font: 'body-sm', color: 'neutral-subdued', maxWidth: 880 })}>{description}</div>}
      </div>
      {actions && <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 8 })}>{actions}</div>}
    </header>
  );
}

// Inline AI suggestions: each chip opens the chat with its question.
export function AskChips({ questions }: { questions: string[] }) {
  return (
    <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 8 })}>
      {questions.map((q) => <MessageSuggestion key={q} size="S" onPress={() => askScope(q)}>{q}</MessageSuggestion>)}
    </div>
  );
}

const sectionBody = style({ minWidth: 0, marginX: { default: 0, isFlush: { default: -16, lg: -24 } } });

// The page's unit of grouping: a white card with a title, an optional count, a one-line
// description, actions on the right and AI suggestions under the header.
export function Section({ id, title, count, description, actions, ask, children, flush }: {
  id?: string; title?: ReactNode; count?: ReactNode; description?: ReactNode; actions?: ReactNode; ask?: string[]; children: ReactNode; flush?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section aria-labelledby={title ? headingId : undefined} className={style({
      backgroundColor: 'elevated', borderRadius: 'xl', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200',
      padding: { default: 16, lg: 24 }, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0,
    })}>
      {(title || actions) && (
        <div className={style({ display: 'flex', flexWrap: 'wrap', alignItems: 'start', justifyContent: 'space-between', gap: 12 })}>
          <div className={style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 })}>
            {title && (
              <div className={style({ display: 'flex', alignItems: 'center', gap: 8 })}>
                <h2 id={headingId} className={style({ font: 'title-lg', margin: 0 })}>{title}</h2>
                {count !== undefined && count !== null && <Badge variant="neutral" fillStyle="subtle">{count}</Badge>}
              </div>
            )}
            {description && <p className={style({ font: 'body-sm', color: 'neutral-subdued', margin: 0, maxWidth: 880 })}>{description}</p>}
          </div>
          {actions && <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 8 })}>{actions}</div>}
        </div>
      )}
      {ask && ask.length > 0 && <AskChips questions={ask} />}
      <div className={sectionBody({ isFlush: !!flush })}>{children}</div>
    </section>
  );
}

// Vertical rhythm between the page header and its sections.
export const Stack = ({ children }: { children: ReactNode }) => <div className={style({ display: 'flex', flexDirection: 'column', gap: 24 })}>{children}</div>;
export const Columns = ({ children }: { children: ReactNode }) => (
  <div className={style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', '2xl': 'repeat(2, minmax(0, 1fr))' }, gap: 24, alignItems: 'start' })}>{children}</div>
);

// Supporting text next to S2 components. Paths are set in Adobe Clean; only real code is monospace.
export const Detail = ({ children }: { children: ReactNode }) => <span className={style({ font: 'detail', color: 'neutral-subdued' })}>{children}</span>;
const pathText = style({ font: 'ui', fontWeight: { default: 'normal', isStrong: 'bold' }, overflowWrap: 'anywhere' });
export const PathText = ({ children, strong }: { children: ReactNode; strong?: boolean }) => <span className={pathText({ isStrong: !!strong })}>{children}</span>;
export const Code = ({ children }: { children: ReactNode }) => <span className={style({ font: 'code-xs', color: 'neutral-subdued', overflowWrap: 'anywhere' })}>{children}</span>;
export const BodyText = ({ children }: { children: ReactNode }) => <p className={style({ font: 'body-sm', margin: 0, maxWidth: 880 })}>{children}</p>;

// Server-paged tables scroll internally: an unbounded TableView keeps loading pages until all rows are in.
export const pagedTable = style({ width: 'full', height: 640 });

export const tokenLabel = (t: string) => t.replace(':', ' · ');
export const tokenBlock = (t: string) => t.split(':')[0];
