// Open questions register: decisions the scope cannot take. Each shows its default assumption (what a hands-off
// migration ships) and any recorded answer. Recording needs the editor key: the app is public, writes are not.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Accordion, AccordionItem, AccordionItemTitle, AccordionItemPanel, type Key } from '@react-spectrum/s2/Accordion';
import { Badge } from '@react-spectrum/s2/Badge';
import { Dialog, DialogTrigger, Button, ButtonGroup, Heading, Content } from '@react-spectrum/s2/Dialog';
import { Form } from '@react-spectrum/s2/Form';
import { InlineAlert, Heading as AlertHeading, Content as AlertContent } from '@react-spectrum/s2/InlineAlert';
import { LabeledValue } from '@react-spectrum/s2/LabeledValue';
import { Link } from '@react-spectrum/s2/Link';
import { LinkButton, Text } from '@react-spectrum/s2/LinkButton';
import { RadioGroup, Radio } from '@react-spectrum/s2/RadioGroup';
import { TextArea } from '@react-spectrum/s2/TextArea';
import { TextField } from '@react-spectrum/s2/TextField';
import { ToastQueue } from '@react-spectrum/s2/Toast';
import { ToggleButtonGroup, ToggleButton } from '@react-spectrum/s2/ToggleButtonGroup';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import Download from '@react-spectrum/s2/icons/Download';
import { fmt } from '../api';
import { BodyText, Detail, EmptyState, Loading, PageHeader, Section, Stack, useApi } from '../ui';

const KEY_STORE = 'spec-viewer-editor-key';
const OWNER = { stakeholder: 'Stakeholder', implementer: 'Implementer' } as Record<string, string>;

function RecordDecision({ q, onSaved }: { q: any; onSaved: () => void }) {
  const [option, setOption] = useState<string>(q.answer?.decided_option ?? '');
  const [answer, setAnswer] = useState('');
  const [by, setBy] = useState('');
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORE) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (close: () => void) => {
    setSaving(true); setError(null);
    const res = await fetch(`/api/questions/${q.id}/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-editor-key': key },
      body: JSON.stringify({ answer: answer || option, option: option || undefined, by }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const e = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setError(e.error ?? 'The decision could not be saved.');
      return;
    }
    sessionStorage.setItem(KEY_STORE, key);
    ToastQueue.positive(`Decision recorded for ${q.id}. The migration spec now uses it.`, { timeout: 5000 });
    close(); onSaved();
  };
  return (
    <DialogTrigger>
      <Button variant="secondary" size="S">{q.answer ? 'Update the decision' : 'Record a decision'}</Button>
      <Dialog>
        {({ close }) => (
          <>
            <Heading slot="title">{`${q.id}: record a decision`}</Heading>
            <Content>
              <Form onSubmit={(e) => { e.preventDefault(); void save(close); }}>
                <BodyText>{q.question}</BodyText>
                <RadioGroup label="Decision" value={option} onChange={setOption}>
                  {(q.options as string[]).map((o) => <Radio key={o} value={o}>{o}</Radio>)}
                </RadioGroup>
                <TextArea label="Details" description="Optional when an option above says it all." value={answer} onChange={setAnswer} />
                <TextField label="Decided by" isRequired value={by} onChange={setBy} description="Name and role, e.g. Jane Doe, digital team" />
                <TextField label="Editor key" isRequired type="password" value={key} onChange={setKey} description="Ask the scope owner. Viewing is public; recording decisions is not." />
                {error && <InlineAlert variant="negative"><AlertHeading>Not saved</AlertHeading><AlertContent>{error}</AlertContent></InlineAlert>}
              </Form>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={saving} isDisabled={!by || !key || !(answer || option)} onPress={() => void save(close)}>Save decision</Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogTrigger>
  );
}

export default function Questions() {
  const [reload, setReload] = useState(0);
  const { data } = useApi<any[]>(`/api/questions?r=${reload}`);
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const [expanded, setExpanded] = useState<Set<Key>>(() => new Set(focus ? [focus] : []));
  if (!data) return <Loading />;
  const owner = params.get('owner');
  const filters = new Set(['blocking', 'open'].filter((f) => params.get(f) === '1'));
  const rows = data.filter((q) => (!owner || q.owner === owner) && (!filters.has('blocking') || q.blocking) && (!filters.has('open') || q.status === 'open'));
  const answered = data.filter((q) => q.status === 'answered').length;
  return (
    <Stack>
      <PageHeader crumbs={[{ label: 'Implementation', href: '/implementation' }]} title="Open questions"
        description="Decisions the scope cannot take on its own. Each has a default assumption that a hands-off migration ships until someone answers; recorded answers flow straight into the migration spec."
        actions={<LinkButton variant="secondary" size="S" href="/api/export/open-questions.csv" download><Download /><Text>Download CSV</Text></LinkButton>} />
      <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' })}>
        <ToggleButtonGroup aria-label="Who answers" size="S" selectionMode="single" selectedKeys={owner ? [owner] : []}
          onSelectionChange={(k) => { const p = new URLSearchParams(params); const v = [...k][0]; if (v) p.set('owner', String(v)); else p.delete('owner'); setParams(p); }}>
          <ToggleButton id="stakeholder">Stakeholder</ToggleButton>
          <ToggleButton id="implementer">Implementer</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup aria-label="Question filters" size="S" selectionMode="multiple" selectedKeys={filters}
          onSelectionChange={(k) => { const p = new URLSearchParams(params); ['blocking', 'open'].forEach((f) => (k.has(f) ? p.set(f, '1') : p.delete(f))); setParams(p); }}>
          <ToggleButton id="blocking">Blocking only</ToggleButton>
          <ToggleButton id="open">Unanswered only</ToggleButton>
        </ToggleButtonGroup>
        <Detail>{`${answered} of ${data.length} answered`}</Detail>
      </div>
      <Section id="question-list" title="Questions" count={rows.length} ask={['Which open questions block the migration, and what does each default assume?']}>
        {rows.length === 0 ? <EmptyState title="No questions match these filters" /> : (
          <Accordion expandedKeys={expanded} onExpandedChange={setExpanded} allowsMultipleExpanded styles={style({ width: 'full' })}>
            {rows.map((q) => (
              <AccordionItem key={q.id} id={q.id}>
                <AccordionItemTitle>{`${q.id} · ${q.question}`}</AccordionItemTitle>
                <AccordionItemPanel>
                  <div className={style({ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 })}>
                    <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' })}>
                      <Badge size="S" variant="neutral" fillStyle="subtle">{q.area}</Badge>
                      <Badge size="S" variant="neutral" fillStyle="outline">{OWNER[q.owner] ?? q.owner}</Badge>
                      {q.blocking ? <Badge size="S" variant="negative" fillStyle="subtle">Blocking</Badge> : null}
                      <Badge size="S" variant={q.status === 'answered' ? 'positive' : 'notice'} fillStyle="subtle">{q.status === 'answered' ? 'Answered' : 'Open: default applies'}</Badge>
                    </div>
                    <BodyText>{q.context}</BodyText>
                    <div className={style({ display: 'grid', gridTemplateColumns: { default: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 24 })}>
                      <LabeledValue label="Options" value={q.options.join(' · ')} />
                      <LabeledValue label="Default assumption" value={q.default_assumption} />
                      <LabeledValue label="Impact" value={q.impact === null || q.impact === undefined ? 'Not quantified' : fmt(q.impact)} />
                    </div>
                    {q.answer && (
                      <InlineAlert variant="positive">
                        <AlertHeading>{`Decided by ${q.answer.answered_by} on ${String(q.answer.answered_at).slice(0, 10)}`}</AlertHeading>
                        <AlertContent>{q.answer.answer}</AlertContent>
                      </InlineAlert>
                    )}
                    <div className={style({ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' })}>
                      <RecordDecision q={q} onSaved={() => setReload((r) => r + 1)} />
                      {q.link && <Link href={q.link} isStandalone>See the affected rows</Link>}
                      {q.features.length > 0 && <span className={style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', font: 'body-sm' })}>Features:{q.features.map((f: string) => <Link key={f} href={`/features/${f}`} isStandalone isQuiet>{f}</Link>)}</span>}
                    </div>
                  </div>
                </AccordionItemPanel>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </Section>
    </Stack>
  );
}
