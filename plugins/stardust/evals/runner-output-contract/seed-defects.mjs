#!/usr/bin/env node
// Re-seeds this eval's fixture from the shared post-migrate tree.
// Usage (from plugins/stardust):
//   rm -rf evals/runner-output-contract/fixture/stardust
//   cp -R evals/_shared/fixture-post-migrate/stardust evals/runner-output-contract/fixture/stardust
//   node evals/runner-output-contract/seed-defects.mjs evals/runner-output-contract/fixture
// Each edit throws if its anchor is missing, so a changed shared tree fails loudly.
import { readFileSync, writeFileSync } from 'node:fs';
const R = process.argv[2] + '/stardust/migrated/';
const edit = (rel, fn) => { const p = R + rel; const s = readFileSync(p, 'utf8'); const o = fn(s); if (o === s) throw new Error('no change: ' + rel); writeFileSync(p, o); };
const PAGES = ['index.html', 'business/index.html', 'insurance/home/index.html', 'insurance/auto/index.html', 'news/storm-season-checklist/index.html', 'news/annual-report-2025/index.html'];
// D1 — every footer links a section that is not in the migrated set (root-relative, so migrate's relative-link counter never saw it)
for (const rel of PAGES) edit(rel, (s) => s.replace(/    <\/nav>\n  <\/footer>/, '      <a href="/claims/">File a claim</a>\n    </nav>\n  </footer>'));
// D2 — the two program pages also link a members area (a dynamic surface, never migrated)
for (const rel of ['insurance/home/index.html', 'insurance/auto/index.html']) edit(rel, (s) => s.replace(/(<nav aria-label="Primary">\n)/, '$1      <a href="/members/login/">Member login</a>\n'));
// D3 — the annual report promotes a section title to a second <h1>
edit('news/annual-report-2025/index.html', (s) => s.replace(/<h2 data-slot="heading">([^<]*)<\/h2>/, '<h1 data-slot="heading">$1</h1>'));
// D4 — business carries a broken-image ingestion marker (deploy #75)
edit('business/index.html', (s) => s.replace(/(<p data-slot="copy">Commercial lines desk[^<]*<\/p>)/, '$1\n      <img src="about:error" alt="Commercial lines desk hours" width="320" height="120">'));
console.log('seeded 4 defect classes into ' + R);
