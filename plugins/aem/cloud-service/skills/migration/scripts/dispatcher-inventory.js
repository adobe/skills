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
  // A dispatcher config root does not contain another dispatcher config: once a dir is
  // identified as a root, push it and return WITHOUT recursing into its children. This fixes
  // the flexible-tree double-add (`conf.d/dispatcher.any` made both <root> and <root>/conf.d
  // match). Only `not-dispatcher` dirs are recursed, so nested configs (workspace/project/
  // dispatcher/src) still resolve — the intermediate dirs are not-dispatcher until the root.
  if (detectMode(workspaceRoot) !== 'not-dispatcher') { acc.push(workspaceRoot); return acc; }
  let es; try { es = fs.readdirSync(workspaceRoot, { withFileTypes: true }); } catch { return acc; }
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
      if (e.isDirectory() && !['node_modules', '.git', 'target', 'dist'].includes(e.name)) rec(f, depth + 1);
      else if (e.isFile() && pred(e.name)) out.push(f);
    }
  })(dir, 0);
  return out;
}

// Count farm-rule blocks like `/0001 { /type ... }` inside a `/filter` section of any dispatcher.any/farm.
function countSectionRules(files, section) {
  let n = 0;
  for (const f of files) {
    let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    // Strip full-line `#` comments from the whole file BEFORE the opener regex so a commented
    // `# /filter { … }` can't be matched and have its body inflate the baseline. The extracted
    // body is now already comment-free, so no inner body-level comment filter is needed.
    const txt = raw.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    const secRe = new RegExp('/' + section + '\\s*\\{', 'g');
    let m;
    while ((m = secRe.exec(txt))) {
      // scan balanced braces from the section open, count `/<label> {` entries within.
      // Broadened from `/[0-9]{3,4}` so non-4-digit ACL labels (/01, /10001, /allow-html) count —
      // under-counting disables the fail-closed ACL gate; any over-match is the safe direction.
      const body = extractBraceBody(txt, m.index + m[0].length - 1);
      n += (body.match(/\/[\w.-]+\s*\{/g) || []).length;
    }
  }
  return n;
}

// Count quoted-string entries (like "Cookie", "*.example.com") inside a section like `/clientheaders` or `/virtualhosts`.
function countQuotedEntries(files, section) {
  let n = 0;
  for (const f of files) {
    let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    // Strip full-line `#` comments up-front so a commented `# /clientheaders { … }` opener
    // can't match and inflate the count; body lines are then already comment-free.
    const txt = raw.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    const secRe = new RegExp('/' + section + '\\s*\\{', 'g');
    let m;
    while ((m = secRe.exec(txt))) {
      const body = extractBraceBody(txt, m.index + m[0].length - 1);
      const lines = body.split('\n');
      n += lines.filter(l => /^\s*"[^"]*"\s*$/.test(l)).length;
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

// Extract every `/<section> { ... }` body in each file (comment-stripped), paired with the
// file it came from — the pairing lets a caller resolve a `$include "path"` found INSIDE the
// body relative to the file that actually contains it, not the config root.
function extractSectionBodies(files, section) {
  const out = [];
  for (const f of files) {
    let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const txt = raw.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    const secRe = new RegExp('/' + section + '\\s*\\{', 'g');
    let m;
    while ((m = secRe.exec(txt))) out.push({ body: extractBraceBody(txt, m.index + m[0].length - 1), file: f });
  }
  return out;
}

// Dispatcher `$include` paths are relative to the file containing the directive (an absolute
// container path is returned as-is; it may not be resolvable from a migration workspace).
function resolveIncludePath(includingFile, includePath) {
  return path.isAbsolute(includePath) ? includePath : path.resolve(path.dirname(includingFile), includePath);
}

// Count `/<label> { ... }` rule entries in a section body, resolving any `$include "path"`
// found INSIDE the body to its ACTUAL target file — not a naming guess — and counting that
// file's content too, recursively (an include chain a→b→c is fully walked, not just one hop).
// `visited` dedupes files already counted (the same include shared by two farms is counted
// once); `unresolved` collects include targets that could not be read from disk (an absolute
// container path, a glob like `./*.farm`, or a genuinely missing file) so the caller can flag
// "this count may be incomplete" instead of silently treating an unreadable include as zero.
function countRulesInBody(body, includingFile, visited, unresolved) {
  let n = (body.match(/\/[\w.-]+\s*\{/g) || []).length;
  const includeRe = /\$include\s+"([^"]+)"/g;
  let m;
  while ((m = includeRe.exec(body))) {
    const target = resolveIncludePath(includingFile, m[1]);
    if (visited.has(target)) continue;
    visited.add(target);
    let txt;
    try { txt = fs.readFileSync(target, 'utf8'); }
    catch { unresolved.push(target); continue; }
    const clean = txt.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    n += countRulesInBody(clean, target, visited, unresolved);
  }
  return n;
}

// Count filter/ACL rules for the whole config tree by resolving the config's ACTUAL `$include`
// graph starting from every `/filter { ... }` section (in dispatcher.any / *.farm / *_farm.any) —
// not by guessing from file names. Counting only inline bodies is the confirmed false-negative:
// a config whose filters are `$include`'d reports 0 filter rules, so the ACL hard gate in
// verifyOutput silently passes on empty output. buildInventory (baseline) and verifyOutput
// (output) MUST call this so both sides count the same way.
//
// A standalone file matching the naming convention (`filters.any`, `*_filters.any`, or living
// in a `filters/` directory) is used ONLY as a residual safety net for files that exist on disk
// but were never reached via a resolvable `$include` above (an orphaned-but-still-wired-in file,
// or a fixture that writes the file directly) — files already visited via a real `$include` are
// skipped here, so a real include target is never double-counted. Adobe-managed immutable SDK
// files (basename starting `default_`, e.g. `default_filters.any`) are excluded everywhere: they
// are fresh SDK boilerplate, never the customer's at-risk custom ACLs — counting them would let
// a populated SDK default mask an emptied custom `filters.any` (the count would stay non-zero so
// filter-acl-loss never fires). Excluding them makes the count custom-to-custom.
//
// `unresolvedOut`, if passed, is populated with every `$include` target that could not be read
// from disk — a non-empty list means this count may be under-reported, and the caller should
// surface that rather than silently trusting a `0`.
function countFilterRules(root, anyFarms, unresolvedOut) {
  if (!anyFarms) {
    const dispAny = readTextFiles(root, n => n === 'dispatcher.any' || n === 'dispatcher.any.tmpl');
    const farmFiles = readTextFiles(root, n => n.endsWith('.farm') || n.endsWith('_farm.any'));
    anyFarms = dispAny.concat(farmFiles);
  }
  const visited = new Set();
  const unresolved = [];

  // (a) Walk every inline `/filter { ... }` body and resolve its real $include graph.
  let n = 0;
  for (const { body, file } of extractSectionBodies(anyFarms, 'filter')) {
    n += countRulesInBody(body, file, visited, unresolved);
  }

  // (b) Residual safety net: standalone filter-named files not already reached via a resolvable
  //     $include above. readTextFiles passes ONLY the basename to the predicate, so collect
  //     .any files first, then filter by path.dirname for the `filters/`-dir check.
  const standalone = readTextFiles(root, name => name.endsWith('.any')).filter(f => {
    if (visited.has(f)) return false; // already counted via a real $include — avoid double counting
    const base = path.basename(f);
    if (base === 'dispatcher.any' || base === 'dispatcher.any.tmpl' || base.endsWith('_farm.any')) return false; // already in anyFarms
    if (base.startsWith('default_')) return false; // Adobe-managed immutable SDK boilerplate (default_filters.any, …) — never the customer's custom ACLs; counting it lets a surviving default mask dropped custom rules.
    return base === 'filters.any' || base.endsWith('_filters.any') || path.basename(path.dirname(f)) === 'filters';
  });
  for (const f of standalone) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const filtered = txt.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    // Broadened from `/[0-9]{3,4}` so non-4-digit / non-numeric ACL labels (/01, /10001,
    // /allow-html) are counted — under-counting would let an emptied output pass the gate.
    n += (filtered.match(/\/[\w.-]+\s*\{/g) || []).length;
  }

  if (unresolvedOut) unresolvedOut.push(...unresolved);
  return n;
}

// Count Apache RewriteRule / RedirectMatch directives across a config tree. ONE shared
// counter so inventory (source baseline), verifyOutput (gate warning), and the coverage
// report count rewrites identically — preventing the divergence that let the report and the
// verify warning disagree.
//   opts.includeTmpl:    also scan .rules.tmpl / vhost*.conf source templates (source trees are
//                        templated; resolved output has none). Default false.
//   opts.excludeDefault: skip Adobe-managed default_* immutables (e.g. default_rewrite.rules) so
//                        a surviving SDK default can't mask dropped custom rewrites. Default false.
function countRewrites(root, opts = {}) {
  const { includeTmpl = false, excludeDefault = false } = opts;
  const files = readTextFiles(root, n => {
    if (excludeDefault && n.startsWith('default_')) return false;
    if (n.endsWith('.rules') || n.endsWith('.vhost')) return true;
    if (includeTmpl && (n.endsWith('.rules.tmpl') || /vhost.*\.conf/.test(n))) return true;
    return false;
  });
  let count = 0;
  for (const f of files) {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    count += (t.match(/^\s*(RewriteRule|Redirect(Match)?)\b/gm) || []).length;
  }
  return count;
}

function buildInventory(root) {
  const mode = detectMode(root);
  const dispAny = readTextFiles(root, n => n === 'dispatcher.any' || n === 'dispatcher.any.tmpl');
  const farmFiles = readTextFiles(root, n => n.endsWith('.farm') || n.endsWith('_farm.any'));
  const anyFarms = dispAny.concat(farmFiles);
  const vhostFiles = readTextFiles(root, n => n.endsWith('.vhost') || /vhost.*\.conf/.test(n));
  const httpd = readTextFiles(root, n => n === 'httpd.conf' || n === 'httpd.conf.tmpl')[0] || null;
  const tmplUsage = readTextFiles(root, n => n.endsWith('.tmpl')).length > 0;

  // Same file set the old two-reduce block scanned (.rules + .rules.tmpl + .vhost + vhost*.conf),
  // now via the shared counter so the source baseline stays identical.
  const rewriteCount = countRewrites(root, { includeTmpl: true });

  const cmVarCandidates = [];
  for (const f of vhostFiles.concat(readTextFiles(root, n => n.endsWith('.conf') || n.endsWith('.conf.tmpl')))) {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const body = t.split('\n').filter(l => !l.trim().startsWith('#')).join('\n'); // skip full-line comments so a `# ${OLD}` isn't a phantom var
    for (const m of body.matchAll(/\$\{([A-Z0-9_]+)\}/g)) if (!cmVarCandidates.includes(m[1])) cmVarCandidates.push(m[1]);
  }

  const filterIncludesUnresolved = [];

  return {
    mode, configRoot: root,
    dispatcherAny: dispAny[0] || null, httpd,
    vhostFiles, farmFiles,
    ruleCounts: {
      filter: countFilterRules(root, anyFarms, filterIncludesUnresolved),
      // Non-empty means an $include target (an absolute container path, a glob, or a missing
      // file) could not be read, so `filter` above may be under-counted — surface this rather
      // than silently trusting the number. Flows through to verifyOutput via the baseline object.
      filterIncludesUnresolved,
      rewrite: rewriteCount,
      cache: countSectionRules(anyFarms, 'rules'),
      clientheader: countQuotedEntries(anyFarms, 'clientheaders'),
      virtualhost: countQuotedEntries(anyFarms, 'virtualhosts'),
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

module.exports = { detectMode, findConfigRoots, looksLikeDispatcher, hasAmsMarkers, walkFind, buildInventory, runDispatcherScan, readTextFiles, countSectionRules, countQuotedEntries, countFilterRules, countRewrites };
