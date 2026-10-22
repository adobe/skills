// skills/reskin/scripts/figma-gate/prepare.mjs — what every Figma check starts from: the page joined to
// the mapping (B0), the Figma boxes of the roots the checks file names, and the validated checks. A page
// that drifted from the mapping stops here (`drift: true`, nothing else is loaded); an invalid checks
// file is a usage error listing every problem.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { loadBoxes } from './boxes.mjs';
import { rootsNamed, validateChecks } from './checks.mjs';
import { readInputs, workDir } from './io.mjs';
import { runJoin } from './join.mjs';
import { localTarget } from './target.mjs';

// The boxes of the roots a passed join and its checks file name, the validated checks and their per-slot coverage
// floor ({ styles: { covered, total }, widths, waived }); an invalid checks file is a usage error listing every problem,
// and with `out` (the regime's evidence directory) the whole list is also written to out/floor-problems.txt, which the
// error ends with: a run-bg wait shows the last lines of the output only. A valid file removes a stale list.
// inputs holds checks and donorTokens (readInputs).
export function checksFor({ dir, slug, inputs, join, out = null }) {
  const boxes = loadBoxes(dir, rootsNamed(inputs.checks, join));
  const { sections, problems, coverage } = validateChecks(inputs.checks, { join, boxes, tokens: inputs.donorTokens });
  const listFile = out ? pathJoin(out, 'floor-problems.txt') : null;
  if (!problems.length) {
    if (listFile) rmSync(listFile, { force: true });
    return { boxes, checks: sections, coverage };
  }
  if (listFile) {
    mkdirSync(out, { recursive: true });
    writeFileSync(listFile, `${problems.join('\n')}\n`);
  }
  throw new UsageError(`${dir}/reskin/figma-checks/${slug}.json has ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}${listFile ? `\nfull list: ${listFile}` : ''}`);
}

// → { drift: true, join, out } or { drift: false, target, join, boxes, tokens, rules, checks, coverage, out }, where
// rules is curation-rules.json, checks is validateChecks(...).sections and coverage its per-slot coverage floor.
// target is the regime to measure: the local page at url by default, or a built Target (previewTarget for a
// deployed preview); out is that regime's work dir.
export async function prepare({ dir, slug, url, target = localTarget(url) }) {
  const inputs = readInputs(dir, slug, ['mapping', 'contentModel', 'rules', 'donorTokens', 'checks']);
  const out = workDir(dir, slug, target.regime);
  const join = await runJoin({ target, inputs, out, page: slug });
  if (!join.pass) return { drift: true, join, out };
  const { boxes, checks, coverage } = checksFor({ dir, slug, inputs, join, out });
  return { drift: false, target, join, boxes, tokens: inputs.donorTokens, rules: inputs.rules, checks, coverage, out };
}
