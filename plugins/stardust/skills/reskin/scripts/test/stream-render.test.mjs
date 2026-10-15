#!/usr/bin/env node
// skills/reskin/scripts/test/stream-render.test.mjs — stream-render (pure part, no browser, no network):
// token sheet → path-named custom properties, every content-model string and href interpolated, the
// renderer contract (site-header/main/footer, data-slot, data-slot-body, data-module, .btn / .btn-secondary),
// heading alignment from type.display.textAlign (default left), resolveImg → data-source-src, localSubpath,
// and an unknown stream node kind throws instead of dropping content. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSubpath, render, tokenVars } from '../stream-render.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'stream-render.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const tokens = {
  _provenance: { writtenBy: 'test' }, donor: 'x', nodeRefs: { a: 'b' },
  palette: { pageBg: 'rgb(255, 255, 255)', accent: 'rgb(0, 80, 160)' },
  type: { family: 'Inter', familyNote: 'skip me', display: { fontWeight: '700' } },
  buttons: { primary: { background: 'rgb(0, 80, 160)' } },
};
const model = {
  metadata: { title: 'Sign in', lang: 'en', description: 'Sign in & go', canonical: 'https://example.test/login' },
  sections: [{
    slot: 's01',
    ordered: [
      { kind: 'heading', level: 'h1', text: 'Welcome <back>' },
      { kind: 'paragraph', text: 'Use your account.' },
      { kind: 'text', parentTag: 'label', text: 'Email *' },
      { kind: 'formControl', control: 'input', inputType: 'email', name: 'email' },
      { kind: 'cta', text: 'Sign in', absHref: 'https://example.test/go', classes: 'btn' },
      { kind: 'cta', text: 'Register', absHref: 'https://example.test/reg', classes: 'button' },
      { kind: 'image', currentSrc: 'https://cdn.example.test/a/b.png?v=1', alt: 'A' },
    ],
  }],
};
const mapping = { pages: { login: { template: 'login', slots: { s01: { module: 'M2', layout: 'stack', width: 'narrow' } } } } };
const base = { slug: 'login', model, tokens, mapping, now: '2026-01-01T00:00:00Z' };

check('tokenVars: every string leaf, path-named in kebab case; metadata keys skipped', () => {
  const v = Object.fromEntries(tokenVars(tokens));
  assert.equal(v['--palette-page-bg'], 'rgb(255, 255, 255)');
  assert.equal(v['--type-display-font-weight'], '700');
  assert.equal(v['--buttons-primary-background'], 'rgb(0, 80, 160)');
  for (const k of Object.keys(v)) assert.ok(!/provenance|donor|node-refs|family-note/.test(k), k);
});
check('renderer contract: chrome/main classes, data-slot, data-module, data-slot-body, template', () => {
  const { html, slots } = render(base);
  assert.equal(slots, 1);
  assert.match(html, /<header class="site-header" data-canon="header">/);
  assert.match(html, /<main class="site-main" data-template="login">/);
  assert.match(html, /<footer class="site-footer" data-canon="footer">/);
  assert.match(html, /<section class="band layout-stack width-narrow" data-slot="s01" data-module="M2">/);
  assert.match(html, /data-slot-body/);
});
check('content interpolated and escaped; labels keep the required marker; hrefs absolute', () => {
  const { html } = render(base);
  assert.match(html, /<h1 class="heading">Welcome &lt;back&gt;<\/h1>/);
  assert.match(html, /<label for="f1">Email <span class="req">\*<\/span><\/label><input id="f1" type="email" name="email">/);
  assert.match(html, /<meta name="description" content="Sign in &amp; go">/);
  assert.match(html, /href="https:\/\/example\.test\/go"/);
});
check('first button of a slot is .btn, later ones .btn btn-secondary', () => {
  const { html } = render(base);
  assert.match(html, /<a class="btn" href="https:\/\/example\.test\/go">Sign in<\/a>/);
  assert.match(html, /<a class="btn btn-secondary" href="https:\/\/example\.test\/reg">Register<\/a>/);
});
check('heading alignment: type.display.textAlign token when present, else left', () => {
  assert.match(render(base).html, /\.site-main \.heading \{[^}]*text-align: left;/);
  const t2 = structuredClone(tokens); t2.type.display.textAlign = 'center';
  const { html } = render({ ...base, tokens: t2 });
  assert.match(html, /--type-display-text-align: center;/);
  assert.match(html, /\.site-main \.heading \{[^}]*text-align: var\(--type-display-text-align\);/);
});
check('images: hot-linked by default; resolveImg localizes and keeps data-source-src; images listed once', () => {
  const a = render(base);
  assert.deepEqual(a.images, ['https://cdn.example.test/a/b.png?v=1']);
  assert.match(a.html, /<img src="https:\/\/cdn\.example\.test\/a\/b\.png\?v=1" alt="A">/);
  const b = render({ ...base, resolveImg: (u) => ({ src: 'assets/img/x.png', source: u }) });
  assert.match(b.html, /<img src="assets\/img\/x\.png" data-source-src="https:\/\/cdn\.example\.test\/a\/b\.png\?v=1" alt="A">/);
});
check('deterministic: two renders are byte-identical; uid restarts per render', () => {
  assert.equal(render(base).html, render(base).html);
});
check('unknown stream node kind throws; a page missing from mapping throws', () => {
  const m2 = structuredClone(model); m2.sections[0].ordered.push({ kind: 'video' });
  assert.throws(() => render({ ...base, model: m2 }), /unhandled stream node kind "video"/);
  assert.throws(() => render({ ...base, slug: 'nope' }), /mapping\.json has no pages\.nope/);
});
check('localSubpath: host + path under img/, query dropped, unsafe characters folded, extension from content type', () => {
  assert.equal(localSubpath('https://cdn.example.test/a/b.png?v=1'), 'img/cdn.example.test/a/b.png');
  assert.equal(localSubpath('https://cdn.example.test/x%20y/img', 'image/webp'), 'img/cdn.example.test/x-y/img.webp');
  assert.equal(localSubpath('https://cdn.example.test/'), 'img/cdn.example.test/index');
});
check('--help in an empty cwd: exit 0, usage on stdout; no slug: exit 2', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sr-'));
  const h = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(h.status, 0); assert.match(h.stdout, /^usage: node stream-render\.mjs/);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' }).status, 2);
  const m = spawnSync(process.execPath, [SCRIPT, 'login'], { cwd, encoding: 'utf8' });
  assert.equal(m.status, 2); assert.match(m.stderr, /missing mapping\.json/);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
