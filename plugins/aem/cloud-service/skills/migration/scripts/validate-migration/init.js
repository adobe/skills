#!/usr/bin/env node
'use strict';

/**
 * validate-migration init — one-time setup. Run once before validation.
 *
 * Runtime patterns need the Cloud SDK (default http://localhost:4602) and its
 * MCP server, confirmed by the coding assistant. Template comparison also needs
 * AEM 6.5 (default http://localhost:4502); offline dialog checks need neither.
 * Setup never contacts AEM and never handles AEM credentials: it records the
 * selected URLs, rejects a source URL that equals the SDK URL, and checks local
 * tools. The developer starts the instances; deployment uses the project's
 * Maven profile and runtime state comes only from the MCP diagnosis.
 *
 *   --pattern <a,b>                scope (otherwise changed patterns vs main)
 *   --sdk <url> --quickstart <url>   override the fixed ports
 */

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error('[validate-migration] Node 18+ required.');
  process.exit(2);
}

const path = require('path');
const { execFileSync } = require('child_process');
const { REQUIRED_TOOL } = require('./mcp.js');
const { readSetup, writeSetup, resolveInstances, setupPath, requiredChecks, sameInstance } = require('./setup.js');
const { computeValidationPlan } = require('./plan.js');
const { canonicalPattern } = require('./check/patterns/aliases.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function hasCommand(cmd) {
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.project || process.cwd();
  let patterns;
  if (typeof args.pattern === 'string') {
    patterns = args.pattern.split(',').map((pattern) => canonicalPattern(pattern.trim())).filter(Boolean);
    if (!patterns.length) throw new Error('--pattern must name at least one supported pattern');
  } else {
    const plan = computeValidationPlan({ cwd, baseRef: args.base });
    if (plan.error) throw new Error(`${plan.error} — pass --pattern <name> to select setup scope`);
    patterns = [...new Set(plan.tasks.map((task) => task.pattern))];
  }
  const required = new Set(requiredChecks(patterns));
  const saved = readSetup(cwd);
  const inst = resolveInstances(args, saved);

  const items = [
    { name: 'mvn and unzip on PATH', ok: hasCommand('mvn') && hasCommand('unzip'), detail: 'install Maven 3.8+ and unzip' },
  ];
  const selected = {};
  for (const kind of ['sdk', 'quickstart']) {
    if (!required.has(kind)) continue;
    const url = inst[`${kind}_url`];
    let valid = true;
    try { new URL(url); } catch { valid = false; }
    items.push({ name: `${kind === 'sdk' ? 'Cloud SDK' : 'AEM 6.5 source'} URL ${url}`, ok: valid, detail: 'not a valid URL' });
    if (valid) selected[`${kind}_url`] = url;
  }
  if (selected.sdk_url && selected.quickstart_url && sameInstance(selected.sdk_url, selected.quickstart_url)) {
    items.push({ name: 'AEM 6.5 source and Cloud SDK are different instances', ok: false,
      detail: 'pass distinct --sdk and --quickstart URLs' });
  }

  console.log(`[validate-migration] setup — scope: ${patterns.join(', ') || 'no relevant changes'}`);
  for (const it of items) console.log(`  ${it.ok ? '✓' : '✗'} ${it.name}${it.ok ? '' : `  — ${it.detail}`}`);
  if (required.size) console.log('  • start the instances above yourself; init.js does not contact them');
  if (required.has('mcp')) {
    console.log(`  • MCP: your coding assistant must confirm ${REQUIRED_TOOL} on ${inst.sdk_url}/bin/mcp; init.js does not check it`);
  }

  const blocking = items.filter((it) => !it.ok);
  if (blocking.length) {
    console.error(`\n[validate-migration] setup not ready: ${blocking.length} item(s) above. Fix and rerun init.js.`);
    process.exit(1);
  }
  if (Object.keys(selected).length) {
    writeSetup(cwd, { ...saved, ...selected });
    console.log(`\n  saved ${path.relative(cwd, setupPath(cwd))} (URLs only)`);
  }
  console.log('\n[validate-migration] setup ready. Next: node <validator>/check.js --stage prepare');
}

main().catch((e) => { console.error(`[validate-migration] ${e.stack || e.message}`); process.exit(1); });
