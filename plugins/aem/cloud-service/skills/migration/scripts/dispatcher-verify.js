'use strict';
const fs = require('fs');
const path = require('path');
const { readTextFiles, countSectionRules } = require('./dispatcher-inventory.js');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function nonComment(txt) { return (txt || '').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join('\n'); }

function verifyOutput(outputSrcDir, baseline) {
  const failures = [], warnings = [];
  const dispD = path.join(outputSrcDir, 'conf.dispatcher.d');

  // 1. Filter/ACL preservation — HARD GATE.
  const filtersAny = path.join(dispD, 'filters/filters.any');
  const farmFiles = readTextFiles(dispD, n => n.endsWith('.farm'));
  const outFilterRules = countSectionRules([filtersAny].filter(fs.existsSync), 'anything-ignored')
    + (nonComment(read(filtersAny)).match(/\/[0-9]{3,4}\s*\{/g) || []).length
    + countSectionRules(farmFiles, 'filter');
  if ((baseline.filter || 0) > 0 && outFilterRules === 0) {
    failures.push({ severity: 'critical', category: 'filter-acl-loss',
      detail: `Source had ${baseline.filter} filter rules but the output has none (empty filters.any / farm /filter). Filters are security-critical and must not be dropped.` });
  } else if ((baseline.filter || 0) > outFilterRules) {
    failures.push({ severity: 'important', category: 'filter-rule-regression',
      detail: `Filter rule count dropped ${baseline.filter} → ${outFilterRules}.` });
  }

  // 2. Rewrite reconciliation (warning-level; rewrites may legitimately move to CDN).
  const rwFiles = readTextFiles(outputSrcDir, n => n.endsWith('.rules') || n.endsWith('.vhost'));
  const outRw = rwFiles.reduce((a, f) => a + ((read(f) || '').match(/^\s*(RewriteRule|Redirect(Match)?)\b/gm) || []).length, 0);
  if ((baseline.rewrite || 0) > outRw) {
    warnings.push(`Rewrite/redirect count dropped ${baseline.rewrite} → ${outRw} — confirm the missing rules moved to CDN or were intentional.`);
  }

  // 3. Artifact health — oversized vhost (mega-inlined).
  for (const v of readTextFiles(path.join(outputSrcDir, 'conf.d'), n => n.endsWith('.vhost'))) {
    const lines = (read(v) || '').split('\n').length;
    if (lines > 5000) failures.push({ severity: 'important', category: 'disorganized',
      detail: `${path.basename(v)} is ${lines} lines — mega-inlined; restructure rewrites into named include files.` });
  }

  // 4. Current-SDK conventions.
  if (!fs.existsSync(path.join(dispD, 'enabled_farms/farms.any'))) {
    warnings.push('Missing enabled_farms/farms.any collector ($include "./*.farm") — add for current-SDK compliance.');
  }

  return { ok: failures.length === 0, failures, warnings };
}

module.exports = { verifyOutput };
