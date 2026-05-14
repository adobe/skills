#!/usr/bin/env node
// file-protocol-audit.mjs — proves the migrated bundle's zip-and-deploy
// promise by BFS-walking every internal <a href> from
// file://<abspath>/index.html via headless Chromium. For each reachable
// page, asserts (a) the target file exists on disk and (b) opening it via
// file:// produces no failed network entries for same-origin assets.
//
// The portability contract is documented in
// skills/migrate/reference/migration-procedure.md § Reference shape.
// This fixture is the runtime backstop for that contract.
//
// Usage:
//   node skills/migrate/fixtures/file-protocol-audit.mjs <migrated-dir>
//
// Exit codes:
//   0  every internal href resolves; every same-origin asset loads.
//   1  one or more findings (offending file + href + reason printed).
//   2  usage error or Playwright not installed.
//
// Requires Playwright:
//   npm i -D playwright
//   npx playwright install chromium

import { existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const dirArg = process.argv[2];
if (!dirArg) {
  console.error('Usage: node file-protocol-audit.mjs <migrated-dir>');
  process.exit(2);
}

const ROOT = isAbsolute(dirArg) ? dirArg : resolve(process.cwd(), dirArg);
const INDEX = join(ROOT, 'index.html');
if (!existsSync(INDEX) || !statSync(INDEX).isFile()) {
  console.error(`file-protocol-audit: no index.html at ${ROOT}`);
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('file-protocol-audit: Playwright is required.');
  console.error('  npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const SCHEME_SKIP = /^(https?:|mailto:|tel:|javascript:|data:|#)/i;
const browser = await chromium.launch();
const findings = [];
const visited = new Set();
const queue = [INDEX];

try {
  while (queue.length) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    if (!existsSync(filePath)) {
      findings.push({ from: '(queued)', href: filePath, reason: 'file does not exist on disk' });
      continue;
    }

    const failedAssets = [];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('requestfailed', (req) => {
      const u = req.url();
      // Same-origin asset = file:// URL pointing into ROOT
      if (u.startsWith('file://') && fileURLToPath(u).startsWith(ROOT)) {
        failedAssets.push({ url: u, failure: req.failure()?.errorText });
      }
    });
    page.on('response', (res) => {
      const u = res.url();
      if (u.startsWith('file://') && fileURLToPath(u).startsWith(ROOT)) {
        // file:// has no HTTP status; missing files surface as requestfailed
        // (handled above) or as a 0-byte 404 page in some engines. The
        // existsSync check before queueing handles the file-existence side.
      }
    });

    await page.goto(pathToFileURL(filePath).toString(), { waitUntil: 'load' });

    for (const a of failedAssets) {
      findings.push({ from: filePath, href: a.url, reason: `asset failed under file://: ${a.failure}` });
    }

    const hrefs = await page.$$eval('a[href]', (els) => els.map((e) => e.getAttribute('href')));
    await ctx.close();

    for (const href of hrefs) {
      if (!href || SCHEME_SKIP.test(href)) continue;
      const [pathPart] = href.split('#');
      if (!pathPart) continue; // anchor-only

      const target = resolve(dirname(filePath), pathPart);
      if (!target.startsWith(ROOT)) {
        findings.push({ from: filePath, href, reason: 'href resolves outside the migrated tree' });
        continue;
      }
      if (!existsSync(target)) {
        findings.push({ from: filePath, href, reason: `target file does not exist: ${target}` });
        continue;
      }
      if (statSync(target).isDirectory()) {
        findings.push({ from: filePath, href, reason: `directory-only href will not resolve on file://: ${target}` });
        continue;
      }
      if (target.endsWith('.html')) queue.push(target);
    }
  }
} finally {
  await browser.close();
}

if (findings.length === 0) {
  console.log(`file-protocol-audit: OK (${visited.size} pages, every internal href resolves under file://)`);
  process.exit(0);
}

console.error(`file-protocol-audit: ${findings.length} finding(s)`);
for (const f of findings) {
  console.error(`  ${f.from}`);
  console.error(`    href:    ${f.href}`);
  console.error(`    reason:  ${f.reason}`);
}
process.exit(1);
