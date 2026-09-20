#!/usr/bin/env node
/**
 * skills/deploy/scripts/host-compare.mjs — byte parity of two EDS hosts after a project move (step 5).
 * Contract: reference/project-move.md § Steps. The truth is the OLD live tree; the copy is checked on the
 * new PREVIEW host (`.aem.page`) before any publish (D1/D16). Not a gate: no threshold is judged — a row is
 * identical, benign (`media-only`), or not.
 *
 *   node skills/deploy/scripts/host-compare.mjs --old https://main--<old>--<org>.aem.live
 *        --new https://main--<new>--<org>.aem.page --paths <file|/a,/b,…> [--sitemap]
 *        [--render] [--width 1440] [--concurrency 4] [--timeout 120] [--json] [--help]
 *
 *   --paths       roster file (one web path per line, `#` comments) or a comma-separated list; a `.json` path is a sheet
 *   --sitemap     also compare /sitemap.xml: counts, `only-on-old` (stale fragments to retire) and `only-on-new` lists
 *   --render      Playwright (resolution chain): per path load both pages and compare the rendered shape — block names
 *                 with `data-block-status`, the h1, section count, document height (±8 px)
 *   --width       render viewport width (default 1440)
 *   --timeout     whole-run cap in seconds (default 120) over EVERY phase — fetch, sitemap, render (a render load is
 *                 bound to the remaining budget): on expiry the run prints `no verdict` and exits 124
 *
 * Per path, both `.plain.html` bodies (sheets: the JSON) are normalised before the compare:
 *   host      `<ref>--<site>--<org>.aem.page|live` → HOST · `content.da.live/<org>/<site>/` → `content.da.live/ORG/SITE/`
 *   media     `media_<40+ hex>.<ext>` → `media_HASH` (an upstream re-encode changes hash AND extension — benign)
 * Classes:  identical · media-only (differs before, identical after the media normaliser — benign, listed) ·
 *           differs (FAIL — re-copy the path once, then report; never hand-patch the target) · missing (new host
 *           not 200 — FAIL) · stale-on-old (old not 200, new 200 — reported, not a failure) · unreachable (network).
 *           --render adds render-equal / render-differs (FAIL) / unreachable (a load that failed — 124, not a FAIL).
 * Last stdout line:
 *   SUMMARY host-compare paths=<n> identical=<n> media-only=<n> differs=<n> missing=<n> stale-on-old=<n> unreachable=<n> exit=<code>
 *
 * Exit codes:
 *   0    PASS — no differs / missing / render-differs          1  FAIL — at least one such row (listed)
 *   2    usage (bad origin, empty roster, Playwright unresolvable); an origin may carry a base path (mock hosts)
 *   124  no verdict — the --timeout cap expired (in any phase) or a row was unreachable and nothing FAILed (re-run, never a FAIL)
 * Never: writes, publishes, touches the customer site (the two EDS origins only), sends a token.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDep, exit2 } from '../../stardust/scripts/lib/resolve.mjs';

const FAIL = new Set(['differs', 'missing', 'render-differs']);

export function parseArgs(argv) {
  const a = { old: '', new: '', paths: null, sitemap: false, render: false, width: 1440, concurrency: 4, timeout: 120, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const need = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    const int = (min) => { const n = Number(need()); if (!Number.isInteger(n) || n < min) throw new Error(`${k} needs an integer ≥ ${min}`); return n; };
    if (k === '--old') a.old = need().replace(/\/+$/, '');
    else if (k === '--new') a.new = need().replace(/\/+$/, '');
    else if (k === '--paths') a.paths = need();
    else if (k === '--sitemap') a.sitemap = true;
    else if (k === '--render') a.render = true;
    else if (k === '--width') a.width = int(320);
    else if (k === '--concurrency') a.concurrency = int(1);
    else if (k === '--timeout') a.timeout = int(1);
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (a.help) return a;
  for (const k of ['old', 'new']) if (!/^https?:\/\/[^\s?#]+$/.test(a[k])) throw new Error(`--${k} must be an origin (https://host[/base])`);
  if (!a.paths) throw new Error('--paths is required (roster file or comma list)');
  return a;
}

/** Roster: a file of web paths (one per line, # comments) or a comma-separated list; `/` kept, `.html` folded. */
export function readPaths(spec) {
  const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } }; // `/` is a path, not a roster file
  const raw = isFile(spec) ? readFileSync(spec, 'utf8').split(/\r?\n/) : spec.split(',');
  const out = raw.map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).map((p) => { let x = p.startsWith('/') ? p : `/${p}`; if (!x.endsWith('.json')) x = x.replace(/\.html$/, '').replace(/\/index$/, '/'); return x; });
  return [...new Set(out)];
}

export const normaliseHost = (s) => s
  .replace(/https?:\/\/[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.aem\.(?:page|live)/gi, 'https://HOST')
  .replace(/\b[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.aem\.(?:page|live)\b/gi, 'HOST')
  .replace(/content\.da\.live\/[a-z0-9-]+\/[a-z0-9-]+\//gi, 'content.da.live/ORG/SITE/');
export const normaliseMedia = (s) => s.replace(/media_[0-9a-f]{40,}(?:\.[a-z0-9]+)?/gi, 'media_HASH');

/** Classify one pair of fetch results — pure, so the fixture test pins it without a server. */
export function classify(oldRes, newRes) {
  if (oldRes.status === 0 || newRes.status === 0) return { cls: 'unreachable', note: oldRes.error || newRes.error || '' };
  if (newRes.status !== 200) return { cls: 'missing', note: `new ${newRes.status}` };
  if (oldRes.status !== 200) return { cls: 'stale-on-old', note: `old ${oldRes.status}` };
  const a = normaliseHost(oldRes.body); const b = normaliseHost(newRes.body);
  if (a === b) return { cls: 'identical', note: '' };
  if (normaliseMedia(a) === normaliseMedia(b)) return { cls: 'media-only', note: 'media hash/extension differ (upstream re-encode)' };
  const i = [...a].findIndex((c, k) => c !== b[k]);
  return { cls: 'differs', note: `first difference at byte ${i}: …${a.slice(Math.max(0, i - 20), i + 30).replace(/\s+/g, ' ')}…` };
}

const plainUrl = (origin, p) => (p.endsWith('.json') ? `${origin}${p}` : `${origin}${p.endsWith('/') ? `${p}index` : p}.plain.html`);

async function get(url, signal) {
  try {
    const res = await fetch(url, { signal, redirect: 'manual', headers: { 'user-agent': 'stardust host-compare' } });
    return { status: res.status, body: res.status === 200 ? await res.text() : '' };
  } catch (e) { return { status: 0, body: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) }; }
}

const sitemapPaths = (xml, origin) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => { try { const u = new URL(m[1]); return u.pathname; } catch { return m[1].replace(origin, ''); } }).sort();

async function renderShape(browser, url, width, deadlineAt) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: Math.min(45000, Math.max(250, deadlineAt - Date.now())) }); // never past the run cap
    await page.waitForTimeout(600);
    return await page.evaluate(() => ({
      blocks: [...document.querySelectorAll('main .block')].map((b) => `${b.dataset.blockName || b.className.split(' ')[0]}:${b.dataset.blockStatus || '-'}`),
      h1: (document.querySelector('h1') || {}).textContent?.trim() || '',
      sections: document.querySelectorAll('main > .section, main > div').length,
      height: document.documentElement.scrollHeight,
    }));
  } finally { await page.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`host-compare: ${e.message}`); return 2; }
  if (a.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim()); return 0; }
  const paths = readPaths(a.paths);
  if (!paths.length) { console.error('host-compare: the roster is empty'); return 2; }
  const ac = new AbortController();
  const deadlineAt = Date.now() + a.timeout * 1000;
  const deadline = setTimeout(() => ac.abort(), a.timeout * 1000);
  const rows = [];
  const counts = { identical: 0, 'media-only': 0, differs: 0, missing: 0, 'stale-on-old': 0, unreachable: 0, 'render-equal': 0, 'render-differs': 0 };
  const summary = (code) => `SUMMARY host-compare paths=${paths.length} identical=${counts.identical} media-only=${counts['media-only']} differs=${counts.differs} missing=${counts.missing} stale-on-old=${counts['stale-on-old']} unreachable=${counts.unreachable}${a.render ? ` render-equal=${counts['render-equal']} render-differs=${counts['render-differs']}` : ''} exit=${code}`;
  console.log(`host-compare old=${a.old} (truth) new=${a.new} · ${paths.length} paths${a.sitemap ? ' · sitemap' : ''}${a.render ? ` · render @${a.width}` : ''}`);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(a.concurrency, paths.length) }, async () => {
    for (;;) {
      const k = i; i += 1; if (k >= paths.length || ac.signal.aborted) return;
      const p = paths[k];
      const [o, n] = await Promise.all([get(plainUrl(a.old, p), ac.signal), get(plainUrl(a.new, p), ac.signal)]);
      const c = classify(o, n);
      rows[k] = { path: p, cls: c.cls, old: o.status, new: n.status, note: c.note };
    }
  }));
  let timedOut = ac.signal.aborted; // re-read after every later phase — a cap that expires mid-sitemap or mid-render is still no verdict
  for (const r of rows) { if (!r) continue; counts[r.cls] += 1; console.log(`  ${r.cls.padEnd(13)} ${r.path.padEnd(40)} old=${r.old} new=${r.new}${r.note ? ` ${r.note}` : ''}`); }
  let sitemap = null;
  if (a.sitemap && !timedOut) {
    const [o, n] = await Promise.all([get(`${a.old}/sitemap.xml`, ac.signal), get(`${a.new}/sitemap.xml`, ac.signal)]);
    timedOut = ac.signal.aborted;
    const op = sitemapPaths(o.body, a.old); const np = sitemapPaths(n.body, a.new);
    if (!timedOut) sitemap = { old: { status: o.status, count: op.length }, new: { status: n.status, count: np.length }, onlyOnOld: op.filter((x) => !np.includes(x)), onlyOnNew: np.filter((x) => !op.includes(x)) };
    if (sitemap) console.log(`sitemap old=${o.status}/${op.length} new=${n.status}/${np.length} only-on-old=${sitemap.onlyOnOld.length}${sitemap.onlyOnOld.length ? ` (${sitemap.onlyOnOld.slice(0, 10).join(', ')})` : ''} only-on-new=${sitemap.onlyOnNew.length}${sitemap.onlyOnNew.length ? ` (${sitemap.onlyOnNew.slice(0, 10).join(', ')})` : ''}`);
  }
  if (a.render && !timedOut) {
    const pw = await resolveDep('playwright', { from: import.meta.url, script: 'host-compare.mjs' }).catch(exit2);
    const chromium = pw.chromium || (pw.default && pw.default.chromium);
    const browser = await chromium.launch();
    try {
      for (const r of rows) {
        if (!r || r.path.endsWith('.json')) continue;
        if (ac.signal.aborted) { timedOut = true; break; }
        let so; let sn;
        try { [so, sn] = await Promise.all([renderShape(browser, `${a.old}${r.path}`, a.width, deadlineAt), renderShape(browser, `${a.new}${r.path}`, a.width, deadlineAt)]); } catch (e) {
          if (ac.signal.aborted || Date.now() >= deadlineAt) { timedOut = true; break; } // the cap, not the page
          r.render = 'unreachable'; counts.unreachable += 1; r.renderNote = String(e.message || e).split('\n')[0].slice(0, 120);
          console.log(`  ${r.render.padEnd(13)} ${r.path.padEnd(40)} ${r.renderNote}`); continue;
        }
        const same = so.blocks.join(',') === sn.blocks.join(',') && so.h1 === sn.h1 && so.sections === sn.sections && Math.abs(so.height - sn.height) <= 8;
        r.render = same ? 'render-equal' : 'render-differs'; counts[r.render] += 1;
        r.renderNote = same ? '' : `blocks ${so.blocks.length}/${sn.blocks.length} h1 ${so.h1 === sn.h1 ? 'same' : 'differ'} sections ${so.sections}/${sn.sections} height ${so.height}/${sn.height}`;
        console.log(`  ${r.render.padEnd(13)} ${r.path.padEnd(40)}${r.renderNote ? ` ${r.renderNote}` : ''}`);
      }
    } finally { await browser.close(); }
    timedOut = timedOut || ac.signal.aborted;
  }
  clearTimeout(deadline);
  const failed = rows.filter((r) => r && (FAIL.has(r.cls) || FAIL.has(r.render)));
  let code = 0;
  if (failed.length) code = 1;
  else if (timedOut || counts.unreachable) code = 124;
  if (timedOut) console.log(`no verdict: --timeout ${a.timeout}s expired with ${rows.filter(Boolean).length}/${paths.length} paths fetched${a.sitemap && !sitemap ? ', sitemap not compared' : ''}${a.render ? `, ${rows.filter((r) => r && r.render).length} rendered` : ''} — re-run (raise the cap or shrink the roster)`);
  else if (code === 124) console.log('no verdict: unreachable rows and no FAIL — re-run');
  if (a.json) console.log(JSON.stringify({ old: a.old, new: a.new, rows: rows.filter(Boolean), sitemap, counts, exit: code }));
  console.log(summary(code));
  return code;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((c) => process.exit(c)).catch((e) => { console.error(`host-compare: ${e.message}`); process.exit(2); });
