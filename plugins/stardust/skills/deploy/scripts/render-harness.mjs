/**
 * render-harness.mjs — reproduce EDS block decoration locally (no DA / dev-server).
 *
 * Injects styles.css + each block's CSS, runs every block's decorate() over the authored
 * content, and screenshots — so first-pass conversion fidelity is verifiable even when
 * DA_TOKEN is expired (fidelity is decided at conversion time, not deploy time).
 *
 * Usage:
 *   node render-harness.mjs <content/path.html> <out.png> <block-name> [block-name ...]
 */
import { chromium } from 'playwright';
import fs from 'fs';
const contentPath = process.argv[2], out = process.argv[3];
const blocks = process.argv.slice(4);
const raw = fs.readFileSync(contentPath, 'utf8');
const main = raw.match(/<main>([\s\S]*?)<\/main>/)[1]
  .replace(/<div class="metadata">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, ''); // drop metadata block
const styles = fs.readFileSync('eds/styles/styles.css', 'utf8');
const blockCss = blocks.map((n) => { try { return fs.readFileSync(`eds/blocks/${n}/${n}.css`, 'utf8'); } catch { return ''; } }).join('\n');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main .section{padding:0}${styles}\n${blockCss}</style></head><body><main>${main}</main></body></html>`, { waitUntil: 'networkidle' });
for (const name of blocks) {
  const js = fs.readFileSync(`eds/blocks/${name}/${name}.js`, 'utf8').replace(/export default\s+/, '');
  await p.addScriptTag({ content: `window.__b=window.__b||{};window.__b[${JSON.stringify(name)}]=(function(){${js}\nreturn decorate;})();` });
}
await p.evaluate((names) => {
  names.forEach((n) => document.querySelectorAll('.' + n).forEach((el) => { try { window.__b[n](el); } catch (e) { el.setAttribute('data-err', e.message); } }));
}, blocks);
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: true });
const errs = await p.evaluate(() => [...document.querySelectorAll('[data-err]')].map((e) => e.className + ': ' + e.getAttribute('data-err')));
console.log('rendered', out, '| block errors:', JSON.stringify(errs));
await b.close();
