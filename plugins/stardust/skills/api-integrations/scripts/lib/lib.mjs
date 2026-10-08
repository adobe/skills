import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { locateDynamics } from './locate.mjs';

export const WRITE_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CAPS = Object.freeze({
  responseBytes: 65536,
  bundleBytes: 2000000,
  bundlesPerPage: 20,
  formsPerPage: 5,
  clicksPerPage: 5,
  selectsPerPage: 3,
});

export const TEST_DATA = Object.freeze({
  firstName: 'Testa',
  lastName: 'Probe',
  email: 'api-probe@example.com',
  company: 'Example Inc',
  phone: '4155550123',
  message: 'api-integrations probe - please ignore',
  search: 'test',
});

export const INVALID_DATA = Object.freeze({
  firstName: 'a',
  lastName: 'b',
  email: 'not-an-email',
  phone: '123',
  company: '',
});

export const ART = Object.freeze({
  staticScan: 'stardust/api/static-candidates.json',
  observations: 'stardust/api/observations.json',
  cors: 'stardust/api/cors.json',
  inventory: 'stardust/api/inventory.json',
  contracts: 'stardust/api/contracts',
  reportMd: 'stardust/api/report.md',
  reportHtml: 'stardust/api/report.html',
  parity: 'stardust/api/parity.json',
  qaMd: 'stardust/qa/api-report.md',
  qaJson: 'stardust/qa/api-report.json',
});

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export function flag(name) { return process.argv.includes(`--${name}`); }
export function list(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }

export function readJSON(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJSON(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(obj, null, 1)}\n`);
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
}

export function provenance(script, extra = {}) {
  return { writtenBy: `api-integrations ${script}`, writtenAt: new Date().toISOString(), ...extra };
}

export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(metaUrl));
}

export function printHelpIfAsked(metaUrl) {
  if (!process.argv.includes('--help') && !process.argv.includes('-h')) return;
  const source = readFileSync(fileURLToPath(metaUrl), 'utf8');
  const [, body = ''] = source.match(/\/\*\*([\s\S]*?)\*\//) || [];
  const lines = body.split('\n').map((line) => line.replace(/^\s*\* ?/, '').trimEnd());
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  console.log(lines.join('\n'));
  process.exit(0);
}

export async function loadPlaywright() {
  const normalize = (m) => (m.chromium ? m : (m.default?.chromium ? m.default : null));
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    const mod = normalize(await import(pathToFileURL(req.resolve('playwright')).href));
    if (mod) return mod;
  } catch { /* fall through */ }
  try { const mod = normalize(await import('playwright')); if (mod) return mod; } catch { /* fall through */ }
  throw new Error('playwright not importable from the project (npm i -D playwright --no-save) — the api-integrations instruments need a browser.');
}

export function registrable(host) { return String(host || '').split(':')[0].split('.').slice(-2).join('.'); }
export function sameSite(hostA, hostB) { return registrable(hostA) === registrable(hostB); }
export function pathPattern(pathname) {
  return String(pathname || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/{hash}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}');
}
export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

let VENDORS = null;
export function vendors() {
  if (!VENDORS) {
    const table = readJSON(join(locateDynamics(), 'vendors.json'), { vendors: [] });
    VENDORS = (table.vendors || []).map((v) => ({ ...v, re: new RegExp(v.match, 'i') }));
  }
  return VENDORS;
}
export function vendorFor(hostOrUrl) { return vendors().find((v) => v.re.test(hostOrUrl)) || null; }

const CONSENT_ACCEPT = [
  '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#usercentrics-root button[data-testid="uc-accept-all-button"]',
  '[id*="accept-all" i]', '[id*="acceptAll" i]', 'button[aria-label*="accept" i]', 'button[title*="accept all" i]',
].join(', ');

export async function settlePage(page, { settleMs = 5000, scrollStep = 800, maxScroll = 8000 } = {}) {
  try { await page.click(CONSENT_ACCEPT, { timeout: 3000 }); } catch { /* no dialog */ }
  await page.waitForTimeout(settleMs);
  for (let y = 0; y < maxScroll; y += scrollStep) { await page.mouse.wheel(0, scrollStep); await page.waitForTimeout(80); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
}
