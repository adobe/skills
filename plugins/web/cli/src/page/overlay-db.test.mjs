import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeCmpRules,
  buildHideExpression,
  loadPatterns,
  BUILTIN_SELECTORS,
} from '#src/page/overlay-db.mjs';

// Shapes taken from Consent-O-Matic Rules.json (methods: [{ name, action }]).
const rules = {
  withHide: {
    detectors: [
      {
        presentMatcher: { type: 'css', target: { selector: '#cmp-banner' } },
        showingMatcher: { type: 'css', target: { selector: 'body.cmp-open' } },
      },
    ],
    methods: [
      { name: 'HIDE_CMP', action: { type: 'hide', target: { selector: '#cmp-root' } } },
      {
        name: 'OPEN_OPTIONS',
        action: {
          type: 'list',
          actions: [
            {
              type: 'click',
              target: { selector: '.cmp-more', textFilter: ['Options', 'Settings'] },
            },
            { type: 'wait', waitTime: 250 },
          ],
        },
      },
      {
        name: 'DO_CONSENT',
        action: {
          type: 'consent',
          consents: [{ type: 'A', trueAction: { type: 'click', target: { selector: '#on' } } }],
        },
      },
      {
        name: 'SAVE_CONSENT',
        action: {
          type: 'click',
          parent: { selector: '.cmp-footer' },
          target: { selector: 'button:first-child' },
        },
      },
    ],
  },
  conditionalSave: {
    detectors: [{ presentMatcher: { type: 'css', target: { selector: '#klaro' } } }],
    methods: [
      { name: 'OPEN_OPTIONS', action: { type: 'click', target: { selector: '.klaro .cm-link' } } },
      {
        name: 'SAVE_CONSENT',
        action: {
          type: 'ifcss',
          target: { selector: '.cm-btn-accept' },
          trueAction: { type: 'click', target: { selector: '.cm-btn-accept' } },
        },
      },
    ],
  },
  withoutHide: {
    detectors: [
      {
        presentMatcher: { type: 'css', target: { selector: 'body.has-cmp' } },
        showingMatcher: { type: 'css', target: { selector: '.cmp-dialog' } },
      },
    ],
    methods: [
      { name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '.cmp-save' } } },
    ],
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
  const doc = {
    head: {
      appendChild: (el) => {
        injected = el.textContent;
        return el;
      },
    },
    createElement: () => ({}),
  };
  const result = new Function('document', `return (${buildHideExpression(report, ['all'])})`)(doc);
  assert.equal(result, 'ok');
  assert.equal(injected, [...report.overlays.flatMap((o) => o.hide), report.scroll_fix].join('\n'));
});

test('hide expression selects overlays by id; no ids keeps only scroll_fix', () => {
  let injected;
  const doc = {
    head: {
      appendChild: (el) => {
        injected = el.textContent;
        return el;
      },
    },
    createElement: () => ({}),
  };
  new Function('document', `return (${buildHideExpression(report, ['overlay-1'])})`)(doc);
  assert.equal(injected, `${report.overlays[1].hide[0]}\n${report.scroll_fix}`);
  new Function('document', `return (${buildHideExpression(report, [])})`)(doc);
  assert.equal(injected, report.scroll_fix);
});

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});
const RULES = { x: rules.withHide };

function fakeFetch(failing = false) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    if (failing) throw new Error('offline');
    return url.endsWith('.json')
      ? { ok: true, json: async () => RULES }
      : { ok: true, text: async () => '##.cookie-bar\n! c\n' };
  };
  return { fetch, urls };
}

function cacheWith(fetchedAt) {
  const dir = mkdtempSync(join(tmpdir(), 'odb-'));
  const patterns = { cmps: { old: {} }, generic_selectors: ['.old'], stats: {} };
  writeFileSync(join(dir, 'patterns.json'), JSON.stringify(patterns));
  writeFileSync(join(dir, 'last-fetch'), fetchedAt);
  return dir;
}

test('loadPatterns refetches a stale cache and rewrites it', async () => {
  const dir = cacheWith(new Date(Date.now() - 8 * 86400000).toISOString());
  const { fetch, urls } = fakeFetch();
  const p = await loadPatterns({ fetch, cacheDir: dir });
  assert.equal(urls.length, 2);
  assert.deepEqual(Object.keys(p.cmps), ['x']);
  assert.deepEqual(p.generic_selectors, ['.cookie-bar', ...BUILTIN_SELECTORS]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'patterns.json'), 'utf8')).cmps, p.cmps);
});

test('loadPatterns uses a fresh cache without fetching', async () => {
  const dir = cacheWith(new Date().toISOString());
  const { fetch, urls } = fakeFetch();
  const p = await loadPatterns({ fetch, cacheDir: dir });
  assert.equal(urls.length, 0);
  assert.deepEqual(Object.keys(p.cmps), ['old']);
});

test('loadPatterns merges built-in selectors into a fresh cache that lacks them', async () => {
  const dir = cacheWith(new Date().toISOString());
  const p = await loadPatterns({ fetch: fakeFetch().fetch, cacheDir: dir });
  for (const sel of BUILTIN_SELECTORS) assert.ok(p.generic_selectors.includes(sel), sel);
  assert.equal(new Set(p.generic_selectors).size, p.generic_selectors.length);
});

test('loadPatterns refresh includes built-in selectors once', async () => {
  const dir = cacheWith(new Date().toISOString());
  const p = await loadPatterns({ fetch: fakeFetch().fetch, cacheDir: dir, refresh: true });
  for (const sel of BUILTIN_SELECTORS) {
    assert.equal(p.generic_selectors.filter((s) => s === sel).length, 1);
  }
});

test('loadPatterns refresh forces a fetch on a fresh cache', async () => {
  const dir = cacheWith(new Date().toISOString());
  const { fetch, urls } = fakeFetch();
  await loadPatterns({ fetch, cacheDir: dir, refresh: true });
  assert.equal(urls.length, 2);
});

test('loadPatterns falls back to the cache with a warning when fetch fails', async () => {
  const dir = cacheWith('2000-01-01T00:00:00Z');
  const stderr = sink();
  const p = await loadPatterns({ fetch: fakeFetch(true).fetch, cacheDir: dir, stderr });
  assert.deepEqual(Object.keys(p.cmps), ['old']);
  assert.match(stderr.buf, /Using cached pattern database/);
});

test('loadPatterns without a cache and failing fetch throws FAILURE with hint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odb-'));
  await assert.rejects(
    loadPatterns({ fetch: fakeFetch(true).fetch, cacheDir: dir, stderr: sink() }),
    (e) =>
      e.code === 'FAILURE' &&
      /cannot fetch overlay pattern database/.test(e.message) &&
      /--refresh-db/.test(e.hint),
  );
});
