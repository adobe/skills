/**
 * qa/checks/templates.mjs — category C: template conformance (delivery layer).
 *
 * The invariant: every URL renders the block set its template prescribes.
 * Expected blocks come from two sources, in priority order:
 *   1. explicit config (--expected-blocks <json>: { templateName: [blocks...] })
 *   2. fleet consistency — a block present on >70% of a template's sibling
 *      pages is expected on all of them (catches "page silently fell back to
 *      flattened prose" without any config)
 *
 * Needs the template assignment from the inventory (template-map source) and
 * the per-page block sets collected by the content check (or re-fetched).
 */
import { pMap, finding, plainUrl, readJSON } from '../lib.mjs';

const CONSENSUS = 0.7;

export async function run(ctx) {
  const { base, inventory, opts } = ctx;
  const findings = [];

  const withTemplate = inventory.pages.filter((p) => p.template);
  if (!withTemplate.length) {
    findings.push(finding('templates', 'no-template-map', 'info', '',
      'no template assignments in inventory (pass --template-map) — conformance skipped'));
    return findings;
  }

  // block sets: reuse the content check's collection when it ran, else fetch
  let pageBlocks = ctx.shared.pageBlocks;
  if (!pageBlocks) {
    pageBlocks = {};
    await pMap(withTemplate, async (p) => {
      const res = await ctx.fetchPage(plainUrl(base, p.path));
      if (res.status !== 200) return;
      const names = new Set();
      for (const m of res.body.matchAll(/<div class="([a-z][a-z0-9-]*)(?: [^"]*)?">/g)) {
        if (m[1] !== 'metadata' && m[1] !== 'section-metadata') names.add(m[1]);
      }
      pageBlocks[p.path] = [...names];
    }, 8);
  }

  const explicit = opts.expectedBlocks ? readJSON(opts.expectedBlocks, {}) : {};

  const byTemplate = new Map();
  for (const p of withTemplate) {
    // no block data = the page didn't deliver (routing owns that failure);
    // flagging it as "missing every block" would just echo the 404
    if (pageBlocks[p.path] === undefined) continue;
    if (!byTemplate.has(p.template)) byTemplate.set(p.template, []);
    byTemplate.get(p.template).push(p);
  }

  for (const [tname, pages] of byTemplate) {
    const sets = pages.map((p) => new Set(pageBlocks[p.path] || []));

    let expected;
    let basis;
    if (explicit[tname]) {
      expected = new Set(explicit[tname]);
      basis = 'explicit config';
    } else if (pages.length >= 3) {
      // consensus blocks across siblings
      const counts = new Map();
      for (const s of sets) for (const b of s) counts.set(b, (counts.get(b) || 0) + 1);
      expected = new Set([...counts].filter(([, c]) => c / pages.length > CONSENSUS).map(([b]) => b));
      basis = `fleet consensus (>${CONSENSUS * 100}% of ${pages.length} sibling pages)`;
    } else {
      // too few siblings to derive a consensus; only the zero-blocks signal applies
      expected = null;
      basis = null;
    }

    pages.forEach((p, i) => {
      const have = sets[i];
      if (expected) {
        const missing = [...expected].filter((b) => !have.has(b));
        if (missing.length) {
          findings.push(finding('templates', 'missing-template-blocks', 'error', p.path,
            `template "${tname}": missing expected block(s) ${missing.join(', ')} (${basis})`,
            { template: tname, missing, has: [...have] }));
        }
      }
      // a templated page with zero blocks while siblings have them = flattened
      const siblingsHaveBlocks = sets.some((s, j) => j !== i && s.size > 0);
      if (have.size === 0 && siblingsHaveBlocks) {
        findings.push(finding('templates', 'unblocked-page', 'error', p.path,
          `template "${tname}": page has no blocks at all while sibling pages do — flattened to plain prose?`,
          { template: tname }));
      }
    });
  }

  return findings;
}
