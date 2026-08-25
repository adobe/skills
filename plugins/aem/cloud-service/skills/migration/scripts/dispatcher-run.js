'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const TOOL_PKG = '@adobe/aem-cs-source-migration-dispatcher-converter';
const TOOL_DIR = path.join(__dirname, 'dispatcher-tool');

// YAML-safe emission: escape backslashes + double-quotes; quote scalars. Empty → blank (' ')
// so the tool's `if (config.X)` guards still treat it as unset. A path with a YAML indicator
// (` #`, leading `*`/`&`/`!`/`%`/quote) or a Windows backslash otherwise mis-parses unquoted.
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const yamlScalar = v => (v == null || v === '') ? ' ' : `"${esc(v)}"`;

function yamlList(items) {
  if (!items || !items.length) return ' ';
  return '\n' + items.map(i => `            - ${yamlScalar(i)}`).join('\n');
}

// Emit the tool's config.yaml. Keys not applicable to the mode are left blank (the tool ignores them).
// cfg.onPremise.variablesToReplace: array of {from, to} objects → emitted as YAML mapping (flat key: value pairs).
// cfg.onPremise.portsToMap: array of numbers → emitted as YAML list.
function writeToolConfig(workingDir, cfg) {
  const op = cfg.onPremise || {};
  const variablesToReplaceYaml = (op.variablesToReplace && op.variablesToReplace.length)
    ? '\n' + op.variablesToReplace.map(v => `            ${yamlScalar(v.from)}: ${yamlScalar(v.to)}`).join('\n')
    : ' ';
  const lines = [
    'dispatcherConverter:',
    `    sdkSrc: ${yamlScalar(cfg.sdkSrc)}`,
    '    onPremise:',
    `        dispatcherAnySrc: ${yamlScalar(op.dispatcherAnySrc)}`,
    `        httpdSrc: ${yamlScalar(op.httpdSrc)}`,
    `        vhostsToConvert:${yamlList(op.vhostsToConvert)}`,
    `        variablesToReplace:${variablesToReplaceYaml}`,
    `        appendToVhosts: ${yamlScalar(op.appendToVhosts)}`,
    `        pathToPrepend:${yamlList(op.pathToPrepend)}`,
    `        portsToMap:${yamlList(op.portsToMap)}`,
    '    ams:',
    `        cfg: ${yamlScalar(cfg.ams && cfg.ams.cfg)}`,
    '',
  ];
  fs.mkdirSync(workingDir, { recursive: true });
  const p = path.join(workingDir, 'config.yaml');
  fs.writeFileSync(p, lines.join('\n'));
  return p;
}

function resolveExecutor(toolDir, mode) {
  const execs = path.join(toolDir, 'node_modules', TOOL_PKG, 'executors');
  const entry = (mode === 'standard') ? 'main.js' : 'singleFileMain.js'; // flexible/v1/unknown → on-premise path
  return path.join(execs, entry);
}

function isToolInstalled(toolDir) {
  return fs.existsSync(path.join(toolDir, 'node_modules', TOOL_PKG, 'executors'));
}

function ensureToolInstalled(toolDir) {
  if (isToolInstalled(toolDir)) return { installed: true, alreadyPresent: true };
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: toolDir, stdio: 'inherit' });
  return { installed: isToolInstalled(toolDir), alreadyPresent: false };
}

function runConverter(workingDir, mode, toolDir) {
  const executor = resolveExecutor(toolDir, mode);
  const r = spawnSync('node', [executor], { cwd: workingDir, encoding: 'utf8' });
  let stdout = (r.stdout || '') + (r.stderr || '');
  // On a spawn failure (e.g. node missing, ENOENT) status is null and stdout/stderr are empty;
  // fold the error in so callers see the cause instead of an opaque { code: null, stdout: '' }.
  if (r.error) stdout += String(r.error.message || r.error);
  return {
    code: r.status,
    stdout,
    outputSrcDir: path.join(workingDir, 'target/dispatcher/src'),
    reportPath: path.join(workingDir, 'target/dispatcher/dispatcher-converter-report.md'),
  };
}

module.exports = { writeToolConfig, resolveExecutor, TOOL_PKG, TOOL_DIR, isToolInstalled, ensureToolInstalled, runConverter };
