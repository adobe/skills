/**
 * qa/checks/editability.mjs — Experience Workspace inline-edit gate, one browser
 * pass per page (desktop only — instrumentation is viewport-independent).
 *
 * Reproduces what the da.live canvas does when an author opens the page: the
 * document response is intercepted and instrumented like
 * editor-utils.getInstrumentedHTML (`data-prose-index` on every OUTERMOST
 * h1-h6/p/ul/ol/pre/blockquote inside <main>, bare-text block cells re-wrapped as
 * <p>), the live page's own scripts.js decorates it, sections settle, and each
 * authored text is looked up by its index:
 *   exactly one element  → editable
 *   zero                 → dead      (rebuilt from textContent/innerHTML, synthesized, retagged)
 *   several              → duplicated (clone slides; the editor attaches to the first)
 *
 * Findings: editability/dead-text (error, per block with dead non-exempt texts),
 * editability/duplicated-index (warn, per block), editability/summary (info, per
 * page), editability/probe-failed (warn). Exemptions (EW5): --ew-exempt a,b and,
 * with --blocks-dir <dir>, `@ew-exempt <reason>` tags in each block's leading
 * JSDoc. Shared instrument: skills/deploy/scripts/ew-editability-probe.mjs.
 * Contract: deploy reference/block-js-scaffold.md § Experience Workspace editability contract (EW1–EW10).
 */
import {
  loadPlaywright, finding, pageUrl, pMap, arg, withNavSlot, getFetchLimiter, configureFetch, noteThrottled,
} from '../lib.mjs';
import {
  probeUrl, aggregate, readBlockExemptions, parseExemptList,
} from '../../../deploy/scripts/ew-editability-probe.mjs';

const VIEWPORT_WIDTH = 1440;
const SETTLE_MS = 1500;
const DECORATION_TIMEOUT = 15000;

const quote = (d) => `<${d.tag}> "${d.text.slice(0, 40)}${d.text.length > 40 ? '…' : ''}"`;
const THROTTLE = (s) => s === 429 || s === 503;
const THROTTLE_ATTEMPTS = 3; // same paced retry budget as browse.mjs gotoPaced / lib.mjs fetchUrl

export async function run(ctx) {
  const { base, inventory, opts } = ctx;
  const findings = [];
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const cliExempt = parseExemptList(opts.ewExempt || arg('ew-exempt', ''));
  const blocksDir = opts.blocksDir || arg('blocks-dir', null);

  await pMap(inventory.pages, async (p) => {
    let bctx = null;
    try {
      const url = pageUrl(base, p.path);
      let probe = null; let docStatus = 0;
      for (let attempt = 0; ; attempt += 1) {
        // one limiter slot per navigation: the probe shares the fetch budget of the sweep (report.infra)
        probe = await withNavSlot(url, () => probeUrl(browser, url, {
          width: VIEWPORT_WIDTH,
          waitUntil: 'domcontentloaded', // hanging third-party tags never reach networkidle (browse.mjs)
          settleMs: SETTLE_MS,
          timeoutMs: DECORATION_TIMEOUT,
        }));
        bctx = probe.ctx;
        // the document's own status (navigation timing): a throttled document instruments nothing — unmeasured, not "zero authored texts"
        docStatus = await probe.page.evaluate(() => performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0).catch(() => 0);
        if (!THROTTLE(docStatus) || attempt + 1 >= THROTTLE_ATTEMPTS) break;
        // paced retry like gotoPaced (Retry-After is not visible through the instrumented probe: back-off only)
        getFetchLimiter()?.onThrottle(url);
        await bctx.close().catch(() => {}); bctx = null;
        await new Promise((r) => { setTimeout(r, configureFetch({}).backoffMs * 2 ** attempt); });
      }
      if (THROTTLE(docStatus)) { noteThrottled(); findings.push(finding('editability', 'unmeasured', 'info', p.path, `document throttled (HTTP ${docStatus} after ${THROTTLE_ATTEMPTS} attempts) — not measured; re-run`, { status: docStatus })); return; }
      const { rows } = probe;
      const names = [...new Set(rows.map((r) => r.block))];
      const exemptions = readBlockExemptions(blocksDir, names, cliExempt);
      const { blocks, totals } = aggregate(rows, { exemptions });
      for (const b of blocks) {
        if (b.dead) {
          findings.push(finding('editability', 'dead-text', 'error', p.path,
            `block "${b.block}": ${b.dead} of ${b.authored} authored text(s) not editable in Experience Workspace — ${b.deadItems.slice(0, 3).map(quote).join(', ')}${b.deadItems.length > 3 ? ', …' : ''}; MOVE the authored element into the wrapper (EW1)`,
            { block: b.block, authored: b.authored, dead: b.dead, items: b.deadItems.slice(0, 8).map(({ tag, text }) => ({ tag, text })) }));
        }
        if (b.duplicated) {
          findings.push(finding('editability', 'duplicated-index', 'warn', p.path,
            `block "${b.block}": ${b.duplicated} authored text(s) carry their index on several elements (presentational clones) — the editor attaches to the first in DOM order; strip instrumentation from clones (EW4)`,
            { block: b.block, items: b.dupItems.slice(0, 8).map(({ tag, text, hits }) => ({ tag, text, hits })) }));
        }
      }
      findings.push(finding('editability', 'summary', 'info', p.path,
        `authored ${totals.authored} · editable ${totals.editable} · dead ${totals.dead} · duplicated ${totals.duplicated} · exempt ${totals.exempt}`,
        { totals, blocks: blocks.map(({ block, authored, editable, dead, duplicated, exempt, exemptReasons }) => ({ block, authored, editable, dead, duplicated, exempt, ...(exemptReasons.length ? { exemptReasons } : {}) })) }));
    } catch (e) {
      findings.push(finding('editability', 'probe-failed', 'warn', p.path,
        `editability probe did not complete: ${String(e).slice(0, 200)}`));
    } finally {
      if (bctx) await bctx.close().catch(() => {});
    }
  }, opts.browserConcurrency || 2);

  await browser.close();
  return findings;
}
