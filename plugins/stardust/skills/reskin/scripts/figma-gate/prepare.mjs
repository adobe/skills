// skills/reskin/scripts/figma-gate/prepare.mjs — what every Figma check starts from: the page joined to
// the mapping (B0), the Figma boxes of the roots the checks file names, and the validated checks. A page
// that drifted from the mapping stops here (`drift: true`, nothing else is loaded); an invalid checks
// file is a usage error listing every problem.
import { UsageError } from '../figma/errors.mjs';
import { loadBoxes } from './boxes.mjs';
import { rootsNamed, validateChecks } from './checks.mjs';
import { readInputs, workDir } from './io.mjs';
import { runJoin } from './join.mjs';
import { localTarget } from './target.mjs';

// → { drift: true, join, out } or { drift: false, target, join, boxes, tokens, rules, checks, out }, where
// rules is curation-rules.json and checks is validateChecks(...).sections. target is the regime to measure: the
// local page at url by default, or a built Target (previewTarget for a deployed preview).
export async function prepare({ dir, slug, url, target = localTarget(url) }) {
  const inputs = readInputs(dir, slug, ['mapping', 'contentModel', 'rules', 'donorTokens', 'checks']);
  const out = workDir(dir, slug);
  const join = await runJoin({ target, inputs, out });
  if (!join.pass) return { drift: true, join, out };
  const boxes = loadBoxes(dir, rootsNamed(inputs.checks, join));
  const { sections, problems } = validateChecks(inputs.checks, { join, boxes, tokens: inputs.donorTokens });
  if (problems.length) {
    throw new UsageError(`${dir}/reskin/figma-checks/${slug}.json has ${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }
  return { drift: false, target, join, boxes, tokens: inputs.donorTokens, rules: inputs.rules, checks: sections, out };
}
