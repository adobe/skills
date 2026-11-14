import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePage } from '#src/page/prepare.mjs';

test('preparePage scrolls then unpins when asked', () => {
  const calls = [];
  const driver = {
    run: (_s, a) => calls.push(['run', a.code]),
    evaluate: (_s, e) => calls.push(['evaluate', e]),
  };
  preparePage(driver, 's', { unpin: true, settleMs: 5 });
  assert.equal(calls.length, 2);
  assert.match(calls[0][1], /scrollTo.*waitForTimeout\(5\).*scrollTo/s);
  assert.match(calls[1][1], /position/);
});

test('preparePage skips unpin by default', () => {
  const calls = [];
  preparePage({ run: () => calls.push('run'), evaluate: () => calls.push('eval') }, 's');
  assert.deepEqual(calls, ['run']);
});
