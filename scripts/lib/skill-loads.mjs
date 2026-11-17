// Which skills a run loaded, read from its output, one JSON event per line: Claude Code's
// `--output-format stream-json --verbose` or pi's `--mode json`. Plain code, no model: the
// transcript is not sent anywhere.
//
// A skill counts as loaded when the agent calls Claude Code's Skill tool with its name (a
// plugin's skill is named "<plugin>:<skill>"), or reads its SKILL.md with the read tool or a
// shell command that names it (cat, sed, grep: pi's agents often read a skill so). The
// run stops being of interest when it loads a skill or writes a file; Claude Code ends it at
// --max-turns, and pi, which has no such limit, when the watcher has seen maxTurns.
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write', 'edit']);
export const READ_TOOLS = new Set(['Read', 'read']);
export const SHELL_TOOLS = new Set(['Bash', 'bash']);

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

// Commands that print a file's content, and so read a skill when given its SKILL.md.
const READERS = new Set(['cat', 'sed', 'head', 'tail', 'grep', 'rg', 'awk', 'less', 'more', 'bat', 'nl']);
const WRAPPERS = new Set(['env', 'sudo', 'xargs', 'nice', 'time']);

// The skills whose SKILL.md a shell command prints: in a part of the command (between |, ;
// and &&) that starts with a reader, and not one that writes to the file (>, tee, sed -i).
function shellReads(input, skills) {
  const found = [];
  const command = String(input?.command ?? '').split('\\').join('/');
  for (const part of command.split(/\|\||&&|[|;]/)) {
    const words = part.trim().split(/\s+/);
    // past assignments (LC_ALL=C) and wrappers (env, sudo, xargs, nice, time) with their options
    while (words.length > 1 && (/^[A-Za-z_]\w*=/.test(words[0]) || WRAPPERS.has(words[0].split('/').pop()) || (words[0].startsWith('-') && words.length > 1))) words.shift();
    if (!READERS.has(words[0]?.split('/').pop()) || /(^|\s)(>|>>|tee)(\s|$)|>\s*\S|sed\s+-i/.test(part.replace(/\d?>&\d/g, ''))) continue;
    for (const match of part.matchAll(/\/skills\/([^/\s'"]+)\/SKILL\.md(?![\w.-])/g)) {
      if (skills.has(match[1]) && !found.includes(match[1])) found.push(match[1]);
    }
  }
  return found;
}

function read(input, skills) {
  const path = String(input?.file_path ?? input?.path ?? '');
  const name = path.split('\\').join('/').match(/\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
  return name && skills.has(name) ? name : null;
}

// A message of the agent in either stream: { id, subagent, calls: [{ name, input }] }, or null.
// Claude Code may send one message as several events, one per block, with the same id; pi
// sends each message once, at its end.
function message(event, count) {
  if (event?.type === 'assistant') {
    return {
      id: event.message?.id ?? `event-${count}`,
      subagent: Boolean(event.parent_tool_use_id),
      calls: (event.message?.content ?? []).filter((block) => block?.type === 'tool_use').map((block) => ({ name: block.name, input: block.input })),
    };
  }
  if (event?.type === 'message_end' && event.message?.role === 'assistant') {
    return {
      id: `pi-${count}`,
      subagent: false,
      calls: (Array.isArray(event.message.content) ? event.message.content : []).filter((block) => block?.type === 'toolCall').map((block) => ({ name: block.name, input: block.arguments })),
    };
  }
  return null;
}

// A watcher to feed the stream to as it comes. feed() returns why the run can stop, or null.
// A turn is a message, not an event. A subagent's messages are not turns of the agent, but
// what the subagent loads or writes counts as the run's.
export function watcher(skillNames, { keepGoing = false, maxTurns = Infinity } = {}) {
  const skills = new Set(skillNames);
  const loaded = [];
  const messages = new Set();
  let wrote = false;
  let buffer = '';
  let reason = null;
  let seen = 0;
  const handle = (event) => {
    const turn = message(event, seen);
    if (!turn) return;
    seen += 1;
    if (!turn.subagent) messages.add(turn.id);
    const turns = messages.size;
    for (const block of turn.calls) {
      let found = [];
      if (block.name === 'Skill') found = [named(block.input, skills)];
      else if (READ_TOOLS.has(block.name)) found = [read(block.input, skills)];
      else if (SHELL_TOOLS.has(block.name)) found = shellReads(block.input, skills);
      for (const skill of found) if (skill && !loaded.some((entry) => entry.skill === skill)) loaded.push({ skill, turn: turns });
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
      if (!reason && messages.size >= maxTurns) reason = 'max-turns';
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

// What the run answered: { text, turns, costUsd, failed }, or null. Claude Code ends its
// stream with a result event; pi's answer is the text of its agent's last message.
export function streamResult(text) {
  const all = events(text);
  const result = [...all].reverse().find((event) => event?.type === 'result');
  if (result) return { text: result.result ?? '', turns: result.num_turns, costUsd: result.total_cost_usd, failed: Boolean(result.is_error) };
  const said = all.filter((event) => event?.type === 'message_end' && event.message?.role === 'assistant').map((event) => event.message);
  if (said.length === 0) return null;
  const textOf = (content) => (typeof content === 'string' ? content : (content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join(''));
  const answer = [...said].reverse().find((entry) => textOf(entry.content).trim());
  const cost = said.reduce((sum, entry) => sum + (entry.usage?.cost?.total ?? 0), 0);
  // pi keeps a failed attempt in the stream when it retries: only the last message tells
  const last = said.at(-1);
  return {
    text: answer ? textOf(answer.content) : '',
    turns: said.length,
    ...(cost > 0 ? { costUsd: cost } : {}),
    failed: last.stopReason === 'error' || Boolean(last.errorMessage),
  };
}

// The skill a scenario tests, by its folder name: <skill> or <skill>-<what>, the longest
// skill name it starts with, as check-skills.mjs counts an eval for a skill.
export function expectedSkill(scenario, skillNames) {
  return [...skillNames].filter((skill) => scenario === skill || scenario.startsWith(`${skill}-`)).sort((a, b) => b.length - a.length)[0] ?? null;
}
