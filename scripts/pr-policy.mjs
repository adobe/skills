// The merge policy of CONTRIBUTING.md, applied to the open pull requests:
//
// - An agent's pull request (any without the `human` label) whose head commit the AI review
//   denied, or that has a line comment of the AI review nobody answered, more than 24 hours
//   ago, is turned into a draft, with a comment that says why. Drafts are not merged.
// - A pull request that is ready for review and that none of its code owners has reviewed,
//   commented on or pushed to for a week gets the `takeover` label: a maintainer may now
//   close, merge or change it. The label goes once an owner acts again.
//
// Pull requests opened by a bot (Renovate, the release) are left alone.
//   node scripts/pr-policy.mjs [--apply] [--repo owner/name] [--pr <number>] [--now <date>]
// Without --apply it only says what it would do; --now says what it would do then.
// GH_TOKEN or GITHUB_TOKEN is the token.
import { readFileSync } from 'node:fs';
import { isMain } from './lib/is-main.mjs';
import { summary, table, warning } from './lib/actions.mjs';

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

const isBot = (actor) => !actor || actor.__typename === 'Bot' || /\[bot\]$/.test(actor.login);
const latest = (dates) => dates.filter(Boolean).map((date) => new Date(date).getTime()).reduce((a, b) => Math.max(a, b), -Infinity);

// What the AI review left unanswered on a pull request, and since when. A denial counts
// for the head commit only: a push gets a new review. A line comment counts until it is
// resolved, outdated by a change to its line, or answered by a person. The clock starts
// again when the pull request is marked ready for review, which also runs the review again.
export function openFindings(pr, { start = POLICY_START } = {}) {
  const found = [];
  const ready = latest(pr.timelineItems.nodes.filter(({ __typename }) => __typename === 'ReadyForReviewEvent').map(({ createdAt }) => createdAt));
  const since = (date) => Math.max(new Date(date).getTime(), ready, start);
  const contexts = pr.commits.nodes[0]?.commit.status?.contexts ?? [];
  for (const reviewer of REVIEWERS) {
    const status = contexts.find(({ context }) => context === `review / ${reviewer}`);
    if (status?.state === 'FAILURE') found.push({ what: `${reviewer} denied ${pr.headRefOid.slice(0, 7)}`, since: since(status.createdAt) });
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

// Since when a pull request has waited for its code owners: when it was opened or last
// marked ready for review, or when an owner last reviewed, commented or pushed, whichever
// is latest. `owners` are logins; a team that could not be resolved is `anyone`, and then
// any person but the author counts.
export function waitingSince(pr, { owners, anyone = false, start = POLICY_START }) {
  const owner = (actor) => !isBot(actor) && (owners.includes(actor.login.toLowerCase()) || (anyone && actor.login !== pr.author.login));
  const times = [pr.createdAt, start];
  for (const item of pr.timelineItems.nodes) {
    if (item.__typename === 'ReadyForReviewEvent') times.push(item.createdAt);
    if (item.__typename === 'IssueComment' && owner(item.author)) times.push(item.createdAt);
    if (item.__typename === 'PullRequestReview' && owner(item.author)) times.push(item.submittedAt);
    if (item.__typename === 'PullRequestCommit' && owner(item.commit.author?.user)) times.push(item.commit.committedDate);
  }
  for (const thread of pr.reviewThreads.nodes) {
    for (const comment of thread.comments.nodes) if (owner(comment.author)) times.push(comment.createdAt);
  }
  return latest(times);
}

// What the policy does with one pull request.
export function decide(pr, { now, owners, anyone = false, start = POLICY_START }) {
  const labels = pr.labels.nodes.map(({ name }) => name);
  const actions = [];
  if (pr.isDraft || isBot(pr.author)) return { actions, notes: [pr.isDraft ? 'draft' : 'opened by a bot'] };
  const notes = [];
  if (!labels.includes(HUMAN)) {
    const overdue = openFindings(pr, { start }).filter(({ since }) => now - since > REVIEW_DEADLINE);
    if (overdue.length) {
      actions.push({ type: 'draft', findings: overdue });
      return { actions, notes: [`${overdue.length} review finding(s) open for more than 24 hours`] };
    }
  }
  const since = waitingSince(pr, { owners, anyone, start });
  const waited = now - since;
  if (waited > OWNER_DEADLINE && !labels.includes(TAKEOVER)) actions.push({ type: 'label', since });
  if (waited <= OWNER_DEADLINE && labels.includes(TAKEOVER)) actions.push({ type: 'unlabel' });
  notes.push(`waiting on code owners for ${Math.floor(waited / (24 * HOUR))} day(s)`);
  return { actions, notes };
}

const policy = (repo) => `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/blob/main/CONTRIBUTING.md#merge-policy`;

export function draftComment(findings, repo) {
  return [
    MARKER.review,
    `This pull request is now a draft: the AI review raised ${findings.length === 1 ? 'a finding' : 'findings'} more than 24 hours ago that nobody has answered.`,
    '',
    ...findings.map(({ what }) => `- ${what}`),
    '',
    `Push a fix, or reply to a line comment where you disagree, then mark the pull request ready for review: that runs the review again. A pull request written by a person rather than an agent gets the \`${HUMAN}\` label, and this rule does not apply to it. See [the merge policy](${policy(repo)}).`,
  ].join('\n');
}

export function takeoverComment(owners, repo) {
  const mention = owners.length ? `${owners.map((owner) => `@${owner}`).join(' ')}: this` : 'This';
  return [
    MARKER.takeover,
    `${mention} pull request has waited a week for its code owners. From now on a maintainer may close it, merge it or change it. The \`${TAKEOVER}\` label goes when a code owner reviews it, comments on it or pushes to it. See [the merge policy](${policy(repo)}).`,
  ].join('\n');
}

// --- GitHub ---

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title url isDraft createdAt headRefOid
      author { __typename login }
      labels(first: 50) { nodes { name } }
      commits(last: 1) { nodes { commit { status { contexts { context state createdAt } } } } }
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated comments(first: 30) { nodes { author { __typename login } body path line originalLine createdAt } } }
      }
      timelineItems(last: 200, itemTypes: [READY_FOR_REVIEW_EVENT, ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT]) {
        nodes {
          __typename
          ... on ReadyForReviewEvent { createdAt }
          ... on IssueComment { createdAt author { __typename login } }
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
      const { actions, notes } = decide(pr, { now, owners, anyone });
      const did = [];
      for (const action of actions) {
        if (action.type === 'draft') {
          did.push('turned into a draft');
          if (!apply) continue;
          await gh.graphql('mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }', { id: pr.id });
          await gh.call('POST', `repos/${repo}/issues/${number}/comments`, { body: draftComment(action.findings, repo) });
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
  summary([`## Merge policy${apply ? '' : ' (dry run)'}`, '', ...table(['Pull request', 'State', 'Action'], rows)]);
  process.exit(failed ? 1 : 0);
}

if (isMain(import.meta.url)) main();
