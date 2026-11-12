const MAX_LISTED_FILES = 300;

function filesSection(files) {
  const listed = files.slice(0, MAX_LISTED_FILES);
  const more = files.length > listed.length ? `\n…and ${files.length - listed.length} more` : '';
  return ['## Files in the working directory', listed.length ? listed.join('\n') + more : '(none)'];
}

function changesSection(changes, fileCount) {
  const head = `## Changes the agent made (the working directory has ${fileCount} files; any file not listed is unchanged from the starting state)`;
  if (!changes.files.length) return [head, 'The agent did not change any files.'];
  return [
    head,
    changes.files.map((f) => `${f.status} ${f.path}`).join('\n'),
    '',
    '```diff',
    changes.diff.trimEnd(),
    '```',
    ...(changes.truncated ? ['The diff was truncated; read the files directly for anything not shown.'] : []),
  ];
}

export function judgeCommands(scenario, toolCalls = []) {
  if (!scenario.config?.judge?.commands) return undefined;
  return toolCalls.filter((c) => c.name === 'bash' && typeof c.arguments?.command === 'string').map((c) => c.arguments.command);
}

const MAX_COMMAND_CHARS = 20000;

function commandsSection(commands) {
  const head = '## Shell commands the agent ran (in order)';
  if (!commands.length) return [head, 'The agent ran no shell commands.', ''];
  let text = commands.map((c) => `$ ${c}`).join('\n');
  const truncated = text.length > MAX_COMMAND_CHARS;
  if (truncated) text = text.slice(0, MAX_COMMAND_CHARS);
  return [head, '```sh', text, '```', ...(truncated ? ['The command list was truncated.'] : []), ''];
}

export function buildJudgePrompt({ task, criteria, finalAnswer, changes, fileCount, files = [], commands }) {
  const checklist = criteria.checklist.map((c) => ({
    name: c.name,
    max_score: c.max_score,
    ...(c.category ? { category: c.category } : {}),
    description: c.description,
  }));
  return [
    'You are grading an AI coding agent\'s solution to a task against a weighted checklist.',
    'Your current working directory is the agent\'s final working directory. Inspect any files you need with your read-only tools; judge what the files and the final answer actually show, not what the agent claims.',
    '',
    'For each checklist item, award a score from 0 to its max_score. Partial credit is allowed when the item is partly satisfied. An item is satisfied when its description holds for the solution; for MUST_NOT items the description states the required absence of a behaviour.',
    '',
    '## Task given to the agent',
    task.trim(),
    '',
    ...(criteria.context ? ['## Grading context', criteria.context.trim(), ''] : []),
    '## Checklist',
    JSON.stringify(checklist, null, 2),
    '',
    '## Agent\'s final answer',
    finalAnswer?.trim() ? finalAnswer.trim() : '(no final answer)',
    '',
    ...(changes ? changesSection(changes, fileCount) : filesSection(files)),
    '',
    ...(commands ? commandsSection(commands) : []),
    'Respond with only a JSON object, no prose, in this shape:',
    '{"checks":[{"name":"<exact checklist name>","score":<number>,"reasoning":"<one or two sentences>"}]}',
    'Include every checklist item exactly once.',
  ].join('\n');
}

export function findJsonObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      out.push(text.slice(start, i + 1));
      start = -1;
    }
  }
  return out;
}

const norm = (s) => String(s).trim().toLowerCase();

export function parseJudgeResponse(text, criteria) {
  let checks = null;
  for (const candidate of findJsonObjects(text ?? '').reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.checks)) {
        checks = parsed.checks;
        break;
      }
    } catch {}
  }
  if (!checks) return null;
  const byName = new Map(checks.map((c) => [norm(c.name), c]));
  return scoreChecklist(
    criteria,
    (item) => {
      const c = byName.get(norm(item.name));
      if (!c) return { score: 0, reasoning: 'Not scored by judge', missing: true };
      return { score: Number(c.score), reasoning: String(c.reasoning ?? '') };
    },
  );
}

export function judgeOutcome(proc, session, criteria) {
  if (proc.timedOut) return { error: 'judge timed out' };
  if (proc.exitCode !== 0) return { error: `judge exited ${proc.exitCode}` };
  if (session.errors?.length) return { error: `judge error: ${session.errors[0]}` };
  if (session.aborted) return { error: 'judge aborted' };
  const score = parseJudgeResponse(session.finalAnswer, criteria);
  return score ? { score } : { error: 'judge returned no parseable scores' };
}

export function scoreChecklist(criteria, grade) {
  const checks = criteria.checklist.map((item) => {
    const g = grade(item);
    const max = Number(item.max_score) || 0;
    const raw = Number.isFinite(g.score) ? g.score : 0;
    return {
      name: item.name,
      category: item.category ?? null,
      max,
      score: Math.min(max, Math.max(0, raw)),
      reasoning: g.reasoning,
      ...(g.missing ? { missing: true } : {}),
    };
  });
  const total = checks.reduce((a, c) => a + c.score, 0);
  const max = checks.reduce((a, c) => a + c.max, 0);
  return { checks, total, max, pct: max ? (100 * total) / max : 0 };
}
