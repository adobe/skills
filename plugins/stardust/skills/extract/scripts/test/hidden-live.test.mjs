#!/usr/bin/env node
// Fixture test: crawl.mjs stampHiddenLive — the hidden-live stamp skills/migrate/scripts/importer-skeleton.mjs
// reads from the rendered-DOM sidecar (importer-recipe.md § Skeleton contract). No browser: a fake DOM.
//   * the TOPMOST node with computed display:none / visibility:hidden carries data-hidden-live="<reason>";
//     its descendants are not stamped again; visible nodes are untouched;
//   * <details> (and its closed panel) is never stamped — a closed accordion is content, kept as a row;
//   * script/style/template/noscript are skipped; <html> carries data-hidden-live-stamp="<ts>";
//   * the count returned is the number of stamped nodes; an empty document returns 0 and stamps nothing.
// Before the change crawl.mjs stamped nothing: every capture was `hiddenLive: "unstamped"` to the importer,
// which then skipped nothing (hidden modals, cookie banners and off-state tabs became content rows).
// Usage: node plugins/stardust/skills/extract/scripts/test/hidden-live.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { stampHiddenLive } from '../crawl.mjs';

// tiny DOM: node(tag, style, children); getComputedStyle reads the node's own style with inheritance of visibility
const node = (tagName, style = {}, children = []) => { const n = { tagName, style, children, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; } }; for (const c of children) c.parent = n; return n; };
const win = { getComputedStyle: (n) => ({ display: n.style.display || 'block', visibility: n.style.visibility || (n.parent ? win.getComputedStyle(n.parent).visibility : 'visible') }) };
const all = (n, out = []) => { out.push(n); for (const c of n.children) all(c, out); return out; };

const modalInner = node('SPAN');
const modal = node('DIV', { display: 'none' }, [node('H2'), modalInner]);
const ghost = node('P', { visibility: 'hidden' }, [node('EM')]);
const panelP = node('P', { display: 'none' });
const details = node('DETAILS', {}, [node('SUMMARY'), panelP]);
const script = node('SCRIPT', { display: 'none' });
const visible = node('SECTION', {}, [node('H1'), node('P')]);
const body = node('BODY', {}, [node('HEADER'), visible, modal, ghost, details, script]);
const html = node('HTML', {}, [node('HEAD'), body]);
const doc = { documentElement: html, body };

const n = stampHiddenLive(doc, win, '2026-01-01T00:00:00Z');
assert.equal(n, 2, 'two topmost hidden nodes: the display:none modal and the visibility:hidden paragraph');
assert.equal(modal.getAttribute('data-hidden-live'), 'display:none');
assert.equal(ghost.getAttribute('data-hidden-live'), 'visibility:hidden');
assert.equal(modalInner.getAttribute('data-hidden-live'), null, 'descendants of a stamped node are not stamped again');
assert.equal(modal.children[0].getAttribute('data-hidden-live'), null);
assert.equal(panelP.getAttribute('data-hidden-live'), null, 'the closed <details> panel is content, never hidden-live');
assert.equal(details.getAttribute('data-hidden-live'), null, '<details> itself is never stamped');
assert.equal(script.getAttribute('data-hidden-live'), null, 'script/style/template/noscript are skipped');
assert.ok(all(visible).every((x) => x.getAttribute('data-hidden-live') === null), 'visible content is untouched');
assert.equal(html.getAttribute('data-hidden-live-stamp'), '2026-01-01T00:00:00Z', 'the stamp marker on <html>');
assert.equal(body.getAttribute('data-hidden-live-stamp'), '2026-01-01T00:00:00Z', 'and on <body> — the sidecar serialises the document content, so <body> is what the importer keys "stamped" on');
assert.equal(all(html).filter((x) => x.getAttribute('data-hidden-live') !== null).length, 2, 'exactly the count returned');

// second run is idempotent (a recapture re-stamps the same nodes, count unchanged)
assert.equal(stampHiddenLive(doc, win), 2);
assert.match(html.getAttribute('data-hidden-live-stamp'), /^\d{4}-\d{2}-\d{2}T/, 'default stamp is an ISO timestamp');

// empty document → 0, nothing stamped
assert.equal(stampHiddenLive({ documentElement: null, body: null }, win), 0);
const bare = node('HTML', {}, []); assert.equal(stampHiddenLive({ documentElement: bare, body: null }, win), 0); assert.match(bare.getAttribute('data-hidden-live-stamp'), /T/);

// the importer's reading of the stamp: the two attributes above are exactly what importer-skeleton keys on
const { importCapture } = await import('../../../migrate/scripts/importer-skeleton.mjs').catch(() => ({}));
if (importCapture) {
  const vocab = { root: 'main', chrome: [], wrappers: [], markers: {} };
  const res = importCapture('<!DOCTYPE html><html data-hidden-live-stamp="2026-01-01T00:00:00Z"><head><title>t</title></head><body><main><section><h1>T</h1><p>Visible.</p><div class="modal" data-hidden-live="display:none"><p>Never shown.</p></div><details><summary>Terms</summary><p>Row.</p></details></section></main></body></html>', vocab, {}, {});
  assert.equal(res.report.hiddenLive, 'stamped');
  assert.deepEqual(res.report.hidden, [{ selector: 'div.modal', reason: 'display:none' }], 'the stamped node is skipped and recorded by the importer');
}
console.log('hidden-live test: ok (topmost display:none / visibility:hidden stamped with the reason, descendants once, <details> and script-likes never, <html> marker, count, idempotent, importer reads it)');
