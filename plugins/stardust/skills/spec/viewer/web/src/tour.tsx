// First-visit onboarding tour: dark TourBubbles (custom.tsx) anchored to parts of the shell (no S2 coachmark exists).
// Anchors are elements marked with data-tour="<id>"; a missing anchor falls back to the page header.
// Finishing, skipping or dismissing stores TOUR_KEY so the tour never shows again in this browser.
import { useEffect, useRef, useState } from 'react';
import { Button, ButtonGroup } from '@react-spectrum/s2/ButtonGroup';
import { ActionButton } from '@react-spectrum/s2/ActionButton';
import { TourBubble } from './custom';
import { useSite, type SiteInfo } from './site';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };

const TOUR_KEY = 'spec-viewer-tour-v1';
const EVT = 'spec-tour-restart';


type Step = { anchor: string; fallback?: string; placement: 'right' | 'left' | 'bottom'; title: string; body: string[]; rum?: boolean };

// Generic copy. A site can override the whole tour with meta.tour_steps (JSON list of steps).
const STEPS: Step[] = [
  {
    anchor: 'nav', placement: 'right', title: 'Explore the scope',
    body: [
      'Overview, Templates, Blocks and URLs show what has to be built: the live pages, their templates and layout variants, and the EDS blocks each page needs.',
      'Every number opens the rows behind it. Filter URLs by block, template or status, and download any list as CSV. The Implementation section explains how each feature, tag and locale should be built, and lists the open decisions.',
    ],
  },
  {
    anchor: 'header', placement: 'bottom', title: 'Real-user data (Optel)', rum: true,
    body: [
      'Traffic and real-user 404s come from AEM Operational Telemetry: real visits, sampled at about 1 in 100.',
      'Page views are estimates. A page that shows 0 had no sampled visit, so it may still get a little traffic. Use them to rank pages, not as exact counts.',
    ],
  },
  {
    anchor: 'chat', fallback: 'chat-button', placement: 'left', title: 'Ask the scope',
    body: [
      'Ask questions in plain language, for example "Which pages use the tabs block?" or "How should site search be built?".',
      'Answers come from the same database as the explorer, and their links open the matching rows.',
    ],
  },
  {
    anchor: 'my-views', fallback: 'nav', placement: 'right', title: 'Keep answers as pages',
    body: [
      'When an answer needs more room than the chat (a ranking, a matrix, a dashboard), the chat offers to build it as a full page in the main panel.',
      'Those pages are saved under My views in this list and can be shared by link. Their numbers stay live.',
    ],
  },
];

const PLACEMENTS = new Set(['right', 'left', 'bottom']);
function stepsFor(site: SiteInfo): Step[] {
  const custom = site.json<Partial<Step>[]>('tour_steps', []);
  const valid = Array.isArray(custom) ? custom.filter((x): x is Step => !!x && typeof x.anchor === 'string' && typeof x.title === 'string' && Array.isArray(x.body)) : [];
  const list = valid.length ? valid.map((x) => ({ ...x, placement: PLACEMENTS.has(x.placement) ? x.placement : 'bottom' } as Step)) : STEPS;
  return list.filter((x) => site.rum || !x.rum);
}

export const restartTour = () => { localStorage.removeItem(TOUR_KEY); window.dispatchEvent(new Event(EVT)); };

const find = (id: string) => document.querySelector(`[data-tour="${id}"]`);

export function Tour() {
  const steps = stepsFor(useSite());
  const [step, setStep] = useState<number | null>(null);
  const anchor = useRef<Element | null>(null);

  useEffect(() => {
    const start = () => { if (!localStorage.getItem(TOUR_KEY)) setStep(0); };
    // wait for the first page to render its content so anchors exist and do not move
    const t = window.setTimeout(start, 900);
    window.addEventListener(EVT, start);
    return () => { window.clearTimeout(t); window.removeEventListener(EVT, start); };
  }, []);

  if (step === null || !steps[step]) return null;
  const s = steps[step];
  anchor.current = find(s.anchor) ?? (s.fallback ? find(s.fallback) : null) ?? find('header');
  const done = () => { localStorage.setItem(TOUR_KEY, new Date().toISOString()); setStep(null); };
  const last = step === steps.length - 1;

  return (
    <TourBubble key={step} triggerRef={anchor} placement={s.placement} onClose={done} label={`Tour, step ${step + 1} of ${steps.length}: ${s.title}`}>
      <div className={style({ display: 'flex', flexDirection: 'column', gap: 12 })}>
        <span className={style({ font: 'detail-sm', color: 'transparent-white-700' })}>{`Step ${step + 1} of ${steps.length}`}</span>
        <h2 className={style({ font: 'title', color: 'white', margin: 0 })}>{s.title}</h2>
        {s.body.map((p, i) => <p key={i} className={style({ font: 'body-sm', color: 'transparent-white-900', margin: 0 })}>{p}</p>)}
        <div className={style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 })}>
          <ActionButton isQuiet size="S" staticColor="white" onPress={done}>Skip tour</ActionButton>
          <ButtonGroup size="S">
            {step > 0 && <Button variant="secondary" fillStyle="outline" staticColor="white" onPress={() => setStep(step - 1)}>Back</Button>}
            <Button variant="primary" staticColor="white" autoFocus onPress={() => (last ? done() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</Button>
          </ButtonGroup>
        </div>
      </div>
    </TourBubble>
  );
}
