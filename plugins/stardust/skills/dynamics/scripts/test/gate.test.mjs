#!/usr/bin/env node
/**
 * Fixture test for the dynamics close-out gate (no network, no browser).
 * Run: node skills/dynamics/scripts/test/gate.test.mjs
 *
 * `gate()` is the implementation of reference/parity-report.md rule 8; this
 * fixture pins which parity rows block and which never do (including the
 * index-status.json condition for built index-backed rows), the close-out
 * sections, and the CLI's exit 3 when parity.json is missing under `--gate`.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, closeoutSections } from '../dynamics-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };
const blocks = (feature) => gate({ features: [feature] }).length;
const search = (extra) => ({ type: 'search-query', path: '/search', terms: ['a'], resultSelector: 'li', ...extra });

// rule 8, condition 2 — only `self` rows still pending block
eq('self pending → blocks', blocks({ feature: 'search', class: 'S', reproducibility: 'self', status: 'pending search' }), 1);
eq('self in-progress → blocks', blocks({ feature: 'modal', class: 'M', reproducibility: 'self', status: 'in-progress' }), 1);
eq('self interim → clear', blocks({ feature: 'modal', class: 'M', reproducibility: 'self', status: 'interim', owner: 'pick the dialog size' }), 0);
eq('needs-credential pending → never blocks', blocks({ feature: 'api', class: 'A', reproducibility: 'needs-credential', status: 'pending off-origin data' }), 0);
eq('scaffolded-awaiting-owner → clear', blocks({ feature: 'tags', class: 'T', reproducibility: 'needs-business-decision', status: 'scaffolded-awaiting-owner', owner: 'CMP id' }), 0);

// condition 3 — a built S row needs a search-query compared with live or floored
eq('S done, no checks → blocks', blocks({ feature: 'search', class: 'S', reproducibility: 'self', status: 'done' }), 1);
eq('S done, search-query without compareLive/minResults → blocks', blocks({ feature: 'search', class: 'S', status: 'done', checks: [search({})] }), 1);
eq('S done, compareLive → clear', blocks({ feature: 'search', class: 'S', status: 'done', checks: [search({ compareLive: { url: 'https://live.example/search' } })] }), 0);
eq('S done, minResults floor → clear', blocks({ feature: 'search', class: 'S', status: 'done', checks: [search({ minResults: 3 })] }), 0);
eq('S delivered-by-capture, no checks → clear', blocks({ feature: 'search', class: 'S', reproducibility: 'needs-human-capture', status: 'delivered-by-capture' }), 0);
eq('S pending non-self → clear', blocks({ feature: 'search', class: 'S', reproducibility: 'needs-backend', status: 'pending search' }), 0);

// condition 4 — a built V row on an explicit player pattern needs video-plays
eq('V done embed-passthrough, no video-plays → blocks', blocks({ feature: 'player', class: 'V', disposition: 'embed-passthrough', status: 'done', checks: [{ type: 'dom-count', path: '/', selector: 'iframe', min: 1 }] }), 1);
eq('V done pattern hls-stream, no video-plays → blocks', blocks({ feature: 'stream', class: 'V', pattern: 'hls-stream', status: 'done' }), 1);
eq('V done media-as-url with video-plays → clear', blocks({ feature: 'player', class: 'V', disposition: 'media-as-url', status: 'done', checks: [{ type: 'video-plays', path: '/', playbackHost: 'vendor' }] }), 0);
eq('V done, no disposition/pattern → clear (not defaulted to embed-passthrough)', blocks({ feature: 'poster', class: 'V', status: 'done' }), 0);
eq('V done rebuild-native → clear', blocks({ feature: 'hero', class: 'V', disposition: 'rebuild-native', status: 'done' }), 0);
eq('V delivered-by-capture without disposition → clear', blocks({ feature: 'player', class: 'V', reproducibility: 'needs-human-capture', status: 'delivered-by-capture' }), 0);
eq('V delivered-by-capture embed-passthrough → clear', blocks({ feature: 'player', class: 'V', disposition: 'embed-passthrough', status: 'delivered-by-capture' }), 0);

// condition 5 — a built index-backed row needs index-status.json registered (config or repo-yaml), never denied or missing
const gateWith = (feature, indexStatus) => gate({ features: [feature] }, { indexStatus }).length;
const listing = { feature: 'news listing', class: 'L', pattern: 'listing-index-backed', disposition: 'index-backed', status: 'done', checks: [{ type: 'listing-rows', path: '/news', block: 'cards' }] };
eq('L done index-backed, index-status denied → blocks', gateWith(listing, { registered: 'denied' }), 1);
eq('L done index-backed, index-status config → clear', gateWith(listing, { registered: 'config' }), 0);
eq('L done index-backed, index-status repo-yaml → clear', gateWith(listing, { registered: 'repo-yaml' }), 0);
eq('L done index-backed, index-status missing → blocks', gateWith(listing, null), 1);
eq('L done index-backed, gate() without options → blocks (missing)', blocks(listing), 1);
eq('S done search-index-backed pattern, denied → blocks', gateWith({ feature: 'search', class: 'S', pattern: 'search-index-backed', status: 'done', checks: [search({ minResults: 3 })] }, { registered: 'denied' }), 1);
eq('L interim index-backed, missing → clear (not built)', gateWith({ ...listing, status: 'interim', owner: 'index-driven or curated?' }, null), 0);
eq('L scaffolded-awaiting-owner index-backed, denied → clear', gateWith({ ...listing, status: 'scaffolded-awaiting-owner', owner: 'org admin registers query.yaml per INDEX-CONFIG.md' }, { registered: 'denied' }), 0);
eq('L done static-snapshot, missing → clear', gateWith({ feature: 'rail', class: 'L', disposition: 'static-snapshot', status: 'done' }, null), 0);
const [indexLine] = gate({ features: [listing] }, { indexStatus: { registered: 'denied' } });
eq('index line names row, denied and the remedy', /^news listing \(L\): status "done", index-backed with index-status\.json registered: denied — run node skills\/rollout\/scripts\/query-index\.mjs .*exit 0/.test(indexLine), true);

// a click-control row is a replay check (exit 1 on failure like any type), never a rule-8 close-out condition
eq('M done with click-control only → clear (not extended to gate)', blocks({ feature: 'menu', class: 'M', reproducibility: 'self', status: 'done', checks: [{ type: 'click-control', path: '/', trigger: 'button.menu', observe: 'aria-expanded' }] }), 0);
eq('S done with click-control but no search-query → still blocks (click-control satisfies no other condition)', blocks({ feature: 'search', class: 'S', status: 'done', checks: [{ type: 'click-control', path: '/', trigger: '.search-toggle', observe: 'visible:.search-box' }] }), 1);

// the gate line names the row and the remedy
const [line] = gate({ features: [{ feature: 'contact modal', class: 'M', reproducibility: 'self', status: 'pending modal' }] });
eq('gate line names feature, class, status and remedy', /^contact modal \(M\): reproducibility self, status "pending modal" — implement it .*named owner decision$/.test(line), true);

// close-out sections — counts by bucket, owner values only for undelivered rows
const parity = { features: [
  { feature: 'a', class: 'M', status: 'done', owner: 'ignored — delivered' },
  { feature: 'b', class: 'S', status: 'delivered-by-capture' },
  { feature: 'c', class: 'A', status: 'interim', owner: 'datasource ownership' },
  { feature: 'd', class: 'T', status: 'scaffolded-awaiting-owner', owner: 'CMP id on the new host' },
  { feature: 'e', class: 'X', status: 'decided-out' },
  { feature: 'f', class: 'F', status: 'pending forms' },
  { feature: 'g', class: 'CR', status: 'skipped-source-broken' },
] };
const sections = closeoutSections(parity);
eq('counts line', sections[3], 'delivered 2 · interim 1 · scaffolded 1 · decided-out 1 · pending 1 · other 1');
eq('owner values exclude delivered rows', sections.slice(7), ['- c (A, interim) — datasource ownership', '- d (T, scaffolded-awaiting-owner) — CMP id on the new host']);
eq('empty parity → no features / none', closeoutSections({})[3] === 'no features' && closeoutSections({}).slice(-1)[0] === '- none', true);

// CLI: `--gate` with parity.json missing exits 3 before any browser is launched
const r = spawnSync(process.execPath, [join(here, '..', 'dynamics-check.mjs'), '--origin', 'https://target.example', '--parity', join(here, 'does-not-exist.json'), '--gate'], { encoding: 'utf8' });
eq('--gate, parity.json missing → exit 3', r.status, 3);
eq('--gate, parity.json missing → GATE line', /GATE: .*does-not-exist\.json missing/.test(r.stderr), true);
const u = spawnSync(process.execPath, [join(here, '..', 'dynamics-check.mjs')], { encoding: 'utf8' });
eq('no --origin → exit 2', u.status, 2);

if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('dynamics gate: all assertions pass');
