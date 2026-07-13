#!/usr/bin/env node
/**
 * qa/report-html.mjs — render report.json as report.html. Used by qa.mjs and
 * runnable standalone to (re)generate the HTML from an existing report:
 *
 *   node skills/qa/scripts/report-html.mjs [--report stardust/qa/report.json]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function htmlReport(report) {
  const sevColor = { error: '#c62828', warn: '#e65100', info: '#546e7a' };
  const rows = report.findings.map((f) => `
    <tr class="${f.allowlisted ? 'allow' : f.severity}">
      <td><span class="pill" style="background:${sevColor[f.severity]}">${f.severity}</span></td>
      <td>${esc(f.check)}</td><td class="mono">${esc(f.id)}</td>
      <td class="mono">${esc(f.path || '(fleet)')}</td>
      <td>${esc(f.message)}${f.allowlisted ? `<div class="reason">allowlisted: ${esc(f.allowlistReason)}</div>` : ''}
      ${f.evidence ? `<details><summary>evidence</summary><pre>${esc(JSON.stringify(f.evidence, null, 2).slice(0, 3000))}</pre></details>` : ''}</td>
    </tr>`).join('');
  const s = report.summary;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>stardust:qa — ${esc(report.base)}</title>
<style>
 body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:2rem;color:#1a1a1a;max-width:1200px}
 h1{font-size:1.3rem} .muted{color:#666}
 table{border-collapse:collapse;width:100%;margin-top:1rem}
 td,th{border-bottom:1px solid #e0e0e0;padding:.45rem .6rem;text-align:left;vertical-align:top;font-size:13px}
 .pill{color:#fff;border-radius:3px;padding:.05rem .45rem;font-size:11px}
 .mono{font-family:ui-monospace,monospace;font-size:12px}
 tr.allow{opacity:.45} .reason{font-size:11px;color:#2e7d32}
 pre{background:#f5f5f5;padding:.5rem;overflow:auto;max-height:240px;font-size:11px}
 .cards{display:flex;gap:1rem;margin:1rem 0} .card{border:1px solid #e0e0e0;border-radius:6px;padding: .7rem 1.1rem}
 .card b{font-size:1.4rem;display:block}
</style></head><body>
<h1>stardust:qa report — ${esc(report.base)}</h1>
<p class="muted">${esc(report.provenance.writtenAt)} · ${report.inventory.pages} pages · checks: ${esc(report.checksRun.join(', '))} · read-only sweep</p>
<div class="cards">
 <div class="card"><b style="color:#c62828">${s.error}</b>errors</div>
 <div class="card"><b style="color:#e65100">${s.warn}</b>warnings</div>
 <div class="card"><b style="color:#546e7a">${s.info}</b>info</div>
 <div class="card"><b style="color:#2e7d32">${s.allowlisted}</b>allowlisted</div>
</div>
<table><tr><th>sev</th><th>check</th><th>id</th><th>path</th><th>finding</th></tr>${rows}</table>
</body></html>`;
}

// standalone: regenerate report.html next to a report.json
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const i = process.argv.indexOf('--report');
  const reportPath = i !== -1 ? process.argv[i + 1] : 'stardust/qa/report.json';
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const out = join(dirname(reportPath), 'report.html');
  writeFileSync(out, htmlReport(report));
  console.log(`wrote ${out} (${report.findings.length} findings)`);
}
