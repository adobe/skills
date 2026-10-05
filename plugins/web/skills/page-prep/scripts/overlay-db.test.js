// Run: node --test scripts/overlay-db.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCmpRules } = require('./overlay-db.js');

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
