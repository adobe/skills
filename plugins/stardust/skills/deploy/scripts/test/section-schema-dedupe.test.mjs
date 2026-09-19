#!/usr/bin/env node
/**
 * Fixture test for section-schema.mjs section-name de-duplication.
 * Run: node skills/deploy/scripts/test/section-schema-dedupe.test.mjs
 *
 * Three <section class="hp-band"> must map to hp-band, hp-band-2, hp-band-3 so
 * qa-gate.mjs --schema binds each schema section to its own block instead of
 * the first instance (16 identically named sections once bound every unit
 * check to the first). mapSections() runs inside page.evaluate, so the CLI
 * needs Playwright + Chromium: when `playwright` is not resolvable from the
 * scripts directory the test prints SKIP and exits 0 (run it from the EDS
 * project, where the deploy scripts resolve it).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'section-schema.mjs');
try { createRequire(CLI).resolve('playwright'); } catch {
  console.log(`SKIP section-schema dedupe: playwright is not resolvable from ${dirname(CLI)} — run from the EDS project`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'section-schema-dedupe-'));
writeFileSync(join(dir, 'fixture.html'), `<!doctype html><html><body><main>
<section class="hp-band"><h2>One</h2><p>First band.</p></section>
<section class="hp-band"><h2>Two</h2><p>Second band.</p></section>
<section class="hp-band"><h2>Three</h2><p>Third band.</p></section>
</main></body></html>
`);
const out = join(dir, 'schema.json');
const r = spawnSync(process.execPath, [CLI, pathToFileURL(join(dir, 'fixture.html')).href, '--out', out], { encoding: 'utf8' });
let failed = 0;
if (r.status !== 0) {
  console.log(`FAIL section-schema exited ${r.status}\n${r.stderr}`);
  failed = 1;
} else {
  const got = JSON.parse(readFileSync(out, 'utf8')).sections.map((s) => s.section);
  const want = ['hp-band', 'hp-band-2', 'hp-band-3'];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} repeated section names get an ordinal${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failed = 1;
}
rmSync(dir, { recursive: true, force: true });
process.exit(failed);
