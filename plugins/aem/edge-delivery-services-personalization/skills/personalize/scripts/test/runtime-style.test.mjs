/*
 * The runtime is copied into sites that lint with airbnb-base (the
 * boilerplate's `npm run lint`). This catches the rules the runtime has
 * tripped before; the acceptance run lints a real site with the full config.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';

const files = readdirSync(RUNTIME_DIR, { recursive: true })
  .filter((name) => String(name).endsWith('.js'))
  .map((name) => join(RUNTIME_DIR, String(name)));

// airbnb max-len: 100, lines with strings, template literals, URLs or
// regular expressions exempt.
const exempt = (line) => /['"`]|:\/\/|\/[^/*\s].*\/[dgimsuy]*[.,;)]/.test(line);

describe('runtime style', () => {
  it('finds the runtime files', () => assert.ok(files.length > 10));

  it('keeps lines within 100 characters', () => {
    const long = files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .map((line, index) => [line, index])
      .filter(([line]) => line.length > 100 && !exempt(line))
      .map(([line, index]) => `${relative(RUNTIME_DIR, file)}:${index + 1} (${line.length})`));
    assert.deepEqual(long, []);
  });

  it('uses no for...of loops (airbnb no-restricted-syntax)', () => {
    const loops = files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .map((line, index) => [line, index])
      .filter(([line]) => /\bfor\s*\((const|let|var)\s+[^;]*\s(of|in)\s/.test(line))
      .map(([, index]) => `${relative(RUNTIME_DIR, file)}:${index + 1}`));
    assert.deepEqual(loops, []);
  });
});
