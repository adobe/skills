#!/usr/bin/env node
'use strict';

/**
 * validate-migration init — one-time setup. Run once before validation.
 *
 * Runtime patterns need the Cloud SDK on http://localhost:4602 and its MCP server,
 * confirmed by the coding assistant. Template comparison also needs AEM 6.5 on
 * http://localhost:4502; offline dialog checks need neither instance.
 * Checks product roles through the About page, reusing AEM_TARGET_AUTH or
 * AEM_SOURCE_AUTH from the environment if the page requires a login. Deployment
 * still uses the project's Maven profile credentials. Boots a missing instance
 * from its jar under --search, then saves only the verified URLs.
 *
 *   --pattern <a,b>                scope (otherwise changed patterns vs main)
 *   --sdk <url> --quickstart <url>   override the fixed ports
 *   --search <dir> --no-start        where to find / whether to boot missing jars
 */

if (typeof fetch !== 'function') {
  console.error('[validate-migration] Node 18+ required (needs global fetch).');
  process.exit(2);
}

const path = require('path');
const { execFileSync } = require('child_process');
const { ensureInstance } = require('./sdk.js');
const { REQUIRED_TOOL } = require('./mcp.js');
const { readSetup, writeSetup, resolveInstances, setupPath, requiredChecks } = require('./setup.js');
const { computeValidationPlan } = require('./plan.js');

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
    patterns = args.pattern.split(',').map((pattern) => pattern.trim()).filter(Boolean);
    if (!patterns.length) throw new Error('--pattern must name at least one supported pattern');
  } else {
    const plan = computeValidationPlan({ cwd, baseRef: args.base });
    if (plan.error) throw new Error(`${plan.error} — pass --pattern <name> to select setup scope`);
    patterns = [...new Set(plan.tasks.map((task) => task.pattern))];
  }
  const required = new Set(requiredChecks(patterns));
  const saved = readSetup(cwd);
  const inst = resolveInstances(args, saved);
  const opts = { search: args.search, noStart: !!args['no-start'] };

  const items = [
    { name: 'mvn and unzip on PATH', ok: hasCommand('mvn') && hasCommand('unzip'), detail: 'install Maven 3.8+ and unzip' },
  ];
  const verified = {};
  for (const kind of ['sdk', 'quickstart']) {
    if (!required.has(kind)) continue;
    const url = inst[`${kind}_url`];
    const ok = await ensureInstance(url, { kind, ...opts });
    items.push({
      name: `${kind === 'sdk' ? 'Cloud SDK' : 'AEM 6.5 Quickstart'} on ${url}`, ok,
      detail: 'not ready — check the instance/credentials diagnostic above; use --search <installation-folder> if missing',
    });
    if (ok) verified[`${kind}_url`] = url;
  }

  console.log(`[validate-migration] setup — scope: ${patterns.join(', ') || 'no relevant changes'}`);
  for (const it of items) console.log(`  ${it.ok ? '✓' : '✗'} ${it.name}${it.ok ? '' : `  — ${it.detail}`}`);
  if (required.has('mcp')) {
    console.log(`  • MCP: your coding assistant must confirm ${REQUIRED_TOOL} on ${inst.sdk_url}/bin/mcp; init.js does not check it`);
  }

  const blocking = items.filter((it) => !it.ok);
  if (blocking.length) {
    console.error(`\n[validate-migration] setup not ready: ${blocking.length} item(s) above. Fix and rerun init.js.`);
    process.exit(1);
  }
  if (Object.keys(verified).length) {
    writeSetup(cwd, { ...saved, ...verified });
    console.log(`\n  saved ${path.relative(cwd, setupPath(cwd))} (URLs only)`);
  }
  console.log('\n[validate-migration] setup ready. Next: node <validator>/check.js --stage prepare');
}

main().catch((e) => { console.error(`[validate-migration] ${e.stack || e.message}`); process.exit(1); });
