#!/usr/bin/env node
// skills/deploy/scripts/test/chrome-docs.test.mjs — canon chrome → the /nav and /footer documents: exact documents for a
// header (brand image link, a nav with a dropdown sub-list and a button trigger, a utility list, a CTA, an icon-only
// search link, a search button) and a footer (link columns with headings, a legal line with links, social icon links,
// a newsletter form); entities; the empty-list nav; the CLI (written, unchanged, --check, --prefix, a missing source).
// Run: node plugins/stardust/skills/deploy/scripts/test/chrome-docs.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFooter, buildNav, decode, escapeHtml, firstDifferenceLine, normalizePrefix, parseArgs } from '../chrome-docs.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'chrome-docs.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const HEADER = `<header class="site-header">
  <div class="utility">
    <ul class="utility-links">
      <li><a href="/help">Help</a></li>
      <li><a href="https://shop.example.test/stores">Stores</a></li>
    </ul>
  </div>
  <div class="main-row">
    <a class="site-logo" href="/"><img src="/media/logo.svg" alt="Example"></a>
    <nav aria-label="Main">
      <ul class="nav-links">
        <li><a href="/products?tab=all&amp;sort=new">Products &amp; services</a>
          <ul>
            <li><a href="/products/one">One</a></li>
            <li><a href="/products/two">Two&nbsp;more</a></li>
          </ul>
        </li>
        <li><button type="button" aria-expanded="false">Solutions</button>
          <div class="panel"><ul><li><a href="/solutions/a">Solution A</a></li></ul></div>
        </li>
        <li><a href="/about">  About
            <span>us</span> </a></li>
      </ul>
    </nav>
    <a class="cta" href="/contact">Contact sales</a>
    <a class="search-link" href="/search" aria-label="Search"><svg viewBox="0 0 16 16"><title>Magnifier</title><path d="M0 0h16v16H0z"/></svg></a>
    <button class="search-toggle" aria-label="Open search"><svg><path d="M0 0"/></svg></button>
  </div>
</header>
`;

const NAV = `<body>
  <header></header>
  <main>
    <div>
      <p><a href="/"><img src="/media/logo.svg" alt="Example"></a></p>
    </div>
    <div>
      <ul>
        <li><a href="/products?tab=all&amp;sort=new">Products &amp; services</a>
          <ul>
            <li><a href="/products/one">One</a></li>
            <li><a href="/products/two">Two\u00a0more</a></li>
          </ul>
        </li>
        <li>Solutions
          <ul>
            <li><a href="/solutions/a">Solution A</a></li>
          </ul>
        </li>
        <li><a href="/about">About us</a></li>
      </ul>
    </div>
    <div>
      <ul>
        <li><a href="/help">Help</a></li>
        <li><a href="https://shop.example.test/stores">Stores</a></li>
      </ul>
      <p><a href="/contact">Contact sales</a></p>
      <p><a href="/search">Search</a></p>
    </div>
    <div>
      <div class="metadata">
        <div><div>Robots</div><div>noindex</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
`;

const FOOTER = `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-columns">
      <div class="col">
        <h3>Company</h3>
        <ul><li><a href="/about">About</a></li><li><a href="/careers">Careers</a></li></ul>
      </div>
      <div class="col">
        <h3>Support</h3>
        <ul>
          <li><a href="/help">Help center</a>
            <ul><li><a href="/help/returns">Returns</a></li></ul>
          </li>
        </ul>
      </div>
    </div>
    <div class="footer-newsletter">
      <h4>Newsletter</h4>
      <p>Get <b>monthly</b> <strong>news</strong>.</p>
      <form action="/subscribe"><label for="e">Email</label><input id="e" type="email"><button>Subscribe</button></form>
    </div>
    <div class="footer-social">
      <a href="https://social.example.test/example" aria-label="Example on social"><svg><path d="M0 0"/></svg></a>
      <a href="https://video.example.test/example"><img src="/media/video.svg" alt="Video channel"></a>
    </div>
    <div class="footer-legal">
      <p>&copy; 2026 Example &lt;Inc&gt;. <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms <em>of</em> use</a></p>
      <script>window.year = 2026;</script>
    </div>
  </div>
</footer>
`;

const FOOTER_DOC = `<body>
  <header></header>
  <main>
    <div>
      <h3>Company</h3>
      <ul>
        <li><a href="/about">About</a></li>
        <li><a href="/careers">Careers</a></li>
      </ul>
      <h3>Support</h3>
      <ul>
        <li><a href="/help">Help center</a>
          <ul>
            <li><a href="/help/returns">Returns</a></li>
          </ul>
        </li>
      </ul>
    </div>
    <div>
      <h4>Newsletter</h4>
      <p>Get monthly <strong>news</strong>.</p>
    </div>
    <div>
      <p><a href="https://social.example.test/example">Example on social</a></p>
      <p><a href="https://video.example.test/example"><img src="/media/video.svg" alt="Video channel"></a></p>
    </div>
    <div>
      <p>&copy; 2026 Example &lt;Inc&gt;. <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms of use</a></p>
    </div>
    <div>
      <div class="metadata">
        <div><div>Robots</div><div>noindex</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
`;

check('nav: brand, the nav list (dropdown, button trigger), tools (utility list, CTA, icon-only link); the search button skipped', () => {
  const r = buildNav(HEADER);
  assert.equal(r.doc, NAV);
  assert.deepEqual(r.counts, { brand: 1, links: 5, tools: 4, skipped: 1 });
  assert.deepEqual(r.notes, []);
});
check('footer: one section per band; headings, nested lists, inline paragraph, social links as <p>; the form skipped', () => {
  const r = buildFooter(FOOTER);
  assert.equal(r.doc, FOOTER_DOC);
  assert.deepEqual(r.counts, { bands: 4, links: 8, skipped: 1 });
});
check('entities: the common ones decoded, others kept as written, & < > " re-escaped, &amp;copy; stays literal', () => {
  assert.equal(escapeHtml(decode('&copy; 2026 &amp;copy; R&D &lt;b&gt; &quot;q&quot; &#169; &#x26;amp; &apos;')), '&copy; 2026 &amp;copy; R&amp;D &lt;b&gt; &quot;q&quot; © &#x26;amp; \'');
  assert.equal(decode('a&nbsp;b'), 'a\u00a0b');
});
check('nav without a list: section 2 is an empty <div></div>; a class-named brand is never also a tool', () => {
  const r = buildNav('<header><a class="logo" href="/">Example</a><a href="/login">Sign in</a><a href="#" class="menu">Menu</a><button>Open</button></header>');
  assert.match(r.doc, /<main>\n {4}<div>\n {6}<p><a href="\/">Example<\/a><\/p>\n {4}<\/div>\n {4}<div><\/div>\n {4}<div>\n {6}<p><a href="\/login">Sign in<\/a><\/p>\n {4}<\/div>\n/);
  assert.deepEqual(r.counts, { brand: 1, links: 0, tools: 1, skipped: 2 });
});
check('--prefix: slashes stripped, EDS segments only; a value flag without a value names the flag', () => {
  assert.equal(normalizePrefix('fr'), 'fr');
  assert.equal(normalizePrefix('/ca/en/'), 'ca/en');
  assert.throws(() => normalizePrefix('fr_FR'), /use "fr-fr"/);
  assert.throws(() => normalizePrefix('/'), /empty/);
  assert.throws(() => parseArgs(['--canon']), /--canon needs a value/);
  assert.throws(() => parseArgs(['--content', '--check']), /--content needs a value/);
  assert.equal(firstDifferenceLine('a\nb\nc', 'a\nb'), 3);
});

const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const ROOT = mkdtempSync(join(tmpdir(), 'chrome-docs-'));
check('CLI: written, re-run unchanged, --check matches then differs and missing, --prefix fr', () => {
  const p = join(ROOT, 'site'); mkdirSync(join(p, 'stardust', 'canon'), { recursive: true });
  writeFileSync(join(p, 'stardust', 'canon', 'header.html'), HEADER);
  writeFileSync(join(p, 'stardust', 'canon', 'footer.html'), FOOTER);
  let r = run(p);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'nav content/nav.html: written (brand 1, links 5, tools 4, skipped 1 control(s))\nfooter content/footer.html: written (bands 4, links 8, skipped 1 control(s))\n');
  assert.equal(readFileSync(join(p, 'content', 'nav.html'), 'utf8'), NAV);
  assert.equal(readFileSync(join(p, 'content', 'footer.html'), 'utf8'), FOOTER_DOC);
  r = run(p);
  assert.match(r.stdout, /^nav content\/nav\.html: unchanged .*\nfooter content\/footer\.html: unchanged /);
  r = run(p, '--check');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /nav content\/nav\.html: matches .*\nfooter content\/footer\.html: matches /);
  writeFileSync(join(p, 'content', 'nav.html'), NAV.replace('Contact sales', 'Contact us'));
  rmSync(join(p, 'content', 'footer.html'));
  r = run(p, '--check');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /nav content\/nav\.html: differs \(first difference at line 28\) \(brand 1/);
  assert.match(r.stdout, /footer content\/footer\.html: missing \(bands 4/);
  assert.equal(readFileSync(join(p, 'content', 'nav.html'), 'utf8'), NAV.replace('Contact sales', 'Contact us'));
  r = run(p, '--prefix', '/fr/');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^nav content\/fr\/nav\.html: written .*\nfooter content\/fr\/footer\.html: written /);
  assert.equal(readFileSync(join(p, 'content', 'fr', 'nav.html'), 'utf8'), NAV);
});
check('CLI: a missing canon footer exits 1 and the nav is still written', () => {
  const p = join(ROOT, 'half'); mkdirSync(join(p, 'stardust', 'canon'), { recursive: true });
  writeFileSync(join(p, 'stardust', 'canon', 'header.html'), HEADER);
  const r = run(p);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^nav content\/nav\.html: written /);
  assert.match(r.stderr, /footer: canon source stardust\/canon\/footer\.html missing/);
  assert.equal(readFileSync(join(p, 'content', 'nav.html'), 'utf8'), NAV);
});
check('CLI: --help in an empty directory and a usage error write nothing', () => {
  const p = join(ROOT, 'empty'); mkdirSync(p);
  let r = run(p, '--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /chrome-docs\.mjs/);
  assert.match(r.stdout, /Exit codes/);
  r = run(p, '--prefix');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--prefix needs a value/);
  assert.deepEqual(readdirSync(p), []);
});
rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
