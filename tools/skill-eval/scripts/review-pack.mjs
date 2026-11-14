#!/usr/bin/env node
// Helper on top of the harness (pilot): build a blinded human "review pack" for one eval scenario.
//
// node review-pack.mjs <run-dir> --scenario <name> --out <dir> [--variant compact] [--seed pilot-1] [--block-dir blocks/<name>]
//
// Picks best/median/worst ok attempt per arm (baseline, with-plugin) by total score (tie-break: fewer tokens),
// shuffles them with a fixed seed into R1..R6, renders each agent's block in a real EDS-like page via Playwright
// (375/768/1200 + mutation + variant shots), and writes ONE self-contained HTML page plus key.json (unblinding key,
// never referenced from the HTML).
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateSync, crc32 } from 'node:zlib';

const t0 = Date.now();
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: 'string' },
    out: { type: 'string' },
    variant: { type: 'string' },
    seed: { type: 'string', default: 'pilot-1' },
    'block-dir': { type: 'string' },
    quality: { type: 'string', default: '70' },
  },
});
const runDir = resolve(positionals[0] || '');
if (!positionals[0] || !v.scenario || !v.out) {
  console.error('usage: review-pack.mjs <run-dir> --scenario <name> --out <dir>');
  process.exit(2);
}
const outDir = resolve(v.out);
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------- playwright (no local dep: fall back to the global @playwright/cli install) ----------
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  for (const p of ['playwright', '@playwright/cli/node_modules/playwright', '@playwright/test']) {
    const f = join(root, p, 'index.mjs');
    if (existsSync(f)) return import(f);
  }
  throw new Error('playwright not found (npm i -g @playwright/cli or add playwright locally)');
}

// ---------- inputs ----------
const results = JSON.parse(readFileSync(join(runDir, 'results.json'), 'utf8'));
const runId = basename(runDir);
const all = (results.attempts || []).filter((a) => a.scenario === v.scenario);
if (!all.length) throw new Error(`no attempts for scenario ${v.scenario}`);
const scenarioDir = join(runDir, all[0].scenarioDir || '');
const taskPath = existsSync(join(scenarioDir, 'task.md')) ? join(scenarioDir, 'task.md') : null;
if (!taskPath) throw new Error(`task.md not found under ${scenarioDir}`);
const taskMd = readFileSync(taskPath, 'utf8');
const htmlBlock = taskMd.match(/```html\n([\s\S]*?)```/);
if (!htmlBlock) throw new Error('no ```html block (sample markup) in task.md');
const sampleMarkup = htmlBlock[1].trim();
const blockName = (sampleMarkup.match(/class="([a-z0-9-]+)/) || [])[1];
const variant = v.variant ?? (taskMd.match(/`([a-z0-9-]+)`\s+(?:option|variant)/i) || [])[1] ?? null;
const blockDir = v['block-dir'] || `blocks/${blockName}/`;
log(`scenario=${v.scenario} block=${blockName} variant=${variant} attempts=${all.length}`);

// ---------- selection ----------
const total = (a) => a.score?.total ?? -1;
const toks = (a) => a.tokens?.total ?? Infinity;
const picks = [];
for (const arm of ['baseline', 'with-plugin']) {
  const ok = all.filter((a) => a.variant === arm && a.status === 'ok')
    .sort((a, b) => total(b) - total(a) || toks(a) - toks(b));
  if (!ok.length) { log(`no ok attempts for ${arm}`); continue; }
  const idx = [...new Set([0, Math.floor((ok.length - 1) / 2), ok.length - 1])];
  const names = ['best', 'median', 'worst'];
  idx.forEach((i, k) => picks.push({ a: ok[i], arm, rank: idx.length === 3 ? names[k] : `#${i + 1}` }));
}
// seeded shuffle (mulberry32 over a string hash)
let h = 1779033703;
for (const c of `${v.seed}:${runId}:${v.scenario}`) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
let s = h >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
picks.forEach((p, i) => { p.label = `R${i + 1}`; });

const packId = `${runId}/${v.scenario}`;
writeFileSync(join(outDir, 'key.json'), `${JSON.stringify({
  pack: packId, scenario: v.scenario, seed: v.seed,
  key: Object.fromEntries(picks.map((p) => [p.label, {
    model: p.a.model, variant: p.a.variant, run: p.a.run, score: total(p.a), tokens: toks(p.a), pick: p.rank,
    activatedSkills: p.a.activatedSkills || [], dir: p.a.dir,
  }])),
}, null, 2)}\n`);
log('picked', picks.map((p) => `${p.label}=${p.a.modelSlug}/${p.a.variant}-${p.a.run}`).join(' '));

// ---------- helpers ----------
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

function serve(root) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = resolve(join(root, p));
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// tiny PNG placeholder: tinted square with a darker inset, so icon layout is visible
function placeholderPng(seedStr, size = 96) {
  let hh = 0; for (const c of seedStr) hh = (hh * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hh % 360; const [r, g, b] = hsl(hue, 0.55, 0.62); const [r2, g2, b2] = hsl(hue, 0.6, 0.38);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inset = x > size * 0.3 && x < size * 0.7 && y > size * 0.3 && y < size * 0.7;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = inset ? r2 : r; raw[o + 1] = inset ? g2 : g; raw[o + 2] = inset ? b2 : b;
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function hsl(hh, ss, l) {
  const k = (n) => (n + hh / 30) % 12; const a = ss * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

// ---------- browser ----------
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();

// Parse the sample markup (authored table model) + build mutated variants, using the browser as DOM parser.
const parsePage = await browser.newPage();
await parsePage.setContent(`<div id="root">${sampleMarkup}</div>`);
const model = await parsePage.evaluate(() => {
  const block = document.querySelector('#root > div');
  const cellModel = (cell) => [...cell.children].map((el) => {
    if (el.matches('picture, img') || (el.matches('p') && el.querySelector('picture, img') && !el.textContent.trim())) {
      const img = el.querySelector('img') || el; return { kind: 'image', alt: img.getAttribute('alt') || '' };
    }
    return { kind: el.tagName.toLowerCase(), html: el.innerHTML.replace(/\s+/g, ' ').trim(), text: el.textContent.trim() };
  }).concat(cell.children.length === 0 && cell.textContent.trim() ? [{ kind: 'text', text: cell.textContent.trim() }] : []);
  const rows = [...block.children].map((row) => [...row.children].map(cellModel));
  return { classes: [...block.classList], rows };
});
const mutations = await parsePage.evaluate(() => {
  const src = document.querySelector('#root > div');
  const cut = src.cloneNode(true);
  [...cut.children].forEach((row) => row.lastElementChild?.remove());
  const long = src.cloneNode(true);
  long.querySelectorAll('p').forEach((p) => {
    // only the paragraph's own text (link texts stay as authored)
    [...p.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()).forEach((n) => { n.data = `${n.data.trim()} `.repeat(10); });
  });
  return { cut: cut.outerHTML, long: long.outerHTML };
});
await parsePage.close();
const mediaNames = [...new Set([...sampleMarkup.matchAll(/\.\/(media_[a-z0-9]+\.[a-z]+)/gi)].map((m) => m[1]))];

const SHOTS = [
  { id: 'w375', title: '375 px', width: 375, page: 'pack' },
  { id: 'w768', title: '768 px', width: 768, page: 'pack' },
  { id: 'w1200', title: '1200 px', width: 1200, page: 'pack' },
  { id: 'cut', title: '1200 px · last cell of every row removed', width: 1200, page: 'pack-cut' },
  { id: 'long', title: '1200 px · every paragraph 10× longer', width: 1200, page: 'pack-long' },
  ...(variant ? [{ id: 'variant', title: `1200 px · variant "${variant}"`, width: 1200, page: 'pack-variant' }] : []),
];

function pageHtml(headHtml, blockHtml) {
  return `<!DOCTYPE html>\n<html>\n<head>\n<title>review pack</title>\n${headHtml}\n</head>\n<body>\n<header></header>\n<main>\n<div>\n${blockHtml}\n</div>\n</main>\n<footer></footer>\n</body>\n</html>\n`;
}

async function shootAttempt(p) {
  const work = join(p.a.dir, 'work');
  const tmp = mkdtempSync(join(tmpdir(), `review-pack-${p.label}-`));
  cpSync(work, tmp, { recursive: true, filter: (f) => !f.split(sep).some((seg) => seg === 'node_modules' || seg === '.git') });
  const head = existsSync(join(tmp, 'head.html')) ? readFileSync(join(tmp, 'head.html'), 'utf8') : '';
  mkdirSync(join(tmp, 'drafts'), { recursive: true });
  const variantHtml = sampleMarkup.replace(`class="${blockName}"`, `class="${blockName} ${variant}"`);
  writeFileSync(join(tmp, 'drafts/pack.html'), pageHtml(head, sampleMarkup));
  writeFileSync(join(tmp, 'drafts/pack-cut.html'), pageHtml(head, mutations.cut));
  writeFileSync(join(tmp, 'drafts/pack-long.html'), pageHtml(head, mutations.long));
  if (variant) writeFileSync(join(tmp, 'drafts/pack-variant.html'), pageHtml(head, variantHtml));
  for (const m of mediaNames) writeFileSync(join(tmp, 'drafts', m), placeholderPng(m));
  // stub nav/footer fragments so header/footer blocks don't 404 into every shot's console log
  writeFileSync(join(tmp, 'nav.plain.html'), '<div><p><a href="/">Brand</a></p></div><div><ul><li><a href="/">Home</a></li></ul></div><div></div>');
  writeFileSync(join(tmp, 'footer.plain.html'), '<div><p>Footer</p></div>');

  const server = await serve(tmp);
  const base = `http://127.0.0.1:${server.address().port}`;
  const shots = [];
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: shot.width, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + (m.location()?.url ? ` (${m.location().url.replace(base, '')})` : '')); });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(base, '')}`); });
    let img = null; let fail = null;
    try {
      await page.goto(`${base}/drafts/${shot.page}.html`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector(`.${blockName}[data-block-status="loaded"]`, { timeout: 10000 })
        .catch(() => errors.push('block never reached data-block-status="loaded" within 10s'));
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const target = (await page.$(`main .section:has(.${blockName})`)) || (await page.$(`.${blockName}`));
      if (!target) throw new Error('block/section element not found');
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => Promise.all([...document.querySelectorAll('main img')].map((i) => (i.complete ? 0 : new Promise((ok) => { i.onload = ok; i.onerror = ok; setTimeout(ok, 3000); })))));
      await page.waitForTimeout(150);
      const box = await target.boundingBox();
      if (!box || box.height < 1) throw new Error('block section has zero height');
      img = await target.screenshot({ type: 'jpeg', quality: Number(v.quality) });
    } catch (e) { fail = e.message.split('\n')[0]; }
    await ctx.close();
    shots.push({ ...shot, data: img ? `data:image/jpeg;base64,${img.toString('base64')}` : null, fail, errors: [...new Set(errors)] });
  }
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  return shots;
}

for (const p of picks) {
  log(`shooting ${p.label}`);
  p.shots = await shootAttempt(p);
}
await browser.close();

// ---------- diff ----------
function readDiff(dir) {
  const diffText = existsSync(join(dir, 'changes.diff')) ? readFileSync(join(dir, 'changes.diff'), 'utf8') : '';
  const cj = existsSync(join(dir, 'changes.json')) ? JSON.parse(readFileSync(join(dir, 'changes.json'), 'utf8')) : { files: [] };
  const parts = {};
  for (const chunk of diffText.split(/^(?=diff --git )/m)) {
    const m = chunk.match(/^diff --git a\/(\S+) b\/(\S+)/); if (!m) continue;
    const lines = chunk.split('\n');
    parts[m[2]] = { text: chunk, add: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, del: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length };
  }
  const files = (cj.files || []).map((f) => ({ ...f, ...(parts[f.path] || { add: '?', del: '?', text: '' }) }));
  for (const [path, d] of Object.entries(parts)) if (!files.find((f) => f.path === path)) files.push({ path, status: '?', ...d });
  return { files, truncated: cj.truncated };
}
const diffHtml = (text) => text.split('\n').map((l) => {
  const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('new file') ? 'dh' : l.startsWith('@@') ? 'dhunk' : l.startsWith('+') ? 'dadd' : l.startsWith('-') ? 'ddel' : '';
  return `<span class="${cls}">${esc(l)}</span>`;
}).join('\n');

// ---------- render ----------
function authoredTable(m, withVariant) {
  const name = blockName.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const cols = Math.max(1, ...m.rows.map((r) => r.length));
  const cellHtml = (cell) => cell.map((it) => {
    if (it.kind === 'image') return `<span class="imgph" title="image">🖼 ${esc(it.alt || 'image')}</span>`;
    if (/^h[1-6]$/.test(it.kind)) return `<div class="ah"><span class="tag">${it.kind.toUpperCase()}</span> ${esc(it.text)}</div>`;
    // keep links visible as links (underlined), everything else as plain text
    const html = it.html ? it.html.replace(/<(?!\/?a\b)[^>]+>/g, '').replace(/<a\b[^>]*>/g, '<u>').replace(/<\/a>/g, '</u>') : esc(it.text);
    return `<div>${html}</div>`;
  }).join('') || '<span class="empty">(empty)</span>';
  return `<table class="authored"><tr><th colspan="${cols}">${esc(name)}${withVariant ? ` (${esc(withVariant)})` : ''}</th></tr>${
    m.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === r.length - 1 && r.length < cols ? ` colspan="${cols - r.length + 1}"` : ''}>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

const fmtMs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`);
// Zoom: the figure itself is the :target (no duplicated image data). Without JS, the thumbnail link sets the hash,
// CSS turns the link into a fixed full-screen overlay, and × jumps to an anchor just above the figure (no page jump).
// With JS, clicks toggle a .open class instead (no hash change), and Escape / any click closes.
const shotFig = (s, L) => { const z = `z-${L}-${s.id}`; return `<span class="zanchor" id="c-${z}"></span><figure class="shot" id="${z}"><figcaption>${esc(s.title)}</figcaption>${
  s.data ? `<a class="zl" href="#${z}" title="Open full size"><img src="${s.data}" alt="${esc(s.title)}" loading="lazy"></a><a class="lbx" href="#c-${z}" aria-label="Close full-size view">×</a>` : `<div class="noshot">screenshot failed: ${esc(s.fail)}</div>`}${
  s.errors.length ? `<details class="errs" open><summary>${s.errors.length} console error${s.errors.length > 1 ? 's' : ''}</summary><ul>${s.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : '<div class="noerr">no console errors</div>'}</figure>`; };

// Diff: only block code and authored content are shown; docs/config (README etc.) could hint at the model, so they
// are hidden and only counted, never named.
const DOC_RE = /(^|\/)(readme|changelog|license|contributing|agents|claude|copilot-instructions)(\.[^/]*)?$/i;
const shownInDiff = (path) => {
  if (DOC_RE.test(path)) return false;
  if (/^blocks\/.+\.(js|css)$/.test(path)) return true;
  if (/\.plain\.html$/.test(path)) return true;
  if (/^(content|drafts)\/.+\.(html|md)$/.test(path)) return true;
  if (/\.html$/.test(path) && !/(^|\/)(head|404)\.html$/.test(path)) return true;
  return false;
};

function card(p) {
  const a = p.a; const sc = a.score || {}; const d = readDiff(a.dir);
  const shownFiles = d.files.filter((f) => shownInDiff(f.path));
  const hidden = d.files.length - shownFiles.length;
  const L = p.label;
  return `<section class="card" id="${L}">
<h2>${L}</h2>
<p class="slot-authored muted">Authored content: same for all runs in this scenario — see <a href="#authored">the table at the top</a>.</p>
<h3>Rendered block</h3>
<div class="row r3">${p.shots.filter((s) => s.page === 'pack').map((s) => shotFig(s, L)).join('')}</div>
<h3>Stress &amp; variant (1200 px)</h3>
<div class="row r3b">${p.shots.filter((s) => s.page !== 'pack').map((s) => shotFig(s, L)).join('')}</div>
<details class="auto"><summary>Automated results — ${esc(sc.total)}/${esc(sc.max)} · ${esc(a.turns)} turns · ${(toks(a) / 1000).toFixed(1)}k tokens · ${fmtMs(a.durationMs || 0)}</summary>
<table class="checks"><tr><th>Check</th><th>Score</th><th>Judge reasoning</th></tr>${
  (sc.checks || []).map((c) => `<tr class="${c.score < c.max ? 'lost' : ''}"><td>${esc(c.name)}</td><td class="num">${esc(c.score)}/${esc(c.max)}</td><td>${esc(c.reasoning)}</td></tr>`).join('')}
<tr class="tot"><td>Total</td><td class="num">${esc(sc.total)}/${esc(sc.max)}</td><td>turns ${esc(a.turns)} · tokens ${esc(toks(a))} · duration ${fmtMs(a.durationMs || 0)}</td></tr></table></details>
<details class="diff"><summary>Diff — ${shownFiles.length} block/content file${shownFiles.length === 1 ? '' : 's'}${hidden ? ` (+${hidden} other file${hidden === 1 ? '' : 's'} hidden)` : ''}</summary>
<ul class="files">${shownFiles.map((f) => `<li><code>${esc(f.status)} ${esc(f.path)}</code> <span class="dadd">+${esc(f.add)}</span> <span class="ddel">−${esc(f.del)}</span></li>`).join('')}${hidden ? `<li class="muted">+${hidden} other file${hidden === 1 ? '' : 's'} hidden (docs/config/assets)</li>` : ''}</ul>${d.truncated ? '<p class="muted">(diff truncated by harness)</p>' : ''}
${shownFiles.map((f) => `<pre class="diffpre">${diffHtml(f.text)}</pre>`).join('')}</details>
<form class="rate" data-label="${L}" onsubmit="return false">
<fieldset><legend>Author-friendliness</legend>${[1, 2, 3, 4, 5].map((n) => `<label class="pill"><input type="radio" name="author-${L}" value="${n}"><span>${n}</span></label>`).join('')}<span class="hint">1 = authors will fight it · 5 = just works</span></fieldset>
<fieldset><legend>Would merge?</legend><label class="pill"><input type="radio" name="merge-${L}" value="yes"><span>yes</span></label><label class="pill"><input type="radio" name="merge-${L}" value="no"><span>no</span></label></fieldset>
<label class="note">Note <input type="text" name="note-${L}" maxlength="300" placeholder="one line: what decided it?"></label>
</form>
</section>`;
}

const css = `
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d1d1f;background:#f3f4f6}
.wrap{max-width:1680px;margin:0 auto;padding:24px}
header.top{background:#fff;border:1px solid #ddd;border-radius:12px;padding:20px 24px;margin-bottom:24px}
header.top h1{margin:0 0 6px;font-size:22px}.muted{color:#6b7280}
.card{scroll-margin-top:48px;background:#fff;border:1px solid #ddd;border-radius:12px;padding:16px 24px 20px;margin:0 0 28px}
.card h2{margin:0 0 4px;font-size:28px}.card h3,header.top h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:16px 0 8px}
.row{display:grid;gap:14px;align-items:start}.r3{grid-template-columns:375fr 768fr 1200fr}.r3b{grid-template-columns:repeat(3,1fr)}
@media (max-width:1100px){.r3,.r3b{grid-template-columns:1fr}}
.shot{margin:0;border:1px solid #e5e7eb;border-radius:8px;padding:6px;background:#fafafa;min-width:0}
.shot figcaption{font-size:12px;color:#374151;font-weight:600;margin-bottom:4px}
.shot img{display:block;max-width:100%;height:auto;max-height:640px;object-fit:contain;object-position:top left;border:1px solid #eee;background:#fff;cursor:zoom-in}
.zl{display:block}.lbx,.zanchor{display:none}.zanchor{scroll-margin-top:60px}
.shot:target .zl,.shot.open .zl{position:fixed;inset:0;z-index:100;background:rgba(17,24,39,.92);overflow:auto;padding:48px 24px;cursor:zoom-out}
.shot:target .zl img,.shot.open .zl img{max-width:none;max-height:none;margin:0 auto;cursor:zoom-out;box-shadow:0 4px 24px rgba(0,0,0,.5)}
.shot:target .lbx,.shot.open .lbx{display:block;position:fixed;top:8px;right:16px;z-index:101;color:#fff;font-size:32px;line-height:1;text-decoration:none;padding:4px 10px;border-radius:6px;background:rgba(0,0,0,.4)}
.noshot{padding:30px;color:#b91c1c;background:#fef2f2}.noerr{font-size:12px;color:#15803d;margin-top:4px}
.errs{font-size:12px;color:#b91c1c;margin-top:4px}.errs ul{margin:4px 0;padding-left:18px;word-break:break-all}
details.auto,details.diff{margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px}
details>summary{cursor:pointer;font-weight:600}
table.checks{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}table.checks td,table.checks th{border-bottom:1px solid #eee;padding:5px 8px;text-align:left;vertical-align:top}
table.checks .num{white-space:nowrap;font-variant-numeric:tabular-nums}tr.lost td{background:#fff7ed}tr.tot td{font-weight:600}
ul.files{margin:8px 0;padding-left:18px;font-size:13px}
pre.diffpre{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fbfbfb;border:1px solid #eee;padding:8px;overflow:auto;max-height:520px}
.dadd{color:#166534}.ddel{color:#b91c1c}.dh{color:#6b7280;font-weight:600}.dhunk{color:#7c3aed}
pre .dadd{background:#f0fdf4;display:inline-block;width:100%}pre .ddel{background:#fef2f2;display:inline-block;width:100%}
table.authored{border-collapse:collapse;min-width:520px;font-size:14px;background:#fff}
table.authored th,table.authored td{border:1px solid #9ca3af;padding:8px 10px;vertical-align:top;text-align:left}
table.authored th{background:#e5e7eb;font-weight:600}
.imgph{display:inline-block;padding:14px 12px;background:#eef2ff;border:1px dashed #818cf8;border-radius:4px;font-size:12px;color:#3730a3}
.ah{font-weight:700}.tag{font-size:10px;font-weight:600;color:#6b7280;border:1px solid #d1d5db;border-radius:3px;padding:0 3px;vertical-align:middle}
.empty{color:#9ca3af;font-style:italic}
form.rate{margin-top:14px;padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #cbd5e1;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}
form.rate fieldset{border:0;margin:0;padding:0;display:flex;gap:6px;align-items:center}form.rate legend{float:left;margin-right:8px;font-weight:600;font-size:13px}
.pill input{position:absolute;opacity:0}.pill span{display:inline-block;min-width:34px;text-align:center;padding:4px 10px;border:1px solid #94a3b8;border-radius:16px;background:#fff;cursor:pointer}
.pill input:checked+span{background:#1d4ed8;color:#fff;border-color:#1d4ed8}.pill input:focus-visible+span{outline:2px solid #1d4ed8}
.hint{font-size:12px;color:#6b7280;margin-left:6px}.note{flex:1 1 360px;display:flex;gap:8px;align-items:center;font-weight:600;font-size:13px}.note input{flex:1;padding:5px 8px;border:1px solid #94a3b8;border-radius:6px;font:inherit}
.bar{position:sticky;top:0;z-index:5;background:#1f2937;color:#fff;padding:8px 24px;display:flex;gap:16px;align-items:center;font-size:13px}
.bar a{color:#cbd5e1;text-decoration:none}.bar button{margin-left:auto;padding:6px 12px;border-radius:6px;border:0;background:#22c55e;color:#062b12;font-weight:700;cursor:pointer}
.bar .done{color:#86efac}
`;

const js = `
(function(){var PACK=${JSON.stringify(packId)},SCEN=${JSON.stringify(v.scenario)};
function key(l){return 'review-pack:'+PACK+':'+l}
function read(f){var l=f.dataset.label,o={author:null,merge:null,note:''};var a=f.querySelector('input[name="author-'+l+'"]:checked');if(a)o.author=+a.value;var m=f.querySelector('input[name="merge-'+l+'"]:checked');if(m)o.merge=m.value==='yes';o.note=f.querySelector('input[name="note-'+l+'"]').value;return o}
function progress(){var forms=document.querySelectorAll('form.rate'),n=0;forms.forEach(function(f){var o=read(f);var done=o.author&&o.merge!==null;if(done)n++;var a=document.querySelector('.bar a[href="#'+f.dataset.label+'"]');if(a)a.className=done?'done':''});document.getElementById('prog').textContent=n+'/'+forms.length+' rated'}
document.querySelectorAll('form.rate').forEach(function(f){var l=f.dataset.label;try{var s=JSON.parse(localStorage.getItem(key(l))||'null');if(s){if(s.author){var r=f.querySelector('input[name="author-'+l+'"][value="'+s.author+'"]');if(r)r.checked=true}if(s.merge!==null&&s.merge!==undefined){var m=f.querySelector('input[name="merge-'+l+'"][value="'+(s.merge?'yes':'no')+'"]');if(m)m.checked=true}f.querySelector('input[name="note-'+l+'"]').value=s.note||''}}catch(e){}
f.addEventListener('input',function(){try{localStorage.setItem(key(l),JSON.stringify(read(f)))}catch(e){}progress()})});
document.getElementById('export').addEventListener('click',function(){var r={};document.querySelectorAll('form.rate').forEach(function(f){r[f.dataset.label]=read(f)});var b=new Blob([JSON.stringify({pack:PACK,scenario:SCEN,exportedAt:new Date().toISOString(),ratings:r},null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='ratings-'+SCEN+'.json';document.body.appendChild(a);a.click();a.remove()});
function closeZoom(){document.querySelectorAll('.shot.open').forEach(function(f){f.classList.remove('open')});if(location.hash.indexOf('#z-')===0)history.replaceState(null,'',location.pathname+location.search)}
document.querySelectorAll('.shot .zl').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var f=a.parentNode;var was=f.classList.contains('open')||f.matches(':target');closeZoom();if(!was)f.classList.add('open')})});
document.querySelectorAll('.shot .lbx').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();closeZoom()})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeZoom()});
document.getElementById('export').hidden=false;progress()})();
`;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review pack · ${esc(v.scenario)}</title><style>${css}</style></head>
<body>
<nav class="bar"><strong>${esc(v.scenario)}</strong>${picks.map((p) => `<a href="#${p.label}">${p.label}</a>`).join('')}<span id="prog"></span><button id="export" type="button" hidden>Export ratings JSON</button></nav>
<div class="wrap">
<header class="top">
<h1>Review pack: <code>${esc(v.scenario)}</code></h1>
<p>${picks.length} blinded agent runs of the same task (labels are shuffled; model and setup are hidden). <strong>Target: ~15 minutes total, ~2 minutes per run.</strong></p>
<p>For each run, look at the rendered block (phone / tablet / desktop), how it copes when an author leaves a cell out or writes long text, and the <code>${esc(variant || '')}</code> variant. Then rate:
<b>Author-friendliness 1–5</b> — would an author typing the table below get what they expect, without surprises when content varies?
<b>Would merge</b> — would you accept this block into a project as is? Add a one-line note on what decided it.
Automated scores and the diff are collapsed under each run; open them only if you need them.</p>
<p class="muted">Ratings are saved in this browser (localStorage) and exported with the green button. If scripts are disabled in your viewer, write the label + ratings down by hand. Screenshots: real page with the project's <code>head.html</code>, <code>aem.js</code>, <code>scripts.js</code> and global styles; icons are local placeholder images; click a screenshot to open it full size (× / Esc / click to close).</p>
<noscript><p><b>Scripts are disabled:</b> the form below can't be saved or exported — note ratings by label (R1…R${picks.length}).</p></noscript>
<details><summary>Task given to the agents</summary><pre class="diffpre">${esc(taskMd)}</pre></details>
<h3 id="authored">Authored content (as the author sees it in Word / Google Docs) — identical for all runs</h3>
${authoredTable(model, null)}
${variant ? `<p class="muted">Variant shot uses the same table with the header <b>${esc(blockName.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))} (${esc(variant)})</b>. Stress shots: same table with the last cell of each row deleted, and with every paragraph repeated 10×.</p>` : ''}
</header>
${picks.map(card).join('\n')}
</div>
<script>${js}</script>
</body></html>
`;
const outFile = join(outDir, `${v.scenario}.html`);
writeFileSync(outFile, html);
const report = {
  html: outFile, bytes: Buffer.byteLength(html), seconds: (Date.now() - t0) / 1000,
  picks: picks.map((p) => `${p.label}: ${p.a.model} ${p.a.variant}-${p.a.run} score=${total(p.a)} tokens=${toks(p.a)} (${p.arm} ${p.rank})`),
  shotIssues: picks.flatMap((p) => p.shots.filter((s) => s.fail || s.errors.length).map((s) => `${p.label} ${s.id}: ${s.fail ? `FAILED ${s.fail}; ` : ''}${s.errors.join(' | ')}`)),
};
console.log(JSON.stringify(report, null, 2));
