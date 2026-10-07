import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainUrl } from '../verify-preview.mjs';
import { runHelp } from './helpers.mjs';

describe('plainUrl', () => {
  it('maps a preview page to its .plain.html, dropping the query', () => {
    assert.equal(plainUrl('http://localhost:3000/offer?pzn=offer:india'), 'http://localhost:3000/offer.plain.html');
    assert.equal(plainUrl('https://main--site--org.aem.page/'), 'https://main--site--org.aem.page/index.plain.html');
    assert.equal(plainUrl('http://localhost:3000/en/'), 'http://localhost:3000/en/index.plain.html');
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
