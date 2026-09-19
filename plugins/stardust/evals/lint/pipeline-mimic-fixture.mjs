#!/usr/bin/env node
// Guard: the local harness's pipeline emulation (deploy/scripts/pipeline-mimic.mjs)
// keeps producing the delivered shape, and stays idempotent on a .plain.html.
//
// Why: build-harness / render-harness / block-roundtrip present the DELIVERED
// shape of an authored page (section-metadata → classes, <p><picture>, hoisted
// sole-emphasis links, NBSP paragraphs dropped, `:icon:` spans, raw tables →
// block divs, attribute strip). Eleven recorded projects each re-derived these
// rules by hand after "emulation passed, published failed". A rule that drifts
// silently re-opens that class of false pass, so the fixture pair pins them:
//   deploy/scripts/fixtures/pipeline-probe.html        one instance of every rule
//   deploy/scripts/fixtures/pipeline-probe.plain.html  the expected delivered shape
//   deploy/scripts/fixtures/pipeline-recorded.plain.html  a REAL delivered shape
// The probe .plain.html is DERIVED by hand from the catalogued facts
// (deploy/reference/pipeline-facts.md — rows resting on it alone are marked
// "assumed" there); T21.2's pipeline-probe.mjs re-records it from a preview origin.
// The recorded file is a redacted preview .plain.html (media hashes, <source> sets,
// real image dimensions, heading ids): the mimic must be a no-op on it and
// normaliseForCompare() must hide exactly those artefacts — both asserted by the
// self-test, so the normaliser is exercised against a recording, not a model.
//
// Cases: `--self-test` exit 0 (equality + idempotency on both fixtures + every rule fired + normaliser);
// `--help` exit 0; unknown rule exit 1; `--no-picture` leaves <img> unwrapped;
// build-harness emits <meta name="template"> from the metadata block and the
// counts line; `--no-pipeline` keeps the authored shape.
//
// Usage: node plugins/stardust/evals/lint/pipeline-mimic-fixture.mjs  (exit 1 on findings)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const SCRIPTS = join(HERE, '..', '..', 'skills', 'deploy', 'scripts');
const MIMIC = join(SCRIPTS, 'pipeline-mimic.mjs');
const BUILD = join(SCRIPTS, 'build-harness.mjs');
const FIXTURE = join(SCRIPTS, 'fixtures', 'pipeline-probe.html');
const rel = (p) => relative(process.cwd(), p);

const failures = [];
const run = (bin, args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

let r = run(MIMIC, ['--self-test']);
check('self-test exits 0', r.status === 0, (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' | '));
r = run(MIMIC, ['--help']);
check('--help exits 0 and prints usage', r.status === 0 && /usage:/.test(r.stdout));
r = run(MIMIC, ['--no-bogus', FIXTURE]);
check('unknown --no-<rule> is a usage error (exit 1)', r.status === 1);
r = run(MIMIC, []);
check('no input is a usage error (exit 1)', r.status === 1);
r = run(MIMIC, ['--no-picture', FIXTURE]);
check('--no-picture leaves <img> outside <picture>', r.status === 0 && /<img src=/.test(r.stdout) && !/<picture>/.test(r.stdout));
r = run(MIMIC, ['--style-split', 'first-only', FIXTURE]);
check('--style-split first-only keeps only the first style token', r.status === 0 && /<div class="dark" data-background="navy">/.test(r.stdout));
const RECORDED = join(SCRIPTS, 'fixtures', 'pipeline-recorded.plain.html');
r = run(MIMIC, [RECORDED]);
check('the recorded delivered shape passes through unchanged (every counter 0)', r.status === 0 && r.stdout.trim() === readFileSync(RECORDED, 'utf8').trim() && /pipeline emulation: section-metadata 0, meta 0, picture 0, hoist 0, whitespace 0, table→block 0, icon 0, heading-br 0, emph-picture 0, strip 0/.test(r.stderr + r.stdout), (r.stderr || '').trim().slice(0, 200));
r = run(MIMIC, ['--json', FIXTURE]);
try { const j = JSON.parse(r.stdout); check('--json carries meta + counts', j.meta.template === 'Landing Page' && j.counts.picture === 3); } catch (e) { check('--json parses', false, e.message); }

const dir = mkdtempSync(join(tmpdir(), 'pipeline-mimic-'));
try {
  const out = join(dir, 'harness.html');
  r = run(BUILD, [FIXTURE, out, '--root', dir]);
  const html = r.status === 0 ? readFileSync(out, 'utf8') : '';
  check('build-harness exits 0 and prints the counts line', r.status === 0 && /pipeline emulation: section-metadata 1/.test(r.stdout), r.stderr.trim());
  check('build-harness emits <meta name="template"> from the metadata block', /<meta name="template" content="Landing Page">/.test(html) && /<meta name="nav" content="\/nav-minimal">/.test(html));
  check('build-harness main carries the delivered shape', /<div class="dark narrow" data-background="navy">/.test(html) && /<p><picture><img loading="lazy"/.test(html) && !/class="metadata"/.test(html));
  const out2 = join(dir, 'harness-raw.html');
  r = run(BUILD, [FIXTURE, out2, '--root', dir, '--no-pipeline']);
  const raw = r.status === 0 ? readFileSync(out2, 'utf8') : '';
  check('--no-pipeline keeps the authored shape (section-metadata block present, metadata stripped by stage one)', r.status === 0 && /class="section-metadata"/.test(raw) && !/class="metadata"/.test(raw) && !/<picture>/.test(raw));
  r = run(BUILD, ['--help']);
  check('build-harness --help exits 0', r.status === 0 && /usage:/.test(r.stdout));
} finally { rmSync(dir, { recursive: true, force: true }); }

if (failures.length) {
  for (const f of failures) console.log(`${rel(MIMIC)}: ${f}`);
  console.log(`pipeline-mimic fixture: ${failures.length} finding(s)`);
  process.exit(1);
}
console.log(`pipeline-mimic fixture: 13 cases pass (${rel(FIXTURE)}, ${rel(RECORDED)})`);
