#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const DEFAULT_TIMEOUT = 5000;
const STREAM_TIMEOUT = 10000;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = { port: 9222, id: null, timeout: null };
  const positional = [];
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--port': flags.port = parseInt(raw[++i], 10); break;
      case '--id': flags.id = raw[++i]; break;
      case '--timeout': flags.timeout = parseInt(raw[++i], 10) * 1000; break;
      default: positional.push(raw[i]);
    }
  }
  return { command: positional[0], args: positional.slice(1), ...flags };
}

// --- Core ---

async function getTargets(port) {
  let res;
  try {
    res = await fetch(`http://localhost:${port}/json`);
  } catch {
    die(`Cannot connect to CDP on port ${port}. Is Chrome running with --remote-debugging-port=${port}?`);
  }
  return res.json();
}

async function connectTarget(port, targetId) {
  const targets = await getTargets(port);
  const pages = targets.filter(t => t.type === 'page');
  if (pages.length === 0) die('No page targets found');
  const target = targetId
    ? pages.find(p => p.id === targetId)
    : pages[0];
  if (!target) die(`Target ${targetId} not found. Run 'list' to see available targets.`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });
  return ws;
}

let nextId = 0;
function send(ws, method, params = {}, timeout = DEFAULT_TIMEOUT) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout after ${timeout}ms: ${method}`));
    }, timeout);
    const handler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function listen(ws, eventMethod, timeout = STREAM_TIMEOUT) {
  return new Promise((resolve) => {
    const handler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === eventMethod) {
        console.log(JSON.stringify(msg.params));
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      ws.close();
      resolve();
    }, timeout);
  });
}

// --- Commands ---

async function cmdList(port) {
  const targets = await getTargets(port);
  const pages = targets.filter(t => t.type === 'page');
  for (const p of pages) {
    console.log(`${p.id}\t${p.url}\t${p.title}`);
  }
  if (pages.length === 0) console.log('No page targets found.');
}

async function cmdNavigate(url, port, id, timeout) {
  if (!url) die('Usage: cdp.js navigate <url>');
  const ws = await connectTarget(port, id);
  await send(ws, 'Page.enable', {}, timeout);
  const result = await send(ws, 'Page.navigate', { url }, timeout);
  ws.close();
  console.log(JSON.stringify(result));
}

async function cmdEval(expr, port, id, timeout) {
  if (!expr) die('Usage: cdp.js eval <expression>');
  const ws = await connectTarget(port, id);
  const result = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  }, timeout);
  ws.close();
  if (result.exceptionDetails) {
    die(`Eval error: ${result.exceptionDetails.text}`);
  }
  const value = result.result?.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value));
}

async function cmdScreenshot(path, port, id, timeout) {
  if (!path) die('Usage: cdp.js screenshot <path>');
  const ws = await connectTarget(port, id);
  const result = await send(ws, 'Page.captureScreenshot', {
    format: 'png',
  }, timeout);
  ws.close();
  const buf = Buffer.from(result.data, 'base64');
  fs.writeFileSync(path, buf);
  console.log(`Screenshot saved: ${path} (${buf.length} bytes)`);
}

async function cmdAxTree(port, id, timeout) {
  const ws = await connectTarget(port, id);
  const result = await send(ws, 'Accessibility.getFullAXTree', {}, timeout);
  ws.close();
  for (const node of result.nodes ?? []) {
    const role = node.role?.value ?? '';
    const name = node.name?.value ?? '';
    if (role && name) console.log(`[${role}] ${name}`);
    else if (role) console.log(`[${role}]`);
  }
}

async function cmdDom(port, id, timeout) {
  const ws = await connectTarget(port, id);
  const doc = await send(ws, 'DOM.getDocument', { depth: -1 }, timeout);
  const html = await send(ws, 'DOM.getOuterHTML', {
    nodeId: doc.root.nodeId,
  }, timeout);
  ws.close();
  console.log(html.outerHTML);
}

async function cmdClick(selector, port, id, timeout) {
  if (!selector) die('Usage: cdp.js click <selector>');
  const ws = await connectTarget(port, id);
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ' + ${JSON.stringify(selector)};
      el.click();
      return 'Clicked: ' + el.tagName + ' ' + (el.textContent?.slice(0, 50) ?? '');
    })()`,
    returnByValue: true,
  }, timeout);
  ws.close();
  console.log(result.result?.value);
}

async function cmdType(selector, text, port, id, timeout) {
  if (!selector || text === undefined) die('Usage: cdp.js type <selector> <text>');
  const ws = await connectTarget(port, id);
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ' + ${JSON.stringify(selector)};
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Typed into: ' + el.tagName + '#' + (el.id || el.name || '');
    })()`,
    returnByValue: true,
  }, timeout);
  ws.close();
  console.log(result.result?.value);
}

async function cmdConsole(port, id, timeout) {
  const ws = await connectTarget(port, id);
  await send(ws, 'Runtime.enable', {}, timeout);
  console.error(`Streaming console for ${timeout / 1000}s...`);
  await listen(ws, 'Runtime.consoleAPICalled', timeout);
}

async function cmdNetwork(port, id, timeout) {
  const ws = await connectTarget(port, id);
  await send(ws, 'Network.enable', {}, timeout);
  console.error(`Streaming network for ${timeout / 1000}s...`);
  await listen(ws, 'Network.requestWillBeSent', timeout);
}

// --- Main ---

async function main() {
  const { command, args: cmdArgs, port, id, timeout } = parseArgs(process.argv);
  const t = timeout ?? DEFAULT_TIMEOUT;
  const st = timeout ?? STREAM_TIMEOUT;

  switch (command) {
    case 'list': await cmdList(port); break;
    case 'navigate': await cmdNavigate(cmdArgs[0], port, id, t); break;
    case 'eval': await cmdEval(cmdArgs[0], port, id, t); break;
    case 'screenshot': await cmdScreenshot(cmdArgs[0], port, id, t); break;
    case 'ax-tree': await cmdAxTree(port, id, t); break;
    case 'dom': await cmdDom(port, id, t); break;
    case 'click': await cmdClick(cmdArgs[0], port, id, t); break;
    case 'type': await cmdType(cmdArgs[0], cmdArgs[1], port, id, t); break;
    case 'console': await cmdConsole(port, id, st); break;
    case 'network': await cmdNetwork(port, id, st); break;
    default:
      console.error([
        'Usage: cdp.js <command> [args] [--port N] [--id ID] [--timeout SECS]',
        '',
        'Commands:',
        '  list                          Show browser tabs with IDs',
        '  navigate <url>                Navigate to URL',
        '  eval <expr>                   Evaluate JavaScript',
        '  screenshot <path>             Save screenshot as PNG',
        '  ax-tree                       Accessibility tree (primary)',
        '  dom                           Full HTML (fallback)',
        '  click <selector>              Click element',
        '  type <selector> <text>        Type into element',
        '  console [--timeout N]         Stream console events',
        '  network [--timeout N]         Stream network events',
      ].join('\n'));
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => die(err.message));
