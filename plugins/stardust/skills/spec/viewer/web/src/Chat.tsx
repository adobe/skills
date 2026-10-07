import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Chat as SpectrumChat, ExecutionTrace, ExecutionTraceItem, MessageSuggestion, MessageSuggestionList,
  PromptField, PromptFieldSubmitButton, PromptFieldToolbar, PromptFieldValue, PromptTokenField,
  ResponseStatus, ResponseStatusPanel, ResponseStatusTitle, Thread, ThreadItem, ThreadScrollButton, UserMessage,
} from '@react-spectrum/ai';
import { ActionButton } from '@react-spectrum/s2/ActionButton';
import { Button, ButtonGroup } from '@react-spectrum/s2/ButtonGroup';
import { InlineAlert, Heading, Content } from '@react-spectrum/s2/InlineAlert';
import { Tooltip, TooltipTrigger } from '@react-spectrum/s2/Tooltip';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Close from '@react-spectrum/s2/icons/Close';
import New from '@react-spectrum/s2/icons/New';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import { Markdown } from './richtext';
import { useSite } from './site';

type Tool = { name: string; why?: string | null; sql?: string | null; url?: string | null; rows?: number; error?: string | null };
type Offer = { title: string; description: string; state?: 'open' | 'built' | 'dismissed' };
type Msg = { role: 'user' | 'assistant'; content: string; tools?: Tool[]; error?: string; offer?: Offer };

// Generic starter questions; traffic ones only show when the scope has real-user telemetry.
const SUGGESTIONS: { q: string; rum?: boolean }[] = [ // rum: true = only with telemetry, false = only without
  { q: 'Which URLs use the tabs block, and on which templates?' },
  { q: 'Which blocks are needed on the most visited page?', rum: true },
  { q: 'Which blocks are needed on the home page?', rum: false },
  { q: 'How many pages of the largest template need only reused or variant blocks (no new block)?' },
  { q: 'Which 404s do real users hit most, and where do they come from?', rum: true },
  { q: 'Which dead links appear on the most pages?', rum: false },
  { q: 'Which new blocks unlock the most pages? Rank them.' },
  { q: 'How many pages with no traffic could be retired, by template?', rum: true },
];

const STORE = 'spec-viewer-chat';
const toolLabel = (t: Tool) => (t.name === 'query_sql' ? (t.why || 'Query the scope database') : `Look up the blocks on ${t.url}`);

export default function Chat({ onClose, pending, onPendingHandled }: { onClose: () => void; pending?: string | null; onPendingHandled?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(STORE) ?? '[]'); } catch { return []; } });
  const [prompt, setPrompt] = useState(() => new PromptFieldValue([]));
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nav = useNavigate();
  const site = useSite();
  const suggestions = SUGGESTIONS.filter((x) => x.rum === undefined || x.rum === site.rum).map((x) => x.q);

  useEffect(() => { sessionStorage.setItem(STORE, JSON.stringify(msgs)); }, [msgs]);
  // Questions sent from inline suggestion chips elsewhere in the app
  useEffect(() => { if (pending && !busy) { onPendingHandled?.(); ask(pending); } }, [pending, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: q.trim() }];
    setMsgs([...history, { role: 'assistant', content: '', tools: [] }]);
    setPrompt(new PromptFieldValue([])); setBusy(true);
    const ctrl = new AbortController(); abort.current = ctrl;
    const update = (fn: (m: Msg) => Msg) => setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = fn({ ...c[c.length - 1] }); return c; });
    try {
      const res = await fetch('/api/chat', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }) });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({ error: `Error ${res.status}` }))) as { error?: string };
        update((m) => ({ ...m, error: err.error })); setBusy(false); return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2);
          const ev = JSON.parse(line);
          if (ev.type === 'text') update((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === 'tool') update((m) => ({ ...m, tools: [...(m.tools ?? []), { name: ev.name, why: ev.why, sql: ev.sql, url: ev.url }] }));
          else if (ev.type === 'tool_result') update((m) => { const t = [...(m.tools ?? [])]; t[t.length - 1] = { ...t[t.length - 1], rows: ev.rows, error: ev.error }; return { ...m, tools: t }; });
          else if (ev.type === 'offer_view') update((m) => ({ ...m, offer: { title: ev.title, description: ev.description, state: 'open' } }));
          else if (ev.type === 'error') update((m) => ({ ...m, error: ev.error }));
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) update((m) => ({ ...m, error: String(e) }));
      else update((m) => ({ ...m, error: m.content ? undefined : 'Stopped.' }));
    }
    abort.current = null;
    setBusy(false);
  };

  const setOffer = (i: number, state: Offer['state']) => setMsgs((cur) => cur.map((m, j) => (j === i && m.offer ? { ...m, offer: { ...m.offer, state } } : m)));
  const build = (i: number) => {
    const offer = msgs[i].offer!;
    setOffer(i, 'built');
    nav('/views/new', { state: { messages: msgs.slice(0, i + 1).map(({ role, content }) => ({ role, content })), title: offer.title, description: offer.description } });
  };

  type Item = { id: string; kind: 'intro' | 'user' | 'assistant'; i: number };
  const items: Item[] = msgs.length === 0
    ? [{ id: 'intro', kind: 'intro', i: -1 }]
    : msgs.map((m, i) => ({ id: `m${i}`, kind: m.role, i }));

  return (
    <SpectrumChat styles={style({ display: 'flex', flexDirection: 'column', height: 'full', minHeight: 0, position: 'relative' })}>
      <div className={style({ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8, padding: 16 })}>
        <div className={style({ display: 'flex', flexDirection: 'column', gap: 2 })}>
          <h2 className={style({ font: 'title', margin: 0 })}>Ask the scope</h2>
          <span className={style({ font: 'detail-sm', color: 'neutral-subdued' })}>{`Answers come from the scope database.${site.chatModel ? ` Model: ${site.chatModel}.` : ''}`}</span>
        </div>
        <div className={style({ display: 'flex', gap: 4 })}>
          {msgs.length > 0 && (
            <TooltipTrigger>
              <ActionButton isQuiet aria-label="New conversation" isDisabled={busy} onPress={() => setMsgs([])}><New /></ActionButton>
              <Tooltip>New conversation</Tooltip>
            </TooltipTrigger>
          )}
          <TooltipTrigger>
            <ActionButton isQuiet aria-label="Close chat" onPress={onClose}><Close /></ActionButton>
            <Tooltip>Close chat</Tooltip>
          </TooltipTrigger>
        </div>
      </div>
      <Thread items={items} aria-label="Conversation" styles={style({ flexGrow: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', scrollPadding: 8 })}>
        {(item) => {
          if (item.kind === 'intro') {
            return (
              <ThreadItem textValue="Suggested questions" styles={style({ paddingX: 16 })}>
                <MessageSuggestionList title="Ask in plain language. Each answer links to the explorer rows behind it." size="S">
                  {suggestions.map((s) => <MessageSuggestion key={s} onPress={() => ask(s)}>{s}</MessageSuggestion>)}
                </MessageSuggestionList>
              </ThreadItem>
            );
          }
          const m = msgs[item.i];
          if (m.role === 'user') {
            return (
              <ThreadItem textValue={m.content} styles={style({ display: 'flex', justifyContent: 'end', paddingX: 16 })}>
                <UserMessage>{m.content}</UserMessage>
              </ThreadItem>
            );
          }
          const isLast = item.i === msgs.length - 1;
          const working = busy && isLast;
          const tools = m.tools ?? [];
          const failed = tools.some((t) => t.error);
          return (
            <ThreadItem textValue={m.content || m.error || 'Working'} isStreaming={working} styles={style({ paddingX: 16 })}>
              <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
                {(tools.length > 0 || (working && !m.content)) && (
                  <ResponseStatus status={working && !m.content ? 'pending' : failed && !m.content ? 'failed' : 'success'}>
                    <ResponseStatusTitle>{working && !m.content ? 'Querying the scope' : `Ran ${tools.length} ${tools.length === 1 ? 'query' : 'queries'}`}</ResponseStatusTitle>
                    {tools.length > 0 && (
                      <ResponseStatusPanel>
                        <ExecutionTrace>
                          {tools.map((t, j) => (
                            <ExecutionTraceItem
                              key={j}
                              status={t.error ? 'failed' : t.rows === undefined ? 'pending' : 'success'}
                              detail={(t.sql || t.error) ? <pre className={style({ font: 'code-xs', whiteSpace: 'pre-wrap', margin: 0 })}>{t.error ?? t.sql}</pre> : undefined}>
                              {`${toolLabel(t)}${t.rows !== undefined ? ` (${t.rows} rows)` : ''}`}
                            </ExecutionTraceItem>
                          ))}
                        </ExecutionTrace>
                      </ResponseStatusPanel>
                    )}
                  </ResponseStatus>
                )}
                {m.content && <Markdown source={m.content} />}
                {m.error && <Alert variant="negative">{m.error}</Alert>}
                {m.offer && m.offer.state !== 'dismissed' && (
                  <InlineAlert variant="informative">
                    <Heading>{m.offer.title}</Heading>
                    <Content>
                      <p className={style({ margin: 0 })}>{m.offer.description}</p>
                      {m.offer.state === 'built'
                        ? <p className={style({ marginTop: 8, marginBottom: 0 })}>Building it in the main panel. It will appear under My views.</p>
                        : (
                          <ButtonGroup styles={style({ marginTop: 12 })}>
                            <Button variant="accent" size="S" onPress={() => build(item.i)}>Build it as a page</Button>
                            <Button variant="secondary" size="S" onPress={() => setOffer(item.i, 'dismissed')}>Keep it in chat</Button>
                          </ButtonGroup>
                        )}
                    </Content>
                  </InlineAlert>
                )}
              </div>
            </ThreadItem>
          );
        }}
      </Thread>
      <ThreadScrollButton><ActionButton slot="scroll"><ChevronDown /></ActionButton></ThreadScrollButton>
      <div className={style({ padding: 16 })}>
        <PromptField
          value={prompt}
          onChange={setPrompt}
          isGenerating={busy}
          onSubmit={(v) => ask(v.toString())}
          onStop={() => abort.current?.abort()}
          aiDisclaimer="Answers are generated from the scope data and can be wrong. Check the linked rows.">
          <PromptTokenField placeholder="Which templates use a form?" />
          <PromptFieldToolbar>
            <div className={style({ marginStart: 'auto' })}><PromptFieldSubmitButton /></div>
          </PromptFieldToolbar>
        </PromptField>
      </div>
    </SpectrumChat>
  );
}
