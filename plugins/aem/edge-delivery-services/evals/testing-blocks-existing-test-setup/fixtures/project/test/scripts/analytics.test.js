import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import setupDom from '../support/setup-dom.js';
import { fireAnalyticsEvent } from '../../scripts/analytics.js';

describe('fireAnalyticsEvent', () => {
  beforeEach(() => {
    setupDom();
  });

  it('creates the data layer when the page has none', () => {
    fireAnalyticsEvent('page-view');
    assert.deepEqual(window.adobeDataLayer, [{ event: 'page-view' }]);
  });

  it('appends to an existing data layer', () => {
    window.adobeDataLayer = [{ event: 'consent' }];
    fireAnalyticsEvent('cta-click', { label: 'buy' });
    assert.deepEqual(window.adobeDataLayer, [{ event: 'consent' }, { event: 'cta-click', label: 'buy' }]);
  });
});
