/**
 * skills/dynamics/scripts/martech.mjs — martech evidence → contract (stack, consent, routes, vendors).
 * Pure: no browser, network or files. Account ids are captured, never invented.
 */
/* eslint-disable no-restricted-syntax, max-len */
import { vendorFor, registrable } from './lib.mjs';

const ID_RULES = {
  configId: /^[\w-]{8,64}$/,
  id: /^(?:G|GTM|AW|DC|UA)-[\w-]{2,24}$/i,
  tid: /^(?:G|UA)-[\w-]{2,24}$/i,
  l: /^[A-Za-z_$][\w$]{0,40}$/,
};
export const ID_PARAMS = Object.keys(ID_RULES);
const MARTECH_PATH = /\/ee\/(?:[\w-]+\/)?v1\/|\/b\/ss\/|\/g\/collect|\/gtm\.js$|\/gtag\/js$|launch-[\w-]+(?:\.min)?\.js$|\/utag\.js$|alloy(?:\.min)?\.js$/i;
const LAUNCH = /^https:\/\/assets\.adobedtm\.com\/[^?#]*launch-[\w-]+(?:\.min)?\.js/i;
const TEALIUM = /^https:\/\/tags\.tiqcdn\.com\/utag\/[^?#]+\/utag\.js/i;
const EE = /\/ee\/(?:[\w-]+\/)?v1\//;
const ALLOY = /alloy(?:\.min)?\.js$/i;
const G_ID = /^G-[A-Z0-9]{4,16}$/;
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;
const ORG = /^[0-9A-F]{24}@AdobeOrg$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const STATIC_ATTRS = ['id', 'data-domain-script', 'data-cbid', 'data-blockingmode'];
const STACK_ROUTES = {
  'adobe-launch': /^adobe-(launch|websdk)/,
  'adobe-websdk': /^adobe-(websdk|analytics)/,
  'adobe-ecid': /^adobe-(websdk|analytics)/,
  'adobe-appmeasurement': /^adobe-analytics/,
  'adobe-target': /^adobe-analytics/,
  gtm: /^google-/,
  'google-tag': /^google-/,
  ga4: /^google-gtm-martech/,
  tealium: /^tealium/,
};
const TMS_ROWS = new Set(['adobe-launch', 'gtm', 'google-tag', 'tealium', 'tms-other']);
const CATEGORY_MAPS = {
  onetrust: { analytics: 'C0002', functional: 'C0003', personalization: 'C0003', marketing: 'C0004' },
  cookiebot: { analytics: 'statistics', functional: 'preferences', personalization: 'preferences', marketing: 'marketing' },
  none: { analytics: null, functional: null, personalization: null, marketing: null },
};
const CMP_SRC = {
  onetrust: 'https://cdn.cookielaw.org/scripttemplates/otSDKStub.js',
  cookiebot: 'https://consent.cookiebot.com/uc.js',
};

const uniq = (a) => [...new Set(a.filter(Boolean))];
const toUrl = (u, base) => { try { return new URL(u, base); } catch { return null; } };
const hostOf = (u) => toUrl(u)?.host || null;
/** matches host + path only: query strings carry unrelated vendor words */
export function rowFor(urlOrHost) {
  const u = toUrl(/^https?:\/\//.test(urlOrHost) ? urlOrHost : `https://${urlOrHost}/`);
  return u ? vendorFor(`${u.host}${u.pathname}`) : null;
}

/** keeps only id-shaped query params so no per-visitor value (cid, requestId, …) is stored */
export function reduceUrl(url) {
  const u = toUrl(url);
  if (!u) return null;
  const q = new URLSearchParams();
  for (const [k, re] of Object.entries(ID_RULES)) { const v = u.searchParams.get(k); if (v && re.test(v)) q.set(k, v); }
  const qs = q.toString();
  return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`.slice(0, 300);
}

export function isMartechUrl(url) {
  const u = toUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) return false;
  return Boolean(rowFor(url)?.category) || MARTECH_PATH.test(u.pathname);
}

export function parseStaticHtml(html, baseUrl) {
  const out = { staticScripts: [], inlineHosts: [], inlineIds: [], inlineConfigIds: [] };
  for (const m of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4];
    if (attrs.src) {
      const src = toUrl(attrs.src, baseUrl)?.href;
      if (src && isMartechUrl(src)) out.staticScripts.push({ src: src.slice(0, 300), attrs: Object.fromEntries(STATIC_ATTRS.filter((k) => attrs[k]).map((k) => [k, attrs[k].slice(0, 80)])) });
    } else if (!/json|template|html/i.test(attrs.type || '')) {
      const body = m[2];
      for (const h of body.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) if (rowFor(h[1].toLowerCase())?.category) out.inlineHosts.push(h[1].toLowerCase());
      for (const t of body.matchAll(/\b(GTM-[A-Z0-9]{4,12}|G-[A-Z0-9]{4,16}|[0-9A-F]{24}@AdobeOrg)\b/g)) out.inlineIds.push(t[1]);
      for (const c of body.matchAll(/(?:datastreamId|edgeConfigId)["']?\s*:\s*["']([\w-]{8,64})["']/g)) out.inlineConfigIds.push(c[1]);
    }
  }
  out.inlineHosts = uniq(out.inlineHosts);
  out.inlineIds = uniq(out.inlineIds);
  out.inlineConfigIds = uniq(out.inlineConfigIds);
  return out;
}

const orgFromCookie = (name) => {
  const m = String(name).match(/^AMCV_([0-9A-F]{24})(?:%40|@)AdobeOrg$/i) || String(name).match(/^kndctr_([0-9A-F]{24})_AdobeOrg_/i);
  return m ? `${m[1].toUpperCase()}@AdobeOrg` : null;
};

export function extractIds(ev) {
  const statics = ev.staticScripts || [];
  const urls = uniq([...(ev.urls || []), ...statics.map((s) => s.src)]);
  const parsed = urls.map((u) => toUrl(u)).filter(Boolean);
  const inline = ev.inlineIds || [];
  const gtm = new Map();
  for (const u of parsed) {
    const id = u.searchParams.get('id');
    if (/\/gtm\.js$/.test(u.pathname) && GTM_ID.test(id || '') && !gtm.has(id)) gtm.set(id, { id, src: reduceUrl(u.href), dataLayer: u.searchParams.get('l') || 'dataLayer' });
  }
  for (const id of inline.filter((t) => GTM_ID.test(t))) if (!gtm.has(id)) gtm.set(id, { id, src: `https://www.googletagmanager.com/gtm.js?id=${id}`, dataLayer: 'dataLayer' });
  const gtag = parsed.filter((u) => /\/gtag\/js$/.test(u.pathname));
  const staticGtag = statics.map((s) => toUrl(s.src)).filter((u) => u && /\/gtag\/js$/.test(u.pathname));
  const attr = (name) => statics.map((s) => s.attrs?.[name]).find(Boolean) || null;
  const pathId = (re) => urls.map((u) => (u.match(re) || [])[1]).find(Boolean) || null;
  return {
    launchUrls: uniq(urls.map((u) => (u.match(LAUNCH) || [])[0])),
    datastreamIds: uniq([...parsed.filter((u) => EE.test(u.pathname)).map((u) => u.searchParams.get('configId')), ...(ev.inlineConfigIds || [])]).filter((x) => ID_RULES.configId.test(x)),
    orgIds: uniq([...(ev.cookieNames || []).map(orgFromCookie), ...inline.filter((t) => ORG.test(t))]),
    rsids: uniq(parsed.flatMap((u) => ((u.pathname.match(/\/b\/ss\/([^/]+)\//) || [])[1] || '').split(','))),
    targetClients: uniq(parsed.map((u) => (u.host.match(/^([\w-]+)\.tt\.omtrdc\.net$/) || [])[1])),
    ga4: uniq([...parsed.flatMap((u) => [u.searchParams.get('id'), u.searchParams.get('tid')]), ...inline]).filter((x) => G_ID.test(x)),
    ga4Direct: uniq([...staticGtag.map((u) => u.searchParams.get('id')), ...inline]).filter((x) => G_ID.test(x)),
    gtm: [...gtm.values()],
    dataLayer: [...gtm.values()][0]?.dataLayer || gtag.map((u) => u.searchParams.get('l')).find(Boolean) || 'dataLayer',
    onetrust: attr('data-domain-script') || pathId(new RegExp(`cookielaw\\.org/consent/(${UUID.source})`, 'i')),
    cookiebot: attr('data-cbid') || pathId(new RegExp(`cookiebot\\.com/(${UUID.source})/`, 'i')),
    cookiebotBlockingMode: attr('data-blockingmode'),
    tealium: uniq(urls.map((u) => (u.match(TEALIUM) || [])[0])),
  };
}

export function fingerprint(ev, ids = extractIds(ev)) {
  const statics = ev.staticScripts || [];
  const refs = [...statics.map((s) => s.src), ...(ev.urls || []), ...(ev.hosts || [])];
  const rows = refs.map((r) => ({ ref: r, row: rowFor(r) })).filter((x) => x.row);
  const has = (id) => rows.some((x) => x.row.id === id);
  const alloyDirect = statics.some((s) => ALLOY.test(toUrl(s.src)?.pathname || ''));
  const launch = ids.launchUrls.length > 0;
  const cmpHit = rows.find((x) => /^consent:/.test(x.row.role));
  const fp = {
    alloyDirect,
    launch,
    websdk: alloyDirect || has('adobe-websdk') || ids.datastreamIds.length > 0,
    appmeasurement: has('adobe-appmeasurement') || ids.rsids.length > 0,
    target: has('adobe-target'),
    gtm: ids.gtm.length > 0,
    ga4: ids.ga4.length > 0 || has('ga4'),
    ga4Direct: ids.ga4Direct.length > 0,
    tealium: ids.tealium.length > 0,
    tms: launch || ids.gtm.length > 0 || ids.tealium.length > 0 || has('tms-other'),
    cmp: cmpHit ? { id: cmpHit.row.id, role: cmpHit.row.role, src: statics.find((s) => rowFor(s.src)?.id === cmpHit.row.id)?.src || null } : null,
  };
  fp.selfHosted = alloyDirect || (fp.websdk && !fp.tms);
  fp.stack = [
    fp.cmp && fp.cmp.role.replace(/^consent: /, ''),
    launch && 'Adobe Launch',
    fp.websdk && `Adobe Web SDK${fp.selfHosted ? ' (self-hosted)' : launch ? ' (in Launch)' : ' (in tag manager)'}`,
    fp.appmeasurement && 'Adobe Analytics (AppMeasurement)',
    fp.target && 'Adobe Target',
    fp.gtm && 'Google Tag Manager',
    fp.ga4 && `GA4${fp.ga4Direct ? ' (direct gtag)' : fp.gtm ? ' (in GTM)' : ''}`,
    fp.tealium && 'Tealium',
  ].filter(Boolean);
  return fp;
}

const base = (o) => ({ id: o.id, loader: o.loader, src: null, config: null, category: 'analytics', enabled: true, status: 'host-gated', upgrade: null, fallback: null, evidence: [], ...o });

export function route(fp, ids, ev) {
  const routes = [];
  if (fp.selfHosted) {
    const missing = [!ids.datastreamIds[0] && 'datastreamId', !ids.orgIds[0] && 'orgId'].filter(Boolean);
    routes.push(base({
      id: 'adobe-websdk',
      loader: 'aem-martech',
      config: { datastreamId: ids.datastreamIds[0] || null, orgId: ids.orgIds[0] || null, launchUrls: ids.launchUrls },
      enabled: !missing.length,
      status: missing.length ? 'scaffolded-awaiting-owner' : 'host-gated',
      fallback: ids.launchUrls[0] ? { loader: 'url', src: ids.launchUrls[0] } : null,
      evidence: [...ids.datastreamIds, ...ids.orgIds].slice(0, 4),
      ...(missing.length && { missing }),
    }));
  } else if (fp.launch) {
    ids.launchUrls.forEach((src, i) => routes.push(base({ id: i ? `adobe-launch-${i + 1}` : 'adobe-launch', loader: 'url', src, upgrade: 'aem-martech', evidence: [hostOf(src)] })));
  } else if (fp.appmeasurement || fp.target) {
    routes.push(base({ id: 'adobe-analytics', loader: 'aem-martech', config: { datastreamId: null, orgId: ids.orgIds[0] || null, launchUrls: [] }, enabled: false, status: 'scaffolded-awaiting-owner', upgrade: 'aem-martech', missing: ['datastreamId'], evidence: [...ids.rsids, ...ids.targetClients].slice(0, 4) }));
  }
  const gtmFallback = ids.gtm[0] ? { loader: 'gtm', src: ids.gtm[0].src, config: { dataLayerInstanceName: ids.dataLayer } } : null;
  if (fp.ga4Direct) {
    routes.push(base({ id: 'google-gtm-martech', loader: 'aem-gtm-martech', config: { tags: ids.ga4Direct, containers: { lazy: ids.gtm.map((g) => g.id), delayed: [] }, dataLayerInstanceName: ids.dataLayer }, fallback: gtmFallback, evidence: [...ids.ga4Direct, ...ids.gtm.map((g) => g.id)].slice(0, 4) }));
  } else {
    ids.gtm.forEach((g, i) => routes.push(base({ id: i ? `google-tag-manager-${i + 1}` : 'google-tag-manager', loader: 'gtm', src: g.src, config: { dataLayerInstanceName: g.dataLayer }, upgrade: fp.ga4 ? 'aem-gtm-martech' : null, evidence: [g.id] })));
  }
  ids.tealium.forEach((src, i) => routes.push(base({ id: i ? `tealium-${i + 1}` : 'tealium', loader: 'url', src, evidence: [hostOf(src)] })));
  const count = {};
  for (const s of ev.staticScripts || []) {
    const row = rowFor(s.src);
    if (!row?.category || STACK_ROUTES[row.id] || TMS_ROWS.has(row.id) || /^consent:/.test(row.role)) continue;
    count[row.id] = (count[row.id] || 0) + 1;
    routes.push(base({ id: count[row.id] > 1 ? `${row.id}-${count[row.id]}` : row.id, loader: 'url', src: s.src, category: row.category, evidence: [hostOf(s.src)] }));
  }
  return routes;
}

export function inventory(ev, fp, routes, consent) {
  const statics = ev.staticScripts || [];
  const inlineHosts = new Set(ev.inlineHosts || []);
  const seen = new Map();
  const covered = new Set();
  const urlRefs = [...statics.map((s) => s.src), ...(ev.urls || [])];
  for (const ref of [...urlRefs, ...(ev.hosts || [])]) {
    const isUrl = /^https?:\/\//.test(ref);
    const host = isUrl ? hostOf(ref) : ref;
    const row = rowFor(ref);
    if (!row?.category || !host || (!isUrl && covered.has(registrable(host)))) continue;
    covered.add(registrable(host));
    const key = `${row.id}:${registrable(host)}`;
    if (seen.has(key)) continue;
    const direct = statics.find((s) => rowFor(s.src)?.id === row.id && registrable(hostOf(s.src)) === registrable(host));
    const via = direct ? 'direct' : inlineHosts.has(host) ? 'inline' : fp.tms && !TMS_ROWS.has(row.id) ? 'tag-manager' : 'runtime';
    const routed = STACK_ROUTES[row.id] ? routes.find((r) => STACK_ROUTES[row.id].test(r.id)) : routes.find((r) => direct && r.src === direct.src);
    let status = 'scaffolded-awaiting-owner';
    if (/^consent:/.test(row.role)) status = consent.status;
    else if (routed) status = routed.status;
    else if (via === 'tag-manager') status = 'via-tag-manager';
    seen.set(key, { id: row.id, role: row.role, category: row.category, host, via, status, src: direct?.src || null, ...(via === 'inline' && !routed && { upgrade: 'inline-snippet' }) });
  }
  return [...seen.values()];
}

function consentFor(fp, ids, ev) {
  const flags = [];
  const pre = (ev.preConsentHosts || []).filter((h) => !/^consent:/.test(rowFor(h)?.role || ''));
  if (fp.cmp && pre.length) flags.push(`source-fires-before-consent: ${pre.slice(0, 6).join(', ')} — the EDS site waits for consent`);
  if (!fp.cmp) {
    flags.push('no-cmp-on-source: tags stay off until the owner sets consent.policy');
    return { cmp: null, cmpId: null, src: null, policy: 'owner-decision', status: 'scaffolded-awaiting-owner', categories: CATEGORY_MAPS.none, flags };
  }
  const cmpId = ids[fp.cmp.id] || null;
  if (CMP_SRC[fp.cmp.id] && cmpId) {
    if (fp.cmp.id === 'cookiebot' && ids.cookiebotBlockingMode === 'auto') flags.push('cookiebot-auto-blocking-dropped: the EDS runtime gates tags itself');
    return { cmp: fp.cmp.id, cmpId, src: CMP_SRC[fp.cmp.id], policy: 'cmp', status: 'host-gated', categories: CATEGORY_MAPS[fp.cmp.id], flags };
  }
  flags.push(CMP_SRC[fp.cmp.id] ? `cmp-id-missing: ${fp.cmp.role} seen without its account id` : `cmp-adapter-missing: no runtime adapter for ${fp.cmp.role}`);
  return { cmp: fp.cmp.id, cmpId, src: fp.cmp.src, policy: 'owner-decision', status: 'scaffolded-awaiting-owner', categories: CATEGORY_MAPS.none, flags };
}

export function buildContract({ evidence = {}, hosts = [], provenance = {} } = {}) {
  const ids = extractIds(evidence);
  const fp = fingerprint(evidence, ids);
  const consent = consentFor(fp, ids, evidence);
  const routes = route(fp, ids, evidence);
  const vendors = inventory(evidence, fp, routes, consent);
  const keptIds = Object.fromEntries(Object.entries(ids).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
  return { version: 1, productionHosts: uniq(hosts), stack: fp.stack, consent, routes, vendors, ids: keptIds, _provenance: provenance };
}

const cell = (v) => String(v ?? '').replace(/\|/g, '/');
export function renderHandoff(c) {
  const actions = [];
  actions.push(`Confirm the production hosts: ${c.productionHosts.map((h) => `\`${h}\``).join(', ') || '(none recorded — add them)'}. Tags load only there; \`*.aem.page\`, \`*.aem.live\` and localhost never load one.`);
  if (c.consent.policy === 'owner-decision') actions.push('Set `consent.policy`: `cmp` with a supported CMP id, or `none-required` where no consent law applies. Until then no tag loads (`?consent=accept` tests a page).');
  for (const r of c.routes.filter((x) => x.status === 'scaffolded-awaiting-owner')) actions.push(`Supply ${(r.missing || ['the account ids']).map((m) => `\`${m}\``).join(' + ')} for \`${r.id}\`, then set \`enabled: true\`.`);
  for (const r of c.routes.filter((x) => x.upgrade)) actions.push(`Optional: move \`${r.id}\` to the \`${r.upgrade}\` plugin (faster first paint, consent wired in).`);
  const viaTms = c.vendors.filter((v) => v.status === 'via-tag-manager');
  if (viaTms.length) actions.push(`Confirm in the tag manager that these fire on the production host: ${viaTms.map((v) => v.role.replace(/^[^:]+: /, '')).join(', ')}.`);
  const manual = c.vendors.filter((v) => v.status === 'scaffolded-awaiting-owner' && !/^consent:/.test(v.role));
  if (manual.length) actions.push(`Re-add by hand (inline or script-loaded on the source): ${manual.map((v) => `${v.role.replace(/^[^:]+: /, '')} (${v.via})`).join(', ')}.`);
  for (const f of c.consent.flags) actions.push(`Note: ${f}.`);
  return [
    `<!-- stardust provenance: ${cell(c._provenance?.writtenBy)} · ${cell(c._provenance?.writtenAt)} -->`,
    '# Martech handoff', '',
    `Source stack: ${c.stack.join(' · ') || 'no martech detected'}. Edit \`stardust/martech-contract.json\`, then re-run \`deploy/martech-scaffold.mjs\`.`, '',
    '## Consent', '',
    `- CMP: ${c.consent.cmp || 'none'}${c.consent.cmpId ? ` (\`${c.consent.cmpId}\`)` : ''} · policy \`${c.consent.policy}\` · ${c.consent.status}`, '',
    '## Routes', '',
    '| id | loader | category | enabled | status | upgrade |', '|---|---|---|---|---|---|',
    ...c.routes.map((r) => `| ${r.id} | ${r.loader} | ${r.category} | ${r.enabled} | ${r.status} | ${r.upgrade || ''} |`),
    '', '## Vendors', '',
    '| vendor | category | via | status |', '|---|---|---|---|',
    ...c.vendors.map((v) => `| ${cell(v.role)} | ${v.category} | ${v.via} | ${v.status} |`),
    '', '## Owner actions', '',
    ...actions.map((a) => `- ${a}`),
  ].join('\n');
}
