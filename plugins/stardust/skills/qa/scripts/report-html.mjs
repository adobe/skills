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

// Stardust identity (docs/stardust-identity.html): ink ground, amber signal,
// dust type; mono marks the literal (ids, paths, provenance), never prose.
const STAR_MARK = `<svg viewBox="0 0 64 64" width="44" height="44" style="border-radius:8px;flex:none"><rect width="64" height="64" fill="#0a1024"/>
<g fill="#e8b95e"><rect x="28" y="8" width="8" height="8"/><rect x="28" y="18" width="8" height="8" opacity="0.7"/><rect x="28" y="38" width="8" height="8" opacity="0.7"/><rect x="28" y="48" width="8" height="8"/><rect x="8" y="28" width="8" height="8"/><rect x="18" y="28" width="8" height="8" opacity="0.7"/><rect x="38" y="28" width="8" height="8" opacity="0.7"/><rect x="48" y="28" width="8" height="8"/></g>
<rect x="26" y="26" width="12" height="12" fill="#ffd98a"/>
<g fill="#e8b95e" opacity="0.6"><rect x="18" y="18" width="6" height="6"/><rect x="40" y="18" width="6" height="6"/><rect x="18" y="40" width="6" height="6"/><rect x="40" y="40" width="6" height="6"/></g></svg>`;

export function htmlReport(report) {
  const pill = {
    error: 'background:#ff6b6b;color:#060a14',
    warn: 'background:#e8b95e;color:#0a1024',
    info: 'background:rgba(245,240,230,0.15);color:#f5f0e6',
  };
  // filter buckets: allowlisted findings keep their severity in the pill but
  // filter as their own bucket (they don't count toward the exit code either)
  const bucketOf = (f) => (f.allowlisted ? 'allow' : f.severity);
  const fidOf = (f) => `${f.check}/${f.id}`;
  const rows = report.findings.map((f) => `
    <tr class="${f.allowlisted ? 'allow' : f.severity}" data-bucket="${bucketOf(f)}" data-fid="${esc(fidOf(f))}">
      <td><span class="pill" style="${pill[f.severity]}">${f.severity}</span></td>
      <td>${esc(f.check)}</td><td class="mono">${esc(f.id)}</td>
      <td class="mono">${esc(f.path || '(fleet)')}</td>
      <td>${esc(f.message)}${f.allowlisted ? `<div class="reason">allowlisted · ${esc(f.allowlistReason)}</div>` : ''}
      ${f.evidence ? `<details><summary>evidence</summary><pre>${esc(JSON.stringify(f.evidence, null, 2).slice(0, 3000))}</pre></details>` : ''}</td>
    </tr>`).join('');

  const bucketCounts = { error: 0, warn: 0, info: 0, allow: 0 };
  const fidCounts = new Map();
  for (const f of report.findings) {
    bucketCounts[bucketOf(f)] += 1;
    fidCounts.set(fidOf(f), (fidCounts.get(fidOf(f)) || 0) + 1);
  }
  const sevChips = [['error', 'errors'], ['warn', 'warnings'], ['info', 'info'], ['allow', 'allowlisted']]
    .map(([b, label]) => `<span class="chip sev" data-bucket="${b}">${label} <span class="n">(${bucketCounts[b]})</span></span>`)
    .join('');
  const fidChips = [...fidCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fid, n]) => `<span class="chip fid" data-fid="${esc(fid)}">${esc(fid)} <span class="n">(${n})</span></span>`)
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>stardust:qa — ${esc(report.base)}</title>
<style>
 :root{--ink:#0a1024;--ink-deep:#060a14;--ink-soft:#141b3a;--dust:#f5f0e6;--dust-50:rgba(245,240,230,0.5);
   --dust-30:rgba(245,240,230,0.3);--dust-08:rgba(245,240,230,0.08);--amber:#e8b95e;--amber-light:#ffd98a;--red:#ff6b6b}
 *{box-sizing:border-box}
 body{margin:0;background:var(--ink-deep);color:var(--dust);font:14px/1.55 -apple-system,"SF Pro Text",system-ui,sans-serif}
 .container{max-width:1200px;margin:0 auto;padding:56px 48px 80px}
 .eyebrow{font:500 11px/1 "SF Mono",ui-monospace,monospace;letter-spacing:0.18em;text-transform:uppercase;color:var(--amber);display:block;margin-bottom:12px}
 header{display:flex;gap:22px;align-items:center;margin-bottom:8px}
 h1{font-family:"SF Pro Display",system-ui,sans-serif;font-weight:600;letter-spacing:-0.02em;font-size:34px;line-height:1.05;margin:0}
 .prov{font:500 12px/1.7 "SF Mono",ui-monospace,monospace;letter-spacing:0.04em;color:var(--dust-50);margin:16px 0 0}
 .prov b{color:var(--dust);font-weight:500}
 .fgroup{margin-top:26px}
 .fgroup .eyebrow{margin-bottom:0}
 .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
 .chip{cursor:pointer;user-select:none;background:var(--ink-soft);border:1px solid var(--dust-08);border-radius:999px;
   padding:4px 12px;font:500 11px/1.6 "SF Mono",ui-monospace,monospace;letter-spacing:0.06em;color:var(--dust-50)}
 .chip.sev{text-transform:uppercase;letter-spacing:0.1em}
 .chip .n{opacity:.55}
 .chip:hover{border-color:var(--dust-30);color:var(--dust)}
 .chip.on{border-color:var(--amber);color:var(--amber)}
 .chip.on[data-bucket="error"]{border-color:var(--red);color:var(--red)}
 .chip.on[data-bucket="warn"]{border-color:var(--amber);color:var(--amber)}
 .chip.on[data-bucket="info"]{border-color:var(--dust-30);color:var(--dust)}
 .chip.on[data-bucket="allow"]{border-color:var(--dust-30);color:var(--dust-50)}
 .showing{font:500 11px/1 "SF Mono",ui-monospace,monospace;letter-spacing:0.06em;color:var(--dust-30);margin:22px 0 0}
 .showing .clear{cursor:pointer;color:var(--amber);display:none}
 .showing.filtered .clear{display:inline}
 table{border-collapse:collapse;width:100%;margin-top:28px}
 th{font:500 10px/1 "SF Mono",ui-monospace,monospace;letter-spacing:0.14em;text-transform:uppercase;color:var(--dust-50);text-align:left;padding:0 10px 10px;border-bottom:1px solid var(--dust-30)}
 td{border-bottom:1px solid var(--dust-08);padding:10px;text-align:left;vertical-align:top;font-size:13px;color:rgba(245,240,230,0.85)}
 .pill{border-radius:4px;padding:2px 8px;font:500 10px/1.6 "SF Mono",ui-monospace,monospace;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap}
 .mono{font-family:"SF Mono",ui-monospace,monospace;font-size:12px;color:var(--dust)}
 tr.allow{opacity:.4}
 .reason{font:500 11px/1.5 "SF Mono",ui-monospace,monospace;color:var(--dust-50);margin-top:4px}
 details{margin-top:6px}
 summary{cursor:pointer;font:500 11px/1 "SF Mono",ui-monospace,monospace;letter-spacing:0.08em;color:var(--amber);text-transform:uppercase}
 pre{background:var(--ink);border:1px solid var(--dust-08);border-radius:8px;padding:12px;overflow:auto;max-height:240px;font:12px/1.5 "SF Mono",ui-monospace,monospace;color:#c6d0e4}
 footer{margin-top:56px;padding-top:24px;border-top:1px solid var(--dust-08);font:500 11px/1.7 "SF Mono",ui-monospace,monospace;letter-spacing:0.06em;color:var(--dust-50)}
 footer .tag{color:var(--amber)}
 ::selection{background:var(--amber);color:var(--ink)}
</style></head><body>
<div class="container">
<span class="eyebrow">stardust · qa sweep · read-only</span>
<header>${STAR_MARK}<h1>${esc(report.base.replace(/^https?:\/\//, ''))}</h1></header>
<p class="prov">${esc(report.provenance.writtenAt)} · <b>${report.inventory.pages}</b> pages · ${report.durationSeconds != null ? `${report.durationSeconds}s · ` : ''}checks: ${esc(report.checksRun.join(' · '))}</p>
<div class="fgroup"><span class="eyebrow">filter · severity</span><div class="chips" id="sev-chips">${sevChips}</div></div>
<div class="fgroup"><span class="eyebrow">filter · finding</span><div class="chips" id="fid-chips">${fidChips}</div></div>
<p class="showing"><span id="shown">${report.findings.length}</span> of ${report.findings.length} findings <span class="clear" id="clear">· clear filters</span></p>
<table><thead><tr><th>sev</th><th>check</th><th>id</th><th>path</th><th>finding</th></tr></thead><tbody>${rows}</tbody></table>
<footer><span class="tag">STARDUST</span> · qa report · ${esc(report.provenance.stardustVersion || '')} — findings only; this sweep never edits the site.</footer>
</div>
<script>
(function () {
  var on = { bucket: {}, fid: {} };
  function any(set) { for (var k in set) if (set[k]) return true; return false; }
  function apply() {
    var rows = document.querySelectorAll('tbody tr');
    var shown = 0;
    var sevActive = any(on.bucket); var fidActive = any(on.fid);
    rows.forEach(function (tr) {
      var ok = (!sevActive || on.bucket[tr.dataset.bucket])
            && (!fidActive || on.fid[tr.dataset.fid]);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown += 1;
    });
    document.getElementById('shown').textContent = shown;
    document.querySelector('.showing').classList.toggle('filtered', sevActive || fidActive);
  }
  function wire(sel, key, attr) {
    document.querySelectorAll(sel).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var v = chip.dataset[attr];
        on[key][v] = !on[key][v];
        chip.classList.toggle('on', on[key][v]);
        apply();
      });
    });
  }
  wire('.chip.sev', 'bucket', 'bucket');
  wire('.chip.fid', 'fid', 'fid');
  document.getElementById('clear').addEventListener('click', function () {
    on = { bucket: {}, fid: {} };
    document.querySelectorAll('.chip.on').forEach(function (c) { c.classList.remove('on'); });
    apply();
  });
})();
</script>
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
