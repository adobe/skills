#!/usr/bin/env node
// skills/stardust/scripts/runtime-preflight.mjs — can this harness run stardust's scripts?
//
// Every rendering phase needs the same four things from the harness's shell: Node 22+, Playwright
// resolvable from the project, a Chromium that launches, a localhost server it can reach, and
// outbound HTTPS to the site. Sandboxed harnesses break these in recognisable ways (Codex's macOS
// Seatbelt kills Chromium at launch with a MachPortRendezvousServer "Permission denied"; network-off
// or allowlisted sandboxes fail DNS or connect) and an agent that meets one mid-phase tends to
// misread it as a site problem. Run this once at Setup (and again after installing Playwright):
// each failing check prints the cause and the fix for the harness named by --harness (or detected
// from its environment), from skills/stardust/reference/harness-notes.md.
//
//   node stardust/scripts/stardust/runtime-preflight.mjs [--harness <id>] [--url <https-url>]
//        [--offline] [--json]
//
// --harness   claude | copilot | grok | opencode | cursor | codex | antigravity | pi (name the
//             harness you run in; detection from the environment covers only Claude Code and Codex)
// --url       outbound probe target; default the site in stardust/state.json (site.originUrl), else
//             https://example.com/
// --offline   skip the outbound probe (it reports `skip`)
// Output: one line per check — `ok`, `skip`, `MISSING` (Playwright or its browser not installed yet:
// install per extract § Setup, then re-run) or `FAIL` (the harness blocks it; the line ends with the
// fix). Exit codes: 0 no FAIL · 1 at least one FAIL · 2 usage.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESSES = ['claude', 'copilot', 'grok', 'opencode', 'cursor', 'codex', 'antigravity', 'pi'];

/** A failure message → its cause class. Pure. */
export function classify(message) {
  const m = String(message || '');
  if (/MachPortRendezvous|bootstrap_check_in|sandbox_check|Operation not permitted|EPERM/i.test(m)) return 'sandbox-blocked';
  if (/Executable doesn't exist|playwright install|browserType\.launch: .*(not found|ENOENT)/i.test(m)) return 'browser-missing';
  if (/Cannot find (package|module) 'playwright'|ERR_MODULE_NOT_FOUND/i.test(m)) return 'playwright-missing';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return 'dns-blocked';
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ETIMEDOUT|EACCES|fetch failed|aborted/i.test(m)) return 'network-blocked';
  return 'unknown';
}

/** The environment's harness, when it says so. Pure. */
export function detectHarness(env) {
  if (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED || env.CODEX_HOME) return 'codex';
  if (env.CLAUDECODE) return 'claude';
  return null;
}

const NETWORK_FIX = {
  codex: 'restart with -c sandbox_workspace_write.network_access=true, or approve the escalation',
  cursor: "approve running it outside Cursor's sandbox, or add the host to the sandbox network allowlist",
  copilot: 'on the cloud agent add the host to the firewall allowlist; locally allow the shell tool network access',
};
const SANDBOX_FIX = {
  codex: "Chromium cannot run under Codex's macOS sandbox: run Playwright steps with --sandbox danger-full-access or an approved escalation",
  cursor: 'approve running the command outside the sandbox',
};

/** Cause class + harness → the one-line fix. Pure. */
export function fixFor(kind, harness) {
  const notes = 'see skills/stardust/reference/harness-notes.md';
  switch (kind) {
    case 'playwright-missing': return 'npm i -D playwright (extract § Setup; --legacy-peer-deps on aem-boilerplate)';
    case 'browser-missing': return 'npx playwright install chromium';
    case 'sandbox-blocked': return `${SANDBOX_FIX[harness] || "the harness's sandbox blocks Chromium: allow stardust's scripts to run outside it"} (${notes})`;
    case 'dns-blocked':
    case 'network-blocked': return `${NETWORK_FIX[harness] || "the harness's sandbox blocks outbound network: allow it for stardust's scripts"} (${notes})`;
    default: return notes;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
    return 0;
  }
  const opt = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) throw new Error(`--${n} needs a value`); return v; };
  let harness; let url;
  try { harness = opt('harness'); url = opt('url'); } catch (e) { console.error(e.message); return 2; }
  if (harness && !HARNESSES.includes(harness)) { console.error(`--harness must be one of ${HARNESSES.join(', ')}`); return 2; }
  harness = harness || detectHarness(process.env);
  if (!url) { try { url = JSON.parse(readFileSync(join('stardust', 'state.json'), 'utf8')).site?.originUrl; } catch {} }
  url = url || 'https://example.com/';

  const results = [];
  const record = (check, status, detail, kind) => results.push({ check, status, detail, ...(kind ? { cause: kind, fix: fixFor(kind, harness) } : {}) });

  const major = Number(process.versions.node.split('.')[0]);
  record('node', major >= 22 ? 'ok' : 'FAIL', `node ${process.versions.node}${major >= 22 ? '' : ' — stardust needs 22+'}`);

  let chromium = null;
  try { ({ chromium } = await import('playwright')); record('playwright', 'ok', 'resolves from the project'); } catch (e) {
    const kind = classify(e.message);
    record('playwright', kind === 'playwright-missing' ? 'MISSING' : 'FAIL', e.message.split('\n')[0], kind === 'playwright-missing' ? 'playwright-missing' : kind);
  }
  if (chromium) {
    try { const b = await chromium.launch({ headless: true }); await b.close(); record('chromium', 'ok', 'headless launch'); } catch (e) {
      const kind = classify(e.message);
      record('chromium', kind === 'browser-missing' ? 'MISSING' : 'FAIL', e.message.split('\n').find((l) => l.trim()) || 'launch failed', kind);
    }
  } else record('chromium', 'skip', 'no playwright');

  try {
    const server = createServer((_, res) => res.end('ok'));
    await new Promise((ok, ko) => { server.once('error', ko); server.listen(0, '127.0.0.1', ok); });
    const { port } = server.address();
    const body = await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) })).text();
    server.close();
    record('localhost', body === 'ok' ? 'ok' : 'FAIL', `bind + fetch 127.0.0.1:${port}`, body === 'ok' ? null : 'network-blocked');
  } catch (e) { record('localhost', 'FAIL', e.message, classify(e.message)); }

  if (args.includes('--offline')) record('outbound', 'skip', '--offline');
  else {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      record('outbound', 'ok', `${url} → HTTP ${res.status}`);
    } catch (e) { const msg = `${e.message}${e.cause ? `: ${e.cause.code || e.cause.message}` : ''}`; record('outbound', 'FAIL', `${url} — ${msg}`, classify(msg)); }
  }

  if (args.includes('--json')) console.log(JSON.stringify({ harness: harness || null, results }));
  else {
    for (const r of results) console.log(`${r.status.padEnd(7)} ${r.check.padEnd(10)} ${r.detail}${r.fix ? ` → fix: ${r.fix}` : ''}`);
    console.log(`harness: ${harness || 'unknown (pass --harness)'}`);
  }
  return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
