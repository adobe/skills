#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus */
/**
 * skills/diff/scripts/chrome-compare.mjs — the header-parity gate: a build's chrome-explore record
 * against the source's (the header contract). Controls pair by name, then by family (search, cart,
 * account, locale, drawer); a link, in the header or in a panel, with text on one side only pairs by
 * its address (`link-text`, a warning). Every state the source opens must open the same way on the build, with
 * its links and headings, its keyboard behaviour (Enter opens, Escape closes and returns focus, Tab
 * reaches the panel, aria-expanded follows) and its close paths. Profile `replica` (keep-design flow)
 * also gates the open-state crops (pixelmatch 0.1, --bar), motion (property set; duration within
 * max(80 ms, 25 %)) and the header's scroll states; `functional` (redesign, reskin) checks behaviour
 * and content only. Build evidence not observed because its request budget stopped the record warns
 * instead of failing parity; observed failures remain errors. `at-rest-watch`: the two records differ in
 * the self-changing regions chrome-explore left out (a warning), or a side's watch could not run (an error:
 * explore that side again).
 *
 * A finding clears only by a fix or by a site-owner decision in --decisions
 * ({ decisions: [{ finding: "<key or prefix*>", decision, reason, by, at }] }); entries without
 * `by`/`at`, or signed by an agent, are ignored and reported.
 *
 * Round cap (replica's rounds.mjs is the ledger and the definition: <--rounds dir>/rounds.json, one budget per stage).
 * A comparison that ends with a verdict is a round of its stage: 3 counted rounds, the first and two fix rounds; a
 * pass after a pass is free. After that the comparison is refused (exit 6, no verdict written) until every remaining
 * error has a CLASS in --decisions: { finding: "<exact key>", class, reason } with class
 *   owner            only the site owner can close it: the reason names the dynamics row or the third party
 *   instrument       the recorder or the comparer is wrong: the reason names the defect and its evidence
 *   accept-residual  a difference left in the build: the reason says why
 * Anyone may record a class. A class does not clear a finding: the error stays (exit 2), `classed` is written beside
 * it in the verdict and done-check prints the gap with its classes; only the site owner's `by` and `at` clear it.
 * With every error classed the stage is closed in the ledger (accept-residual) and later comparisons of it run
 * uncounted, refused again when an error without a class appears. `rounds.mjs decide <dir> --stage <s> --decision
 * extend` grants one more counted round for a named instrument defect.
 * The cap is the replica flow's: it applies in a replica project — stardust/state.json says `flow: "replica"` (what
 * done-check and qa read), or stardust/replica/ exists (gate.sh's evidence) — both read from the working directory.
 * Anywhere else (redesign, reskin, a bare pair of records) the comparison runs as it always did, with one line saying
 * it is not counted. In a replica project the guard fails closed: without rounds.mjs (../../replica/scripts/ or
 * ../replica/), with a ledger that cannot be read or written, or with a state.json that cannot be read, nothing is
 * compared (exit 1); STARDUST_ROUND_CAP=0 compares without the refusal.
 *
 * Usage: node skills/diff/scripts/chrome-compare.mjs <source.json> <build.json> [options]
 *   --profile replica|functional   default replica
 *   --bar <ratio>                  open-state crop bar (default 0.02)
 *   --decisions <file>             default stardust/chrome/header-decisions.json
 *   --json <file>                  write the verdict (stardust/chrome/header-parity.json is what done-check reads)
 *   --src-shots <dir> / --build-shots <dir>   crop folders when not where the records say
 *   --stage prototype|local-build|published   the round's stage; default from the build record's URL, as gate.sh:
 *                                  a local URL ending in -proposed.html, any other local URL, anything else
 *   --rounds <dir>                 the ledger's folder, also where --status reads header-contract.json (default stardust/chrome)
 *   --status --page <source-url> --build <build-url>   no comparison: has the header contract a verdict at --stage
 *                                  (default from --build)? Without a contract: `header contract: NOT RECORDED —
 *                                  <the chrome-explore command for --page>` (exit 2) when stardust/state.json says
 *                                  flow "replica" — every page asks until one is recorded; a page with no header
 *                                  records a contract with no root and no control, which a build without one
 *                                  passes — and nothing (exit 0) in any other project. With a contract: nothing
 *                                  (exit 0) when its `url` is another page than --page (host and path); else one line:
 *                                  `header contract: PASS at this stage …` or `… CAPPED at this stage …` (exit 0),
 *                                  `… NOT COMPARED at this stage — <command>` or `… FAIL at this stage …` (exit 2).
 *                                  CAPPED needs more than a closed ledger: the stage's last verdict (--json, default
 *                                  <--rounds dir>/header-parity.json) with every open error classed in --decisions.
 *                                  gate.sh --full prints it at the prototype stage.
 * Exit: 0 no undecided error · 2 errors · 6 round refused by the cap · 1 usage, or the cap could not be checked.
 * `compareDocs`, `applyDecisions`, `findingKey`, `pairControls`, `pairLinks`, `stageOfBuild`, `samePage`,
 * `stageStatus`, `unclassedAt`, `replicaProject`, `CLASSES` are exported.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normName, watchLine } from './chrome-explore.mjs';

// The shared rules (contracts.mjs) live beside browser.mjs in the master skill's scripts dir: the plugin tree or the Setup step 7 copy.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
// Missing, --help still answers; the first comparison stops with the copy instruction.
const missing = () => { throw new Error('contracts.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); };
// a header link's identity: decoded lower-case pathname, extension/index/slash folded, query kept (lib/paths.mjs)
const { chromeHrefKey: hrefKey } = CONTRACTS ? await import(CONTRACTS.href) : { chromeHrefKey: missing };

// The round ledger is the replica skill's (one definition of a round and its cap): the plugin tree or the project copy.
const ROUNDS = ['../../replica/scripts/rounds.mjs', '../replica/rounds.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const LEDGER_STAGES = ['prototype', 'local-build', 'published'];
export const CLASSES = ['owner', 'instrument', 'accept-residual'];

const TOUCH_BELOW = 768;
const FAMILIES = new Set(['search', 'cart', 'account', 'locale', 'drawer']);
const AGENT = /^(agent|assistant|stardust|claude|codex|bot|auto)/i;
const REQUEST_BUDGET_SUFFIX = ' — not observed: the build record stopped at the request budget (run the build side with --max-requests 0)';
const absentEvidence = (incomplete, detail, severity = 'error') => ({ severity: incomplete ? 'warn' : severity, detail: `${detail}${incomplete ? REQUEST_BUDGET_SUFFIX : ''}` });

/** The decision key of a finding: `<id>@<width> <path>[ [action]]`. Pure. */
export const findingKey = (f) => `${f.id}@${f.width} ${f.path}${f.action ? ` [${f.action}]` : ''}`;

const openOf = (c) => ['click', 'hover', 'key'].find((a) => c.actions && c.actions[a] && c.actions[a].opened);

/** Pair the links of the two sides — the one rule wherever a source link meets a build link (header controls, panel
 * links): by name when both have one; failing that by address when a side has no name (an icon link, a label the recorder
 * could not read). Two different names at one address are two links. `once`: a build item pairs with one source item.
 * Returns [{ s, b, by: 'name' | 'address' | null }] in source order. Pure. */
export function pairLinks(src, bld, { name, addr, once = false }) {
  const used = new Set(); const pairs = src.map((s) => ({ s, b: null, by: null }));
  // an unpaired build item first; a list that is a set (panel links) may pair one twice
  const pick = (p, cands, by) => { const b = cands.find((x) => !used.has(x)) || (once ? null : cands[0]); if (b) { used.add(b); p.b = b; p.by = by; } };
  for (const p of pairs) {
    const n = name(p.s); if (!n) continue;
    const named = bld.filter((x) => name(x) === n); const k = addr(p.s);
    pick(p, [...named.filter((x) => addr(x) === k), ...named], 'name');
  }
  for (const p of pairs) {
    const n = name(p.s); const k = addr(p.s); if (p.b || k == null) continue;
    const at = bld.filter((x) => addr(x) === k && !(n && name(x)));
    pick(p, [...at.filter((x) => !name(x)), ...at], 'address');
  }
  return pairs;
}
// a pair made by address is worth a line when one side only has a name
const oneSided = (k, sName, bName) => `${k} (${sName ? `"${sName}" on the source` : `"${bName}" on the build`} only)`;
const linkText = (base, list) => ({ ...base, id: 'link-text', severity: 'warn', detail: `${list.length} link(s) paired by address, with text on one side only: ${list.slice(0, 4).join('; ')}${list.length > 4 ? '; …' : ''}` });
const controlAddr = (c) => (c.role === 'link' && c.href ? hrefKey(c.href) : null);

/** Pair two control lists: by name, a link without a name on one side by its address (pairLinks), then by family in
 * order. Returns [source, build | null, 'name' | 'address' | 'family' | null]. Pure. */
export function pairControls(src, bld) {
  const pairs = pairLinks(src, bld, { name: (c) => c.key, addr: controlAddr, once: true });
  const used = new Set(pairs.map((p) => p.b));
  for (const p of pairs) {
    if (p.b || !FAMILIES.has(p.s.kind)) continue;
    const b = bld.find((x) => !used.has(x) && x.kind === p.s.kind);
    if (b) { used.add(b); p.b = b; p.by = 'family'; }
  }
  return pairs.map((p) => [p.s, p.b, p.by]);
}

const searchControls = (cs, out = []) => { for (const c of cs || []) { if (c.role === 'input' && c.kind === 'search') out.push(c); searchControls(c.children, out); } return out; };

function compareState(ss, bs, base, { profile, add, visual }, full) {
  // content, motion and crops once per control (the first action both sides open on); keyboard facts per action
  if (ss.tabReachesPanel && bs.tabReachesPanel === false) add({ ...base, id: 'keyboard', severity: 'error', detail: 'Tab moves into the panel on the source, not on the build' });
  if (!full) return;
  const text = (l) => normName(l.text); const addr = (l) => hrefKey(l.href);
  const missing = []; const moved = []; const untexted = [];
  for (const { s: l, b: m, by } of pairLinks(ss.panel.links, bs.panel.links, { name: text, addr })) {
    if (!m) missing.push(l.text || l.href);
    else if (by === 'name') { if (addr(m) !== addr(l)) moved.push(`${l.text}: ${addr(l)} → ${addr(m)}`); }
    else if (!!text(l) !== !!text(m)) untexted.push(oneSided(addr(l), l.text, m.text));
  }
  if (untexted.length) add(linkText(base, untexted));
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
  const { width, add, budgetIncomplete = false } = ctx;
  const touch = width < TOUCH_BELOW; const untexted = [];
  for (const [s, b, by] of pairControls(src.filter((c) => c.role !== 'input'), bld.filter((c) => c.role !== 'input'))) {
    const p = path ? `${path} > ${s.name || s.kind}` : (s.name || s.kind);
    const base = { width, path: p };
    const sOpen = openOf(s);
    if (!b) {
      if (sOpen) add({ ...base, id: 'control-missing', ...absentEvidence(budgetIncomplete, `the source ${s.kind} control opens on ${sOpen}; the build has no control named "${s.name}"${FAMILIES.has(s.kind) ? ` or of family ${s.kind}` : ''}`) });
      else if (!path && s.role === 'link') add({ ...base, id: 'link-missing', ...absentEvidence(budgetIncomplete, `top-level link ${s.href ? hrefKey(s.href) : ''} not in the build header`, 'warn') });
      continue;
    }
    if (by === 'address' && !!s.key !== !!b.key) untexted.push(oneSided(controlAddr(s), s.name, b.name));
    const incomplete = budgetIncomplete || b.partial === 'request-budget';
    let full = true;
    for (const a of touch ? ['click', 'key'] : ['hover', 'click', 'key']) {
      const ss = s.actions && s.actions[a]; const observed = Object.hasOwn(b.actions || {}, a); const bs = b.actions && b.actions[a];
      const so = !!(ss && ss.opened); const bo = !!(bs && bs.opened);
      if (so && !bo) add({ ...base, action: a, id: a === 'key' ? 'keyboard' : 'state-missing', ...absentEvidence(incomplete && !observed, `opens on ${a === 'key' ? 'Enter' : a} on the source (${ss.panel.links.length} links); ${bs && bs.navigates ? `navigates to ${hrefKey(bs.navigates)} on the build` : b.role === 'link' ? `the build control is a plain link${b.href ? ` to ${hrefKey(b.href)}` : ''}` : 'nothing opens on the build'}`) });
      else if (!so && bo && !(ss && ss.navigates)) add({ ...base, action: a, id: 'state-extra', severity: 'warn', detail: `opens on ${a} on the build only` });
      else if (so && bo) { compareState(ss, bs, { ...base, action: a }, ctx, full); full = false; }
    }
    if (sOpen && openOf(b) && s.close) {
      for (const k of ['escape', 'outside', 'toggle', 'leave']) {
        if (s.close[k] === true && !(b.close && b.close[k] === true)) add({ ...base, id: 'close-path', ...absentEvidence(incomplete && !Object.hasOwn(b.close || {}, k), `${k === 'escape' ? 'Escape' : k === 'outside' ? 'a click outside' : k === 'toggle' ? 'clicking the trigger again' : 'moving the pointer away'} closes it on the source, not on the build`) });
      }
      if (s.close.focusReturn && !(b.close && b.close.focusReturn)) add({ ...base, id: 'keyboard', ...absentEvidence(incomplete && !Object.hasOwn(b.close || {}, 'focusReturn'), 'Escape returns focus to the trigger on the source, not on the build') });
    }
    if (sOpen && openOf(b) && !s.returns) walk(s.children || [], b.children || [], { ...ctx, budgetIncomplete: incomplete }, p);
  }
  if (untexted.length) add(linkText({ width, path: path || '(header)' }, untexted));
}

// The at-rest watch of the two records: a side whose watch could not run excluded nothing it should have (its states may
// hold the page's own content), so that is an error; a difference in what was excluded is said, as is a side without the record.
function compareWatch(sw, bw, width, add) {
  const sides = [['source', sw.watch], ['build', bw.watch]];
  const ok = (w) => w.status === 'ran' || w.status === 'not-triggered';
  for (const [side, w] of sides) if (w && !ok(w)) add({ width, path: `(${side})`, id: 'at-rest-watch', severity: 'error', detail: `${watchLine({ watch: w })}: explore the ${side} again` });
  if (sides.some(([, w]) => w && !ok(w)) || (!sw.watch && !bw.watch)) return;
  const n = (w) => (w && w.status === 'ran' ? w.excluded || 0 : 0);
  // a side recorded before the watch existed, against one where the watch had nothing to do: nothing was excluded on either
  const idle = (w) => !w || w.status === 'not-triggered';
  if (idle(sw.watch) && idle(bw.watch)) return;
  if (!sw.watch || !bw.watch || n(sw.watch) !== n(bw.watch)) add({ width, path: '(page)', id: 'at-rest-watch', severity: 'warn', detail: `${sides.map(([side, w]) => `${side} ${watchLine({ watch: w })}`).join(' | ')}${sides.some(([, w]) => !w) ? ' — explore the side without the record again to compare what was excluded' : ''}` });
}

/** All findings except the crop pixels (returned as `visual` pairs for the image pass). Pure. */
export function compareDocs(src, bld, { profile = 'replica' } = {}) {
  const findings = []; const visual = [];
  const add = (f) => findings.push(f);
  for (const [w, sw] of Object.entries(src.widths || {})) {
    const width = Number(w);
    const bw = (bld.widths || {})[w];
    if (!bw) { add({ width, path: '(page)', id: 'width-missing', severity: 'error', detail: `the build was not explored at ${w}` }); continue; }
    const budgetIncomplete = bw.truncated === 'request-budget';
    const addBuildTruncation = () => { if (bw.truncated) add({ width, path: '(build)', id: 'budget-truncated', severity: 'warn', detail: `the build record stopped at ${bw.truncated}${budgetIncomplete ? ': run the build side with --max-requests 0' : ''}` }); };
    if (!bw.root && sw.root) { add({ width, path: '(page)', id: 'control-missing', ...absentEvidence(budgetIncomplete, 'no header root on the build') }); addBuildTruncation(); continue; }
    walk(sw.controls || [], bw.controls || [], { width, add, profile, visual, budgetIncomplete }, '');
    compareWatch(sw, bw, width, add);
    const ssr = searchControls(sw.controls); const bsr = searchControls(bw.controls);
    if (ssr.length && !bsr.length) add({ width, path: 'search', id: 'control-missing', ...absentEvidence(budgetIncomplete, 'the source header has a search input; the build none') });
    else if (ssr.length) {
      const s = ssr[0].search; const buildInput = bsr[0]; const b = buildInput.search;
      if (s) {
        const capped = b === null && buildInput.skipped === 'typeahead-cap';
        const capSuffix = capped ? ' — not observed: the build input was skipped past --max-typeahead' : '';
        if ((s.typeahead.links || s.typeahead.options) && !(b && b.typeahead && (b.typeahead.links || b.typeahead.options))) {
          const unobserved = budgetIncomplete && !b;
          add({ width, path: 'search', id: 'state-missing', action: 'type', severity: unobserved || capped ? 'warn' : 'error', detail: `typing "${s.probe}" shows ${s.typeahead.links || s.typeahead.options} suggestion(s) on the source, none on the build${unobserved ? REQUEST_BUDGET_SUFFIX : capSuffix}` });
        }
        if (s.submit && !(b && b.submit)) {
          const unobserved = budgetIncomplete && !b;
          add({ width, path: 'search', id: 'state-missing', action: 'submit', severity: unobserved || capped ? 'warn' : 'error', detail: `Enter submits to ${hrefKey(s.submit)} on the source; nothing on the build${unobserved ? REQUEST_BUDGET_SUFFIX : capSuffix}` });
        }
        else if (s.submit && b.submit && hrefKey(s.submit).split('?')[0] !== hrefKey(b.submit).split('?')[0]) add({ width, path: 'search', id: 'link-href', action: 'submit', severity: 'warn', detail: `submits to ${hrefKey(s.submit)} on the source, ${hrefKey(b.submit)} on the build` });
      }
    }
    const sev = profile === 'replica' ? 'error' : 'warn';
    for (const s of sw.scroll || []) {
      const b = (bw.scroll || []).find((x) => x.at === s.at);
      if (!b) { if ((bw.scroll || []).length) add({ width, path: '(header)', id: 'scroll-state', ...absentEvidence(budgetIncomplete, `no ${s.at} sample on the build`, sev) }); continue; }
      const pin = (x) => (x.position === 'fixed' || x.position === 'sticky' ? 'pinned' : 'static');
      if (s.inView !== b.inView || pin(s) !== pin(b)) add({ width, path: '(header)', action: s.at, id: 'scroll-state', severity: sev, detail: `scrolled ${s.at}: the source header is ${pin(s)} and ${s.inView ? 'in view' : 'out of view'}, the build's ${pin(b)} and ${b.inView ? 'in view' : 'out of view'}` });
      else if (Math.abs(s.height - b.height) > Math.max(8, 0.1 * s.height)) add({ width, path: '(header)', action: s.at, id: 'scroll-state', severity: sev, detail: `scrolled ${s.at}: header ${s.height}px on the source, ${b.height}px on the build` });
    }
    if (sw.truncated) add({ width, path: '(source)', id: 'budget-truncated', severity: 'warn', detail: `the source record stopped at ${sw.truncated}: raise --max-states/--max-depth for full coverage` });
    addBuildTruncation();
  }
  return { findings, visual: profile === 'replica' ? visual : [] };
}

/** Mark findings cleared by a valid site-owner decision, and write the class of an entry that has one beside its
 * finding (`classed`: it clears nothing, anyone may record it, for one exact key; such an entry clears only with the
 * owner's `decision`, `by` and `at` as well); invalid entries become warnings. Pure. */
export function applyDecisions(findings, decisions = []) {
  const valid = []; const classes = []; const out = [...findings];
  const ignored = (d, why) => out.push({ width: 0, path: '(decisions)', id: 'decision-invalid', severity: 'warn', detail: `ignored: ${d && d.finding ? d.finding : '(no finding)'} — ${why}` });
  for (const d of decisions) {
    const signed = !!(d && d.finding && d.by && d.at && !AGENT.test(String(d.by)));
    if (d && d.finding && d.class !== undefined) {
      if (!CLASSES.includes(d.class) || !String(d.reason || '').trim() || String(d.finding).endsWith('*')) ignored(d, `a class is one of ${CLASSES.join(' | ')}, with a \`reason\`, for one finding key (no prefix*)`);
      else classes.push(d);
      if (signed && d.decision) valid.push(d);
      continue;
    }
    if (!signed) { ignored(d, 'a decision needs the site owner\'s `by` and `at`'); continue; }
    valid.push(d);
  }
  for (const f of out) {
    if (f.severity !== 'error') continue;
    const k = findingKey(f);
    const d = valid.find((x) => (x.finding.endsWith('*') ? k.startsWith(x.finding.slice(0, -1)) : k === x.finding));
    if (d) f.decided = { decision: d.decision || 'accepted', by: d.by, at: d.at, reason: d.reason || '' };
    const c = classes.find((x) => x.finding === k);
    if (c) f.classed = { class: c.class, reason: String(c.reason).trim(), ...(c.at ? { at: c.at } : {}) };
  }
  return out;
}

/** The stage of a comparison from the build's URL — gate.sh's rule (its --help § Stage). Pure. */
export function stageOfBuild(url) {
  const u = String(url || '');
  if (!/^(http:\/\/localhost|http:\/\/127\.0\.0\.1|file:)/.test(u)) return 'published';
  return /-proposed\.html$/.test(u.split(/[?#]/)[0]) ? 'prototype' : 'local-build';
}

/** Do two URLs name one page? Host (www. folded) and path (index file and trailing slash folded); scheme, query and fragment do not count. Pure. */
export function samePage(a, b) {
  const key = (u) => { try { const x = new URL(u); return `${x.hostname.toLowerCase().replace(/^www\./, '')}${decodeURIComponent(x.pathname).toLowerCase().replace(/\/index\.[a-z0-9]+$/, '/').replace(/\/+$/, '')}`; } catch { return null; } };
  const ka = key(a); return ka !== null && ka === key(b);
}

const classCounts = (list) => CLASSES.map((c) => [list.filter((f) => f.classed && f.classed.class === c).length, c]).filter(([n]) => n).map(([n, c]) => `${n} ${c}`).join(', ');

/** Is the working directory a replica project? state.json's `flow` (done-check's and qa's signal) or gate.sh's evidence
 * folder. → { replica, why } ; throws when state.json is there and cannot be read (the flow cannot be told). */
export function replicaProject(root = '.') {
  const sf = join(root, 'stardust', 'state.json');
  let flow = null;
  if (existsSync(sf)) { try { flow = JSON.parse(readFileSync(sf, 'utf8')).flow || null; } catch (e) { throw new Error(`${join('stardust', 'state.json')} cannot be read (${e.message}), so the flow cannot be told`); } }
  if (flow === 'replica') return { replica: true, why: 'stardust/state.json flow "replica"' };
  if (existsSync(join(root, 'stardust', 'replica'))) return { replica: true, why: 'stardust/replica/ exists' };
  return { replica: false, why: `${flow ? `stardust/state.json flow "${flow}"` : 'no flow "replica" in stardust/state.json'} and no stardust/replica/` };
}

/** What keeps a closed stage from being "capped": null when the stage's last verdict (`parity`) has every open error
 * classed by the decisions file as it is now, else the reason. A closing decision alone is not a class. Pure. */
export function unclassedAt(parity, stage, decisions = []) {
  if (!parity || !Array.isArray(parity.findings)) return 'no verdict file of the comparison';
  if (parity.stage !== stage) return `the verdict file is of the ${parity.stage || 'unknown'} stage`;
  const open = applyDecisions(parity.findings.filter((f) => f.id !== 'decision-invalid').map(({ classed, decided, ...f }) => f), decisions).filter((f) => f.severity === 'error' && !f.decided);
  const none = open.filter((f) => !f.classed).length;
  return none ? `${none} of ${open.length} error(s) have no class` : null;
}

/** The header contract's verdict at a stage, for the page a round gates (--status). `contract`: the parsed contract or
 * null; `t`: rounds.mjs `tally` of the stage; `unclassed`: unclassedAt() of a closed stage. → null (nothing to say: no
 * contract, or it was recorded on another page) or { rc, line }. Pure. */
export function stageStatus({ contract, page, t, command, decisions, unclassed = null }) {
  if (!contract || !samePage(contract.url, page)) return null;
  const n = `${t.counted} counted round${t.counted === 1 ? '' : 's'}`;
  if (t.last && t.last.verdict === 'pass') return { rc: 0, line: `header contract: PASS at this stage (${n})` };
  if (t.closed && unclassed) return { rc: 2, line: `header contract: FAIL at this stage — closed in the ledger by ${t.closed.decision}, but ${unclassed}: record a class per remaining error in ${decisions} (chrome-compare.mjs --help § Round cap), then ${command}` };
  if (t.closed) return { rc: 0, line: `header contract: CAPPED at this stage — ${n}, closed by ${t.closed.decision}: ${t.closed.reason}` };
  if (!t.rounds) return { rc: 2, line: `header contract: NOT COMPARED at this stage — ${command}` };
  return { rc: 2, line: `header contract: FAIL at this stage — ${n} of ${t.allowance}, the last one a FAIL: ${t.counted < t.allowance ? 'fix the header, then' : `record a class per remaining error in ${decisions} (chrome-compare.mjs --help § Round cap), then`} ${command}` };
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
  const status = argv.includes('--status');
  const [sf, bf] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--status'));
  const usage = (why) => { console.error(`${why ? `chrome-compare: ${why}\n` : ''}usage: chrome-compare.mjs <source.json> <build.json> [--profile replica|functional] [--bar 0.02] [--decisions f] [--json f] [--stage s] [--rounds dir] | --status --page <url> --build <url> (see --help)`); process.exit(1); };
  if (status ? !arg('page') || !arg('build') : !sf || !bf || !existsSync(sf) || !existsSync(bf)) usage();
  const dir = arg('rounds', join('stardust', 'chrome'));
  const df = arg('decisions', join('stardust', 'chrome', 'header-decisions.json'));
  const profile = arg('profile', 'replica');
  const me = process.argv[1] && existsSync(process.argv[1]) ? relative(process.cwd(), process.argv[1]) : 'stardust/scripts/diff/chrome-compare.mjs';

  if (status) {
    // gate.sh's question (no comparison, no write): nothing without a contract; an unreadable contract or ledger is an error, never "compared".
    const cf = join(dir, 'header-contract.json');
    if (!existsSync(cf)) {
      // never recorded: asked of every page in a replica project by state.json's flow (gate.sh makes stardust/replica/ itself, so the folder tells nothing here)
      const sf = join('stardust', 'state.json');
      if (!existsSync(sf) || JSON.parse(readFileSync(sf, 'utf8')).flow !== 'replica') process.exit(0);
      console.log(`header contract: NOT RECORDED — node ${join(dirname(me), 'chrome-explore.mjs')} "${arg('page')}" ${cf}`);
      process.exit(2);
    }
    const contract = JSON.parse(readFileSync(cf, 'utf8'));
    const stage = arg('stage', stageOfBuild(arg('build')));
    if (!LEDGER_STAGES.includes(stage)) usage(`--stage is one of ${LEDGER_STAGES.join(' | ')} (got ${stage})`);
    if (!ROUNDS) throw new Error('rounds.mjs not found (looked in ../../replica/scripts/ and ../replica/): copy the replica skill\'s scripts dir to stardust/scripts/replica/');
    const R = await import(ROUNDS.href);
    const { ledger, source } = R.load(dir);
    if (source !== 'ledger' && existsSync(join(dir, 'rounds.json'))) throw new Error(`${join(dir, 'rounds.json')} is not a readable round ledger: repair or delete it`);
    const build = join(dir, 'header-build.json'); const widths = Object.keys(contract.widths || {}).join(',');
    const command = `node ${join(dirname(me), 'chrome-explore.mjs')} "${arg('build')}" ${build}${widths ? ` --width ${widths}` : ''} --max-requests 0 --pace-ms 0 --reload-pause-ms 0 && node ${me} ${cf} ${build} --profile ${profile} --json ${join(dir, 'header-parity.json')}`;
    const t = R.tally(ledger, stage); const pf = arg('json', join(dir, 'header-parity.json'));
    const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
    const unclassed = t.closed ? unclassedAt(read(pf, null), stage, read(df, {}).decisions || []) : null;
    const s = stageStatus({ contract, page: arg('page'), t, command, decisions: df, unclassed });
    if (s) console.log(s.line);
    process.exit(s ? s.rc : 0);
  }

  const src = JSON.parse(readFileSync(sf, 'utf8')); const bld = JSON.parse(readFileSync(bf, 'utf8'));
  const bar = Number(arg('bar', 0.02));
  const stage = arg('stage', stageOfBuild(bld.url));
  if (!LEDGER_STAGES.includes(stage)) usage(`--stage is one of ${LEDGER_STAGES.join(' | ')} (got ${stage})`);
  // Round cap (header § Round cap): the ledger is read and written BEFORE anything is compared — a cap that cannot be
  // checked or kept refuses the comparison (exit 1); only STARDUST_ROUND_CAP=0 compares without it.
  const capOff = process.env.STARDUST_ROUND_CAP === '0';
  let R = null; let ledger = null; let may = null; let project = { replica: true }; let uncounted = '';
  try {
    project = replicaProject();
    if (!project.replica) throw Object.assign(new Error(project.why), { notReplica: true });
    if (!ROUNDS) throw new Error('rounds.mjs not found (looked in ../../replica/scripts/ and ../replica/): copy the replica skill\'s scripts dir to stardust/scripts/replica/');
    R = await import(ROUNDS.href);
    mkdirSync(dir, { recursive: true });
    const l = R.load(dir);
    if (l.source !== 'ledger' && existsSync(join(dir, 'rounds.json'))) throw new Error(`${join(dir, 'rounds.json')} is not a readable round ledger: repair or delete it`);
    ledger = l.ledger; R.save(dir, ledger);
    may = R.mayRun(ledger, stage);
  } catch (e) {
    if (e.notReplica) uncounted = `chrome-compare: not counted, no round cap — this is not a replica project (${e.message}); the cap is the replica flow's (--help § Round cap)`;
    else if (!capOff) { console.error(`chrome-compare: the round cap could not be checked — ${e.message} — so nothing is compared (STARDUST_ROUND_CAP=0 compares without the cap)`); process.exit(1); }
    else console.error(`chrome-compare: the round cap could not be checked — ${e.message} — the comparison runs uncounted (STARDUST_ROUND_CAP=0)`);
    R = null;
  }
  const { findings, visual } = compareDocs(src, bld, { profile });
  findings.push(...await visualFindings(visual, { srcDir: arg('src-shots', src.shots || '.'), buildDir: arg('build-shots', bld.shots || '.'), bar }));
  const all = applyDecisions(findings, existsSync(df) ? (JSON.parse(readFileSync(df, 'utf8')).decisions || []) : []);
  const errors = all.filter((f) => f.severity === 'error' && !f.decided); const warns = all.filter((f) => f.severity === 'warn'); const decided = all.filter((f) => f.decided);
  const unclassed = errors.filter((f) => !f.classed);
  const refused = !!R && !may.ok && !capOff;
  const spent = () => { const t = R.tally(ledger, stage); return `${t.counted} of ${t.allowance} counted rounds`; };
  if (refused && unclassed.length) {
    const keys = unclassed.map(findingKey);
    console.error(`chrome-compare: comparison refused at the ${stage} stage (exit 6) — ${may.t.closed ? `the stage was closed after ${spent()}` : `${spent()} spent, the last one a FAIL`}, and ${unclassed.length} of ${errors.length} error(s) ${may.t.closed ? 'have' : 'still have'} no class. Record one per finding in ${df} — { "decisions": [{ "finding": "<key>", "class": "${CLASSES.join('|')}", "reason": "<owner: the dynamics row or the third party; instrument: the defect and its evidence>" }] } — and run this again: it then exits 2 with the classes in the verdict (a class clears nothing; only the site owner does).${may.t.closed ? '' : ` A round lost to an instrument defect: node ${relative(process.cwd(), fileURLToPath(ROUNDS))} decide ${dir} --stage ${stage} --decision extend --reason "<the evidence file in ${dir} and the defect>".`} No class: ${keys.slice(0, 12).join('; ')}${keys.length > 12 ? `; … (+${keys.length - 12})` : ''}`);
    process.exit(6);
  }
  // The ledger first, the verdict after: a comparison the ledger could not keep is not a verdict.
  let round = null; let roundLine = '';
  try {
    if (R && refused && errors.length) {
      if (!may.t.closed) {
        const d = R.decide(ledger, stage, 'accept-residual', `${errors.length} header-contract error(s) classed (${classCounts(errors)}) in ${df}`);
        if (d.error) throw new Error(d.error);
        R.save(dir, ledger);
      }
      roundLine = `chrome-compare: ${stage} stage — capped after ${spent()}: every remaining error has a class (${classCounts(errors)}), the stage is closed and this comparison is not counted`;
    } else if (R) {
      const t0 = R.tally(ledger, stage);
      round = R.record(ledger, stage, `compare-${t0.rounds + 1}`, errors.length ? 'fail' : 'pass');
      R.save(dir, ledger);
      const m = R.mayRun(ledger, stage);
      roundLine = `chrome-compare: ${stage} stage — recorded "${round.label}" ${round.verdict} as ${round.kind}: ${spent()}${!m.ok && !m.t.closed ? ` — cap reached: the next comparison at this stage exits 6 until every remaining error has a class in ${df} (--help § Round cap)` : ''}`;
    }
  } catch (e) {
    console.error(`chrome-compare: the round could not be recorded in ${join(dir, 'rounds.json')} — ${e.message} — so this comparison is not a verdict${capOff ? ' (STARDUST_ROUND_CAP=0: its findings follow)' : ''}`);
    if (!capOff) process.exit(1);
  }
  for (const f of [...errors, ...warns]) console.log(`${f.severity === 'error' ? '🔴' : '🟡'} ${findingKey(f)} — ${f.detail}${f.classed ? ` [class ${f.classed.class}: ${f.classed.reason}]` : ''}`);
  const widths = Object.keys(src.widths || {}).map(Number);
  const verdict = { tool: 'chrome-compare', at: new Date().toISOString(), source: src.url, build: bld.url, profile, bar, widths, stage, ...(round ? { round: { label: round.label, kind: round.kind } } : {}), ...(refused && errors.length ? { capped: true } : {}), counts: { error: errors.length, warn: warns.length, decided: decided.length, classed: errors.length - unclassed.length }, findings: all.map((f) => ({ key: findingKey(f), ...f })) };
  const out = arg('json', null);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(verdict, null, 1)}\n`); }
  console.log(`chrome-compare: ${errors.length} error(s), ${warns.length} warning(s), ${decided.length} decided (profile ${profile}, widths ${widths.join(',')})${errors.length > unclassed.length ? ` — classes: ${classCounts(errors)}${unclassed.length ? `, ${unclassed.length} without` : ''}` : ''}${out ? ` → ${out}` : ''}`);
  if (roundLine || uncounted) console.log(roundLine || uncounted);
  process.exit(errors.length ? 2 : 0);
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
if (process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === self; } catch { return false; } })()) main().catch((e) => { console.error(`chrome-compare: ${e.message}`); process.exit(1); });
