// skills/reskin/scripts/deployed/coverage.mjs — the deployed leg's gate (a′) step: source-coverage.mjs against the
// aem.page preview (residue carried, settled, band tone, S4 placement — a source rail beside the content). On the
// preview a breadcrumb or section sidebar EDS builds as page chrome or a client-rendered block exists only there,
// and a rail EDS stacks after the content is visible only there when the reskin page shares the mistake.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, coded, firstLine, runChild } from './child.mjs';
import { deployedDir } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE_COVERAGE = join(HERE, '..', 'source-coverage.mjs');

// → { verdict: 'PASS' | 'FAIL k/n' | 'ADVISORY …' | 'n/a: …', exit, rows, lines }. Exit 2 (a protected preview,
// an invalid declared file) is a setup error; 3 a bot challenge; anything but 0/1 no verdict (124).
export async function runCoverage({ dir, slug, preview, env = {}, gate = SOURCE_COVERAGE }) {
  const model = join(dir, 'reskin', 'content-model', slug, 'content-model.json');
  const out = join(deployedDir(dir, slug), 'coverage.json');
  rmSync(out, { force: true });
  if (!existsSync(model)) {
    const verdict = `n/a: no content model at ${model}`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ model, target: preview.url, verdict, rows: [] }, null, 2)}\n`);
    return { verdict, exit: 0, rows: [], lines: [] };
  }
  const declared = join(dir, 'reskin', 'coverage', `${slug}.json`);
  const args = [gate, '--model', model, '--target', preview.url, '--out', out, ...(existsSync(declared) ? ['--declared', declared] : [])];
  let r;
  try { r = await runChild(process.execPath, args, { env: childEnv(env) }); } catch (e) { throw coded(124, `source-coverage did not start: ${e.message}`); }
  const exit = r.status ?? r.signal;
  const why = firstLine(r.stderr) || firstLine(r.stdout);
  if (exit === 2) throw coded(2, why || 'source-coverage exited 2');
  if (exit === 3) throw coded(3, why || 'source-coverage exited 3: bot challenge');
  if (exit !== 0 && exit !== 1) throw coded(124, `source-coverage exited ${exit}${why ? `: ${why}` : ''}`);
  let res = null;
  try { res = JSON.parse(readFileSync(out, 'utf8')); } catch { throw coded(124, `source-coverage exited ${exit} but wrote no ${out}`); }
  const lines = r.stdout.split('\n').filter((l) => /^\[source-coverage\] S\d (FAIL|declared|WARN)/.test(l)).map((l) => `  ${l.replace('[source-coverage] ', '')}`);
  return { verdict: res.verdict, exit, rows: res.rows || [], lines };
}
