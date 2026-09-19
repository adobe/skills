#!/usr/bin/env node
/**
 * ai-readability.mjs LANDMARKS contract (T30.1 / a harvest project's F2 trap 3): a template shell
 * whose roots are `<aside>` / role="complementary" / role="search" must be skipped by the
 * checker like nav/header/footer, or its placeholder strings (rendered, never served)
 * sink the `code` score the shell was built to pass (D11 keeps code ≥ 98 as the bar).
 * Pure: imports the exported constant only (the module's CLI runs behind an isMain guard).
 * Run: node --test skills/deploy/scripts/test/ai-readability-landmarks.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS } from '../ai-readability.mjs';

test('LANDMARKS: the three stock landmarks plus aside / complementary / search, as one selector list', () => {
  const parts = LANDMARKS.split(',').map((s) => s.trim());
  for (const need of ['nav', 'header', 'footer', 'aside', '[role="complementary"]', '[role="search"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]']) {
    assert.ok(parts.includes(need), `LANDMARKS lists ${need}`);
  }
  assert.ok(parts.every((p) => p && !/\s,|,\s/.test(p)), 'no empty or malformed entries');
  assert.equal(new Set(parts).size, parts.length, 'no duplicate entries');
});
