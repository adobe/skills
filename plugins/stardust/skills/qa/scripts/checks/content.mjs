/**
 * qa/checks/content.mjs — category B: content fidelity & structure (delivery layer).
 *
 * Structure sanity per page (.plain.html):
 *   - exactly one <h1>
 *   - no about:error images (broken ingestion)
 *   - no placeholder strings ([Placeholder], REPLACE_WITH_*, lorem ipsum, TODO/TBD)
 *   - prose-flattening signals: runs of micro-paragraphs, bare ordinals,
 *     adjacent duplicate 12-word shingles (a component pasted twice)
 *   - flattened collections: a structured directory/card set rendered as
 *     default content (periodic tag cycles like h4+p+a repeating N times
 *     outside any block wrapper — a "masthead + prose dump + CTA" page)
 *   - source images lost: the capture has N images, the delivered page has
 *     almost none (the pipeline strips imagery from flat-authored content)
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

/**
 * Block names from parsed sections — only classed divs that are CHILDREN of a
 * section are blocks. Top-level classed divs are sections carrying a
 * section-metadata style (e.g. `.article-body`) — styling, not blocks; a
 * flat regex over `<div class=…>` confuses the two and invents phantom blocks.
 */
function blockNames(sections) {
  const names = new Set();
  for (const s of sections) {
    for (const c of s.children) {
      if (isBlock(c)) {
        const name = c.cls.split(' ')[0];
        if (name !== 'metadata' && name !== 'section-metadata') names.add(name);
      }
    }
  }
  return names;
}

/* ------------------------------------------------ flattened collections -- */

const VOID_TAGS = new Set(['img', 'br', 'hr', 'source', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

/**
 * Parse a .plain.html document into sections (top-level divs) of direct
 * children: { tag, cls, words, imgs }. Blocks (classed divs) are kept as one
 * opaque child; everything else is default content. The pipeline emits
 * well-formed markup, so a depth-tracking tag scan is sufficient.
 */
export function parseSections(html) {
  const tagRe = /<(\/?)([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gi;
  const sections = [];
  let section = null;
  let child = null; // { tag, cls, start, depth }
  let depth = 0;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    const [, closing, rawTag, attrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    const isVoid = VOID_TAGS.has(tag) || !!selfClose;
    if (!closing && !isVoid) {
      if (depth === 0 && tag === 'div') {
        section = { cls: (attrs.match(/class=["']([^"']*)["']/i) || [])[1] || '', children: [] };
      } else if (depth === 1 && section && !child) {
        const cls = (attrs.match(/class=["']([^"']*)["']/i) || [])[1] || '';
        child = { tag, cls, start: m.index + m[0].length, depth };
      }
      depth += 1;
    } else if (closing) {
      depth -= 1;
      if (depth === 1 && child) {
        const inner = html.slice(child.start, m.index);
        section.children.push({
          tag: child.tag,
          cls: child.cls,
          words: inner.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
          imgs: (inner.match(/<img[\s>]/gi) || []).length,
        });
        child = null;
      } else if (depth === 0 && section) {
        sections.push(section);
        section = null;
      }
    } else if (depth === 1 && section && child === null && tag === 'img') {
      section.children.push({ tag: 'img', cls: '', words: 0, imgs: 1 });
    }
  }
  return sections;
}

const isBlock = (c) => c.tag === 'div' && c.cls && c.cls !== 'default-content-wrapper';
const isHeading = (t) => /^h[1-6]$/.test(t);

/**
 * Detect structured collections rendered as default content: within each run
 * of consecutive unblocked children, find the smallest tag cycle (period 2-6,
 * containing a heading or picture) that repeats >= 4 times. Also a looser
 * census: >= 5 same-level headings with <= 2 elements between them.
 * Returns [{ section, cycle, repeats, runLength, words }].
 */
export function detectFlattenedCollections(sections) {
  const hits = [];
  sections.forEach((section, si) => {
    // a classed section carries a section-metadata style (template-styled
    // prose, e.g. `.article-body`) — designed content, not an unstyled dump
    if (section.cls) return;
    const runs = [];
    let run = [];
    for (const c of section.children) {
      if (isBlock(c)) { if (run.length) runs.push(run); run = []; } else run.push(c);
    }
    if (run.length) runs.push(run);

    for (const r of runs) {
      if (r.length < 8) continue;
      const seq = r.map((c) => c.tag);
      let found = null;
      for (let period = 2; period <= 6 && !found; period += 1) {
        const repeats = Math.floor(seq.length / period);
        if (repeats < 4) continue;
        const cycle = seq.slice(0, period);
        if (!cycle.some((t) => isHeading(t) || t === 'picture')) continue;
        let ok = true;
        for (let i = 0; i < repeats * period; i += 1) {
          if (seq[i] !== cycle[i % period]) { ok = false; break; }
        }
        if (ok) found = { cycle, repeats };
      }
      if (!found) {
        // census fallback: many same-level headings at a steady small stride
        const levels = {};
        seq.forEach((t) => { if (isHeading(t)) levels[t] = (levels[t] || 0) + 1; });
        const [lvl, count] = Object.entries(levels).sort((a, b) => b[1] - a[1])[0] || [null, 0];
        if (count >= 5) {
          const idx = seq.map((t, i) => (t === lvl ? i : -1)).filter((i) => i !== -1);
          const strides = idx.slice(1).map((v, i) => v - idx[i]);
          if (strides.every((s) => s >= 1 && s <= 3)) found = { cycle: [lvl, '…'], repeats: count };
        }
      }
      if (found) {
        hits.push({
          section: si,
          cycle: found.cycle,
          repeats: found.repeats,
          runLength: r.length,
          words: r.reduce((a, c) => a + c.words, 0),
        });
      }
    }
  });
  return hits;
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
      // char cap keeps CJK prose (1 "word" per sentence) out of the signal
      if (w > 0 && w <= 3 && t.length <= 15) run += 1;
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

    // --- flattened collections (structured content outside any block) ------
    const sections = parseSections(html);
    const allChildren = sections.flatMap((s) => s.children);
    const totalWords = allChildren.reduce((a, c) => a + c.words, 0) || 1;
    const unblockedWords = allChildren.filter((c) => !isBlock(c)).reduce((a, c) => a + c.words, 0);
    const unblockedRatio = unblockedWords / totalWords;
    for (const hit of detectFlattenedCollections(sections)) {
      const severe = hit.repeats >= 6 && unblockedRatio > 0.4;
      findings.push(finding('content', 'flattened-collection', severe ? 'error' : 'warn', p.path,
        `default content repeats the pattern [${hit.cycle.join('+')}] ${hit.repeats}× (section ${hit.section}) — a structured collection rendered as plain prose; it needs a block`,
        { ...hit, unblockedRatio: +unblockedRatio.toFixed(2) }));
    }

    // --- blocks used -------------------------------------------------------
    const blocks = blockNames(sections);
    pageBlocks.set(p.path, [...blocks]);
    for (const b of blocks) fleetBlocks.add(b);

    // --- verbatim fidelity vs scrape capture --------------------------------
    const scrape = scrapeMap.get(p.path);
    if (scrape && Array.isArray(scrape.nodes)) {
      // source images lost: capture had editorial images, delivery has almost
      // none (pipeline strips imagery authored inside flat content)
      const sourceImgs = scrape.nodes.filter((n) => n.type === 'img').length;
      const deliveredImgs = (html.match(/<img[\s>]/gi) || []).length;
      if (sourceImgs >= 4 && deliveredImgs < sourceImgs / 4) {
        findings.push(finding('content', 'source-images-lost', 'error', p.path,
          `source capture has ${sourceImgs} images but the delivered page renders ${deliveredImgs} — imagery lost in migration`,
          { sourceImgs, deliveredImgs }));
      }
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
