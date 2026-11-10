#!/usr/bin/env node
/*
 * Interactive preview of an AEM Forms custom component, for user feedback.
 *
 * Renders the component's form JSON (<testDir>/custom-components/<name>/<name>.form.json, or one
 * generated from _<name>.json) in a local Edge Delivery Services page: the form block holds the JSON in <pre><code>
 * and the page loads the project's head.html (aem.js + scripts.js), so the real form block, rule
 * engine, mappings.js and component code run. An inspector panel shows the field's live model
 * state and a log of model changes. Files are re-read on every request: reload the page after
 * editing the component.
 *
 * Opens a visible Chromium window with the project's Playwright and runs until it is closed.
 * Without Playwright or a display (or with --no-browser) it only serves the page and prints the
 * URL; stop it with Ctrl+C / by killing the process.
 *
 * Exit codes: 0 = closed normally, 2 = usage or project error.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  extname, join, normalize, resolve, sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFormDefinition } from './create-e2e-test.mjs';
import { e2eLayout } from './e2e-layout.mjs';

const USAGE = `preview-component.mjs — open an AEM Forms custom component in a browser for manual testing

Usage:
  node preview-component.mjs <component-name> [options]

Options:
  --root <dir>     Repository root containing package.json and blocks/form (default: cwd)
  --form <file>    Form JSON to render (default: <testDir>/custom-components/<name>/<name>.form.json,
                   else generated from _<name>.json)
  --props <json>   Authored properties when the form JSON is generated, e.g. '{"maxStars":5}'
  --port <n>       Port to serve on (default: random free port)
  --no-browser     Only serve the page and print its URL (no Playwright window)
  --no-inspector   Hide the model inspector panel
  -h, --help       Show this help

Prints "PREVIEW_URL=<url>" once the server is ready. Reload the page after changing the component.

Exit codes: 0 = closed normally, 2 = usage or project error.`;

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
const DEFAULT_HEAD = `<meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="/scripts/aem.js" type="module"></script>
<script src="/scripts/scripts.js" type="module"></script>
<link rel="stylesheet" href="/styles/styles.css"/>`;

function parseArgs(argv) {
  const opts = { browser: true, inspector: true };
  const takes = new Set(['--root', '--form', '--props', '--port']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    if (flag === '-h' || flag === '--help') opts.help = true;
    else if (flag === '--no-browser') opts.browser = false;
    else if (flag === '--no-inspector') opts.inspector = false;
    else if (takes.has(flag)) {
      const value = inline ?? argv[i += 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      opts[flag.slice(2)] = value;
    } else if (flag.startsWith('-')) throw new Error(`Unknown option: ${flag}`);
    else if (!opts.name) opts.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return opts;
}

function findFieldUsing(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node[':type'] === name || node.properties?.variant === name) return node;
  const kids = Array.isArray(node.items) ? node.items : Object.values(node[':items'] || {});
  for (const kid of kids) {
    const hit = findFieldUsing(kid, name);
    if (hit) return hit;
  }
  return null;
}

/** Loads (or generates) the form JSON and makes `action` end with the form id (see SKILL.md). */
export function loadPreviewForm(name, root, { form, props } = {}) {
  let formDef;
  const saved = join(root, e2eLayout(root).dir, name, `${name}.form.json`);
  if (form) formDef = JSON.parse(readFileSync(resolve(form), 'utf8'));
  else if (existsSync(saved)) formDef = JSON.parse(readFileSync(saved, 'utf8'));
  else formDef = buildFormDefinition(name, root, props ? JSON.parse(props) : {});
  formDef = { id: `${name}-preview-form`, ...formDef };
  if (!String(formDef.action || '').endsWith(`/${formDef.id}`)) {
    formDef.action = `/adobe/forms/af/submit/${formDef.id}`;
  }
  const field = findFieldUsing(formDef, name);
  if (!field?.id) throw new Error(`The form JSON has no item with ":type" or properties.variant "${name}"`);
  return { formDef, fieldId: field.id };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Runs in the page: shows the field's live model and a log of model changes / events.
const INSPECTOR = (fieldId) => `<script type="module">
const FIELD = ${JSON.stringify(fieldId)};
const panel = document.createElement('aside');
panel.id = 'ccc-inspector';
panel.innerHTML = '<style>#ccc-inspector{position:fixed;right:12px;bottom:12px;width:340px;max-height:60vh;overflow:auto;'
  + 'z-index:2147483647;background:#1e1e1e;color:#eee;font:12px/1.4 ui-monospace,Menlo,monospace;border-radius:8px;'
  + 'box-shadow:0 4px 16px rgba(0,0,0,.3);padding:10px}#ccc-inspector h4{margin:4px 0;font-size:12px;color:#9cdcfe}'
  + '#ccc-inspector pre{margin:0;white-space:pre-wrap;word-break:break-all}#ccc-inspector ol{margin:0;padding-left:18px}'
  + '#ccc-inspector button{float:right;font-size:11px}</style>'
  + '<button type="button" id="ccc-toggle">hide</button><h4>Model: ' + FIELD + '</h4><pre id="ccc-state">waiting for form…</pre>'
  + '<h4>Model changes (latest first)</h4><ol id="ccc-log" reversed></ol>';
document.body.append(panel);
const body = [...panel.children].slice(2);
panel.querySelector('#ccc-toggle').addEventListener('click', (e) => {
  const hidden = body[0].hidden;
  body.forEach((el) => { el.hidden = !hidden; });
  e.target.textContent = hidden ? 'hide' : 'show';
});
const short = (v) => { try { const s = JSON.stringify(v); return s && s.length > 80 ? s.slice(0, 80) + '…' : s; } catch { return String(v); } };
const render = () => {
  const el = window.myForm?.getElement(FIELD);
  if (!el) return;
  const state = {};
  ['value', 'valid', 'visible', 'enabled', 'readOnly', 'required', 'errorMessage', 'enum', 'enumNames', 'properties']
    .forEach((k) => { try { if (el[k] !== undefined) state[k] = JSON.parse(JSON.stringify(el[k])); } catch { /* skip */ } });
  panel.querySelector('#ccc-state').textContent = JSON.stringify(state, null, 2);
};
const log = (text) => {
  const li = document.createElement('li');
  li.textContent = new Date().toLocaleTimeString() + ' ' + text;
  panel.querySelector('#ccc-log').prepend(li);
};
const start = () => {
  const form = window.myForm;
  if (!form) { setTimeout(start, 100); return; }
  render();
  form.subscribe((e) => {
    const { field, changes } = e.payload || {};
    (changes || []).forEach((c) => log((field?.id || '?') + '.' + c.propertyName + ' = ' + short(c.currentValue)));
    render();
  }, 'fieldChanged');
  const watch = (el) => {
    if (!el) return;
    el.subscribe?.((e) => { if (e?.type && !['change', 'fieldChanged'].includes(e.type)) log((el.id || '?') + ' event ' + e.type); });
    (el.items || []).forEach(watch);
  };
  watch(form.getElement(FIELD));
};
start();
</script>`;

/** Edge Delivery Services page whose form block holds the form JSON in <pre><code>, plus the optional inspector. */
export function previewPageHtml(formDef, root, { fieldId, inspector = true } = {}) {
  const headFile = join(root, 'head.html');
  const head = existsSync(headFile) ? readFileSync(headFile, 'utf8') : DEFAULT_HEAD;
  return `<!DOCTYPE html>
<html>
<head>
<title>Preview: ${escapeHtml(formDef.title || formDef.id)}</title>
${head}
</head>
<body>
<header></header>
<main>
<div>
<div class="form"><div><div><pre><code>${escapeHtml(JSON.stringify(formDef))}</code></pre></div></div></div>
</div>
</main>
<footer></footer>
${inspector ? INSPECTOR(fieldId) : ''}
</body>
</html>`;
}

/** Serves the repository root (fresh on every request) and the preview page at `pagePath`. */
export function startPreviewServer(root, pagePath, pageHtml, port = 0) {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const headers = { 'cache-control': 'no-store' };
    if (pathname === pagePath || pathname === '/') {
      res.writeHead(200, { ...headers, 'content-type': 'text/html' });
      res.end(typeof pageHtml === 'function' ? pageHtml() : pageHtml);
      return;
    }
    const file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(rootWithSep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { ...headers, 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(Number(port) || 0, '127.0.0.1', () => ok(server));
  });
}

async function loadChromium(root) {
  try {
    const req = createRequire(join(root, 'package.json'));
    const mod = await import(pathToFileURL(req.resolve('@playwright/test')).href);
    return mod.chromium || mod.default?.chromium || null;
  } catch {
    return null;
  }
}

async function main(opts) {
  const root = resolve(opts.root || process.cwd());
  if (!existsSync(join(root, 'blocks/form'))) throw new Error(`No blocks/form under ${root}; run from the repository root or pass --root`);
  const { name } = opts;
  if (!existsSync(join(root, 'blocks/form/components', name))) throw new Error(`No component folder blocks/form/components/${name}`);

  const pagePath = `/__preview__/${name}.html`;
  // Re-read the form JSON on each page load so edits to <name>.form.json show up on reload.
  const page = () => {
    const { formDef, fieldId } = loadPreviewForm(name, root, opts);
    return previewPageHtml(formDef, root, { fieldId, inspector: opts.inspector });
  };
  page();
  const server = await startPreviewServer(root, pagePath, page, opts.port);
  const url = `http://127.0.0.1:${server.address().port}${pagePath}`;
  console.log(`PREVIEW_URL=${url}`);

  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (!opts.browser) {
    console.log('Serving only (--no-browser). Open the URL in a browser; stop with Ctrl+C.');
    return;
  }
  const chromium = await loadChromium(root);
  if (!chromium) {
    console.log('@playwright/test not found in the project — serving only. Open the URL in a browser; stop with Ctrl+C.');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
  } catch (e) {
    console.log(`Could not open a browser window (${e.message.split('\n')[0]}) — serving only. Open the URL in a browser; stop with Ctrl+C.`);
    return;
  }
  const context = await browser.newContext({ viewport: null });
  const tab = await context.newPage();
  tab.on('pageerror', (err) => console.log(`[page error] ${err.message}`));
  tab.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().startsWith('failed to load component')) console.log(`[console] ${msg.text()}`);
  });
  await tab.goto(url);
  console.log('Browser window opened. Close it (or stop this process) to end the preview.');
  browser.on('disconnected', stop);
  context.on('close', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(USAGE);
      process.exit(0);
    }
    if (!opts.name) throw new Error('Missing <component-name>');
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  main(opts).catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  });
}

