/**
 * qa/checks/ai-readability.mjs — category K: AI readability (browser + raw fetch).
 *
 * Runs the deploy skill's exact reimplementation of Adobe's "AI Content Visibility Checker"
 * (deploy/scripts/ai-readability.mjs, deploy/reference/ai-readability.md) on every page:
 *   - strict  = served words ÷ rendered-DOM words in main (the customer's popup number)
 *   - code    = strict with fragment documents credited and app blocks excluded (what block code owns);
 *             `fragments cost N pts` = strict points the page loses to runtime-fetched fragment copy (deploy's line, same formula)
 *   - servedGap = rendered words absent from the served HTML, per block (non-rendering crawlers)
 * Every page takes one slot from the sweep's per-host limiter (lib.mjs § throttle / limiter);
 * a 429/503 through the paced retries is `ai-readability/unmeasured` (info, report.infra), never a score.
 * Findings:
 *   ai-readability-poor   error  strict < 75 (the tool's "Fair"/"Poor" bands — the owner sees a red gauge)
 *   ai-readability-low    warn   strict < 95, or code < 98 (block code adds words the document lacks)
 *   ai-readability-undecided-exclusion  warn  an excluded block removed words with no complete allowlist decision
 *                          entry — --ai-allowlist <file> (default stardust/ai-readability-allowlist.json when present)
 *   ai-readability-served-gap info  ≥ 40 rendered main words never served (fragment / index / generated text)
 * Evidence carries the top blocks by DOM-only words so the fix lands on the right block.
 */
import {
  loadPlaywright, finding, originAuthFor, attachOriginAuth, arg, withNavSlot, getFetchLimiter, configureFetch, retryAfterMs, browserSlot, noteThrottled, noteRetry,
} from '../lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { scorePage, checkExclusions } from '../../../deploy/scripts/ai-readability.mjs';

const THROTTLE = (s) => s === 429 || s === 503;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
/**
 * scorePage holding one limiter slot (the served fetch + the render share the sweep's
 * per-host budget, report.infra). A 429/503 — the served fetch's `HTTP 4xx` error or
 * the document navigation's status — is retried like gotoPaced (Retry-After when the
 * document carried one, else 2/4 s), `attempts` times, each retry counted in report.infra;
 * still throttled → { throttled }.
 */
export async function scorePaced(context, origin, path, o, { attempts = configureFetch({}).throttleAttempts, backoffMs = configureFetch({}).backoffMs } = {}) {
  const url = `${origin}${path}`;
  let docStatus = 0; let retryAfter = null;
  const onResponse = (res) => { if (res.url() === url && res.request().resourceType() === 'document' && THROTTLE(res.status())) { docStatus = res.status(); retryAfter = res.headers()['retry-after'] ?? null; } };
  context.on('response', onResponse);
  try {
    for (let i = 0; ; i += 1) {
      docStatus = 0; retryAfter = null;
      const r = await withNavSlot(url, () => scorePage(context, origin, path, o));
      const served = r.error && /HTTP (429|503)\b/.exec(r.error);
      const status = served ? Number(served[1]) : docStatus;
      if (!THROTTLE(status)) return r;
      getFetchLimiter()?.onThrottle(url);
      if (i + 1 >= attempts) return { path, throttled: status, attempts };
      noteRetry();
      await sleep(retryAfterMs(retryAfter) ?? backoffMs * 2 ** i);
    }
  } finally { context.off('response', onResponse); }
}

export async function run(ctx) {
  const { base, inventory } = ctx;
  const findings = [];
  const { chromium } = await loadPlaywright();
  await browserSlot('qa-ai-readability').catch((e) => { if (e.code === 124) { console.error(e.message); process.exit(124); } throw e; }); // fan-out.md § Machine budget — the process's slot; 124 = no slot, no verdict, never an error row
  const browser = await chromium.launch();
  const auth = originAuthFor(base);
  const headers = auth ? { authorization: auth } : {};
  const excludeBlocks = (arg('ai-exclude-blocks', 'client-app,widget') || '').split(',').map((s) => s.trim()).filter(Boolean);
  // the same allowlist entries the deploy gate reads (ai-readability.md § 6): an exclusion that removed words needs a complete decision entry
  const allowFile = arg('ai-allowlist', existsSync('stardust/ai-readability-allowlist.json') ? 'stardust/ai-readability-allowlist.json' : null);
  const allow = allowFile && existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : null;
  // no extraHTTPHeaders: the site secret rides origin requests only (attachOriginAuth), never every third party
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await attachOriginAuth(context);
  const summary = [];
  try {
    for (const p of inventory.pages) {
      const r = await scorePaced(context, base.replace(/\/$/, ''), p.path, { excludeBlocks, allow, headers });
      if (r.throttled) {
        // infrastructure state, not a readability verdict: counted in report.infra like every other check's `unmeasured`
        noteThrottled();
        findings.push(finding('ai-readability', 'unmeasured', 'info', p.path, `document throttled (HTTP ${r.throttled} after ${r.attempts} attempts) — not measured; re-run`, { status: r.throttled }));
        continue;
      }
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
      if (allow) for (const x of checkExclusions(r, allow).filter((e) => !e.decided)) findings.push(finding('ai-readability', 'ai-readability-undecided-exclusion', 'warn', p.path, `excluded block ${x.block} removed ${x.words} words with no allowlist decision entry (reason, fallback, decision)`, { block: x.block, words: x.words }));
      if (r.servedGap.main >= 40) {
        findings.push(finding('ai-readability', 'ai-readability-served-gap', 'info', p.path,
          `${r.servedGap.main} of ${r.servedGap.renderedMain} rendered main words are absent from the served HTML (non-rendering crawlers never read them); chrome ${r.servedGap.chrome}`, ev));
      }
    }
  } finally { await browser.close(); }
  ctx.shared.aiReadability = summary;
  return findings;
}
