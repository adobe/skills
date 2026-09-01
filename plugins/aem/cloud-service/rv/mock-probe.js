'use strict';

/**
 * MockProbe — simulates a quickstart so the harness runs end-to-end with no
 * live AEM. Same interface as Probe. Drive scenarios from a fixture:
 *
 *   {
 *     components: { '<pid>': { active, properties } },
 *     markers:    { '<path>': { <prop>: <initialValue> } },
 *     firing:     { '<path>': <prop> }   // which marker advances on each wait()
 *   }
 */
class MockProbe {
  constructor(fixture = {}) {
    this.fixture = fixture;
    this._ticks = 0;
  }

  async osgiComponent(pid) {
    const c = (this.fixture.components || {})[pid];
    if (!c) return { found: false, active: false, properties: {} };
    return { found: true, active: !!c.active, state: c.active ? 'active' : 'unsatisfied', properties: c.properties || {} };
  }

  async jcrProp(nodePath, prop) {
    const node = (this.fixture.markers || {})[nodePath];
    return node ? node[prop] : undefined;
  }

  /** Simulated time: advance any marker configured to "fire". */
  wait(_ms) {
    this._ticks += 1;
    const firing = this.fixture.firing || {};
    for (const [path, prop] of Object.entries(firing)) {
      const node = (this.fixture.markers || {})[path];
      if (node) node[prop] = (node[prop] || 0) + 1000; // advance timestamp
    }
    return Promise.resolve();
  }
}

module.exports = { MockProbe };
