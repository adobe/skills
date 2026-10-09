import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainUrl, splitConsoleErrors } from '../verify-preview.mjs';
import { runHelp } from './helpers.mjs';

describe('plainUrl', () => {
  it('maps a preview page to its .plain.html, dropping the query', () => {
    assert.equal(plainUrl('http://localhost:3000/offer?pzn=offer:india'), 'http://localhost:3000/offer.plain.html');
    assert.equal(plainUrl('https://main--site--org.aem.page/'), 'https://main--site--org.aem.page/index.plain.html');
    assert.equal(plainUrl('http://localhost:3000/en/'), 'http://localhost:3000/en/index.plain.html');
  });
});

describe('splitConsoleErrors', () => {
  const nav = 'Failed to load resource: 404 (http://localhost:3000/nav.plain.html)';
  const variant = 'Failed to load resource: 404 (http://localhost:3000/fragments/personalization/hero/india.plain.html)';
  const run = (query, errors) => ({ query, errors, problems: [], ok: true });

  it('reports errors the default run also has as pre-existing, not failures', () => {
    const { results, preExisting } = splitConsoleErrors([run('', [nav]), run('pzn-geo=IN', [nav])]);
    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(preExisting, [nav]);
  });

  it('fails errors a case introduced, and personalization errors even on the default run', () => {
    const { results, preExisting } = splitConsoleErrors([run('', [variant]), run('pzn-geo=IN', ['boom', variant])]);
    assert.equal(results[0].ok, false);
    assert.match(results[1].problems[0], /boom/);
    assert.deepEqual(preExisting, []);
  });

  it('treats baseline errors as pre-existing', () => {
    const { results, preExisting } = splitConsoleErrors([run('pzn-geo=IN', [nav])], [nav]);
    assert.equal(results[0].ok, true);
    assert.deepEqual(preExisting, [nav]);
  });
});

describe('verify-preview.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('verify-preview.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
