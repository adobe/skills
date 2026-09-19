#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/motion-observe.mjs — the pure halves
// of the schema-2 observer, without a browser.
//
// Why: the observer's in-page code needs Chromium, but its contracts live in
// three importable functions: summariseEntrances (per-element inline-style
// aggregates → one row per element family with from/to and a median
// duration), summariseStateMachines (aria/hidden/open/data-state + scoped
// childList records grouped per element, click-paired transitions first), and
// hoverVerdict (a hover probe says hovered:false with a reason — no-box,
// intercepted — instead of an empty diff, and WARNs when :hover rules exist
// but nothing changed). Plus the CLI contract: --help exits 0 and names
// --triggers; --triggers takes only `auto`; an unknown flag exits 1.
//
// Usage: node plugins/stardust/evals/lint/motion-observe-fixtures.mjs  (exit 1 on findings)
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(import.meta.dirname, '..', '..', 'skills', 'replica', 'scripts', 'motion-observe.mjs');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const { SCHEMA, TRIGGER_SELECTOR, summariseEntrances, summariseStateMachines, hoverVerdict } = await import(SCRIPT);
check(SCHEMA === 2, 'SCHEMA must be 2');
check(/aria-expanded/.test(TRIGGER_SELECTOR) && /summary/.test(TRIGGER_SELECTOR) && /\[role=tab\]/.test(TRIGGER_SELECTOR), 'TRIGGER_SELECTOR must enumerate aria-expanded, role=tab and summary');

// summariseEntrances — 3 tween'd cards of one family + 1 hero, per-frame counts
const agg = [
  { family: 'div.card.reveal', path: 'main > section > div.card.reveal', count: 54, firstY: 800, firstT: 1000, lastT: 1890, first: { opacity: '0', transform: 'translate(0px, 25px)', visibility: null }, last: { opacity: '1', transform: 'none', visibility: null } },
  { family: 'div.card.reveal', path: 'main > section > div.card.reveal', count: 54, firstY: 800, firstT: 1100, lastT: 2010, first: { opacity: '0', transform: 'translate(0px, 25px)', visibility: null }, last: { opacity: '1', transform: 'none', visibility: null } },
  { family: 'div.card.reveal', path: 'main > section > div.card.reveal', count: 12, firstY: 1400, firstT: 3000, lastT: 3200, first: { opacity: '0', transform: 'translate(0px, 25px)', visibility: null }, last: { opacity: '1', transform: 'none', visibility: null } },
  { family: 'h1.hero__title', path: 'header > h1.hero__title', count: 60, firstY: 0, firstT: 200, lastT: 1100, first: { opacity: '0', transform: null, visibility: 'hidden' }, last: { opacity: '1', transform: null, visibility: 'visible' } },
];
const ent = summariseEntrances(agg);
check(ent.length === 2 && ent[0].family === 'h1.hero__title' && ent[1].family === 'div.card.reveal', `entrances: two families sorted by firstY, got ${JSON.stringify(ent.map((e) => e.family))}`);
const cards = ent[1];
check(cards.elements === 3 && cards.mutations === 120 && cards.firstY === 800 && cards.durationMs === 890, `entrances: cards row must aggregate 3 elements / 120 mutations / firstY 800 / median 890 ms, got ${JSON.stringify(cards)}`);
check(cards.from.opacity === '0' && cards.from.transform === 'translate(0px, 25px)' && cards.to.opacity === '1' && cards.to.transform === 'none', 'entrances: from/to are the modal first/last inline values');
check(ent[0].to.visibility === 'visible' && ent[0].durationMs === 900, 'entrances: hero row keeps visibility and its own duration');
check(summariseEntrances([]).length === 0 && summariseEntrances(undefined).length === 0, 'entrances: empty/undefined input → []');

// summariseStateMachines — a dropdown (aria-expanded + controls display), an untriggered sticky flag, a re-parented menu
const attrs = [
  { attr: 'aria-expanded', from: 'false', to: 'true', el: 'nav > button.drop-down__label-wrapper', y: 0, t: 5100, trigger: { el: 'nav > button.drop-down__label-wrapper', txt: 'Shop', dtMs: 40 }, controls: 'menu-shop', controlsDisplay: { before: 'none', after: 'block' } },
  { attr: 'aria-expanded', from: 'true', to: 'false', el: 'nav > button.drop-down__label-wrapper', y: 0, t: 6100, trigger: { el: 'nav > button.drop-down__label-wrapper', txt: 'Shop', dtMs: 35 }, controls: 'menu-shop', controlsDisplay: { before: 'block', after: 'none' } },
  { attr: 'data-state', from: 'hidden', to: 'shown', el: 'div.sticky-banner', y: 800, t: 2000, trigger: null, controls: null, controlsDisplay: null },
];
const childList = [{ el: 'body > div.mobile-drawer', added: ['ul.nav__list'], removed: [], y: 0, t: 5120, trigger: { el: 'header > button.hamburger', txt: '', dtMs: 60 } }];
const sm = summariseStateMachines(attrs, childList);
check(sm.length === 3, `stateMachines: 3 groups expected, got ${sm.length}`);
check(sm[0].el === 'nav > button.drop-down__label-wrapper' && sm[0].attr === 'aria-expanded' && sm[0].count === 2 && sm[0].triggered === 2 && sm[0].controls === 'menu-shop', `stateMachines: click-paired dropdown first with 2 transitions, got ${JSON.stringify(sm[0])}`);
check(sm[0].transitions[0].controlsDisplay.after === 'block' && sm[0].transitions[1].controlsDisplay.after === 'none', 'stateMachines: aria-controls target display recorded per transition');
check(sm[1].kind === 'childList' && sm[1].transitions[0].added[0] === 'ul.nav__list' && sm[1].triggered === 1, 'stateMachines: re-parented menu is a childList machine paired to the hamburger click');
check(sm[2].attr === 'data-state' && sm[2].triggered === 0, 'stateMachines: untriggered scroll flag sorts last');

// hoverVerdict — the three outcomes
const before = { self: { color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' }, subs: [{ el: 'a.link', color: 'rgb(0, 0, 0)' }] };
const afterChanged = { self: { color: 'rgb(255, 0, 0)', background: 'rgb(255, 255, 255)' }, subs: [{ el: 'a.link', color: 'rgb(0, 0, 255)' }] };
const okBox = { x: 10, y: 10, width: 100, height: 40 };
let v = hoverVerdict({ box: null, hit: null, before, after: afterChanged });
check(v.hovered === false && v.reason === 'no-box' && v.changed.length === 0, `hoverVerdict: null box → hovered:false no-box, got ${JSON.stringify(v)}`);
v = hoverVerdict({ box: { ...okBox, width: 0 }, hit: null, before, after: afterChanged });
check(v.hovered === false && v.reason === 'no-box', 'hoverVerdict: zero-size box → no-box');
v = hoverVerdict({ box: okBox, hit: { self: false, path: 'div.overlay' }, before, after: afterChanged });
check(v.hovered === false && v.reason === 'intercepted' && v.by === 'div.overlay' && /intercepted/.test(v.warn), `hoverVerdict: intercepted pointer → hovered:false with the interceptor, got ${JSON.stringify(v)}`);
v = hoverVerdict({ box: okBox, hit: { self: true, path: 'a.card' }, before, after: afterChanged, hoverRules: 2 });
check(v.hovered === true && JSON.stringify(v.changed) === JSON.stringify(['self.color', 'a.link.color']) && !v.warn, `hoverVerdict: real hover lists changed props (self + sub), no warn, got ${JSON.stringify(v)}`);
v = hoverVerdict({ box: okBox, hit: { self: true, path: 'a.card' }, before, after: before, hoverRules: 3 });
check(v.hovered === true && v.changed.length === 0 && /3 :hover rule/.test(v.warn), 'hoverVerdict: :hover rules but no change → WARN');
v = hoverVerdict({ box: okBox, hit: { self: true, path: 'a.card' }, before, after: before, hoverRules: 0 });
check(v.hovered === true && v.changed.length === 0 && !v.warn, 'hoverVerdict: no rules, no change → quiet');

// CLI contract
const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
check(help.status === 0 && /--triggers auto/.test(help.stdout) && /Usage:/.test(help.stdout), '--help must exit 0 and name --triggers auto');
const bad = spawnSync(process.execPath, [SCRIPT, 'https://example.test/', 'out.json', '--triggers', 'all'], { encoding: 'utf8' });
check(bad.status === 1 && /--triggers takes "auto"/.test(bad.stderr), '--triggers with a value other than auto must exit 1');
const unknown = spawnSync(process.execPath, [SCRIPT, 'https://example.test/', 'out.json', '--bogus'], { encoding: 'utf8' });
check(unknown.status === 1 && /unknown flag --bogus/.test(unknown.stderr), 'an unknown flag must exit 1');

if (failures.length) { console.error(`motion-observe-fixtures: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('motion-observe-fixtures: ok (entrances summary, state machines, hover verdicts, CLI contract)');
