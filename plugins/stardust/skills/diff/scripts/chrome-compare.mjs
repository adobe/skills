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
 * The one rule for header findings (diff/SKILL.md § The header contract, the handoff contract and replica/SKILL.md
 * quote it word for word): Fix or decide every error (hands-off: you decide, with a reason). In a hands-off run
 * (`stardust/state.json` `handsOff: true`) the agent is the deciding party: `chrome-compare.mjs decide <finding>
 * --decision accept|fix-later|artefact --reason "<r>"` signs `{ finding, decision, reason, by: "agent", at }` into
 * `stardust/chrome/header-decisions.json`, one exact finding key per entry, with a reason of at least 40 characters
 * naming the evidence (a measurement artefact, a host-bound feature, a third-party component, a hide-list offset);
 * chrome-compare counts it as decided and lists it in `decidedByAgent` for the owner's review. In an attended run
 * (`handsOff` false or absent) only the site owner clears a finding (`by`, `at`); an agent-signed entry is ignored
 * and reported.
 * The owner's entry ({ finding: "<key or prefix*>", decision, reason, by, at }) wins over the agent's for the same key;
 * an agent word anywhere in `by` (subagent, the agent, a bot) makes it the agent's; an entry without `by`/`at`, or a
 * bare `*` key, is ignored and reported too.
 *
 * Usage: node skills/diff/scripts/chrome-compare.mjs <source.json> <build.json> [options]
 *   --profile replica|functional   default replica
 *   --bar <ratio>                  open-state crop bar (default 0.02)
 *   --decisions <file>             default stardust/chrome/header-decisions.json ({ decisions: [ … ] })
 *   --state <file>                 default stardust/state.json — `handsOff: true` makes the run hands-off (absent → attended)
 *   --json <file>                  write the verdict (stardust/chrome/header-parity.json is what done-check reads): with
 *                                  `handsOff`, `counts.decidedByAgent` and `decidedByAgent[]` ({ key, decision, reason, at })
 *   --src-shots <dir> / --build-shots <dir>   crop folders when not where the records say
 *   --hide <sel,…>                 the hide list both records must carry (chrome-explore --hide); repeatable
 *   --slug <slug>                  the page's key in presence.json: its `hide` too, after "*"'s (optional)
 *   --presence <file>              the same from a gate dir's presence.json `hide` ("*", then the slug; needs --slug)
 * The site-wide stardust/replica/presence.json is read by default as chrome-explore reads it (its "*" `hide`, plus the
 * --slug entry's; under --presence's file): when it names a selector, the expected list includes it even with no flag,
 * and the verdict's `hide.site` names it.
 * Records explored with different hide lists (or not the expected one) are not the same page: one error
 * `hide-mismatch`; `hide: { source, build, expected, consistent, site? }` is printed and in the verdict when any is set.
 * A crop difference the hide list explains is `info`, never an error: the panels' top edges differ by the height of
 * a region hidden at that width (±2 px; the records' `hide.perWidth`), the panels are as wide, the lower one is at
 * most that much shorter (the viewport clipped it), and the shared, top-aligned area is within the bar — the finding
 * carries `evidence: { kind: "hide-offset", region, h, dy, shared }`.
 * An error on a source state chrome-explore marked `unstable` (it sampled differently on a fresh page; the contract
 * header's `stability`) is a warning, its detail ending "(source state unstable: sampled differently on a fresh page)".
 * Printed: a 🔴 / 🟡 / ⚪ (info) line per finding, a `🔵 decided by the agent: <key> — <decision>: <reason> (<at>)`
 * line per agent decision, the hide line, then the counts (hands-off: `N decided (n by the agent, hands-off — …)`).
 * Exit: 0 no undecided error · 2 errors · 1 usage, or a malformed presence.json named on stderr (--presence's file, or the
 * cwd's stardust/replica/presence.json — refused with no flag too).
 *
 *        node skills/diff/scripts/chrome-compare.mjs decide <finding> --decision accept|fix-later|artefact --reason "<r>"
 *          [--decisions <file>] [--state <file>]
 * Writes the agent's entry into the decisions file (atomic): the same entry again changes nothing, a changed decision
 * or reason replaces it, a site owner's entry for the key is kept and nothing is written.
 * Exit: 0 recorded or unchanged · 1 usage (no key, a prefix* key, another decision, a reason under 40 characters, an
 * unreadable decisions file) · 3 refused: an attended run (the owner sentence on stderr).
 * `compareDocs`, `compareHide`, `applyDecisions`, `decideEntry`, `hideOffset`, `visualFindings`, `findingKey`,
 * `DECISION_RULE` are exported.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { effectiveHide, hideArgs, normName, unstableAsWarn } from './chrome-explore.mjs';

const TOUCH_BELOW = 768;
const FAMILIES = new Set(['search', 'cart', 'account', 'locale', 'drawer']);
const AGENT = /^(agent|assistant|stardust|claude|codex|bot|auto)/i;

// an agent word anywhere in `by` ("subagent", "the agent", "migration bot") signs as the agent, never as the owner
const AGENT_WORD = /\b(sub-?)?agents?\b|\bassistants?\b|\bai\b|\bllms?\b|\bmodels?\b|\bbots?\b|\bstardust\b/i;
const isAgent = (by) => AGENT.test(String(by).trim()) || AGENT_WORD.test(String(by));

export const DECISIONS = ['accept', 'fix-later', 'artefact'];
export const MIN_REASON = 40;
export const DECISION_RULE = 'Fix or decide every error (hands-off: you decide, with a reason). In a hands-off run (`stardust/state.json` `handsOff: true`) the agent is the deciding party: `chrome-compare.mjs decide <finding> --decision accept|fix-later|artefact --reason "<r>"` signs `{ finding, decision, reason, by: "agent", at }` into `stardust/chrome/header-decisions.json`, one exact finding key per entry, with a reason of at least 40 characters naming the evidence (a measurement artefact, a host-bound feature, a third-party component, a hide-list offset); chrome-compare counts it as decided and lists it in `decidedByAgent` for the owner\'s review. In an attended run (`handsOff` false or absent) only the site owner clears a finding (`by`, `at`); an agent-signed entry is ignored and reported.';
const ATTENDED = 'an attended run: only the site owner clears a finding (`by`, `at`); an agent decides only in a hands-off run (`stardust/state.json` `handsOff: true`)';

/** True only when the state file reads `handsOff: true`; absent or unreadable → false (an attended run). */
export function handsOffOf(file = join('stardust', 'state.json')) {
  try { return JSON.parse(readFileSync(file, 'utf8')).handsOff === true; } catch { return false; }
}

/** The decisions file's entries ([] when absent); a malformed file throws. */
export const readDecisions = (file) => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).decisions || []) : []);

/** Why an agent-signed entry does not count, or null. Pure. */
export function agentDecisionInvalid(d, { handsOff = false } = {}) {
  if (!handsOff) return ATTENDED;
  if (String(d.finding).endsWith('*')) return 'an agent decides one exact finding key per entry (no prefix*)';
  if (!DECISIONS.includes(d.decision)) return `an agent decision is accept, fix-later or artefact (got ${JSON.stringify(d.decision ?? null)})`;
  if (String(d.reason || '').trim().length < MIN_REASON) return `an agent decision needs a reason of at least ${MIN_REASON} characters naming the evidence (a measurement artefact, a host-bound feature, a third-party component, a hide-list offset)`;
  return null;
}

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
  if (ss.shot) visual.push({ ...base, src: ss.shot, build: bs.shot || null, srcRect: ss.panel.rect || null, buildRect: bs.panel.rect || null });
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

/** The hide lists the records were explored with (`hide.list`, absent = []) against each other and, when given, the
 * expected list (order-free) → { hide: { source, build, expected, consistent } | null (none set), finding | null }. Pure. */
export function compareHide(src, bld, expected = null) {
  const listOf = (d) => [...((d && d.hide && d.hide.list) || [])];
  const source = listOf(src); const build = listOf(bld);
  if (!source.length && !build.length && !(expected && expected.length)) return { hide: null, finding: null };
  const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  const target = expected || [...new Set([...source, ...build])];
  const off = [['source', source], ['build', build]].filter(([, l]) => !same(l, target)).map(([k]) => k);
  const hide = { source, build, expected, consistent: !off.length };
  if (!off.length) return { hide, finding: null };
  const show = (l) => `[${l.join(', ')}]`;
  const detail = `the records were not explored on the same page — hide lists: source ${show(source)}, build ${show(build)}${expected ? `, expected ${show(expected)}` : ''}; re-explore ${off.length > 1 ? 'both sides' : `the ${off[0]}`} with chrome-explore ${target.length ? `--hide ${target.join(',')}` : 'without --hide'}`;
  return { hide, finding: { width: 0, path: '(hide)', id: 'hide-mismatch', severity: 'error', detail } };
}

/** The regions hidden at a width, from either record's `hide.perWidth` (h > 0, the larger per selector). Pure. */
const hiddenAt = (docs, w) => {
  const m = new Map();
  for (const d of docs) for (const x of (d && d.hide && d.hide.perWidth && d.hide.perWidth[w]) || []) if (x && x.sel && x.h > 0) m.set(x.sel, Math.max(m.get(x.sel) || 0, x.h));
  return [...m].map(([sel, h]) => ({ sel, h }));
};

/** A crop difference the hide list explains: the panels' top edges differ by a hidden region's height (±2 px), the
 * panels as wide, and the lower panel at most |dy| shorter (the shift only lets the viewport clip its bottom) →
 * { region, h, dy, shared, within: shared ≤ bar } (the shared, top-aligned area judged), else null. Pure. */
export function hideOffset({ srcRect, buildRect, hidden = [], shared, bar }) {
  if (!srcRect || !buildRect || Math.abs(srcRect[2] - buildRect[2]) > 2) return null;
  const dy = srcRect[1] - buildRect[1];
  const [lower, upper] = dy > 0 ? [srcRect, buildRect] : [buildRect, srcRect];
  const lost = upper[3] - lower[3];
  if (!dy || lost < -2 || lost > Math.abs(dy) + 2) return null;
  const r = hidden.find((x) => x.h > 0 && Math.abs(Math.abs(dy) - x.h) <= 2);
  return r ? { region: r.sel, h: r.h, dy, shared, within: shared <= bar } : null;
}

/** All findings except the crop pixels (returned as `visual` pairs for the image pass, with both panel rects and the
 * regions hidden at their width); `hide` when a hide list is set on either record or expected (`expectedHide`). Pure. */
export function compareDocs(src, bld, { profile = 'replica', expectedHide = null } = {}) {
  const findings = []; const visual = [];
  const add = (f) => findings.push(f);
  const { hide, finding } = compareHide(src, bld, expectedHide);
  if (finding) add(finding);
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
  return { findings, visual: profile === 'replica' ? visual.map((p) => ({ ...p, hidden: hiddenAt([src, bld], p.width) })) : [], ...(hide ? { hide } : {}) };
}

/** Mark the error findings a valid decision clears: a site owner's (exact or prefix*) in any run, an agent's (exact,
 * accept|fix-later|artefact, reason ≥ 40 characters) only when `handsOff`, marked `decided.agent`; the owner's wins.
 * Invalid entries become `decision-invalid` warnings naming why. Pure. */
export function applyDecisions(findings, decisions = [], { handsOff = false } = {}) {
  const owner = []; const agent = []; const out = [...findings];
  const ignore = (d, why) => out.push({ width: 0, path: '(decisions)', id: 'decision-invalid', severity: 'warn', detail: `ignored: ${d && d.finding ? d.finding : '(no finding)'} — ${why}` });
  for (const d of decisions) {
    if (!d || !d.finding || !d.by || !d.at) { ignore(d, 'a decision needs the site owner\'s `by` and `at`'); continue; }
    if (String(d.finding).trim() === '*') { ignore(d, 'a bare `*` would clear every finding — name a key (or, the owner, a prefix*)'); continue; }
    if (!isAgent(d.by)) { owner.push(d); continue; }
    const why = agentDecisionInvalid(d, { handsOff });
    if (why) ignore(d, why); else agent.push(d);
  }
  for (const f of out) {
    if (f.severity !== 'error') continue;
    const k = findingKey(f);
    const o = owner.find((x) => (x.finding.endsWith('*') ? k.startsWith(x.finding.slice(0, -1)) : k === x.finding));
    const a = o ? null : agent.find((x) => x.finding === k);
    const d = o || a;
    if (d) f.decided = { decision: d.decision || 'accepted', by: d.by, at: d.at, reason: d.reason || '', ...(a ? { agent: true } : {}) };
  }
  return out;
}

/** The decisions document with the agent's entry for `finding` → { doc, status: recorded|replaced|unchanged|owner }:
 * one agent entry per key; the same decision and reason again change nothing; a site owner's entry for the key is
 * kept and nothing is added. Pure. */
export function decideEntry(doc, { finding, decision, reason, at }) {
  const decisions = Array.isArray(doc && doc.decisions) ? doc.decisions : [];
  if (decisions.some((d) => d && d.finding === finding && d.by && d.at && !isAgent(d.by))) return { doc, status: 'owner' };
  const entry = { finding, decision, reason, by: 'agent', at };
  const i = decisions.findIndex((d) => d && d.finding === finding && d.by && isAgent(d.by));
  if (i < 0) return { doc: { ...doc, decisions: [...decisions, entry] }, status: 'recorded' };
  if (decisions[i].decision === decision && decisions[i].reason === reason) return { doc, status: 'unchanged' };
  return { doc: { ...doc, decisions: decisions.map((d, j) => (j === i ? entry : d)) }, status: 'replaced' };
}

const loadDep = async (name) => {
  try { const req = createRequire(join(process.cwd(), 'package.json')); const m = await import(pathToFileURL(req.resolve(name)).href); return m.default || m; } catch { /* fall through */ }
  const m = await import(name); return m.default || m;
};

/** Crop pairs → ratio of differing pixels over the union box (size differences count as different); a difference the
 * hide list explains (hideOffset, shared area within the bar) is `info` with its `evidence`. */
export async function visualFindings(pairs, { srcDir, buildDir, bar }) {
  if (!pairs.length) return [];
  const bare = ({ src, build, srcRect, buildRect, hidden, ...f }) => f;
  let PNG; let pixelmatch;
  try { ({ PNG } = await loadDep('pngjs')); pixelmatch = await loadDep('pixelmatch'); } catch { return pairs.map((p) => bare({ ...p, id: 'panel-visual', severity: 'error', detail: 'crops not compared: pngjs + pixelmatch are not installed in this project' })); }
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
    if (ratio <= bar) continue;
    const shared = diff / (w * h);
    const off = hideOffset({ srcRect: p.srcRect, buildRect: p.buildRect, hidden: p.hidden, shared, bar });
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    if (off && off.within) {
      out.push({ ...p, id: 'panel-visual', severity: 'info', detail: `open-state crop differs by ${pct(ratio)} (bar ${(bar * 100).toFixed(0)}%; source ${a.width}×${a.height}, build ${b.width}×${b.height}), shared area ${pct(shared)}: the source panel sits ${Math.abs(off.dy)}px ${off.dy > 0 ? 'lower' : 'higher'} than the build's — the height of the hidden region ${off.region} (${off.h}px): a hide-list offset, a measurement artefact`, evidence: { kind: 'hide-offset', region: off.region, h: off.h, dy: off.dy, shared: Math.round(shared * 10000) / 10000 } });
      continue;
    }
    out.push({ ...p, id: 'panel-visual', severity: 'error', detail: `open-state crop differs by ${pct(ratio)} (bar ${(bar * 100).toFixed(0)}%; source ${a.width}×${a.height}, build ${b.width}×${b.height}; texture ${thickPct}% thick${thickPct <= 15 && a.width === b.width && a.height === b.height ? ', thin-edge: glyph antialiasing, a font substitution the site owner can accept' : ''})${off ? `; the offset equals the hidden region ${off.region} (${off.h}px), but the shared area differs by ${pct(shared)}` : ''}` });
  }
  return out.map(bare);
}

function decideMain(argv) {
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const finding = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  const decision = arg('decision', null); const reason = arg('reason', '');
  const df = arg('decisions', join('stardust', 'chrome', 'header-decisions.json')); const sf = arg('state', join('stardust', 'state.json'));
  const usage = (why) => { console.error(`chrome-compare decide: ${why}\nusage: chrome-compare.mjs decide <finding> --decision ${DECISIONS.join('|')} --reason "<r>" [--decisions f] [--state f]`); process.exit(1); };
  if (!finding) usage('no finding key (copy it from the 🔴 line or the verdict\'s findings[].key)');
  const why = agentDecisionInvalid({ finding, decision, reason }, { handsOff: true });
  if (why) usage(why);
  if (!handsOffOf(sf)) { console.error(`chrome-compare decide: refused — ${ATTENDED}; the site owner signs ${df} (\`by\`, \`at\`)`); process.exit(3); }
  let doc = { decisions: [] };
  try { if (existsSync(df)) doc = JSON.parse(readFileSync(df, 'utf8')); } catch (e) { usage(`${df} unreadable (${e.message})`); }
  const { doc: next, status } = decideEntry(doc, { finding, decision, reason, at: new Date().toISOString() });
  if (status === 'owner') { console.log(`chrome-compare decide: the site owner already decided ${finding} in ${df}; nothing written`); return; }
  if (status === 'unchanged') { console.log(`chrome-compare decide: already recorded ${finding} — ${decision} (by agent) in ${df}; unchanged`); return; }
  mkdirSync(dirname(df), { recursive: true });
  const tmp = `${df}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 1)}\n`); renameSync(tmp, df);
  console.log(`chrome-compare decide: ${status} ${finding} — ${decision} (by agent) → ${df}; re-run chrome-compare to apply`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim()); process.exit(0); }
  if (argv[0] === 'decide') { decideMain(argv); return; }
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const [sf, bf] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  if (!sf || !bf || !existsSync(sf) || !existsSync(bf)) { console.error('usage: chrome-compare.mjs <source.json> <build.json> [--profile replica|functional] [--bar 0.02] [--decisions f] [--state f] [--json f] | decide <finding> --decision d --reason r'); process.exit(1); }
  let expected = null; let expectedSite = null;
  try {
    const h = hideArgs(argv);
    const e = effectiveHide(h);
    // the site-wide presence.json alone sets the expected list only when it names a selector
    if (h.hide.length || h.presence || e.entries.length) {
      if (e.found === false || (h.presence && !existsSync(h.presence))) console.error(`chrome-compare: ${e.note}`);
      expected = e.entries.map((x) => x.sel);
      expectedSite = e.site || null;
    }
  } catch (e) { console.error(`chrome-compare: ${e.message}`); process.exit(1); }
  const src = JSON.parse(readFileSync(sf, 'utf8')); const bld = JSON.parse(readFileSync(bf, 'utf8'));
  const profile = arg('profile', 'replica'); const bar = Number(arg('bar', 0.02));
  const { findings, visual, hide: compared } = compareDocs(src, bld, { profile, expectedHide: expected });
  const hide = compared && expectedSite ? { ...compared, site: expectedSite } : compared;
  findings.push(...await visualFindings(visual, { srcDir: arg('src-shots', src.shots || '.'), buildDir: arg('build-shots', bld.shots || '.'), bar }));
  const df = arg('decisions', join('stardust', 'chrome', 'header-decisions.json'));
  const stateFile = arg('state', null);
  if (stateFile && !existsSync(stateFile)) console.error(`chrome-compare: --state ${stateFile} not found — an attended run (agent decisions ignored)`);
  const handsOff = handsOffOf(stateFile || join('stardust', 'state.json'));
  const all = applyDecisions(unstableAsWarn(findings, src), readDecisions(df), { handsOff });
  const errors = all.filter((f) => f.severity === 'error' && !f.decided); const warns = all.filter((f) => f.severity === 'warn'); const decided = all.filter((f) => f.decided);
  const byAgent = decided.filter((f) => f.decided.agent); const infos = all.filter((f) => f.severity === 'info');
  for (const f of [...errors, ...warns, ...infos]) console.log(`${{ error: '🔴', warn: '🟡' }[f.severity] || '⚪'} ${findingKey(f)} — ${f.detail}`);
  for (const f of byAgent) console.log(`🔵 decided by the agent: ${findingKey(f)} — ${f.decided.decision}: ${f.decided.reason} (${f.decided.at})`);
  const widths = Object.keys(src.widths || {}).map(Number);
  const decidedByAgent = byAgent.map((f) => ({ key: findingKey(f), decision: f.decided.decision, reason: f.decided.reason, at: f.decided.at }));
  const verdict = { tool: 'chrome-compare', at: new Date().toISOString(), source: src.url, build: bld.url, profile, bar, widths, ...(hide ? { hide } : {}), handsOff, counts: { error: errors.length, warn: warns.length, info: infos.length, decided: decided.length, decidedByAgent: byAgent.length }, decidedByAgent, findings: all.map((f) => ({ key: findingKey(f), ...f })) };
  const out = arg('json', null);
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(verdict, null, 1)}\n`); }
  if (hide) { const show = (l) => `[${l.join(', ')}]`; console.log(`chrome-compare hide: source ${show(hide.source)} · build ${show(hide.build)} · expected ${hide.expected ? show(hide.expected) : 'not given'}${hide.site ? ` (with site ${hide.site})` : ''} → ${hide.consistent ? 'consistent' : 'INCONSISTENT'}`); }
  console.log(`chrome-compare: ${errors.length} error(s), ${warns.length} warning(s)${infos.length ? `, ${infos.length} info` : ''}, ${decided.length} decided${handsOff ? ` (${byAgent.length} by the agent, hands-off — for the owner's review)` : ''} (profile ${profile}, widths ${widths.join(',')})${out ? ` → ${out}` : ''}`);
  process.exit(errors.length ? 2 : 0);
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch { return ''; } })();
if (process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === self; } catch { return false; } })()) main().catch((e) => { console.error(`chrome-compare: ${e.message}`); process.exit(1); });
