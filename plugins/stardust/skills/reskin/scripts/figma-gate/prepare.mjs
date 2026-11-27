// skills/reskin/scripts/figma-gate/prepare.mjs — what every Figma check starts from: the page joined to
// the mapping (B0), the Figma boxes of the roots the checks file names, and the validated checks. A page
// that drifted from the mapping stops here (`drift: true`, nothing else is loaded); an invalid checks
// file is a usage error listing every problem.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { loadBoxes } from './boxes.mjs';
import { derivePreviewSelectors } from './derive.mjs';
import { rootsNamed, validateChecks } from './checks.mjs';
import { readInputs, workDir } from './io.mjs';
import { runJoin } from './join.mjs';
import { localTarget } from './target.mjs';

// The boxes of the roots a passed join and its checks file name, the validated checks and their per-slot coverage
// floor ({ styles: { covered, total }, widths, waived }); an invalid checks file is a usage error listing every problem,
// and with `out` (the regime's evidence directory) the whole list is also written to out/floor-problems.txt, which the
// error ends with: a run-bg wait shows the last lines of the output only. A valid file removes a stale list.
// inputs holds checks and donorTokens (readInputs). waiverBudget (percent) raises the waiver budget; budget is the count
// validateChecks made of it ({ limitPct, required, excused, mobileRequired, mobileExcused }).
export function checksFor({ dir, slug, inputs, join, out = null, waiverBudget }) {
  const boxes = loadBoxes(dir, rootsNamed(inputs.checks, join));
  const { sections, problems, coverage, budget } = validateChecks(inputs.checks, { join, boxes, tokens: inputs.donorTokens, waiverBudget });
  const listFile = out ? pathJoin(out, 'floor-problems.txt') : null;
  if (!problems.length) {
    if (listFile) rmSync(listFile, { force: true });
    return { boxes, checks: sections, coverage, budget };
  }
  if (listFile) {
    mkdirSync(out, { recursive: true });
    writeFileSync(listFile, `${problems.join('\n')}\n`);
  }
  throw new UsageError(`${dir}/reskin/figma-checks/${slug}.json has ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}${listFile ? `\nfull list: ${listFile}` : ''}`);
}

// → { drift: true, join, out } or { drift: false, target, join, boxes, tokens, rules, checks, coverage, budget, selectors, out },
// where rules is curation-rules.json, checks is validateChecks(...).sections and coverage its per-slot coverage floor.
// target is the regime to measure: the local page at url by default, or a built Target (previewTarget for a
// deployed preview); out is that regime's work dir. On a preview the entries with no previewSelector get one derived
// (derive.mjs): the returned target carries them, selectors is { derived, kept, missed } (null on the local regime).
export async function prepare({ dir, slug, url, target = localTarget(url), waiverBudget }) {
  const inputs = readInputs(dir, slug, ['mapping', 'contentModel', 'rules', 'donorTokens', 'checks']);
  const out = workDir(dir, slug, target.regime);
  const join = await runJoin({ target, inputs, out, page: slug });
  if (!join.pass) return { drift: true, join, out };
  const { boxes, checks, coverage, budget } = checksFor({ dir, slug, inputs, join, out, waiverBudget });
  let selectors = null;
  let measured = target;
  if (target.regime === 'preview') {
    const { target: withDerived, ...found } = await derivePreviewSelectors({ target, join, checks, out });
    measured = withDerived;
    selectors = found;
  }
  return { drift: false, target: measured, join, boxes, tokens: inputs.donorTokens, rules: inputs.rules, checks, coverage, budget, selectors, out };
}
