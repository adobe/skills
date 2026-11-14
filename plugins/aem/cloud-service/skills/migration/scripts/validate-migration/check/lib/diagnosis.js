'use strict';

const fs = require('fs');
const path = require('path');
const { FAILURE_CLASSES } = require('../../failure-classes.js');

// ---- MCP-based diagnosis (AEM Quickstart MCP server, diagnose-osgi-bundle) ----
// The skill (agent) invokes the `diagnose-osgi-bundle` MCP tool on the
// agent-configured AEM Quickstart MCP server and writes a JSON map
//     { "<Bundle-SymbolicName>": "<raw tool text output>" }
// to `.validate-migration/diagnosis-map.json` (or a path passed via
// `--diagnosis-map <file>`). This script does not speak MCP itself — that is
// the coding-assistant's job.
//
// When a BSN is not in the map, verification for that task fails with
// `setup.mcp_unavailable` and the outcome carries setup guidance. There is no
// silent Felix Web Console fallback.
let diagnosisMap; // undefined = not yet loaded, {} = loaded (may be empty)

const diagnosisCache = new Map(); // BSN -> parsed diagnosis, per run

function loadDiagnosisMap(args) {
  if (diagnosisMap !== undefined) return diagnosisMap;
  const explicit = args && args['diagnosis-map'];
  const baseDir = (args && args.project) || process.cwd();
  const candidates = [
    explicit,
    path.join(baseDir, '.validate-migration', 'diagnosis-map.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') { diagnosisMap = parsed; return diagnosisMap; }
    } catch { /* try next */ }
  }
  diagnosisMap = {};
  return diagnosisMap;
}

// Returns { bundle_state, found, components: Map<fqcn, {state}>, source, available }.
// `available: false` means the agent has not supplied MCP diagnosis for this
// BSN — callers must fail with SETUP_MCP_UNAVAILABLE + setup guidance.
async function getBundleDiagnosis({ bundleBSN, args }) {
  if (diagnosisCache.has(bundleBSN)) return diagnosisCache.get(bundleBSN);
  const map = loadDiagnosisMap(args);
  const raw = map[bundleBSN];
  if (raw == null) {
    const missing = { available: false };
    diagnosisCache.set(bundleBSN, missing);
    return missing;
  }
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const parsed = parseBundleDiagnosticReport(text);
  parsed.available = true;
  parsed.source = 'mcp';
  diagnosisCache.set(bundleBSN, parsed);
  return parsed;
}

function mcpUnavailableOutcome(bundleBSN) {
  return {
    result: 'fail',
    failure_class: FAILURE_CLASSES.SETUP_MCP_UNAVAILABLE,
    bundle_state: 'Unknown',
    component_state: 'Unknown',
    evidence: `no MCP diagnose-osgi-bundle output for ${bundleBSN}. `
      + `Have the coding assistant call the AEM Quickstart MCP tool `
      + `\`diagnose-osgi-bundle\` for this bundle and write the raw text output `
      + `into .validate-migration/diagnosis-map.json as { "${bundleBSN}": "..." }, `
      + `then re-run \`node "$VALIDATOR/check.js" --stage verify\`.`,
  };
}

// The diagnostic tool returns free text, not JSON. Unrecognized shapes map to
// 'Unknown' rather than a guessed 'Active', so a parse miss fails safe.
// State is normalized to title case ('Active', 'Installed', 'Resolved') because
// the OSGi runtime and Sling's diagnostic report both use upper case ('ACTIVE'),
// while Felix's JSON and the rest of validate-migration use title case.
function parseBundleDiagnosticReport(text) {
  const components = parseComponentsFromReport(text);
  // Bundle State: appears before the DS components section — scope the search
  // there so a component's own State: line isn't read as the bundle's, and so
  // "reference … not found" in an Active report isn't misread as not-installed.
  const dsIdx = text.indexOf('Declarative Services Components');
  const bundleText = dsIdx === -1 ? text : text.slice(0, dsIdx);
  const stateLine = bundleText.match(/State:\s*([A-Za-z]+)/);
  if (stateLine) return { bundle_state: normalizeState(stateLine[1]), found: true, components };
  if (/no such bundle|not found|not installed/i.test(bundleText)) return { bundle_state: 'Unknown', found: false, components };
  if (/INSTALLED but not RESOLVED/i.test(bundleText)) return { bundle_state: 'Installed', found: true, components };
  if (/\bACTIVE\b/i.test(bundleText) && !/not RESOLVED|not ACTIVE|unsatisfied/i.test(bundleText)) return { bundle_state: 'Active', found: true, components };
  return { bundle_state: 'Unknown', found: true, components };
}

// Parses the `--- Declarative Services Components ---` section of the report
// into a Map<fqcn, {state}>. Only states are exposed today; component
// properties are a documented MCP gap (tracked upstream).
function parseComponentsFromReport(text) {
  const out = new Map();
  const start = text.indexOf('Declarative Services Components');
  if (start === -1) return out;
  const body = text.slice(start);
  const re = /Component:\s*([^\r\n]+)\r?\n\s*State:\s*([A-Za-z]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.set(m[1].trim(), { state: normalizeState(m[2]) });
  }
  return out;
}

function normalizeState(s) {
  if (!s) return 'Unknown';
  const lc = String(s).toLowerCase();
  return lc.charAt(0).toUpperCase() + lc.slice(1);
}

// Remove the default diagnosis map so a fresh prepare can't leave stale data.
function clearDiagnosisMap(baseDir) {
  fs.rmSync(path.join(baseDir, '.validate-migration', 'diagnosis-map.json'), { force: true });
}

module.exports = { loadDiagnosisMap, getBundleDiagnosis, mcpUnavailableOutcome, parseBundleDiagnosticReport, parseComponentsFromReport, normalizeState, clearDiagnosisMap };
