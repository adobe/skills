#!/usr/bin/env node
// ESM module (.mjs) — uses Node 22 built-in WebSocket global (no import needed)
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
         unlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform, arch } from 'node:os';

const DEFAULT_PORT = 9222;
const CACHE_DIR = join(process.env.HOME, '.cache', 'cdp-ext-pilot');
const CfT_DIR = join(CACHE_DIR, 'chrome-for-testing');
const CfT_VERSIONS_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = { port: DEFAULT_PORT };
  const positional = [];
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--port') flags.port = parseInt(raw[++i], 10);
    else positional.push(raw[i]);
  }
  return { command: positional[0], args: positional.slice(1), ...flags };
}

function sessionPath(port) {
  return `/tmp/ext-pilot-session-${port}.json`;
}

function loadSession(port) {
  const p = sessionPath(port);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

function saveSession(port, data) {
  writeFileSync(sessionPath(port), JSON.stringify(data, null, 2));
}

// --- Chrome Detection ---

function detectChrome() {
  // 1. Chrome for Testing in cache
  if (existsSync(CfT_DIR)) {
    const versions = readdirSync(CfT_DIR).sort().reverse();
    for (const v of versions) {
      const bin = cftBinaryPath(join(CfT_DIR, v));
      if (bin && existsSync(bin)) return { path: bin, variant: 'chrome-for-testing' };
    }
  }

  // 2. Chrome for Testing on PATH
  try {
    const p = execSync('command -v chrome-for-testing 2>/dev/null', { encoding: 'utf8' }).trim();
    if (p) return { path: p, variant: 'chrome-for-testing' };
  } catch {}

  // 3. Chromium
  const chromiumPaths = platform() === 'darwin'
    ? ['/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const p of chromiumPaths) {
    if (existsSync(p)) return { path: p, variant: 'chromium' };
  }

  // 4. Branded Chrome (triggers pipe path)
  const brandedPaths = platform() === 'darwin'
    ? [
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const p of brandedPaths) {
    if (existsSync(p)) return { path: p, variant: 'branded' };
  }

  return null;
}

function cftBinaryPath(versionDir) {
  if (platform() === 'darwin') {
    const app = join(versionDir, 'Google Chrome for Testing.app',
      'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(app)) return app;
    // Alternate structure
    const alt = join(versionDir, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS',
      'Google Chrome for Testing');
    if (existsSync(alt)) return alt;
    // Also check chrome-mac-x64
    const altx = join(versionDir, 'chrome-mac-x64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS',
      'Google Chrome for Testing');
    if (existsSync(altx)) return altx;
  } else {
    const bin = join(versionDir, 'chrome-linux64', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return null;
}

// --- Chrome for Testing Install ---

async function installChromeForTesting() {
  console.error('Downloading Chrome for Testing...');
  const res = await fetch(CfT_VERSIONS_URL);
  if (!res.ok) die(`Failed to fetch CfT versions: ${res.status}`);
  const data = await res.json();
  const stable = data.channels.Stable;
  const version = stable.version;

  const plat = platform() === 'darwin'
    ? (arch() === 'arm64' ? 'mac-arm64' : 'mac-x64')
    : 'linux64';
  const download = stable.downloads.chrome.find(d => d.platform === plat);
  if (!download) die(`No Chrome for Testing build for platform: ${plat}`);

  const destDir = join(CfT_DIR, version);
  if (existsSync(destDir)) {
    const bin = cftBinaryPath(destDir);
    if (bin) { console.error(`Chrome for Testing ${version} already cached.`); return bin; }
  }

  mkdirSync(destDir, { recursive: true });
  const zipPath = join(destDir, 'chrome.zip');
  console.error(`Downloading ${download.url}...`);
  const dlRes = await fetch(download.url);
  if (!dlRes.ok) die(`Download failed: ${dlRes.status}`);
  const buf = Buffer.from(await dlRes.arrayBuffer());
  writeFileSync(zipPath, buf);

  console.error('Extracting...');
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'pipe' });
  unlinkSync(zipPath);

  const bin = cftBinaryPath(destDir);
  if (!bin) die('Chrome for Testing binary not found after extraction');

  try {
    const ver = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
    console.error(`Installed: ${ver}`);
  } catch {
    console.error('Warning: could not verify Chrome version');
  }
  return bin;
}

// --- Launch ---

// --- Shared CDP helper ---

async function connectToTarget(wsDebuggerUrl) {
  const ws = new WebSocket(wsDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0;
  const send = (method, params = {}) => {
    const id = ++msgId;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        rej(new Error(`Timeout: ${method}`));
      }, 10000);
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          clearTimeout(timer);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { ws, send };
}

// --- Launch helpers ---

function readManifest(extPath) {
  const p = join(resolve(extPath), 'manifest.json');
  if (!existsSync(p)) die(`manifest.json not found at: ${extPath}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function launchSimple(chromePath, extPath, port, profileDir) {
  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--load-extension=${resolve(extPath)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-extensions',
  ], { stdio: 'ignore', detached: true });
  child.unref();
  return child.pid;
}

async function launchBranded(chromePath, extPath, port, profileDir) {
  // Step 1: pipe launch to load extension
  console.error('Branded Chrome detected — using pipe path for extension loading...');
  const child = spawn(chromePath, [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: false });

  const pipeIn = child.stdio[3];
  const pipeOut = child.stdio[4];

  const extId = await new Promise((res, rej) => {
    child.on('error', (err) => rej(new Error(`Chrome failed to start: ${err.message}`)));
    pipeOut.on('error', (err) => rej(new Error(`Pipe read error: ${err.message}`)));
    let buf = Buffer.alloc(0);
    pipeOut.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let idx;
      while ((idx = buf.indexOf(0)) !== -1) {
        const msg = buf.subarray(0, idx).toString();
        buf = buf.subarray(idx + 1);
        const parsed = JSON.parse(msg);
        if (parsed.id === 1) {
          if (parsed.result?.id) res(parsed.result.id);
          else rej(new Error(parsed.error?.message || 'Failed to load extension'));
        }
      }
    });
    setTimeout(() => {
      const cmd = JSON.stringify({
        id: 1,
        method: 'Extensions.loadUnpacked',
        params: { path: resolve(extPath) },
      }) + '\0';
      pipeIn.write(cmd);
    }, 3000);
    setTimeout(() => rej(new Error('Timed out loading extension via pipe')), 20000);
  });

  // Close pipe session
  pipeIn.end();
  pipeOut.destroy();
  child.kill();
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: restart with port
  console.error('Extension loaded. Restarting with CDP port...');
  const child2 = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore', detached: true });
  child2.unref();

  return { pid: child2.pid, extensionId: extId };
}

async function waitForCdp(port, maxWait = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function getExtensionId(port, extPath) {
  const manifest = readManifest(extPath);
  const extName = manifest.name;

  // Check existing targets for chrome-extension:// URLs
  const res = await fetch(`http://localhost:${port}/json`);
  const targets = await res.json();
  const extTarget = targets.find(t => t.url?.startsWith('chrome-extension://'));
  if (extTarget) {
    const match = extTarget.url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) return match[1];
  }

  // Fallback: navigate to chrome://extensions and scrape the ID
  const page = targets.find(t => t.type === 'page');
  if (!page) return null;

  const { ws, send } = await connectToTarget(page.webSocketDebuggerUrl);
  try {
    await send('Page.enable');
    await send('Page.navigate', { url: 'chrome://extensions' });
    await new Promise(r => setTimeout(r, 2000));

    // Query the extensions page shadow DOM for our extension by name
    // (brittle across Chrome versions — this is a fallback path)
    const result = await send('Runtime.evaluate', {
      expression: `(() => {
        const mgr = document.querySelector('extensions-manager');
        if (!mgr) return null;
        const items = mgr.shadowRoot.querySelector('extensions-item-list');
        if (!items) return null;
        const exts = items.shadowRoot.querySelectorAll('extensions-item');
        for (const ext of exts) {
          const name = ext.shadowRoot.querySelector('#name')?.textContent?.trim();
          if (name === ${JSON.stringify(extName)}) return ext.id;
        }
        return null;
      })()`,
      returnByValue: true,
    });

    return result.result?.value || null;
  } finally {
    ws.close();
  }
}

async function cmdLaunch(extPath, port) {
  if (!extPath) die('Usage: cdp-ext-pilot.mjs launch <extension-path> [--port N]');
  if (!existsSync(resolve(extPath)))
    die(`Extension path not found: ${extPath}`);

  readManifest(extPath); // validates manifest exists

  let chrome = detectChrome();
  if (!chrome) {
    const bin = await installChromeForTesting();
    chrome = { path: bin, variant: 'chrome-for-testing' };
  }

  console.error(`Using: ${chrome.variant} (${chrome.path})`);

  const profileDir = `/tmp/cdp-ext-pilot-${process.pid}`;
  mkdirSync(profileDir, { recursive: true });

  let pid, extensionId;
  if (chrome.variant === 'branded') {
    const result = await launchBranded(chrome.path, extPath, port, profileDir);
    pid = result.pid;
    extensionId = result.extensionId;
  } else {
    pid = await launchSimple(chrome.path, extPath, port, profileDir);
    extensionId = null; // resolved after CDP is ready
  }

  console.error('Waiting for CDP...');
  const ready = await waitForCdp(port);
  if (!ready) die('Chrome did not start CDP within 10s');

  if (!extensionId) {
    extensionId = await getExtensionId(port, extPath);
  }
  if (!extensionId) {
    die('Could not determine extension ID. The extension may not have loaded. ' +
        'Check chrome://extensions in the browser for errors.');
  }

  const session = {
    pid,
    extensionId,
    extensionPath: resolve(extPath),
    profileDir,
    port,
    chromePath: chrome.path,
    chromeVariant: chrome.variant,
  };
  saveSession(port, session);

  console.log(JSON.stringify(session, null, 2));
}

async function cmdClose(port) {
  const session = loadSession(port);
  if (!session) die(`No session found for port ${port}`);

  try { process.kill(session.pid, 'SIGTERM'); }
  catch { console.error(`Process ${session.pid} already exited`); }

  await new Promise(r => setTimeout(r, 1000));

  if (existsSync(session.profileDir)) {
    rmSync(session.profileDir, { recursive: true, force: true });
    console.error(`Removed profile: ${session.profileDir}`);
  }

  try { unlinkSync(sessionPath(port)); } catch {}
  console.error('Session closed.');
}

// --- Open Extension UI ---

async function getBrowserWsUrl(port) {
  const res = await fetch(`http://localhost:${port}/json/version`);
  const data = await res.json();
  return data.webSocketDebuggerUrl;
}

async function cdpBrowser(port, method, params = {}) {
  const wsUrl = await getBrowserWsUrl(port);
  const { ws, send: cdpSend } = await connectToTarget(wsUrl);
  try {
    return await cdpSend(method, params);
  } finally {
    ws.close();
  }
}

function availableSurfaces(manifest) {
  const surfaces = [];
  if (manifest.side_panel?.default_path) surfaces.push('sidepanel');
  if (manifest.action?.default_popup) surfaces.push('popup');
  if (manifest.options_page || manifest.options_ui?.page) surfaces.push('options');
  return surfaces;
}

async function openSidepanel(session) {
  const manifest = readManifest(session.extensionPath);
  if (!manifest.side_panel?.default_path) {
    const avail = availableSurfaces(manifest);
    die(`Extension does not declare a sidepanel. Available surfaces: ${avail.join(', ') || 'none'}`);
  }

  // Need at least one page target for the sidepanel to attach to
  let targets = await (await fetch(`http://localhost:${session.port}/json`)).json();
  let pages = targets.filter(t => t.type === 'page'
    && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
  if (pages.length === 0) {
    // Auto-navigate to about:blank so the sidepanel has a tab to attach to
    console.error('No page target found — opening about:blank...');
    await cdpBrowser(session.port, 'Target.createTarget', { url: 'about:blank' });
    await new Promise(r => setTimeout(r, 1000));
    targets = await (await fetch(`http://localhost:${session.port}/json`)).json();
    pages = targets.filter(t => t.type === 'page'
      && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://'));
    if (pages.length === 0) die('Could not create a page target for the sidepanel.');
  }

  const page = pages[0];
  const sidepanelPath = manifest.side_panel.default_path;

  // Connect to page target to find content script context
  const { ws, send } = await connectToTarget(page.webSocketDebuggerUrl);
  try {
    // Find extension content script context
    const extCtxId = await new Promise((res, rej) => {
      const timer = setTimeout(() => {
        ws.removeEventListener('message', handler);
        rej(new Error(
          'No content script context found. The extension may not inject content ' +
          'scripts on this page, or the URL may not match its content_scripts.matches pattern.'
        ));
      }, 5000);
      const handler = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.method === 'Runtime.executionContextCreated') {
          const ctx = msg.params.context;
          if (ctx.origin.includes(session.extensionId)) {
            ws.removeEventListener('message', handler);
            clearTimeout(timer);
            res(ctx.id);
          }
        }
      };
      ws.addEventListener('message', handler);
      send('Runtime.enable').catch(rej);
    });

    // Send open_side_panel message with userGesture
    await send('Runtime.evaluate', {
      contextId: extCtxId,
      expression: 'chrome.runtime.sendMessage({type: "open_side_panel"})',
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
  } finally {
    ws.close();
  }

  // Poll for sidepanel target
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const res = await cdpBrowser(session.port, 'Target.getTargets');
    const panel = res.targetInfos?.find(t =>
      t.url.includes(session.extensionId) && t.url.includes(sidepanelPath));
    if (panel) {
      console.log(JSON.stringify({ targetId: panel.targetId, url: panel.url }));
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.error(
    'Sidepanel declared in manifest but could not be opened programmatically. ' +
    'The extension may require a manual click on the toolbar icon, or it may ' +
    'need an "open_side_panel" message handler in its service worker.'
  );
  process.exit(1);
}

async function openPopupOrOptions(session, surface) {
  const manifest = readManifest(session.extensionPath);
  let htmlPath;

  if (surface === 'popup') {
    htmlPath = manifest.action?.default_popup;
    if (!htmlPath) {
      const avail = availableSurfaces(manifest);
      die(`Extension does not declare a popup. Available surfaces: ${avail.join(', ') || 'none'}`);
    }
  } else {
    htmlPath = manifest.options_page || manifest.options_ui?.page;
    if (!htmlPath) {
      const avail = availableSurfaces(manifest);
      die(`Extension does not declare an options page. Available surfaces: ${avail.join(', ') || 'none'}`);
    }
  }

  const url = `chrome-extension://${session.extensionId}/${htmlPath}`;
  const result = await cdpBrowser(session.port, 'Target.createTarget', { url });
  console.log(JSON.stringify({ targetId: result.targetId, url }));
}

async function cmdOpen(surface, port) {
  if (!surface) die('Usage: cdp-ext-pilot.mjs open <sidepanel|popup|options>');
  const session = loadSession(port);
  if (!session) die(`No session found for port ${port}. Run 'launch' first.`);

  switch (surface) {
    case 'sidepanel': await openSidepanel(session); break;
    case 'popup':
    case 'options':   await openPopupOrOptions(session, surface); break;
    default: die(`Unknown surface: ${surface}. Use sidepanel, popup, or options.`);
  }
}

async function cmdStatus(port) {
  const session = loadSession(port);
  if (!session) {
    console.log(JSON.stringify({ running: false }));
    process.exit(1);
  }

  let running = false;
  try { process.kill(session.pid, 0); running = true; } catch {}

  let targets = [];
  if (running) {
    try {
      const res = await fetch(`http://localhost:${port}/json`);
      const all = await res.json();
      targets = all.map(t => ({
        id: t.id, type: t.type, url: t.url, title: t.title,
      }));
    } catch {}
  }

  console.log(JSON.stringify({
    running,
    pid: session.pid,
    port: session.port,
    extensionId: session.extensionId,
    chromeVariant: session.chromeVariant,
    targets,
  }, null, 2));

  process.exit(running ? 0 : 1);
}

// --- Main ---

async function main() {
  const { command, args: cmdArgs, port } = parseArgs(process.argv);

  switch (command) {
    case 'launch': await cmdLaunch(cmdArgs[0], port); break;
    case 'open':   await cmdOpen(cmdArgs[0], port); break;
    case 'status': await cmdStatus(port); break;
    case 'close':  await cmdClose(port); break;
    default:
      console.error([
        'Usage: cdp-ext-pilot.mjs <command> [args] [--port N]',
        '',
        'Commands:',
        '  launch <ext-path>     Launch Chrome with extension loaded',
        '  open <surface>        Open sidepanel|popup|options',
        '  status                Show session state as JSON',
        '  close                 Kill Chrome and clean up',
      ].join('\n'));
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => die(err.message));
