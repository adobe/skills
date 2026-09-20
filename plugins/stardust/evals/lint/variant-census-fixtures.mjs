#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/variant-census.mjs.
//
// Pure half (always): the aggregation / coverage / exit logic over per-page
// facts that mirror fixtures/variant-census/stardust/current/pages/*.html,
// the css/code token extractors over the fixture canon.css / renderer.js,
// the allow-list parser, sampling, the ≤ 60-line renderer and the CLI
// contract (--help, unknown flag, exclusive scopes, missing state → 1).
// Browser half (when playwright resolves, or STARDUST_GATE_DEPS names a
// node_modules with it): the CLI over the fixture sidecars — cases (a)–(h)
// of the census contract: counts + majority, li:icon fact, unreferenced set,
// exit 2 → 0 with --allow, --type scoping, per-theme facet, ≤ 60 stdout lines
// + census .json/.md written, --min-pages 5 → exit 0. Otherwise one SKIP line.
//
// Usage: node plugins/stardust/evals/lint/variant-census-fixtures.mjs  (exit 1 on findings)
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PLUGIN = join(import.meta.dirname, '..', '..');
const SCRIPT = join(PLUGIN, 'skills', 'replica', 'scripts', 'variant-census.mjs');
const FIX = join(import.meta.dirname, 'fixtures', 'variant-census');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const { DEFAULT_MIN_PAGES, parseAllow, tokensFromCss, tokensFromCode, sampleSlugs, aggregate, findingsOf, renderCensus, renderMarkdown } = await import(SCRIPT);

// --- token extractors over the fixture files
const css = tokensFromCss(readFileSync(join(FIX, 'canon.css'), 'utf8'));
check(['tabs', 'horizontal', 'vertical', 'tab', 'tab-panel', 'cards', 'card', 'value-props', 'value-props__item', 'link-list'].every((t) => css.has(t)) && !css.has('g-col-xl-3') && !css.has('text-uppercase'), `canon.css tokens: selectors counted, a class named only in a comment not, got ${[...css].join(' ')}`);
const code = tokensFromCode(readFileSync(join(FIX, 'renderer.js'), 'utf8'));
check(code.has('value-props') && code.has('value-props__item') && code.has('cards') && code.has('link-list') && !code.has('leaf-c-value-props__item--icon') && !code.has('renderValueProps'), `renderer.js tokens: string literals only, got ${[...code].join(' ')}`);
const { allow, errors } = parseAllow(readFileSync(join(FIX, 'allow.txt'), 'utf8'));
check(allow.size === 1 && /source unstyled/.test(allow.get('text-uppercase')) && errors.length === 0, 'allow.txt: one class with its reason, comments skipped');
check(parseAllow('g-col-xl-3\n').errors.length === 1, 'an allow line without a reason is an error');
check(JSON.stringify(sampleSlugs(['a', 'b', 'c', 'd', 'e', 'f'], 3)) === JSON.stringify(['a', 'c', 'e']) && sampleSlugs(['a'], 5).length === 1, 'sampling takes every k-th slug');
check(DEFAULT_MIN_PAGES === 2, 'min-pages default is 2');

// --- per-page facts mirroring the fixture HTML (what collectPage returns)
const tabs = (v) => ({ class: 'tabs', modifiers: [v], descendants: ['tab', 'tab-panel'], facts: { 'li:icon': false, hasImg: false, hasSvg: false, headings: 0, ctas: 0, columns: 1 } });
const vp = { class: 'value-props', modifiers: [], descendants: ['value-props__item', 'leaf-c-value-props__item--icon'], facts: { 'li:icon': true, hasImg: false, hasSvg: false, headings: 2, ctas: 0, columns: 1 } };
const cards = { class: 'cards', modifiers: [], descendants: ['card', 'g-col-xl-3', 'text-uppercase'], facts: { 'li:icon': false, hasImg: false, hasSvg: false, headings: 3, ctas: 3, columns: 3 } };
const ll = { class: 'link-list', modifiers: [], descendants: [], facts: { 'li:icon': false, hasImg: false, hasSvg: false, headings: 0, ctas: 2, columns: 1 } };
const facts = [
  { slug: 'p1', theme: [], components: [tabs('horizontal'), vp, cards] }, { slug: 'p2', theme: [], components: [tabs('horizontal'), vp, cards] },
  { slug: 'p3', theme: [], components: [tabs('horizontal'), cards] }, { slug: 'p4', theme: ['theme-dark'], components: [tabs('horizontal'), cards] },
  { slug: 'a1', theme: [], components: [tabs('vertical'), ll] }, { slug: 'a2', theme: [], components: [tabs('vertical')] },
  { slug: 'gone', noSidecar: true },
];
const referenced = new Set([...css, ...code]);
let c = aggregate(facts, { minPages: 2, referenced, allow: new Map() });
const T = c.components.find((x) => x.class === 'tabs');
check(c.pages === 6 && c.noSidecar[0] === 'gone', '(a) six pages parsed, the missing sidecar listed');
check(T.pages === 6 && T.majority === 'horizontal' && T.modifiers[0].pages === 4 && T.modifiers[1].class === 'vertical' && T.modifiers[1].pages === 2, `(a) tabs: horizontal 4 (majority) / vertical 2, got ${JSON.stringify(T.modifiers)}`);
check(c.components.find((x) => x.class === 'value-props').facts['li:icon'] === 2 && !c.components.find((x) => x.class === 'link-list').facts['li:icon'], '(b) li:icon true on value-props (2 pages), false on the plain link list');
const un = c.unreferenced.map((u) => u.class);
check(un.includes('leaf-c-value-props__item--icon') && un.includes('g-col-xl-3') && un.includes('text-uppercase') && !un.includes('horizontal') && !un.includes('value-props__item'), `(c) unreferenced = the icon leaf, the grid utility, text-uppercase; not the referenced ones — got ${un.join(' ')}`);
check(c.exitCode === 2 && c.budget.length === 3 && c.budget[0].class === 'g-col-xl-3' && c.budget[0].pages === 4, `(d) exit 2 without --allow; budget ranked by pages, got ${JSON.stringify(c.budget.map((b) => [b.class, b.pages]))}`);
c = aggregate(facts, { minPages: 2, referenced, allow });
check(c.exitCode === 2 && !c.unreferenced.some((u) => u.class === 'text-uppercase') && c.components.find((x) => x.class === 'cards').descendants.find((d) => d.class === 'text-uppercase').allowed, '(c/d) allow removes text-uppercase from unreferenced (allowed reason kept on the row); still exit 2');
c = aggregate(facts, { minPages: 2, referenced, allow: parseAllow(readFileSync(join(FIX, 'allow-all.txt'), 'utf8')).allow });
check(c.exitCode === 0 && c.unreferenced.length === 0, '(d) exit 0 when --allow covers g-col-xl-3 and the icon leaf too');
c = aggregate(facts.filter((f) => ['p1', 'p2', 'p3', 'p4'].includes(f.slug)), { minPages: 2, referenced, allow: new Map() });
check(!c.components.find((x) => x.class === 'tabs').modifiers.some((m) => m.class === 'vertical') && !c.components.some((x) => x.class === 'link-list'), '(e) --type scoping excludes the other type\'s pages (no vertical, no link-list)');
c = aggregate(facts, { minPages: 2, referenced, allow: new Map() });
const CD = c.components.find((x) => x.class === 'cards');
check(CD.themes && CD.themes['theme-dark']?.pages === 1 && CD.themes['(none)']?.pages === 3 && !c.components.find((x) => x.class === 'link-list').themes && CD.facts.columns === 3, `(f) per-theme facet: theme-dark (1) vs (none) (3) under cards; a single-theme component has none; numeric facts are modal values, got ${JSON.stringify(CD.themes)}`);
c = aggregate(facts, { minPages: 5, referenced, allow: new Map() });
check(c.exitCode === 0 && c.unreferenced.length === 3 && c.budget.length === 0, '(h) --min-pages 5 turns the exit into 0 (unreferenced still listed, nothing to budget)');
c = aggregate(facts, { minPages: 2, referenced: null, allow: new Map() });
check(c.exitCode === 0 && !c.coverageChecked && c.unreferenced.length === 0 && c.components.find((x) => x.class === 'tabs').referenced === null, 'no --css/--code → coverage not checked, exit 0, referenced null');
// renderer + findings
c = aggregate(facts, { minPages: 2, referenced, allow });
const lines = renderCensus(c, { scope: 'type program', table: ['  | class | count |'] });
check(lines.length <= 60 && /min-pages 2/.test(lines[0]) && /tabs \(6\): majority horizontal \(4\) · vertical \(2\)/.test(lines[1]) && /✗ 2 unreferenced class\(es\) on ≥ 2 page\(s\): g-col-xl-3 \(4\), leaf-c-value-props__item--icon \(2\)/.test(lines[lines.length - 1]), `(g) stdout ≤ 60 lines: header, majority first, budget line — got:\n${lines.join('\n')}`);
const big = aggregate(Array.from({ length: 120 }, (_, i) => ({ slug: `s${i}`, theme: [], components: [{ class: `comp-${i}`, modifiers: [`m${i}`], descendants: [], facts: {} }] })), { minPages: 2, referenced: new Set(), allow: new Map() });
check(renderCensus(big, { scope: 'x', table: Array.from({ length: 30 }, () => 'row') }).length <= 60, '(g) 120 components + a 30-line table still ≤ 60 lines');
const f = findingsOf(c);
check(f.length === 3 + 2 && f.every((x) => x.class && x.page && /page\(s\)/.test(x.message)) && f.find((x) => x.class === 'g-col-xl-3').severity === 'error', `findings: one per unreferenced class × example page, error at ≥ min-pages (3 examples for g-col-xl-3 + 2 for the icon leaf), got ${f.length}`);
const md = renderMarkdown(c, facts, { scope: 'type program' });
check(/\| `tabs` \| 6 \| `horizontal` \(4\) \| `vertical` \(2\) \|/.test(md) && /- `p4` \(theme: theme-dark\): tabs\.horizontal, cards/.test(md) && /- `gone` — no sidecar/.test(md), `markdown carries the component table and per-page rows, got:\n${md}`);

// --- CLI contract (no browser reached)
const run = (args, opts = {}) => { const r = spawnSync(process.execPath, [opts.script || SCRIPT, ...args], { encoding: 'utf8', timeout: 90000 }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };
const help = run(['--help']);
check(help.status === 0 && /Usage:/.test(help.out) && /--min-pages/.test(help.out) && /--allow/.test(help.out) && /--from-clusters/.test(help.out) && /--sample/.test(help.out), 'variant-census --help exits 0 and names the flags');
check(run(['--bogus']).status === 1, 'unknown flag exits 1');
check(run(['--type', 'a', '--slugs', 'b']).status === 1 && run(['--slugs', 'b', '--from-clusters', 'c.json']).status === 1, '--slugs is exclusive with --type / --from-clusters (exit 1)');
// defect: --type was rejected next to --from-clusters although the header documents it and slugsFor implements the type filter
{
  const tmpC = mkdtempSync(join(tmpdir(), 'variant-census-clusters-'));
  try {
    const clusters = join(tmpC, 'layout-clusters.json');
    writeFileSync(clusters, JSON.stringify({ types: [{ type: 'program', clusters: [{ id: 'c1', pages: ['p1', 'p2'] }], tail: [] }] }));
    const r = run(['--root', join(tmpC, 'stardust'), '--from-clusters', clusters, '--type', 'landing']);
    check(r.status === 1 && !/exclusive/.test(r.out) && /no pages in scope for type landing/.test(r.out), `--type scopes --from-clusters (an absent type is "no pages in scope", not a usage error), got ${r.status}\n${r.out}`);
  } finally { rmSync(tmpC, { recursive: true, force: true }); }
}
check(run(['--cluster', 'c1']).status === 1, '--cluster without --from-clusters exits 1');
check(run(['--root', join(tmpdir(), 'no-such-stardust')]).status === 1, 'missing state.json exits 1');
check(run(['--min-pages', '0']).status === 1, '--min-pages 0 exits 1');
const src = readFileSync(SCRIPT, 'utf8');
check(/route\.abort\(\)/.test(src) && /javaScriptEnabled: false/.test(src) && /await import\('playwright'\)/.test(src), 'static contract: every request aborted, scripts off, playwright imported lazily');

// --- browser half
let deps = null;
try { await import('playwright'); deps = 'repo'; } catch { /* not at the repo root */ }
if (!deps && process.env.STARDUST_GATE_DEPS && existsSync(join(process.env.STARDUST_GATE_DEPS, 'playwright'))) deps = process.env.STARDUST_GATE_DEPS;
if (!deps) console.log('variant-census-fixtures: SKIP browser half — playwright not resolvable (set STARDUST_GATE_DEPS=<dir>/node_modules); pure half ran');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'variant-census-fx-'));
  try {
    let script = SCRIPT;
    if (deps !== 'repo') {
      cpSync(join(PLUGIN, 'skills', 'replica', 'scripts'), join(tmp, 'skills', 'replica', 'scripts'), { recursive: true });
      cpSync(join(PLUGIN, 'skills', 'stardust', 'scripts'), join(tmp, 'skills', 'stardust', 'scripts'), { recursive: true });
      symlinkSync(resolve(deps), join(tmp, 'node_modules'));
      script = join(tmp, 'skills', 'replica', 'scripts', 'variant-census.mjs');
    }
    cpSync(join(FIX, 'stardust'), join(tmp, 'stardust'), { recursive: true });
    const root = join(tmp, 'stardust'); const out = join(tmp, 'stardust', 'replica', 'variant-census.json');
    const base = ['--root', root, '--css', join(FIX, 'canon.css'), '--code', join(FIX, 'renderer.js'), '--out', out];
    let r = run([...base], { script });
    check(r.status === 2 && /tabs \(6\): majority horizontal \(4\) · vertical \(2\)/.test(r.out) && /g-col-xl-3 \(4\)/.test(r.out) && /leaf-c-value-props__item--icon \(2\)/.test(r.out) && /text-uppercase/.test(r.out), `browser (a)(c)(d): all types, exit 2, counts + unreferenced set — got ${r.status}\n${r.out}`);
    check(r.out.split('\n').filter((l) => l.trim()).length <= 62 && existsSync(out) && existsSync(out.replace(/\.json$/, '.md')) && existsSync(join(tmp, 'stardust', 'replica', 'variant-census', 'summary.json')), '(g) stdout ≤ 60 lines (+ pointer), census .json/.md and class-report summary written');
    const j = JSON.parse(readFileSync(out, 'utf8'));
    check(j.components.find((x) => x.class === 'value-props')?.facts['li:icon'] === 2 && j.components.find((x) => x.class === 'link-list')?.facts['li:icon'] === undefined, `(b) li:icon from the real DOM: value-props 2, link-list none — got ${JSON.stringify(j.components.map((x) => [x.class, x.facts]))}`);
    check(j.components.find((x) => x.class === 'cards')?.themes?.['theme-dark']?.pages === 1 && j.components.find((x) => x.class === 'cards')?.facts.columns === 3 && j.components.find((x) => x.class === 'cards')?.facts.headings === 3, `(f) theme facet + modal columns/headings facts from the DOM, got ${JSON.stringify(j.components.find((x) => x.class === 'cards'))}`);
    r = run([...base, '--allow', join(FIX, 'allow-all.txt')], { script });
    check(r.status === 0 && /✓ every variant/.test(r.out), `(d) --allow covering all three → exit 0, got ${r.status}\n${r.out}`);
    r = run([...base, '--type', 'program', '--json'], { script });
    let jj = null; try { jj = JSON.parse(r.out); } catch { /* asserted */ }
    check(r.status === 2 && jj?.scope === 'type program' && jj.pages === 4 && !jj.components.some((x) => x.class === 'link-list') && !jj.components.find((x) => x.class === 'tabs').modifiers.some((m) => m.class === 'vertical'), `(e) --type program excludes article pages — got ${r.status} ${jj?.pages}`);
    r = run([...base, '--min-pages', '5'], { script });
    check(r.status === 0, `(h) --min-pages 5 → exit 0, got ${r.status}`);
    r = run([...base, '--sample', '3'], { script });
    check(/sampled 3 of 6/.test(r.out), '--sample prints "sampled N of M"');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (failures.length) { console.error(`variant-census-fixtures: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log(`variant-census-fixtures: ok (tokens, allow, aggregate (a)–(h), renderer ≤ 60, CLI${deps ? `, browser half [deps: ${deps}]` : ''})`);
