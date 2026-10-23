#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus */
/**
 * skills/diff/scripts/chrome-compare.mjs — the header-parity gate: a build's chrome-explore record
 * against the source's (the header contract). Controls pair by name, then by family (search, cart,
 * account, locale, drawer); every state the source opens must open the same way on the build, with
 * its links and headings, its keyboard behaviour (Enter opens, Escape closes and returns focus, Tab
 * reaches the panel, aria-expanded follows) and its close paths. Profile `replica` (keep-design flow)
 * also gates the open-state crops (pixelmatch 0.1, --bar), motion (property set; duration within
 * max(80 ms, 25 %)) and the header's scroll states; `functional` (redesign, reskin) checks behaviour
 * and content only.
 *
 * A finding clears only by a fix or by a site-owner decision in --decisions
 * ({ decisions: [{ finding: "<key or prefix*>", decision, reason, by, at }] }); entries without
 * `by`/`at`, or signed by an agent, are ignored and reported.
 *
 * Usage: node skills/diff/scripts/chrome-compare.mjs <source.json> <build.json> [options]
 *   --profile replica|functional   default replica
 *   --bar <ratio>                  open-state crop bar (default 0.02)
 *   --decisions <file>             default stardust/chrome/header-decisions.json
 *   --json <file>                  write the verdict (stardust/chrome/header-parity.json is what done-check reads)
 *   --src-shots <dir> / --build-shots <dir>   crop folders when not where the records say
 * Exit: 0 no undecided error · 2 errors · 1 usage. `compareDocs`, `applyDecisions`, `findingKey` are exported.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normName } from './chrome-explore.mjs';

const TOUCH_BELOW = 768;
const FAMILIES = new Set(['search', 'cart', 'account', 'locale', 'drawer']);
const AGENT = /^(agent|assistant|stardust|claude|codex|bot|auto)/i;

/** The decision key of a finding: `<id>@<width> <path>[ [action]]`. Pure. */
export const findingKey = (f) => `${f.id}@${f.width} ${f.path}${f.action ? ` [${f.action}]` : ''}`;

const hrefKey = (h) => {
  let u; try { u = new URL(h, 'http://x'); } catch { return String(h || ''); }
  const p = decodeURIComponent(u.pathname).toLowerCase().replace(/\.html?$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1');
  return `${p}${u.search}`;
};
const openOf = (c) => ['click', 'hover', 'key'].find((a) => c.actions && c.actions[a] && c.actions[a].opened);

/** Pair two control lists: by name, then by family in order. Pure. */
export function pairControls(src, bld) {
  const used = new Set(); const pairs = [];
  for (const s of src) {
    let b = s.key ? bld.find((x) => !used.has(x) && x.key === s.key) : null;
    if (!b && FAMILIES.has(s.kind)) b = bld.find((x) => !used.has(x) && x.kind === s.kind);
    if (b) used.add(b);
    pairs.push([s, b || null]);
  }
  return pairs;
}

const searches = (cs, out = []) => { for (const c of cs || []) { if (c.search) out.push(c.search); searches(c.children, out); } return out; };

function compareState(ss, bs, base, { profile, add, visual }, full) {
  // content, motion and crops once per control (the first action both sides open on); keyboard facts per action
  if (ss.tabReachesPanel && bs.tabReachesPanel === false) add({ ...base, id: 'keyboard', severity: 'error', detail: 'Tab moves into the panel on the source, not on the build' });
  if (!full) return;
  const bl = new Map(bs.panel.links.map((l) => [normName(l.text) || hrefKey(l.href), l]));
  const missing = []; const moved = [];
  for (const l of ss.panel.links) {
    const k = normName(l.text) || hrefKey(l.href); const m = bl.get(k);
    if (!m) missing.push(l.text || l.href); else if (hrefKey(m.href) !== hrefKey(l.href)) moved.push(`${l.text}: ${hrefKey(l.href)} → ${hrefKey(m.href)}`);
  }
  const bh = new Set(bs.panel.headings.map(normName));
  const hMissing = ss.panel.headings.filter((h) => !bh.has(normName(h)));
  const iMissing = ss.panel.inputs.length && !bs.panel.inputs.length;
  if (missing.length || hMissing.length || iMissing) {
    add({ ...base, id: 'panel-content', severity: 'error', detail: [missing.length && `${missing.length} of ${ss.panel.links.length} links missing (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''})`, hMissing.length && `headings missing: ${hMissing.slice(0, 4).join(', ')}`, iMissing && 'the source panel has an input, the build none'].filter(Boolean).join('; ') });
  }
  if (moved.length) add({ ...base, id: 'link-href', severity: 'warn', detail: `${moved.length} link(s) point elsewhere: ${moved.slice(0, 4).join('; ')}` });
  if (ss.panel.images && !bs.panel.images) add({ ...base, id: 'panel-content', severity: 'warn', detail: `the source panel shows ${ss.panel.images} image(s), the build none` });
  if (ss.expanded === 'true' && bs.expanded !== 'true') add({ ...base, id: 'keyboard', severity: 'error', detail: 'aria-expanded is "true" on the source trigger when open; the build does not set it' });
  if (ss.scrollLock && !bs.scrollLock) add({ ...base, id: 'scroll-lock', severity: 'error', detail: 'the source locks page scroll while open; the build does not' });
  if (profile !== 'replica') return;
  // per property, every duration that ran (two elements may animate the same property at different speeds)
  const mv = (s) => { const m = new Map(); for (const x of (s.motion || []).filter((y) => y.ms > 0 && y.prop !== 'visibility')) m.set(x.prop, [...(m.get(x.prop) || []), x.ms]); return m; };
  const sm = mv(ss); const bm = mv(bs);
  const list = (m) => [...m].map(([p, ms]) => `${p} ${[...new Set(ms)].join('/')}ms`).join(', ');
  if (sm.size && !bm.size) add({ ...base, id: 'motion', severity: 'error', detail: `the source animates ${list(sm)}; the build opens without motion` });
  else if (!sm.size && bm.size) add({ ...base, id: 'motion', severity: 'warn', detail: `the build animates ${[...bm.keys()].join(', ')}; the source does not` });
  else {
    for (const [p, ms] of sm) {
      const b = bm.get(p);
      if (!b) { add({ ...base, id: 'motion', severity: 'warn', detail: `the source animates ${p}; the build does not` }); continue; }
      const off = [...new Set(ms)].filter((m) => !b.some((x) => Math.abs(x - m) <= Math.max(80, 0.25 * m)));
      if (off.length) add({ ...base, id: 'motion', severity: 'error', detail: `${p}: ${off.join('/')}ms on the source, ${[...new Set(b)].join('/')}ms on the build` });
    }
  }
  if (ss.shot) visual.push({ ...base, src: ss.shot, build: bs.shot || null });
}

function walk(src, bld, ctx, path) {
  const { width, add } = ctx;
  const touch = width < TOUCH_BELOW;
  for (const [s, b] of pairControls(src.filter((c) => c.role !== 'input'), bld.filter((c) => c.role !== 'input'))) {
    const p = path ? `${path} > ${s.name || s.kind}` : (s.name || s.kind);
    const base = { width, path: p };
    const sOpen = openOf(s);
    if (!b) {
      if (sOpen) add({ ...base, id: 'control-missing', severity: 'error', detail: `the source ${s.kind} control opens on ${sOpen}; the build has no control named "${s.name}"${FAMILIES.has(s.kind) ? ` or of family ${s.kind}` : ''}` });
      else if (!path && s.role === 'link') add({ ...base, id: 'link-missing', severity: 'warn', detail: `top-level link ${s.href ? hrefKey(s.href) : ''} not in the build header` });
      continue;
    }
    let full = true;
    for (const a of touch ? ['click', 'key'] : ['hover', 'click', 'key']) {
      const ss = s.actions && s.actions[a]; const bs = b.actions && b.actions[a];
      const so = !!(ss && ss.opened); const bo = !!(bs && bs.opened);
      if (so && !bo) add({ ...base, action: a, id: a === 'key' ? 'keyboard' : 'state-missing', severity: 'error', detail: `opens on ${a === 'key' ? 'Enter' : a} on the source (${ss.panel.links.length} links); ${bs && bs.navigates ? `navigates to ${hrefKey(bs.navigates)} on the build` : b.role === 'link' ? `the build control is a plain link${b.href ? ` to ${hrefKey(b.href)}` : ''}` : 'nothing opens on the build'}` });
      else if (!so && bo && !(ss && ss.navigates)) add({ ...base, action: a, id: 'state-extra', severity: 'warn', detail: `opens on ${a} on the build only` });
      else if (so && bo) { compareState(ss, bs, { ...base, action: a }, ctx, full); full = false; }
    }
    if (sOpen && openOf(b) && s.close) {
      for (const k of ['escape', 'outside', 'toggle', 'leave']) {
        if (s.close[k] === true && !(b.close && b.close[k] === true)) add({ ...base, id: 'close-path', severity: 'error', detail: `${k === 'escape' ? 'Escape' : k === 'outside' ? 'a click outside' : k === 'toggle' ? 'clicking the trigger again' : 'moving the pointer away'} closes it on the source, not on the build` });
      }
      if (s.close.focusReturn && !(b.close && b.close.focusReturn)) add({ ...base, id: 'keyboard', severity: 'error', detail: 'Escape returns focus to the trigger on the source, not on the build' });
    }
    if (sOpen && openOf(b) && !s.returns) walk(s.children || [], b.children || [], ctx, p);
  }
}

/** All findings except the crop pixels (returned as `visual` pairs for the image pass). Pure. */
export function compareDocs(src, bld, { profile = 'replica' } = {}) {
  const findings = []; const visual = [];
  const add = (f) => findings.push(f);
  for (const [w, sw] of Object.entries(src.widths || {})) {
    const width = Number(w);
    const bw = (bld.widths || {})[w];
    if (!bw) { add({ width, path: '(page)', id: 'width-missing', severity: 'error', detail: `the build was not explored at ${w}` }); continue; }
    if (!bw.root && sw.root) { add({ width, path: '(page)', id: 'control-missing', severity: 'error', detail: 'no header root on the build' }); continue; }
    walk(sw.controls || [], bw.controls || [], { width, add, profile, visual }, '');
    const ssr = searches(sw.controls); const bsr = searches(bw.controls);
    if (ssr.length && !bsr.length) add({ width, path: 'search', id: 'control-missing', severity: 'error', detail: 'the source header has a search input; the build none' });
    else if (ssr.length) {
      const s = ssr[0]; const b = bsr[0];
      if ((s.typeahead.links || s.typeahead.options) && !(b.typeahead.links || b.typeahead.options)) add({ width, path: 'search', id: 'state-missing', action: 'type', severity: 'error', detail: `typing "${s.probe}" shows ${s.typeahead.links || s.typeahead.options} suggestion(s) on the source, none on the build` });
      if (s.submit && !b.submit) add({ width, path: 'search', id: 'state-missing', action: 'submit', severity: 'error', detail: `Enter submits to ${hrefKey(s.submit)} on the source; nothing on the build` });
      else if (s.submit && b.submit && hrefKey(s.submit).split('?')[0] !== hrefKey(b.submit).split('?')[0]) add({ width, path: 'search', id: 'link-href', action: 'submit', severity: 'warn', detail: `submits to ${hrefKey(s.submit)} on the source, ${hrefKey(b.submit)} on the build` });
    }
    const sev = profile === 'replica' ? 'error' : 'warn';
    for (const s of sw.scroll || []) {
      const b = (bw.scroll || []).find((x) => x.at === s.at);
      if (!b) { if ((bw.scroll || []).length) add({ width, path: '(header)', id: 'scroll-state', severity: sev, detail: `no ${s.at} sample on the build` }); continue; }
      const pin = (x) => (x.position === 'fixed' || x.position === 'sticky' ? 'pinned' : 'static');
      if (s.inView !== b.inView || pin(s) !== pin(b)) add({ width, path: '(header)', action: s.at, id: 'scroll-state', severity: sev, detail: `scrolled ${s.at}: the source header is ${pin(s)} and ${s.inView ? 'in view' : 'out of view'}, the build's ${pin(b)} and ${b.inView ? 'in view' : 'out of view'}` });
      else if (Math.abs(s.height - b.height) > Math.max(8, 0.1 * s.height)) add({ width, path: '(header)', action: s.at, id: 'scroll-state', severity: sev, detail: `scrolled ${s.at}: header ${s.height}px on the source, ${b.height}px on the build` });
    }
    if (sw.truncated) add({ width, path: '(source)', id: 'budget-truncated', severity: 'warn', detail: `the source record stopped at ${sw.truncated}: raise --max-states/--max-depth for full coverage` });
    if (bw.truncated) add({ width, path: '(build)', id: 'budget-truncated', severity: 'warn', detail: `the build record stopped at ${bw.truncated}` });
  }
  return { findings, visual: profile === 'replica' ? visual : [] };
}

/** Mark findings cleared by a valid site-owner decision; invalid entries become warnings. Pure. */
export function applyDecisions(findings, decisions = []) {
  const valid = []; const out = [...findings];
  for (const d of decisions) {
    if (!d || !d.finding || !d.by || !d.at || AGENT.test(String(d.by))) { out.push({ width: 0, path: '(decisions)', id: 'decision-invalid', severity: 'warn', detail: `ignored: ${d && d.finding ? d.finding : '(no finding)'} — a decision needs the site owner's \`by\` and \`at\`` }); continue; }
    valid.push(d);
  }
  for (const f of out) {
    const k = findingKey(f);
    const d = valid.find((x) => (x.finding.endsWith('*') ? k.startsWith(x.finding.slice(0, -1)) : k === x.finding));
    if (d && f.severity === 'error') f.decided = { decision: d.decision || 'accepted', by: d.by, at: d.at, reason: d.reason || '' };
  }
  return out;
}

const loadDep = async (name) => {
  try { const req = createRequire(join(process.cwd(), 'package.json')); const m = await import(pathToFileURL(req.resolve(name)).href); return m.default || m; } catch { /* fall through */ }
  const m = await import(name); return m.default || m;
};

/** Crop pairs → ratio of differing pixels over the union box (size differences count as different). */
export async function visualFindings(pairs, { srcDir, buildDir, bar }) {
  if (!pairs.length) return [];
  let PNG; let pixelmatch;
  try { ({ PNG } = await loadDep('pngjs')); pixelmatch = await loadDep('pixelmatch'); } catch { return pairs.map((p) => ({ ...p, id: 'panel-visual', severity: 'error', detail: 'crops not compared: pngjs + pixelmatch are not installed in this project' })); }
  const out = [];
  for (const p of pairs) {
    const fa = join(srcDir, p.src); const fb = p.build && join(buildDir, p.build);
    if (!existsSync(fa)) { out.push({ ...p, id: 'panel-visual', severity: 'error', detail: `source crop ${fa} missing: re-run chrome-explore on the source` }); continue; }
    if (!fb || !existsSync(fb)) { out.push({ ...p, id: 'panel-visual', severity: 'error', detail: 'the build state has no crop' }); continue; }
    const a = PNG.sync.read(readFileSync(fa)); const b = PNG.sync.read(readFileSync(fb));
    const w = Math.min(a.width, b.width); const h = Math.min(a.height, b.height);
    const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o.data; };
    const mask = Buffer.alloc(w * h * 4);
    const diff = pixelmatch(crop(a), crop(b), mask, w, h, { threshold: 0.1 });
    const union = Math.max(a.width, b.width) * Math.max(a.height, b.height);
    const ratio = (diff + (union - w * h)) / union;
    // crop-compare's texture: a differing pixel with ≥5 differing neighbours is thick (paint, misalignment); glyph antialiasing is thin
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[(y * w + x) * 4] === 255 && mask[(y * w + x) * 4 + 1] === 0;
    let thick = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (on(x, y)) { let k = 0; for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && on(x + dx, y + dy)) k += 1; if (k >= 5) thick += 1; }
    const thickPct = diff ? Math.round((thick / diff) * 100) : 0;
    if (ratio > bar) out.push({ ...p, id: 'panel-visual', severity: 'error', detail: `open-state crop differs by ${(ratio * 100).toFixed(1)}% (bar ${(bar * 100).toFixed(0)}%; source ${a.width}×${a.height}, build ${b.width}×${b.height}; texture ${thickPct}% thick${thickPct <= 15 && a.width === b.width && a.height === b.height ? ', thin-edge: glyph antialiasing, a font substitution the site owner can accept' : ''})` });
  }
  return out.map(({ src, build, ...f }) => f);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const [sf, bf] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  if (!sf || !bf || !existsSync(sf) || !existsSync(bf)) { console.error('usage: chrome-compare.mjs <source.json> <build.json> [--profile replica|functional] [--bar 0.02] [--decisions f] [--json f]'); process.exit(1); }
  const src = JSON.parse(readFileSync(sf, 'utf8')); const bld = JSON.parse(readFileSync(bf, 'utf8'));
  const profile = arg('profile', 'replica'); const bar = Number(arg('bar', 0.02));
  const { findings, visual } = compareDocs(src, bld, { profile });
  findings.push(...await visualFindings(visual, { srcDir: arg('src-shots', src.shots || '.'), buildDir: arg('build-shots', bld.shots || '.'), bar }));
  const df = arg('decisions', join('stardust', 'chrome', 'header-decisions.json'));
  const all = applyDecisions(findings, existsSync(df) ? (JSON.parse(readFileSync(df, 'utf8')).decisions || []) : []);
  const errors = all.filter((f) => f.severity === 'error' && !f.decided); const warns = all.filter((f) => f.severity === 'warn'); const decided = all.filter((f) => f.decided);
  for (const f of [...errors, ...warns]) console.log(`${f.severity === 'error' ? '🔴' : '🟡'} ${findingKey(f)} — ${f.detail}`);
  const widths = Object.keys(src.widths || {}).map(Number);
  const verdict = { tool: 'chrome-compare', at: new Date().toISOString(), source: src.url, build: bld.url, profile, bar, widths, counts: { error: errors.length, warn: warns.length, decided: decided.length }, findings: all.map((f) => ({ key: findingKey(f), ...f })) };
  const out = arg('json', null);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(verdict, null, 1)}\n`); }
  console.log(`chrome-compare: ${errors.length} error(s), ${warns.length} warning(s), ${decided.length} decided (profile ${profile}, widths ${widths.join(',')})${out ? ` → ${out}` : ''}`);
  process.exit(errors.length ? 2 : 0);
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
if (process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === self; } catch { return false; } })()) main().catch((e) => { console.error(`chrome-compare: ${e.message}`); process.exit(1); });
