/**
 * skills/spec/scripts/rules.mjs — the rule format the judgement files use for computed figures (reference/knowledge.md
 * § Rules): feature `reach`, open-question `impact`, and `{{…}}` in findings. Library, no CLI. Pure: every function
 * reads a knowledge object K and never touches the disk.
 *
 * K: { urls, pageBlocks, signals, blocks, variants, templates, features, redirects, broken, badLinks, vendors,
 *      launchRules, datalayer, metadata, queryIndexes, locales, siteConfig, searchProbes, openQuestions,
 *      sourceComponents } — arrays of rows as the knowledge files hold them (pageBlocks and signals per URL id).
 *
 * Filter      field=v[,v…]  field!=v[,v…]   a value with * is a case-insensitive glob; null matches a missing value;
 *             quote values with spaces or commas: template="a · b","c · d"
 * URL terms   live (outcome=page) · sitemap (in_sitemap=1) · nested (a block nested in another) ·
 *             block:<b>[|<variant>][,…] · signal:<glob>[,…] · verdict:<v> (a block or dynamic block whose verdict is v) ·
 *             any filter on a URL row; ! negates a term; terms are ANDed
 * Numbers     urls <terms…> · count <set> [filters…] · sum <set>.<field> [filters…] · <set>[<key>].<field> ·
 *             <set>[max:<field>].<field> (the row with the largest field) · value:<n>
 * An unknown term, set or field throws, naming the rule: a figure is computed or the build stops.
 */

const SETS = {
  urls: ['urls', 'url'], 'page-blocks': ['pageBlockRows', null], blocks: ['blocks', 'name'], 'block-variants': ['blockVariants', null],
  variants: ['variants', 'code'], templates: ['templates', 'id'], features: ['features', 'id'], redirects: ['redirects', 'src'],
  broken: ['broken', 'url'], 'bad-links': ['badLinks', null], vendors: ['vendors', 'host'], 'launch-rules': ['launchRules', 'id'],
  datalayer: ['datalayer', 'path'], metadata: ['metadata', 'name'], 'query-indexes': ['queryIndexes', 'name'], locales: ['locales', 'tree'],
  'site-config': ['siteConfig', 'key'], 'search-probes': ['searchProbes', 'term'], 'open-questions': ['openQuestions', 'id'],
  'source-components': ['sourceComponents', 'name'],
};

/** Split on spaces outside quotes and brackets. Pure. */
export function tokens(s) {
  const out = []; let cur = ''; let q = null; let br = 0;
  for (const ch of String(s).trim()) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[') br += 1; else if (ch === ']') br -= 1;
    if (/\s/.test(ch) && !br) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** A comma list with optional quotes: a,"b c",'d,e' → ['a', 'b c', 'd,e']. Pure. */
export function values(s) {
  const out = []; let cur = ''; let q = null; let quoted = false;
  for (const ch of String(s)) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; quoted = true; continue; }
    if (ch === ',') { out.push(quoted ? cur : cur.trim()); cur = ''; quoted = false; continue; }
    cur += ch;
  }
  out.push(quoted ? cur : cur.trim());
  return out;
}

const globRe = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'is');
/** One value test: glob (case-insensitive) with *, null for a missing value, else exact (numbers by their text). Pure. */
export function valueTest(v) {
  if (v === 'null') return (x) => x === null || x === undefined;
  if (v.includes('*')) { const re = globRe(v); return (x) => x !== null && x !== undefined && re.test(String(x)); }
  return (x) => x !== null && x !== undefined && String(x) === v;
}
const anyOf = (list) => { const ts = values(list).map(valueTest); return (x) => ts.some((t) => t(x)); };

function fieldFilter(term, rows, rule) {
  const m = term.match(/^([a-z_][a-z0-9_]*)(!?=)(.*)$/i);
  if (!m) return null;
  const [, field, op, list] = m;
  if (rows.length && !rows.some((r) => field in r)) throw new Error(`rule "${rule}": unknown field "${field}"`);
  const t = anyOf(list);
  return op === '=' ? (r) => t(r[field]) : (r) => !t(r[field]);
}

/** Lazy indexes over K, built once per K. */
const IDX = new WeakMap();
function idx(K) {
  if (IDX.has(K)) return IDX.get(K);
  const pb = new Map((K.pageBlocks || []).map((r) => [r.url_id, r.blocks || []]));
  const sig = new Map((K.signals || []).map((r) => [r.url_id, r.signals || []]));
  const bv = new Map();
  for (const b of K.blocks || []) for (const v of b.variants || []) bv.set(`${b.name}|${v.variant ?? ''}`, v.verdict);
  const I = { pb, sig, bv };
  IDX.set(K, I);
  return I;
}

function urlTerm(term, K, rule) {
  const neg = term.startsWith('!'); const t = neg ? term.slice(1) : term;
  const I = idx(K); let f;
  if (t === 'live') f = (u) => u.outcome === 'page';
  else if (t === 'sitemap') f = (u) => u.in_sitemap === 1;
  else if (t === 'nested') f = (u) => (I.pb.get(u.id) || []).some((b) => b.nested_in !== null && b.nested_in !== undefined);
  else if (t.startsWith('block:')) {
    const tests = values(t.slice(6)).map((x) => { const [b, ...v] = x.split('|'); const bt = valueTest(b); const vt = v.length ? valueTest(v.join('|') || 'null') : null; return (pb) => bt(pb.block) && (!vt || vt(pb.variant)); });
    f = (u) => (I.pb.get(u.id) || []).some((pb) => tests.some((x) => x(pb)));
  } else if (t.startsWith('signal:')) {
    const test = anyOf(t.slice(7));
    f = (u) => (I.sig.get(u.id) || []).some(test);
  } else if (t.startsWith('verdict:')) {
    const v = t.slice(8);
    f = (u) => (I.pb.get(u.id) || []).some((pb) => (pb.kind === 'block' || pb.kind === 'dynamic') && I.bv.get(`${pb.block}|${pb.variant ?? ''}`) === v);
  } else {
    f = fieldFilter(t, K.urls || [], rule);
    if (!f) throw new Error(`rule "${rule}": unknown term "${term}"`);
  }
  return neg ? (u) => !f(u) : f;
}

/** URL rows matching a list of terms (feature reach; `urls …`). Pure. */
export function selectUrls(K, terms, rule = terms) {
  const tl = Array.isArray(terms) ? terms : tokens(terms);
  const fs = tl.map((t) => urlTerm(t, K, rule));
  return (K.urls || []).filter((u) => fs.every((f) => f(u)));
}

function setRows(K, name, rule) {
  const s = SETS[name];
  if (!s) throw new Error(`rule "${rule}": unknown set "${name}"`);
  if (s[0] === 'pageBlockRows') return (K.pageBlocks || []).flatMap((r) => (r.blocks || []).map((b) => ({ url_id: r.url_id, ...b })));
  if (s[0] === 'badLinks') return (K.badLinks || []).flatMap((r) => ['main', 'chrome'].flatMap((zone) => (r[zone] || []).map((id) => ({ from_url_id: id, to_url: r.to_url, zone }))));
  if (s[0] === 'blockVariants') return (K.blocks || []).flatMap((b) => (b.variants || []).map((v) => ({ block: b.name, ...v })));
  return K[s[0]] || [];
}
const filtered = (rows, terms, rule) => { const fs = terms.map((t) => fieldFilter(t, rows, rule) || (() => { throw new Error(`rule "${rule}": "${t}" is not a filter (field=value)`); })()); return rows.filter((r) => fs.every((f) => f(r))); };

/** Evaluate a number rule. Pure; throws on anything it cannot compute. */
export function evalRule(K, rule) {
  const r = String(rule).trim(); const tl = tokens(r);
  if (/^value:/.test(r)) { const n = Number(r.slice(6)); if (!Number.isFinite(n)) throw new Error(`rule "${r}": not a number`); return n; }
  if (tl[0] === 'urls') return selectUrls(K, tl.slice(1), r).length;
  if (tl[0] === 'count') { if (!tl[1]) throw new Error(`rule "${r}": count needs a set`); return filtered(setRows(K, tl[1], r), tl.slice(2), r).length; }
  if (tl[0] === 'sum') {
    const m = (tl[1] || '').match(/^([a-z-]+)\.([a-z_][a-z0-9_]*)$/i);
    if (!m) throw new Error(`rule "${r}": sum needs <set>.<field>`);
    const rows = filtered(setRows(K, m[1], r), tl.slice(2), r);
    if (rows.length && !rows.some((x) => m[2] in x)) throw new Error(`rule "${r}": unknown field "${m[2]}"`);
    return rows.reduce((a, x) => a + (Number(x[m[2]]) || 0), 0);
  }
  const m = r.match(/^([a-z-]+)\[(.+)\]\.([a-z_][a-z0-9_]*)$/i);
  if (m) {
    const rows = setRows(K, m[1], r); let row;
    const top = m[2].match(/^max:([a-z_][a-z0-9_]*)$/i);
    if (top) {
      if (rows.length && !rows.some((x) => top[1] in x)) throw new Error(`rule "${r}": unknown field "${top[1]}"`);
      row = rows.reduce((a, x) => (a === undefined || (Number(x[top[1]]) || 0) > (Number(a[top[1]]) || 0) ? x : a), undefined);
    } else {
      const key = SETS[m[1]]?.[1];
      if (!key) throw new Error(`rule "${r}": set "${m[1]}" has no key`);
      const k = values(m[2])[0];
      row = rows.find((x) => String(x[key]) === k);
    }
    if (!row) throw new Error(`rule "${r}": no ${m[1]} row "${m[2]}"`);
    if (!(m[3] in row)) throw new Error(`rule "${r}": unknown field "${m[3]}"`);
    return row[m[3]];
  }
  throw new Error(`rule "${r}": unknown form (urls, count, sum, <set>[<key>].<field>, value:)`);
}

/** Replace every {{rule}} in a text with its value; returns { text, numbers }. Pure; throws on a bad rule. */
export function fillText(K, text) {
  const numbers = [];
  const out = String(text).replace(/\{\{(.+?)\}\}/g, (_, rule) => {
    const v = evalRule(K, rule); numbers.push(v);
    return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
  });
  return { text: out, numbers };
}
