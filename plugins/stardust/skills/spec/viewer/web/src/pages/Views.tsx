import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ExecutionTrace, ExecutionTraceItem, ResponseStatus, ResponseStatusPanel, ResponseStatusTitle } from '@react-spectrum/ai';
import { Button } from '@react-spectrum/s2/Button';
import { CardView, Card, CardPreview, Content, Image, Text } from '@react-spectrum/s2/CardView';
import { InlineAlert, Heading, Content as AlertContent } from '@react-spectrum/s2/InlineAlert';
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@react-spectrum/s2/TableView';
import { ToastQueue } from '@react-spectrum/s2/Toast';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fmt, fmtViews, media } from '../api';
import { useSite } from '../site';
import { addView, hasView, removeView } from '../myviews';
import { BarList, HeatCell, MetricGrid } from '../custom';
import { Markdown } from '../richtext';
import { Detail, EmptyState, Loading, PageHeader, PathText, Section as ViewCard, Stack, Verdict, useApi } from '../ui';

const fill = (tpl: string | undefined, row: Record<string, unknown>) =>
  tpl ? tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? ''))) : undefined;
const isNumeric = (format?: string) => format === 'number' || format === 'views';

function CellValue({ v, format }: { v: unknown; format?: string }) {
  const { short } = useSite();
  if (v === null || v === undefined) return <>–</>;
  if (format === 'views') return <>{fmtViews(Number(v))}</>;
  if (format === 'number' || typeof v === 'number') return <>{fmt(Number(v))}</>;
  if (format === 'verdict') return <Verdict v={String(v)} />;
  if (format === 'path') return <PathText>{short(String(v))}</PathText>;
  return <>{String(v)}</>;
}

function ViewSection({ s, data, index }: { s: any; data: any; index: number }) {
  const headingId = `view-section-${index}`;
  const err = data && data.error
    ? <InlineAlert variant="negative"><Heading>Query error</Heading><AlertContent>{data.error}</AlertContent></InlineAlert>
    : null;
  const label = s.title ?? `Section ${index + 1}`;

  const wrap = (body: ReactNode, flush = false) => <ViewCard id={headingId} title={s.title} description={s.note} flush={flush}>{err}{body}</ViewCard>;
  if (s.type === 'text') return <ViewCard><Markdown source={s.markdown} /></ViewCard>;
  if (s.type === 'kpis') {
    return (
      <ViewCard id={headingId} title={s.title}>
        <MetricGrid label={label} items={s.items.map((it: any, i: number) => {
          const v = data?.[i];
          return { id: String(i), value: typeof v === 'number' ? fmt(v) : v ?? '–', label: it.label, note: it.note, href: it.link };
        })} />
      </ViewCard>
    );
  }
  const rows: any[] = data?.rows ?? [];
  if (s.type === 'bar') {
    return wrap(<BarList label={label} rows={rows.map((r, i) => ({ id: String(i), label: String(r.label), textValue: String(r.label), value: Number(r.value) || 0, href: r.link ?? fill(s.link, r), tone: r.verdict ?? 'plain', right: fmt(Number(r.value)) }))} />);
  }
  if (s.type === 'gallery') {
    const items = rows.filter((r) => r.crop).map((r, i) => ({ ...r, id: String(i), href: r.link ?? fill(s.link, r) }));
    return (
      wrap(
        <CardView aria-label={label} items={items} size="L" styles={style({ width: 'full' })}>
          {(r: any) => (
            <Card id={r.id} href={r.href} textValue={String(r.caption ?? '')}>
              <CardPreview><Image src={media(r.crop)} alt="" styles={style({ width: 'full', aspectRatio: '4/3', objectFit: 'cover', objectPosition: 'top' })} /></CardPreview>
              <Content><Text slot="description">{String(r.caption ?? '')}</Text></Content>
            </Card>
          )}
        </CardView>
      )
    );
  }
  if (s.type === 'matrix') {
    const rk = [...new Set(rows.map((r) => String(r.row)))]; const ck = [...new Set(rows.map((r) => String(r.col)))];
    const val = new Map(rows.map((r) => [`${r.row}\u0000${r.col}`, Number(r.value) || 0]));
    const max = Math.max(1, ...val.values());
    const columns = [{ id: '__row', name: '' }, ...ck.map((c) => ({ id: c, name: c }))];
    return (
      wrap(
        <TableView aria-label={label} isQuiet density="compact" styles={style({ width: 'full' })}>
          <TableHeader columns={columns}>
            {(c) => <Column id={c.id} isRowHeader={c.id === '__row'} align={c.id === '__row' ? 'start' : 'end'} minWidth={c.id === '__row' ? 200 : 80}>{c.name}</Column>}
          </TableHeader>
          <TableBody items={rk.map((r) => ({ id: r }))}>
            {(r) => (
              <Row id={r.id} columns={columns} textValue={r.id}>
                {(c) => {
                  if (c.id === '__row') return <Cell>{r.id}</Cell>;
                  const v = val.get(`${r.id}\u0000${c.id}`) ?? 0;
                  return <Cell align="end"><HeatCell value={v} max={max} label={fmt(v)} href={fill(s.link, { row: r.id, col: c.id })} /></Cell>;
                }}
              </Row>
            )}
          </TableBody>
        </TableView>, true
      )
    );
  }
  // table
  const cols: { key: string; label: string; format?: string }[] = s.columns ?? Object.keys(rows[0] ?? {}).filter((k) => k !== 'id' && k !== 'link').map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
  const columns = cols.map((c, i) => ({ ...c, id: c.key, isRowHeader: i === 0 }));
  return (
    wrap(<>
      <TableView aria-label={label} isQuiet density="compact" overflowMode="wrap" styles={style({ width: 'full' })}>
        <TableHeader columns={columns}>
          {(c) => <Column id={c.id} isRowHeader={c.isRowHeader} align={isNumeric(c.format) ? 'end' : 'start'}>{c.label}</Column>}
        </TableHeader>
        <TableBody items={rows.map((r, i) => ({ ...r, __id: String(i) }))} renderEmptyState={() => <EmptyState title="No rows" />}>
          {(r: any) => (
            <Row id={r.__id} href={r.link ?? fill(s.link, r)} columns={columns} textValue={String(r[cols[0]?.key] ?? r.__id)}>
              {(c) => <Cell align={isNumeric(c.format) ? 'end' : 'start'}><CellValue v={r[c.key]} format={c.format} /></Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
      <div className={style({ marginTop: 8, paddingX: 16 })}><Detail>{`${rows.length} rows${rows.length >= 500 ? ' (capped at 500)' : ''}`}</Detail></div>
    </>, true)
  );
}

export function ViewPage() {
  const { id } = useParams();
  const view = useApi(`/api/views/${id}`);
  const data = useApi(`/api/views/${id}/data`);
  const [saved, setSaved] = useState(() => hasView(id!));
  if (view.error) return <EmptyState title="This view doesn't exist">Open the chat and ask again to build a new one.</EmptyState>;
  if (!view.data) return <Loading />;
  const v = view.data; const spec = v.spec;
  const copy = () => navigator.clipboard.writeText(window.location.href).then(
    () => ToastQueue.positive('Link copied.', { timeout: 4000 }),
    () => ToastQueue.negative("We couldn't copy the link. Copy it from the address bar.", { timeout: 6000 }));
  return (
    <Stack>
      <PageHeader
        crumbs={[{ label: 'My views' }, { label: spec.title }]}
        title={spec.title}
        description={<Markdown source={spec.summary} />}
        actions={<>
          <Button variant="secondary" size="S" onPress={copy}>Copy link</Button>
          {saved
            ? <Button variant="secondary" size="S" onPress={() => { removeView(id!); setSaved(false); }}>Remove from my views</Button>
            : <Button variant="accent" size="S" onPress={() => { addView({ id: id!, title: spec.title, created: v.created_at }); setSaved(true); }}>Add to my views</Button>}
        </>} />
      <Detail>{`Generated from a chat question on ${v.created_at?.slice(0, 10)}. The queries run against the current scope data each time the view opens.`}</Detail>
      {!data.data ? <Loading /> : spec.sections.map((s: any, i: number) => <ViewSection key={i} index={i} s={s} data={data.data.results[i]} />)}
    </Stack>
  );
}

export function ViewBuilder() {
  const { state } = useLocation() as { state: { messages: unknown[]; title: string; description: string } | null };
  const nav = useNavigate();
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!state || started.current) return;
    started.current = true;
    (async () => {
      const res = await fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({ error: `Error ${res.status}` }))) as { error?: string }; setError(e.error ?? 'error'); return; }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break; buf += value; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, i).replace(/^data: /, '')); buf = buf.slice(i + 2);
          if (ev.type === 'step') setSteps((s) => [...s, ev.text]);
          else if (ev.type === 'error') setError(ev.error);
          else if (ev.type === 'created') { addView({ id: ev.id, title: state.title, created: new Date().toISOString() }); nav(`/views/${ev.id}`, { replace: true }); }
        }
      }
    })().catch((e) => setError(String(e)));
  }, [state, nav]);
  if (!state) return <EmptyState title="Nothing to build">When an answer in the chat is better as a page, the chat offers to build one.</EmptyState>;
  return (
    <div className={style({ maxWidth: 720 })}>
      <PageHeader crumbs={[{ label: 'My views' }, { label: 'New view' }]} title={state.title} description={state.description} />
      <ResponseStatus status={error ? 'failed' : 'pending'} defaultExpanded>
        <ResponseStatusTitle>{error ? "We couldn't build this view" : 'Building the view'}</ResponseStatusTitle>
        <ResponseStatusPanel>
          <ExecutionTrace>
            {steps.length === 0 && !error ? <ExecutionTraceItem status="pending">Starting</ExecutionTraceItem> : null}
            {steps.map((s, i) => <ExecutionTraceItem key={i} status={i === steps.length - 1 && !error ? 'pending' : 'success'}>{s}</ExecutionTraceItem>)}
            {error ? <ExecutionTraceItem status="failed" detail={<p className={style({ font: 'body-sm', margin: 0 })}>{error}</p>}>Error</ExecutionTraceItem> : null}
          </ExecutionTrace>
        </ResponseStatusPanel>
      </ResponseStatus>
      <p className={style({ font: 'body-sm', color: 'neutral-subdued', marginTop: 16 })}>The chat model designs the page, and every query runs once to check it before the view is saved. This takes 20 to 60 seconds.</p>
    </div>
  );
}
