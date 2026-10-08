#!/usr/bin/env node
/**
 * spec-martech.mjs — S9 martech from public artefacts: security headers + CSP of the origin; script/iframe hosts
 * and their reach (spec-parse signals) classified with the dynamics vendor table; the Adobe Launch library when
 * present (extensions, rules with page-path conditions and DOM selectors, data elements with their data-layer
 * paths, custom-code files and the hosts they load); OneTrust geo rule sets and cookie categories when present.
 *
 *   node spec-martech.mjs [--config spec.config.json] [--no-custom-code]
 *   node spec-martech.mjs --urls <url,url,...> [--out stardust/martech] [--no-custom-code]
 *
 * Writes <dir>/martech/headers.json, vendors.json, launch.json (+ launch.js, rc/ for custom code), onetrust.json.
 * --urls runs without a spec: the first URL is the origin's home, each URL's server HTML gives its page signals.
 * Everything read here is public (what any browser downloads); no credential is used.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  HERE, arg, flag, helpAndExit, list, loadConfig, log, parseHTML, pool, readJSON, readJSONL, writeJSON,
} from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh) stardust-spec/1.0';
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA } }); return r.ok ? r.text() : ''; };

/** The dynamics vendor table, in the plugin tree or a project copy (stardust/scripts/<skill>/). */
export function vendorTable() {
  for (const p of [join(HERE, '..', '..', 'dynamics', 'scripts', 'vendors.json'), join(HERE, '..', 'dynamics', 'vendors.json')]) {
    if (existsSync(p)) return readJSON(p).vendors.map((v) => ({ ...v, re: new RegExp(v.match, 'i') }));
  }
  return [];
}

/** Balanced {...} starting at index i. Pure. */
const block = (s, i) => { let d = 0; for (let j = i; j < s.length; j += 1) { if (s[j] === '{') d += 1; else if (s[j] === '}') { d -= 1; if (d === 0) return s.slice(i, j + 1); } } return s.slice(i); };

/** Parse a minified Adobe Launch container. Pure. */
export function parseLaunch(js) {
  const build = (js.match(/buildInfo:\{[^}]*\}/) || [''])[0];
  const extensions = [...js.matchAll(/"?([a-z0-9-]+)"?:\{displayName:"([^"]+)",hostedLibFilesBaseUrl/g)].map((m) => m[2]);
  const dataElements = [];
  const deStart = js.indexOf('dataElements:{');
  if (deStart >= 0) {
    const body = block(js, deStart + 'dataElements:'.length).slice(1, -1);
    // top-level entries: "name":{…} or name:{…}
    const re = /(?:^|,)\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*\{/g; let m;
    while ((m = re.exec(body))) {
      const def = block(body, re.lastIndex - 1); re.lastIndex = re.lastIndex - 1 + def.length;
      const type = ((def.match(/modulePath:"([^"]+)"/) || [])[1] || '').split('/').pop().replace('.js', '');
      const path = (def.match(/path:"([^"]+)"/) || def.match(/name:"([^"]+)"/) || [])[1] || null;
      const selectors = [...new Set([...def.matchAll(/(?:\$|jQuery|querySelector(?:All)?)\(\s*["']([^"']{2,120})["']/g)].map((x) => x[1]))];
      dataElements.push({ name: m[1] || m[2], type, source: path, selectors });
    }
  }
  const rules = [...js.matchAll(/\{id:"(RL[0-9a-f]+)",name:"([^"]+)"/g)].map((m) => {
    const b = block(js, m.index);
    const pathVals = [...b.matchAll(/paths:\[([^\]]*)\]/g)].flatMap((p) => [...p[1].matchAll(/value:"([^"]*)"/g)].map((x) => x[1]));
    return {
      id: m[1], name: m[2], events: [...new Set([...b.matchAll(/modulePath:"[^"]+\/events\/([^"]+)\.js"/g)].map((x) => x[1]))],
      conditions: [...new Set([...b.matchAll(/modulePath:"[^"]+\/conditions\/([^"]+)\.js"/g)].map((x) => x[1]))],
      paths: pathVals, selectors: [...b.matchAll(/elementSelector:"([^"]*)"/g)].map((x) => x[1]),
      customCode: [...b.matchAll(/source:"(https:\/\/assets\.adobedtm\.com[^"]+)"/g)].map((x) => x[1]),
      consentGroups: [...new Set(b.match(/C000\d/g) || [])],
    };
  });
  return { build, extensions: [...new Set(extensions)], dataElements, rules };
}

async function sources() {
  const urls = list(arg('urls'));
  if (!urls.length) {
    const cfg = loadConfig();
    return { origin: cfg.origin, home: `${cfg.origin}${cfg.scopePath}`, out: cfg.p('martech'), sigs: readJSONL(cfg.p('parse', 'signals.jsonl')) };
  }
  // spec-parse prints its own usage at import time, so it loads only here and never on --help
  const { pageSignals } = await import('./spec-parse.mjs');
  const { origin } = new URL(urls[0]);
  const pages = await pool(urls, 4, async (url) => { const html = await get(url); return html && { url, ...pageSignals(parseHTML(html), html, origin) }; });
  return { origin, home: urls[0], out: resolve(arg('out', 'stardust/martech')), sigs: pages.filter(Boolean) };
}

async function main() {
  const { origin, home, out, sigs } = await sources(); mkdirSync(out, { recursive: true });
  // headers
  const h = await fetch(home, { headers: { 'user-agent': UA }, redirect: 'follow' });
  const headers = Object.fromEntries([...h.headers.entries()].filter(([k]) => /^(server|via|x-|content-security-policy|strict-transport|permissions-policy|referrer-policy|cache-control|x-frame)/i.test(k) && !/^x-amz-cf-id|^x-request-id/i.test(k)));
  const csp = headers['content-security-policy'] || '';
  writeJSON(join(out, 'headers.json'), headers);
  // vendors from page signals
  const table = vendorTable();
  const reach = {}; const inline = {};
  for (const s of sigs) {
    new Set([...s.scriptHosts, ...s.iframeHosts]).forEach((hst) => { reach[hst] = (reach[hst] || 0) + 1; });
    s.inline.forEach((k) => { inline[k] = (inline[k] || 0) + 1; });
  }
  const own = new URL(origin).hostname;
  const vendors = Object.entries(reach).map(([host, pages]) => {
    const v = table.find((t) => t.re.test(host));
    return { host, pages, firstParty: host === own || host.endsWith(`.${own.replace(/^www\./, '')}`), role: v?.role || null, class: v?.class || null, inCsp: csp.includes(host.split('.').slice(-2).join('.')) };
  }).sort((a, b) => b.pages - a.pages);
  writeJSON(join(out, 'vendors.json'), { pages: sigs.length, vendors, inline, cspHosts: (csp.match(/[\w*.-]+\.[a-z]{2,}/g) || []).filter((x) => !/^'/.test(x)) });
  // Adobe Launch
  const launchUrl = (() => { for (const s of sigs) { const u = s.scripts.find((x) => /assets\.adobedtm\.com\/.*launch-[\w-]+(\.min)?\.js/.test(x)); if (u) return u.startsWith('//') ? `https:${u}` : u; } return null; })();
  let launch = null;
  if (launchUrl) {
    const js = await get(launchUrl); writeFileSync(join(out, 'launch.js'), js);
    launch = { url: launchUrl, pages: sigs.filter((s) => s.scripts.some((x) => x.includes(launchUrl.replace(/^https?:/, '')))).length, ...parseLaunch(js) };
    if (!flag('no-custom-code')) {
      const rcs = [...new Set(launch.rules.flatMap((r) => r.customCode))]; mkdirSync(join(out, 'rc'), { recursive: true });
      const codes = await pool(rcs, 6, async (u) => { const f = join(out, 'rc', u.split('/').pop()); if (!existsSync(f)) writeFileSync(f, await get(u)); return [u, readFileSync(f, 'utf8')]; });
      const byUrl = Object.fromEntries(codes);
      launch.rules.forEach((r) => {
        const src = r.customCode.map((u) => byUrl[u] || '').join('\n');
        r.loads = [...new Set((src.match(/\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/g) || []).map((x) => x.slice(2)))].filter((x) => x !== 'assets.adobedtm.com');
        r.otDomainScripts = [...new Set(src.match(/data-domain-script=\\?"([0-9a-f-]{36}(?:-test)?)/g) || [])].map((x) => x.replace(/.*"/, ''));
      });
    }
    writeJSON(join(out, 'launch.json'), launch);
  }
  // OneTrust: domain scripts from pages or Launch custom code
  const otIds = new Set();
  sigs.forEach((s) => (s.otDomainScripts || []).filter((x) => !x.endsWith('-test')).forEach((x) => otIds.add(x)));
  (launch?.rules || []).forEach((r) => (r.otDomainScripts || []).filter((x) => !x.endsWith('-test')).forEach((x) => otIds.add(x)));
  const onetrust = [];
  for (const id of otIds) {
    const conf = JSON.parse((await get(`https://cdn.cookielaw.org/consent/${id}/${id}.json`)) || '{}');
    const sets = [];
    for (const rs of conf.RuleSet || []) {
      const lang = (rs.LanguageSwitcherPlaceholder?.default) || 'en';
      const d = JSON.parse((await get(`https://cdn.cookielaw.org/consent/${id}/${rs.Id}/${lang}.json`)) || '{}').DomainData || {};
      sets.push({ name: rs.Name, type: rs.Type, countries: Array.isArray(rs.Countries) ? rs.Countries.length : 0, default: rs.Default, gpc: !!rs.GCEnable, consentModel: d.ConsentModel?.Name || d.ConsentModel || null, banner: d.ShowAlertNotice ?? null,
        languages: Object.keys(rs.LanguageSwitcherPlaceholder || {}).length,
        groups: (d.Groups || []).map((g) => ({ id: g.OptanonGroupId, name: g.GroupName, status: g.Status, hosts: (g.Hosts || []).map((x) => x.HostName) })) });
    }
    onetrust.push({ domainScript: id, version: conf.Version || null, ruleSets: sets });
  }
  if (onetrust.length) writeJSON(join(out, 'onetrust.json'), onetrust);
  log(`${vendors.length} third-party/first-party hosts; Launch ${launch ? `${launch.rules.length} rules, ${launch.dataElements.length} data elements` : 'not found'}; OneTrust ${onetrust.length} domain script(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
