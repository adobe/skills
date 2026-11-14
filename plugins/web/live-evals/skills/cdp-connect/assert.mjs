import { readFileSync, statSync } from 'node:fs';
import { fail, findFile, graded, ok } from '../../lib/outputs.mjs';

const PORT = 9222;
const problems = (checks) => Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

/** Evaluates `expression` in the first tab whose URL contains `page`, over the same CDP port. */
async function pageEval(expression, page = 'cdp-app.html') {
  const tabs = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
  const tab = tabs.find((t) => t.type === 'page' && t.url.includes(page));
  if (!tab) throw new Error(`no tab on ${page}`);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const result = await new Promise((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(m.data));
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  ws.close();
  return result.result?.result?.value;
}

const CHECKS = {
  greet: async (output) => ({
    'page shows the greeting': (await pageEval("document.getElementById('result').textContent")) === 'Hello, Ada!',
    'answer quotes the message': /Hello, Ada!/.test(output),
  }),
  screenshot: async (_output, response) => {
    const file = findFile(response, 'page.png');
    const png = file ? readFileSync(file) : Buffer.alloc(0);
    return {
      'png written': png.subarray(1, 4).toString() === 'PNG',
      'not empty': file ? statSync(file).size > 2000 : false,
    };
  },
  network: async (output) => ({
    'names the endpoint': /\/api\/ping\.json/.test(output),
    'reports the response': /1\.4\.2/.test(output) && /ok/i.test(output),
  }),
  'multi-tab': async (output) => ({
    'counter tab shows 3': (await pageEval("document.getElementById('count').textContent", 'cdp-counter.html')) === '3',
    'other tab untouched': (await pageEval("document.getElementById('count').textContent", 'cdp-other.html')) === '0',
    'answer reports 3': /\b3\b|three/i.test(output),
  }),
  console: async (output) => ({
    'reports the log': /counter-ready/.test(output),
    'reports the warning': /deprecated-api-used/.test(output),
  }),
  basecamp: async (output) => ({
    'tab shows the Basecamp title': (await pageEval('document.title', 'basecamp.com')) === 'Basecamp',
    'answer mentions Basecamp': /Basecamp/.test(output),
  }),
  buttons: async (output) => ({
    'lists Submit': /Submit/.test(output),
    'lists Reset': /Reset/.test(output),
  }),
};

export const cdpTaskDone = graded(async (output, { vars, providerResponse }) => {
  const failed = problems(await CHECKS[vars.check](output, providerResponse));
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
