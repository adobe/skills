#!/usr/bin/env node
/**
 * ai-readability.mjs `checkExclusions()` (T33.2): an `--exclude-blocks` entry that removed words must
 * carry a decision — an allowlist entry `{ block, exclude: true, reason, fallback: authored |
 * owner-accepted, decision }`. Without one the page FAILs (exit 1); the record is the escape hatch.
 * Pure: the regional-bank-shaped gate JSON (one page with an excluded block of 263 words, one with 0) is the
 * fixture; the module's CLI runs behind an isMain guard. analyse() and checkExclusions() share ONE
 * completeness test (decidedExclusions) — asserted on the helper, and executed for real in the browser
 * when playwright resolves (cwd package.json, then the global npm root); otherwise that case SKIPs.
 * Run: node --test skills/deploy/scripts/test/ai-readability-decisions.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyse, checkExclusions, decidedExclusions, exclusionWhy } from '../ai-readability.mjs';

const page = (words, name = 'calculator') => ({
  path: `/tools/${name}`,
  strict: { score: 100, served: 400, rendered: 400, missing: 0 },
  code: { score: 100, served: 400, rendered: 400 - words, excludedWords: words },
  blocks: [
    { block: 'default-content', words: 380, servedGap: 0, excluded: false },
    { block: name, words, servedGap: words, excluded: true, undecided: words > 0 },
    { block: 'footer', words: 60, servedGap: 60, excluded: false },
  ],
});

test('a word-removing exclusion with no allowlist entry is undecided (the regional-bank shape: 263 words)', () => {
  const r = checkExclusions(page(263), []);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].block, r[0].words, r[0].decided, r[0].why], ['calculator', 263, false, 'no allowlist entry']);
});

test('an excluded block that removed 0 words is not a decision (regional-bank final JSON: excludedWords 0 on every page)', () => {
  assert.deepEqual(checkExclusions(page(0), []), []);
});

test('a complete entry decides it; fallback and decision are carried into the report row', () => {
  const allow = [{ block: 'calculator', exclude: true, reason: 'third-party loan calculator', fallback: 'authored', decision: 'dyn#6' }];
  const r = checkExclusions(page(263), allow);
  assert.deepEqual([r[0].decided, r[0].fallback, r[0].decision, r[0].why], [true, 'authored', 'dyn#6', null]);
  const accepted = checkExclusions(page(263), [{ ...allow[0], fallback: 'owner-accepted' }]);
  assert.equal(accepted[0].decided, true);
});

test('an incomplete entry stays undecided and names the missing field', () => {
  const base = { block: 'calculator', exclude: true, reason: 'r', fallback: 'authored', decision: 'dyn#6' };
  assert.match(checkExclusions(page(10), [{ ...base, reason: undefined }])[0].why, /reason/);
  assert.match(checkExclusions(page(10), [{ ...base, fallback: 'maybe' }])[0].why, /fallback/);
  assert.match(checkExclusions(page(10), [{ ...base, decision: '' }])[0].why, /decision/);
});

test('string entries (block + string) never decide an exclusion; entries name a block, never a page', () => {
  const r = checkExclusions(page(40), [{ block: 'calculator', string: 'Monthly payment', reason: 'runtime value' }]);
  assert.equal(r[0].decided, false);
  const other = checkExclusions(page(40), [{ block: 'widget', exclude: true, reason: 'r', fallback: 'authored', decision: 'd' }]);
  assert.equal(other[0].decided, false, 'a decision for another block does not carry over');
});

test('decidedExclusions() is the one completeness test — the scorer and the checker agree on a bare `exclude: true`', () => {
  const bare = [{ block: 'calculator', exclude: true }];
  assert.equal(decidedExclusions(bare).size, 0, 'a bare entry decides nothing for the denominator');
  assert.equal(checkExclusions(page(263), bare)[0].decided, false, '…and nothing for the verdict');
  assert.match(exclusionWhy(bare[0]), /reason/);
  const full = [{ block: 'calculator', exclude: true, reason: 'r', fallback: 'owner-accepted', decision: 'dyn#6' }];
  assert.deepEqual([...decidedExclusions(full).keys()], ['calculator']);
  assert.equal(exclusionWhy(full[0]), null);
  assert.equal(decidedExclusions([{ block: 'calculator', string: 'x', reason: 'r' }]).size, 0, 'string entries are not decisions');
});

/* analyse() for real: a page whose rendered DOM carries a 60-word vendor block the served HTML lacks. */
const WORDS = (n, w) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const SERVED = `<!DOCTYPE html><html><body><main><div class="section"><div><h1>Loans</h1><p>${WORDS(39, 'copy')}</p></div></div></main></body></html>`;
const RENDERED = SERVED.replace('</div></div></main>', `</div><div><div class="calculator block" data-block-name="calculator"><div>${WORDS(60, 'calc')}</div></div></div></div></main>`);
const FULL = [{ block: 'calculator', exclude: true, reason: 'third-party loan calculator', fallback: 'authored', decision: 'dyn#6' }];

async function loadPlaywright() {
  const tryImport = async (spec) => { try { const m = await import(spec); return m.chromium ? m : m.default; } catch { return null; } };
  let pw = await tryImport('playwright');
  if (!pw) { try { const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); const p = join(root, 'playwright', 'index.mjs'); if (existsSync(p)) pw = await tryImport(pathToFileURL(p).href); } catch { /* none */ } }
  if (!pw?.chromium) return null;
  try { const b = await pw.chromium.launch(); return { browser: b }; } catch { return null; }
}

test('analyse() in a browser: the denominator follows the same decision rule as checkExclusions()', async (t) => {
  const pw = await loadPlaywright();
  if (!pw) { console.log('SKIP ai-readability analyse() browser case: playwright/chromium not resolvable — run from an EDS project'); t.skip('playwright not resolvable'); return; }
  try {
    const page = await pw.browser.newPage();
    await page.setContent(RENDERED);
    const run = (allow, requireDecisions) => page.evaluate(analyse, { served: SERVED, fragments: [], landmarks: 'nav,header,footer', excludeBlocks: ['calculator'], allow: allow || [], decidedBlocks: [...decidedExclusions(allow || []).keys()], requireDecisions });
    const undecided = await run([], true);
    assert.equal(undecided.strict.score, 40, 'served 40 / rendered 100');
    assert.deepEqual([undecided.code.excludedWords, undecided.code.undecidedWords, undecided.code.score], [0, 60, 40], 'undecided: the words stay in the denominator, the page fails the bar');
    assert.equal(checkExclusions(undecided, [])[0].decided, false);
    const bare = await run([{ block: 'calculator', exclude: true }], true);
    assert.deepEqual([bare.code.excludedWords, bare.code.undecidedWords], [0, 60], 'a bare `exclude: true` is undecided for the scorer too');
    const decided = await run(FULL, true);
    assert.deepEqual([decided.code.excludedWords, decided.code.undecidedWords, decided.code.score], [60, 0, 100], 'decided: the words leave the denominator');
    assert.equal(checkExclusions(decided, FULL)[0].decided, true);
    const legacy = await run(null, false);
    assert.deepEqual([legacy.code.excludedWords, legacy.code.undecidedWords, legacy.code.score], [60, 0, 100], 'a consumer with no allowlist (qa today) keeps the pre-decision denominator');
  } finally { await pw.browser.close(); }
});
