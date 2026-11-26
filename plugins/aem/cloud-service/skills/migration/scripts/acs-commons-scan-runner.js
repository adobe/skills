/**
 * ACS AEM Commons Scan Runner
 *
 * The `content-scan` detection tier of the runbook for the **acsCommons** pattern:
 * ACS AEM Commons is a third-party, open-source library, not part of AEM. On a move
 * to AEM as a Cloud Service it is **customer-owned**: the skill reports which version
 * and which features the project uses, with what each feature typically needs on
 * Cloud Service, and **never** changes or upgrades it (customer processes and
 * customisations built on it may break).
 *
 * Four read-only sources, all local:
 *   - pom.xml          `com.adobe.acs:acs-aem-commons-*` dependencies / embeds, with the
 *                      version (a `${property}` is resolved from the same pom) and whether
 *                      the `cloud` classifier is used
 *   - Java             `import com.adobe.acs.commons.<feature>…`, counted per feature
 *   - OSGi configs     `com.adobe.acs.commons.*` PIDs under a config folder, per feature
 *   - Content          `sling:resourceType="acs-commons/…"` in `.content.xml`, with the
 *                      number of Redirect Manager rules
 *
 * Findings are heuristic (text scans, not a build) and grouped per feature, so a project
 * that imports one feature in 200 classes yields one row with a file count.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build', 'out', '.idea', '.vscode']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Feature key (package segment after com.adobe.acs.commons) → label and what it typically
// needs on Cloud Service. Hints are starting points; references/third-party/acs-commons.md
// says to confirm each against the ACS AEM Commons documentation.
const FEATURES = {
  redirects: { label: 'Redirect Manager', hint: 'migrate and verify every redirect rule on Cloud Service' },
  redirectmaps: { label: 'Redirect Map Manager', hint: 'redirect maps usually move to Dispatcher or CDN rewrites; verify each rule' },
  mcp: { label: 'Manage Controlled Processes', hint: 'review each process; long-running bulk jobs need re-testing on Cloud Service' },
  users: { label: 'Ensure Service User', hint: 'typically replaced by repoinit for service users and permissions' },
  oak: { label: 'Ensure Oak Index', hint: 'typically replaced by index definitions deployed under /oak:index' },
  replication: { label: 'Replication / Dispatcher flush utilities', hint: 'Cloud Service has no replication agents (Sling Content Distribution); review flush and replication use' },
  versionedclientlibs: { label: 'Versioned ClientLibs', hint: 'Cloud Service versions client libraries itself; check whether it is still needed' },
  httpcache: { label: 'HTTP Cache', hint: 'Cloud Service relies on the CDN and Dispatcher cache; review' },
  errorpagehandler: { label: 'Error Page Handler', hint: 'check the feature against the ACS Commons Cloud Service documentation' },
  genericlists: { label: 'Generic Lists', hint: 'check the feature against the ACS Commons Cloud Service documentation' },
  workflow: { label: 'Workflow utilities', hint: 'check the feature against the ACS Commons Cloud Service documentation' },
  email: { label: 'Email service', hint: 'outbound email on Cloud Service needs advanced networking; review' },
  util: { label: 'Utilities', hint: 'check the classes used against the ACS Commons Cloud Service documentation' },
};
const DEFAULT_HINT = 'check the feature against the ACS Commons Cloud Service documentation';

/** The feature a class, package or PID under com.adobe.acs.commons belongs to. */
function featureOf(name) {
  const m = /^com\.adobe\.acs\.commons\.([a-z0-9_]+)/i.exec(String(name || ''));
  const key = m ? m[1].toLowerCase() : 'unknown';
  return { key, label: (FEATURES[key] && FEATURES[key].label) || key };
}

const hintOf = (key) => (FEATURES[key] && FEATURES[key].hint) || DEFAULT_HINT;

function walk(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), visit);
    } else if (e.isFile()) {
      visit(path.join(dir, e.name), e.name);
    }
  }
}

function read(file) {
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const tag = (block, name) => {
  const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block);
  return m ? m[1] : '';
};

// pom.xml: <dependency> and <embedded> blocks for com.adobe.acs:acs-aem-commons-*.
function scanPom(file, text, out) {
  const props = {};
  const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)) props[m[1]] = m[2];
  for (const m of text.matchAll(/<(dependency|embedded)>([\s\S]*?)<\/\1>/g)) {
    const block = m[2];
    const artifactId = tag(block, 'artifactId');
    if (tag(block, 'groupId') !== 'com.adobe.acs' || !artifactId.startsWith('acs-aem-commons')) continue;
    const raw = tag(block, 'version');
    const ref = /^\$\{([^}]+)\}$/.exec(raw);
    const version = ref && props[ref[1]] ? props[ref[1]] : raw || '(managed elsewhere)';
    const classifier = tag(block, 'classifier');
    const line = lineAt(text, m.index + m[0].indexOf('<artifactId>'));
    const snippet = `${artifactId} ${version}${classifier ? ` (classifier ${classifier})` : ''}`;
    const cloudNote = artifactId === 'acs-aem-commons-all' && classifier !== 'cloud'
      ? ' — no `cloud` classifier: on AEM as a Cloud Service the `-all` package is used with the `cloud` classifier'
      : '';
    out.findings.push({ location: `${file}:${line}`, detail: `${snippet}${cloudNote}. Version upgrade is customer-owned`, severity: 'medium' });
    out.rawFindings.push({ pattern: 'acsCommons', kind: 'dependency', file, line, artifactId, version, classifier, snippet });
  }
}

/**
 * Scans a workspace for ACS AEM Commons usage. Read-only.
 * @returns {{ok: boolean, findings: object[], rawFindings: object[], warnings: string[], error?: string}}
 */
function runAcsCommonsScan(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], warnings: [], error: 'no workspaceRoot' };
  const out = { findings: [], rawFindings: [] };
  const java = new Map();
  const configs = new Map();
  const components = new Map();
  let redirectRules = 0;
  let redirectFile = null;

  walk(workspaceRoot, (file, name) => {
    if (name === 'pom.xml') {
      const text = read(file);
      if (text && text.includes('com.adobe.acs')) scanPom(file, text, out);
      return;
    }
    if (name.endsWith('.java')) {
      const text = read(file);
      if (!text || !text.includes('com.adobe.acs.commons')) return;
      const seen = new Set();
      for (const m of text.matchAll(/^\s*import\s+(?:static\s+)?(com\.adobe\.acs\.commons\.[\w.]+)/gm)) {
        const { key } = featureOf(m[1]);
        if (seen.has(key)) continue;
        seen.add(key);
        const e = java.get(key) || { count: 0, file, line: lineAt(text, m.index) };
        e.count++;
        java.set(key, e);
      }
      return;
    }
    if (name.startsWith('com.adobe.acs.commons.') && /\/config[^/]*\//.test(file.split(path.sep).join('/'))) {
      const pid = name.replace(/\.(cfg\.json|config|cfg|xml)$/, '');
      const { key } = featureOf(pid);
      const e = configs.get(key) || { count: 0, file, pids: [] };
      e.count++;
      e.pids.push(pid);
      configs.set(key, e);
      return;
    }
    if (name.endsWith('.xml') && file.split(path.sep).includes('jcr_root')) {
      const text = read(file);
      if (!text || !text.includes('acs-commons/')) return;
      for (const m of text.matchAll(/sling:resourceType="(acs-commons\/[^"]+)"/g)) {
        if (m[1].includes('manage-redirects/redirect-row')) {
          redirectRules++;
          redirectFile = redirectFile || file;
          continue;
        }
        const e = components.get(m[1]) || { count: 0, file, line: lineAt(text, m.index) };
        e.count++;
        components.set(m[1], e);
      }
    }
  });

  for (const [key, e] of java) {
    const { label } = featureOf(`com.adobe.acs.commons.${key}`);
    out.findings.push({ location: `${e.file}:${e.line}`, detail: `${label}: imported in ${e.count} Java file(s) — ${hintOf(key)}`, severity: 'medium' });
    out.rawFindings.push({ pattern: 'acsCommons', kind: 'java', feature: key, file: e.file, line: e.line, count: e.count, snippet: `com.adobe.acs.commons.${key}` });
  }
  for (const [key, e] of configs) {
    const { label } = featureOf(`com.adobe.acs.commons.${key}`);
    out.findings.push({ location: e.file, detail: `${label}: ${e.count} OSGi config(s) (${e.pids.slice(0, 3).join(', ')}${e.pids.length > 3 ? ', …' : ''}) — ${hintOf(key)}`, severity: 'medium' });
    out.rawFindings.push({ pattern: 'acsCommons', kind: 'osgi-config', feature: key, file: e.file, line: null, count: e.count, snippet: e.pids[0] });
  }
  if (redirectRules) {
    out.findings.push({ location: redirectFile, detail: `Redirect Manager: ${redirectRules} redirect rule(s) in content — ${hintOf('redirects')}`, severity: 'medium' });
    out.rawFindings.push({ pattern: 'acsCommons', kind: 'content', feature: 'redirects', file: redirectFile, line: null, count: redirectRules, snippet: 'acs-commons/components/utilities/manage-redirects/redirect-row' });
  }
  for (const [type, e] of components) {
    out.findings.push({ location: `${e.file}:${e.line}`, detail: `ACS Commons component \`${type}\` used ${e.count} time(s) in content — ${DEFAULT_HINT}`, severity: 'medium' });
    out.rawFindings.push({ pattern: 'acsCommons', kind: 'content', feature: type, file: e.file, line: e.line, count: e.count, snippet: type });
  }
  return { ok: true, findings: out.findings, rawFindings: out.rawFindings, warnings: [] };
}

const ACS_NAME = /^(com\.adobe\.acs\.|acscommons\.)|acs-aem-commons/;

/** True when a BPA target's class, file or bundle belongs to ACS AEM Commons itself. */
function isAcsCommonsTarget(t) {
  return [t.className, t.filePath, t.bundle].some(v => typeof v === 'string' && ACS_NAME.test(v));
}

/**
 * Group BPA targets raised against ACS AEM Commons into one informational row per
 * (BPA pattern, bundle). The same rows stay in their own pattern's section; here they
 * only tell the delivery team the extra customer-owned work, so they are not counted twice.
 *
 * @param {Array<{pattern: string, target: object}>} entries
 */
function linkAcsBpaFindings(entries) {
  const groups = new Map();
  for (const { pattern, target } of entries) {
    const location = target.bundle || target.className || target.filePath;
    const key = `${pattern}|${location}`;
    const g = groups.get(key) || { pattern, location, count: 0, ids: new Set() };
    g.count++;
    if (target.identifier) g.ids.add(target.identifier);
    groups.set(key, g);
  }
  const findings = [];
  const rawFindings = [];
  for (const g of groups.values()) {
    const ids = [...g.ids].join(', ');
    findings.push({
      location: g.location,
      detail: `BPA \`${g.pattern}\`${ids ? ` (${ids})` : ''}: ${g.count} finding(s) in ACS AEM Commons — third-party, customer-owned; plan it with the ACS Commons upgrade, the migration skill does not change it`,
      severity: 'medium',
      informational: true,
    });
    rawFindings.push({ pattern: 'acsCommons', kind: 'bpa', bpaPattern: g.pattern, file: g.location, line: null, count: g.count, snippet: ids || null });
  }
  return { findings, rawFindings };
}

module.exports = { runAcsCommonsScan, featureOf, FEATURES, isAcsCommonsTarget, linkAcsBpaFindings };

// CLI: node acs-commons-scan-runner.js <workspaceRoot> → findings as JSON, paths relative to the root.
if (require.main === module) {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node acs-commons-scan-runner.js <workspaceRoot>');
    process.exit(2);
  }
  const abs = path.resolve(root);
  const res = runAcsCommonsScan(abs);
  const rel = (v) => (typeof v === 'string' && v.startsWith(abs + path.sep) ? v.slice(abs.length + 1) : v);
  res.findings = res.findings.map((f) => ({ ...f, location: rel(f.location) }));
  res.rawFindings = res.rawFindings.map((f) => ({ ...f, file: rel(f.file) }));
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
}
