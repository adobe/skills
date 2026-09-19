#!/usr/bin/env node
// Guard: the extract vision gate (extract/SKILL.md § Phase 2.5) may not certify
// a capture the crawler itself flagged.
//
// Why: 22 of 25 vision notes on one harvest mentioned a consent modal while the
// verdict read `ok`; on another, 32 pages captured with broken-image icons and
// 2 with an empty <main> were 96/98 `ok`. The verdict vocabulary is
// `ok | recaptured | suspect`; a page the instrument marked degraded, or whose
// note names an overlay, is `suspect` until it is re-crawled (`--refresh`).
//
// Rules over <dir>/_crawl-log.json and <dir>/pages/<slug>.json:
//   * visionCheck[] entry with verdict `ok` whose notes match
//     /consent|cookie|modal|overlay|scrim|dialog|survey/i → finding;
//   * visionCheck[] entry with verdict `ok` whose page record has
//     `_signals.captureQuality: "degraded"` → finding;
//   * a page record with captureQuality `degraded`, or overlayCoverPct above
//     OVERLAY_FLAG_PCT, that has NO visionCheck entry at all → finding (the
//     flag was never looked at).
// A page whose verdict is `recaptured` or `suspect` never fails this lint.
//
// Usage: node plugins/stardust/evals/lint/crawl-log-lint.mjs [--dir stardust/current]
// Exit: 0 clean · 1 findings · 2 no _crawl-log.json in <dir> (nothing to check is a usage error, not a pass)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OVERLAY_NOTE = /consent|cookie|modal|overlay|scrim|dialog|survey/i;
const OVERLAY_FLAG_PCT = 30; // = extract/scripts/crawl.mjs OVERLAY_FLAG_PCT (crawl ships alone; no import)

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}
const dirIdx = argv.indexOf('--dir');
const dir = dirIdx >= 0 ? argv[dirIdx + 1] : 'stardust/current';
const logPath = join(dir, '_crawl-log.json');
if (!existsSync(logPath)) { console.error(`crawl-log lint: no ${logPath} — pass --dir <stardust/current>`); process.exit(2); }

export function lintCrawlDir(root) {
  const log = JSON.parse(readFileSync(join(root, '_crawl-log.json'), 'utf8'));
  const pagesDir = join(root, 'pages');
  const pages = new Map();
  if (existsSync(pagesDir)) {
    for (const f of readdirSync(pagesDir)) {
      if (!f.endsWith('.json')) continue;
      try { const rec = JSON.parse(readFileSync(join(pagesDir, f), 'utf8')); pages.set(rec.slug || f.replace(/\.json$/, ''), rec); } catch { /* not a page record */ }
    }
  }
  const findings = [];
  const checks = Array.isArray(log.visionCheck) ? log.visionCheck : [];
  const seen = new Set();
  for (const v of checks) {
    if (!v || !v.slug) continue;
    seen.add(v.slug);
    if (v.verdict !== 'ok') continue;
    if (OVERLAY_NOTE.test(v.notes || '')) findings.push(`${v.slug}: verdict ok but the note names an overlay ("${String(v.notes).slice(0, 60)}") — re-crawl with --refresh ${v.slug}; a page with an overlay is never ok`);
    const s = pages.get(v.slug)?._signals || {};
    if (s.captureQuality === 'degraded') findings.push(`${v.slug}: verdict ok but crawl.mjs recorded captureQuality degraded (${[s.emptyMain && 'emptyMain', s.subResourceBlock && `subResourceBlock:${s.brokenImages}`].filter(Boolean).join(', ')}) — suspect until recaptured`);
  }
  for (const [slug, rec] of pages) {
    const s = rec._signals || {};
    if (seen.has(slug)) continue;
    if (s.captureQuality === 'degraded') findings.push(`${slug}: captureQuality degraded and no visionCheck entry — the DEGRADED flag was never looked at`);
    else if ((s.overlayCoverPct || 0) > OVERLAY_FLAG_PCT) findings.push(`${slug}: overlayCoverPct ${s.overlayCoverPct} (> ${OVERLAY_FLAG_PCT}) and no visionCheck entry — recapture before looking`);
  }
  return { findings, checked: checks.length, pages: pages.size };
}

const { findings, checked, pages } = lintCrawlDir(dir);
if (findings.length) { console.error(`crawl-log lint: ${findings.length} finding(s) in ${dir} (${checked} vision verdicts, ${pages} page records)\n${findings.join('\n')}`); process.exit(1); }
console.log(`crawl-log lint: ${dir} clean (${checked} vision verdicts, ${pages} page records)`);
