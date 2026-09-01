'use strict';

/**
 * Probe — thin HTTP client to a running AEM quickstart.
 *
 * The RV invariants never talk to AEM directly; they call these helpers so the
 * same invariant code runs against a real instance OR the mock (mock-probe.js).
 * Everything here is read-only except `writeTestConfig`, which only touches the
 * RV test namespace (/var/rv, /apps/rv-test).
 */
class Probe {
  constructor({ baseUrl, user = 'admin', password = 'admin' } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
    this.auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  }

  async _get(path) {
    const res = await fetch(this.baseUrl + path, { headers: { Authorization: this.auth } });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  /** OSGi component state from the Felix console: { active, properties }.
   *  The list endpoint (/components.json) returns summary rows only; to get the
   *  configured Properties (scheduler.expression, scheduler.runOn, etc.) we
   *  follow up with the per-component detail endpoint. */
  async osgiComponent(pid) {
    const list = await this._get('/system/console/components.json');
    const summary = (list.data || []).find(c => c.name === pid || c.pid === pid);
    if (!summary) return { found: false, active: false, properties: {} };
    const active = /active|satisfied/i.test(summary.state);

    const properties = {};
    try {
      const detail = await this._get(`/system/console/components/${summary.id}.json`);
      const props = (detail.data && detail.data[0] && detail.data[0].props) || [];
      const propBlock = props.find(p => p.key === 'Properties');
      const lines = !propBlock ? [] : Array.isArray(propBlock.value) ? propBlock.value : String(propBlock.value).split('\n');
      for (const line of lines) {
        const m = String(line).match(/^([^=]+?)\s*=\s*(.*)$/);
        if (m) properties[m[1].trim()] = m[2].trim();
      }
    } catch { /* leave properties empty on detail-fetch failure */ }

    return { found: true, active, state: summary.state, properties };
  }

  /** Read a single JCR property via the .json selector. */
  async jcrProp(nodePath, prop) {
    const json = await this._get(`${nodePath}.json`);
    return json ? json[prop] : undefined;
  }

  /** True if a repository node exists (GET <path>.json -> 200). */
  async exists(nodePath) {
    const res = await fetch(`${this.baseUrl}${nodePath}.json`, { headers: { Authorization: this.auth } });
    return res.status === 200;
  }

  /** Create a simple test node via the Sling default POST servlet. */
  async createNode(nodePath, primaryType = 'nt:unstructured') {
    const body = new URLSearchParams({ 'jcr:primaryType': primaryType });
    const res = await fetch(`${this.baseUrl}${nodePath}`, {
      method: 'POST', headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    return res.status; // 200/201
  }

  /** GET a trigger endpoint (e.g. a test servlet) and return its text body. */
  async callGet(pathWithQuery) {
    const res = await fetch(`${this.baseUrl}${pathWithQuery}`, { headers: { Authorization: this.auth } });
    return { status: res.status, body: await res.text() };
  }

  wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  wait(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { Probe };
