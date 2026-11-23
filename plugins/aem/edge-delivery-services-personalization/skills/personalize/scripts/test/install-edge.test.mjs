import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { guessOrigin, installEdge, workerNameFor } from '../install-edge.mjs';
import { EDGE_DIR, EDGE_MODULES, SHARED_WITH_EDGE } from '../lib.mjs';
import { runHelp, siteRepo, tempDir } from './helpers.mjs';

const MODULES = [...SHARED_WITH_EDGE, ...EDGE_MODULES].map((name) => `src/personalization/${name}`);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// Every relative import of the installed modules points at an installed file.
function unresolvedImports(workerDir) {
  return files(join(workerDir, 'src')).filter((file) => /\.m?js$/.test(file)).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm)]
      .map((match) => resolve(dirname(file), match[1]))
      .filter((target) => !existsSync(target))
      .map((target) => `${relative(workerDir, file)} -> ${relative(workerDir, target)}`);
  });
}

describe('installEdge', () => {
  it('scaffolds the worker with the shared and edge modules, is idempotent and keeps it off the code bus', () => {
    const { dir, cleanup } = siteRepo();
    try {
      execFileSync('git', ['init', '-q', dir]);
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:Acme/Site.git']);
      assert.equal(guessOrigin(dir), 'main--site--acme.aem.live');
      assert.equal(workerNameFor(dir), 'site');
      const first = installEdge(dir, { route: 'www.acme.com/*' });
      const worker = join(dir, 'cdn', 'cloudflare-worker');
      [...MODULES, 'src/index.mjs', 'src/aem-worker.mjs', 'src/personalization/edge-config.js',
        'README.md', 'LICENSE_APACHE', 'wrangler.toml', 'package.json'].forEach((file) => {
        assert.ok(existsSync(join(worker, file)), file);
        assert.ok(first.created.includes(file), `${file} reported as created`);
      });
      assert.deepEqual(unresolvedImports(worker), []);
      // The vendored worker is copied byte for byte.
      assert.equal(readFileSync(join(worker, 'src', 'aem-worker.mjs'), 'utf8'), readFileSync(join(EDGE_DIR, 'src', 'aem-worker.mjs'), 'utf8'));
      const toml = readFileSync(join(worker, 'wrangler.toml'), 'utf8');
      assert.match(toml, /ORIGIN_HOSTNAME = "main--site--acme.aem.live"/);
      assert.match(toml, /^route = "www\.acme\.com\/\*"$/m);
      assert.match(toml, /^# account_id = /m);
      assert.match(toml, /^name = "site"$/m);
      assert.match(toml, /^workers_dev = true$/m);
      assert.doesNotMatch(toml, /\{\{/);
      assert.doesNotMatch(toml, /^PZN_API_KEY\s*=/m, 'no secret in wrangler.toml');
      assert.ok(first.next.some((step) => /account_id/.test(step)));
      assert.ok(first.next.every((step) => !/^npx wrangler deploy/.test(step)), 'never deploys');
      assert.equal(JSON.parse(readFileSync(join(worker, 'package.json'), 'utf8')).name, 'site');
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'cdn/\n');

      // The site's edge-config.js is kept; a changed skill module is updated.
      writeFileSync(join(worker, 'src', 'personalization', 'edge-config.js'), '// site\n');
      writeFileSync(join(worker, 'src', 'personalization', 'outcomes.js'), '// stale\n');
      const second = installEdge(dir);
      assert.deepEqual(second.created, []);
      assert.deepEqual(second.updated, ['src/personalization/outcomes.js']);
      assert.ok(second.kept.includes('src/personalization/edge-config.js'));
      assert.ok(second.kept.includes('wrangler.toml'));
      assert.equal(readFileSync(join(worker, 'src', 'personalization', 'edge-config.js'), 'utf8'), '// site\n');
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'cdn/\n');

      const third = installEdge(dir);
      assert.deepEqual([third.created, third.updated], [[], []]);
    } finally {
      cleanup();
    }
  });

  it('leaves route and account_id commented out when not given', () => {
    const { dir, cleanup } = siteRepo();
    try {
      installEdge(dir);
      const toml = readFileSync(join(dir, 'cdn', 'cloudflare-worker', 'wrangler.toml'), 'utf8');
      assert.doesNotMatch(toml, /^(route|account_id) =/m);
      assert.match(toml, /^# route = /m);
      assert.match(toml, /^# account_id = /m);
      assert.match(toml, new RegExp(`^name = "${workerNameFor(dir)}"$`, 'm'));
      assert.match(workerNameFor(dir), /^[a-z0-9-]{1,63}$/);
    } finally {
      cleanup();
    }
  });

  it('adds only the personalization modules to an existing worker', () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, '.hlxignore'), 'tools/');
      const report = installEdge(dir, { existing: 'workers/site' });
      const worker = join(dir, 'workers', 'site');
      [...MODULES, 'src/personalization/edge-config.js'].forEach((file) => assert.ok(existsSync(join(worker, file)), file));
      assert.equal(existsSync(join(worker, 'src', 'index.mjs')), false);
      assert.equal(existsSync(join(worker, 'wrangler.toml')), false);
      assert.deepEqual(unresolvedImports(worker), []);
      assert.match(report.next[0], /handleApiRoute\(request, env, config, \{ fetchPlain: fetchFragment \}\)/);
      assert.match(report.next[0], /personalizeResponse\(request, response, \{[^}]*fetchFragment \}\)/);
      assert.ok(report.next[0].indexOf('const fetchFragment') < report.next[0].indexOf('handleApiRoute(request'), 'fetchFragment is defined before the route uses it');
      assert.equal(readFileSync(join(dir, '.hlxignore'), 'utf8'), 'tools/\nworkers/\n');
    } finally {
      cleanup();
    }
  });

  it('writes nothing on a dry run', () => {
    const { dir, cleanup } = siteRepo();
    try {
      const report = installEdge(dir, { dryRun: true });
      assert.ok(report.created.includes('src/personalization/personalize.js'));
      assert.equal(existsSync(join(dir, 'cdn')), false);
      assert.equal(existsSync(join(dir, '.hlxignore')), false);
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
