// Runs scripts/plugin-version.mjs against a temp fixture repo: one managed plugin (`demo`),
// one neighbour entry with formatting the scoped marketplace write must leave byte-identical.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = join(import.meta.dirname, '..', 'plugin-version.mjs');

const MARKET = `{
  "name": "fixture",
  "metadata": { "version": "1.0.0" },
  "plugins": [
    {
      "name": "other",
      "source": "./plugins/other",
      "description": "Braces in a string: {{ and { must not confuse the scanner }",
      "version": "3.0.0",
      "keywords": ["a", "b"],
      "author": { "name": "X" }
    },
    {
      "name": "demo",
      "author": { "name": "X" },
      "source": "./plugins/demo",
      "version": "1.0.0"
    }
  ]
}
`;

function fixture({
  market = MARKET, tesslVersion = '1.0.0', skills = ['skills/a', 'skills/b'],
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-version-'));
  mkdirSync(join(root, 'scripts'));
  cpSync(SCRIPT, join(root, 'scripts', 'plugin-version.mjs'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), market);
  const demo = join(root, 'plugins', 'demo');
  mkdirSync(join(demo, '.claude-plugin'), { recursive: true });
  mkdirSync(join(demo, '.tessl-plugin'));
  writeFileSync(join(demo, '.claude-plugin', 'plugin.json'),
    '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n');
  writeFileSync(join(demo, '.tessl-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'demo', version: tesslVersion, skills }, null, 2)}\n`);
  for (const s of ['a', 'b']) {
    mkdirSync(join(demo, 'skills', s), { recursive: true });
    writeFileSync(join(demo, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
  }
  mkdirSync(join(demo, 'skills', 'shared'));
  return root;
}

const FILES = [
  '.claude-plugin/marketplace.json',
  'plugins/demo/.claude-plugin/plugin.json',
  'plugins/demo/.tessl-plugin/plugin.json',
];
const snapshot = (root) => FILES.map((f) => readFileSync(join(root, f), 'utf8'));
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'plugin-version.mjs'), ...args], {
    cwd: root, encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('check: in-step fixture exits 0', () => {
  const root = fixture();
  const r = run(root, 'plugins/demo');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /demo 1\.0\.0: manifests in step/);
  rmSync(root, { recursive: true });
});

test('check: every drift class is named, exit 1, fix command printed', () => {
  const root = fixture({
    market: MARKET.replace('"version": "1.0.0"\n    }', '"version": "0.9.0"\n    }'),
    tesslVersion: '0.8.0',
    skills: ['skills/a', 'skills/a', 'skills/zzz'],
  });
  const r = run(root, 'plugins/demo');
  assert.equal(r.code, 1);
  assert.match(r.err, /marketplace\.json 0\.9\.0 ≠ plugin\.json 1\.0\.0/);
  assert.match(r.err, /tessl-plugin\/plugin\.json 0\.8\.0 ≠ plugin\.json 1\.0\.0/);
  assert.match(r.err, /skills missing: skills\/b/);
  assert.match(r.err, /skills not shipped: skills\/zzz/);
  assert.match(r.err, /skills listed twice: skills\/a/);
  assert.match(r.err, /fix: node scripts\/plugin-version\.mjs plugins\/demo 1\.0\.0/);
  rmSync(root, { recursive: true });
});

test('set: all three written; marketplace differs by one line; skills regenerated', () => {
  const root = fixture({ skills: ['skills/a'] });
  const before = snapshot(root);
  const r = run(root, 'plugins/demo', '2.0.0-rc.1+build.7');
  assert.equal(r.code, 0, r.err);
  const [market, plugin, tessl] = snapshot(root);
  assert.equal(JSON.parse(plugin).version, '2.0.0-rc.1+build.7');
  const t = JSON.parse(tessl);
  assert.equal(t.version, '2.0.0-rc.1+build.7');
  assert.deepEqual(t.skills, ['skills/a', 'skills/b']);
  const changed = market.split('\n').filter((l, i) => l !== before[0].split('\n')[i]);
  assert.deepEqual(changed, ['      "version": "2.0.0-rc.1+build.7"']);
  assert.equal(JSON.parse(market).metadata.version, '1.0.0');
  assert.equal(run(root, 'plugins/demo').code, 0);
  rmSync(root, { recursive: true });
});

test('set: refusals exit 2 and write nothing', () => {
  const cases = [
    { args: ['plugins/demo', '01.2.3'], err: /not a semver/ },
    { args: ['plugins/demo', '1.2.3-01'], err: /not a semver/ },
    { args: ['plugins/demo', 'v1.2.3'], err: /not a semver/ },
    { args: ['plugins/demo', '--help'], err: /not a semver/ },
    { args: ['plugins/nope', '1.2.3'], err: /not a plugin dir/ },
    { args: ['plugins/demo', '1.2.3'], err: /is not formatted as/,
      market: MARKET.replace('"source": "./plugins/demo"', '"source":"./plugins/demo"') },
  ];
  for (const c of cases) {
    const root = fixture({ market: c.market });
    const before = snapshot(root);
    const r = run(root, ...c.args);
    assert.equal(r.code, 2, `${c.args.join(' ')}: ${r.err}`);
    assert.match(r.err, c.err);
    assert.deepEqual(snapshot(root), before, `${c.args.join(' ')} wrote a file`);
    rmSync(root, { recursive: true });
  }
});

test('required manifests: missing entry, versionless entry, missing Tessl manifest exit 2', () => {
  let root = fixture({
    market: MARKET.replace('"source": "./plugins/demo"', '"source": "./x"'),
  });
  assert.match(run(root, 'plugins/demo').err, /no entry with "source": "\.\/plugins\/demo"/);
  assert.equal(run(root, 'plugins/demo').code, 2);
  rmSync(root, { recursive: true });

  root = fixture({
    market: MARKET.replace('"version": "1.0.0"\n    }', '"x": 1\n    }'),
  });
  assert.match(run(root, 'plugins/demo').err, /has no version/);
  rmSync(root, { recursive: true });

  root = fixture();
  rmSync(join(root, 'plugins/demo/.tessl-plugin'), { recursive: true });
  assert.match(run(root, 'plugins/demo').err, /missing Tessl manifest/);
  assert.equal(run(root, 'plugins/demo').code, 2);
  rmSync(root, { recursive: true });
});

test('usage: --help exits 0 with usage; no args exits 2', () => {
  const root = fixture();
  const h = run(root, '--help');
  assert.equal(h.code, 0);
  assert.match(h.out, /^usage: plugin-version\.mjs/);
  assert.equal(run(root).code, 2);
  assert.deepEqual(snapshot(root), snapshot(root));
  rmSync(root, { recursive: true });
});
