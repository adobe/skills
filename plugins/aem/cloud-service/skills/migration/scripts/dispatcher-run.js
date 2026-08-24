'use strict';
const fs = require('fs');
const path = require('path');

const TOOL_PKG = '@adobe/aem-cs-source-migration-dispatcher-converter';
const TOOL_DIR = path.join(__dirname, 'dispatcher-tool');

function yamlList(items) {
  if (!items || !items.length) return ' ';
  return '\n' + items.map(i => `            - "${i}"`).join('\n');
}

// Emit the tool's config.yaml. Keys not applicable to the mode are left blank (the tool ignores them).
// cfg.onPremise.variablesToReplace: array of {from, to} objects → emitted as YAML mapping (flat key: value pairs).
// cfg.onPremise.portsToMap: array of numbers → emitted as YAML list.
function writeToolConfig(workingDir, cfg) {
  const op = cfg.onPremise || {};
  const variablesToReplaceYaml = (op.variablesToReplace && op.variablesToReplace.length)
    ? '\n' + op.variablesToReplace.map(v => `            "${v.from}": "${v.to}"`).join('\n')
    : ' ';
  const lines = [
    'dispatcherConverter:',
    `    sdkSrc: ${cfg.sdkSrc || ''}`,
    '    onPremise:',
    `        dispatcherAnySrc: ${op.dispatcherAnySrc || ''}`,
    `        httpdSrc: ${op.httpdSrc || ''}`,
    `        vhostsToConvert:${yamlList(op.vhostsToConvert)}`,
    `        variablesToReplace:${variablesToReplaceYaml}`,
    `        appendToVhosts: ${op.appendToVhosts || ''}`,
    `        pathToPrepend:${yamlList(op.pathToPrepend)}`,
    `        portsToMap:${yamlList(op.portsToMap)}`,
    '    ams:',
    `        cfg: ${(cfg.ams && cfg.ams.cfg) || ''}`,
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

module.exports = { writeToolConfig, resolveExecutor, TOOL_PKG, TOOL_DIR };
