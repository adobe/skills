'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const lts = 'plugins/aem/6.5-lts/skills/aem-replication/';
const cloud = 'plugins/aem/cloud-service/skills/content-distribution/';

test('default content agent uses Default serialization, flush ACL denies arbitrary clients', () => {
  const text = read(lts + 'references/replication-foundation/agent-types.md');
  const content = text.split('## Dispatcher Flush Agent')[0];
  assert.match(content, /Serialization Type: Default\b/);
  const acl = text.match(/```apache\n([\s\S]*?)```/)[1];
  assert.match(acl, /\/type "deny" \/glob "\*"/);
  assert.doesNotMatch(acl, /\/type "allow" \/glob "\*"/);
  assert.match(acl, /TRUSTED.*IP/);
});

test('queue reference uses real API members and synchronous attachment, not universal registration', () => {
  const text = read(lts + 'references/replication-foundation/queue-mechanics.md');
  assert.doesNotMatch(text, /getEntries\(|getState\(|State\.BLOCKED|automatically invoked/);
  assert.match(text, /\.entries\(\)/);
  assert.match(text, /\.getStatus\(\)/);
  assert.match(text, /void onMessage\(ReplicationLog\.Level/);
  assert.match(text, /\.setListener\(/);
  assert.match(text, /synchronous.*only|only.*synchronous/i);
});

test('Cloud operational guidance distinguishes two queues and excludes hosted Felix console', () => {
  const text = read(cloud + 'replication/SKILL.md');
  assert.doesNotMatch(text, /adobeaemcloud\.com\/system\/console|no extra options needed|system auto-splits if exceeded/);
  assert.match(text, /Tools.*Deployment.*Distribution/);
  assert.match(text, /two queues/i);
  assert.match(text, /all publish pods/);
  assert.match(text, /getStatusForAgent\("preview"\)/);
  assert.doesNotMatch(text, /System\.out\.println/);
});
