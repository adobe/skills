/**
 * qa/checks/ai-readability.mjs — category K: AI readability (browser + raw fetch).
 *
 * Runs the deploy skill's exact reimplementation of Adobe's "AI Content Visibility Checker"
 * (deploy/scripts/ai-readability.mjs, deploy/reference/ai-readability.md) on every page:
 *   - strict  = served words ÷ rendered-DOM words in main (the customer's popup number)
 *   - code    = strict with fragment documents credited and app blocks excluded (what block code owns);
 *             `fragments cost N pts` = strict points the page loses to runtime-fetched fragment copy (deploy's line, same formula)
 *   - servedGap = rendered words absent from the served HTML, per block (non-rendering crawlers)
 * Findings:
 *   ai-readability-poor   error  strict < 75 (the tool's "Fair"/"Poor" bands — the owner sees a red gauge)
 *   ai-readability-low    warn   strict < 95, or code < 98 (block code adds words the document lacks)
 *   ai-readability-served-gap info  ≥ 40 rendered main words never served (fragment / index / generated text)
 * Evidence carries the top blocks by DOM-only words so the fix lands on the right block.
 */
import { loadPlaywright, finding, originAuthFor, attachOriginAuth, arg } from '../lib.mjs';
import { scorePage } from '../../../deploy/scripts/ai-readability.mjs';

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const auth = originAuthFor(base);
  const headers = auth ? { authorization: auth } : {};
  const excludeBlocks = (arg('ai-exclude-blocks', 'client-app,widget') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: headers });
  await attachOriginAuth(context);
  const summary = [];
  try {
    for (const p of inventory.pages) {
      const r = await scorePage(context, base.replace(/\/$/, ''), p.path, { excludeBlocks, headers });
      if (r.error) { findings.push(finding('ai-readability', 'ai-readability-unmeasured', 'info', p.path, `not measured: ${r.error}`)); continue; }
      const top = r.blocks.filter((b) => b.servedGap > 0).slice(0, 5).map((b) => ({ block: b.block, servedGap: b.servedGap, words: b.words, sample: b.sample }));
      const ev = { strict: r.strict, landmarksCounted: r.landmarksCounted, code: r.code, fragments: r.fragments, servedGap: r.servedGap, topBlocks: top };
      summary.push({ path: p.path, strict: r.strict.score, code: r.code.score });
      if (r.strict.score < 75) {
        findings.push(finding('ai-readability', 'ai-readability-poor', 'error', p.path,
          `checker score ${r.strict.score}% (served ${r.strict.served} / rendered ${r.strict.rendered} words) — rendered DOM carries ${r.strict.missing} words the document does not; top: ${top.map((b) => `${b.block} ${b.servedGap}`).join(', ')}`, ev));
      } else if (r.strict.score < 95 || r.code.score < 98) {
        findings.push(finding('ai-readability', 'ai-readability-low', 'warn', p.path,
          `checker score ${r.strict.score}%, code score ${r.code.score}% (fragments credited +${r.code.fragmentWords} words = fragments cost ${r.code.fragmentsCostPts} pts${r.fragments?.length ? ` [${r.fragments.join(' ')}]` : ''}) — top: ${top.map((b) => `${b.block} ${b.servedGap}`).join(', ')}`, ev));
      }
      if (r.servedGap.main >= 40) {
        findings.push(finding('ai-readability', 'ai-readability-served-gap', 'info', p.path,
          `${r.servedGap.main} of ${r.servedGap.renderedMain} rendered main words are absent from the served HTML (non-rendering crawlers never read them); chrome ${r.servedGap.chrome}`, ev));
      }
    }
  } finally { await browser.close(); }
  ctx.shared.aiReadability = summary;
  return findings;
}
