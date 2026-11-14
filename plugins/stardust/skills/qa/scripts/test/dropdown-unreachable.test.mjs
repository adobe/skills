#!/usr/bin/env node
/**
 * Fixture test for the hover-dropdown reachability probe (browser, no network). Run from a
 * project with playwright installed (resolved via process.cwd() like every qa browser check).
 * GAP = the field defect (`top: calc(100% + 24px)` under `li:hover`); BRIDGE/ROW = the two
 * documented fixes; NOPE = `pointer-events:none` panel; OCCLUDED = open menu, nothing clickable.
 */
import { loadPlaywright } from '../lib.mjs';
import { probeDropdowns } from '../checks/browse.mjs';

const page = (subCss, extra = '', items = 3) => `<!doctype html><html><head><style>
  body{margin:0;font:16px sans-serif}
  header{height:80px;display:flex;align-items:center;background:#123;color:#fff}
  header nav>ul{display:flex;gap:32px;list-style:none;margin:0;padding:0 40px}
  header nav>ul>li{position:relative;padding:8px 0}
  header nav a{color:#fff;text-decoration:none;display:inline-block;padding:4px 0}
  .sub{display:none;position:absolute;left:0;width:220px;background:#fff;color:#123;list-style:none;margin:0;padding:12px 16px;${subCss}}
  .sub a{color:#123;display:block;padding:6px 0}
  header nav>ul>li:hover>.sub{display:block}
  ${extra}
  main{height:1200px}
</style></head><body><header><div class="header block"><nav><ul>
${Array.from({ length: items }, (_, i) => `<li><a href="/s${i}">Section ${i}</a><ul class="sub"><li><a href="/s${i}/a">Child ${i}A</a></li><li><a href="/s${i}/b">Child ${i}B</a></li></ul></li>`).join('')}
<li><a href="/contact">Contact</a></li>
</ul></nav></div></header><main><h1>Body</h1></main></body></html>`;

const FIXTURES = {
  GAP: page('top: calc(100% + 24px);'),
  BRIDGE: page('top: calc(100% + 24px);', '.sub::before{content:"";position:absolute;left:0;right:0;top:-24px;height:24px}'),
  ROW: page('top: 100%;', 'header nav>ul>li{padding:0;height:80px;display:flex;align-items:center}'),
  NOPE: page('top: 100%; pointer-events: none;', 'header nav>ul>li{padding:0;height:80px;display:flex;align-items:center}'),
  OCCLUDED: page('top: 100%;', 'header nav>ul>li{padding:0;height:80px;display:flex;align-items:center} .sub a{pointer-events:none}'),
  PLAIN: page('top:100%;', '', 0),
};

let failed = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed += 1;
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
const results = {};
for (const [name, html] of Object.entries(FIXTURES)) {
  await pg.setContent(html, { waitUntil: 'load' });
  results[name] = await probeDropdowns(pg);
}
await browser.close();

const bad = (r) => r.items.filter((i) => !i.ok);
const r = results;
expect('GAP: 3 probed, Contact skipped, all close in the strip', r.GAP.probed === 3 && r.GAP.skipped === 1 && bad(r.GAP).length === 3 && bad(r.GAP).every((i) => /closed/.test(i.reason) && i.gap >= 24), JSON.stringify(bad(r.GAP)[0]));
expect('BRIDGE: same geometry with ::before bridge is reachable', r.BRIDGE.probed === 3 && bad(r.BRIDGE).length === 0, JSON.stringify(bad(r.BRIDGE)));
expect('ROW: li spanning the nav row is reachable', r.ROW.probed === 3 && bad(r.ROW).length === 0, JSON.stringify(bad(r.ROW)));
expect('NOPE: pointer-events:none panel is unreachable', bad(r.NOPE).length === 3, JSON.stringify(bad(r.NOPE)[0]));
expect('OCCLUDED: menu stays open but the sub-link is not under the pointer', bad(r.OCCLUDED).length === 3 && bad(r.OCCLUDED).every((i) => /under the pointer/.test(i.reason)), JSON.stringify(bad(r.OCCLUDED)[0]));
expect('PLAIN: no dropdowns → nothing probed, item skipped', r.PLAIN.probed === 0 && r.PLAIN.skipped === 1, JSON.stringify(r.PLAIN));

console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
