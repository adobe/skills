#!/usr/bin/env node
// skills/deploy/scripts/test/chrome-docs.test.mjs — canon chrome → the /nav and /footer documents: exact documents for a
// header (brand image link, a nav with a dropdown sub-list and a button trigger, a utility list, a CTA, an icon-only
// search link, a search button) and a footer (link columns with headings, a legal line with links, social icon links,
// a newsletter form); entities (a prototype-key name stays literal); the empty-list nav; column-only nav items, with and
// without their own label; a Back or Close control at the top of a panel stays a skipped control, while a dropdown
// wrapper holding its own trigger keeps that label; a label heads every column after the list it heads; the CLI
// (written, unchanged, --check, --prefix, a missing source).
// Run: node plugins/stardust/skills/deploy/scripts/test/chrome-docs.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFooter, buildNav, decode, escapeHtml, firstDifferenceLine, normalizePrefix, parseArgs, parseHTML } from '../chrome-docs.mjs';

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
// The <main> sections of a built document, by index: 0 brand, 1 links, 2 tools (an empty section is '').
const sectionsOf = (doc) => {
  const out = []; let cur = null;
  for (const line of doc.split('\n')) {
    if (line === '    <div></div>') out.push('');
    else if (line === '    <div>') cur = [];
    else if (line === '    </div>') { out.push(cur.join('\n')); cur = null; } else if (cur) cur.push(line);
  }
  return out;
};
check('nav nesting comes only from source lists: a description and a badge stay inline; a column heading heads its list', () => {
  const r = buildNav(`<header><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul>
    <li><button>Products</button>
      <div class="mega"><div class="col"><h3>Widgets</h3><ul><li><a href="/p1">P1</a><p>Fast widgets</p></li></ul></div></div>
    </li>
    <li><a href="/x">X</a> <span class="badge">New</span></li>
    <li><a href="/y">Y</a><span class="badge">Sale</span><ul><li><a href="/y/1">Y1</a></li></ul></li>
  </ul></nav></header>`);
  assert.equal(sectionsOf(r.doc)[1], `      <ul>
        <li>Products
          <ul>
            <li>Widgets
              <ul>
                <li><a href="/p1">P1</a> Fast widgets</li>
              </ul>
            </li>
          </ul>
        </li>
        <li><a href="/x">X</a> New</li>
        <li><a href="/y">Y</a> Sale
          <ul>
            <li><a href="/y/1">Y1</a></li>
          </ul>
        </li>
      </ul>`);
});
check('nav: a link directly followed by a list heads it — a button trigger over two link-headed columns, each with its own list, bare or in one panel', () => {
  const nav = (inner) => sectionsOf(buildNav(`<header><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul>
    <li><button>Products</button>${inner}</li>
  </ul></nav></header>`).doc)[1];
  const groups = '<a href="/a">Column A</a><ul><li><a href="/a1">A1</a></li></ul><a href="/b">Column B</a><ul><li><a href="/b1">B1</a></li></ul>';
  assert.equal(nav(`<div class="panel">${groups}</div>`), nav(groups));
  assert.equal(nav(groups), `      <ul>
        <li>Products
          <ul>
            <li><a href="/a">Column A</a>
              <ul>
                <li><a href="/a1">A1</a></li>
              </ul>
            </li>
            <li><a href="/b">Column B</a>
              <ul>
                <li><a href="/b1">B1</a></li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>`);
});
// A mega panel: two headed columns, a heading-less column, a close button (a control: skipped, never authored).
const COLUMNS = `<div class="mega"><div class="col"><h3>Widgets</h3><ul><li><a href="/w1">W1</a></li><li><a href="/w2">W2</a></li></ul></div>
      <section class="col"><h3>Gadgets</h3><ul><li><a href="/g1">G1</a></li></ul></section>
      <div class="col"><ul><li><a href="/all">All products</a></li></ul></div><button class="close" aria-label="Close"></button></div>`;
check('nav: an item made only of column wrappers has no label of its own — its columns stand at that level, no heading promoted', () => {
  const r = buildNav(`<header><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul>
    <li>${COLUMNS}</li>
    <li><a href="/x">X</a></li>
  </ul></nav></header>`);
  assert.equal(sectionsOf(r.doc)[1], `      <ul>
        <li>Widgets
          <ul>
            <li><a href="/w1">W1</a></li>
            <li><a href="/w2">W2</a></li>
          </ul>
        </li>
        <li>Gadgets
          <ul>
            <li><a href="/g1">G1</a></li>
          </ul>
        </li>
        <li><a href="/all">All products</a></li>
        <li><a href="/x">X</a></li>
      </ul>`);
  assert.deepEqual(r.counts, { brand: 1, links: 5, tools: 0, skipped: 1 });
});
check('nav: column wrappers beside the item\'s own link nest under it, each heading a sub-item over its links', () => {
  const r = buildNav(`<header><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul>
    <li><a href="/products">Products</a>${COLUMNS}</li>
  </ul></nav></header>`);
  assert.equal(sectionsOf(r.doc)[1], `      <ul>
        <li><a href="/products">Products</a>
          <ul>
            <li>Widgets
              <ul>
                <li><a href="/w1">W1</a></li>
                <li><a href="/w2">W2</a></li>
              </ul>
            </li>
            <li>Gadgets
              <ul>
                <li><a href="/g1">G1</a></li>
              </ul>
            </li>
            <li><a href="/all">All products</a></li>
          </ul>
        </li>
      </ul>`);
  assert.deepEqual(r.counts, { brand: 1, links: 5, tools: 0, skipped: 1 });
});
const navFor = (li) => buildNav(`<header><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul>${li}</ul></nav></header>`);
const navOf = (li) => sectionsOf(navFor(li).doc)[1];
const COL_W = '<div class="col"><h3>Widgets</h3><ul><li><a href="/w1">W1</a></li></ul></div>';
const COL_G = '<div class="col"><h3>Gadgets</h3><ul><li><a href="/g1">G1</a></li></ul></div>';
const P12 = '<ul><li><a href="/p1">P1</a></li><li><a href="/p2">P2</a></li></ul>';
const W_G = `        <li>Widgets
          <ul>
            <li><a href="/w1">W1</a></li>
          </ul>
        </li>
        <li>Gadgets
          <ul>
            <li><a href="/g1">G1</a></li>
          </ul>
        </li>`;
check('nav: inside a column every heading heads its own list — one wrapper of two groups, a two-group column, a link after a column\'s list', () => {
  const groups = '<h3>Widgets</h3><ul><li><a href="/w1">W1</a></li></ul><h3>Gadgets</h3><ul><li><a href="/g1">G1</a></li></ul>';
  assert.equal(navOf(`<li><div class="mega">${groups}</div></li>`), `      <ul>\n${W_G}\n      </ul>`);
  assert.equal(navOf(`<li><div class="col">${groups}</div><div class="col"><h3>Tools</h3><ul><li><a href="/t1">T1</a></li></ul><a href="/tools">All tools</a></div></li>`), `      <ul>
${W_G}
        <li>Tools
          <ul>
            <li><a href="/t1">T1</a></li>
          </ul>
        </li>
        <li><a href="/tools">All tools</a></li>
      </ul>`);
  assert.equal(navOf(`<li><div class="col">${groups}<a href="/sale">Sale</a> <span>New</span><ul><li><a href="/s1">S1</a></li></ul></div></li>`), `      <ul>
${W_G}
        <li><a href="/sale">Sale</a> New
          <ul>
            <li><a href="/s1">S1</a></li>
          </ul>
        </li>
      </ul>`);
});
check('nav: a link after the columns is the item\'s own label, never a column heading; an empty icon beside the columns changes nothing', () => {
  assert.equal(navOf(`<li>${COL_W}${COL_G}<a href="/all">See all</a></li>`), `      <ul>
        <li><a href="/all">See all</a>
          <ul>
    ${W_G.replace(/\n/g, '\n    ')}
          </ul>
        </li>
      </ul>`);
  assert.equal(navOf(`<li><span class="chev"></span>${COL_W}<i class="icon"></i>${COL_G}</li>`), `      <ul>\n${W_G}\n      </ul>`);
});
check('nav: a Back or Close control at the top of a panel is skipped, never a label — in a column after the item\'s label a button or an href-less link is a control', () => {
  const under = (head) => `      <ul>
        <li>${head}
          <ul>
            <li><a href="/p1">P1</a></li>
            <li><a href="/p2">P2</a></li>
          </ul>
        </li>
      </ul>`;
  for (const [own, head, links] of [['<a href="/products">Products</a>', '<a href="/products">Products</a>', 3], ['<button>Products</button>', 'Products', 2]]) {
    for (const back of ['<button class="back">Back</button>', '<a href="#">Back</a>']) {
      const r = navFor(`<li>${own}<div class="submenu">${back}${P12}</div></li>`);
      assert.equal(sectionsOf(r.doc)[1], under(head));
      assert.deepEqual(r.counts, { brand: 1, links, tools: 0, skipped: 1 });
    }
  }
  const r = navFor(`<li><a href="/products">Products</a><div class="mega"><button aria-label="Close">x</button>${COL_W}${COL_G}</div></li>`);
  assert.equal(sectionsOf(r.doc)[1], `      <ul>
        <li><a href="/products">Products</a>
          <ul>
    ${W_G.replace(/\n/g, '\n    ')}
          </ul>
        </li>
      </ul>`);
  assert.deepEqual(r.counts, { brand: 1, links: 3, tools: 0, skipped: 1 });
});
check('nav: a dropdown wrapper holding its own trigger and list keeps the label — a button or an href-less link, item by item or in one item', () => {
  const two = `      <ul>
        <li>Products
          <ul>
            <li><a href="/p1">P1</a></li>
            <li><a href="/p2">P2</a></li>
          </ul>
        </li>
        <li>Services
          <ul>
            <li><a href="/s1">S1</a></li>
          </ul>
        </li>
      </ul>`;
  const s1 = '<ul><li><a href="/s1">S1</a></li></ul>';
  let r = navFor(`<li><div class="dropdown"><button>Products</button>${P12}</div></li>
    <li><div class="dropdown"><a href="#">Services</a><div class="menu"><button class="back">Back</button>${s1}</div></div></li>`);
  assert.equal(sectionsOf(r.doc)[1], two);
  assert.deepEqual(r.counts, { brand: 1, links: 3, tools: 0, skipped: 1 });
  r = navFor(`<li><div class="dropdown"><button>Products</button>${P12}</div><div class="dropdown"><button>Services</button>${s1}</div></li>`);
  assert.equal(sectionsOf(r.doc)[1], two);
  assert.deepEqual(r.counts, { brand: 1, links: 3, tools: 0, skipped: 0 });
});
check('nav: a label heads every column after the list it heads — a dropdown wrapper\'s own link, button or text over two columns keeps both under it', () => {
  const under = (head) => `      <ul>
        <li>${head}
          <ul>
    ${W_G.replace(/\n/g, '\n    ')}
          </ul>
        </li>
      </ul>`;
  const r = navFor(`<li><div class="dropdown"><a href="/products">Products</a>${COL_W}${COL_G}</div></li>`);
  assert.equal(sectionsOf(r.doc)[1], under('<a href="/products">Products</a>'));
  assert.deepEqual(r.counts, { brand: 1, links: 3, tools: 0, skipped: 0 });
  assert.equal(navOf(`<li><div class="dropdown"><button>Products</button>${COL_W}${COL_G}</div></li>`), under('Products'));
  assert.equal(navOf(`<li><div class="dropdown"><span class="label">Products</span>${COL_W}${COL_G}</div></li>`), under('Products'));
  assert.equal(navOf(`<li><div class="dropdown"><a href="/products">Products</a><div class="col"><ul><li><a href="/w1">W1</a></li></ul></div><div class="col"><ul><li><a href="/g1">G1</a></li></ul></div></div></li>`), `      <ul>
        <li><a href="/products">Products</a>
          <ul>
            <li><a href="/w1">W1</a></li>
            <li><a href="/g1">G1</a></li>
          </ul>
        </li>
      </ul>`);
});
check('entities: a name that is an Object.prototype key stays literal text; a tag of that name parses', () => {
  assert.equal(decode('&constructor; &toString; &valueOf; &hasOwnProperty; &amp;'), '&constructor; &toString; &valueOf; &hasOwnProperty; &');
  assert.equal(sectionsOf(buildFooter('<footer><p>R&constructor;D &toString;</p></footer>').doc)[0], '      <p>R&constructor;D &toString;</p>');
  assert.equal(parseHTML('<constructor><p>x</p></constructor>').children[0].children[0].tag, 'p');
});
check('brand: an icon link before the logo stays a tool; a logo signal, then a named link, then "/", then any image link', () => {
  const r = buildNav('<header><a href="/stores"><svg><path d="M0 0"/></svg>Find a store</a><a class="logo" href="/"><img src="/media/logo.svg" alt="Example"></a><nav><ul><li><a href="/a">A</a></li></ul></nav></header>');
  assert.equal(sectionsOf(r.doc)[0], '      <p><a href="/"><img src="/media/logo.svg" alt="Example"></a></p>');
  assert.equal(sectionsOf(r.doc)[2], '      <p><a href="/stores">Find a store</a></p>');
  assert.deepEqual(r.counts, { brand: 1, links: 1, tools: 1, skipped: 0 });
  const brandOf = (h) => sectionsOf(buildNav(`<header>${h}</header>`).doc)[0];
  assert.equal(brandOf('<a href="/stores"><svg></svg>Stores</a><a href="/start"><img src="/m.svg" alt="Example logo"></a>'), '      <p><a href="/start"><img src="/m.svg" alt="Example logo"></a></p>');
  assert.equal(brandOf('<a href="/stores"><svg></svg>Stores</a><a class="brand-name" href="/start">Example</a><a href="/">Home</a>'), '      <p><a href="/start">Example</a></p>');
  assert.equal(brandOf('<a href="/stores"><svg></svg>Stores</a><a href="/">Home</a>'), '      <p><a href="/">Home</a></p>');
  assert.equal(brandOf('<a href="/about">About</a><a href="/stores"><svg></svg>Stores</a>'), '      <p><a href="/stores">Stores</a></p>');
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
