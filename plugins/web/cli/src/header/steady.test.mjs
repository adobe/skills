import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { AB_TESTS, STEADY } from './steady.mjs';

const re = new Function(`return ${AB_TESTS}`)();

test('AB_TESTS: A/B and personalisation services are blocked', () => {
  for (const u of [
    'https://api.intellimize.co/prediction/117761985',
    'https://cdn.optimizely.com/js/1.js',
    'https://dev.visualwebsiteoptimizer.com/j.php',
    'https://adobe.tt.omtrdc.net/rest/v1/delivery',
    'https://try.abtasty.com/x.js',
    'https://abc.kameleoon.eu/engine.js',
  ])
    assert.ok(re.test(u), u);
});

test('AB_TESTS: the page and its own assets are not', () => {
  for (const u of [
    'https://webflow.com/resources/marketing-head-v2.js',
    'https://www.optimizely.com.example.org/',
    'https://www.example.com/fr-ch',
    'https://example.com/intellimize.co.js',
  ])
    assert.ok(!re.test(u), u);
});

function page() {
  const listeners = {};
  const fired = [];
  let now = 0;
  class HTMLDialogElement {
    showModal() {
      fired.push('modal');
    }

    close() {
      fired.push('close');
    }
  }
  const window = {
    setInterval: (fn, delay) => {
      fired.push(`interval ${delay}`);
      return 1;
    },
  };
  Object.assign(window, {
    window,
    HTMLDialogElement,
    performance: { now: () => now },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  });
  vm.createContext(window);
  vm.runInContext(`(${STEADY})()`, window);
  return {
    window,
    fired,
    input: (type, key) => listeners[type]({ type, key }),
    at: (t) => {
      now = t;
    },
  };
}

test('STEADY stops intervals of 2 s or more and keeps shorter ones', () => {
  const p = page();
  assert.equal(
    p.window.setInterval(() => {}, 3000),
    0,
  );
  p.window.setInterval(() => {}, 500);
  assert.deepEqual(p.fired, ['interval 500']);
});

test('STEADY closes a modal dialog at once unless a click, Enter or Space came within a second', () => {
  const p = page();
  const d = new p.window.HTMLDialogElement();
  p.at(5000);
  d.showModal();
  assert.deepEqual(p.fired, ['modal', 'close']);
  p.input('pointerdown');
  p.at(5400);
  d.showModal();
  p.at(7000);
  d.showModal();
  p.input('keydown', 'Escape');
  d.showModal();
  p.input('keydown', 'Enter');
  d.showModal();
  assert.deepEqual(p.fired, [
    'modal',
    'close',
    'modal',
    'modal',
    'close',
    'modal',
    'close',
    'modal',
  ]);
});
