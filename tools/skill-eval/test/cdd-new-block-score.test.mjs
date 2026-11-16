import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { score } from '../scripts/score-cdd-new-block.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '../../../plugins/aem/edge-delivery-services/evals/content-driven-development-new-block-ew/fixtures/project');
const calibration = join(here, '../calibration/cdd-new-block-ew');

function run(name) {
  const dir = mkdtempSync(join(tmpdir(), 'cdd-cal-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('tag', 'eval-base');
    cpSync(join(calibration, name), dir, { recursive: true });
    return score(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the good solution scores near the maximum', () => {
  const r = run('good');
  assert.ok(r.total >= r.max - 2, JSON.stringify(r.checks.filter((c) => c.got < c.max)));
});

test('the subtly broken solution scores well below the good one', () => {
  assert.ok(run('broken').total <= run('good').total - 40);
});

test('the gold-plated solution loses points for scope, silent framework and missing mention', () => {
  const good = run('good');
  const gold = run('gold');
  assert.ok(gold.total <= good.total - 10, `${gold.total} vs ${good.total}`);
});
