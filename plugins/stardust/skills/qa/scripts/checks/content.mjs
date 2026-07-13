/**
 * qa/checks/content.mjs — category B: content fidelity & structure (delivery layer).
 *
 * Structure sanity per page (.plain.html):
 *   - exactly one <h1>
 *   - no about:error images (broken ingestion)
 *   - no placeholder strings ([Placeholder], REPLACE_WITH_*, lorem ipsum, TODO/TBD)
 *   - prose-flattening signals: runs of micro-paragraphs, bare ordinals,
 *     adjacent duplicate 12-word shingles (a component pasted twice)
 *   - block classes resolve to served block code (/blocks/<name>/<name>.js|css)
 *
 * Verbatim fidelity (optional, needs --scrape <dir> of stardust scrape captures):
 *   - every captured text node (>= 5 words) must appear verbatim in the
 *     delivered text; coverage below threshold flags the page, with the
 *     missing nodes as evidence for LLM/human triage.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchUrl, pMap, finding, plainUrl, stripTags, normText, paragraphTexts, readJSON,
} from '../lib.mjs';

const PLACEHOLDER_RE = /\[placeholder[^\]]*\]|REPLACE_WITH_[A-Z_]+|lorem ipsum|\bTODO\b|\bTBD\b/gi;
const VERBATIM_THRESHOLD = 0.95;
const MIN_NODE_WORDS = 5;

function blockNames(html) {
  const names = new Set();
  for (const m of html.matchAll(/<div class="([a-z][a-z0-9-]*)(?: [^"]*)?">/g)) {
    if (m[1] !== 'metadata' && m[1] !== 'section-metadata') names.add(m[1]);
  }
  return names;
}

function loadScrapeMap(scrapeDir) {
  const map = new Map(); // delivered path -> scrape doc
  if (!scrapeDir || !existsSync(scrapeDir)) return map;
  for (const f of readdirSync(scrapeDir)) {
    if (!f.endsWith('.json')) continue;
    const doc = readJSON(join(scrapeDir, f), null);
    if (doc && doc.path) map.set(doc.path.replace(/\/$/, '') || '/', doc);
  }
  return map;
}

export async function run(ctx) {
  const { base, inventory, opts } = ctx;
  const findings = [];
  const scrapeMap = loadScrapeMap(opts.scrapeDir);
  const fleetBlocks = new Set();
  const pageBlocks = new Map(); // path -> Set(block names) — reused by templates check

  await pMap(inventory.pages, async (p) => {
    const res = await fetchUrl(plainUrl(base, p.path));
    if (res.status !== 200) return; // routing check owns reachability
    const html = res.body;
    const text = stripTags(html);

    // --- structure sanity -------------------------------------------------
    const h1s = (html.match(/<h1[\s>]/gi) || []).length;
    if (h1s !== 1) {
      findings.push(finding('content', 'h1-count', 'error', p.path,
        `page has ${h1s} <h1> elements (expected exactly 1)`));
    }
    const aboutErrors = (html.match(/about:error/g) || []).length;
    if (aboutErrors) {
      findings.push(finding('content', 'about-error-img', 'error', p.path,
        `${aboutErrors} image(s) failed ingestion (about:error src)`));
    }
    const placeholders = [...new Set((text.match(PLACEHOLDER_RE) || []).map((s) => s.slice(0, 60)))];
    if (placeholders.length) {
      findings.push(finding('content', 'placeholder-copy', 'error', p.path,
        `placeholder strings in delivered copy: ${placeholders.slice(0, 5).join(' | ')}`,
        { count: (text.match(PLACEHOLDER_RE) || []).length, samples: placeholders.slice(0, 10) }));
    }

    // --- prose-flattening signals ------------------------------------------
    const ptexts = paragraphTexts(html);
    let run = 0; const runs = [];
    for (const t of ptexts) {
      const w = t.split(/\s+/).filter(Boolean).length;
      if (w > 0 && w <= 3) run += 1;
      else { if (run >= 4) runs.push(run); run = 0; }
    }
    if (run >= 4) runs.push(run);
    if (runs.length) {
      findings.push(finding('content', 'micro-paragraph-run', 'warn', p.path,
        `${runs.length} run(s) of >=4 consecutive micro-paragraphs (<=3 words) — likely a flattened component`,
        { runLengths: runs }));
    }
    const ordinals = ptexts.filter((t) => /^\d{1,2}\.?$/.test(t.trim())).length;
    if (ordinals >= 2) {
      findings.push(finding('content', 'bare-ordinals', 'warn', p.path,
        `${ordinals} bare-number paragraphs (<p>1</p>) — numbered component flattened to prose`));
    }
    const toks = normText(ptexts.join(' ')).split(' ');
    const seen = new Map();
    for (let i = 0; i + 12 <= toks.length; i += 1) {
      const key = toks.slice(i, i + 12).join(' ');
      if (seen.has(key) && i - seen.get(key) < 400) {
        findings.push(finding('content', 'duplicate-text', 'warn', p.path,
          `a 12-word sequence repeats within 400 words — content pasted twice?`,
          { excerpt: key }));
        break;
      }
      seen.set(key, i);
    }

    // --- blocks used -------------------------------------------------------
    const blocks = blockNames(html);
    pageBlocks.set(p.path, [...blocks]);
    for (const b of blocks) fleetBlocks.add(b);

    // --- verbatim fidelity vs scrape capture --------------------------------
    const scrape = scrapeMap.get(p.path);
    if (scrape && Array.isArray(scrape.nodes)) {
      const delivered = normText(text);
      const missing = [];
      let totalWords = 0; let coveredWords = 0;
      for (const node of scrape.nodes) {
        const nt = normText(node.text || '');
        const w = nt.split(' ').filter(Boolean).length;
        if (w < MIN_NODE_WORDS) continue;
        totalWords += w;
        if (delivered.includes(nt)) coveredWords += w;
        else missing.push({ type: node.type, words: w, text: (node.text || '').slice(0, 160) });
      }
      const coverage = totalWords ? coveredWords / totalWords : 1;
      if (coverage < VERBATIM_THRESHOLD) {
        findings.push(finding('content', 'verbatim-below-threshold', 'warn', p.path,
          `verbatim coverage ${(coverage * 100).toFixed(1)}% (< ${VERBATIM_THRESHOLD * 100}%) vs source capture — needs triage: defect or accepted rewrite?`,
          { coverage: +(coverage * 100).toFixed(1), missingNodes: missing.slice(0, 15), missingCount: missing.length }));
      } else if (missing.length) {
        findings.push(finding('content', 'verbatim-missing-nodes', 'info', p.path,
          `verbatim coverage ${(coverage * 100).toFixed(1)}%; ${missing.length} captured node(s) not found verbatim`,
          { missingNodes: missing.slice(0, 10) }));
      }
    }
  }, 8);

  if (scrapeMap.size === 0 && opts.scrapeDir) {
    findings.push(finding('content', 'scrape-dir-empty', 'info', '',
      `no scrape captures readable at ${opts.scrapeDir} — verbatim fidelity skipped`));
  }

  // --- every block class used must resolve to served block code ------------
  await pMap([...fleetBlocks], async (b) => {
    const js = await fetchUrl(`${base}/blocks/${b}/${b}.js`, { method: 'HEAD' });
    const css = await fetchUrl(`${base}/blocks/${b}/${b}.css`, { method: 'HEAD' });
    if (js.status !== 200 && css.status !== 200) {
      const where = inventory.pages.filter((p) => (pageBlocks.get(p.path) || []).includes(b)).map((p) => p.path);
      findings.push(finding('content', 'unknown-block', 'error', where[0] || '',
        `block "${b}" is authored but serves no code (/blocks/${b}/ has neither js nor css)`,
        { block: b, pages: where.slice(0, 10) }));
    }
  }, 6);

  ctx.shared.pageBlocks = Object.fromEntries(pageBlocks); // handoff to templates check
  return findings;
}
