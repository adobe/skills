'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const replication = require('./replication.js');
const { RULES } = require('../../plan.js');

test('migration planning includes retired Sling replication callers', () => {
  const rule = RULES.find((entry) => entry.pattern === 'replication');
  assert.equal(rule.test('Service.java', 'import org.apache.sling.replication.agent.api.ReplicationAgent;'), true);
});

for (const [name, imports, accepted] of [
  ['cq', 'com.day.cq.replication', true],
  ['distribution', 'org.apache.sling.distribution', true],
  ['both', 'com.day.cq.replication,org.apache.sling.distribution', true],
  ['unsupported', 'org.apache.sling.replication.agent.api', false],
  ['mixed-unsupported', 'com.day.cq.replication,org.apache.sling.replication.agent.api', false],
  ['unrelated', 'org.osgi.framework', true],
]) {
  test(`replication bundle contract: ${name}`, async (context) => {
    const root = fs.mkdtempSync(path.join(process.env.REPLICATION_TEST_WORKDIR || __dirname, 'replication-contract-'));
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'META-INF'), { recursive: true });
    fs.writeFileSync(path.join(root, 'META-INF/MANIFEST.MF'),
      `Bundle-SymbolicName: replication.${name}\nImport-Package: ${imports}\n`);
    const jar = path.join(root, 'bundle.jar');
    execFileSync('zip', ['-q', jar, 'META-INF/MANIFEST.MF'], { cwd: root });
    const map = path.join(root, 'diagnosis.json');
    fs.writeFileSync(map, JSON.stringify(Object.fromEntries(
      ['cq', 'distribution', 'both', 'unsupported', 'mixed-unsupported', 'unrelated']
        .map((entry) => [`replication.${entry}`, `Bundle: replication.${entry}\nState: Active\n`]),
    )));
    const discovered = replication.discover(jar, {});
    const outcome = await replication.verify({
      bundleBSN: `replication.${name}`, discovered, args: { 'diagnosis-map': map },
    });
    assert.equal(outcome.result, accepted ? 'pass' : 'fail', outcome.evidence);
    if (!accepted) assert.match(outcome.evidence, /org\.apache\.sling\.replication/);
    if (accepted) assert.equal(outcome.restricted, true, 'Import acceptance is not delivery verification');
  });
}
