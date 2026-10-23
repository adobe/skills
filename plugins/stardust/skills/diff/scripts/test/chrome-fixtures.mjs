// Fixture headers for the chrome-explore / chrome-compare tests (browser, no network).
// RICH = what field sources ship: a hover mega menu with tabs, a click dropdown (Escape + outside close,
// focus return), a search overlay with typeahead, a cart drawer, and at mobile a hamburger drawer with
// scroll lock and drill-down levels, all animated. STOCK = what a run ships when it keeps the boilerplate
// header: one-level click dropdowns, search and cart as plain links, a hamburger list without motion.
import { createServer } from 'node:http';

const css = `body{margin:0;font:16px/1.4 sans-serif} main{height:2600px;padding:40px} footer{height:200px}
header{position:sticky;top:0;background:#123;color:#fff;z-index:10} header a,header button{color:inherit;font:inherit}
.bar{display:flex;align-items:center;gap:24px;height:72px;padding:0 32px} .bar>nav>ul{display:flex;gap:24px;list-style:none;margin:0;padding:0}
.bar button{background:none;border:0;cursor:pointer;padding:8px} .grow{flex:1}`;

const columns = (prefix, n) => Array.from({ length: n }, (_, i) => `<li><a href="/${prefix}/${i}">${prefix} item ${i}</a></li>`).join('');

const RICH_BODY = `<header><div class="bar">
<a href="/" class="logo">Brand</a>
<nav class="desk"><ul>
 <li class="mm"><a href="/shop" aria-haspopup="true">Shop</a>
  <div class="mega" role="region" aria-label="Shop menu">
   <div role="tablist"><button role="tab" class="tab on" data-p="men" aria-selected="true">Men</button><button role="tab" class="tab" data-p="women" aria-selected="false">Women</button></div>
   <div class="pane on" id="men"><h3>Men</h3><ul>${columns('men', 6)}</ul></div>
   <div class="pane" id="women"><h3>Women</h3><ul>${columns('women', 6)}</ul></div>
   <a class="promo" href="/sale"><img alt="Sale" width="160" height="90" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='%23c33'/%3E%3C/svg%3E">Sale</a>
  </div></li>
 <li class="dd"><button aria-expanded="false" aria-controls="about-list">About</button>
  <ul id="about-list" hidden><li><a href="/about/mission">Mission</a></li><li><a href="/about/history">History</a></li><li><a href="/about/team">Team</a></li></ul></li>
 <li><a href="/contact">Contact</a></li>
</ul></nav>
<span class="grow"></span>
<button class="search-btn" aria-label="Search" aria-expanded="false">⌕</button>
<button class="cart-btn" aria-label="Cart" aria-expanded="false">Bag</button>
<button class="burger" aria-label="Open menu" aria-expanded="false">☰</button>
</div>
<div class="search-ov" hidden><form action="/search"><input type="search" name="q" aria-label="Search the site" autocomplete="off"><ul role="listbox" class="sugg"></ul></form></div>
<aside class="cart" aria-label="Your bag"><h2>Your bag</h2><p>Your bag is empty.</p><a href="/checkout">Checkout</a><button class="cart-close" aria-label="Close bag">×</button></aside>
<div class="drawer" aria-label="Menu"><div class="lvl l0 on"><button class="drill" data-to="l-shop">Shop</button><button class="drill" data-to="l-about">About</button><a href="/contact">Contact</a></div>
 <div class="lvl" id="l-shop"><button class="back">Back</button><h3>Shop</h3><ul>${columns('men', 4)}</ul></div>
 <div class="lvl" id="l-about"><button class="back">Back</button><h3>About</h3><ul><li><a href="/about/mission">Mission</a></li><li><a href="/about/history">History</a></li></ul></div></div>
</header>`;

const RICH_CSS = `${css}
.mm{position:relative} .mega{position:absolute;left:0;top:100%;width:640px;background:#fff;color:#123;padding:24px;display:grid;grid-template-columns:1fr 1fr 180px;gap:16px;
 opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .2s ease,transform .2s ease,visibility 0s .2s}
.mm:hover .mega,.mm.open .mega{opacity:1;visibility:visible;transform:none;transition:opacity .2s ease,transform .2s ease,visibility 0s}
.mega [role=tablist]{grid-column:1/-1} .pane{display:none} .pane.on{display:block} .tab.on{font-weight:bold}
.dd{position:relative} #about-list{position:absolute;top:100%;left:0;background:#fff;color:#123;list-style:none;padding:12px;margin:0;width:180px}
.search-ov{position:absolute;left:0;right:0;top:72px;background:#fff;padding:16px;color:#123} .sugg{list-style:none;padding:0}
.cart{position:fixed;top:0;right:0;width:320px;height:100vh;background:#fff;color:#123;padding:24px;transform:translateX(100%);visibility:hidden;transition:transform .3s ease-out,visibility 0s .3s}
.cart.open{transform:none;visibility:visible;transition:transform .3s ease-out,visibility 0s}
.burger{display:none} .drawer{display:none}
@media (max-width:767px){ .desk{display:none} .burger{display:block}
 .drawer{display:block;position:fixed;top:72px;left:0;right:0;bottom:0;background:#fff;color:#123;transform:translateX(-100%);visibility:hidden;transition:transform .3s ease,visibility 0s .3s}
 .drawer.open{transform:none;visibility:visible;transition:transform .3s ease,visibility 0s}
 .lvl{display:none;padding:16px} .lvl.on{display:block} .lvl button,.lvl a{display:block;padding:12px 0}
 html.lock{overflow:hidden} }`;

const RICH_JS = `
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mm = $('.mm'); const shop = $('.mm > a');
shop.addEventListener('click', (e) => { e.preventDefault(); mm.classList.toggle('open'); });
shop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); mm.classList.add('open'); $('.tab', mm).focus(); } });
$$('.tab').forEach((t) => { const go = () => { $$('.tab').forEach((x) => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', String(x === t)); }); $$('.pane').forEach((p) => p.classList.toggle('on', p.id === t.dataset.p)); }; t.addEventListener('mouseenter', go); t.addEventListener('click', go); });
const ddBtn = $('.dd > button'); const ddList = $('#about-list');
const setDd = (o) => { ddBtn.setAttribute('aria-expanded', String(o)); ddList.hidden = !o; };
ddBtn.addEventListener('click', () => setDd(ddList.hidden));
const sBtn = $('.search-btn'); const ov = $('.search-ov'); const inp = $('.search-ov input'); const sug = $('.sugg');
const setS = (o) => { sBtn.setAttribute('aria-expanded', String(o)); ov.hidden = !o; if (o) inp.focus(); };
sBtn.addEventListener('click', () => setS(ov.hidden));
inp.addEventListener('input', () => { sug.innerHTML = inp.value.length < 2 ? '' : [1, 2, 3].map((i) => '<li role="option"><a href="/search?q=' + encodeURIComponent(inp.value) + '&s=' + i + '">' + inp.value + ' result ' + i + '</a></li>').join(''); });
const cBtn = $('.cart-btn'); const cart = $('.cart');
const setC = (o) => { cBtn.setAttribute('aria-expanded', String(o)); cart.classList.toggle('open', o); if (o) $('.cart-close').focus(); };
cBtn.addEventListener('click', () => setC(!cart.classList.contains('open')));
$('.cart-close').addEventListener('click', () => { setC(false); cBtn.focus(); });
const burger = $('.burger'); const drawer = $('.drawer');
const setB = (o) => { burger.setAttribute('aria-expanded', String(o)); drawer.classList.toggle('open', o); document.documentElement.classList.toggle('lock', o); if (!o) { $$('.lvl').forEach((l) => l.classList.toggle('on', l.classList.contains('l0'))); } };
burger.addEventListener('click', () => setB(!drawer.classList.contains('open')));
$$('.drill').forEach((b) => b.addEventListener('click', () => { $$('.lvl').forEach((l) => l.classList.toggle('on', l.id === b.dataset.to)); }));
$$('.back').forEach((b) => b.addEventListener('click', () => { $$('.lvl').forEach((l) => l.classList.toggle('on', l.classList.contains('l0'))); }));
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return;
  if (!ddList.hidden) { setDd(false); ddBtn.focus(); } if (!ov.hidden) { setS(false); sBtn.focus(); } if (cart.classList.contains('open')) { setC(false); cBtn.focus(); }
  if (drawer.classList.contains('open')) { setB(false); burger.focus(); } mm.classList.remove('open'); });
document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) setDd(false); if (!e.target.closest('.search-ov,.search-btn')) setS(false); if (!e.target.closest('.cart,.cart-btn')) setC(false); if (!e.target.closest('.mm')) mm.classList.remove('open'); });
`;

const STOCK_BODY = `<header><div class="bar">
<a href="/" class="logo">Brand</a>
<nav class="desk"><ul>
 <li class="dd"><button aria-expanded="false">Shop</button><ul class="sub" hidden><li><a href="/men/0">men item 0</a></li><li><a href="/women/0">women item 0</a></li></ul></li>
 <li class="dd"><button aria-expanded="false">About</button><ul class="sub" hidden><li><a href="/about/mission">Mission</a></li><li><a href="/about/history">History</a></li><li><a href="/about/team">Team</a></li></ul></li>
 <li><a href="/contact">Contact</a></li>
</ul></nav>
<span class="grow"></span>
<a href="/search" aria-label="Search">⌕</a>
<a href="/cart" aria-label="Cart">Bag</a>
<button class="burger" aria-label="Open menu" aria-expanded="false">☰</button>
</div>
<ul class="mobile-list" hidden><li><a href="/shop">Shop</a></li><li><a href="/about">About</a></li><li><a href="/contact">Contact</a></li></ul>
</header>`;

const STOCK_CSS = `${css} .dd{position:relative} .sub{position:absolute;top:100%;left:0;background:#fff;color:#123;list-style:none;padding:12px;margin:0;width:180px}
.burger{display:none} @media (max-width:767px){ .desk{display:none} .burger{display:block} .mobile-list{background:#fff;color:#123;margin:0;padding:16px;list-style:none} }`;

const STOCK_JS = `
document.querySelectorAll('.dd > button').forEach((b) => b.addEventListener('click', () => {
  const o = b.getAttribute('aria-expanded') !== 'true';
  document.querySelectorAll('.dd > button').forEach((x) => { x.setAttribute('aria-expanded', 'false'); x.nextElementSibling.hidden = true; });
  b.setAttribute('aria-expanded', String(o)); b.nextElementSibling.hidden = !o; }));
const burger = document.querySelector('.burger'); const list = document.querySelector('.mobile-list');
burger.addEventListener('click', () => { const o = list.hidden; list.hidden = !o; burger.setAttribute('aria-expanded', String(o)); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.dd > button[aria-expanded=true]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); b.nextElementSibling.hidden = true; b.focus(); }); });
`;

const doc = (body, style, js) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>fixture</title><style>${style}</style></head><body>${body}<main><h1>Page</h1><p>Body text.</p></main><footer><a href="/privacy">Privacy</a></footer><script>${js}</script></body></html>`;

export const PAGES = { rich: doc(RICH_BODY, RICH_CSS, RICH_JS), stock: doc(STOCK_BODY, STOCK_CSS, STOCK_JS) };

/** Serve /rich, /rich2 (an identical copy) and /stock; every other path answers 404 text. Resolves { origin, close }. */
export function serve() {
  const srv = createServer((req, res) => {
    const p = req.url.split('?')[0];
    const html = p === '/rich' || p === '/rich2' ? PAGES.rich : p === '/stock' ? PAGES.stock : null;
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }); res.end(html || 'not here');
  });
  return new Promise((resolve) => { srv.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })); });
}
