import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { artifactPath, generateSessionName, requireOpenSession, withSession } from './session.mjs';

const fake = (sessions = []) => {
  const calls = [];
  const rec =
    (n) =>
    (...a) =>
      calls.push([n, ...a]);
  return {
    calls,
    open: rec('open'),
    close: rec('close'),
    goto: rec('goto'),
    list: () => sessions,
  };
};

test('generateSessionName matches /^web-[0-9a-f]{4}$/ and differs across calls', () => {
  const names = new Set(Array.from({ length: 20 }, generateSessionName));
  for (const n of names) assert.match(n, /^web-[0-9a-f]{4}$/);
  assert.ok(names.size > 1);
});

test('withSession opens a missing named session when a url is given and keeps it', async () => {
  const d = fake();
  const got = await withSession(d, { session: 'mine', url: 'https://x.test' }, (n) => n);
  assert.equal(got, 'mine');
  assert.equal(d.calls.length, 1);
  assert.deepEqual(d.calls[0][0], 'open');
  assert.equal(d.calls[0][1].session, 'mine');
  assert.equal(d.calls[0][1].url, 'https://x.test');
});

test('withSession named session not open and no url is NO_SESSION', async () => {
  const d = fake();
  await assert.rejects(
    withSession(d, { session: 'mine' }, () => 1),
    { code: 'NO_SESSION' },
  );
  assert.equal(d.calls.length, 0);
});

test('withSession ephemeral opens, runs, closes even when fn throws', async () => {
  const d = fake();
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  await assert.rejects(
    withSession(d, {}, () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  assert.deepEqual(
    d.calls.map((c) => c[0]),
    ['open', 'close'],
  );
  assert.equal(d.calls[0][1].session, d.calls[1][1]);
});

test('withSession ephemeral returns fn result and removes signal listeners', async () => {
  const before = process.listenerCount('SIGINT');
  const d = fake();
  const out = await withSession(d, {}, () => {
    assert.equal(process.listenerCount('SIGINT'), before + 1);
    return 7;
  });
  assert.equal(out, 7);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('withSession with --session leaves browser open and does not generate a name', async () => {
  const d = fake([{ name: 'mine', status: 'open' }]);
  const out = await withSession(d, { session: 'mine', url: 'http://x' }, (s) => s);
  assert.equal(out, 'mine');
  assert.deepEqual(d.calls, [['goto', 'mine', 'http://x']]);
});

test('requireOpenSession throws NO_SESSION for missing and closed', () => {
  const d = fake([{ name: 'c', status: 'closed' }]);
  for (const name of [undefined, 'nope', 'c']) {
    assert.throws(
      () => requireOpenSession(d, name),
      (e) => e.code === 'NO_SESSION' && e.hint === 'run: web browser open <url> --session <name>',
    );
  }
});

test('artifactPath prefixes with session and command and is absolute', () => {
  const p = artifactPath('out', 's', 'screenshot', 'a.png');
  assert.equal(p, resolve('out/s-screenshot-a.png'));
  assert.ok(p.startsWith('/'));
});

async function signalRun(closeThrows) {
  const d = fake();
  if (closeThrows)
    d.close = (...a) => (
      d.calls.push(['close', ...a]),
      (() => {
        throw new Error('x');
      })()
    );
  const kills = [];
  const realKill = process.kill;
  process.kill = (...a) => kills.push(a);
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  try {
    await withSession(d, {}, () => process.emit('SIGINT'));
  } catch {
    // close may throw from the finally block
  } finally {
    process.kill = realKill;
  }
  const after = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  return { d, kills, before, after };
}

test('signal path closes the session, re-kills, and removes listeners', async () => {
  const { d, kills, before, after } = await signalRun(false);
  assert.equal(d.calls[1][0], 'close');
  assert.equal(d.calls[1][1], d.calls[0][1].session);
  assert.deepEqual(kills, [[process.pid, 'SIGINT']]);
  assert.deepEqual(after, before);
});

test('signal path with throwing driver.close still re-kills and removes listeners', async () => {
  const { kills, before, after } = await signalRun(true);
  assert.deepEqual(kills, [[process.pid, 'SIGINT']]);
  assert.deepEqual(after, before);
});

const closeFails = () => ({
  open() {},
  goto() {},
  list: () => [],
  close() {
    throw new Error('close boom');
  },
});

test('withSession keeps the original error when close also fails', async (t) => {
  const write = t.mock.method(process.stderr, 'write', () => true);
  await assert.rejects(
    withSession(closeFails(), {}, () => {
      throw new Error('real');
    }),
    /real/,
  );
  assert.match(
    write.mock.calls[0].arguments[0],
    /warning: failed to close session web-.*close boom/,
  );
});

test('withSession throws the close error when fn succeeded', async () => {
  await assert.rejects(
    withSession(closeFails(), {}, () => 1),
    /close boom/,
  );
});

test('withSession closes the generated session when open throws after launching', async () => {
  const d = fake();
  d.open = () => {
    throw new Error('launch half-failed');
  };
  await assert.rejects(
    withSession(d, {}, () => 1),
    /half-failed/,
  );
  assert.equal(d.calls.length, 1);
  assert.match(d.calls[0][1], /^web-[0-9a-f]{4}$/);
});

test('withSession does not close when open throws SESSION_EXISTS', async () => {
  const d = fake();
  d.open = () => {
    throw Object.assign(new Error('exists'), { code: 'SESSION_EXISTS' });
  };
  await assert.rejects(
    withSession(d, {}, () => 1),
    /exists/,
  );
  assert.deepEqual(d.calls, []);
});

test('withSession passes explicit launch options, which win over the recipe', async () => {
  const d = fake();
  await withSession(d, { config: { a: 1 }, persistent: true, initScripts: ['/x.js'] }, () => 1);
  const { config, persistent, initScripts } = d.calls[0][1];
  assert.deepEqual(
    { config, persistent, initScripts },
    {
      config: { a: 1 },
      persistent: true,
      initScripts: ['/x.js'],
    },
  );
});

test('withSession warns when an explicit recipe meets an already open session', async () => {
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => (written.push(String(chunk)), true);
  try {
    const open = [{ name: 'mine', status: 'open' }];
    await withSession(fake(open), { session: 'mine', recipePath: 'r.json' }, () => 1);
    assert.deepEqual(written, []);
    await withSession(
      fake(open),
      { session: 'mine', recipePath: 'r.json', recipeExplicit: true },
      () => 1,
    );
  } finally {
    process.stderr.write = original;
  }
  assert.match(written.join(''), /--recipe ignored, session mine is already open/);
});
