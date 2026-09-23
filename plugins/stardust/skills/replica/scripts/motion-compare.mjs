#!/usr/bin/env node
/**
 * skills/replica/scripts/motion-compare.mjs
 *
 * Interaction-parity ADVISORY for the stardust:replica motion pass: compares
 * two motion-observe.mjs outputs — one taken on the live source page, one on
 * the rebuilt page — and prints one greppable verdict line per observed
 * behavior plus a summary, in the same short vocabulary as gate.sh /
 * pixel-compare. It is a finding generator, NOT a gate: it exits 0 whenever
 * both inputs parsed, whatever the verdicts say.
 *
 * Policy (recreation-procedure.md § Interaction parity): motion is OBSERVED,
 * never inferred. A behavior that measurably fired on live should fire on the
 * build (else MISSING); a behavior that fired on the build but not on live is
 * probably invented motion (EXTRA); a behavior that was DEAD on live — the
 * probe ran but nothing changed — is NOT required on the build. For behaviors
 * present on both sides the timing (transition/animation time) and magnitude
 * (px) deltas are held to the tolerances.
 *
 * What a MISSING / EXTRA line IS: a finding the agent CONFIRMS on the `class`
 * lines (the trigger classes the live runtime added — the mechanism channel)
 * and on the element, then records in progress.json under
 * `motion: { observed, implemented, dead[] }` — observed = the live behaviors
 * that fired, implemented = the ones the build reproduces, dead[] = the ones
 * the sampler saw nothing for. It is never, by itself, a gate that blocks
 * approval: a hard fail here produced false blocks on class-toggled and
 * pseudo-element mechanics the sampler cannot see (a live carousel that fades
 * by toggling a class reads as "dead" to the frame sampler; a hover that moves
 * a ::after underline reads as "no diff" to the hover probe), and a build that
 * reproduced the live page faithfully was refused for it. A hover sample the
 * observer could not take (`hovered: false`, or an `.error` field) counts as
 * NOT OBSERVED — never as "dead on live" and never as evidence about the build.
 *
 * Where the instrument is blind, the verdict is advisory, never a hard EXTRA.
 * The widget frame sampler reads track/box transforms, scrollLeft and
 * indicator classes only, and the hover probe reads transform / color /
 * background / box-shadow / opacity / transition only — a live carousel that
 * fades by toggling a class, or a live hover that moves a pseudo-element
 * underline, reads as "dead" there while its class mutations show in the class
 * channel (recorded on a real page: a class-toggled carousel, four identical
 * frames, its --active classes in events.classMutations). So "dead on live,
 * fires on build" for a widget or hover, and a transitioned CSS property seen
 * on the build only, print as `extra on build — advisory`; the hard EXTRAs are
 * the complete channels: an entrance animation never fired on live, a header
 * scroll-morph the live header never made, a second header element. The class
 * channel assumes the replica prototype keeps the captured class names (it is
 * authored from the verbatim DOM); on a re-authored build read a class MISSING
 * as "missing or renamed" and confirm on the element.
 *
 * Behavior classes, keyed the way the observer records them:
 *   header      the chrome scroll-morph state machine from headerTimeline —
 *               height/transform/position change between the top and the
 *               scrolled state, the restore threshold on the way back up,
 *               main/body padding compensation, transition time, and the
 *               header count (a build that renders two headers at once is a
 *               state that cannot exist on live — always a finding).
 *   widget      one per --click poke (widgetSamples[]): change across the
 *               sampled frames in track transform / scrollLeft / box
 *               transform / indicator classes, its settle time and transition
 *               time (ms), and its travel (px).
 *   hover       one per --hover probe (hoverSamples[]): the changed-property
 *               set (sub-element keys normalised to tag.prop so re-authored
 *               class names cannot break the match) and transition time.
 *   entrance    one per animation name (events.animations): fired-element
 *               count must match (verification protocol: tagged-element count
 *               == live fired count).
 *   transition  one per transitioned property (events.transitions): presence
 *               and the longest recorded duration.
 *   class       one per added trigger class (events.classMutations): a class
 *               the live runtime added but the build never adds is a missing
 *               mechanism; an extra class on the build is advisory only
 *               (class names are bookkeeping, not motion).
 *
 * Pairing widgets and hovers across the two runs: by identical selector first;
 * leftover probes are then paired in order (the i-th unpaired live poke with
 * the i-th unpaired build poke), so a build observed with re-authored
 * selectors still compares as long as the pokes were issued in the same order.
 *
 * Usage:
 *   node skills/replica/scripts/motion-compare.mjs <live.json> <build.json> [options]
 *     --tolerance-ms <n>   timing tolerance in ms                 (default 150)
 *     --tolerance-px <n>   magnitude tolerance in px              (default 8)
 *     --json <out>         also write the machine-readable summary
 *     --help               this text
 *
 * Verdict lines (stdout), one per behavior:
 *   motion <class> <name>: parity (…)
 *   motion <class> <name>: MISSING on build (…)
 *   motion <class> <name>: EXTRA on build (…)
 *   motion <class> <name>: timing delta 420ms > 150ms (…)
 *   motion <class> <name>: magnitude delta 24px > 8px (…)
 *   motion <class> <name>: dead on live — not required (…)
 *   motion <class> <name>: unobserved on live — not required (…)   probe failed / not hovered
 *   motion <class> <name>: extra on build — advisory (…)
 * then the final line
 *   motion summary: <n> parity, <n> missing, <n> extra, <n> advisory (<n> out of tolerance,
 *                   <n> dead or unobserved on live — not required; tolerance <ms>ms / <px>px)
 *
 * Writes: nothing — unless --json <out>, which receives { live, build, toleranceMs,
 * tolerancePx, advisory: true, counts, verdicts[] } (directories created).
 *
 * Exit codes: 0 both inputs parsed — ALWAYS, whatever the verdicts (advisory,
 * not a gate); 1 an input is unreadable or not a motion-observe object;
 * 2 usage error.
 * Resolution note: widget settle time is read from the observer's ~200 ms
 * frame grid, so a one-frame settle difference exceeds the default tolerance —
 * that is the instrument's resolution, not noise; raise --tolerance-ms to
 * 250 when a coarser bar is intended.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `motion-compare — interaction-parity findings from two motion-observe JSONs (advisory, not a gate)

Usage: node motion-compare.mjs <live.json> <build.json> [options]
  --tolerance-ms <n>  timing tolerance in ms (default 150)
  --tolerance-px <n>  magnitude tolerance in px (default 8)
  --json <out>        also write the machine-readable summary
  --help              this text

Convention: <live.json> = observation of the live source page, <build.json> =
observation of the rebuilt page (same observer, same pokes in the same order).
A MISSING / EXTRA line is a finding to confirm on the class lines and record in
progress.json (motion: {observed, implemented, dead[]}) — never a block by itself.
Exit codes: 0 both inputs parsed (always, whatever the verdicts), 1 unreadable
input, 2 usage.`;

const USAGE_EXIT = 2;
const INPUT_EXIT = 1;

function usage(msg) { console.error(`motion-compare error: ${msg}\n\n${HELP}`); process.exit(USAGE_EXIT); }
function inputError(msg) { console.error(`motion-compare error: ${msg}`); process.exit(INPUT_EXIT); }

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { toleranceMs: 150, tolerancePx: 8, json: null };
  // A value flag followed by nothing or by another --flag is a usage error naming the flag.
  const need = (i, flag) => { if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) usage(`${flag} needs a value`); return rest[i + 1]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--tolerance-ms') { opts.toleranceMs = Number(need(i, a)); i += 1; }
    else if (a === '--tolerance-px') { opts.tolerancePx = Number(need(i, a)); i += 1; }
    else if (a === '--json') { opts.json = need(i, a); i += 1; }
    else if (a.startsWith('--')) usage(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 2) usage('need <live.json> and <build.json>');
  if (!Number.isFinite(opts.toleranceMs) || opts.toleranceMs < 0) usage('--tolerance-ms must be a non-negative number');
  if (!Number.isFinite(opts.tolerancePx) || opts.tolerancePx < 0) usage('--tolerance-px must be a non-negative number');
  return { livePath: pos[0], buildPath: pos[1], opts };
}

// ---- input ------------------------------------------------------------------------------------

// An unreadable or non-motion-observe input is exit 1 (the file is wrong), distinct from exit 2
// (the command line is wrong) — so a caller can tell "re-run the observer" from "fix the flags".
function loadObservation(path, label) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { inputError(`cannot read ${label} ${path}: ${e.message}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) inputError(`${label} ${path} is not a motion-observe object`);
  const missing = ['headerTimeline', 'widgetSamples', 'hoverSamples', 'events'].filter((k) => !(k in doc));
  if (missing.length) inputError(`${label} ${path} lacks motion-observe keys: ${missing.join(', ')}`);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const ev = doc.events && typeof doc.events === 'object' ? doc.events : {};
  return {
    url: doc.url, width: doc.width,
    headerTimeline: arr(doc.headerTimeline), widgetSamples: arr(doc.widgetSamples), hoverSamples: arr(doc.hoverSamples),
    events: { animations: arr(ev.animations), transitions: arr(ev.transitions), classMutations: arr(ev.classMutations) },
  };
}

// ---- small parsers ----------------------------------------------------------------------------

// Longest time token in a CSS time list / transition shorthand ("0.5s, 0.5s", "all 0.3s ease 0s",
// "300ms"). Null when no explicit time appears (a bare "all" or "none").
export function maxTimeMs(str) {
  if (typeof str !== 'string') return null;
  let best = null;
  for (const m of str.matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)) {
    const v = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
    if (best === null || v > best) best = v;
  }
  return best;
}

export const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Translation vector of a computed transform ("matrix(a,b,c,d,tx,ty)" / "matrix3d(…)" / "none").
export function translateOf(t) {
  if (typeof t !== 'string' || t === 'none') return { x: 0, y: 0 };
  const args = t.slice(t.indexOf('(') + 1); // skip the function name ("matrix3d" carries a digit)
  const nums = args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g)?.map(Number) || [];
  if (t.startsWith('matrix3d') && nums.length >= 14) return { x: nums[12], y: nums[13] };
  if (t.startsWith('matrix') && nums.length >= 6) return { x: nums[4], y: nums[5] };
  return { x: 0, y: 0 };
}

const fmtMs = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v)}ms`);
const fmtPx = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 10) / 10}px`);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- verdict assembly ---------------------------------------------------------------------------

// A verdict is { cls, name, state, note, deltas } where state ∈ parity | missing | extra |
// tolerance | dead | unobserved | advisory. missing/extra/tolerance are FINDINGS (the agent confirms
// them on the class lines and the element); none of them changes the exit code — advisory, not a gate.
const FINDING = new Set(['missing', 'extra', 'tolerance']);

function verdictLine(v) {
  const head = `motion ${v.cls} ${v.name}:`;
  const tail = v.note ? ` (${v.note})` : '';
  switch (v.state) {
    case 'parity': return `${head} parity${tail}`;
    case 'missing': return `${head} MISSING on build${tail}`;
    case 'extra': return `${head} EXTRA on build${tail}`;
    case 'tolerance': return `${head} ${v.deltas.join('; ')}${tail}`;
    case 'dead': return `${head} dead on live — not required${tail}`;
    case 'unobserved': return `${head} unobserved on live — not required${tail}`;
    case 'advisory': return `${head} extra on build — advisory${tail}`;
    default: return `${head} ${v.state}${tail}`;
  }
}

// Compare a list of measured deltas: each { kind: 'timing'|'magnitude', label, live, build }.
// Returns the out-of-tolerance descriptions (empty = within tolerance). Null on either side
// (not measurable there) is compared only when both sides have a value.
function outOfTolerance(measures, { toleranceMs, tolerancePx }) {
  const out = [];
  for (const m of measures) {
    if (m.live === null || m.live === undefined || m.build === null || m.build === undefined) continue;
    const tol = m.kind === 'timing' ? toleranceMs : tolerancePx;
    const d = Math.abs(m.live - m.build);
    if (d > tol) {
      const f = m.kind === 'timing' ? fmtMs : fmtPx;
      out.push(`${m.kind} delta ${f(d)} > ${f(tol)}${m.label ? ` [${m.label}: live ${f(m.live)}, build ${f(m.build)}]` : ''}`);
    }
  }
  return out;
}

// ---- header -----------------------------------------------------------------------------------

// Reduce a headerTimeline to its state machine: top state, scrolled state (deepest sample), restore
// threshold on the way up, padding compensation, transition time, max header count.
export function headerProfile(timeline) {
  const samples = timeline.filter((s) => s && typeof s === 'object');
  if (!samples.length) return { present: false, morphs: false, maxCount: 0 };
  const key = (s) => `${px(s.height)}|${s.transform || ''}|${s.position || ''}`;
  const top = samples[0];
  let deepIdx = 0;
  samples.forEach((s, i) => { if ((s.y || 0) > (samples[deepIdx].y || 0)) deepIdx = i; });
  const deep = samples[deepIdx];
  const morphs = samples.some((s) => key(s) !== key(top));
  // Restore threshold: first sample after the deepest one that is back in the top state. Both runs
  // sample the same y grid near the top; the two document-height-relative samples that start the
  // upward pass are collapsed to "immediately" so a different page height cannot read as a delta.
  let restoreY = null;
  let restoreImmediate = false;
  for (let i = deepIdx + 1; i < samples.length; i += 1) {
    if (key(samples[i]) === key(top)) { restoreY = samples[i].y || 0; restoreImmediate = i <= deepIdx + 2 && restoreY > 2400; break; }
  }
  const pad = (s, k) => px(s[k]);
  const comp = (k) => (pad(top, k) !== null && pad(deep, k) !== null ? Math.abs(pad(deep, k) - pad(top, k)) : null);
  let timeMs = null;
  for (const s of samples) { const t = maxTimeMs(s.transition); if (t !== null && (timeMs === null || t > timeMs)) timeMs = t; }
  return {
    present: true, morphs,
    topHeight: px(top.height), deepHeight: px(deep.height),
    heightDelta: px(top.height) !== null && px(deep.height) !== null ? Math.abs(px(top.height) - px(deep.height)) : null,
    positionChanges: top.position !== deep.position, transformChanges: (top.transform || 'none') !== (deep.transform || 'none'),
    restoreY, restoreImmediate,
    mainComp: comp('mainPadTop'), bodyComp: comp('bodyPadTop'),
    timeMs,
    maxCount: Math.max(...samples.map((s) => Number(s.headerCount) || 0)),
  };
}

// Header transition time may also live in the event log (the chrome's own transitionstart
// events name the header element in their path).
function headerEventTimeMs(events) {
  let best = null;
  for (const t of events.transitions) {
    if (!/header/i.test(String(t.el || ''))) continue;
    const v = maxTimeMs(t.dur);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

function compareHeader(live, build, opts) {
  const out = [];
  const L = headerProfile(live.headerTimeline);
  const B = headerProfile(build.headerTimeline);
  const lt = L.timeMs ?? headerEventTimeMs(live.events);
  const bt = B.timeMs ?? headerEventTimeMs(build.events);
  if (!L.present && !B.present) return out; // neither page has a header element: nothing to say
  if (!L.morphs) {
    const liveNote = L.present ? 'live header static across the scroll traversal' : 'no header element observed on live';
    out.push(B.morphs
      ? { cls: 'header', name: 'scroll-morph', state: 'extra', note: `${liveNote}, build changes ${fmtPx(B.heightDelta)}` }
      : { cls: 'header', name: 'scroll-morph', state: 'dead', note: L.present ? 'header static across the scroll traversal on both sides' : `${liveNote}; build header ${B.present ? 'static' : 'absent'}` });
  } else if (!B.morphs) {
    out.push({ cls: 'header', name: 'scroll-morph', state: 'missing', note: `live morphs ${fmtPx(L.heightDelta)} at depth${L.positionChanges ? ', position changes' : ''}${L.transformChanges ? ', transform changes' : ''}; build static` });
  } else {
    const deltas = outOfTolerance([
      { kind: 'magnitude', label: 'height change', live: L.heightDelta, build: B.heightDelta },
      { kind: 'magnitude', label: 'main padding compensation', live: L.mainComp, build: B.mainComp },
      { kind: 'magnitude', label: 'body padding compensation', live: L.bodyComp, build: B.bodyComp },
      { kind: 'timing', label: 'transition', live: lt, build: bt },
    ], opts);
    const restoreDelta = [];
    if (L.restoreY !== null && B.restoreY !== null) {
      if (!(L.restoreImmediate && B.restoreImmediate) && !near(L.restoreY, B.restoreY, opts.tolerancePx)) restoreDelta.push(`magnitude delta ${fmtPx(Math.abs(L.restoreY - B.restoreY))} > ${fmtPx(opts.tolerancePx)} [restore threshold: live y≤${L.restoreY}, build y≤${B.restoreY}]`);
    } else if ((L.restoreY === null) !== (B.restoreY === null)) {
      restoreDelta.push(`restore threshold: live ${L.restoreY === null ? 'never restores' : `y≤${L.restoreY}`}, build ${B.restoreY === null ? 'never restores' : `y≤${B.restoreY}`}`);
    }
    const mech = [];
    if (L.positionChanges !== B.positionChanges) mech.push(`position ${L.positionChanges ? 'changes' : 'stays'} on live, ${B.positionChanges ? 'changes' : 'stays'} on build`);
    if (L.transformChanges !== B.transformChanges) mech.push(`transform ${L.transformChanges ? 'changes' : 'stays'} on live, ${B.transformChanges ? 'changes' : 'stays'} on build`);
    const all = [...deltas, ...restoreDelta, ...mech];
    const summary = `Δheight ${fmtPx(L.heightDelta)}, restore ${L.restoreImmediate ? 'on first upward sample' : L.restoreY === null ? 'never' : `at y≤${L.restoreY}`}, ${fmtMs(lt)}`;
    out.push(all.length
      ? { cls: 'header', name: 'scroll-morph', state: 'tolerance', deltas: all, note: summary }
      : { cls: 'header', name: 'scroll-morph', state: 'parity', note: summary });
  }
  if (B.maxCount > Math.max(1, L.maxCount)) {
    out.push({ cls: 'header', name: 'count', state: 'extra', note: `${B.maxCount} header elements rendered on build vs ${L.maxCount} on live — a double-rendered chrome state that cannot exist on live` });
  }
  return out;
}

// ---- widgets ----------------------------------------------------------------------------------

// Reduce one poke's frames to: whether anything changed, when it settled (ms after the first frame),
// travel in px (scrollLeft or track/box translate), and the longest transition time declared.
export function widgetProfile(sample) {
  if (!sample || sample.error || !Array.isArray(sample.frames) || !sample.frames.length) return { observed: false, error: sample?.error || 'no frames' };
  const frames = sample.frames;
  const sig = (f) => JSON.stringify([f.trackTransform, f.boxScrollLeft, f.boxTransform, (f.dots || []).map((d) => [d.cls, d.w, d.h, d.bg])]);
  let lastChange = -1;
  for (let i = 1; i < frames.length; i += 1) if (sig(frames[i]) !== sig(frames[i - 1])) lastChange = i;
  const fired = lastChange >= 0;
  const t0 = Number(frames[0].t) || 0;
  const settleMs = fired ? (Number(frames[lastChange].t) || 0) - t0 : null;
  const first = frames[0];
  const last = frames[frames.length - 1];
  let travel = null;
  if (typeof first.boxScrollLeft === 'number' && typeof last.boxScrollLeft === 'number' && first.boxScrollLeft !== last.boxScrollLeft) travel = Math.abs(last.boxScrollLeft - first.boxScrollLeft);
  else {
    const a = translateOf(first.trackTransform !== null && first.trackTransform !== undefined ? first.trackTransform : first.boxTransform);
    const b = translateOf(last.trackTransform !== null && last.trackTransform !== undefined ? last.trackTransform : last.boxTransform);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) travel = d;
  }
  let timeMs = null;
  for (const f of frames) {
    for (const s of [f.trackTransition, ...(f.dots || []).map((d) => d.transition)]) { const v = maxTimeMs(s); if (v !== null && (timeMs === null || v > timeMs)) timeMs = v; }
  }
  const dotChange = frames.some((f, i) => i > 0 && JSON.stringify((f.dots || []).map((d) => d.cls)) !== JSON.stringify((frames[i - 1].dots || []).map((d) => d.cls)));
  return { observed: true, fired, settleMs, travel, timeMs, dotChange };
}

// Pair probes by selector, then leftovers in order.
export function pairProbes(liveList, buildList) {
  const pairs = [];
  const usedB = new Set();
  liveList.forEach((l, i) => {
    const j = buildList.findIndex((b, k) => !usedB.has(k) && b && l && b.sel === l.sel);
    if (j >= 0) { usedB.add(j); pairs.push({ live: l, build: buildList[j], liveIdx: i, buildIdx: j, by: 'selector' }); }
    else pairs.push({ live: l, build: null, liveIdx: i, buildIdx: -1, by: null });
  });
  const leftoverB = buildList.map((_, k) => k).filter((k) => !usedB.has(k));
  for (const p of pairs) {
    if (p.build === null && leftoverB.length) { p.buildIdx = leftoverB.shift(); p.build = buildList[p.buildIdx]; p.by = 'order'; }
  }
  for (const k of leftoverB) pairs.push({ live: null, build: buildList[k], liveIdx: -1, buildIdx: k, by: null });
  return pairs;
}

const probeName = (p) => {
  const ls = p.live?.sel; const bs = p.build?.sel;
  if (ls && bs && ls !== bs) return `${ls} → ${bs}`;
  return ls || bs || `#${Math.max(p.liveIdx, p.buildIdx) + 1}`;
};

// "Dead on live, fires on build" is advisory for widgets and hovers: the sampler sees only some
// mechanisms (header comment), so the class lines and the behavior-match protocol decide, not this gate.
const SAMPLER_NOTE = 'live mechanics may be invisible to the frame sampler (class-toggled fades, non-track carousels) — confirm against the class lines before treating it as invented';
const HOVER_NOTE = 'live mechanics may be invisible to the hover probe (pseudo-element underlines, text-decoration, border-color) — confirm on the element before treating it as invented';

function compareWidgets(live, build, opts) {
  const out = [];
  for (const p of pairProbes(live.widgetSamples, build.widgetSamples)) {
    const name = probeName(p);
    const L = p.live ? widgetProfile(p.live) : null;
    const B = p.build ? widgetProfile(p.build) : null;
    if (!L) { // observed on the build only
      out.push(B.observed && B.fired
        ? { cls: 'widget', name, state: 'advisory', note: 'poked on the build only; no live observation of this control' }
        : { cls: 'widget', name, state: 'unobserved', note: 'poked on the build only, no change sampled' });
      continue;
    }
    if (!L.observed) {
      out.push(B && B.observed && B.fired
        ? { cls: 'widget', name, state: 'advisory', note: `live probe ${L.error}; build changes on click — ${SAMPLER_NOTE}` }
        : { cls: 'widget', name, state: 'unobserved', note: `live probe ${L.error}` });
      continue;
    }
    if (!L.fired) {
      out.push(B && B.observed && B.fired
        ? { cls: 'widget', name, state: 'advisory', note: `no sampled change on live; build changes on click — ${SAMPLER_NOTE}` }
        : { cls: 'widget', name, state: 'dead', note: 'no sampled change across the frames (track/scroll/box/indicator)' });
      continue;
    }
    const liveNote = `travel ${fmtPx(L.travel)}, settle ${fmtMs(L.settleMs)}, transition ${fmtMs(L.timeMs)}${L.dotChange ? ', indicator changes' : ''}`;
    if (!B) { out.push({ cls: 'widget', name, state: 'missing', note: `no build poke pairs with it; live ${liveNote}` }); continue; }
    if (!B.observed) { out.push({ cls: 'widget', name, state: 'missing', note: `build probe ${B.error}; live ${liveNote}` }); continue; }
    if (!B.fired) { out.push({ cls: 'widget', name, state: 'missing', note: `no sampled change on build; live ${liveNote}` }); continue; }
    const deltas = outOfTolerance([
      { kind: 'timing', label: 'settle', live: L.settleMs, build: B.settleMs },
      { kind: 'timing', label: 'transition', live: L.timeMs, build: B.timeMs },
      { kind: 'magnitude', label: 'travel', live: L.travel, build: B.travel },
    ], opts);
    if (L.dotChange && !B.dotChange) deltas.push('indicator classes change on live, not on build');
    if (!L.dotChange && B.dotChange) deltas.push('indicator classes change on build, not on live');
    out.push(deltas.length
      ? { cls: 'widget', name, state: 'tolerance', deltas, note: `live ${liveNote}${p.by === 'order' ? '; paired by order' : ''}` }
      : { cls: 'widget', name, state: 'parity', note: `${liveNote}${p.by === 'order' ? '; paired by order' : ''}` });
  }
  return out;
}

// ---- hovers -----------------------------------------------------------------------------------

// Normalise a changed-property key: "self.color" stays; "span.icon.brand.color" → "span.color" (the
// sub-element's classes are re-authored on the build; its tag and the property are the identity).
export const normaliseHoverKey = (k) => {
  const s = String(k);
  if (s.startsWith('self.')) return s;
  const parts = s.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}` : s;
};

// `hovered: false` (the observer could not hover the element — off-screen, covered, detached) or an
// `.error` field is NOT OBSERVED: nothing is known about the live hover, so it is never read as "dead
// on live" (which would license the build to drop it) and never as evidence about the build.
export function hoverProfile(sample) {
  if (!sample || sample.error || sample.hovered === false) return { observed: false, error: sample?.error || (sample && sample.hovered === false ? 'not hovered' : 'no sample') };
  const changed = [...new Set((Array.isArray(sample.changed) ? sample.changed : []).map(normaliseHoverKey))].sort();
  let timeMs = null;
  const after = sample.after || {};
  for (const s of [after.self?.transition, ...((after.subs || []).map((x) => x && x.transition))]) { const v = maxTimeMs(s); if (v !== null && (timeMs === null || v > timeMs)) timeMs = v; }
  return { observed: true, fired: changed.length > 0, changed, timeMs };
}

function compareHovers(live, build, opts) {
  const out = [];
  for (const p of pairProbes(live.hoverSamples, build.hoverSamples)) {
    const name = probeName(p);
    const L = p.live ? hoverProfile(p.live) : null;
    const B = p.build ? hoverProfile(p.build) : null;
    if (!L) {
      out.push(B.observed && B.fired
        ? { cls: 'hover', name, state: 'advisory', note: `hovered on the build only; changes ${B.changed.join(', ')}` }
        : { cls: 'hover', name, state: 'unobserved', note: 'hovered on the build only, no diff' });
      continue;
    }
    if (!L.observed) {
      out.push(B && B.observed && B.fired
        ? { cls: 'hover', name, state: 'advisory', note: `live probe ${L.error}; build changes ${B.changed.join(', ')} — ${HOVER_NOTE}` }
        : { cls: 'hover', name, state: 'unobserved', note: `live probe ${L.error}` });
      continue;
    }
    if (!L.fired) {
      out.push(B && B.observed && B.fired
        ? { cls: 'hover', name, state: 'advisory', note: `no hover diff on live; build changes ${B.changed.join(', ')} — ${HOVER_NOTE}` }
        : { cls: 'hover', name, state: 'dead', note: 'no measured hover diff' });
      continue;
    }
    const liveNote = `${L.changed.join(', ')}; ${fmtMs(L.timeMs)}`;
    if (!B) { out.push({ cls: 'hover', name, state: 'missing', note: `no build probe pairs with it; live changes ${liveNote}` }); continue; }
    if (!B.observed) { out.push({ cls: 'hover', name, state: 'missing', note: `build probe ${B.error}; live changes ${liveNote}` }); continue; }
    if (!B.fired) { out.push({ cls: 'hover', name, state: 'missing', note: `no hover diff on build; live changes ${liveNote}` }); continue; }
    const lacks = L.changed.filter((k) => !B.changed.includes(k));
    const extra = B.changed.filter((k) => !L.changed.includes(k));
    const deltas = outOfTolerance([{ kind: 'timing', label: 'transition', live: L.timeMs, build: B.timeMs }], opts);
    if (lacks.length) deltas.push(`build lacks ${lacks.join(', ')}`);
    if (extra.length) deltas.push(`build adds ${extra.join(', ')}`);
    out.push(deltas.length
      ? { cls: 'hover', name, state: 'tolerance', deltas, note: `live changes ${liveNote}${p.by === 'order' ? '; paired by order' : ''}` }
      : { cls: 'hover', name, state: 'parity', note: `${liveNote}${p.by === 'order' ? '; paired by order' : ''}` });
  }
  return out;
}

// ---- event families -----------------------------------------------------------------------------

const groupBy = (list, keyOf) => {
  const m = new Map();
  for (const item of list) { const k = keyOf(item); if (k === null || k === undefined || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(item); }
  return m;
};

function compareEntrances(live, build) {
  const out = [];
  const L = groupBy(live.events.animations, (a) => a.name);
  const B = groupBy(build.events.animations, (a) => a.name);
  for (const [name, items] of [...L.entries()].sort()) {
    const b = B.get(name);
    if (!b) { out.push({ cls: 'entrance', name, state: 'missing', note: `fired on ${items.length} element(s) on live` }); continue; }
    out.push(b.length === items.length
      ? { cls: 'entrance', name, state: 'parity', note: `fired on ${items.length} element(s)` }
      : { cls: 'entrance', name, state: 'tolerance', deltas: [`fired-element count live ${items.length}, build ${b.length}`] });
  }
  for (const [name, items] of [...B.entries()].sort()) if (!L.has(name)) out.push({ cls: 'entrance', name, state: 'extra', note: `fired on ${items.length} element(s) on build, never on live` });
  return out;
}

function compareTransitions(live, build, opts) {
  const out = [];
  const longest = (items) => items.reduce((m, t) => { const v = maxTimeMs(t.dur); return v !== null && (m === null || v > m) ? v : m; }, null);
  const L = groupBy(live.events.transitions, (t) => t.prop);
  const B = groupBy(build.events.transitions, (t) => t.prop);
  for (const [prop, items] of [...L.entries()].sort()) {
    const b = B.get(prop);
    if (!b) { out.push({ cls: 'transition', name: prop, state: 'missing', note: `${items.length} event(s) on live, ${fmtMs(longest(items))}` }); continue; }
    const deltas = outOfTolerance([{ kind: 'timing', label: 'longest duration', live: longest(items), build: longest(b) }], opts);
    out.push(deltas.length
      ? { cls: 'transition', name: prop, state: 'tolerance', deltas, note: `${items.length} event(s) on live, ${b.length} on build` }
      : { cls: 'transition', name: prop, state: 'parity', note: `${items.length} event(s) on live, ${b.length} on build, ${fmtMs(longest(items))}` });
  }
  // A property transitioned on the build only is advisory: the event log records whatever the
  // traversal happened to touch (a parked pointer over a button, a smooth-scroll transform), and the
  // live list depends on the same accident — a hard EXTRA here failed faithful builds.
  for (const [prop, items] of [...B.entries()].sort()) if (!L.has(prop)) out.push({ cls: 'transition', name: prop, state: 'advisory', note: `${items.length} event(s) on build, none on live — a build-only transitioned property; incidental unless a live line names the motion` });
  return out;
}

function compareClasses(live, build) {
  const out = [];
  const flat = (list) => list.flatMap((m) => (Array.isArray(m.added) ? m.added : []).map((c) => ({ c, el: m.el })));
  const L = groupBy(flat(live.events.classMutations), (x) => x.c);
  const B = groupBy(flat(build.events.classMutations), (x) => x.c);
  for (const [c, items] of [...L.entries()].sort()) {
    out.push(B.has(c)
      ? { cls: 'class', name: c, state: 'parity', note: `added ${items.length}× on live, ${B.get(c).length}× on build` }
      : { cls: 'class', name: c, state: 'missing', note: `trigger class added ${items.length}× on live, never on build` });
  }
  for (const [c, items] of [...B.entries()].sort()) if (!L.has(c)) out.push({ cls: 'class', name: c, state: 'advisory', note: `added ${items.length}× on build, never on live — check it drives no invented behavior` });
  return out;
}

// ---- main -------------------------------------------------------------------------------------

export function compare(live, build, opts) {
  const verdicts = [
    ...compareHeader(live, build, opts),
    ...compareWidgets(live, build, opts),
    ...compareHovers(live, build, opts),
    ...compareEntrances(live, build),
    ...compareTransitions(live, build, opts),
    ...compareClasses(live, build),
  ];
  const count = (s) => verdicts.filter((v) => v.state === s).length;
  const counts = { behaviors: verdicts.length, parity: count('parity'), missing: count('missing'), extra: count('extra'), tolerance: count('tolerance'), dead: count('dead') + count('unobserved'), advisory: count('advisory') };
  // findings = the lines the agent must confirm and record; informational only (exit stays 0).
  const findings = verdicts.filter((v) => FINDING.has(v.state)).length;
  return { verdicts, counts, findings };
}

// The summary line: the four headline counts first (greppable), the rest in the parenthetical.
export function summaryLine(counts, opts) {
  return `motion summary: ${counts.parity} parity, ${counts.missing} missing, ${counts.extra} extra, ${counts.advisory} advisory (${counts.tolerance} out of tolerance, ${counts.dead} dead or unobserved on live — not required; tolerance ${opts.toleranceMs}ms / ${opts.tolerancePx}px)`;
}

function main() {
  const { livePath, buildPath, opts } = parseArgs(process.argv);
  const live = loadObservation(livePath, 'live');
  const build = loadObservation(buildPath, 'build');
  if (live.width && build.width && live.width !== build.width) console.error(`motion-compare WARNING: viewport widths differ (live ${live.width}, build ${build.width}) — chrome and widget behavior are breakpoint-dependent`);
  const { verdicts, counts, findings } = compare(live, build, opts);
  for (const v of verdicts) console.log(verdictLine(v));
  console.log(summaryLine(counts, opts));
  if (opts.json) {
    mkdirSync(dirname(opts.json) || '.', { recursive: true });
    writeFileSync(opts.json, JSON.stringify({ live: livePath, build: buildPath, toleranceMs: opts.toleranceMs, tolerancePx: opts.tolerancePx, advisory: true, findings, counts, verdicts: verdicts.map((v) => ({ ...v, line: verdictLine(v) })) }, null, 2));
  }
  // Advisory: both inputs parsed → exit 0, whatever the verdicts. The MISSING/EXTRA lines are
  // findings for the agent to confirm and record (progress.json motion: {observed, implemented, dead[]}).
  process.exitCode = 0;
}

// Only run when invoked directly, so the test can import the reducers. Compare by real path: node
// resolves the entry's symlinks for import.meta.url but not for argv[1], so a symlinked checkout or
// temp dir would otherwise turn the CLI into a silent no-op (exit 0, no lines — which reads as PASS).
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  try { main(); } catch (e) { console.error(`motion-compare error: ${e.message}`); process.exit(USAGE_EXIT); }
}
