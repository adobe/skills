'use strict';
const fs = require('fs');
const path = require('path');
const { readTextFiles, countFilterRules, countRewrites } = require('./dispatcher-inventory.js');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function verifyOutput(outputSrcDir, baseline) {
  const failures = [], warnings = [];
  const dispD = path.join(outputSrcDir, 'conf.dispatcher.d');

  // 1. Filter/ACL preservation — HARD GATE. Count the output the SAME way buildInventory
  //    counted the baseline (countFilterRules): inline farm /filter{} rules PLUS standalone
  //    $include'd filter files (filters/*.any, *_filters.any). Symmetry is essential — an
  //    $include'd source can't slip past as 0, and a converter that preserves filters into
  //    filters.any / a *_filters.any include is not falsely flagged as loss.
  const outputFilterIncludesUnresolved = [];
  const outFilterRules = countFilterRules(outputSrcDir, undefined, outputFilterIncludesUnresolved);
  if ((baseline.filter || 0) > 0 && outFilterRules === 0) {
    failures.push({ severity: 'critical', category: 'filter-acl-loss',
      detail: `Source had ${baseline.filter} filter rules but the output has none (empty filters.any / farm /filter). Filters are security-critical and must not be dropped.` });
  } else if ((baseline.filter || 0) > outFilterRules) {
    failures.push({ severity: 'important', category: 'filter-rule-regression',
      detail: `Filter rule count dropped ${baseline.filter} → ${outFilterRules}.` });
  }
  // An unresolved $include (an absolute container path, a glob, or a genuinely missing file) on
  // EITHER side means that side's filter count may be under-reported — the gate above already
  // saw the (possibly incomplete) number, so surface this as an honesty warning rather than
  // silently trusting a clean-looking result.
  const allUnresolved = [...(baseline.filterIncludesUnresolved || []), ...outputFilterIncludesUnresolved];
  if (allUnresolved.length) {
    warnings.push(`Filter/ACL count may be incomplete — ${allUnresolved.length} $include target(s) could not be read from disk (e.g. an absolute container path or a glob): ${allUnresolved.slice(0, 3).join(', ')}${allUnresolved.length > 3 ? ', …' : ''}. Verify the filter rules there by hand rather than trusting the count above.`);
  }

  // 2. Rewrite reconciliation (warning-level; rewrites may legitimately move to CDN). Count via
  //    the shared counter, EXCLUDING Adobe-managed default_* immutables (default_rewrite.rules) so
  //    this warning agrees with the coverage report's custom-only rewrite figure.
  const outRw = countRewrites(outputSrcDir, { excludeDefault: true });
  if ((baseline.rewrite || 0) > outRw) {
    warnings.push(`Rewrite/redirect count dropped ${baseline.rewrite} → ${outRw} — expected when the source uses .tmpl templates (inflated baseline) or when redirects move to the CDN edge; reconcile against the tool's conversion-report.md rather than treating the delta as loss.`);
  }

  // 3. Artifact health — oversized vhost (mega-inlined). Predicate matches the SAME vhost-file
  //    shape buildInventory's own vhostFiles uses (n.endsWith('.vhost') || vhost*.conf) — the
  //    narrower `.vhost`-only predicate missed real converter output like
  //    `conf.d/enabled_vhosts/vhosts.conf` and `conf.d/dispatcher_vhost.conf` (confirmed on a
  //    real converted config: these are genuine vhost files, just not suffixed `.vhost`).
  for (const v of readTextFiles(path.join(outputSrcDir, 'conf.d'), n => n.endsWith('.vhost') || /vhost.*\.conf/.test(n))) {
    const lines = (read(v) || '').split('\n').length;
    if (lines > 5000) failures.push({ severity: 'important', category: 'disorganized',
      detail: `${path.basename(v)} is ${lines} lines — mega-inlined; restructure rewrites into named include files.` });
  }

  // 4. Current-SDK conventions.
  if (!fs.existsSync(path.join(dispD, 'enabled_farms/farms.any'))) {
    warnings.push('Missing enabled_farms/farms.any collector ($include "./*.farm") — add for current-SDK compliance.');
  }
  // `conf.vhost.d` is an AMS on-premise/Docker-flexible-mode SOURCE-only convention — it is not
  // part of any valid cloud dispatcher layout (the guardrails require vhosts at
  // conf.d/enabled_vhosts/*.vhost; the real SDK validator hard-fails without that pattern). Its
  // survival into what's presented as the OUTPUT means the vhost layer likely didn't convert —
  // flag it early and specifically rather than waiting for a later, more cryptic validator error.
  if (fs.existsSync(path.join(outputSrcDir, 'conf.vhost.d'))) {
    warnings.push('conf.vhost.d found in the output — this is an on-premise/flexible-mode source layout, not a valid cloud shape; the vhost layer may not have converted. Expected conf.d/enabled_vhosts/*.vhost instead.');
  }

  return { ok: failures.length === 0, failures, warnings };
}

module.exports = { verifyOutput };
