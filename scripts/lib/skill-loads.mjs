// Which skills a Claude Code run loaded, read from its `--output-format stream-json --verbose`
// output, one JSON event per line. Plain code, no model: the transcript is not sent anywhere.
//
// A skill counts as loaded when the agent calls the Skill tool with its name (a plugin's
// skill is named "<plugin>:<skill>"), or reads its SKILL.md with the Read tool. The run stops
// being of interest when it loads a skill or writes a file; Claude Code ends it at --max-turns.
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const READ_TOOLS = new Set(['Read']);

function events(text) {
  const found = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      found.push(JSON.parse(line));
    } catch {
      // not an event: Claude Code prints nothing else on stdout, but a partial line may end it
    }
  }
  return found;
}

function named(input, skills) {
  const value = String(input?.skill ?? input?.command ?? input?.name ?? '').replace(/^\//, '');
  const name = value.split(':').pop().trim();
  return skills.has(name) ? name : null;
}

function read(input, skills) {
  const path = String(input?.file_path ?? input?.path ?? '');
  const name = path.split('\\').join('/').match(/\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
  return name && skills.has(name) ? name : null;
}

// A watcher to feed the stream to as it comes. feed() returns why the run can stop, or null.
// Claude Code may send one message of the agent as several events, one per block, with the
// same message id: a turn is a message, not an event. A subagent's messages are not turns
// of the agent, but what the subagent loads or writes counts as the run's.
export function watcher(skillNames, { keepGoing = false } = {}) {
  const skills = new Set(skillNames);
  const loaded = [];
  const messages = new Set();
  let wrote = false;
  let buffer = '';
  let reason = null;
  const handle = (event) => {
    if (event?.type !== 'assistant') return;
    if (!event.parent_tool_use_id) messages.add(event.message?.id ?? `event-${messages.size}`);
    const turns = messages.size;
    for (const block of event.message?.content ?? []) {
      if (block?.type !== 'tool_use') continue;
      let skill = null;
      if (block.name === 'Skill') skill = named(block.input, skills);
      else if (READ_TOOLS.has(block.name)) skill = read(block.input, skills);
      if (skill && !loaded.some((entry) => entry.skill === skill)) loaded.push({ skill, turn: turns });
      if (WRITE_TOOLS.has(block.name)) wrote = true;
    }
  };
  return {
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const event of events(lines.join('\n'))) handle(event);
      if (!reason && !keepGoing && loaded.length > 0) reason = 'skill';
      if (!reason && !keepGoing && wrote) reason = 'write';
      return reason;
    },
    result() {
      if (buffer.trim()) for (const event of events(buffer)) handle(event);
      buffer = '';
      return { loaded: loaded.map((entry) => entry.skill), order: [...loaded], turns: messages.size, stopped: reason ?? 'finished' };
    },
  };
}

export function skillsLoaded(text, skillNames) {
  const watch = watcher(skillNames, { keepGoing: true });
  watch.feed(`${text}\n`);
  return watch.result().loaded;
}

// The last result event of the stream: { text, turns, costUsd, failed }, or null.
export function streamResult(text) {
  const result = events(text).reverse().find((event) => event?.type === 'result');
  if (!result) return null;
  return { text: result.result ?? '', turns: result.num_turns, costUsd: result.total_cost_usd, failed: Boolean(result.is_error) };
}

// The skill a scenario tests, by its folder name: <skill> or <skill>-<what>, the longest
// skill name it starts with, as check-skills.mjs counts an eval for a skill.
export function expectedSkill(scenario, skillNames) {
  return [...skillNames].filter((skill) => scenario === skill || scenario.startsWith(`${skill}-`)).sort((a, b) => b.length - a.length)[0] ?? null;
}
