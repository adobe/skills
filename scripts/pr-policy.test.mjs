import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR, HUMAN, QUERY, TAKEOVER, closeComment, decide, openFindings, ownersOf, parseCodeowners, takeoverComment, waitingSince,
} from './pr-policy.mjs';

const CODEOWNERS = `# comment
*                         @trieloff
/.github/                 @trieloff @shsteimer
/plugins/stardust         @paolomoz   # trailing comment
/plugins/aem/forms/eds/   @ravise5
/plugins/commerce/app/    @adobe/commerce-team
docs/*.md                 @writer
`;

test('the last matching CODEOWNERS rule names the owners of a path', () => {
  const rules = parseCodeowners(CODEOWNERS);
  assert.deepEqual(ownersOf(rules, ['README.md']), ['trieloff']);
  assert.deepEqual(ownersOf(rules, ['.github/workflows/x.yml']), ['trieloff', 'shsteimer']);
  assert.deepEqual(ownersOf(rules, ['plugins/stardust/skills/a/SKILL.md']), ['paolomoz']);
  assert.deepEqual(ownersOf(rules, ['plugins/stardust-other/x']), ['trieloff']);
  assert.deepEqual(ownersOf(rules, ['plugins/aem/forms/eds/a.md', 'plugins/commerce/app/b']), ['ravise5', 'adobe/commerce-team']);
  assert.deepEqual(ownersOf(rules, ['docs/a.md', 'docs/sub/b.md']), ['writer', 'trieloff']);
});

const NOW = Date.parse('2026-12-01T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const bot = { __typename: 'Bot', login: 'github-actions' };
const user = (login) => ({ __typename: 'User', login });

function pr({ labels = [], draft = false, author = user('agent-user'), created = ago(2), statuses = [], threads = [], timeline = [] } = {}) {
  return {
    id: 'PR_1', number: 1, title: 't', url: 'u', isDraft: draft, createdAt: created, headRefOid: 'abcdef1234567',
    author,
    labels: { nodes: labels.map((name) => ({ name })) },
    commits: { nodes: [{ commit: { status: { contexts: statuses } } }] },
    reviewThreads: { nodes: threads },
    timelineItems: { nodes: timeline },
  };
}
const thread = (comments, { resolved = false, outdated = false } = {}) => ({
  isResolved: resolved, isOutdated: outdated,
  comments: { nodes: comments.map(([author, body, hours]) => ({ author, body, path: 'a/SKILL.md', line: 3, createdAt: ago(hours) })) },
});
const opts = { now: NOW, owners: ['owner'], start: 0 };

test('an agent pull request with a denial older than 24 hours is closed', () => {
  const denied = pr({ statuses: [{ context: 'review / claude', state: 'FAILURE', createdAt: ago(25) }, { context: 'review / codex', state: 'SUCCESS', createdAt: ago(25) }] });
  const { actions } = decide(denied, opts);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'close');
  assert.match(actions[0].findings[0].what, /claude denied abcdef1/);

  const fresh = pr({ statuses: [{ context: 'review / codex', state: 'FAILURE', createdAt: ago(23) }] });
  assert.deepEqual(decide(fresh, opts).actions, []);
  const errored = pr({ statuses: [{ context: 'review / codex', state: 'ERROR', createdAt: ago(48) }] });
  assert.deepEqual(decide(errored, opts).actions, []);
});

test('a line comment of the AI review counts until it is resolved, outdated or answered by a person', () => {
  const open = thread([[bot, '**codex:** this path does not exist', 30]]);
  assert.equal(openFindings(pr({ threads: [open] }), { start: 0 }).length, 1);
  assert.equal(openFindings(pr({ threads: [thread([[bot, '**codex:** x', 30]], { resolved: true })] }), { start: 0 }).length, 0);
  assert.equal(openFindings(pr({ threads: [thread([[bot, '**codex:** x', 30]], { outdated: true })] }), { start: 0 }).length, 0);
  assert.equal(openFindings(pr({ threads: [thread([[bot, '**codex:** x', 30], [user('agent-user'), 'it does, see …', 2]])] }), { start: 0 }).length, 0);
  assert.equal(openFindings(pr({ threads: [thread([[bot, '**codex:** x', 30], [bot, 'bot reply', 2]])] }), { start: 0 }).length, 1);
  // a person's line comment is not the AI review's
  assert.equal(openFindings(pr({ threads: [thread([[user('someone'), 'nit', 30]])] }), { start: 0 }).length, 0);
  // the same reviewer on the same line is one finding
  assert.equal(openFindings(pr({ threads: [open, thread([[bot, '**codex:** said again', 29]])] }), { start: 0 }).length, 1);
});

test('the 24 hours start again when a pull request is reopened or marked ready, and not before the policy started', () => {
  const statuses = [{ context: 'review / claude', state: 'FAILURE', createdAt: ago(48) }];
  assert.deepEqual(decide(pr({ statuses, timeline: [{ __typename: 'ReadyForReviewEvent', createdAt: ago(2) }] }), opts).actions, []);
  assert.deepEqual(decide(pr({ statuses, timeline: [{ __typename: 'ReopenedEvent', createdAt: ago(2) }] }), opts).actions, []);
  assert.deepEqual(decide(pr({ statuses }), { ...opts, start: NOW - 10 * HOUR }).actions, []);
});

test('a pull request with the human label, a draft and a bot\'s pull request are not closed', () => {
  const statuses = [{ context: 'review / claude', state: 'FAILURE', createdAt: ago(48) }];
  assert.ok(!decide(pr({ statuses, labels: [HUMAN] }), opts).actions.some(({ type }) => type === 'close'));
  assert.deepEqual(decide(pr({ statuses, draft: true, created: ago(24 * 30) }), opts).actions, []);
  assert.deepEqual(decide(pr({ statuses, author: { __typename: 'Bot', login: 'renovate' } }), opts).actions, []);
});

test('a week without a code owner gets the takeover label, and an owner acting takes it off', () => {
  const idle = pr({ created: ago(24 * 30), labels: [HUMAN] });
  assert.deepEqual(decide(idle, opts).actions.map(({ type }) => type), ['label']);

  const reviewed = pr({ created: ago(24 * 30), labels: [HUMAN, TAKEOVER], timeline: [{ __typename: 'PullRequestReview', submittedAt: ago(5), author: user('Owner') }] });
  assert.deepEqual(decide(reviewed, opts).actions.map(({ type }) => type), ['unlabel']);

  // others than the owner don't stop the clock, the author's comments don't either
  const chatter = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [{ __typename: 'IssueComment', createdAt: ago(1), author: user('agent-user') }, { __typename: 'IssueComment', createdAt: ago(1), author: user('bystander') }] });
  assert.deepEqual(decide(chatter, opts).actions.map(({ type }) => type), ['label']);

  // a push by an owner counts
  const pushed = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [{ __typename: 'PullRequestCommit', commit: { committedDate: ago(3), author: { user: user('owner') } } }] });
  assert.deepEqual(decide(pushed, opts).actions, []);
  // a force push by an owner counts when GitHub saw it, whatever the dates of its commits
  const forced = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [
    { __typename: 'PullRequestCommit', commit: { committedDate: ago(24 * 20), author: { user: user('owner') } } },
    { __typename: 'HeadRefForcePushedEvent', createdAt: ago(3), actor: user('owner') },
  ] });
  assert.deepEqual(decide(forced, opts).actions, []);
  // a commit dated in the future counts as now, not as then
  const future = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [{ __typename: 'PullRequestCommit', commit: { committedDate: ago(-24 * 30), author: { user: user('owner') } } }] });
  assert.equal(waitingSince(future, { owners: ['owner'], start: 0, now: NOW }), NOW);

  // the week starts again when the pull request is marked ready
  const ready = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [{ __typename: 'ReadyForReviewEvent', createdAt: ago(24 * 6) }] });
  assert.deepEqual(decide(ready, opts).actions, []);
});

test('an owner team nobody could resolve lets anyone but the author stop the clock', () => {
  const commented = pr({ created: ago(24 * 30), labels: [HUMAN], timeline: [{ __typename: 'IssueComment', createdAt: ago(1), author: user('bystander') }] });
  assert.equal(waitingSince(commented, { owners: [], anyone: true, start: 0 }), NOW - HOUR);
  assert.deepEqual(decide(commented, { ...opts, owners: [], anyone: true }).actions, []);
});

test('the comments link the policy and mention the owners', () => {
  const text = closeComment([{ what: 'claude denied abcdef1' }], 'adobe/skills');
  assert.match(text, /^<!-- pr-policy:review-overdue -->/);
  assert.match(text, /- claude denied abcdef1/);
  assert.match(text, /\(https:\/\/github\.com\/adobe\/skills\/blob\/main\/CONTRIBUTING\.md#merge-policy\)/);
  assert.match(takeoverComment(['paolomoz', 'adobe/commerce-team'], 'adobe/skills'), /@paolomoz @adobe\/commerce-team: /);
  assert.doesNotMatch(takeoverComment([], 'adobe/skills').replace(/\(https:[^)]*\)/, ''), /@/);
});

test('the query asks GitHub for no more than 100 items of a connection', () => {
  const sizes = [...QUERY.matchAll(/\b(?:first|last):\s*(\d+)/g)].map(([, size]) => Number(size));
  assert.ok(sizes.length > 0);
  for (const size of sizes) assert.ok(size >= 1 && size <= 100, `${size}`);
});
