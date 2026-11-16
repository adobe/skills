import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR, HUMAN, QUERY, TAKEOVER, closeComment, decide, formPlugin, importOfPlugin, importedChange, importedComment, importedIssueComment,
  openFindings, ownersOf, parseCodeowners, takeoverComment, waitingSince,
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
  // a person's reply after the denial answers it; one before it, or a bot's, does not
  const denial = [{ context: 'review / codex', state: 'FAILURE', createdAt: ago(30) }];
  const replied = (item) => decide(pr({ statuses: denial, timeline: [item] }), opts).actions;
  assert.deepEqual(replied({ __typename: 'IssueComment', createdAt: ago(5), author: user('agent-user') }), []);
  assert.deepEqual(replied({ __typename: 'PullRequestReview', submittedAt: ago(5), author: user('someone') }), []);
  assert.equal(replied({ __typename: 'IssueComment', createdAt: ago(31), author: user('agent-user') })[0].type, 'close');
  assert.equal(replied({ __typename: 'IssueComment', createdAt: ago(5), author: bot })[0].type, 'close');
  const onLine = pr({ statuses: denial, threads: [thread([[bot, '**codex:** x', 30], [user('agent-user'), 'no, because …', 5]])] });
  assert.deepEqual(decide(onLine, opts).actions, []);

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

const CREATIVITY = 'plugins/creative-cloud/adobe-for-creativity/skills/configure/SKILL.md';
const denial = [{ context: 'review / claude', state: 'FAILURE', createdAt: ago(30) }];

test('a pull request that changes what is brought in is closed at once, unless its code owners opened it', () => {
  const change = pr({ author: user('someone') });
  const imported = importedChange(change, [CREATIVITY, 'README.md'], { importers: ['solimant'] });
  assert.equal(imported.own, false);
  assert.equal(imported.entries[0].name, 'adobe-for-creativity');
  const { actions } = decide(change, { ...opts, imported });
  assert.deepEqual(actions.map(({ type }) => type), ['close-imported']);

  assert.equal(importedChange(change, ['README.md'], { importers: [] }), null);
  // a team that can't be read: not closed as an import, and still held to the AI review
  const unknown = importedChange(pr({ author: user('someone'), statuses: denial }), [CREATIVITY], { importers: [], anyone: true });
  assert.deepEqual([unknown.own, unknown.unknown], [false, true]);
  assert.deepEqual(decide(pr({ author: user('someone'), statuses: denial }), { ...opts, imported: unknown }).actions.map(({ type }) => type), ['close']);
});

test('an import by its code owners is not closed for the AI review: a maintainer merges it', () => {
  const sync = pr({ author: user('Solimant'), statuses: denial });
  const imported = importedChange(sync, [CREATIVITY], { importers: ['solimant'] });
  const { actions, notes } = decide(sync, { ...opts, imported });
  assert.deepEqual(actions, []);
  assert.match(notes[0], /a maintainer merges it/);
});

test('a change to an import is closed once, and not if it was opened before the policy', () => {
  const reopened = pr({ author: user('someone'), timeline: [{ __typename: 'IssueComment', createdAt: ago(1), author: bot, body: '<!-- pr-policy:imported -->\nClosed' }] });
  const imported = importedChange(reopened, [CREATIVITY], { importers: ['solimant'] });
  assert.deepEqual(decide(reopened, { ...opts, imported }).actions, []);
  const old = pr({ author: user('someone'), created: ago(48) });
  assert.deepEqual(decide(old, { ...opts, imported, start: NOW - HOUR }).actions, []);
  assert.deepEqual(decide(pr({ author: user('someone'), draft: true }), { ...opts, imported }).actions, []);
});

test('an issue form names its plugin, and the comments name the import and its owners', () => {
  const body = '### Plugin\n\ncommerce-app-review\n\n### Skill\n\n_No response_\n';
  assert.equal(formPlugin(body), 'commerce-app-review');
  assert.equal(formPlugin('no form'), null);
  const entry = importOfPlugin('commerce-app-review');
  assert.equal(entry.from, 'adobe/aio-commerce-sdk');
  assert.equal(importOfPlugin('stardust'), null);
  assert.equal(importOfPlugin(null), null);
  const issue = importedIssueComment(entry, 'commerce-app-review', ['adobe/commerce-team'], 'adobe/skills');
  assert.match(issue, /^<!-- pr-policy:imported -->/);
  assert.match(issue, /@adobe\/commerce-team: this issue is about `commerce-app-review`/);
  const close = importedComment([importOfPlugin('adobe-for-creativity')], ['solimant'], 'adobe/skills');
  assert.match(close, /changes adobe-for-creativity, which is brought in from another repository/);
  assert.match(close, /CONTRIBUTING\.md#brought-in-from-another-repository/);
});
