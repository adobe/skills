#!/usr/bin/env node
/**
 * spec-martech.mjs — S9 martech from public artefacts: security headers + CSP of the origin; script/iframe hosts
 * and their reach (spec-parse signals) classified with the dynamics vendor table; the Adobe Launch library when
 * present (extensions, the Web SDK extension's instances and datastreams, Target via at.js or Web SDK decisions, rules with page-path conditions and DOM
 * selectors, data elements with their data-layer paths, custom-code files and the hosts they load); OneTrust geo rule sets and cookie categories when present;
 * every other tag manager's library (GTM and gtag by container id, Tealium, Ensighten, ...) saved unparsed for the model to read.
 *
 *   node spec-martech.mjs [--config <file>] [--no-custom-code] [--no-tag-libraries]
 *   node spec-martech.mjs --urls <url,url,...> [--out stardust/martech] [--no-custom-code] [--no-tag-libraries]
 *
 * Writes <work>/martech/headers.json, vendors.json, launch.json (+ launch.js, rc/ for custom code), onetrust.json,
 * tags.json (+ tags/ with each other tag-manager library), consent-mode.json (Google Consent Mode defaults, when seen).
 * --urls runs without a spec: the first URL is the origin's home, each URL's server HTML gives its page signals.
 * Everything read here is public (what any browser downloads); no credential is used.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  arg, flag, helpAndExit, list, loadConfig, loadSibling, log, parseHTML, pool, readJSONL, writeJSON,
} from './lib.mjs';

helpAndExit(import.meta.url);

const UA = 'Mozilla/5.0 (Macintosh) stardust-spec/1.0';
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA } }); return r.ok ? r.text() : ''; };

/** Balanced {...} starting at index i. Pure. */
const block = (s, i) => { let d = 0; for (let j = i; j < s.length; j += 1) { if (s[j] === '{') d += 1; else if (s[j] === '}') { d -= 1; if (d === 0) return s.slice(i, j + 1); } } return s.slice(i); };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * The Web SDK extension (`adobe-alloy`) of a Launch container: version, whether it can use a self-hosted
 * alloy.js ("preinstalled" library type), its library setting, and each instance with its datastream ids
 * (a `%Data Element%` reference resolves to the ids its definition holds). Pure.
 */
function webSdkOf(js) {
  const at = js.indexOf('"adobe-alloy":{displayName:');
  if (at < 0) return null;
  const ext = block(js, js.indexOf('{', at));
  const s = ext.indexOf('settings:{');
  const settings = s >= 0 ? block(ext, s + 'settings:'.length) : '';
  const de = (name) => {
    const i = [`${JSON.stringify(name)}:{`, `,${name}:{`].map((k) => js.indexOf(k)).find((x) => x >= 0);
    return i === undefined ? '' : block(js, js.indexOf('{', i + 1));
  };
  const ids = (v) => { if (!v) return []; const ref = v.match(/^%(.+)%$/); return [...new Set((ref ? de(ref[1]) : v).match(UUID) || [])]; };
  const instances = [...settings.matchAll(/\{name:"([^"]+)"/g)].map((m) => {
    const b = block(settings, m.index);
    const val = (k) => (b.match(new RegExp(`[{,]${k}:"([^"]*)"`)) || [])[1] || null;
    return {
      name: m[1], edgeDomain: val('edgeDomain'), defaultConsent: val('defaultConsent'),
      datastream: { ref: val('edgeConfigId'), ids: ids(val('edgeConfigId')) },
      stagingDatastream: { ref: val('stagingEdgeConfigId'), ids: ids(val('stagingEdgeConfigId')) },
    };
  });
  return {
    version: (ext.match(/\(\{version:"([\d.]+)"\}\)/) || [])[1] || null,
    selfHostable: ext.includes('PREINSTALLED:"preinstalled"'),
    library: (settings.match(/libraryCode:\{type:"([a-z]+)"/) || [])[1] || 'managed',
    instances,
  };
}

/**
 * Adobe Target in a Launch container: the at.js extension (`adobe-target` v1, `adobe-target-v2`) and the
 * Web SDK rules that render Target decisions (`renderDecisions` on a sendEvent action), plus whether the
 * Web SDK prehides content while it waits for them. Null when neither is present. Pure.
 */
function targetOf(js) {
  const atjs = ['adobe-target-v2', 'adobe-target'].find((k) => js.includes(`"${k}":{displayName:`) || js.includes(`,${k}:{displayName:`)) || null;
  const renderRules = [...js.matchAll(/\{id:"(RL[0-9a-f]+)",name:"([^"]+)"/g)]
    .filter((m) => /adobe-alloy\/[^"]*sendEvent[\s\S]*?renderDecisions:(?:!0|true)/.test(block(js, m.index)))
    .map((m) => ({ id: m[1], name: m[2] }));
  if (!atjs && !renderRules.length) return null;
  return { atjs, renderRules, prehiding: /prehidingStyle:"[^"]+"/.test(js) };
}

/** Event names a rule's data-layer push listeners wait for: `*` for any push, null when the settings name none. Pure. */
function pushEventsOf(b) {
  return [...new Set([...b.matchAll(/modulePath:"[^"]*\/events\/[^"]*data-?layer[^"]*\.js",settings:/gi)].map((m) => {
    const at = m.index + m[0].length;
    if (b[at] !== '{') return null;
    const s = block(b, at);
    const named = s.match(/(?:specificEvent|eventKey|eventName|eventType|event)\s*:\s*"([^"]+)"/);
    if (named) return named[1];
    return /allEvents:(?:!0|true)/.test(s) ? '*' : null;
  }))];
}

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
      pushEvents: pushEventsOf(b),
      conditions: [...new Set([...b.matchAll(/modulePath:"[^"]+\/conditions\/([^"]+)\.js"/g)].map((x) => x[1]))],
      paths: pathVals, selectors: [...b.matchAll(/elementSelector:"([^"]*)"/g)].map((x) => x[1]),
      customCode: [...b.matchAll(/source:"(https:\/\/assets\.adobedtm\.com[^"]+)"/g)].map((x) => x[1]),
      consentGroups: [...new Set(b.match(/C000\d/g) || [])],
    };
  });
  const orgId = (js.match(/company:\{orgId:"([^"]+)"/) || [])[1] || null;
  return { build, orgId, extensions: [...new Set(extensions)], webSdk: webSdkOf(js), target: targetOf(js), dataElements, rules };
}

/**
 * Libraries of tag managers other than Launch: script srcs the vendor table classes as a tag manager, plus GTM and
 * gtag container ids from inline snippets (their srcs lose the id). At most 10. Pure.
 */
export function tagLibraries(sigs, vendorFor) {
  const urls = new Map();
  for (const s of sigs) {
    (s.tagIds || []).forEach((id) => urls.set(`https://www.googletagmanager.com/${id.startsWith('GTM-') ? 'gtm.js' : 'gtag/js'}?id=${id}`, 'Google Tag Manager'));
    s.scripts.forEach((src) => {
      const u = src.startsWith('//') ? `https:${src}` : src; if (!/^https?:/.test(u)) return;
      const role = vendorFor(new URL(u).hostname)?.role || '';
      if (/^tag manager: /.test(role) && !/Adobe Launch|Google Tag Manager/.test(role)) urls.set(u, role.replace(/^tag manager: /, ''));
    });
  }
  return [...urls].slice(0, 10).map(([url, vendor]) => ({ vendor, url, file: `${new URL(url).hostname}-${(new URL(url).pathname.split('/').pop() || 'tag').replace(/\.js$/, '')}${new URL(url).searchParams.get('id') ? `-${new URL(url).searchParams.get('id')}` : ''}.js` }));
}

/**
 * Google Consent Mode, deterministic: pages whose inline scripts set a `consent` `default` (spec-parse), and saved
 * libraries that call it (`gtag('consent','default'…)` or a template's `setDefaultConsentState`). Null when unseen. Pure.
 */
export function consentModeOf(sigs, tags = []) {
  const pages = sigs.filter((s) => s.consentMode).length;
  const libraries = tags.filter((t) => /['"]consent['"]\s*,\s*['"]default['"]|setDefaultConsentState/.test(t.js || '')).map((t) => `tags/${t.file}`);
  return pages || libraries.length ? { pages, of: sigs.length, libraries } : null;
}

async function sources() {
  const urls = list(arg('urls'));
  if (!urls.length) {
    const cfg = loadConfig();
    return { origin: cfg.origin, home: `${cfg.origin}${cfg.scopePath}`, out: cfg.w('martech'), sigs: readJSONL(cfg.w('parse', 'signals.jsonl')) };
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
  // the dynamics vendor table (one table, read by the dynamics skill's own helpers; missing → the import fails)
  const { vendorFor, registrable } = await loadSibling('dynamics', 'lib.mjs');
  const reach = {}; const inline = {};
  for (const s of sigs) {
    new Set([...s.scriptHosts, ...s.iframeHosts]).forEach((hst) => { reach[hst] = (reach[hst] || 0) + 1; });
    s.inline.forEach((k) => { inline[k] = (inline[k] || 0) + 1; });
  }
  const own = new URL(origin).hostname;
  const vendors = Object.entries(reach).map(([host, pages]) => {
    const v = vendorFor(host);
    return { host, pages, firstParty: host === own || host.endsWith(`.${own.replace(/^www\./, '')}`), role: v?.role || null, class: v?.class || null, inCsp: csp.includes(registrable(host)) };
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
  // other tag managers: saved unparsed, for the model to read
  const tags = flag('no-tag-libraries') ? [] : (await pool(tagLibraries(sigs, vendorFor), 4, async (t) => ({ ...t, js: await get(t.url) })))
    .filter((t) => t.js && t.js.length < 5e6);
  if (tags.length) {
    mkdirSync(join(out, 'tags'), { recursive: true });
    tags.forEach((t) => writeFileSync(join(out, 'tags', t.file), t.js));
    writeJSON(join(out, 'tags.json'), tags.map(({ vendor, url, file, js }) => ({ vendor, url, file: `tags/${file}`, bytes: js.length })));
  }
  const consentMode = consentModeOf(sigs, tags);
  if (consentMode) writeJSON(join(out, 'consent-mode.json'), consentMode);
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
  log(`${vendors.length} third-party/first-party hosts; Launch ${launch ? `${launch.rules.length} rules, ${launch.dataElements.length} data elements` : 'not found'}; ${tags.length} other tag-manager librar${tags.length === 1 ? 'y' : 'ies'} saved; OneTrust ${onetrust.length} domain script(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
