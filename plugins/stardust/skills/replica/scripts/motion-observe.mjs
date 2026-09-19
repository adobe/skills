#!/usr/bin/env node
/**
 * skills/replica/scripts/motion-observe.mjs
 *
 * RUNTIME motion observation for the stardust:replica interaction-parity
 * pass. Records what the live page actually DOES — animation/transition
 * events, class/style/aria/hidden/childList mutations (the trigger
 * mechanisms), scroll-state chrome, widget mechanics, hover diffs, and the
 * state machines behind the page's own toggles — so the prototype implements
 * ONLY motion that measurably fired.
 *
 * Why observation, never inference (each is a field-recorded invention the
 * static-lift method produced, all caught in user review — recreation
 * procedure § Interaction parity owns the policy):
 *   - DEAD ANIMATION CLASSES: component CMSs stamp animation classes on many
 *     elements; the runtime JS adds the trigger class (.animate etc.) to only
 *     SOME (recorded: 2 of 8 caption-class families ever fired; 3 whole page
 *     types had zero firing entrances despite fully classed markup). Tagging
 *     from static classes animates elements the real site never animates.
 *   - DEAD-SCOPE HOVER RULES: a syntactically applicable :hover rule can be
 *     dead at runtime (scope condition, specificity loser, wrong variant).
 *     Only a measured hover diff justifies a hover rule in the prototype.
 *   - APPROXIMATED MECHANISMS: reproducing chrome morph as a different
 *     mechanism with a similar look (a cloned fixed bar) allows states
 *     impossible on live (double-rendered header). The class-mutation log +
 *     header timeline expose the REAL state machine to clone.
 *   - CLASS-ONLY BLINDNESS (schema 1): a tween library writes opacity/
 *     transform INLINE per frame (recorded: 267 of 312 mutated elements on a
 *     dealer site — zero class mutations), a dropdown opens via
 *     `aria-expanded` + `display:block` on its `aria-controls` target and a
 *     mobile menu is RE-PARENTED — none is a class mutation, so schema 1
 *     reported the chrome as dead and every agent hand-wrote a click probe.
 * Static source CSS remains the authority for exact keyframe/duration/easing
 * VALUES of the animations this instrument proves fired.
 *
 * What one run records, per live URL (schema 2):
 *   1. capture-phase animationstart/transitionstart listeners + ONE
 *      MutationObserver over class, style, aria-expanded, aria-hidden,
 *      hidden, open, data-state and a SCOPED childList — installed BEFORE any
 *      scrolling. Style mutations are aggregated PER ELEMENT (first/last
 *      inline opacity|transform|visibility, count, first y, duration — a
 *      per-frame writer would fill any per-mutation cap in one frame) and
 *      summarised into `entrances[]` by element family. Class mutations log
 *      added AND removed classes with y and scroll direction (a sticky
 *      banner's threshold needs the up/down pair — a one-way latch reads as
 *      "added three times, never removed"). aria/hidden/open/data-state
 *      mutations and scoped childList (header/footer/nav/menu/drawer/dialog
 *      paths and aria-controls targets — the re-parented mobile menu) are
 *      raw records, capped; each is paired to the click that preceded it by
 *      ≤ 300 ms and to its aria-controls target's display before/after →
 *      `stateMachines[]`. Without --click/--triggers that array fills only
 *      from the site's own scripted toggles.
 *   2. a full scroll traversal DOWN then UP with dense sampling near the top
 *      (scroll-chrome behavior differs by direction and near-top state),
 *      logging the header's computed state per position plus main/body
 *      paddingTop (layout compensation vs accepted content jump);
 *   3. --click <sel> (repeatable) widget pokes: scroll into view, click,
 *      sample 4 frames at 200ms — track transform/transition + indicator
 *      (dot) classes and computed size/color/transition;
 *   4. --hover <sel> (repeatable) hover diffs: computed transform/colors/
 *      shadow/opacity + transition-* longhands on the element and key
 *      sub-elements (fixed list ∪ descendants named by the page's own :hover
 *      rules) before vs after a REAL pointer hover, waiting for transitionend
 *      or ≥ 400 ms. "Not hovered" is distinct from "no change": a null/zero
 *      box → hovered:false reason no-box; a pointer intercepted by another
 *      element (elementFromPoint) → hovered:false reason intercepted, by
 *      <path>, WARN. :hover rules present but no measured change → WARN. The
 *      mouse is PARKED after each probe;
 *   5. --triggers auto: enumerate `[aria-expanded],[aria-haspopup],
 *      [aria-controls],header button,[role=tab],summary` (deduped; a[href]
 *      and [type=submit] skipped), run LAST (opened panels must not poison
 *      the hover probes), one at a time: click → transitionend/400 ms →
 *      sample → Escape, re-click if aria-expanded is still true → park. A
 *      trigger that navigates aborts the loop and is recorded navigated:true
 *      — the whole per-trigger body runs inside a try/catch keyed on
 *      isNavigationError, so a navigation landing after the flag check (or
 *      during the restore) still ends with the JSON written; the run and its
 *      live hit are never lost. Same page load — no extra live hits.
 *
 * Budget live hits like any other probe: ONE observation run per page,
 * reuse the JSON (bot-managed sites escalate to IP blocks within a few
 * automated hits — same rule as the gate captures). Autoplay widgets may
 * pause off-viewport: poke them with --click rather than waiting for
 * autoplay events.
 *
 * Usage:
 *   node skills/replica/scripts/motion-observe.mjs <url> <out.json> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --click <sel>       widget control to poke (repeatable)
 *     --hover <sel>       element family to hover-diff (repeatable)
 *     --triggers auto     click every enumerated toggle after the hovers
 *     --consent <sel>     extra consent-accept selector
 *     --dismiss <sel,...> extra overlay-dismiss selectors
 *     --headed[=window]    bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 2500)
 *     --timeout <ms>      goto timeout                      (default 60000)
 *
 * Output JSON (schema 2 — every new key additive, schema-1 readers keep
 * working): { schema: 2, url, width, headerTimeline, widgetSamples,
 * hoverSamples, triggers, entrances, stateMachines,
 * events: { animations, transitions, classMutations, attrMutations, childList } }.
 * Exit codes: 0 written, 1 error, 3 bot challenge (fail loud, never observed
 * as if it were the source).
 *
 * Also importable (no browser needed): TRIGGER_SELECTOR, summariseEntrances,
 * summariseStateMachines, hoverVerdict — the pure halves the fixture runner
 * (evals/lint/motion-observe-fixtures.mjs) exercises.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { writeFileSync, mkdirSync, existsSync, realpathSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/replica/scripts ↔ skills/diff/scripts) and the
// documented project copy (scripts/replica ↔ scripts/diff) — resolve either,
// so a project re-copy can't silently sever the shared hardening.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));

export const SCHEMA = 2;
// A trigger that navigates tears the instrumented document down under the
// evaluate: Playwright reports it as one of these. Recognised → the trigger is
// recorded navigated:true, the loop stops and the JSON is still written.
export const isNavigationError = (e) => /Execution context was destroyed|Target (page|context|browser).*closed|Target closed|navigat|frame was detached|Frame.*detached/i.test(String((e && e.message) || e || ''));

export const TRIGGER_SELECTOR = '[aria-expanded],[aria-haspopup],[aria-controls],header button,[role=tab],summary';
export const STATE_ATTRS = ['aria-expanded', 'aria-hidden', 'hidden', 'open', 'data-state'];
const TRIGGER_WINDOW_MS = 300;

const HELP = `motion-observe — runtime motion observation (implement only what fired)

Usage: node motion-observe.mjs <url> <out.json> [options]
  --width <px>      viewport width (default 1440)
  --click <sel>     widget control to poke (repeatable)
  --hover <sel>     element family to hover-diff (repeatable)
  --triggers auto   click every enumerated toggle (${TRIGGER_SELECTOR}) after the hovers; Escape/re-click restore; navigation aborts the loop
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors
  --headed[=window]  bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB)
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 2500)
  --timeout <ms>    goto timeout (default 60000)
  --help            this text

Output schema 2: entrances[] (per-element style aggregation by family),
stateMachines[] (aria/hidden/open/data-state + scoped childList toggles paired
to the preceding click), classMutations with added+removed, y and direction,
hover probes that say hovered:false (no-box | intercepted) instead of an empty
diff. One observation run per live page — reuse the JSON. Exit codes: 0 written,
1 error, 3 bot challenge (fail loud).`;

export function parseArgs(argv, { parseHeadedFlag = (a) => a !== '--headed=none', defaultUa = null } = {}) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, clicks: [], hovers: [], triggers: null, consent: null, dismiss: [], headed: false, locale: null, ua: defaultUa, wait: 2500, timeout: 60000 };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--click') { opts.clicks.push(rest[i += 1]); }
    else if (a === '--hover') { opts.hovers.push(rest[i += 1]); }
    else if (a === '--triggers') { opts.triggers = rest[i += 1]; if (opts.triggers !== 'auto') { console.error(`--triggers takes "auto" (got ${opts.triggers})\n\n${HELP}`); process.exit(1); } }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed' || a.startsWith('--headed=')) { opts.headed = parseHeadedFlag(a); }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { console.error(`need <url> and <out.json>\n\n${HELP}`); process.exit(1); }
  return { url, out, opts };
}

/* ------------------------------------------------------------------------ *
 * Pure summarisers (importable, exercised by the fixture runner)
 * ------------------------------------------------------------------------ */

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mode = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };

/**
 * entrances[]: per-element style aggregates → one row per element family.
 * agg: [{ family, path, count, firstY, firstT, lastT, first: {opacity, transform, visibility}, last: {...} }]
 * → [{ family, elements, mutations, firstY, durationMs, from, to, sample }]
 * sorted by firstY. `from`/`to` are the modal first/last inline values, so
 * "opacity 0 → 1, translateY(25px) → none, ~890 ms" reads off one row.
 */
export function summariseEntrances(agg) {
  const fam = new Map();
  for (const a of agg || []) {
    const k = a.family || a.path || 'unknown';
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(a);
  }
  const pick = (rows, side, prop) => mode(rows.map((r) => r[side]?.[prop]).filter((v) => v !== undefined && v !== null && v !== ''));
  return [...fam.entries()].map(([family, rows]) => ({
    family,
    elements: rows.length,
    mutations: rows.reduce((n, r) => n + (r.count || 0), 0),
    firstY: Math.min(...rows.map((r) => (Number.isFinite(r.firstY) ? r.firstY : Infinity))),
    durationMs: median(rows.map((r) => (Number.isFinite(r.lastT) && Number.isFinite(r.firstT) ? Math.round(r.lastT - r.firstT) : NaN))),
    from: { opacity: pick(rows, 'first', 'opacity'), transform: pick(rows, 'first', 'transform'), visibility: pick(rows, 'first', 'visibility') },
    to: { opacity: pick(rows, 'last', 'opacity'), transform: pick(rows, 'last', 'transform'), visibility: pick(rows, 'last', 'visibility') },
    sample: rows[0]?.path || family,
  })).map((e) => ({ ...e, firstY: Number.isFinite(e.firstY) ? e.firstY : null })).sort((a, b) => (a.firstY ?? 1e9) - (b.firstY ?? 1e9));
}

/**
 * stateMachines[]: attribute toggles and scoped childList changes grouped by
 * element (+ attribute), each transition carrying the click that preceded it
 * (≤ 300 ms) and the aria-controls target's display before/after — the machine
 * the recreation must clone, not approximate.
 */
export function summariseStateMachines(attrMutations, childList) {
  const groups = new Map();
  for (const m of attrMutations || []) {
    const k = `${m.el}::${m.attr}`;
    if (!groups.has(k)) groups.set(k, { el: m.el, attr: m.attr, kind: 'attribute', controls: m.controls || null, transitions: [] });
    groups.get(k).transitions.push({ from: m.from, to: m.to, y: m.y, t: m.t, trigger: m.trigger || null, controlsDisplay: m.controlsDisplay || null });
  }
  for (const c of childList || []) {
    const k = `${c.el}::childList`;
    if (!groups.has(k)) groups.set(k, { el: c.el, attr: 'childList', kind: 'childList', controls: null, transitions: [] });
    groups.get(k).transitions.push({ added: c.added, removed: c.removed, y: c.y, t: c.t, trigger: c.trigger || null });
  }
  return [...groups.values()].map((g) => ({ ...g, count: g.transitions.length, triggered: g.transitions.filter((t) => t.trigger).length }))
    .sort((a, b) => b.triggered - a.triggered || b.count - a.count);
}

/**
 * hoverVerdict: turn a probe's raw facts into the record the operator reads.
 * { box, hit, before, after, hoverRules } → { hovered, reason?, by?, changed[], warn? }
 * hit = { self: bool, path } from elementFromPoint at the hover point.
 */
export function hoverVerdict({ box, hit, before, after, hoverRules = 0 }) {
  if (!box || box.width <= 0 || box.height <= 0) return { hovered: false, reason: 'no-box', changed: [], warn: 'element has no bounding box (hidden twin? first match off-screen) — not hovered' };
  if (hit && !hit.self) return { hovered: false, reason: 'intercepted', by: hit.path, changed: [], warn: `pointer intercepted by ${hit.path} — the element was never hovered` };
  const changed = [];
  if (before && after) {
    for (const k of Object.keys(before.self || {})) { if (before.self[k] !== after.self[k]) changed.push(`self.${k}`); }
    (before.subs || []).forEach((sub, i) => {
      const aSub = after.subs?.[i];
      if (!aSub) return;
      for (const k of Object.keys(sub)) { if (k !== 'el' && sub[k] !== aSub[k]) changed.push(`${sub.el}.${k}`); }
    });
  }
  const out = { hovered: true, changed, hoverRules };
  if (hoverRules > 0 && !changed.length) out.warn = `${hoverRules} :hover rule(s) exist for this element but no computed change was measured — transition not settled, rule dead at runtime, or the styled descendant is outside the read set`;
  return out;
}

/* ------------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------------ */

async function main() {
  if (!LIVE_SESSION) {
    console.error('motion-observe error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
    process.exit(1);
  }
  const { REAL_CHROME_UA, isLiveHttpUrl, launchTier, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, dismissOverlays } = await import(pathToFileURL(LIVE_SESSION).href);
  const { url, out, opts } = parseArgs(process.argv, { parseHeadedFlag, defaultUa: REAL_CHROME_UA });
  const { chromium } = await import('playwright');
  const VH = 900;
  opts.tier = resolveStartTier(opts.headed); // ladder start = max(--headed tier, tier extract recorded) — live-session.mjs
  const browser = await launchTier(chromium, opts.tier);
  const warn = (m) => console.error(`motion-observe WARN: ${m}`);
  try {
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale,
      viewport: { width: opts.width, height: VH },
    });
    const page = await ctx.newPage();
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page's "motion" must never be recorded as the source's.
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, tier: opts.tier });
    await page.waitForTimeout(opts.wait);
    // Dismiss BEFORE instrumenting: the dismissal's own class churn must not
    // pollute the mutation log, and an overlay intercepts hover/click probes.
    // dismissOverlays parks the mouse afterwards.
    const extra = [...(opts.consent ? [opts.consent] : []), ...opts.dismiss];
    const d = await dismissOverlays(page, { extra, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
    if (d.consent) console.error(`consent dismissed via ${d.consent}`);

    // ---- instrument BEFORE any scrolling, so the traversal exposes every
    // scroll-triggered behavior with its trigger mechanism and scrollY ----
    await page.evaluate(({ stateAttrs, triggerWindowMs }) => {
      // elementPath: 5 ancestors with up to 3 classes each, stopping at a
      // data-tpl component marker — enough to map an event to its module.
      // The text snippet is the cross-DOM key: prototype classes are clean
      // re-authored names, so class-based mapping cannot work.
      const clsOf = (e) => String((e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || '').trim();
      const path = (el) => {
        const bits = [];
        for (let e = el; e && e.nodeType === 1 && bits.length < 5; e = e.parentElement) {
          let b = e.tagName.toLowerCase();
          const cls = clsOf(e);
          if (cls) b += `.${cls.split(/\s+/).slice(0, 3).join('.')}`;
          bits.unshift(b);
          if (e.dataset && e.dataset.tpl) { bits[0] += `[data-tpl=${e.dataset.tpl}]`; break; }
        }
        return bits.join(' > ');
      };
      const family = (el) => {
        const cls = clsOf(el).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        const tpl = el.closest && el.closest('[data-tpl]');
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${tpl ? `[data-tpl=${tpl.dataset.tpl}]` : ''}`;
      };
      const SCOPE_RE = /(^|[\s>.#-])(header|footer|nav|menu|drawer|dialog|offcanvas|flyout)(\b|[\s>.#_-])/i;
      const inScope = (el) => {
        const p = path(el);
        if (SCOPE_RE.test(p)) return true;
        const role = el.closest && el.closest('[role="dialog"],[role="menu"],[role="listbox"]');
        if (role) return true;
        const ids = new Set([...document.querySelectorAll('[aria-controls]')].flatMap((t) => String(t.getAttribute('aria-controls') || '').split(/\s+/)));
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (e.id && ids.has(e.id)) return true; }
        return false;
      };
      const M = { animations: [], transitions: [], classMutations: [], attrMutations: [], childList: [], styleAgg: {}, dir: 'down', lastClick: null };
      window.__motion = M;
      window.__motionSetDir = (dir) => { M.dir = dir; };
      const now = () => Math.round(performance.now());
      const y = () => window.pageYOffset;

      // click/pointerdown target — capture phase, with the aria-controls
      // target's display BEFORE the handler runs → paired to mutations ≤ 300 ms later.
      const controlsOf = (el) => {
        const c = el.closest && el.closest('[aria-controls]');
        const id = c && String(c.getAttribute('aria-controls') || '').split(/\s+/)[0];
        const target = id && document.getElementById(id);
        return { id: id || null, target: target || null, display: target ? getComputedStyle(target).display : null };
      };
      const onClick = (ev) => {
        const el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
        if (!el) return;
        const c = controlsOf(el);
        M.lastClick = { el: path(el), txt: (el.textContent || '').trim().slice(0, 40), t: now(), controls: c.id, controlsDisplayBefore: c.display };
      };
      document.addEventListener('pointerdown', onClick, true);
      document.addEventListener('click', onClick, true);
      const trigger = (t) => (M.lastClick && t - M.lastClick.t <= triggerWindowMs ? { el: M.lastClick.el, txt: M.lastClick.txt, dtMs: t - M.lastClick.t } : null);

      document.addEventListener('animationstart', (ev) => {
        if (M.animations.length > 600) return;
        M.animations.push({ name: ev.animationName, el: path(ev.target), txt: (ev.target.textContent || '').trim().slice(0, 50), y: y(), dir: M.dir });
      }, true);
      document.addEventListener('transitionstart', (ev) => {
        if (M.transitions.length > 400) return;
        M.transitions.push({ prop: ev.propertyName, el: path(ev.target), y: y(), dir: M.dir, dur: getComputedStyle(ev.target).transitionDuration });
      }, true);

      // Per-element style aggregation: GSAP/Framer write inline style every
      // frame — one record per element, first/last inline opacity|transform|visibility.
      const ids = new WeakMap(); let nextId = 0;
      const inline = (el) => ({ opacity: el.style.opacity || null, transform: el.style.transform || null, visibility: el.style.visibility || null });
      const onStyle = (el, t) => {
        let id = ids.get(el);
        if (id === undefined) { if (nextId >= 2000) return; id = nextId; nextId += 1; ids.set(el, id); M.styleAgg[id] = { family: family(el), path: path(el), txt: (el.textContent || '').trim().slice(0, 40), count: 0, firstY: y(), firstT: t, lastT: t, first: inline(el), last: inline(el) }; }
        const r = M.styleAgg[id]; r.count += 1; r.lastT = t; r.last = inline(el);
      };

      const mo = new MutationObserver((muts) => {
        const t = now();
        for (const m of muts) {
          if (m.type === 'childList') {
            const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
            if (!el || M.childList.length >= 200) continue;
            const added = [...m.addedNodes].filter((n) => n.nodeType === 1).map(path);
            const removed = [...m.removedNodes].filter((n) => n.nodeType === 1).map(path);
            if (!added.length && !removed.length) continue;
            if (!inScope(el)) continue;
            M.childList.push({ el: path(el), added: added.slice(0, 5), removed: removed.slice(0, 5), y: y(), t, dir: M.dir, trigger: trigger(t) });
            continue;
          }
          if (m.type !== 'attributes') continue;
          const el = m.target;
          if (m.attributeName === 'style') { onStyle(el, t); continue; }
          if (m.attributeName === 'class') {
            const oldC = new Set(String(m.oldValue || '').split(/\s+/).filter(Boolean));
            const newC = clsOf(el).split(/\s+/).filter(Boolean);
            const added = newC.filter((c) => !oldC.has(c));
            const removed = [...oldC].filter((c) => !newC.includes(c));
            if (!added.length && !removed.length) continue;
            if (M.classMutations.length >= 600) continue;
            M.classMutations.push({ added, removed, el: path(el), y: y(), dir: M.dir, t, trigger: trigger(t) });
            continue;
          }
          if (stateAttrs.includes(m.attributeName)) {
            if (M.attrMutations.length >= 300) continue;
            const c = controlsOf(el);
            M.attrMutations.push({ attr: m.attributeName, from: m.oldValue, to: el.getAttribute(m.attributeName), el: path(el), txt: (el.textContent || '').trim().slice(0, 40), y: y(), dir: M.dir, t, trigger: trigger(t), controls: c.id, controlsDisplay: c.id ? { before: M.lastClick && M.lastClick.controls === c.id ? M.lastClick.controlsDisplayBefore : null, after: c.display } : null });
          }
        }
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', ...stateAttrs], attributeOldValue: true, subtree: true, childList: true });
    }, { stateAttrs: STATE_ATTRS, triggerWindowMs: TRIGGER_WINDOW_MS });

    // ---- header state sampler: the chrome state machine is only visible as
    // computed state per scroll position + direction. headerCount catches the
    // double-render class of defect (live morphs ONE header in place; a
    // recreation that clones a second bar can render both at once — a state
    // impossible on live). mainPadTop/bodyPadTop distinguish layout
    // compensation from an accepted content jump.
    const headerState = () => page.evaluate(() => {
      const h = document.querySelector('.header-container, header');
      if (!h) return null;
      const cs = getComputedStyle(h);
      const main = document.querySelector('main, #main-content, body > .content');
      return {
        y: window.pageYOffset, dir: window.__motion.dir,
        cls: String(h.className).trim(),
        position: cs.position, height: cs.height, transform: cs.transform,
        transition: cs.transition,
        mainPadTop: main ? getComputedStyle(main).paddingTop : null,
        bodyPadTop: getComputedStyle(document.body).paddingTop,
        headerCount: document.querySelectorAll('header, .header-container').length,
      };
    });

    const headerTimeline = [];
    headerTimeline.push(await headerState());

    // Scroll DOWN to the bottom in steps (fires scroll-triggered entrances the
    // way a real visit does), then back UP with dense sampling near the top —
    // scroll-chrome behavior differs by direction and near-top state (the
    // full-header restore threshold is often exactly y=0).
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => window.__motionSetDir('down'));
    for (let yy = 0; yy < docH - VH; yy += 400) {
      await page.evaluate((v) => window.scrollTo(0, v), yy);
      await page.waitForTimeout(180);
      if (yy % 1200 === 0) headerTimeline.push(await headerState());
    }
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__motionSetDir('up'));
    for (const yy of [docH - 2000, docH - 3500, 2400, 1200, 800, 500, 300, 200, 150, 120, 90, 60, 30, 0]) {
      if (yy < 0) continue;
      await page.evaluate((v) => window.scrollTo(0, v), Math.max(0, yy));
      await page.waitForTimeout(180);
      headerTimeline.push(await headerState());
    }
    await page.evaluate(() => window.__motionSetDir('rest'));

    // ---- widget pokes: click each control, sample its neighborhood over
    // time. 4 frames at 200ms bracket a typical slide transition — enough to
    // read fade-vs-translate, duration, and indicator mechanics (slick
    // magic-dots animate left/transform on the li). Sampling covers the slick
    // conventions plus the clicked control's own widget container.
    const widgetSamples = [];
    for (const sel of opts.clicks) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        return true;
      }, sel);
      if (!found) { widgetSamples.push({ sel, error: 'not found' }); continue; }
      await page.waitForTimeout(800);
      await page.evaluate((s) => document.querySelector(s).click(), sel);
      const frames = [];
      for (let t = 0; t < 4; t += 1) {
        frames.push(await page.evaluate((s) => {
          const el = document.querySelector(s);
          const box = el && el.closest('[class*="slick"],[class*="swiper"],[class*="carousel"],[class*="slider"],section');
          const track = (box || document).querySelector('.slick-track, .swiper-wrapper');
          const trackCs = track ? getComputedStyle(track) : null;
          const boxCs = box ? getComputedStyle(box) : null;
          const dots = [...(box || document).querySelectorAll('.slick-dots li')].slice(0, 8).map((li) => {
            const b = li.querySelector('button');
            const cs = b ? getComputedStyle(b) : null;
            return { cls: li.className, w: cs && cs.width, h: cs && cs.height, bg: cs && cs.backgroundColor, transition: cs && cs.transition };
          });
          return {
            t: performance.now(),
            trackTransform: trackCs && trackCs.transform,
            trackTransition: trackCs && trackCs.transition,
            boxScrollLeft: box ? box.scrollLeft : null,
            boxTransform: boxCs && boxCs.transform,
            dots,
          };
        }, sel));
        await page.waitForTimeout(200);
      }
      widgetSamples.push({ sel, frames });
    }

    // ---- hover diffs: only a measured change justifies a hover rule in the
    // prototype (:hover rules lifted from CSS are routinely dead at runtime).
    // Real pointer hover via mouse.move; the changed-property list is
    // precomputed so the operator reads a verdict, not two style dumps.
    // "Not hovered" (no box, pointer intercepted) is reported as such — never
    // as an empty diff.
    const hoverSamples = [];
    const PROPS = ['transform', 'color', 'backgroundColor', 'boxShadow', 'opacity', 'textDecorationLine', 'transition', 'transitionProperty', 'transitionDuration', 'transitionDelay'];
    const readHoverState = (sel) => page.evaluate(({ s, props }) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const read = (e) => { const cs = getComputedStyle(e); const o = {}; for (const p of props) o[p === 'backgroundColor' ? 'background' : p] = cs[p]; return o; };
      // descendant read set: the fixed list ∪ descendants the page's own :hover
      // rules name (same-origin sheets only; cross-origin throw and are skipped)
      const subs = new Set([...el.querySelectorAll('img, h1, h2, h3, h4, a, [class*="icon"], [class*="arrow"]')].slice(0, 5));
      let hoverRules = 0;
      const extra = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        const walk = (rs) => { for (const r of rs) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; } if (!r.selectorText || !r.selectorText.includes(':hover')) continue; for (const part of r.selectorText.split(',')) { if (!part.includes(':hover')) continue; const stripped = part.replace(/:hover/g, '').trim(); try { if (el.matches(stripped) || el.closest(stripped)) { hoverRules += 1; } for (const dsc of el.querySelectorAll(stripped)) { hoverRules += 1; if (extra.length < 8 && !subs.has(dsc)) { extra.push(dsc); subs.add(dsc); } } } catch { /* unmatchable after strip */ } } } };
        walk(rules);
      }
      const label = (x) => `${x.tagName.toLowerCase()}.${String(x.className && x.className.baseVal !== undefined ? x.className.baseVal : x.className || '').trim().split(/\s+/).slice(0, 2).join('.')}`;
      return { self: read(el), subs: [...subs].map((x) => ({ el: label(x), ...read(x) })), hoverRules };
    }, { s: sel, props: PROPS });
    for (const sel of opts.hovers) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        return true;
      }, sel);
      if (!found) { hoverSamples.push({ sel, hovered: false, reason: 'not-found', changed: [] }); warn(`--hover ${sel}: not found`); continue; }
      await page.waitForTimeout(400);
      const before = await readHoverState(sel);
      const box = await page.locator(sel).first().boundingBox();
      let hit = null;
      if (box && box.width > 0 && box.height > 0) {
        const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
        // wait for transitionend on the element (bubbling) or ≥ 400 ms — a
        // .15–.25 s transition read at 300 ms is the recorded "changed: []" trap
        await page.evaluate((s) => { const el = document.querySelector(s); window.__hoverWait = new Promise((r) => { const t = setTimeout(() => r('timeout'), 400); const done = () => { clearTimeout(t); setTimeout(() => r('transitionend'), 40); }; el.addEventListener('transitionend', done, { once: true }); }); }, sel);
        await page.mouse.move(cx, cy);
        hit = await page.evaluate(({ s, x, y }) => {
          const el = document.querySelector(s);
          const h = document.elementFromPoint(x, y); // viewport coords — boundingBox() is viewport-relative
          const self = !!(h && (h === el || el.contains(h)));
          const label = (e) => { const bits = []; for (let n = e; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) { const c = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '').trim().split(/\s+/).slice(0, 2).join('.'); bits.unshift(`${n.tagName.toLowerCase()}${c ? `.${c}` : ''}`); } return bits.join(' > '); };
          return { self, path: h ? label(h) : null };
        }, { s: sel, x: cx, y: cy });
        const settled = await page.evaluate(() => window.__hoverWait);
        if (settled === 'timeout') await page.waitForTimeout(50);
      }
      const after = await readHoverState(sel);
      // park the pointer between probes — a :hover-styled element under the
      // resting cursor poisons the next probe and any later capture.
      await page.mouse.move(10, VH - 10);
      const v = hoverVerdict({ box, hit, before, after, hoverRules: before?.hoverRules || 0 });
      if (v.warn) warn(`--hover ${sel}: ${v.warn}`);
      hoverSamples.push({ sel, ...v, before, after });
    }

    // ---- --triggers auto: the page's own toggles, one at a time, LAST (an
    // open panel would poison the hover probes above). Escape + re-click
    // restore; a navigating trigger aborts the loop (the instrumentation is
    // gone with the document).
    const triggers = [];
    if (opts.triggers === 'auto') {
      let navigated = false;
      const onNav = (frame) => { if (frame === page.mainFrame()) navigated = true; };
      page.on('framenavigated', onNav);
      const list = await page.evaluate((selector) => {
        const seen = new Set(); const out = [];
        for (const el of document.querySelectorAll(selector)) {
          if (seen.has(el)) continue; seen.add(el);
          if (el.matches('a[href], [type="submit"]')) continue;
          if (el.closest('[hidden], [aria-hidden="true"]')) continue;
          const i = out.length; el.setAttribute('data-motion-trigger', String(i));
          const bits = []; for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) { const c = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '').trim().split(/\s+/).slice(0, 2).join('.'); bits.unshift(`${n.tagName.toLowerCase()}${c ? `.${c}` : ''}`); }
          out.push({ i, sel: bits.join(' > '), txt: (el.textContent || '').trim().slice(0, 40), controls: el.getAttribute('aria-controls') || null });
          if (out.length >= 40) break;
        }
        return out;
      }, TRIGGER_SELECTOR);
      const state = (i) => page.evaluate((k) => {
        const el = document.querySelector(`[data-motion-trigger="${k}"]`);
        if (!el) return null;
        const id = String(el.getAttribute('aria-controls') || '').split(/\s+/)[0];
        const target = id && document.getElementById(id);
        return { ariaExpanded: el.getAttribute('aria-expanded'), open: el.hasAttribute('open') || null, controlsDisplay: target ? getComputedStyle(target).display : null, controlsHeight: target ? Math.round(target.getBoundingClientRect().height) : null, attrMutations: window.__motion.attrMutations.length, childList: window.__motion.childList.length, classMutations: window.__motion.classMutations.length };
      }, i);
      // one trigger per iteration; EVERYTHING that touches the page runs inside
      // the try — a trigger whose navigation lands after the flag check (or
      // during the restore) destroys the execution context, and an uncaught
      // evaluate would lose the whole observation (its live hit included).
      for (const t of list) {
        if (navigated) break;
        const loc = page.locator(`[data-motion-trigger="${t.i}"]`).first();
        const rec = { ...t };
        try {
          rec.before = await state(t.i);
          try {
            await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
            await page.waitForTimeout(150);
            // settle promise on the aria-controls target (else the trigger):
            // transitionend (bubbling) or ≥ 400 ms — same wait as the hover probe
            await page.evaluate((k) => {
              const el = document.querySelector(`[data-motion-trigger="${k}"]`);
              const id = String(el.getAttribute('aria-controls') || '').split(/\s+/)[0];
              const target = (id && document.getElementById(id)) || el;
              window.__trigWait = new Promise((r) => { const tm = setTimeout(() => r('timeout'), 400); const done = () => { clearTimeout(tm); setTimeout(() => r('transitionend'), 40); }; target.addEventListener('transitionend', done, { once: true }); el.addEventListener('transitionend', done, { once: true }); });
            }, t.i);
            await loc.click({ timeout: 2500 });
          } catch (e) {
            if (isNavigationError(e)) throw e;
            rec.clickFailed = String(e.message || e).split('\n')[0].slice(0, 120); triggers.push(rec); continue;
          }
          const settled = await page.evaluate(() => window.__trigWait);
          if (settled === 'timeout') await page.waitForTimeout(50);
          if (navigated) { rec.navigated = true; triggers.push(rec); warn(`--triggers auto: ${t.sel} navigated away — loop aborted (record the trigger as a link, not a toggle)`); break; }
          const after = await state(t.i);
          rec.after = after;
          rec.settled = settled;
          rec.mutations = after && rec.before ? { attr: after.attrMutations - rec.before.attrMutations, childList: after.childList - rec.before.childList, class: after.classMutations - rec.before.classMutations } : null;
          // restore: Escape, then re-click if still expanded; park the mouse
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(200);
          let restored = await state(t.i);
          if (restored && restored.ariaExpanded === 'true' && rec.before && rec.before.ariaExpanded !== 'true') {
            try { await loc.click({ timeout: 2000 }); await page.waitForTimeout(300); } catch (e) { if (isNavigationError(e)) throw e; /* leave it */ }
            restored = await state(t.i);
          }
          rec.restored = restored ? { ariaExpanded: restored.ariaExpanded, controlsDisplay: restored.controlsDisplay } : null;
          await page.mouse.move(10, VH - 10);
          triggers.push(rec);
        } catch (e) {
          if (navigated || isNavigationError(e)) {
            rec.navigated = true; triggers.push(rec);
            warn(`--triggers auto: ${t.sel} navigated away (${String(e.message || e).split('\n')[0].slice(0, 80)}) — loop aborted, observation kept (record the trigger as a link, not a toggle)`);
            break;
          }
          rec.error = String(e.message || e).split('\n')[0].slice(0, 120); triggers.push(rec);
          warn(`--triggers auto: ${t.sel} failed (${rec.error}) — skipped`);
        }
      }
      page.off('framenavigated', onNav);
      await page.evaluate(() => { for (const el of document.querySelectorAll('[data-motion-trigger]')) el.removeAttribute('data-motion-trigger'); }).catch(() => {});
    }

    const events = await page.evaluate(() => { const M = window.__motion; return { animations: M.animations, transitions: M.transitions, classMutations: M.classMutations, attrMutations: M.attrMutations, childList: M.childList, styleAgg: Object.values(M.styleAgg) }; });
    const entrances = summariseEntrances(events.styleAgg);
    const stateMachines = summariseStateMachines(events.attrMutations, events.childList);
    const { styleAgg, ...rest } = events;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ schema: SCHEMA, url, width: opts.width, headerTimeline, widgetSamples, hoverSamples, triggers, entrances, stateMachines, events: { ...rest, styleMutatedElements: styleAgg.length } }, null, 2));
    const notHovered = hoverSamples.filter((h) => h.hovered === false).length;
    console.error(`motion-observe ${out}: ${rest.animations.length} animations, ${rest.transitions.length} transitions, ${rest.classMutations.length} class mutations, ${styleAgg.length} style-mutated elements → ${entrances.length} entrance families, ${stateMachines.length} state machines (${rest.attrMutations.length} attr + ${rest.childList.length} childList records), ${widgetSamples.length} widget pokes, ${hoverSamples.length} hover probes${notHovered ? ` (${notHovered} not hovered — see hovered:false reasons)` : ''}, ${triggers.length} auto triggers`);
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (distinct from generic errors, so a
// runner can tell "blocked — escalate with --headed" from "probe broke").
const invokedDirectly = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (invokedDirectly) main().catch((e) => { console.error(`motion-observe error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
