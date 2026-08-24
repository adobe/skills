'use strict';
const fs = require('fs');
const path = require('path');

const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// A dispatcher config root has conf.d/ or conf.dispatcher.d/ or conf.vhost.d/ or a dispatcher.any.
function looksLikeDispatcher(dir) {
  return ['conf.d', 'conf.dispatcher.d', 'conf.vhost.d'].some(d => isDir(path.join(dir, d)))
    || walkFind(dir, n => n === 'dispatcher.any' || n === 'dispatcher.any.tmpl', 4);
}

function walkFind(dir, pred, depth, d = 0) {
  if (d > depth) return false;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of es) {
    if ((e.isFile() || e.isSymbolicLink()) && pred(e.name)) return true;
    if (e.isDirectory() && !['node_modules', '.git', 'target', 'dist'].includes(e.name)
        && walkFind(path.join(dir, e.name), pred, depth, d + 1)) return true;
  }
  return false;
}

function detectMode(root) {
  const dispD = path.join(root, 'conf.dispatcher.d');
  const hasStd = isDir(path.join(dispD, 'enabled_farms')) || isDir(path.join(dispD, 'available_farms'));
  const hasMonolith = walkFind(root, n => n === 'dispatcher.any' || n === 'dispatcher.any.tmpl', 4)
    && !isDir(dispD);
  const alreadyCloud = exists(path.join(root, 'opt-in/USE_SOURCES_DIRECTLY'))
    || exists(path.join(dispD, 'enabled_farms/farms.any'));
  const amsMarkers = hasAmsMarkers(root);

  if (!looksLikeDispatcher(root)) return 'not-dispatcher';
  if (alreadyCloud && !amsMarkers) return 'already-cloud';
  if (hasStd) return 'standard';
  if (hasMonolith || (isDir(path.join(root, 'conf.vhost.d')) && !isDir(dispD))) return 'flexible';
  // has a dispatcher.any + vhosts but not standard v2.0 → treat as flexible-general (v1/unusual)
  if (walkFind(root, n => n === 'dispatcher.any', 4)) return 'v1';
  return 'unknown';
}

function hasAmsMarkers(root) {
  return walkFind(root, n => n.startsWith('ams_') || n.endsWith('_farm.any'), 4)
    || isDir(path.join(root, 'conf.d/whitelists'));
}

function findConfigRoots(workspaceRoot, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let es; try { es = fs.readdirSync(workspaceRoot, { withFileTypes: true }); } catch { return acc; }
  if (detectMode(workspaceRoot) !== 'not-dispatcher') acc.push(workspaceRoot);
  for (const e of es) {
    if (!e.isDirectory() || ['node_modules', '.git', 'target', 'dist'].includes(e.name)) continue;
    findConfigRoots(path.join(workspaceRoot, e.name), acc, depth + 1);
  }
  return acc;
}

function readTextFiles(dir, pred) {
  const out = [];
  (function rec(d, depth) {
    if (depth > 6) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && !['node_modules', '.git', 'target'].includes(e.name)) rec(f, depth + 1);
      else if (e.isFile() && pred(e.name)) out.push(f);
    }
  })(dir, 0);
  return out;
}

// Count farm-rule blocks like `/0001 { /type ... }` inside a `/filter` section of any dispatcher.any/farm.
function countSectionRules(files, section) {
  let n = 0;
  for (const f of files) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const secRe = new RegExp('/' + section + '\\s*\\{', 'g');
    let m;
    while ((m = secRe.exec(txt))) {
      // scan balanced braces from the section open, count `/NNNN {` entries within
      const body = extractBraceBody(txt, m.index + m[0].length - 1);
      n += (body.match(/\/[0-9]{3,4}\s*\{/g) || []).length;
    }
  }
  return n;
}

function extractBraceBody(txt, openIdx) {
  let depth = 0, i = openIdx, start = openIdx + 1;
  for (; i < txt.length; i++) {
    if (txt[i] === '{') depth++;
    else if (txt[i] === '}') { depth--; if (depth === 0) return txt.slice(start, i); }
  }
  return txt.slice(start);
}

function buildInventory(root) {
  const mode = detectMode(root);
  const dispAny = readTextFiles(root, n => n === 'dispatcher.any' || n === 'dispatcher.any.tmpl');
  const farmFiles = readTextFiles(root, n => n.endsWith('.farm') || n.endsWith('_farm.any'));
  const anyFarms = dispAny.concat(farmFiles);
  const vhostFiles = readTextFiles(root, n => n.endsWith('.vhost') || /vhost.*\.conf/.test(n));
  const ruleFiles = readTextFiles(root, n => n.endsWith('.rules') || n.endsWith('.rules.tmpl'));
  const httpd = readTextFiles(root, n => n === 'httpd.conf' || n === 'httpd.conf.tmpl')[0] || null;
  const tmplUsage = readTextFiles(root, n => n.endsWith('.tmpl')).length > 0;

  const rewriteCount = ruleFiles.reduce((a, f) => {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return a; }
    return a + (t.match(/^\s*(RewriteRule|Redirect(Match)?)\b/gm) || []).length;
  }, 0) + vhostFiles.reduce((a, f) => {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return a; }
    return a + (t.match(/^\s*(RewriteRule|Redirect(Match)?)\b/gm) || []).length;
  }, 0);

  const cmVarCandidates = [];
  for (const f of vhostFiles.concat(readTextFiles(root, n => n.endsWith('.conf') || n.endsWith('.conf.tmpl')))) {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!cmVarCandidates.includes(m[1])) cmVarCandidates.push(m[1]);
  }

  return {
    mode, configRoot: root,
    dispatcherAny: dispAny[0] || null, httpd,
    vhostFiles, farmFiles,
    ruleCounts: {
      filter: countSectionRules(anyFarms, 'filter'),
      rewrite: rewriteCount,
      cache: countSectionRules(anyFarms, 'rules'),
      clientheader: countSectionRules(anyFarms, 'clientheaders'),
      virtualhost: countSectionRules(anyFarms, 'virtualhosts'),
    },
    tmplUsage, cmVarCandidates, amsMarkers: hasAmsMarkers(root),
  };
}

function runDispatcherScan(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  let roots; try { roots = findConfigRoots(workspaceRoot); } catch (e) { return { ok: false, findings: [], rawFindings: [], warnings: [], error: e.message }; }
  const findings = [], rawFindings = [];
  for (const root of roots) {
    const inv = buildInventory(root);
    if (inv.mode === 'already-cloud' || inv.mode === 'not-dispatcher') continue;
    findings.push({ location: root, detail: `Dispatcher config (${inv.mode}) — ${inv.ruleCounts.filter} filter / ${inv.ruleCounts.rewrite} rewrite rules → convertible (Branch E)`, severity: 'high' });
    rawFindings.push({ pattern: 'dispatcherConversion', file: root, line: null, snippet: `mode=${inv.mode}` });
  }
  return { ok: true, findings, rawFindings, warnings: [] };
}

module.exports = { detectMode, findConfigRoots, looksLikeDispatcher, hasAmsMarkers, walkFind, buildInventory, runDispatcherScan, readTextFiles, countSectionRules };
