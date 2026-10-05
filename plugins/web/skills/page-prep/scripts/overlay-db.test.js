// Run: node --test scripts/overlay-db.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCmpRules, parseReport, buildHideExpression } = require('./overlay-db.js');

// Shapes taken from Consent-O-Matic Rules.json (methods: [{ name, action }]).
const rules = {
  withHide: {
    detectors: [{
      presentMatcher: { type: 'css', target: { selector: '#cmp-banner' } },
      showingMatcher: { type: 'css', target: { selector: 'body.cmp-open' } },
    }],
    methods: [
      { name: 'HIDE_CMP', action: { type: 'hide', target: { selector: '#cmp-root' } } },
      {
        name: 'OPEN_OPTIONS',
        action: { type: 'list', actions: [
          { type: 'click', target: { selector: '.cmp-more', textFilter: ['Options', 'Settings'] } },
          { type: 'wait', waitTime: 250 },
        ] },
      },
      {
        name: 'DO_CONSENT',
        action: { type: 'consent', consents: [{ type: 'A', trueAction: { type: 'click', target: { selector: '#on' } } }] },
      },
      {
        name: 'SAVE_CONSENT',
        action: { type: 'click', parent: { selector: '.cmp-footer' }, target: { selector: 'button:first-child' } },
      },
    ],
  },
  conditionalSave: {
    detectors: [{ presentMatcher: { type: 'css', target: { selector: '#klaro' } } }],
    methods: [
      { name: 'OPEN_OPTIONS', action: { type: 'click', target: { selector: '.klaro .cm-link' } } },
      {
        name: 'SAVE_CONSENT',
        action: { type: 'ifcss', target: { selector: '.cm-btn-accept' }, trueAction: { type: 'click', target: { selector: '.cm-btn-accept' } } },
      },
    ],
  },
  withoutHide: {
    detectors: [{
      presentMatcher: { type: 'css', target: { selector: 'body.has-cmp' } },
      showingMatcher: { type: 'css', target: { selector: '.cmp-dialog' } },
    }],
    methods: [{ name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '.cmp-save' } } }],
  },
};

const { cmps } = normalizeCmpRules(rules);

test('reads hide rules from the HIDE_CMP method', () => {
  assert.deepEqual(cmps.withHide.hide, ['#cmp-root { display:none!important }']);
});

test('dismiss opens options then saves, skipping per-purpose toggles', () => {
  assert.deepEqual(cmps.withHide.dismiss, [
    { action: 'click', selector: '.cmp-more:has-text("Options"), .cmp-more:has-text("Settings")' },
    { action: 'wait', ms: 250 },
    { action: 'click', selector: '.cmp-footer button:first-child' },
  ]);
});

test('without HIDE_CMP, hides present selectors but never <html>/<body>', () => {
  assert.deepEqual(cmps.withoutHide.hide, []);
  assert.deepEqual(cmps.withoutHide.dismiss, [{ action: 'click', selector: '.cmp-save' }]);
});

test('no dismiss when the save step is conditional-only', () => {
  assert.deepEqual(cmps.conditionalSave.dismiss, []);
});

const report = {
  overlays: [
    { id: 'overlay-0', hide: ["[data-widget='cookie-dialog'].toast { display:none!important }"] },
    { id: 'overlay-1', hide: ['.a\\:b::after { content: "x" }'] },
  ],
  scroll_locked: true,
  scroll_fix: 'html,body { overflow:auto!important }',
};

test('hide expression survives quotes and backslashes in selectors', () => {
  let injected;
  const doc = { head: { appendChild: (el) => { injected = el.textContent; return el; } }, createElement: () => ({}) };
  const result = new Function('document', `return (${buildHideExpression(report, ['all'])})`)(doc);
  assert.equal(result, 'ok');
  assert.equal(injected, [...report.overlays.flatMap((o) => o.hide), report.scroll_fix].join('\n'));
});

test('hide expression selects overlays by id; no ids keeps only scroll_fix', () => {
  let injected;
  const doc = { head: { appendChild: (el) => { injected = el.textContent; return el; } }, createElement: () => ({}) };
  new Function('document', `return (${buildHideExpression(report, ['overlay-1'])})`)(doc);
  assert.equal(injected, `${report.overlays[1].hide[0]}\n${report.scroll_fix}`);
  new Function('document', `return (${buildHideExpression(report, [])})`)(doc);
  assert.equal(injected, report.scroll_fix);
});

test('reads the report from saved playwright-cli eval output', () => {
  const saved = `### Result\n${JSON.stringify(JSON.stringify(report))}\n### Ran Playwright code\n`;
  assert.deepEqual(parseReport(saved), report);
});
