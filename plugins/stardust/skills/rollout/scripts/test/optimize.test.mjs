#!/usr/bin/env node
// skills/rollout/scripts/test/optimize.test.mjs — the source-parity contract of optimize.mjs: a baseline
// finding whose condition the SOURCE capture shares (same <title>, no description on the source either, no
// JSON-LD on the source either, no <h1> on the source either (0 delivered, capture headings without an
// h1), the same title shared by the same pages) is tagged `fixability:
// out-of-scope` with the `source parity: ` evidence prefix and autofix unavailable; such findings are
// listed in their own report section, excluded from the health score and the open P1/P2/P3 counts and
// never gate; a finding the source does NOT share keeps its routing; without a capture nothing is tagged
// and the same P1 gates. The informational disposition: every source-parity finding is recorded
// `status: informational` (never open) — new, carried over, migrated from an older `open` ledger and on
// regression — and becomes `open` again when it stops being parity; a non-parity out-of-scope finding stays
// open, scored and gating; findings.json and the scorecard agree (its `informational` count, its open
// counts = the ledger's open rows); health is what
// it was for the same input. Offline (--root + --current fixtures). --help writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/optimize.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeScorecard, isSourceParity, liveStatus, markSourceParity, sourceParityCounts, SOURCE_PARITY_PREFIX } from '../lib.mjs';
import { loadSchema, validate } from './schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'optimize.mjs');
const FINDINGS = join(HERE, '..', 'findings.mjs');
const AUTOFIX = join(HERE, '..', 'autofix-aem.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// --- fixtures -------------------------------------------------------------------------------------
// Delivered pages (the --root tree) and their captures (the --current tree). Per page, which of its
// findings mirror the source is spelled out beside it.
const page = (title, { desc = null, jsonld = false, canonical = false } = {}) => `<!doctype html><html><head>${title === null ? '' : `<title>${title}</title>`}${desc === null ? '' : `<meta name="description" content="${desc}">`}${canonical ? '<link rel="canonical" href="https://x/">' : ''}${jsonld ? '<script type="application/ld+json">{"@type":"WebPage"}</script>' : ''}</head><body><main><h1>H</h1></main></body></html>`;
const sidecar = (jsonld) => `<html><head>${jsonld ? '<script type="application/ld+json">{}</script>' : ''}</head><body></body></html>`;
function fixture({ withCapture = true } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'optimize-'));
  const out = join(proj, 'stardust', 'rollout'); mkdirSync(join(out, 'coverage'), { recursive: true }); mkdirSync(join(out, 'site'));
  const root = join(proj, 'delivered'); mkdirSync(join(root, 'tours'), { recursive: true });
  const cur = join(proj, 'stardust', 'current'); mkdirSync(join(cur, 'pages'), { recursive: true });
  writeFileSync(join(out, 'site', 'sitemap.xml'), '<urlset/>');
  writeFileSync(join(out, 'rollout.json'), '{}');
  const rows = [['home', '/'], ['about', '/about'], ['contact', '/contact'], ['tours-bali', '/tours/bali'], ['legal', '/legal']];
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: rows.map(([slug, path]) => ({ slug, path, delivery: { status: 'deployed' } })) }));
  // home: title "Acme" (4 chars → title-length), no description, no JSON-LD, no canonical.
  //   capture: same title, no description, sidecar without JSON-LD → title-length, meta-description, jsonld are parity; canonical is not.
  writeFileSync(join(root, 'index.html'), page('Acme'));
  // about: same title "Acme" (duplicate-title with home), description "Shared desc", no JSON-LD.
  //   capture: title Acme, description Shared desc, sidecar WITH JSON-LD → duplicate-title parity; jsonld NOT parity.
  writeFileSync(join(root, 'about.html'), page('Acme', { desc: 'Shared desc' }));
  // contact: fine title, description "Shared desc" (duplicate-description with about), JSON-LD + canonical present.
  //   capture: a different description → duplicate-description NOT parity.
  writeFileSync(join(root, 'contact.html'), page('Contact Acme — reach the team today', { desc: 'Shared desc', jsonld: true, canonical: true }));
  // tours-bali: title "A &amp; B" (9 raw chars → title-length), no description, no JSON-LD.
  //   capture: title "A & B" (entities decode for the comparison), description present, NO sidecar → title-length parity; meta-description NOT; jsonld unknown → NOT.
  writeFileSync(join(root, 'tours', 'bali.html'), page('A &amp; B'));
  // legal: no <title> at all (P1 title-missing), no description.
  //   capture: empty title, empty description → title-missing (P1) and meta-description are parity.
  writeFileSync(join(root, 'legal.html'), page(null));
  if (withCapture) {
    const cap = (slug, rec, side) => { writeFileSync(join(cur, 'pages', `${slug}.json`), JSON.stringify({ slug, ...rec, ...(side === undefined ? {} : { renderedHtml: `pages/${slug}.html` }) })); if (side !== undefined) writeFileSync(join(cur, 'pages', `${slug}.html`), sidecar(side)); };
    cap('home', { title: 'Acme', description: null }, false);
    cap('about', { title: 'Acme', description: 'Shared desc' }, true);
    cap('contact', { title: 'Contact Acme — reach the team today', description: 'Different on the source' }, true);
    cap('tours-bali', { title: 'A & B', description: 'Bali and beyond' });
    cap('legal', { title: '', description: '' }, false);
  }
  return { proj, out, root, cur };
}
const run = (proj, root, cur, extra = []) => spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', join(proj, 'stardust', 'rollout'), '--current', cur, ...extra], { encoding: 'utf8', cwd: proj });
const findings = (out) => JSON.parse(readFileSync(join(out, 'optimize', 'findings.json'), 'utf8'));
const scorecard = (out) => JSON.parse(readFileSync(join(out, 'optimize', 'scorecard.json'), 'utf8'));
const byCheck = (list, check, ids) => list.find((f) => f.check === check && f.scope.ids.slice().sort().join(',') === ids.slice().sort().join(','));

check('--help prints the header (naming --current and source parity) and writes nothing', () => {
  const proj = mkdtempSync(join(tmpdir(), 'optimize-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: proj });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /--current <captureDir>/); assert.match(r.stdout, /Source parity/);
  assert.match(r.stdout, /open \| in-progress \| fixed \| accepted \| wontfix \| informational/);
  assert.deepEqual(readdirSync(proj), []);
  rmSync(proj, { recursive: true, force: true });
});

check('lib: markSourceParity tags with out-of-scope + the evidence prefix and disables autofix; isSourceParity reads both', () => {
  const f = { id: 'f-1', check: 'title-length', severity: 'P3', fixability: 'platform-migration', evidence: '<title> is 4 chars', autofix: { available: true, status: 'pending' }, status: 'open' };
  const m = markSourceParity(f, 'the source page carries the same <title>');
  assert.equal(m.fixability, 'out-of-scope');
  assert.equal(m.evidence, `${SOURCE_PARITY_PREFIX}<title> is 4 chars — the source page carries the same <title>`);
  assert.equal(m.autofix.available, false); assert.equal(m.autofix.status, 'unavailable');
  assert.equal(isSourceParity(m), true);
  assert.equal(isSourceParity(f), false);
  assert.equal(isSourceParity({ ...f, fixability: 'out-of-scope' }), false, 'a plain informational finding is not parity');
  assert.equal(isSourceParity({ ...f, evidence: m.evidence }), false, 'the prefix alone is not parity either');
});

check('lib: computeScorecard excludes open parity findings from every score and the open counts; sourceParityCounts reports them', () => {
  const mk = (sev, layer, parity) => (parity ? markSourceParity({ id: `${sev}${layer}${Math.random()}`, layer, check: 'x', severity: sev, fixability: 'platform-migration', evidence: 'e', status: 'open' }, 'why') : { id: `${sev}${layer}${Math.random()}`, layer, check: 'x', severity: sev, fixability: 'platform-migration', evidence: 'e', status: 'open' });
  const list = [mk('P1', 'seo', true), mk('P2', 'seo', false), mk('P2', 'ai-search', true), mk('P3', 'cross-page', true), { id: 'fx', layer: 'seo', check: 'y', severity: 'P1', fixability: 'platform-migration', evidence: 'e', status: 'fixed' }];
  const s = computeScorecard(list, 'run-1', 'now');
  assert.deepEqual(s.severity, { P1: 0, P2: 1, P3: 0 });
  assert.equal(s.dimensions.seo, 90, 'only the non-parity P2 (10) counts against seo');
  assert.equal(s.dimensions['ai-search'], 100, 'assessed, nothing scored against it');
  assert.equal(s.dimensions['cross-page'], 100);
  assert.equal(s.dimensions.accessibility, null, 'not assessed');
  assert.deepEqual(s.fixed, { P1: 1, P2: 0, P3: 0 });
  assert.deepEqual(sourceParityCounts(list), { total: 3, P1: 1, P2: 1, P3: 1 });
});

check('lib: computeScorecard counts informational rows by severity and never scores them; sourceParityCounts reads informational parity rows too', () => {
  const row = (id, severity, status, fixability = 'platform-migration') => ({ id, layer: 'seo', check: 'x', severity, fixability, evidence: 'e', status });
  const parity = markSourceParity(row('p', 'P1', 'informational'), 'why');
  const s = computeScorecard([parity, markSourceParity(row('q', 'P2', 'informational'), 'why'), row('o', 'P3', 'open')], 'run-1', 'now');
  assert.deepEqual(s.informational, { total: 2, P1: 1, P2: 1, P3: 0 });
  assert.deepEqual(s.severity, { P1: 0, P2: 0, P3: 1 });
  assert.equal(s.dimensions.seo, 96);
  assert.deepEqual(sourceParityCounts([parity]), { total: 1, P1: 1, P2: 0, P3: 0 });
});

check('lib: liveStatus — informational is for source parity only; a non-parity out-of-scope finding stays open/in-progress', () => {
  const plain = { fixability: 'out-of-scope', evidence: 'e' };
  const parity = markSourceParity({ fixability: 'platform-migration', evidence: 'e' }, 'why');
  assert.equal(liveStatus(parity, 'open'), 'informational');
  assert.equal(liveStatus(parity, 'in-progress'), 'informational');
  assert.equal(liveStatus(plain, 'open'), 'open');
  assert.equal(liveStatus(plain, 'in-progress'), 'in-progress');
  assert.equal(liveStatus(plain, 'informational'), 'open', 'no longer parity → open');
  assert.equal(liveStatus(parity, 'accepted'), 'accepted');
});

const { proj, out, root, cur } = fixture();
const first = run(proj, root, cur);
const F1 = findings(out).findings;

check('findings that mirror the capture are tagged; findings the source does not share keep their routing', () => {
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const parity = (f) => { assert.ok(f, 'finding exists'); assert.equal(f.fixability, 'out-of-scope', f.evidence); assert.ok(f.evidence.startsWith(SOURCE_PARITY_PREFIX), f.evidence); assert.equal(f.autofix.available, false); assert.equal(f.status, 'informational'); };
  const kept = (f, fixability) => { assert.ok(f, 'finding exists'); assert.equal(f.fixability, fixability, f.evidence); assert.ok(!f.evidence.startsWith(SOURCE_PARITY_PREFIX), f.evidence); assert.equal(f.status, 'open'); };
  parity(byCheck(F1, 'title-length', ['home']));
  assert.match(byCheck(F1, 'title-length', ['home']).evidence, /the source page carries the same <title>$/);
  parity(byCheck(F1, 'meta-description', ['home']));
  parity(byCheck(F1, 'jsonld', ['home']));
  kept(byCheck(F1, 'canonical', ['home']), 'platform-migration');
  kept(byCheck(F1, 'jsonld', ['about']), 'platform-migration'); // the source page HAS JSON-LD
  parity(byCheck(F1, 'duplicate-title', ['about', 'home']));
  kept(byCheck(F1, 'duplicate-description', ['about', 'contact']), 'design-pass'); // the source descriptions differ
  parity(byCheck(F1, 'title-length', ['tours-bali'])); // "A &amp; B" delivered vs "A & B" captured
  kept(byCheck(F1, 'meta-description', ['tours-bali']), 'platform-migration'); // the source has a description
  kept(byCheck(F1, 'jsonld', ['tours-bali']), 'platform-migration'); // no rendered sidecar → unknown, not tagged
  const legal = byCheck(F1, 'title-missing', ['legal']);
  parity(legal); assert.equal(legal.severity, 'P1');
  parity(byCheck(F1, 'meta-description', ['legal']));
});

check('the scorecard counts and health exclude the parity findings; the only P1 is parity and the gate passes', () => {
  const sc = scorecard(out).current;
  const live = F1.filter((f) => f.status === 'open' || f.status === 'informational');
  const scored = live.filter((f) => !isSourceParity(f));
  const sev = (list, s) => list.filter((f) => f.severity === s).length;
  assert.equal(sev(live, 'P1'), 1, 'one live P1 exists in the ledger (legal/title-missing, informational)');
  assert.deepEqual(sc.severity, { P1: 0, P2: sev(scored, 'P2'), P3: sev(scored, 'P3') });
  assert.ok(sev(live, 'P2') > sev(scored, 'P2'), 'parity P2s were excluded from the count');
  const seoPenalty = scored.filter((f) => f.layer === 'seo').reduce((n, f) => n + ({ P1: 25, P2: 10, P3: 4 }[f.severity]), 0);
  assert.equal(sc.dimensions.seo, Math.max(0, 100 - seoPenalty));
  assert.match(first.stdout, /^Open {8}P1 0 · /m);
  assert.match(first.stdout, /^Source parity {2}\d+ \(P1 1 · P2 \d+ · P3 \d+\) — mirror the source capture \(5\/5 pages captured/m);
  assert.match(first.stdout, /^source parity — informational \(mirrors the source capture; not scored, not gated, not auto-fixed\):$/m);
  assert.match(first.stdout, /^ {2}P1 seo\/title-missing \[legal\] — source parity: no <title> — the source page has no <title> either$/m);
  assert.match(first.stdout, /✓ GATE: no open P1 findings\./);
  const oosSection = first.stdout.split('\n').filter((l) => l.startsWith('out-of-scope —'));
  assert.equal(oosSection.length, 0, 'parity findings are not listed under the generic out-of-scope route');
});

check('a re-run keeps the parity findings informational with stable ids (never flipped to fixed) and appends the run', () => {
  const second = run(proj, root, cur);
  assert.equal(second.status, 0, second.stdout);
  const doc = findings(out);
  assert.equal(doc.runs.length, 2);
  const f = byCheck(doc.findings, 'title-length', ['home']);
  assert.equal(f.id, byCheck(F1, 'title-length', ['home']).id); assert.equal(f.status, 'informational'); assert.equal(f.firstSeenRun, 'run-1');
  assert.equal(doc.findings.filter((x) => x.status === 'fixed').length, 0);
});

check('a prior open finding becomes parity-tagged on the run that finds the capture (autofix re-derived), and the schema fields stay the same', () => {
  const alt = fixture({ withCapture: false });
  const r0 = run(alt.proj, alt.root, alt.cur);
  assert.equal(r0.status, 1, 'no capture: legal/title-missing is a real open P1 and gates');
  assert.match(r0.stdout, /^Source parity {2}not assessed — no capture under /m);
  const before = byCheck(findings(alt.out).findings, 'title-length', ['home']);
  assert.equal(before.fixability, 'platform-migration'); assert.equal(before.autofix.available, true);
  // now the capture appears (a later extract) and the same run re-tags the still-open finding
  const { cur: withCap } = fixture();
  const r1 = run(alt.proj, alt.root, withCap);
  assert.equal(r1.status, 0, r1.stdout);
  const after = byCheck(findings(alt.out).findings, 'title-length', ['home']);
  assert.equal(before.status, 'open');
  assert.equal(after.id, before.id); assert.equal(after.fixability, 'out-of-scope'); assert.equal(after.autofix.available, false); assert.equal(after.firstSeenRun, 'run-1');
  assert.equal(after.status, 'informational');
  const allowed = ['id', 'source', 'layer', 'check', 'severity', 'scope', 'evidence', 'fixability', 'recommendedMove', 'status', 'autofix', 'resolvedBy', 'firstSeenRun'];
  for (const f of findings(alt.out).findings) for (const k of Object.keys(f)) assert.ok(allowed.includes(k), `unexpected finding property ${k}`);
  rmSync(alt.proj, { recursive: true, force: true });
});

rmSync(proj, { recursive: true, force: true });

check('single-h1: 0 delivered <h1> with a capture whose headings carry no h1 is source parity; a capture with an h1 or 2 <h1> stays a plain P1', () => {
  const p = mkdtempSync(join(tmpdir(), 'optimize-h1-'));
  const o = join(p, 'stardust', 'rollout'); mkdirSync(join(o, 'coverage'), { recursive: true }); mkdirSync(join(o, 'site'));
  const rt = join(p, 'delivered'); mkdirSync(rt);
  const cu = join(p, 'stardust', 'current'); mkdirSync(join(cu, 'pages'), { recursive: true });
  writeFileSync(join(o, 'site', 'sitemap.xml'), '<urlset/>'); writeFileSync(join(o, 'rollout.json'), '{}');
  const slugs = ['none-none', 'none-has', 'two-none'];
  writeFileSync(join(o, 'coverage', 'pages.json'), JSON.stringify({ pages: slugs.map((slug) => ({ slug, path: `/${slug}`, delivery: { status: 'deployed' } })) }));
  const body = (h1s) => `<!doctype html><html><head><title>A page title of decent length</title></head><body><main>${'<h1>T</h1>'.repeat(h1s)}<h2>S</h2></main></body></html>`;
  writeFileSync(join(rt, 'none-none.html'), body(0));
  writeFileSync(join(rt, 'none-has.html'), body(0));
  writeFileSync(join(rt, 'two-none.html'), body(2));
  const capH = (slug, tags) => writeFileSync(join(cu, 'pages', `${slug}.json`), JSON.stringify({ slug, title: 'A page title of decent length', headings: tags.map((tag) => ({ tag, text: 'x' })) }));
  capH('none-none', ['h2', 'h3']); capH('none-has', ['h1', 'h2']); capH('two-none', ['h2']);
  const r = run(p, rt, cu);
  assert.equal(r.status, 1, 'the two plain P1s still gate');
  const F = findings(o).findings;
  const parity = byCheck(F, 'single-h1', ['none-none']);
  assert.ok(isSourceParity(parity), parity.evidence); assert.equal(parity.severity, 'P1'); assert.equal(parity.autofix.available, false);
  assert.match(parity.evidence, /0 <h1> \(expected exactly 1\) — the source page has no <h1> either$/);
  for (const slug of ['none-has', 'two-none']) {
    const f = byCheck(F, 'single-h1', [slug]);
    assert.equal(isSourceParity(f), false, `${slug}: ${f.evidence}`); assert.equal(f.fixability, 'platform-migration'); assert.equal(f.autofix.available, true);
  }
  assert.equal(scorecard(o).current.severity.P1, 2, 'only the two plain single-h1 findings count as open P1');
  assert.match(r.stdout, /✗ GATE: 2 open P1 finding\(s\)/);
  rmSync(p, { recursive: true, force: true });
});

const record = (o, extra) => spawnSync(process.execPath, [FINDINGS, 'record', '--out', o, ...extra], { encoding: 'utf8' });
const sevOf = (list, s) => list.filter((f) => f.severity === s).length;

check('findings.json and the scorecard agree: no informational finding is open, the scorecard counts them, its open counts are the ledger\'s, health as before', () => {
  const t = fixture();
  const r1 = run(t.proj, t.root, t.cur);
  assert.equal(r1.status, 0, r1.stdout);
  const health = scorecard(t.out).current.overall;
  // a plain out-of-scope P2 from another audit source (not parity) joins the same ledger: open and scored, as before
  const rec = record(t.out, ['--source', 'audit:external', '--layer', 'seo', '--check', 'hreflang', '--severity', 'P2', '--fixability', 'out-of-scope', '--scope-ids', 'home', '--evidence', 'no hreflang alternates']);
  assert.equal(rec.status, 0, rec.stderr);
  const r2 = run(t.proj, t.root, t.cur);
  assert.equal(r2.status, 0, r2.stdout);
  const F = findings(t.out).findings; const sc = scorecard(t.out).current;
  const info = F.filter(isSourceParity);
  const ext = F.find((f) => f.check === 'hreflang');
  assert.ok(info.length > 0); assert.equal(ext.status, 'open', 'a non-parity out-of-scope finding stays open');
  assert.deepEqual(info.filter((f) => f.status !== 'informational').map((f) => `${f.check} ${f.status}`), [], 'every parity finding carries status informational');
  assert.equal(F.filter((f) => f.status === 'informational').length, info.length, 'only parity findings carry it');
  assert.deepEqual(sc.informational, { total: info.length, P1: sevOf(info, 'P1'), P2: sevOf(info, 'P2'), P3: sevOf(info, 'P3') });
  const open = F.filter((f) => f.status === 'open');
  assert.deepEqual(sc.severity, { P1: sevOf(open, 'P1'), P2: sevOf(open, 'P2'), P3: sevOf(open, 'P3') });
  assert.ok(sc.overall < health, 'the out-of-scope P2 is scored');
  // the same input as before this status existed: the informational rows were `open`, and the score skipped the parity ones
  const before = F.map((f) => (f.status === 'informational' ? { ...f, status: 'open' } : f));
  assert.equal(computeScorecard(before, 'run-x', 'now').overall, sc.overall, 'health unchanged for the same input');
  assert.match(r2.stdout, new RegExp(`^Health {6}${sc.overall}/100 · informational ${info.length} {3}\\(a11y `, 'm'));
  assert.match(r2.stdout, /^out-of-scope — informational:$/m);
  assert.match(r2.stdout, /^ {2}P2 seo\/hreflang \[home\] — no hreflang alternates$/m);
  assert.match(r2.stdout, /^source parity — informational /m);
  assert.match(r2.stdout, /✓ GATE: no open P1 findings\./);
  const schemaErrors = [
    ...validate(loadSchema('rollout-findings.schema.json'), findings(t.out)),
    ...validate(loadSchema('rollout-scorecard.schema.json'), scorecard(t.out)),
  ];
  assert.deepEqual(schemaErrors, [], 'an informational ledger and its scorecard validate against the schemas');
  // autofix-aem rewrites the scorecard from the same ledger (here with no candidate) and keeps the count
  const fx = spawnSync(process.execPath, [AUTOFIX, '--project', join(t.proj, 'eds'), '--out', t.out, '--check', 'none'], { encoding: 'utf8' });
  assert.equal(fx.status, 0, fx.stderr);
  const after = JSON.parse(readFileSync(join(t.out, 'optimize', 'scorecard.json'), 'utf8'));
  assert.equal(after.history.length, 3);
  assert.deepEqual(after.current.informational, sc.informational);
  assert.deepEqual(after.current.severity, sc.severity);
  rmSync(t.proj, { recursive: true, force: true });
});

check('a ledger written before the informational status migrates on the next run: open parity rows become informational (firstSeenRun kept); a non-parity out-of-scope row stays as it was', () => {
  const t = fixture();
  run(t.proj, t.root, t.cur);
  const doc = findings(t.out);
  doc.findings = doc.findings.map((f) => (isSourceParity(f) ? { ...f, status: 'open', firstSeenRun: 'run-legacy' } : f));
  doc.findings.push({ id: 'f-external01', source: 'audit:external', layer: 'design-ux', check: 'contrast-note', severity: 'P2', scope: { level: 'page', ids: ['about'] }, evidence: 'e', fixability: 'out-of-scope', recommendedMove: '', status: 'in-progress', autofix: null, resolvedBy: null, firstSeenRun: 'recorded' });
  writeFileSync(join(t.out, 'optimize', 'findings.json'), JSON.stringify(doc));
  const r = run(t.proj, t.root, t.cur);
  assert.equal(r.status, 0, r.stdout);
  const F = findings(t.out).findings;
  const parity = F.filter(isSourceParity);
  assert.ok(parity.length >= 8);
  for (const f of parity) { assert.equal(f.status, 'informational', f.check); assert.equal(f.firstSeenRun, 'run-legacy', f.check); }
  const ext = F.find((f) => f.id === 'f-external01');
  assert.equal(ext.status, 'in-progress'); assert.equal(ext.firstSeenRun, 'recorded');
  assert.equal(F.filter((f) => f.status === 'fixed').length, 0);
  assert.equal(scorecard(t.out).current.informational.total, parity.length);
  rmSync(t.proj, { recursive: true, force: true });
});

check('no gate weakened: a non-parity out-of-scope P1 recorded from another source stays open, counts as an open P1 and gates optimize', () => {
  const t = fixture();
  assert.equal(run(t.proj, t.root, t.cur).status, 0, 'only the parity P1 exists so far');
  const rec = record(t.out, ['--source', 'audit:external', '--layer', 'accessibility', '--check', 'focus-order', '--severity', 'P1', '--fixability', 'out-of-scope', '--scope-ids', 'about', '--evidence', 'focus order skips the form']);
  assert.equal(rec.status, 0, rec.stderr);
  assert.match(rec.stdout, /→ open /);
  assert.equal(scorecard(t.out).current.severity.P1, 1);
  const r = run(t.proj, t.root, t.cur);
  assert.equal(r.status, 1, r.stdout);
  const f = findings(t.out).findings.find((x) => x.check === 'focus-order');
  assert.equal(f.status, 'open');
  assert.equal(scorecard(t.out).current.severity.P1, 1);
  assert.match(r.stdout, /^ {2}P1 accessibility\/focus-order \[about\] — focus order skips the form$/m);
  assert.match(r.stdout, /✗ GATE: 1 open P1 finding\(s\)/);
  rmSync(t.proj, { recursive: true, force: true });
});

check('an informational finding the source stops sharing becomes open again — scored and gated as before', () => {
  const t = fixture();
  run(t.proj, t.root, t.cur);
  const before = byCheck(findings(t.out).findings, 'title-missing', ['legal']);
  assert.equal(before.status, 'informational');
  writeFileSync(join(t.cur, 'pages', 'legal.json'), JSON.stringify({ slug: 'legal', title: 'Legal notice and terms', description: '' }));
  const r = run(t.proj, t.root, t.cur);
  assert.equal(r.status, 1, r.stdout);
  const after = byCheck(findings(t.out).findings, 'title-missing', ['legal']);
  assert.equal(after.id, before.id); assert.equal(after.status, 'open'); assert.equal(after.fixability, 'platform-migration');
  assert.equal(after.autofix.available, true); assert.equal(after.firstSeenRun, 'run-1');
  assert.equal(scorecard(t.out).current.severity.P1, 1);
  assert.match(r.stdout, /✗ GATE: 1 open P1 finding\(s\)/);
  rmSync(t.proj, { recursive: true, force: true });
});

check('an informational finding no longer detected is fixed; on regression it comes back informational, never open', () => {
  const t = fixture();
  run(t.proj, t.root, t.cur);
  writeFileSync(join(t.root, 'index.html'), page('Acme', { desc: 'The home page description' }));
  run(t.proj, t.root, t.cur);
  const fixed = byCheck(findings(t.out).findings, 'meta-description', ['home']);
  assert.equal(fixed.status, 'fixed'); assert.equal(fixed.resolvedBy.note, 'no longer detected on delivered page');
  writeFileSync(join(t.root, 'index.html'), page('Acme'));
  run(t.proj, t.root, t.cur);
  const back = byCheck(findings(t.out).findings, 'meta-description', ['home']);
  assert.equal(back.status, 'informational'); assert.equal(back.firstSeenRun, 'run-1'); assert.equal(back.resolvedBy, null);
  rmSync(t.proj, { recursive: true, force: true });
});

console.log(failed ? `\noptimize: ${failed} check(s) failed` : '\noptimize: all checks passed');
process.exit(failed ? 1 : 0);
