import { findJsonObjects } from './judge.mjs';

export const VERDICTS = { known: '✓', partial: '~', unknown: '✗' };

export function buildQuizJudgePrompt({ question, claim, answer }) {
  return [
    'You are grading whether an AI model knew a specific fact when asked a question with no tools or documentation.',
    '',
    '## Question',
    question.trim(),
    '',
    '## Fact (the answer key)',
    claim.trim(),
    '',
    '## Model answer',
    answer?.trim() ? answer.trim() : '(no answer)',
    '',
    'Grade the answer against the fact only:',
    '- "known": the answer states the fact fully and correctly (wording may differ).',
    '- "partial": the answer gets part of the fact right, or states it vaguely or hedged, or mixes it with a wrong detail that matters.',
    '- "unknown": the answer misses the fact, contradicts it, or says it does not know.',
    'Extra correct detail beyond the fact is fine. Do not reward confident tone.',
    '',
    'Respond with only a JSON object, no prose: {"verdict":"known|partial|unknown","reasoning":"<one or two sentences>"}',
  ].join('\n');
}

export function parseQuizVerdict(text) {
  for (const candidate of findJsonObjects(text ?? '').reverse()) {
    try {
      const v = String(JSON.parse(candidate).verdict ?? '').trim().toLowerCase();
      if (v in VERDICTS) return { verdict: v, reasoning: String(JSON.parse(candidate).reasoning ?? '') };
    } catch {}
  }
  return null;
}

export function renderQuizMarkdown({ facts, models, labels, cells, judge }) {
  const head = ['Fact', ...models.map((m) => labels[m] ?? m)];
  const rows = facts.map((f) => [
    `\`${f.id}\``,
    ...models.map((m) => {
      const c = cells[f.id]?.[m] ?? [];
      return c.length ? c.map((x) => (x.verdict ? VERDICTS[x.verdict] : '!')).join('') : '—';
    }),
  ]);
  const line = (r) => `| ${r.join(' | ')} |`;
  return [
    line(head),
    line(head.map(() => '---')),
    ...rows.map(line),
    '',
    `✓ known, ~ partial, ✗ unknown, ! failed (worker or judge). Judge: ${judge}.`,
  ].join('\n');
}
