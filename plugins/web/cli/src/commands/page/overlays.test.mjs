import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';
import { RESIDUAL_EXPRESSION } from '#src/commands/page/overlays.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});
const OK = {
  title: 'T',
  url: 'http://x/final',
  bodyLength: 5000,
  status: 200,
  hasMainContent: true,
};
const REPORT = {
  overlays: [
    {
      id: 'overlay-0',
      type: 'cmp-match',
      cmp: 'acme',
      selector: '#acme',
      hide: ['#acme-hide { display:none!important }'],
      dismiss: [
        { action: 'click', selector: '#acme-save' },
        { action: 'wait', ms: 250 },
      ],
    },
    {
      id: 'overlay-1',
      type: 'heuristic',
      selector: '.modal',
      hide: ['.modal-hide { display:none!important }'],
      dismiss: null,
    },
  ],
  scroll_locked: true,
  scroll_fix: 'html { overflow:auto!important }',
};

async function run(
  extra,
  {
    runFails = false,
    dismissResult = { clicked: 1, skipped: 0 },
    visible = false,
    report,
    recipeStyle = false,
    sessions = [],
  } = {},
) {
  const calls = [];
  const fetchUrls = [];
  const opened = [];
  const driver = {
    ensureAvailable: () => {},
    open: (a) => opened.push(a),
    close: () => {},
    list: () => sessions,
    goto: () => {},
    inject: () => {},
    pageHealth: () => OK,
    run: (s, o) => {
      calls.push(['run', o.code]);
      if (runFails && !o.code.includes('page.evaluate(') && !o.code.includes('var covers'))
        throw new Error('boom');
      if (o.code.includes('var covers')) return '[]';
      return o.code.includes('page.evaluate(') ? JSON.stringify(report ?? REPORT) : dismissResult;
    },
    evaluate: (s, expr) => {
      calls.push(['evaluate', expr]);
      if (expr.includes('data-web-recipe')) return recipeStyle;
      if (expr.includes('appendChild')) return 'ok';
      return expr.includes('overflow') ? true : !visible;
    },
  };
  const fetch = async (url) => {
    fetchUrls.push(url);
    return url.endsWith('.json')
      ? { ok: true, json: async () => ({}) }
      : { ok: true, text: async () => '##.x\n' };
  };
  const stdout = sink();
  const stderr = sink();
  const cacheDir = mkdtempSync(join(tmpdir(), 'ov-'));
  const deps = { stdout, stderr, env: {}, driverFactory: () => driver, fetch, cacheDir };
  const out = mkdtempSync(join(tmpdir(), 'ovo-'));
  const code = await runCli(['node', 'web', 'page', 'overlays', ...extra, '--output', out], deps);
  return { code, calls, opened, fetchUrls, doc: stdout.buf ? JSON.parse(stdout.buf) : null };
}

const hides = (calls) => calls.filter((c) => c[0] === 'evaluate' && c[1].includes('appendChild'));

test('report shape has overlays[] and scrollLocked', async () => {
  const { code, doc, calls } = await run(['http://x']);
  assert.equal(code, 0);
  assert.equal(doc.overlays.length, 2);
  assert.equal(doc.scrollLocked, true);
  assert.equal(doc.scrollFix, REPORT.scroll_fix);
  assert.equal(doc.applied, undefined);
  assert.equal(hides(calls).length, 0);
});

test('quick mode issues one hide expression with all hide CSS', async () => {
  const { doc, calls } = await run(['http://x', '--dismiss', '--mode', 'quick']);
  const h = hides(calls);
  assert.equal(h.length, 1);
  assert.match(h[0][1], /#acme-hide/);
  assert.match(h[0][1], /\.modal-hide/);
  assert.deepEqual(doc.applied, [
    { id: 'overlay-0', strategy: 'hide', ok: true },
    { id: 'overlay-1', strategy: 'hide', ok: true },
  ]);
  assert.deepEqual(doc.residual, []);
});

test('thorough runs dismiss steps for cmp-match and hides the heuristic one', async () => {
  const { doc, calls } = await run(['http://x', '--dismiss', '--mode', 'thorough']);
  const steps = calls.filter((c) => c[0] === 'run' && c[1].includes('#acme-save'));
  assert.equal(steps.length, 1);
  assert.match(steps[0][1], /waitForTimeout\(250\)/);
  const h = hides(calls);
  assert.equal(h.length, 1);
  assert.match(h[0][1], /\.modal-hide/);
  assert.doesNotMatch(h[0][1], /#acme-hide/);
  assert.match(h[0][1], /overflow:auto/);
  assert.deepEqual(doc.applied, [
    { id: 'overlay-0', strategy: 'dismiss', ok: true },
    { id: 'overlay-1', strategy: 'hide', ok: true },
  ]);
});

test('thorough marks a failed dismiss run ok:false', async () => {
  const { code, doc } = await run(['http://x', '--dismiss', '--mode', 'thorough'], {
    runFails: true,
  });
  assert.equal(code, 0);
  assert.equal(doc.applied[0].ok, false);
});

test('--dismiss without --mode defaults to thorough', async () => {
  const { doc, calls } = await run(['http://x', '--dismiss']);
  const steps = calls.filter((c) => c[0] === 'run' && c[1].includes('#acme-save'));
  assert.equal(steps.length, 1);
  assert.equal(doc.applied[0].strategy, 'dismiss');
});

test('invalid --mode exits 2 without driver calls', async () => {
  const { code, calls } = await run(['http://x', '--dismiss', '--mode', 'bogus']);
  assert.equal(code, 2);
  assert.deepEqual(calls, []);
});

test('--refresh-db triggers fetch; default fetches on empty cache too', async () => {
  const { fetchUrls } = await run(['http://x', '--refresh-db']);
  assert.equal(fetchUrls.length, 2);
});

test('dismiss code counts matches and does not swallow click errors', async () => {
  const { calls } = await run(['http://x', '--dismiss']);
  const code = calls.find((c) => c[1].includes('#acme-save'))[1];
  assert.match(code, /count\(\)/);
  assert.doesNotMatch(code, /\.catch\(/);
});

test('zero clicked → dismiss ok:false and the overlay is hidden as fallback', async () => {
  const { doc, calls } = await run(['http://x', '--dismiss'], {
    dismissResult: { clicked: 0, skipped: 2 },
  });
  assert.deepEqual(doc.applied[0], {
    id: 'overlay-0',
    strategy: 'dismiss',
    ok: false,
    error: 'no dismiss selector matched',
  });
  const h = hides(calls);
  assert.match(h[0][1], /#acme-hide/);
  assert.match(h[0][1], /\.modal-hide/);
});

test('a throwing dismiss run reports ok:false with the error and hides the overlay', async () => {
  const { doc, calls } = await run(['http://x', '--dismiss'], { runFails: true });
  assert.equal(doc.applied[0].ok, false);
  assert.equal(doc.applied[0].error, 'boom');
  assert.match(hides(calls)[0][1], /#acme-hide/);
});

test('one click → dismiss ok:true', async () => {
  const { doc } = await run(['http://x', '--dismiss']);
  assert.deepEqual(doc.applied[0], { id: 'overlay-0', strategy: 'dismiss', ok: true });
});

test('overlay with empty hide gets a synthesized selector rule', async () => {
  const report = {
    ...REPORT,
    overlays: [{ id: 'o', type: 'cmp-match', selector: '#empty', hide: [], dismiss: null }],
  };
  const { doc, calls } = await run(['http://x', '--dismiss'], { report });
  assert.match(hides(calls)[0][1], /#empty \{ display:none!important \}/);
  assert.equal(doc.applied[0].ok, true);
});

test('hide that leaves the element visible reports ok:false', async () => {
  const { doc } = await run(['http://x', '--dismiss', '--mode', 'quick'], { visible: true });
  assert.equal(doc.applied[0].ok, false);
  assert.equal(doc.applied[0].error, 'still visible after hide');
});

test('scroll lock re-check is reported as scrollUnlocked', async () => {
  const { doc } = await run(['http://x', '--dismiss']);
  assert.equal(doc.scrollUnlocked, true);
});

function residualFor(elements, vw = 1440, vh = 900) {
  const globals = {
    document: { querySelectorAll: () => elements },
    getComputedStyle: (e) => e.style,
    window: { innerWidth: vw, innerHeight: vh },
  };
  const names = Object.keys(globals);
  const fn = new Function(...names, `return ${RESIDUAL_EXPRESSION};`);
  return JSON.parse(fn(...names.map((n) => globals[n])));
}

const fixedEl = (over = {}) => ({
  tagName: 'DIV',
  id: '',
  offsetWidth: 1440,
  offsetHeight: 900,
  getAttribute: (n) => over.attrs?.[n] ?? null,
  getBoundingClientRect: () => over.rect ?? { left: 0, top: 0, right: 1440, bottom: 900 },
  style: {
    position: 'fixed',
    zIndex: '100',
    display: 'block',
    visibility: 'visible',
    ...over.style,
  },
  ...over.props,
});

test('residual reports a low-z full-viewport element and skips hidden or offscreen ones', () => {
  const offscreen = { left: 1440, top: 0, right: 2880, bottom: 900 };
  const out = residualFor([
    fixedEl(),
    fixedEl({ style: { display: 'none' } }),
    fixedEl({ rect: offscreen }),
  ]);
  assert.equal(out.length, 1);
});

test('residual does not crash on a fixed SVG whose className is not a string', () => {
  const svg = fixedEl({ props: { tagName: 'svg', className: { baseVal: 'bg' } } });
  assert.equal(residualFor([svg]).length, 1);
});

test('residual tags header elements with a landmark role', () => {
  const [hit] = residualFor([fixedEl({ props: { tagName: 'HEADER' }, style: { zIndex: '9999' } })]);
  assert.equal(hit.role, 'landmark');
});

const recipeIn = () => join(mkdtempSync(join(tmpdir(), 'ovr-')), 'recipe.json');

test('--save-recipe stores every detected hide rule and the scroll fix as overlays', async () => {
  const file = recipeIn();
  const { doc } = await run(['http://x', '--save-recipe', '--recipe', file]);
  assert.equal(doc.recipe, file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    overlays: [
      {
        rules: [
          '#acme-hide { display:none!important }',
          '.modal-hide { display:none!important }',
          'html { overflow:auto!important }',
        ],
      },
    ],
  });
});

test('--save-recipe replaces the overlays entries and keeps other recipe types', async () => {
  const file = recipeIn();
  writeFileSync(
    file,
    JSON.stringify({ probe: [{ stealth: true }], overlays: [{ rules: ['old'] }] }),
  );
  await run(['http://x', '--save-recipe', '--recipe', file], { report: { overlays: [] } });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    probe: [{ stealth: true }],
    overlays: [{ rules: [] }],
  });
});

test('--save-recipe records with the probe entries but without the overlay rules', async () => {
  const file = recipeIn();
  const config = { browserName: 'chromium', launchOptions: { channel: 'chrome' } };
  const probe = [{ config, persistent: true, stealth: true }];
  writeFileSync(file, JSON.stringify({ probe, overlays: [{ rules: ['old'] }] }));
  const saving = await run(['http://x', '--save-recipe', '--recipe', file]);
  assert.deepEqual(saving.opened[0].config, config);
  assert.equal(saving.opened[0].persistent, true);
  assert.equal(saving.opened[0].initSources.length, 1);
  const replaying = await run(['http://x', '--recipe', file]);
  assert.equal(replaying.opened[0].initSources.length, 2);
});

test('--save-recipe in a session launched with overlay rules fails and keeps the recipe', async () => {
  const file = recipeIn();
  const before = JSON.stringify({ overlays: [{ rules: ['kept'] }] });
  writeFileSync(file, before);
  const sessions = [{ name: 's', status: 'open' }];
  const { code, doc } = await run(['--session', 's', '--save-recipe', '--recipe', file], {
    sessions,
    recipeStyle: true,
    report: { overlays: [] },
  });
  assert.equal(code, 2);
  assert.equal(doc.error.code, 'USAGE');
  assert.match(doc.error.message, /already hidden/);
  assert.equal(readFileSync(file, 'utf8'), before);
  const clean = await run(['--session', 's', '--save-recipe', '--recipe', file], { sessions });
  assert.equal(clean.code, 0);
});
