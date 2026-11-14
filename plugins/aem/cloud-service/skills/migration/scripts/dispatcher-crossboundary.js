'use strict';
const fs = require('fs');
const { readTextFiles } = require('./dispatcher-inventory.js');

// A variable NAME is "secret-like" if it reads like a credential. This only
// flags the handoff entry for Branch A's secret handling; values are never read.
const SECRET_RE = /(PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL|PWD)/i;

// Build the Cloud Manager variable handoff artifact from the SOURCE config.
// Scans vhost/conf/rewrite/any files for ${VAR} usages (with line numbers).
// origin = 'config-defined' when the config sets the var to a concrete value
// via `Define NAME <value>` that does NOT self-reference ${NAME}; otherwise
// 'external' (must be provided as a Cloud Manager env var — includes the
// `Define NAME ${NAME}` passthrough). VALUES ARE NEVER EMITTED.
function analyzeCrossBoundary({ configRoot, inventory }) {
  const files = readTextFiles(configRoot, n =>
    n.endsWith('.vhost') || n.endsWith('.vhost.tmpl') || /vhost.*\.conf/.test(n) ||
    n.endsWith('.conf') || n.endsWith('.conf.tmpl') ||
    n.endsWith('.rules') || n.endsWith('.rules.tmpl') ||
    n.endsWith('.any') || n.endsWith('.any.tmpl'));

  const usages = new Map();       // name -> [{path, line}]
  const locallyDefined = new Set(); // names Defined to a concrete (non-self) value

  for (const f of files) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    txt.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('#')) return; // skip full-line comments (both Define + ${VAR} detection)
      const d = line.match(/^\s*Define\s+([A-Z0-9_]+)\s+(.*\S)?\s*$/);
      if (d) {
        const name = d[1], val = d[2] || '';
        if (val && !new RegExp('\\$\\{' + name + '\\}').test(val)) locallyDefined.add(name);
      }
      for (const m of line.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
        const name = m[1];
        if (!usages.has(name)) usages.set(name, []);
        usages.get(name).push({ path: f, line: i + 1 });
      }
    });
  }

  const cmVars = [...usages.entries()].map(([name, files]) => ({
    name,
    files,
    origin: locallyDefined.has(name) ? 'config-defined' : 'external',
    secretLike: SECRET_RE.test(name),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { cmVars };
}

module.exports = { analyzeCrossBoundary };
