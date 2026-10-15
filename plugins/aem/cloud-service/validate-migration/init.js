#!/usr/bin/env node
'use strict';

/**
 * validate-migration init — readiness check with an SDK boot harness.
 *
 * Confirms the developer's environment is ready to run validate-migration check:
 *   • AEM_SDK_URL  (default http://localhost:4502) is reachable — if it is not,
 *     search the workspace for the AEM SDK Quickstart jar and boot it; if none
 *     is found, point the user at Adobe Software Distribution to download it.
 *   • `mvn` and `unzip` are on PATH
 *   • the AEM Quickstart MCP server is installed on the SDK and exposes
 *     `diagnose-osgi-bundle` (checked with AEM_TARGET_AUTH, the user's SDK login)
 *
 * The coding assistant still calls `diagnose-osgi-bundle` itself and must have
 * the server in its own MCP config; this script cannot see that config.
 *
 * Config, all optional:
 *   AEM_SDK_URL      SDK base URL (default http://localhost:4502)
 *   AEM_TARGET_AUTH  SDK login as user:password, set by the user (never stored)
 *   --sdk <url>      CLI override
 *   --search <dir>   where to look for the Quickstart jar (default: cwd)
 *   --no-start       detect only; do not boot the SDK
 */

if (typeof fetch !== 'function') {
  console.error('[validate-migration] Node 18+ required (needs global fetch).');
  process.exit(2);
}

const { execFileSync } = require('child_process');
const { ensureSdk, findRunningSdk } = require('./sdk.js');
const { checkMcpServer, mcpGuidance, REQUIRED_TOOL } = require('./mcp.js');

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

function fatal(msg) { console.error(msg); process.exit(1); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sdkUrl = (args.sdk || process.env.AEM_SDK_URL || await findRunningSdk() || 'http://localhost:4502').replace(/\/$/, '');

  console.log(`[validate-migration] SDK URL:  ${sdkUrl}`);

  const checks = [
    { name: 'mvn on PATH', ok: hasCommand('mvn'), hint: 'install Maven 3.8+' },
    { name: 'unzip on PATH', ok: hasCommand('unzip'), hint: 'install unzip' },
  ];

  const sdkUp = await ensureSdk(sdkUrl, { search: args.search, noStart: !!args['no-start'] });
  checks.push({ name: `SDK reachable (${sdkUrl})`, ok: sdkUp, hint: 'could not auto-start a local Cloud SDK — see messages above' });
  const mcp = sdkUp ? await checkMcpServer(sdkUrl, process.env.AEM_TARGET_AUTH) : { status: 'unreachable', endpoint: `${sdkUrl}/bin/mcp` };
  checks.push({ name: `AEM Quickstart MCP server with ${REQUIRED_TOOL}`, ok: mcp.status === 'ready', hint: mcpGuidance(mcp) });

  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : `  — ${c.hint}`}`);

  const missing = checks.filter((c) => !c.ok);
  if (missing.length) fatal(`\n[validate-migration] ${missing.length} check(s) failed. Fix the above and retry.`);

  console.log(`\n[validate-migration] local prerequisites ready.`);
  console.log(`MCP: ${mcpGuidance(mcp)}`);
  console.log(`Then run  node ../../validate-migration/check.js  from your project root.`);
}

main().catch((e) => fatal(`[validate-migration] ${e.stack || e.message}`));

