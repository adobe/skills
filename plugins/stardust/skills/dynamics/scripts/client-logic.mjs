#!/usr/bin/env node
/**
 * client-logic.mjs — recover the logic behind a client-side feature (calculator, filter,
 * finder, configurator) from the SOURCE page: which script runs when the user changes an
 * input, whether the result comes from that script or from a server call, and the readable
 * source of the code that computes it. Evidence for reference/client-logic-recovery.md.
 *
 *   node client-logic.mjs capture --url <source page> --feature <id> [--mount <css>] [--steps steps.json]
 *                                 [--out stardust/dynamics/client-logic/<id>] [--channel chrome] [--headed]
 *   node client-logic.mjs vectors --url <page> --spec vectors.json [--out <dir>/table.<label>.json] [--label source]
 *                                 [--auth-header "token …" | --token-env SITE_TOKEN] [--channel chrome] [--headed]
 *   node client-logic.mjs diff    --expected table.source.json --actual table.target.json [--abs 0.5] [--rel 0.001] [--decimal ,]
 *   node client-logic.mjs cors    --api <url> --from <target origin> [--method POST --body '{…}'] [--auth-header …]
 *
 * capture — loads the page with precise JS coverage on, settles, then changes every control
 *   inside --mount (or runs --steps: [{ "fill": [sel, val] } | { "select": [sel, val] } |
 *   { "click": sel } | { "check": sel } | { "wait": ms }]) and records only what ran BECAUSE of
 *   the interaction. Writes under --out:
 *     session.har           request timeline (bodies omitted; see network.json)
 *     network.json          XHR/fetch during the interaction: method, url, request body, status, response body (≤256 KB)
 *     controls.json         inputs/selects/outputs of the mount: label, name, type, min/max/step, options, value
 *     mutations.json        text that changed in the mount on interaction (the output nodes, before → after)
 *     scripts/<n>.js        every script the page parsed (first-party + inline), as served
 *     pretty/<n>.js         the scripts that ran on interaction, re-indented one statement per line
 *     sources/<path>        original sources from source maps (sourcesContent) when the page ships maps
 *     logic.json, logic.md  compute locus (client | server | mixed), ranked logic candidates with
 *                           script, line (original file:line through the source map when present),
 *                           matched labels/keys, a code excerpt, and the network evidence
 * vectors — records an input → output table from any origin (source, or the rebuilt block on the
 *   target) from spec { "inputs": { key: css }, "outputs": { key: css }, "submit"?: css,
 *   "settleMs"?: n, "rows": [{ key: value, … }] }. Same spec rows + a target selector map =
 *   the verification run for the rebuild.
 * diff — compares two tables row by row (exact, within tolerance, fail).
 * cors — fetches an API from a page on the target origin: can the rebuilt block call it directly?
 *
 * Exit 0 on completion, 1 when diff finds failures, 2 on usage.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len, no-continue */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  arg, flag, readJSON, writeJSON, writeText, provenance, loadPlaywright, settlePage,
  resolveAuthHeader, attachOriginAuth, sameSite, slug,
} from './lib.mjs';


/* ------------------------------------------------------------ browser ---- */
async function open({ har } = {}) {
  const { chromium } = await loadPlaywright();
  const channel = arg('channel');
  const browser = await chromium.launch({
    headless: !flag('headed'),
    ...(channel && channel !== true ? { channel } : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(har ? { recordHar: { path: har, content: 'omit' } } : {}),
  });
  return { browser, context };
}

async function act(page, steps = []) {
  for (const s of steps) {
    if (s.fill) await setControl(page.locator(s.fill[0]).first(), s.fill[1]);
    if (s.select) await page.locator(s.select[0]).first().selectOption(String(s.select[1])).catch(() => page.locator(s.select[0]).first().selectOption({ label: String(s.select[1]) }));
    if (s.click) await page.locator(s.click).first().click();
    if (s.check) await page.locator(s.check).first().check();
    if (s.wait) await page.waitForTimeout(s.wait);
  }
}

/** set a value as a user would — typed for text/number, native setter + events for ranges (React/Angular controlled inputs) */
async function setControl(loc, value) {
  const { tag, type } = await loc.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase() }));
  if (tag === 'select') { await loc.selectOption(String(value)).catch(() => loc.selectOption({ label: String(value) })); return; }
  if (type === 'checkbox' || type === 'radio') { if (value === false) await loc.uncheck(); else await loc.check(); return; }
  if (type === 'range') {
    await loc.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    return;
  }
  await loc.click({ clickCount: 3 }); await loc.press('ControlOrMeta+a'); await loc.press('Backspace');
  await loc.pressSequentially(String(value), { delay: 15 }); await loc.press('Tab');
}

/* ------------------------------------------------------------ pretty ----- */
/** re-indent minified JS one statement per line; strings, templates, comments and regex literals kept intact */
export function prettify(src) {
  // emitted chunks + the last identifier seen keep this linear on multi-MB bundles
  const parts = []; let depth = 0; let i = 0; let prev = ''; let word = '';
  const emit = (s) => { parts.push(s); };
  const nl = () => { parts.push(`\n${'  '.repeat(Math.max(depth, 0))}`); prev = prev || ';'; };
  const regexOk = () => /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || prev === '' || /^(return|typeof|case|do|else|in|of|void|yield|await|instanceof|new|delete|throw)$/.test(word);
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i + 1; while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      word = src.slice(i, j); emit(word); prev = 'w'; i = j; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1; let tdepth = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') { tdepth += 1; j += 2; continue; }
        if (c === '`' && tdepth && src[j] === '}') { tdepth -= 1; j += 1; continue; }
        if (src[j] === c && !tdepth) break;
        j += 1;
      }
      emit(src.slice(i, j + 1)); prev = c; word = ''; i = j + 1; continue;
    }
    if (c === '/' && n === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; emit(src.slice(i, e)); nl(); i = e + 1; continue; }
    if (c === '/' && n === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; emit(src.slice(i, e)); i = e; continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j += 1;
      }
      j += 1; while (/[a-z]/i.test(src[j] || '')) j += 1;
      emit(src.slice(i, j)); prev = '/re'; word = ''; i = j; continue;
    }
    if (/\s/.test(c)) { if (parts.length && !/\s$/.test(parts[parts.length - 1])) emit(' '); i += 1; continue; }
    word = '';
    if (c === '{') { emit(c); depth += 1; nl(); } else if (c === '}') { depth -= 1; nl(); emit(c); if (!/[,;)]/.test(n || '')) nl(); } else if (c === ';') { emit(c); if (n !== '}') nl(); } else emit(c);
    prev = c; i += 1;
  }
  return `${parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n\s*\n/g, '\n').trim()}\n`;
}

/* -------------------------------------------------------- source maps ---- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** decode a v3 `mappings` string into per-generated-line segments [genCol, srcIdx, srcLine, srcCol] */
export function decodeMappings(mappings) {
  const lines = []; let srcIdx = 0; let srcLine = 0; let srcCol = 0;
  for (const line of mappings.split(';')) {
    const segs = []; let genCol = 0;
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const v = []; let shift = 0; let val = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch); val += (d & 31) << shift;
        if (d & 32) shift += 5; else { v.push(val & 1 ? -(val >> 1) : val >> 1); val = 0; shift = 0; }
      }
      genCol += v[0];
      if (v.length >= 4) { srcIdx += v[1]; srcLine += v[2]; srcCol += v[3]; segs.push([genCol, srcIdx, srcLine, srcCol]); }
    }
    lines.push(segs);
  }
  return lines;
}
function originalPosition(map, decoded, line, col) {
  const segs = decoded[line] || []; let best = null;
  for (const s of segs) { if (s[0] <= col) best = s; else break; }
  return best ? { source: map.sources[best[1]], line: best[2] + 1, column: best[3] } : null;
}
const LINE_STARTS = new WeakMap();
/** 0-based line/column of an offset; line starts are indexed once per source string */
function lineColAt(text, offset) {
  const key = { text }; let starts = LINE_STARTS.get(lineColAt)?.text === text ? LINE_STARTS.get(lineColAt).starts : null;
  if (!starts) { starts = [0]; for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1); LINE_STARTS.set(lineColAt, { text, starts }); }
  let lo = 0; let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return key && { line: lo, col: offset - starts[lo] };
}

/* ------------------------------------------------------------ capture ---- */
const FRAMEWORK = /react-dom|scheduler|zone(\.min)?\.js|polyfills|runtime[.-]|vendor|angular|@angular|vue(\.runtime)?|jquery|lodash|core-js|gtm|analytics|adobedtm|launch-|satellite|onetrust|trustarc|newrelic|mpulse|boomerang|hotjar|recaptcha/i;
const FRAMEWORK_SRC = /__REACT_DEVTOOLS_GLOBAL_HOOK__|ɵɵdefineComponent|Zone\.__symbol__|__VUE__|jQuery\.fn/;

async function capture() {
  const url = arg('url'); const feature = slug(arg('feature', 'feature'));
  if (!url) { console.error('usage: client-logic.mjs capture --url <page> --feature <id> [--mount css] [--steps steps.json]'); process.exit(2); }
  const out = arg('out', `stardust/dynamics/client-logic/${feature}`);
  const mount = arg('mount'); const steps = arg('steps') ? readJSON(arg('steps')) : null;
  const { browser, context } = await open({ har: join(out, 'session.har') });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // main-frame scripts only: ad and consent iframes re-parse thousands of inline scripts
  const scripts = new Map(); const mainContexts = new Set(); let mainFrameId = null;
  cdp.on('Runtime.executionContextCreated', ({ context: c }) => { if (c.auxData?.isDefault && (!mainFrameId || c.auxData.frameId === mainFrameId)) mainContexts.add(c.id); });
  cdp.on('Debugger.scriptParsed', (e) => { if (e.url !== undefined) scripts.set(e.scriptId, e); });
  cdp.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) mainFrameId = frame.id; });
  await cdp.send('Page.enable');
  ({ frameTree: { frame: { id: mainFrameId } } } = await cdp.send('Page.getFrameTree'));
  await cdp.send('Runtime.enable');
  await cdp.send('Debugger.enable', { maxScriptsCacheSize: 1e9 });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

  const net = []; let phase = 'load';
  page.on('requestfinished', async (req) => {
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const res = await req.response(); let body = null;
    try { body = (await res.text()).slice(0, 262144); } catch { /* opaque */ }
    net.push({ phase, method: req.method(), url: req.url(), requestBody: req.postData() || null, status: res.status(), contentType: (res.headers()['content-type'] || '').split(';')[0], responseBody: body });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await settlePage(page, { settleMs: 4000, maxScroll: 3000 });
  const root = mount || 'main';
  await page.locator(root).first().waitFor({ timeout: 30000 });
  await page.locator(root).first().scrollIntoViewIfNeeded().catch(() => {});

  const controls = await page.locator(root).first().evaluate((el) => {
    const labelFor = (c) => (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)?.textContent) || c.closest('label')?.textContent || c.getAttribute('aria-label') || (c.getAttribute('aria-labelledby') && document.getElementById(c.getAttribute('aria-labelledby'))?.textContent) || c.placeholder || '';
    const cssPath = (c) => { const p = []; let n = c; while (n && n !== el && p.length < 6) { let s = n.tagName.toLowerCase(); if (n.id) { p.unshift(`#${CSS.escape(n.id)}`); break; } const sib = [...(n.parentElement?.children || [])].filter((x) => x.tagName === n.tagName); if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; p.unshift(s); n = n.parentElement; } return p.join(' > '); };
    return [...el.querySelectorAll('input, select, textarea, [role=slider], [role=combobox], [role=radio], [contenteditable=true]')].filter((c) => c.type !== 'hidden').map((c) => ({
      selector: cssPath(c), tag: c.tagName.toLowerCase(), type: c.type || c.getAttribute('role'), name: c.name || null, id: c.id || null,
      label: labelFor(c).replace(/\s+/g, ' ').trim(), value: c.value ?? c.getAttribute('aria-valuenow'), min: c.min || c.getAttribute('aria-valuemin') || null, max: c.max || c.getAttribute('aria-valuemax') || null, step: c.step || null,
      options: c.tagName === 'SELECT' ? [...c.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) : undefined,
    }));
  });

  await page.locator(root).first().evaluate((el) => {
    window.__clMut = []; const seen = new Map();
    const snap = (n) => (n.nodeType === 3 ? n.textContent : n.textContent || '').replace(/\s+/g, ' ').trim();
    el.querySelectorAll('*').forEach((n) => { if (!n.children.length) seen.set(n, snap(n)); });
    window.__clObs = new MutationObserver((ms) => { for (const m of ms) { const t = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (t) window.__clMut.push({ tag: t.tagName?.toLowerCase(), cls: String(t.className || '').slice(0, 80), id: t.id || null, before: seen.get(t) ?? null, after: snap(t).slice(0, 200) }); } });
    window.__clObs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value', 'aria-valuenow'] });
  });

  await cdp.send('Profiler.takePreciseCoverage'); // reset counters: everything after this ran because of the interaction
  phase = 'interaction';
  if (steps) await act(page, steps);
  else {
    for (const c of controls) {
      const loc = page.locator(root).first().locator(c.selector).first();
      try {
        if (c.tag === 'select' && c.options?.length > 1) await loc.selectOption(c.options.find((o) => o.value !== c.value)?.value);
        else if (c.type === 'range' || c.type === 'number') { const step = Number(c.step) || 1; const v = Number(c.value) || Number(c.min) || 0; await setControl(loc, Number(c.max) && v + step > Number(c.max) ? v - step : v + step); } else if (['text', 'tel', 'search', ''].includes(c.type) && c.tag === 'input') await setControl(loc, String((Number(String(c.value).replace(/\D/g, '')) || 10) + 1));
        else if (c.type === 'radio' || c.type === 'checkbox') await loc.check();
        await page.waitForTimeout(400);
      } catch { /* control not operable: recorded in controls.json */ }
    }
  }
  await page.waitForTimeout(1500);
  const { result: cov } = await cdp.send('Profiler.takePreciseCoverage');
  const mutations = await page.evaluate(() => { window.__clObs?.disconnect(); const seen = new Set(); return window.__clMut.filter((m) => { const k = `${m.tag}${m.id}${m.cls}${m.after}`; if (seen.has(k) || m.before === m.after) return false; seen.add(k); return true; }); });

  // scripts: source + maps
  const pageHost = new URL(url).host; const files = new Map(); const seenHash = new Set(); const thirdParty = new Set(); let k = 0;
  for (const [id, s] of scripts) {
    if (!mainContexts.has(s.executionContextId)) continue;
    if (s.url && !/^https?:/.test(s.url)) continue;
    const firstParty = !s.url || sameSite(new URL(s.url).host, pageHost);
    if (!firstParty) { thirdParty.add(new URL(s.url).host); continue; }
    if (seenHash.has(s.hash)) continue; seenHash.add(s.hash);
    let source = ''; try { ({ scriptSource: source } = await cdp.send('Debugger.getScriptSource', { scriptId: id })); } catch { continue; }
    if (!source || source.length < 40) continue;
    const name = `${String((k += 1)).padStart(3, '0')}-${slug((s.url || 'inline').split('/').pop().split('?')[0] || 'inline')}.js`;
    let map = null; let decoded = null;
    if (s.sourceMapURL && !s.sourceMapURL.startsWith('data:')) {
      try { const mu = new URL(s.sourceMapURL, s.url || url).href; const r = await context.request.get(mu, { timeout: 30000 }); if (r.ok()) map = await r.json(); } catch { /* no map */ }
    } else if (s.sourceMapURL?.startsWith('data:')) {
      try { map = JSON.parse(Buffer.from(s.sourceMapURL.split(',')[1], 'base64').toString('utf8')); } catch { /* bad map */ }
    }
    if (map?.mappings) decoded = decodeMappings(map.mappings);
    if (map?.sourcesContent) {
      map.sources.forEach((src, i) => {
        if (!map.sourcesContent[i] || /node_modules|webpack\/(runtime|bootstrap)/.test(src)) return;
        const rel = String(src).replace(/^[a-z-]+:\/*/i, '').replace(/\?.*$/, '').split('/').filter((p) => p && p !== '..' && p !== '.').join('/');
        const file = !rel ? `${name}-src-${i}.js` : /\.[a-z0-9]+$/i.test(rel.split('/').pop()) ? rel : `${rel}.src-${i}.js`;
        try { writeText(join(out, 'sources', file), map.sourcesContent[i]); } catch { /* path clash between two map entries: keep the first */ }
      });
    }
    writeText(join(out, 'scripts', name), source);
    files.set(id, { id, url: s.url || '(inline)', name, firstParty, source, map, decoded, framework: FRAMEWORK.test(s.url || '') || FRAMEWORK_SRC.test(source.slice(0, 200000)) });
  }

  // candidates: functions that ran during the interaction, in first-party non-framework code
  const labels = [...new Set(controls.flatMap((c) => [c.label, c.name, c.id]).concat(mutations.map((m) => m.id)).filter((x) => x && x.length > 2))];
  const cands = [];
  for (const sc of cov) {
    const f = files.get(sc.scriptId); if (!f || !f.firstParty) continue;
    for (const fn of sc.functions) {
      const r = fn.ranges[0]; if (!r || r.count === 0 || r.endOffset - r.startOffset > 60000 || !fn.functionName && r.startOffset === 0) continue;
      const body = f.source.slice(r.startOffset, r.endOffset);
      const math = (body.match(/Math\.(pow|round|floor|ceil|log|exp|max|min)|\*\*|[^/*]\*[^/*]|[^/*]\/[^/*]/g) || []).length;
      const hits = labels.filter((l) => body.includes(l)).slice(0, 8);
      const { line: gl, col: gc } = f.decoded ? lineColAt(f.source, r.startOffset) : { line: 0, col: 0 };
      const orig = f.decoded ? originalPosition(f.map, f.decoded, gl, gc) : null;
      const library = f.framework || /node_modules|webpack\/(runtime|bootstrap)/.test(orig?.source || '');
      const score = hits.length * 8 + Math.min(math, 25) - Math.log2(body.length + 1) - (library ? 100 : 0);
      cands.push({ f, r, framework: library, script: f.url, file: `scripts/${f.name}`, function: fn.functionName || '(anonymous)', calls: r.count, bytes: body.length, mathOps: math, matchedLabels: hits, score: +score.toFixed(1) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands.filter((c) => !c.framework).slice(0, 12).map(({ f, r, ...c }) => {
    const { line, col } = lineColAt(f.source, r.startOffset);
    return { ...c, generated: { line: line + 1, column: col }, original: f.decoded ? originalPosition(f.map, f.decoded, line, col) : null, excerpt: prettify(f.source.slice(r.startOffset, r.endOffset)).split('\n').slice(0, 60).join('\n') };
  });
  const ran = new Set(top.map((c) => c.file));
  for (const f of files.values()) if (ran.has(`scripts/${f.name}`)) writeText(join(out, 'pretty', f.name), prettify(f.source));

  const iAll = net.filter((n) => n.phase === 'interaction');
  const iNet = iAll.filter((n) => sameSite(new URL(n.url).host, pageHost));
  const outputs = mutations.map((m) => m.after).filter((t) => /\d/.test(t));
  const serverEcho = iNet.filter((n) => n.responseBody && outputs.some((o) => (o.match(/\d[\d\s.,]{2,}/g) || []).some((num) => n.responseBody.includes(num.replace(/[\s.,]/g, '').slice(0, 6)))));
  const locus = serverEcho.length ? (top.some((c) => c.mathOps > 3) ? 'mixed' : 'server') : iNet.length ? (top.length ? 'client (with calls)' : 'server') : 'client';
  const logic = { ...provenance('client-logic capture', { url, mount: root }), locus, thirdPartyRequestsDuringInteraction: iAll.length - iNet.length, thirdPartyScriptHosts: [...thirdParty].sort(), controls: controls.length, outputsChanged: mutations.length, interactionRequests: iNet.map(({ responseBody, ...r }) => ({ ...r, echoesOutput: serverEcho.includes(r) ? true : undefined })), sourceMaps: [...files.values()].filter((f) => f.map).map((f) => ({ script: f.url, sources: f.map.sources.length, sourcesContent: !!f.map.sourcesContent })), candidates: top.map(({ excerpt, ...c }) => c) };

  writeJSON(join(out, 'controls.json'), controls);
  writeJSON(join(out, 'mutations.json'), mutations);
  writeJSON(join(out, 'network.json'), net);
  writeJSON(join(out, 'logic.json'), logic);
  const md = [`# Client logic — ${feature}`, '', `Source: ${url} · mount \`${root}\` · ${new Date().toISOString()}`, '',
    `**Compute locus: ${locus}.** ${controls.length} controls, ${mutations.length} output mutations, ${iNet.length} first-party XHR/fetch during the interaction (${iAll.length - iNet.length} third-party ignored)${serverEcho.length ? `, ${serverEcho.length} whose response carries the displayed numbers` : ''}.`, '',
    '## First-party network during the interaction', '', ...(iNet.length ? iNet.map((n) => `- \`${n.method} ${n.url}\` → ${n.status} ${n.contentType}${n.requestBody ? ` · body \`${n.requestBody.slice(0, 200)}\`` : ''}${serverEcho.includes(n) ? ' · **response carries the output**' : ''}`) : ['- none']), '',
    '## Outputs that changed', '', ...mutations.slice(0, 20).map((m) => `- \`${m.tag}${m.id ? `#${m.id}` : ''}${m.cls ? `.${m.cls.split(' ')[0]}` : ''}\`: "${m.before ?? ''}" → "${m.after}"`), '',
    '## Source maps', '', ...(logic.sourceMaps.length ? logic.sourceMaps.map((s) => `- ${s.script}: ${s.sources} sources${s.sourcesContent ? ' (originals written to `sources/`)' : ''}`) : ['- none shipped']), '',
    '## Logic candidates (ran on interaction, first-party, framework excluded, ranked)', '',
    ...top.flatMap((c, i) => [`### ${i + 1}. \`${c.function}\` — ${c.file}:${c.generated.line}${c.original ? ` (original ${c.original.source}:${c.original.line})` : ''}`, '', `calls ${c.calls} · ${c.bytes} B · math ops ${c.mathOps}${c.matchedLabels.length ? ` · mentions ${c.matchedLabels.map((l) => `"${l}"`).join(', ')}` : ''}`, '', '```js', c.excerpt, '```', '']),
  ];
  writeText(join(out, 'logic.md'), md.join('\n'));
  await context.close(); await browser.close();
  console.error(`[client-logic] ${feature}: locus ${locus} · ${top.length} candidates · ${files.size} scripts · ${iNet.length} interaction requests → ${out}/logic.md`);
}

/* ------------------------------------------------------------ vectors ---- */
async function vectors() {
  const url = arg('url'); const spec = arg('spec') && readJSON(arg('spec'));
  if (!url || !spec) { console.error('usage: client-logic.mjs vectors --url <page> --spec vectors.json [--out table.json]'); process.exit(2); }
  const label = arg('label', 'source');
  const out = arg('out', `table.${label}.json`);
  const { browser, context } = await open();
  await attachOriginAuth(context, url, resolveAuthHeader());
  const page = await context.newPage(); const rows = [];
  for (const [i, row] of spec.rows.entries()) {
    const r = { i, input: row, output: {} };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (i === 0) await settlePage(page, { settleMs: 2500, maxScroll: 0 });
      await page.locator(Object.values(spec.inputs)[0]).first().waitFor({ timeout: 30000 });
      for (const [key, css] of Object.entries(spec.inputs)) if (key in row) await setControl(page.locator(css).first(), row[key]);
      if (spec.submit) await page.locator(spec.submit).first().click();
      await page.waitForTimeout(spec.settleMs ?? 600);
      for (const [key, css] of Object.entries(spec.outputs)) r.output[key] = (await page.locator(css).first().textContent({ timeout: 5000 }).catch(() => null))?.replace(/\s+/g, ' ').trim() ?? null;
    } catch (e) { r.error = String(e.message || e).slice(0, 200); }
    rows.push(r); console.error(`[vectors] ${i + 1}/${spec.rows.length} ${JSON.stringify(r.output).slice(0, 120)}`);
  }
  writeJSON(out, { ...provenance('client-logic vectors', { url, label }), rows });
  await browser.close();
}

/* --------------------------------------------------------------- diff ---- */
/** "CHF 3’192.91." · "1 234 kr" · "12,5 %" · "−3" → number; thousands separators (space, NBSP, ’ ' ,/.) and trailing punctuation tolerated */
export const num = (t, { decimal } = {}) => {
  if (t == null) return null;
  const m = String(t).replace(/[\s\u00a0\u202f’'ʼ]/g, '').replace(/−/g, '-').match(/-?\d(?:[\d.,]*\d)?/);
  if (!m) return null;
  let s = m[0]; const lc = s.lastIndexOf(','); const ld = s.lastIndexOf('.');
  const commas = (s.match(/,/g) || []).length;
  if (decimal === ',') { const v = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : null; }
  if (lc > ld && ld < 0 && (commas > 1 || (/,\d{3}$/.test(s) && !/^-?0,/.test(s)))) s = s.replace(/,/g, ''); // 1,000 · 1,234,567
  else if (lc > ld) s = s.replace(/\./g, '').replace(',', '.'); // 12,5 · 1.234,56
  else if (ld > lc && lc > -1) s = s.replace(/,/g, '');
  else if (ld > -1 && (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const v = Number(s); return Number.isFinite(v) ? v : null;
};
function diff() {
  const e = readJSON(arg('expected')); const a = readJSON(arg('actual'));
  const abs = Number(arg('abs', 0)); const rel = Number(arg('rel', 0)); const decimal = arg('decimal'); let exact = 0; let tol = 0; const fails = [];
  e.rows.forEach((row, i) => {
    const got = a.rows[i]?.output || {}; let v = 'exact';
    for (const [k, want] of Object.entries(row.output)) {
      const w = num(want, { decimal }); const g = num(got[k], { decimal });
      if (String(want) === String(got[k]) || (w !== null && w === g)) continue;
      if (w !== null && g !== null && Math.abs(w - g) <= Math.max(abs, rel * Math.abs(w))) { if (v === 'exact') v = 'tolerance'; continue; }
      v = 'fail'; fails.push({ i, key: k, expected: want, actual: got[k] ?? null, input: row.input });
    }
    if (v === 'exact') exact += 1; else if (v === 'tolerance') tol += 1;
  });
  const n = e.rows.length;
  console.log(JSON.stringify({ n, exact, withinTolerance: tol, failed: n - exact - tol, failures: fails.slice(0, 20) }, null, 1));
  process.exit(fails.length ? 1 : 0);
}

/* --------------------------------------------------------------- cors ---- */
async function cors() {
  const api = arg('api'); const from = arg('from');
  if (!api || !from) { console.error('usage: client-logic.mjs cors --api <url> --from <target origin>'); process.exit(2); }
  const { browser, context } = await open(); await attachOriginAuth(context, from, resolveAuthHeader());
  const page = await context.newPage(); await page.goto(from, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const body = arg('body');
  const r = await page.evaluate(async ({ api: u, method, body: b }) => { try { const res = await fetch(u, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b || undefined }); return { status: res.status, acao: res.headers.get('access-control-allow-origin'), bytes: (await res.text()).length }; } catch (err) { return { error: String(err.message || err) }; } }, { api, method: arg('method', 'GET'), body: body && body !== true ? body : null });
  console.log(JSON.stringify({ api, from: page.url(), ...r, callable: !!r.status && r.status < 400 }, null, 1));
  await browser.close();
}

// CLI only when run directly, so the pure helpers (prettify, decodeMappings, num) stay importable by tests
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const CMD = process.argv[2];
  if (!CMD || CMD === '--help' || CMD === '-h' || process.argv.includes('--help')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(CMD ? 0 : 2);
  }
  if (CMD === 'capture') await capture();
  else if (CMD === 'vectors') await vectors();
  else if (CMD === 'diff') diff();
  else if (CMD === 'cors') await cors();
  else { console.error(`unknown command ${CMD} (capture | vectors | diff | cors)`); process.exit(2); }
}
