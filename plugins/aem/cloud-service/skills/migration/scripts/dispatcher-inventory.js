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

module.exports = { detectMode, findConfigRoots, looksLikeDispatcher, hasAmsMarkers, walkFind };
