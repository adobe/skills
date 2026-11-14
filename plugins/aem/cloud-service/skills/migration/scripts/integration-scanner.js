/**
 * Integration Scanner
 *
 * The `integration-scan` strategy behind the runbook's `integrationDiscovery`
 * concern: a read-only, deterministic inventory of the external integrations a
 * customer's AEM codebase uses. Detection only — no remediation, no endpoint is
 * ever contacted, no customer code is executed or modified.
 *
 * Signatures live in `references/integrations/catalog.json`; scanner
 * behaviour, the confidence rules, and the privacy rules are documented in
 * `references/integrations/discovery.md`.
 *
 * PRIVACY RULE: evidence carries only file path, line, signal type/id and the
 * catalog's static `indicator` text — never the matched source text, URL, or
 * any value. Unknown external hosts are reduced to a SHA-256 fingerprint plus
 * their top-level domain.
 *
 * Usage (CLI): node scripts/integration-scanner.js <workspaceRoot> [--catalog <file>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stripCommentsAndStrings } = require('./input-stream-runner.js');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'references', 'integrations', 'catalog.json');
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EVIDENCE_PER_INTEGRATION = 100;
const MINIFIED_LINE_LENGTH = 2000;

const SKIP_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'target', 'dist', 'build', 'out', 'coverage',
]);
// Test, sample and documentation trees are not deployed application code.
const NON_RUNTIME_DIRS = new Set(['__tests__', '__mocks__', 'tests', 'ui.tests', 'it.tests', 'docs', 'doc', 'samples', 'examples']);

const KIND_GROUPS = {
  code: ['java', 'js'],
  markup: ['htl'],
  config: ['osgi-json', 'osgi-config', 'properties', 'json', 'xml', 'yaml'],
  dispatcher: ['dispatcher'],
};
KIND_GROUPS['*'] = [].concat(KIND_GROUPS.code, KIND_GROUPS.markup, KIND_GROUPS.config, KIND_GROUPS.dispatcher);

const STRENGTHS = ['strong', 'supporting', 'contextual', 'dependency'];
const STRENGTH_RANK = { strong: 4, supporting: 3, dependency: 2, contextual: 1 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };
const CATEGORY_ORDER = ['adobe-product', 'third-party', 'customer-external'];

const EVIDENCE_TYPE_LABELS = {
  'java-import': 'Java import',
  'maven-dependency': 'Maven dependency',
  'npm-dependency': 'npm dependency',
  endpoint: 'Endpoint reference',
  'osgi-config': 'OSGi / cloud configuration',
  'config-key': 'Configuration key',
  'script-reference': 'JavaScript reference',
  'markup-reference': 'Markup reference',
  'http-header': 'HTTP header',
  'resource-type': 'Resource type',
  'env-var': 'Environment variable',
  'http-client-endpoint': 'Java HTTP client + external URL',
  'soap-client-endpoint': 'Java SOAP client + external URL',
  'js-http-endpoint': 'JavaScript HTTP call + external URL',
  'osgi-endpoint-config': 'OSGi endpoint property',
};

const URL_RE = /\bhttps?:\/\/(?:[^\s"'<>@/]*@)?(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)/g;
const PLACEHOLDER_NEXT = new Set(['$', '{', '%', '<', '-', '+', '\\']);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// ── Catalog ──────────────────────────────────────────────────────────────────

function compile(pattern, flags, where) {
  try {
    return new RegExp(pattern, flags || '');
  } catch (err) {
    throw new Error(`invalid regex in ${where}: ${err.message}`);
  }
}

/** Load and validate the catalog; regexes are compiled once. Throws on an invalid catalog. */
function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!raw || !Array.isArray(raw.integrations)) throw new Error('catalog has no integrations[]');
  const seenIntegrations = new Set();
  const seenSignals = new Set();
  const integrations = raw.integrations.map(integ => {
    if (!integ.id || seenIntegrations.has(integ.id)) throw new Error(`duplicate or missing integration id: ${integ.id}`);
    seenIntegrations.add(integ.id);
    if (!CATEGORY_ORDER.includes(integ.category)) throw new Error(`unknown category for ${integ.id}: ${integ.category}`);
    const signals = (integ.signals || []).map(s => {
      const where = `${integ.id}/${s.id}`;
      if (!s.id || seenSignals.has(s.id)) throw new Error(`duplicate or missing signal id: ${where}`);
      seenSignals.add(s.id);
      if (!STRENGTHS.includes(s.strength)) throw new Error(`unknown strength for ${where}: ${s.strength}`);
      if (!s.indicator) throw new Error(`missing indicator for ${where}`);
      const sig = { ...s, integrationId: integ.id };
      if (s.type === 'maven-dependency') {
        sig.groupRe = compile(s.groupId, '', where);
        sig.artifactRe = compile(s.artifactId, '', where);
      } else if (s.type === 'npm-dependency') {
        sig.packageRe = compile(s.package, '', where);
      } else {
        if (!s.pattern && !s.pathPattern) throw new Error(`signal has no pattern: ${where}`);
        if (s.pattern) sig.re = compile(s.pattern, s.flags, where);
        if (s.pathPattern) sig.pathRe = compile(s.pathPattern, s.flags, where);
        sig.kindSet = new Set([].concat(...(s.kinds || ['*']).map(k => KIND_GROUPS[k] || [k])));
      }
      return sig;
    });
    return { ...integ, minDistinctSignals: integ.minDistinctSignals || 1, signals };
  });
  const g = raw.genericExternalApi || {};
  const generic = {
    ...g,
    javaHttpRe: compile(g.javaHttpClientPattern, '', 'genericExternalApi.javaHttpClientPattern'),
    javaSoapRe: compile(g.javaSoapClientPattern, '', 'genericExternalApi.javaSoapClientPattern'),
    jsHttpRe: compile(g.jsHttpClientPattern, '', 'genericExternalApi.jsHttpClientPattern'),
    endpointKeyRe: compile(g.endpointKeyPattern, 'i', 'genericExternalApi.endpointKeyPattern'),
    soapUrlRe: compile(g.soapUrlPattern, 'i', 'genericExternalApi.soapUrlPattern'),
    ignoreHosts: new Set((g.ignoreHosts || []).map(h => h.toLowerCase())),
    ignoreHostSuffixes: g.ignoreHostSuffixes || [],
    ignoreConfigPids: g.ignoreConfigPids || [],
  };
  return {
    version: raw.version,
    categories: raw.categories || {},
    considerations: raw.considerations || {},
    integrations,
    generic,
  };
}

// ── File discovery ───────────────────────────────────────────────────────────

/** Map a file name to the scanner's file kind, or null when not scanned. */
function fileKind(name) {
  const n = name.toLowerCase();
  if (n === 'pom.xml') return 'pom';
  if (n === 'package.json') return 'package-json';
  if (n === 'package-lock.json' || n === 'npm-shrinkwrap.json') return null;
  if (n.endsWith('.cfg.json')) return 'osgi-json';
  if (n.endsWith('.config') || n.endsWith('.cfg')) return 'osgi-config';
  if (n.endsWith('.properties')) return 'properties';
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.xml')) return 'xml';
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'yaml';
  if (/\.min\.js$|\.d\.ts$/.test(n)) return null;
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(n)) return 'js';
  if (/\.(?:html|htm|jsp|jspf)$/.test(n)) return 'htl';
  if (n.endsWith('.java')) return 'java';
  if (/\.(?:any|vhost|farm|rules|conf|vcl)$/.test(n)) return 'dispatcher';
  return null;
}

function isSkippedDir(name, parentName) {
  if (name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name) || NON_RUNTIME_DIRS.has(name)) return true;
  // src/test, src/it — Maven test sources.
  return parentName === 'src' && (name === 'test' || name === 'it');
}

/** Collect `{abs, rel, kind}` for every scannable file. Symlinks are not followed. */
function collectFiles(root, warnings) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push(`integration-scan: could not read directory \`${toRel(root, dir) || '.'}\` (${err.code || 'error'}) — its files were not scanned`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name, path.basename(dir))) walk(abs);
      } else if (e.isFile()) {
        const kind = fileKind(e.name);
        if (kind) files.push({ abs, rel: toRel(root, abs), kind });
      }
    }
  };
  walk(root);
  return files;
}

function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// ── Text preparation (comment removal, keeps offsets and line numbers) ──────

const blankKeepNewlines = m => m.replace(/[^\r\n]/g, ' ');

function stripMarkupComments(src) {
  return src.replace(/<!--[\s\S]*?-->|<%--[\s\S]*?--%>/g, blankKeepNewlines);
}

function stripHashComments(src, { inline }) {
  const lineComments = src.replace(/^[ \t]*[#!].*$/gm, blankKeepNewlines);
  return inline ? lineComments.replace(/[ \t]#.*$/gm, blankKeepNewlines) : lineComments;
}

/**
 * Comment-free text for matching plus any malformation reason. Strings are kept
 * (endpoints live in string literals); comments are blanked so commented-out
 * code and documentation snippets never count as evidence.
 */
function prepareText(kind, src) {
  let text;
  let malformed = null;
  switch (kind) {
    case 'java':
      text = stripCommentsAndStrings(src, { keepStrings: true });
      break;
    case 'js':
      // Template literals become plain strings so a `//` inside one is not read as a comment.
      text = stripCommentsAndStrings(src.replace(/`/g, '"'), { keepStrings: true });
      break;
    case 'json':
    case 'osgi-json':
    case 'package-json':
      text = stripCommentsAndStrings(src, { keepStrings: true });
      try { JSON.parse(text); } catch (err) { malformed = 'malformed JSON'; }
      break;
    case 'xml':
    case 'pom':
    case 'htl': {
      const opens = (src.match(/<!--/g) || []).length;
      const closes = (src.match(/-->/g) || []).length;
      if (opens > closes) malformed = 'unterminated XML/HTML comment';
      text = stripMarkupComments(src);
      if (kind === 'pom' && !/<project[\s>]/.test(text)) malformed = malformed || 'no <project> root element';
      break;
    }
    case 'yaml':
    case 'dispatcher':
      text = stripHashComments(src, { inline: true });
      break;
    default:
      text = stripHashComments(src, { inline: false });
  }
  return { text, malformed };
}

// Bundled clientlib output (e.g. ui.frontend webpack builds copied into ui.apps) inlines vendor libraries.
function isMinified(raw) {
  return raw.split('\n').some(l => l.length > MINIFIED_LINE_LENGTH);
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ── Signal matching ──────────────────────────────────────────────────────────

/** Maven `<dependency>` coordinates with the line each block starts on. */
function mavenDependencies(text) {
  const starts = lineStarts(text);
  const deps = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(m[1]);
    const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(m[1]);
    if (g && a) deps.push({ groupId: g[1], artifactId: a[1], line: lineOf(starts, m.index) });
  }
  const opens = (text.match(/<dependency>/g) || []).length;
  const closes = (text.match(/<\/dependency>/g) || []).length;
  return { deps, unbalanced: opens !== closes };
}

/** Runtime `dependencies` of a package.json (devDependencies are build tooling). */
function npmDependencies(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch (err) { return []; }
  const names = Object.keys((pkg && pkg.dependencies) || {}).concat(Object.keys((pkg && pkg.peerDependencies) || {}));
  const lines = text.split('\n');
  return names.map(name => {
    const idx = lines.findIndex(l => l.includes(`"${name}"`));
    return { name, line: idx === -1 ? null : idx + 1 };
  });
}

function osgiPid(rel) {
  const base = path.posix.basename(rel);
  const name = base === '.content.xml' ? path.posix.basename(path.posix.dirname(rel)) : base;
  return name.replace(/\.(?:cfg\.json|config|cfg|xml)$/i, '').split('~')[0];
}

function isOsgiConfigFile(kind, rel, raw) {
  if (kind === 'osgi-json' || kind === 'osgi-config') return true;
  return kind === 'xml' && /jcr:primaryType\s*=\s*"sling:OsgiConfig"/.test(raw);
}

function hostIsIgnored(host, generic) {
  if (!host.includes('.') && !host.startsWith('[')) return true; // dotless: container/local names
  if (host === 'localhost' || host.startsWith('127.') || host === '0.0.0.0' || host === '[::1]') return true;
  if (generic.ignoreHostSuffixes.some(s => host.endsWith(s))) return true;
  for (const h of generic.ignoreHosts) if (host === h || host.endsWith('.' + h)) return true;
  return false;
}

function isPrivateHost(host) {
  if (IPV4_RE.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /\.(?:local|internal|corp|lan|intranet)$/.test(host);
}

/** External hosts referenced on a line (placeholders and ignored hosts dropped). */
function externalUrls(line, generic) {
  const out = [];
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(line)) !== null) {
    const host = m[1].toLowerCase();
    const next = line[m.index + m[0].length];
    if (next && PLACEHOLDER_NEXT.has(next)) continue;
    if (hostIsIgnored(host, generic)) continue;
    const rest = line.slice(m.index + m[0].length).split(/[\s"'<>]/)[0];
    const port = /^:(\d{1,5})(?!\d)/.exec(rest);
    out.push({
      host,
      offset: m.index,
      soapHint: generic.soapUrlRe.test(rest),
      // AEMaaCS egress allows only 80/443 without advanced networking (flexible port egress).
      nonStandardPort: !!port && port[1] !== '80' && port[1] !== '443',
    });
  }
  return out;
}

const KEY_BEFORE_RE = /([A-Za-z0-9_.:-]+)["']?\s*[:=]\s*["']?\[?\s*["']?(?:\{[A-Za-z]+\})?\[?["']?\s*$/;
const LINE_KEY_RE = /^\s*["']?([A-Za-z0-9_.:-]+)["']?\s*[:=]/;

function safeKey(key) {
  return String(key || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);
}

/**
 * Scan one prepared file. Pushes catalog matches and generic-endpoint
 * candidates; matched text is never retained.
 */
function scanFile(file, raw, text, catalog, sink) {
  const { rel, kind } = file;
  const lines = text.split('\n');

  if (kind === 'pom') {
    const { deps, unbalanced } = mavenDependencies(text);
    if (unbalanced) sink.warnings.push(`integration-scan: unbalanced <dependency> elements in \`${rel}\` — dependency evidence for this file may be incomplete`);
    for (const dep of deps) {
      for (const integ of catalog.integrations) {
        for (const sig of integ.signals) {
          if (sig.type !== 'maven-dependency') continue;
          if (sig.groupRe.test(dep.groupId) && sig.artifactRe.test(dep.artifactId)) {
            sink.matches.push({ sig, file: rel, line: dep.line });
          }
        }
      }
    }
    return;
  }

  if (kind === 'package-json') {
    for (const dep of npmDependencies(text)) {
      for (const integ of catalog.integrations) {
        for (const sig of integ.signals) {
          if (sig.type === 'npm-dependency' && sig.packageRe.test(dep.name)) {
            sink.matches.push({ sig, file: rel, line: dep.line });
          }
        }
      }
    }
    return;
  }

  for (const integ of catalog.integrations) {
    for (const sig of integ.signals) {
      if (sig.pathRe && sig.pathRe.test(rel)) sink.matches.push({ sig, file: rel, line: null });
      if (!sig.re || !sig.kindSet.has(kind)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (sig.re.test(lines[i])) sink.matches.push({ sig, file: rel, line: i + 1 });
      }
    }
  }

  const generic = catalog.generic;
  let genericType = null;
  let soapClient = false;
  if (kind === 'java') {
    soapClient = generic.javaSoapRe.test(text);
    if (soapClient) genericType = 'soap-client-endpoint';
    else if (generic.javaHttpRe.test(text)) genericType = 'http-client-endpoint';
  } else if (kind === 'js') {
    if (generic.jsHttpRe.test(text)) genericType = 'js-http-endpoint';
  }

  const osgi = isOsgiConfigFile(kind, rel, raw);
  if (osgi) {
    const pid = osgiPid(rel);
    if (generic.ignoreConfigPids.some(p => pid === p || (p.endsWith('.') && pid.startsWith(p)))) return;
  }
  if (!genericType && !osgi) return;

  let lastKey = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineKey = LINE_KEY_RE.exec(line);
    if (lineKey) lastKey = lineKey[1];
    for (const url of externalUrls(line, generic)) {
      if (genericType) {
        sink.generic.push({
          host: url.host, type: genericType, soap: soapClient || url.soapHint, nonStandardPort: url.nonStandardPort,
          file: rel, line: i + 1, indicator: EVIDENCE_TYPE_LABELS[genericType],
        });
        continue;
      }
      const before = KEY_BEFORE_RE.exec(line.slice(0, url.offset));
      const key = before ? before[1] : lastKey;
      if (!key || !generic.endpointKeyRe.test(key)) continue;
      sink.generic.push({
        host: url.host, type: 'osgi-endpoint-config', soap: url.soapHint, nonStandardPort: url.nonStandardPort,
        file: rel, line: i + 1, indicator: `OSGi property \`${safeKey(key)}\``,
      });
    }
  }
}

// ── Aggregation and confidence ───────────────────────────────────────────────

/**
 * Deterministic confidence from DISTINCT signal ids (not occurrence counts):
 *   - contextual signals never establish an integration on their own;
 *   - dependency-only evidence is at most a `low` candidate;
 *   - high   = at least one strong signal, corroborated by another distinct signal;
 *   - medium = one uncorroborated strong signal, or a supporting signal plus
 *              another distinct signal;
 *   - low    = a single supporting signal, or dependency-only evidence.
 * Returns null when the integration must not be reported.
 */
function scoreConfidence(counts, minDistinctSignals = 1) {
  const { strong = 0, supporting = 0, contextual = 0, dependency = 0 } = counts;
  const distinct = strong + supporting + contextual + dependency;
  if (distinct < minDistinctSignals) return null;
  if (strong + supporting === 0) return dependency > 0 ? 'low' : null;
  if (strong >= 1) return distinct >= 2 ? 'high' : 'medium';
  return distinct >= 2 ? 'medium' : 'low';
}

/** Keep only the strongest signal per integration per file+line; dedupe evidence. */
function strongestPerLine(matches) {
  const best = new Map();
  for (const m of matches) {
    const key = `${m.integrationId}\u0000${m.file}\u0000${m.line}`;
    const cur = best.get(key);
    if (!cur || STRENGTH_RANK[m.strength] > STRENGTH_RANK[cur.strength]
      || (STRENGTH_RANK[m.strength] === STRENGTH_RANK[cur.strength] && m.signal < cur.signal)) {
      best.set(key, m);
    }
  }
  return [...best.values()];
}

function compareEvidence(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const la = a.line == null ? 0 : a.line;
  const lb = b.line == null ? 0 : b.line;
  if (la !== lb) return la - lb;
  return a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0;
}

function buildRecord(base, evidenceRows) {
  const counts = { strong: 0, supporting: 0, contextual: 0, dependency: 0 };
  const signalIds = new Map();
  for (const e of evidenceRows) signalIds.set(e.signal, e.strength);
  for (const s of signalIds.values()) counts[s]++;
  const confidence = scoreConfidence(counts, base.minDistinctSignals);
  if (!confidence) return null;
  const evidence = evidenceRows.slice().sort(compareEvidence).map(e => ({
    type: e.type, signal: e.signal, strength: e.strength, file: e.file, line: e.line, indicator: e.indicator,
  }));
  const record = {
    id: base.id,
    name: base.name,
    category: base.category,
    confidence,
    status: confidence === 'low' ? 'candidate' : 'detected',
    signals: [...signalIds.keys()].sort(),
    evidenceCount: evidence.length,
    evidence: evidence.slice(0, MAX_EVIDENCE_PER_INTEGRATION),
    migrationConsiderations: base.migrationConsiderations.slice(),
  };
  if (base.group) record.group = base.group;
  if (base.extra) Object.assign(record, base.extra);
  if (evidence.length > MAX_EVIDENCE_PER_INTEGRATION) record.evidenceTruncated = true;
  return record;
}

function hostFingerprint(host) {
  return crypto.createHash('sha256').update(host).digest('hex').slice(0, 8);
}

function hostHint(host) {
  if (IPV4_RE.test(host) || host.startsWith('[')) return 'ip-address';
  return `*.${host.split('.').pop()}`;
}

function compareRecords(a, b) {
  const ca = CATEGORY_ORDER.indexOf(a.category);
  const cb = CATEGORY_ORDER.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  if (a.confidence !== b.confidence) return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function aggregate(catalog, sink) {
  const rows = strongestPerLine(sink.matches.map(m => ({
    integrationId: m.sig.integrationId,
    type: m.sig.type,
    signal: m.sig.id,
    strength: m.sig.strength,
    file: m.file,
    line: m.line,
    indicator: m.sig.indicator,
  })));

  const records = [];
  const attributedLines = new Set();
  for (const integ of catalog.integrations) {
    const mine = rows.filter(r => r.integrationId === integ.id);
    if (mine.length === 0) continue;
    const rec = buildRecord(integ, mine);
    if (!rec) continue;
    records.push(rec);
    for (const r of mine) attributedLines.add(`${r.file}\u0000${r.line}`);
  }

  // Generic endpoints on a line already attributed to a reported integration are not double-counted.
  const byHost = new Map();
  for (const g of sink.generic) {
    if (attributedLines.has(`${g.file}\u0000${g.line}`)) continue;
    if (!byHost.has(g.host)) byHost.set(g.host, []);
    byHost.get(g.host).push(g);
  }
  const ge = catalog.generic;
  for (const [host, hits] of byHost) {
    const fp = hostFingerprint(host);
    const soap = hits.some(h => h.soap);
    const isPrivate = isPrivateHost(host);
    const evidenceRows = [];
    const seen = new Set();
    for (const h of hits) {
      const key = `${h.file}\u0000${h.line}\u0000${h.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidenceRows.push({ type: h.type, signal: h.type, strength: 'supporting', file: h.file, line: h.line, indicator: h.indicator });
    }
    const considerations = (ge.migrationConsiderations || []).slice();
    if (isPrivate) considerations.push('private-connectivity');
    if (hits.some(h => h.nonStandardPort)) considerations.push('non-standard-port');
    const rec = buildRecord({
      id: `external-api-${fp}`,
      name: `${ge.name || 'Custom External API'} (${soap ? 'SOAP' : 'HTTP/REST'})`,
      category: ge.category || 'customer-external',
      minDistinctSignals: 1,
      migrationConsiderations: considerations,
      extra: {
        protocol: soap ? 'soap' : 'http',
        host: { fingerprint: `sha256:${fp}`, hint: hostHint(host), private: isPrivate },
      },
    }, evidenceRows);
    if (rec) records.push(rec);
  }

  return records.sort(compareRecords);
}

// ── Entry point ──────────────────────────────────────────────────────────────

function emptyResult(status, warnings, extra = {}) {
  return {
    ok: status !== 'not-run',
    strategy: 'integration-scan',
    status,
    summary: { total: 0, known: 0, unknown: 0, detected: 0, candidates: 0, byConfidence: { high: 0, medium: 0, low: 0 }, filesScanned: 0, minifiedSkipped: 0 },
    integrations: [],
    warnings,
    ...extra,
  };
}

/**
 * Scan `workspaceRoot` for integrations.
 *
 * @param {string} workspaceRoot
 * @param {{ catalogPath?: string, catalog?: object }} [options]
 * @returns {{ ok, strategy, status: 'complete'|'partial'|'not-run', catalogVersion?,
 *   summary, integrations: object[], warnings: string[], error? }}
 */
function runIntegrationScan(workspaceRoot, options = {}) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    return emptyResult('not-run', ['integration-scan did not run: workspace root not found'], { error: 'workspace root not found' });
  }
  let catalog;
  try {
    catalog = options.catalog || loadCatalog(options.catalogPath);
  } catch (err) {
    return emptyResult('not-run', [`integration-scan did not run: catalog could not be loaded (${err.message})`], { error: err.message });
  }

  const warnings = [];
  const sink = { matches: [], generic: [], warnings };
  const files = collectFiles(workspaceRoot, warnings);
  let oversized = 0;
  let minified = 0;
  let scanned = 0;
  for (const file of files) {
    let raw;
    try {
      if (fs.statSync(file.abs).size > MAX_FILE_BYTES) { oversized++; continue; }
      raw = fs.readFileSync(file.abs, 'utf8');
    } catch (err) {
      warnings.push(`integration-scan: could not read \`${file.rel}\` (${err.code || 'error'}) — not scanned`);
      continue;
    }
    if (file.kind === 'js' && isMinified(raw)) { minified++; continue; }
    const { text, malformed } = prepareText(file.kind, raw);
    if (malformed) warnings.push(`integration-scan: ${malformed} in \`${file.rel}\` — scanned as text; evidence from this file may be incomplete`);
    scanFile(file, raw, text, catalog, sink);
    scanned++;
  }
  if (oversized > 0) warnings.push(`integration-scan: ${oversized} file(s) larger than ${MAX_FILE_BYTES / 1024} KB were skipped`);

  const integrations = aggregate(catalog, sink);
  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const r of integrations) byConfidence[r.confidence]++;
  const unknown = integrations.filter(r => r.category === 'customer-external').length;
  return {
    ok: true,
    strategy: 'integration-scan',
    status: warnings.length > 0 ? 'partial' : 'complete',
    catalogVersion: catalog.version,
    summary: {
      total: integrations.length,
      known: integrations.length - unknown,
      unknown,
      detected: byConfidence.high + byConfidence.medium,
      candidates: byConfidence.low,
      byConfidence,
      filesScanned: scanned,
      minifiedSkipped: minified,
    },
    integrations,
    warnings,
  };
}

// ── Markdown ─────────────────────────────────────────────────────────────────

let labelCache = null;
function labels() {
  if (labelCache) return labelCache;
  try {
    const c = loadCatalog();
    labelCache = { categories: c.categories, considerations: c.considerations };
  } catch (err) {
    labelCache = { categories: {}, considerations: {} };
  }
  return labelCache;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/\|/g, '\\|');

function evidenceSummary(rec) {
  const counts = new Map();
  for (const e of rec.evidence) counts.set(e.type, (counts.get(e.type) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, n]) => `${EVIDENCE_TYPE_LABELS[t] || t} (${n})`)
    .join(', ');
}

/** Markdown lines for the runbook's Integration Discovery section. */
function renderIntegrationDiscovery(discovery) {
  const { categories, considerations } = labels();
  const out = [];
  out.push('## Integration Discovery (`integrationDiscovery`)');
  out.push('');
  out.push('> Read-only inventory of external integrations found by deterministic signature matching');
  out.push('> (`integration-scan`). No endpoint was contacted, no code was changed, and no remediation');
  out.push('> is proposed. **Low** confidence rows are candidates that need manual confirmation.');
  out.push('> Unknown hosts are shown only as a fingerprint; source text and values are never included.');
  out.push('');

  if (!discovery || discovery.status === 'not-run') {
    out.push('_Integration scan did not run — see the warnings below._');
    out.push('');
  } else {
    const s = discovery.summary;
    out.push('| Field | Value |');
    out.push('|-------|-------|');
    out.push(`| Integrations detected | **${s.total}** (${s.known} known, ${s.unknown} unknown external) |`);
    out.push(`| Confidence | ${s.byConfidence.high} high, ${s.byConfidence.medium} medium, ${s.byConfidence.low} low (candidates) |`);
    out.push(`| Files scanned | ${s.filesScanned}${s.minifiedSkipped ? ` (${s.minifiedSkipped} minified/bundled JS skipped)` : ''} |`);
    out.push(`| Scan status | ${discovery.status === 'complete' ? 'complete' : 'partial — see integration scan warnings'} |`);
    out.push('');
    if (discovery.integrations.length === 0) {
      out.push('No integrations detected.');
      out.push('');
    } else {
      out.push('| Integration | Category | Confidence | Evidence | Migration considerations |');
      out.push('|-------------|----------|------------|----------|--------------------------|');
      for (const r of discovery.integrations) {
        const name = r.host ? `${r.name} — host \`${r.host.hint}\` [${r.host.fingerprint}]` : r.name;
        const conf = `${cap(r.confidence)}${r.status === 'candidate' ? ' (candidate)' : ''}`;
        const cons = r.migrationConsiderations.map(c => considerations[c] || c).join('; ');
        out.push(`| ${esc(name)} | ${esc(categories[r.category] || r.category)} | ${conf} | ${esc(evidenceSummary(r))} | ${esc(cons)} |`);
      }
      out.push('');
      out.push('### Integration evidence');
      out.push('');
      for (const r of discovery.integrations) {
        const refs = r.evidence.slice(0, 5).map(e => `\`${e.line == null ? e.file : `${e.file}:${e.line}`}\` (${e.indicator})`);
        const more = r.evidenceCount - refs.length;
        out.push(`- **${esc(r.name)}** (\`${r.id}\`): ${refs.join(', ')}${more > 0 ? ` (+${more} more in the cache)` : ''}`);
      }
      out.push('');
    }
  }

  if (discovery && discovery.warnings && discovery.warnings.length > 0) {
    out.push('### Integration scan warnings');
    out.push('');
    for (const w of discovery.warnings) out.push(`- ${w}`);
    out.push('');
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--catalog');
  const catalogPath = ci !== -1 ? args[ci + 1] : undefined;
  const root = args.find((a, i) => !a.startsWith('--') && (ci === -1 || i !== ci + 1)) || process.cwd();
  process.stdout.write(JSON.stringify(runIntegrationScan(root, { catalogPath }), null, 2) + '\n');
}

module.exports = {
  runIntegrationScan,
  renderIntegrationDiscovery,
  loadCatalog,
  scoreConfidence,
  fileKind,
  prepareText,
  DEFAULT_CATALOG_PATH,
  EVIDENCE_TYPE_LABELS,
};
