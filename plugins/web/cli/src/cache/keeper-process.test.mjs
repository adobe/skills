import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startKeeperProcess, stopKeeper } from '#src/cache/keeper-process.mjs';

const BIN = fileURLToPath(new URL('../../bin/web.mjs', import.meta.url));
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'keeper-process-'));
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid) => {
  for (let i = 0; i < 50 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !isAlive(pid);
};

async function start(t, overrides = {}) {
  const root = await tmp();
  const opts = {
    cacheDir: path.join(root, 'cache'),
    session: 'kp-test',
    outputDir: path.join(root, 'out'),
    argv1: BIN,
    ...overrides,
  };
  const keeper = await startKeeperProcess(opts);
  t.after(() => stopKeeper(opts));
  return { opts, keeper, stateFile: path.join(opts.outputDir, 'kp-test-cache-keeper.json') };
}

test('start then stop returns stats and removes state', async (t) => {
  const { opts, keeper, stateFile } = await start(t);
  assert.equal(keeper.dir, path.resolve(opts.cacheDir));
  assert.equal(keeper.entries, 0);
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')), {
    pid: keeper.pid,
    port: keeper.port,
    dir: keeper.dir,
  });
  const status = await (await fetch(`http://127.0.0.1:${keeper.port}/__status`)).json();
  assert.equal(status.entries, 0);
  const stats = await stopKeeper(opts);
  assert.deepEqual(stats, { hits: 0, misses: 0, stored: 0, errors: 0 });
  assert.equal(existsSync(stateFile), false);
  assert.equal(await waitDead(keeper.pid), true);
});

test('stop without state returns null', async () => {
  const root = await tmp();
  assert.equal(await stopKeeper({ session: 'none', outputDir: root }), null);
});

test('stop with dead keeper returns null and removes state', async (t) => {
  const { opts, keeper, stateFile } = await start(t);
  process.kill(keeper.pid);
  await waitDead(keeper.pid);
  assert.equal(await stopKeeper(opts), null);
  assert.equal(existsSync(stateFile), false);
});

test('start replaces a stale keeper of the same session', async (t) => {
  const { opts, keeper } = await start(t);
  const second = await startKeeperProcess(opts);
  assert.notEqual(second.pid, keeper.pid);
  assert.equal(await waitDead(keeper.pid), true);
});

test('start failure is INTERNAL and points at the log', async () => {
  const root = await tmp();
  const script = path.join(root, 'broken.mjs');
  writeFileSync(script, 'process.stderr.write("boom\\n"); process.exit(1);');
  const outputDir = path.join(root, 'out');
  await assert.rejects(
    startKeeperProcess({ cacheDir: root, session: 's', outputDir, argv1: script }),
    (err) => {
      assert.equal(err.code, 'INTERNAL');
      assert.match(err.hint, /s-cache-keeper\.log/);
      return true;
    },
  );
  assert.match(readFileSync(path.join(outputDir, 's-cache-keeper.log'), 'utf8'), /boom/);
});

test('corrupt HAR in the cache is a USAGE error', async () => {
  const root = await tmp();
  writeFileSync(path.join(root, 'bad.har'), '{not json');
  await assert.rejects(
    startKeeperProcess({
      cacheDir: root,
      session: 's',
      outputDir: path.join(root, 'out'),
      argv1: BIN,
    }),
    (err) => {
      assert.equal(err.code, 'USAGE');
      assert.match(err.message, /bad\.har/);
      return true;
    },
  );
});

test('cache keeper is hidden from help', () => {
  const { stdout } = spawnSync(process.execPath, [BIN, 'cache', '--help'], { encoding: 'utf8' });
  assert.match(stdout, /record/);
  assert.doesNotMatch(stdout, /keeper/);
});
