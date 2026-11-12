import { readFile } from 'node:fs/promises';

const MIN_LINE_CHARS = 20;
const MIN_HITS = 3;
const HEADER_LINES = 3;

export function skillHeader(skillMd) {
  return skillMd
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, HEADER_LINES);
}

function showsHeader(lines, header) {
  if (!header?.length) return false;
  for (let i = 0; i + header.length <= lines.length; i++) {
    if (header.every((h, j) => lines[i + j] === h)) return true;
  }
  return false;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

export function skillSignature(skillMd) {
  const lines = skillMd
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_LINE_CHARS && !/^[-=*_`#|\s]+$/.test(l));
  return [...new Set(lines)];
}

export function distinctSignatures(skills) {
  const seen = new Map();
  for (const s of skills) for (const l of new Set(s.signature ?? [])) seen.set(l, (seen.get(l) ?? 0) + 1);
  return skills.map((s) => ({ ...s, signature: (s.signature ?? []).filter((l) => seen.get(l) === 1) }));
}

export const LINE_NUMBER_PREFIX = /^\s*\d+(?:\t|:\s?|\s+\|\s?)/;

function showsSkill(lines, signature) {
  const need = Math.min(MIN_HITS, signature.length);
  let hits = 0;
  for (const l of signature) if (lines.has(l) && ++hits >= need) return true;
  return false;
}

export function detectActivations(toolResults, skills) {
  const activated = new Set();
  for (const text of toolResults) {
    const list = text
      .split(/\r?\n/)
      .map((l) => l.replace(LINE_NUMBER_PREFIX, '').trim())
      .filter(Boolean);
    const lines = new Set(list);
    for (const s of skills) {
      if (showsHeader(list, s.header) || (s.signature?.length && showsSkill(lines, s.signature))) activated.add(s.name);
    }
  }
  return [...activated].sort();
}

export function parseSession(lines, { skills = [] } = {}) {
  const session = {
    finalAnswer: '',
    turns: 0,
    toolCalls: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    errors: [],
    aborted: false,
    model: null,
    malformedLines: 0,
  };
  const toolResults = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      session.malformedLines++;
      continue;
    }
    if (ev.type === 'agent_settled' && ev.aborted) session.aborted = true;
    if (ev.type === 'message_end' && ev.message?.role === 'toolResult') {
      toolResults.push(textOf(ev.message.content));
      continue;
    }
    if (ev.type !== 'message_end' || ev.message?.role !== 'assistant') continue;
    const m = ev.message;
    session.turns++;
    session.model ??= m.model ?? null;
    const u = m.usage ?? {};
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) session.tokens[k] += u[k] ?? 0;
    session.tokens.total += u.totalTokens ?? 0;
    session.cost += u.cost?.total ?? 0;
    if (m.stopReason === 'error' || m.errorMessage) session.errors.push(m.errorMessage ?? 'assistant error');
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'toolCall') session.toolCalls.push({ name: c.name, arguments: c.arguments ?? {} });
    }
    const text = textOf(m.content);
    if (text.trim()) session.finalAnswer = text;
  }
  session.activatedSkills = detectActivations(toolResults, skills);
  return session;
}

export async function parseSessionFile(path, opts) {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {}
  return parseSession(text.split('\n'), opts);
}
