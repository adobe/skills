#!/usr/bin/env node
// pagemap-audit.mjs — static check that every internal <a href> in the
// migrated bundle resolves to a file recorded as some entry's outputPath
// in state.json.migrate.pageMap[]. Catches the synthesis bug where
// internal-link rewriting bypassed the page map and turned
// /about-us/history.html into about-us/history/index.html.
//
// Contract: skills/migrate/reference/migration-procedure.md
//           § Page map (build once, use everywhere)
//
// Usage:
//   node skills/migrate/fixtures/pagemap-audit.mjs <migrated-dir> <state.json>
//
// Exit codes:
//   0  every internal href appears as a pageMap outputPath.
//   1  one or more findings (offending file + href printed).
//   2  usage error or missing inputs.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, isAbsolute, join, dirname, relative } from 'node:path';

const [dirArg, stateArg] = process.argv.slice(2);
if (!dirArg || !stateArg) {
  console.error('Usage: node pagemap-audit.mjs <migrated-dir> <state.json>');
  process.exit(2);
}

const ROOT = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg);
const STATE = isAbsolute(stateArg) ? stateArg : resolve(process.cwd(), stateArg);

let state;
try { state = JSON.parse(readFileSync(STATE, 'utf8')); }
catch (e) { console.error(`pagemap-audit: could not read ${STATE}: ${e.message}`); process.exit(2); }

const pageMap = state?.migrate?.pageMap;
if (!Array.isArray(pageMap)) {
  console.error('pagemap-audit: state.json.migrate.pageMap[] is missing or not an array');
  process.exit(2);
}
const outputPaths = new Set(pageMap.map((e) => e.outputPath));

const SCHEME_SKIP = /^(https?:|mailto:|tel:|javascript:|data:|#)/i;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (name.endsWith('.html')) yield p;
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(HREF_RE)) {
    const href = m[1];
    if (SCHEME_SKIP.test(href)) continue;
    const [pathPart] = href.split('#');
    if (!pathPart) continue;
    const target = resolve(dirname(file), pathPart);
    if (!target.startsWith(ROOT)) {
      findings.push({ file, href, reason: 'resolves outside the migrated tree' });
      continue;
    }
    const relPath = relative(ROOT, target);
    if (!outputPaths.has(relPath)) {
      findings.push({ file, href, reason: `relative target "${relPath}" is not in pageMap[]` });
    }
  }
}

if (findings.length === 0) {
  console.log(`pagemap-audit: OK (${pageMap.length} pageMap entries, every internal href matches)`);
  process.exit(0);
}

console.error(`pagemap-audit: ${findings.length} finding(s)`);
for (const f of findings) {
  console.error(`  ${relative(process.cwd(), f.file)}`);
  console.error(`    href:    ${f.href}`);
  console.error(`    reason:  ${f.reason}`);
}
process.exit(1);
