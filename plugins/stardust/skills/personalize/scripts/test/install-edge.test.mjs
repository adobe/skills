import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { guessOrigin, installEdge } from '../install-edge.mjs';
import { runHelp, siteRepo, tempDir } from './helpers.mjs';

describe('installEdge', () => {
  it('scaffolds the worker, is idempotent and keeps it off the code bus', () => {
    const { dir, cleanup } = siteRepo();
    try {
      execFileSync('git', ['init', '-q', dir]);
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:Acme/Site.git']);
      assert.equal(guessOrigin(dir), 'main--site--acme.aem.live');
      const first = installEdge(dir, { route: 'www.acme.com/*' });
      const worker = join(dir, 'cdn', 'cloudflare-worker');
      ['src/index.mjs', 'src/aem-worker.mjs', 'src/personalization/rules.js', 'src/personalization/personalize.js',
        'src/personalization/edge-config.js', 'wrangler.toml', 'package.json'].forEach((file) => {
        assert.ok(existsSync(join(worker, file)), file);
      });
      const toml = readFileSync(join(worker, 'wrangler.toml'), 'utf8');
      assert.match(toml, /ORIGIN_HOSTNAME = "main--site--acme.aem.live"/);
      assert.match(toml, /www\.acme\.com\/\*/);
      assert.doesNotMatch(toml, /\{\{/);
      assert.ok(first.next.some((step) => /account_id/.test(step)));
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'cdn/\n');

      writeFileSync(join(worker, 'src', 'personalization', 'edge-config.js'), '// site\n');
      const second = installEdge(dir);
      assert.deepEqual(second.created, []);
      assert.ok(second.kept.includes('src/personalization/edge-config.js'));
      assert.ok(second.kept.includes('wrangler.toml'));
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'cdn/\n');
    } finally {
      cleanup();
    }
  });

  it('adds only the personalization modules to an existing worker', () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, '.hlxignore'), 'tools/');
      const report = installEdge(dir, { existing: 'workers/site' });
      assert.ok(existsSync(join(dir, 'workers', 'site', 'src', 'personalization', 'personalize.js')));
      assert.equal(existsSync(join(dir, 'workers', 'site', 'src', 'index.mjs')), false);
      assert.equal(existsSync(join(dir, 'workers', 'site', 'wrangler.toml')), false);
      assert.match(report.next[0], /handleApiRoute/);
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'tools/\nworkers/\n');
    } finally {
      cleanup();
    }
  });
});

describe('install-edge.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('install-edge.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
