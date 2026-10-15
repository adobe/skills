#!/usr/bin/env node
'use strict';

/**
 * validate-migration init — phase 1 setup. Run once before validation.
 *
 * Finds which local instance is the Cloud SDK (target) and which is the legacy
 * AEM 6.5 Quickstart (source) from their About pages, checks the SDK, its AEM
 * Quickstart MCP server, the editor MCP config and the Quickstart, and saves the
 * confirmed URLs to <project>/.validate-migration/setup.json (no credentials).
 * Only items needed by the patterns in scope block (exit 1).
 *
 * Logins come from the user's shell only: AEM_TARGET_AUTH (SDK), AEM_SOURCE_AUTH
 * (Quickstart), as user:password. They are never written anywhere.
 *
 *   --sdk <url> --quickstart <url>   set instances (otherwise saved, then detected)
 *   --pattern <a,b>                  scope (default: patterns changed vs main)
 *   --setup-mcp                      add the SDK MCP server to the VS Code user mcp.json
 *   --search <dir> --no-start        where to find / whether to boot the SDK jar
 */

if (typeof fetch !== 'function') {
  console.error('[validate-migration] Node 18+ required (needs global fetch).');
  process.exit(2);
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureSdk, isReachable } = require('./sdk.js');
const { checkMcpServer, mcpGuidance, detectEditor, mergeEditorConfig, REQUIRED_TOOL } = require('./mcp.js');
const { detectRole, requiredChecks, readSetup, writeSetup, resolveInstances, setupPath } = require('./setup.js');
const { computeValidationPlan } = require('./plan.js');

const CANDIDATE_PORTS = [4502, 4602, 4503];

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

// Try both logins: the user may not know yet which port is which.
async function roleOf(url) {
  let last = { role: 'unknown', reason: 'login_missing' };
  for (const auth of [process.env.AEM_TARGET_AUTH, process.env.AEM_SOURCE_AUTH].filter(Boolean)) {
    last = await detectRole(url, auth);
    if (last.role !== 'unknown') return last;
  }
  return last;
}

async function detectInstances() {
  const found = {};
  for (const port of CANDIDATE_PORTS) {
    const url = `http://localhost:${port}`;
    if (!(await isReachable(url, 500))) continue;
    const { role, version } = await roleOf(url);
    if (role === 'cloud-sdk' && !found.sdk_url) Object.assign(found, { sdk_url: url, sdk_version: version });
    if (role === 'aem65' && !found.quickstart_url) Object.assign(found, { quickstart_url: url, quickstart_version: version });
  }
  return found;
}

function scopePatterns(args, cwd) {
  if (typeof args.pattern === 'string') return args.pattern.split(',').map((p) => p.trim()).filter(Boolean);
  return [...new Set((computeValidationPlan({ cwd }).tasks || []).map((t) => t.pattern))];
}

function vscodeUserMcpPath(editor) {
  const app = editor === 'vscode-insiders' ? 'Code - Insiders' : 'Code';
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', app, 'User', 'mcp.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', app, 'User', 'mcp.json');
  return path.join(os.homedir(), '.config', app, 'User', 'mcp.json');
}

function editorCheck(args, sdkUrl) {
  const editor = detectEditor(process.env);
  if (!editor) return { ok: false, detail: 'editor not detected — add <sdk>/bin/mcp to your assistant MCP config' };
  if (editor !== 'vscode' && editor !== 'vscode-insiders') return { ok: false, detail: mergeEditorConfig(editor, '', sdkUrl).error };
  const file = vscodeUserMcpPath(editor);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const merged = mergeEditorConfig(editor, existing, sdkUrl);
  if (merged.error) return { ok: false, detail: merged.error };
  if (!merged.changed) return { ok: true, detail: `${editor}: aem-cs-sdk in ${file}` };
  if (!args['setup-mcp']) return { ok: false, detail: `${editor}: not configured — rerun with --setup-mcp to add it to ${file}` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, merged.text);
  return { ok: true, detail: `${editor}: added aem-cs-sdk to ${file}; start it and enter "Basic <base64 user:password>" when asked` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.project || process.cwd();
  const patterns = scopePatterns(args, cwd);
  const required = new Set(requiredChecks(patterns));
  const saved = readSetup(cwd);
  const needDetect = !args.sdk && !args.quickstart && !saved.sdk_url;
  const inst = resolveInstances(args, saved, needDetect ? await detectInstances() : {});

  console.log(`[validate-migration] setup — scope: ${patterns.length ? patterns.join(', ') : 'all patterns'}`);
  console.log(`  Cloud SDK (target):    ${inst.sdk_url || 'not found'}`);
  console.log(`  AEM 6.5 (source):      ${inst.quickstart_url || 'not found'}   [${inst.source}]`);

  const items = [
    { key: 'sdk', name: 'mvn and unzip on PATH', ok: hasCommand('mvn') && hasCommand('unzip'), detail: 'install Maven 3.8+ and unzip' },
  ];

  let sdkOk = false;
  if (inst.sdk_url) {
    sdkOk = await ensureSdk(inst.sdk_url, { search: args.search, noStart: !!args['no-start'] });
    const role = sdkOk ? await detectRole(inst.sdk_url, process.env.AEM_TARGET_AUTH) : { reason: 'unreachable' };
    if (role.role === 'cloud-sdk') inst.sdk_version = role.version;
    sdkOk = role.role === 'cloud-sdk';
    items.push({ key: 'sdk', name: `Cloud SDK ${inst.sdk_url}${inst.sdk_version ? ` (${inst.sdk_version})` : ''}`, ok: sdkOk,
      detail: role.role === 'aem65' ? 'this is AEM 6.5, not the Cloud SDK — pass --sdk <cloud-sdk-url>' : `${role.reason} — set AEM_TARGET_AUTH and start the SDK` });
  } else {
    items.push({ key: 'sdk', name: 'Cloud SDK', ok: false, detail: 'none detected — start the AEM SDK or pass --sdk <url> (set AEM_TARGET_AUTH)' });
  }

  const mcp = sdkOk ? await checkMcpServer(inst.sdk_url, process.env.AEM_TARGET_AUTH) : { status: 'unreachable', endpoint: 'n/a' };
  items.push({ key: 'mcp', name: `MCP server on SDK with ${REQUIRED_TOOL}`, ok: mcp.status === 'ready', detail: mcpGuidance(mcp) });
  if (sdkOk) items.push({ key: 'mcp', name: 'MCP server in your editor', ...editorCheck(args, inst.sdk_url) });

  if (inst.quickstart_url) {
    const role = await detectRole(inst.quickstart_url, process.env.AEM_SOURCE_AUTH);
    if (role.role === 'aem65') inst.quickstart_version = role.version;
    items.push({ key: 'quickstart', name: `AEM 6.5 Quickstart ${inst.quickstart_url}${role.version ? ` (${role.version})` : ''}`, ok: role.role === 'aem65',
      detail: role.role === 'cloud-sdk' ? 'this is the Cloud SDK — pass --quickstart <aem65-url>' : `${role.reason} — set AEM_SOURCE_AUTH and start AEM 6.5` });
  } else {
    items.push({ key: 'quickstart', name: 'AEM 6.5 Quickstart', ok: false, detail: 'none detected — start AEM 6.5 or pass --quickstart <url> (set AEM_SOURCE_AUTH)' });
  }

  console.log('');
  for (const it of items) {
    const mark = it.ok ? '✓' : required.has(it.key) ? '✗' : '–';
    console.log(`  ${mark} ${it.name}${it.ok ? '' : `  — ${it.detail}`}${!it.ok && !required.has(it.key) ? ' (optional for this scope)' : ''}`);
  }

  if (sdkOk || inst.quickstart_version) {
    writeSetup(cwd, inst);
    console.log(`\n  saved ${path.relative(cwd, setupPath(cwd))} (URLs only)`);
  }

  const blocking = items.filter((it) => !it.ok && required.has(it.key));
  if (blocking.length) {
    console.error(`\n[validate-migration] setup not ready: ${blocking.length} required item(s) above. Fix and rerun init.js.`);
    process.exit(1);
  }
  console.log('\n[validate-migration] setup ready. Next: node <validator>/check.js --stage prepare');
}

main().catch((e) => { console.error(`[validate-migration] ${e.stack || e.message}`); process.exit(1); });
