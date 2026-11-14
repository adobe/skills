import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./overlay-detect.js', import.meta.url), 'utf8');
const mod = { exports: {} };
new Function('module', source)(mod);
const { heuristicScan, buildSelector } = mod.exports;

const el = (over = {}) => ({
  id: '',
  className: '',
  tagName: 'DIV',
  parentElement: null,
  ownerDocument: { querySelectorAll: () => [1] },
  getAttribute: (n) => over.attrs?.[n] ?? null,
  getBoundingClientRect: () => over.rect ?? { width: 1440, height: 900 },
  matches: () => false,
  style: { position: 'fixed', zIndex: '100', display: 'block', visibility: 'visible', ...over.style },
  ...over.props,
});

const scan = (elements) => {
  globalThis.getComputedStyle = (e) => e.style;
  const doc = {
    documentElement: { clientWidth: 1440, clientHeight: 900 },
    querySelectorAll: () => elements,
  };
  try { return heuristicScan(doc, [], [], false); } finally { delete globalThis.getComputedStyle; }
};

test('full-viewport fixed div at z-index 100 without keywords is detected', () => {
  const [hit] = scan([el({ props: { className: 'fixed inset-0' } })]);
  assert.ok(hit.signals.includes('full-cover'));
});

test('full-viewport fixed div at z-index auto is not detected', () => {
  assert.deepEqual(scan([el({ style: { zIndex: 'auto' } })]), []);
});

test('small fixed bar without other signals is not detected', () => {
  assert.deepEqual(scan([el({ rect: { width: 1440, height: 60 } })]), []);
});

test('hidden aria-modal element is skipped', () => {
  const attrs = { 'aria-modal': 'true' };
  const props = { id: 'modal-refund-policy' };
  assert.deepEqual(scan([el({ attrs, props, style: { display: 'none' } })]), []);
  assert.deepEqual(scan([el({ attrs, props, rect: { width: 0, height: 0 } })]), []);
  assert.equal(scan([el({ attrs, props })]).length, 1);
});

test('fixed element translated fully offscreen is not detected', () => {
  const rect = { left: 1440, top: 0, width: 1440, height: 900 };
  assert.deepEqual(scan([el({ rect })]), []);
});

test('fixed element only 5% inside the viewport is not detected', () => {
  const rect = { left: 1368, top: 0, width: 1440, height: 900 };
  assert.deepEqual(scan([el({ rect })]), []);
});

test('ambiguous tag.class selector falls back to a unique nth-of-type path', () => {
  const root = { id: 'root', tagName: 'DIV', className: '', parentElement: null, children: [] };
  const make = () => ({
    id: '',
    className: 'card',
    tagName: 'DIV',
    parentElement: root,
    ownerDocument: { querySelectorAll: (sel) => (sel === 'div.card' ? [1, 2] : [1]) },
  });
  const [a, b] = [make(), make()];
  root.children.push(a, b);
  assert.equal(buildSelector(a), '#root > div:nth-of-type(1)');
  assert.equal(buildSelector(b), '#root > div:nth-of-type(2)');
});
