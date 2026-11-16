// The merge policy of CONTRIBUTING.md, applied to the open pull requests:
//
// - An agent's pull request (any without the `human` label) whose head commit the AI review
//   denied, or that has a line comment of the AI review nobody answered, more than 24 hours
//   ago, is closed, with a comment that says why. Its author can fix it and reopen it.
// - A pull request that is ready for review and that none of its code owners has reviewed,
//   commented on or pushed to for a week gets the `takeover` label: a maintainer may now
//   close, merge or change it. The label goes once an owner acts again.
// - A pull request that changes what is brought in from another repository (lib/imported.mjs),
//   opened by anyone but its code owners, is closed at once: a change made here is
//   overwritten by the next import, so it belongs where the copy comes from. It is closed
//   once; a maintainer who reopens it has decided otherwise. One that its code owners
//   opened is not closed for the AI review: it brings what was decided elsewhere, and a
//   maintainer merges it (scripts/check-imported.mjs).
// - An issue whose form names a plugin brought in from another repository is closed the
//   same way, once, with its code owners mentioned, unless one of them opened it.
//
// Nothing that was opened before the policy started is closed for being brought in.
// Pull requests opened by a bot (Renovate, the release) are left alone.
//   node scripts/pr-policy.mjs [--apply] [--repo owner/name] [--pr <number>] [--now <date>]
// Without --apply it only says what it would do; --now says what it would do then.
// GH_TOKEN or GITHUB_TOKEN is the token.
import { readFileSync } from 'node:fs';
import { isMain } from './lib/is-main.mjs';
import { summary, table, warning } from './lib/actions.mjs';
import { IMPORTED, origin } from './lib/imported.mjs';

export const HOUR = 60 * 60 * 1000;
export const REVIEW_DEADLINE = 24 * HOUR;
export const OWNER_DEADLINE = 7 * 24 * HOUR;
export const HUMAN = 'human';
export const TAKEOVER = 'takeover';
export const REVIEWERS = ['claude', 'codex'];
// No clock starts before the policy did: what was open then has its 24 hours and its week
// from here.
export const POLICY_START = Date.parse('2026-11-17T00:00:00Z');
const MARKER = {
  review: '<!-- pr-policy:review-overdue -->',
  takeover: '<!-- pr-policy:takeover -->',
  imported: '<!-- pr-policy:imported -->',
};

// CODEOWNERS: the last rule that matches a path names its owners. Patterns follow
// .gitignore: a leading slash anchors one to the root, a trailing slash matches a
// directory, `*` matches within a path segment and `**` across segments.
export function parseCodeowners(text) {
  return text.split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern, owners, regex: patternToRegex(pattern) };
    });
}

function patternToRegex(pattern) {
  const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
  let body = pattern.replace(/^\//, '').replace(/\/$/, '');
  body = body.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?');
  // a pattern matches the path itself and everything below it
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${body}(?:/.*)?$`);
}

export function ownersOf(rules, paths) {
  const owners = new Set();
  for (const path of paths) {
    const rule = rules.findLast(({ regex }) => regex.test(path));
    for (const owner of rule?.owners ?? []) owners.add(owner.replace(/^@/, '').toLowerCase());
  }
  return [...owners];
}

// events that put a pull request back in front of its reviewers and start the clocks again
const RESTART = ['ReadyForReviewEvent', 'ReopenedEvent'];
const isBot = (actor) => !actor || actor.__typename === 'Bot' || /\[bot\]$/.test(actor.login);
const latest = (dates) => dates.filter(Boolean).map((date) => new Date(date).getTime()).reduce((a, b) => Math.max(a, b), -Infinity);

// What the AI review left unanswered on a pull request, and since when. A denial counts
// for the head commit only, until a person comments on or reviews the pull request after
// it: a push gets a new review, a reply answers it. A line comment counts until it is
// resolved, outdated by a change to its line, or answered by a person. The clock starts
// again when the pull request is reopened or marked ready for review, which also runs the
// review again.
export function openFindings(pr, { start = POLICY_START } = {}) {
  const found = [];
  const ready = latest(pr.timelineItems.nodes.filter(({ __typename }) => RESTART.includes(__typename)).map(({ createdAt }) => createdAt));
  const since = (date) => Math.max(new Date(date).getTime(), ready, start);
  // when a person last said something on the pull request
  const said = latest([
    ...pr.timelineItems.nodes.filter((item) => item.__typename === 'IssueComment' && !isBot(item.author)).map(({ createdAt }) => createdAt),
    ...pr.timelineItems.nodes.filter((item) => item.__typename === 'PullRequestReview' && !isBot(item.author)).map(({ submittedAt }) => submittedAt),
    ...pr.reviewThreads.nodes.flatMap(({ comments }) => comments.nodes).filter(({ author }) => !isBot(author)).map(({ createdAt }) => createdAt),
  ]);
  const contexts = pr.commits.nodes[0]?.commit.status?.contexts ?? [];
  for (const reviewer of REVIEWERS) {
    const status = contexts.find(({ context }) => context === `review / ${reviewer}`);
    if (status?.state === 'FAILURE' && said <= new Date(status.createdAt).getTime()) found.push({ what: `${reviewer} denied ${pr.headRefOid.slice(0, 7)}`, since: since(status.createdAt) });
  }
  for (const thread of pr.reviewThreads.nodes) {
    const [first, ...replies] = thread.comments.nodes;
    const reviewer = REVIEWERS.find((name) => first?.body.startsWith(`**${name}:**`));
    if (!reviewer || !isBot(first.author) || thread.isResolved || thread.isOutdated) continue;
    if (replies.some(({ author }) => !isBot(author))) continue;
    const what = `${reviewer} on \`${first.path}:${first.line ?? first.originalLine}\``;
    // a review that runs again may say the same about a line in other words
    if (!found.some((finding) => finding.what === what)) found.push({ what, since: since(first.createdAt) });
  }
  return found;
}

// Since when a pull request has waited for its code owners: when it was opened, reopened or
// last marked ready for review, or when an owner last reviewed, commented or pushed,
// whichever is latest. A commit carries the date its committer gave it, so one from the
// future counts as now; a force push counts when GitHub saw it. `owners` are logins; a team that could not be resolved is `anyone`, and then
// any person but the author counts.
export function waitingSince(pr, { owners, anyone = false, start = POLICY_START, now = Date.now() }) {
  const owner = (actor) => !isBot(actor) && (owners.includes(actor.login.toLowerCase()) || (anyone && actor.login !== pr.author.login));
  const times = [pr.createdAt, start];
  for (const item of pr.timelineItems.nodes) {
    if (RESTART.includes(item.__typename)) times.push(item.createdAt);
    if (item.__typename === 'HeadRefForcePushedEvent' && owner(item.actor)) times.push(item.createdAt);
    if (item.__typename === 'IssueComment' && owner(item.author)) times.push(item.createdAt);
    if (item.__typename === 'PullRequestReview' && owner(item.author)) times.push(item.submittedAt);
    if (item.__typename === 'PullRequestCommit' && owner(item.commit.author?.user)) times.push(Math.min(new Date(item.commit.committedDate).getTime(), now));
  }
  for (const thread of pr.reviewThreads.nodes) {
    for (const comment of thread.comments.nodes) if (owner(comment.author)) times.push(comment.createdAt);
  }
  return latest(times);
}

// What a pull request does to what is brought in from another repository: null for nothing,
// or { entries, own } with the imports it changes and whether their code owners opened it.
// `importers` are the logins of those owners; `anyone` when a team of them can't be read.
export function importedChange(pr, files, { importers = [], anyone = false }) {
  const entries = IMPORTED.filter((entry) => files.some((file) => file.startsWith(entry.path)));
  if (entries.length === 0) return null;
  return { entries, own: anyone || importers.includes(pr.author.login.toLowerCase()) };
}

// Whether the policy already said something on a pull request or an issue, by its marker.
const marked = (comments, marker) => comments.some(({ body }) => body?.includes(marker));

// What the policy does with one pull request. `imported` is what importedChange says.
export function decide(pr, { now, owners, anyone = false, start = POLICY_START, imported = null }) {
  const labels = pr.labels.nodes.map(({ name }) => name);
  const actions = [];
  if (pr.isDraft || isBot(pr.author)) return { actions, notes: [pr.isDraft ? 'draft' : 'opened by a bot'] };
  const notes = [];
  if (imported && !imported.own) {
    const comments = pr.timelineItems.nodes.filter(({ __typename }) => __typename === 'IssueComment');
    if (new Date(pr.createdAt).getTime() >= start && !marked(comments, MARKER.imported)) {
      actions.push({ type: 'close-imported', entries: imported.entries });
      return { actions, notes: [`changes ${imported.entries.map(({ name }) => name).join(', ')}, not opened by its code owners`] };
    }
    notes.push(`changes ${imported.entries.map(({ name }) => name).join(', ')}: opened before the policy, or reopened`);
  } else if (imported) {
    notes.push(`brings in ${imported.entries.map(({ name }) => name).join(', ')}: a maintainer merges it`);
  }
  if (!labels.includes(HUMAN) && !imported?.own) {
    const overdue = openFindings(pr, { start }).filter(({ since }) => now - since > REVIEW_DEADLINE);
    if (overdue.length) {
      actions.push({ type: 'close', findings: overdue });
      return { actions, notes: [`${overdue.length} review finding(s) open for more than 24 hours`] };
    }
  }
  const since = waitingSince(pr, { owners, anyone, start, now });
  const waited = now - since;
  if (waited > OWNER_DEADLINE && !labels.includes(TAKEOVER)) actions.push({ type: 'label', since });
  if (waited <= OWNER_DEADLINE && labels.includes(TAKEOVER)) actions.push({ type: 'unlabel' });
  notes.push(`waiting on code owners for ${Math.floor(waited / (24 * HOUR))} day(s)`);
  return { actions, notes };
}

const policy = (repo) => `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/blob/main/CONTRIBUTING.md#merge-policy`;

export function closeComment(findings, repo) {
  return [
    MARKER.review,
    `Closed: the AI review raised ${findings.length === 1 ? 'a finding' : 'findings'} more than 24 hours ago that nobody has answered.`,
    '',
    ...findings.map(({ what }) => `- ${what}`),
    '',
    `Push a fix, or reply where you disagree (on the line for a line comment, on the pull request for a denial), then reopen the pull request, or open a new one: that runs the review again. A pull request written by a person rather than an agent gets the \`${HUMAN}\` label, and this rule does not apply to it. See [the merge policy](${policy(repo)}).`,
  ].join('\n');
}

const importedSection = (repo) => `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/blob/main/CONTRIBUTING.md#brought-in-from-another-repository`;
const mentions = (owners) => owners.map((owner) => `@${owner}`).join(' ');

export function importedComment(entries, owners, repo) {
  const names = entries.map(({ name }) => name).join(' and ');
  const from = entries.map(origin).join(' and ');
  return [
    MARKER.imported,
    `Closed: this pull request changes ${names}, which ${entries.length === 1 ? 'is' : 'are'} brought in from ${from}. ${owners.length ? `Its code owners (${mentions(owners)})` : 'Its code owners'} write it there, and the next import overwrites a change made here.`,
    '',
    `Take the change to them, or to ${from}. If they want it here after all, a maintainer reopens this pull request, and it is not closed again. See [Brought in from another repository](${importedSection(repo)}).`,
  ].join('\n');
}

export function importedIssueComment(entry, plugin, owners, repo) {
  return [
    MARKER.imported,
    `${owners.length ? `${mentions(owners)}: this` : 'This'} issue is about \`${plugin}\`, which is brought in from ${origin(entry)}. It is written and fixed there, by its code owners, so this issue is closed here. They have been told; one of them reopens it to keep it here. See [Brought in from another repository](${importedSection(repo)}).`,
  ].join('\n');
}

// The plugin an issue form names under "Plugin", or null.
export function formPlugin(body) {
  return body?.match(/^###\s+Plugin\s*\r?\n+\s*(\S[^\r\n]*?)\s*$/m)?.[1] ?? null;
}

// The import an issue is about, from its form, or null.
export const importOfPlugin = (plugin) => IMPORTED.find((entry) => Object.hasOwn(entry.plugins, plugin ?? '')) ?? null;

export function takeoverComment(owners, repo) {
  const mention = owners.length ? `${owners.map((owner) => `@${owner}`).join(' ')}: this` : 'This';
  return [
    MARKER.takeover,
    `${mention} pull request has waited a week for its code owners. From now on a maintainer may close it, merge it or change it. The \`${TAKEOVER}\` label goes when a code owner reviews it, comments on it or pushes to it. See [the merge policy](${policy(repo)}).`,
  ].join('\n');
}

// --- GitHub ---

export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title url isDraft createdAt headRefOid
      author { __typename login }
      labels(first: 50) { nodes { name } }
      commits(last: 1) { nodes { commit { status { contexts { context state createdAt } } } } }
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated comments(first: 30) { nodes { author { __typename login } body path line originalLine createdAt } } }
      }
      timelineItems(last: 100, itemTypes: [READY_FOR_REVIEW_EVENT, REOPENED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT]) {
        nodes {
          __typename
          ... on ReadyForReviewEvent { createdAt }
          ... on ReopenedEvent { createdAt }
          ... on HeadRefForcePushedEvent { createdAt actor { __typename login } }
          ... on IssueComment { createdAt body author { __typename login } }
          ... on PullRequestReview { submittedAt author { __typename login } }
          ... on PullRequestCommit { commit { committedDate author { user { __typename login } } } }
        }
      }
    }
  }
}`;

function client(token, api = process.env.GITHUB_API_URL || 'https://api.github.com') {
  const call = async (method, path, body) => {
    const res = await fetch(`${api}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? undefined : res.json();
  };
  const pages = async (path) => {
    const items = [];
    for (let page = 1; ; page += 1) {
      const batch = await call('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };
  const graphql = async (query, variables) => {
    const { data, errors } = await call('POST', 'graphql', { query, variables });
    if (errors?.length) throw new Error(errors.map(({ message }) => message).join('; '));
    return data;
  };
  return { call, pages, graphql };
}

// Members of the teams among the owners. A team the token can't read makes `anyone` true.
async function resolveOwners(gh, owners, teams) {
  const logins = [];
  let anyone = false;
  for (const owner of owners) {
    if (!owner.includes('/')) {
      logins.push(owner);
      continue;
    }
    if (!teams.has(owner)) {
      const [org, slug] = owner.split('/');
      teams.set(owner, await gh.pages(`orgs/${org}/teams/${slug}/members`)
        .then((members) => members.map(({ login }) => login.toLowerCase()))
        .catch(() => {
          warning(`can't read the members of @${owner}: any reviewer counts as its owner`);
          return undefined;
        }));
    }
    const members = teams.get(owner);
    if (members) logins.push(...members);
    else anyone = true;
  }
  return { owners: logins, anyone };
}

// The labels the policy reads and sets, created when the repository lacks them.
const LABELS = [
  { name: HUMAN, color: '0e8a16', description: 'Written by a person, not an agent: the 24-hour rule of the merge policy does not apply' },
  { name: TAKEOVER, color: 'd93f0b', description: 'Waited a week for its code owners: a maintainer may close, merge or change it' },
];

async function ensureLabels(gh, repo) {
  for (const label of LABELS) {
    await gh.call('GET', `repos/${repo}/labels/${label.name}`)
      .catch(() => gh.call('POST', `repos/${repo}/labels`, label));
  }
}

// Whether an issue is to be closed for being about an import: { entry, plugin, importers },
// or null. Not when one of its code owners opened it, or the policy said so before.
async function decideIssue(gh, repo, issue, rules, teams) {
  const plugin = formPlugin(issue.body);
  const entry = importOfPlugin(plugin);
  if (!entry || /\[bot\]$/.test(issue.user.login)) return null;
  const importers = ownersOf(rules, [entry.plugins[plugin]]);
  const { owners, anyone } = await resolveOwners(gh, importers, teams);
  if (anyone || owners.includes(issue.user.login.toLowerCase())) return null;
  const comments = await gh.pages(`repos/${repo}/issues/${issue.number}/comments`);
  if (marked(comments, MARKER.imported)) return null;
  return { entry, plugin, importers };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const apply = args.includes('--apply');
  const repo = option('--repo') || process.env.GITHUB_REPOSITORY || 'adobe/skills';
  const only = option('--pr');
  if (only !== undefined && !/^[1-9]\d*$/.test(only)) {
    console.error(`--pr takes the number of a pull request, not ${only}`);
    process.exit(1);
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GH_TOKEN or GITHUB_TOKEN is needed');
    process.exit(1);
  }
  const [owner, name] = repo.split('/');
  const gh = client(token);
  const rules = parseCodeowners(readFileSync('.github/CODEOWNERS', 'utf8'));
  const numbers = only ? [Number(only)] : (await gh.pages(`repos/${repo}/pulls?state=open`)).map(({ number }) => number);
  if (apply) await ensureLabels(gh, repo);
  const teams = new Map();
  const now = option('--now') ? Date.parse(option('--now')) : Date.now();
  if (Number.isNaN(now)) {
    console.error(`--now takes a date, not ${option('--now')}`);
    process.exit(1);
  }
  const rows = [];
  let failed = false;

  for (const number of numbers) {
    try {
      const { repository: { pullRequest: pr } } = await gh.graphql(QUERY, { owner, name, number });
      const files = (await gh.pages(`repos/${repo}/pulls/${number}/files`)).map(({ filename }) => filename);
      const named = ownersOf(rules, files);
      const { owners, anyone } = await resolveOwners(gh, named, teams);
      const importedFiles = files.filter((file) => IMPORTED.some((entry) => file.startsWith(entry.path)));
      const importers = ownersOf(rules, importedFiles);
      const resolved = importedFiles.length ? await resolveOwners(gh, importers, teams) : { owners: [], anyone: false };
      const imported = importedChange(pr, files, { importers: resolved.owners, anyone: resolved.anyone });
      const { actions, notes } = decide(pr, { now, owners, anyone, imported });
      const did = [];
      for (const action of actions) {
        if (action.type === 'close-imported') {
          did.push('closed');
          if (!apply) continue;
          await gh.call('POST', `repos/${repo}/issues/${number}/comments`, { body: importedComment(action.entries, importers, repo) });
          await gh.call('PATCH', `repos/${repo}/pulls/${number}`, { state: 'closed' });
        }
        if (action.type === 'close') {
          did.push('closed');
          if (!apply) continue;
          await gh.call('POST', `repos/${repo}/issues/${number}/comments`, { body: closeComment(action.findings, repo) });
          await gh.call('PATCH', `repos/${repo}/pulls/${number}`, { state: 'closed' });
        }
        if (action.type === 'label') {
          did.push(`labelled \`${TAKEOVER}\``);
          if (!apply) continue;
          await gh.call('POST', `repos/${repo}/issues/${number}/labels`, { labels: [TAKEOVER] });
          await gh.call('POST', `repos/${repo}/issues/${number}/comments`, { body: takeoverComment(named.filter((login) => login !== pr.author.login.toLowerCase()), repo) });
        }
        if (action.type === 'unlabel') {
          did.push(`\`${TAKEOVER}\` removed`);
          if (apply) await gh.call('DELETE', `repos/${repo}/issues/${number}/labels/${TAKEOVER}`);
        }
      }
      const line = `#${number} ${pr.title}: ${notes.join('; ')}${did.length ? ` → ${did.join(', ')}${apply ? '' : ' (dry run)'}` : ''}`;
      console.log(line);
      rows.push([`[#${number}](${pr.url})`, notes.join('; '), did.join(', ') || '–']);
    } catch (error) {
      failed = true;
      console.log(`::error::#${number}: ${error.message}`);
      rows.push([`#${number}`, error.message.split('\n')[0], 'failed']);
    }
  }
  // Issues about a plugin that is brought in from another repository. Only the ones opened
  // since the policy started, and only when a whole run is asked for.
  const issueRows = [];
  const issues = only ? [] : (await gh.pages(`repos/${repo}/issues?state=open&since=${new Date(POLICY_START).toISOString()}`))
    .filter((issue) => !issue.pull_request && Date.parse(issue.created_at) >= POLICY_START);
  for (const issue of issues) {
    try {
      const decision = await decideIssue(gh, repo, issue, rules, teams);
      if (!decision) continue;
      const { entry, plugin, importers } = decision;
      if (apply) {
        await gh.call('POST', `repos/${repo}/issues/${issue.number}/comments`, { body: importedIssueComment(entry, plugin, importers, repo) });
        await gh.call('PATCH', `repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'not_planned' });
      }
      console.log(`issue #${issue.number} ${issue.title}: about ${plugin} → closed${apply ? '' : ' (dry run)'}`);
      issueRows.push([`[#${issue.number}](${issue.html_url})`, `about \`${plugin}\``, 'closed']);
    } catch (error) {
      failed = true;
      console.log(`::error::issue #${issue.number}: ${error.message}`);
      issueRows.push([`#${issue.number}`, error.message.split('\n')[0], 'failed']);
    }
  }
  summary([
    `## Merge policy${apply ? '' : ' (dry run)'}`,
    '',
    ...table(['Pull request', 'State', 'Action'], rows),
    ...(issueRows.length ? ['', ...table(['Issue', 'State', 'Action'], issueRows)] : []),
  ]);
  process.exit(failed ? 1 : 0);
}

if (isMain(import.meta.url)) main();
