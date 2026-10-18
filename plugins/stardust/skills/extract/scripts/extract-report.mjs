#!/usr/bin/env node
// skills/extract/scripts/extract-report.mjs — the per-page summary of the extract output: outline, modules,
// brand tokens and slot candidates of every stardust/current/pages/*.json. Read-only.
//
//   node stardust/scripts/extract/extract-report.mjs [--pages <glob>] [--json]
//
// Why: the recorded runs scripted the same per-page summary of the extract output by hand — one run alone
// wrote seven extract-analysis helpers (outline, brand tokens, slots, modules, design, review, aggregate).
// This prints that summary from stardust/current/pages/*.json, read-only.
//
// Inputs (the cwd is the project root): every stardust/current/pages/*.json except names starting with "_"
// (_crawl-log.json), sorted by code point. --pages <glob> keeps the matching ones — a pattern without "/"
// matches the slug (the file name without .json), one with "/" the project-relative path; * (never across
// "/"), ? and {a,b}. Both page shapes are read: the crawler's record (crawl.mjs — headings [{tag,text}], body,
// ctas, customProps, media.imgs, codeBlocks, dynamic.forms) and the documented one
// (reference/current-state-schema.md — headings [{level,text,style}], heroHeadline / heroLede, landmarks,
// components, cssCustomProperties, perSectionStyle, themeColor, metaDescription). A missing field is left out.
// Output (stdout): per page "== <slug>  <url>" and four indented blocks — outline, modules, brand tokens, slot
// candidates (HELP below) — then one aggregate line; --json prints one object instead, uncapped, texts whole.
// A page file that is not JSON or not an object: one stderr line "extract-report: <rel> skipped — <reason>".
// Writes nothing.
// Exit codes: 0 printed · 1 I/O error · 2 usage, no page JSON, nothing matched --pages, no page readable.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const PAGES_DIR = 'stardust/current/pages';
export const CAPS = { headings: 40, headingChars: 80, colors: 12, fonts: 6, ctas: 8, slotChars: 100 };

const HELP = `Usage:
  node stardust/scripts/extract/extract-report.mjs [--pages <glob>] [--json]
  (run from the project root)

Prints the per-page summary of the extract output — outline, modules, brand tokens, slot candidates — so
it is never scripted by hand again. Read-only: writes nothing.
Input: every ${PAGES_DIR}/*.json except names starting with "_" (_crawl-log.json), sorted by code point.
  Both shapes are read — the crawler's record and the documented one (extract's
  reference/current-state-schema.md); a missing field is left out, never an error.
  --pages <glob>  keep the matching pages: a pattern without "/" matches the slug (file name without
                  .json), one with "/" the project-relative path (${PAGES_DIR}/blog-*.json);
                  * (never across "/"), ? and {a,b} (no nesting)
  --json          one JSON object instead of the text: { "pages": [ { slug, url, outline: [{level, text}],
                  modules: { sections, components, media }, tokens: { colors: [{name, value}], fonts, other,
                  fontFamilies, themeColor }, slots: { headline: {text, from}, lede: {text, from}, title,
                  description, ctas: [{label, href}], images: {count, withAlt, withoutAlt}, sections } } ],
                  "aggregate": { pages, sectionsByPurpose, components, customProperties } } — no caps, texts whole
Output (text), per page:
  == <slug>  <url>          slug: the record's, else the file name
    outline                 h<level> <text>, indented two spaces per level below the page's top level;
                            level from "level" or the tag digit; ${CAPS.headingChars} chars, at most ${CAPS.headings} then "… <k> more"
    modules                 the main landmark's sections: <purpose> #<id>|.<first class> "<headline>"
                            (headline through headlineRef); components: <key>×<count> (count > 0, stored
                            order); a record without landmarks or components: media: images×n, videos×n,
                            iframes×n, codeBlocks×n, forms×n
    brand tokens            custom properties: <n> — colours · fonts · other (a colour value: #hex, rgb(a),
                            hsl(a), oklch, oklab, color(); a font: "font" in the name or a font-family
                            list); up to ${CAPS.colors} colours and ${CAPS.fonts} fonts as <name> <value>, by name; the
                            heading / section font families; themeColor
    slot candidates         headline (heroHeadline, else the first h1), lede (heroLede, else the first body
                            paragraph), title, description (or metaDescription), up to ${CAPS.ctas} distinct CTAs as
                            <label> → <href>, images: <n> · alt <n> · no alt <n>, one line per main section:
                            <purpose> · <headline> · <n> paragraphs · <n> lists · <n> q&a · <n> quotes;
                            texts cut at ${CAPS.slotChars} chars
  then: extract-report: <n> pages · sections by purpose: <purpose>×<n>, … · components: <key>×<sum>, …
        · custom properties: <distinct names>
A page file that is not JSON or not an object: "extract-report: <rel> skipped — <reason>" on stderr, the
rest still reported.
Exit codes: 0 printed · 1 I/O error · 2 usage (unknown flag, --pages without its value), no page JSON
  ("run extract first"), --pages matched no page, or no page readable.`;

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const byCodePoint = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// ---- pure helpers (exported for tests) ---------------------------------------------------------
/** `s` on one line, at most `n` code points, the last one "…" when cut. */
export function cut(s, n) {
  const cps = [...clean(s)];
  return cps.length <= n ? cps.join('') : `${cps.slice(0, n - 1).join('').trimEnd()}…`;
}

/** A glob (* and ? never across "/", {a,b} without nesting) as an anchored RegExp. */
export function globToRegExp(glob) {
  const part = (s) => [...s].map((c) => {
    if (c === '*') return '[^/]*';
    if (c === '?') return '[^/]';
    return c.replace(/[\\^$.|+()[\]{}/]/g, '\\$&');
  }).join('');
  let re = '';
  let rest = glob;
  for (let at = rest.indexOf('{'); at >= 0; at = rest.indexOf('{')) {
    const end = rest.indexOf('}', at + 1);
    if (end < 0) break;
    re += `${part(rest.slice(0, at))}(?:${rest.slice(at + 1, end).split(',').map(part).join('|')})`;
    rest = rest.slice(end + 1);
  }
  return new RegExp(`^${re}${part(rest)}$`, 'u');
}

/** Page file names → [{ file, slug, rel }]: *.json, not "_…", sorted by code point, kept by `glob` when given. */
export function selectPages(names, glob = null) {
  const pages = names.filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort(byCodePoint)
    .map((file) => ({ file, slug: file.slice(0, -'.json'.length), rel: `${PAGES_DIR}/${file}` }));
  if (glob == null) return pages;
  const pattern = glob.replace(/^\.\//, '');
  const re = globToRegExp(pattern);
  return pages.filter((p) => re.test(pattern.includes('/') ? p.rel : p.slug));
}

export function parseArgs(argv) {
  const o = { pages: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--pages') {
      if (o.pages !== null) throw new UsageError('--pages given twice');
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--') || v === '-h') throw new UsageError('--pages needs a value (a glob)');
      o.pages = v;
      i += 1;
    } else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else throw new UsageError(`unexpected argument ${a} — use --pages <glob>`);
  }
  return o;
}

const COLOR_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])|(?:rgba?|hsla?|oklch|oklab|color)\()/i;
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const QUOTED = /^(["']).+\1$/;
const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2').trim();

/** A CSS font-family list: family names only, with a generic family or (two or more items) a quoted name. */
export function isFontFamilyList(value) {
  const items = String(value ?? '').split(',').map((s) => s.trim());
  if (!items[0]) return false;
  if (!items.every((it) => QUOTED.test(it) || /^-?[a-z][\w-]*(?: [\w-]+)*$/i.test(it))) return false;
  return items.some((it) => GENERIC_FAMILIES.has(unquote(it).toLowerCase())) || (items.length > 1 && items.some((it) => QUOTED.test(it)));
}

/** 'color' (the value is a colour) | 'font' ("font" in the name, or a font-family list) | 'other'. */
export function classifyToken(name, value) {
  const v = String(value ?? '').trim();
  if (COLOR_RE.test(v)) return 'color';
  if (/font/i.test(name) || isFontFamilyList(v)) return 'font';
  return 'other';
}

/** The page's custom properties from either shape, first name wins; null when the record carries neither field. */
export function customProps(record) {
  const doc = record.cssCustomProperties;
  const crawled = record.customProps;
  if (!Array.isArray(doc) && !isMap(crawled)) return null;
  const seen = new Map();
  const add = (name, value) => {
    if (typeof name !== 'string' || !name || seen.has(name)) return;
    seen.set(name, typeof value === 'string' ? value.trim() : String(value ?? ''));
  };
  for (const p of arr(doc)) if (isMap(p)) add(p.name, p.value);
  if (isMap(crawled)) for (const [k, v] of Object.entries(crawled)) add(k, v);
  return [...seen].map(([name, value]) => ({ name, value }));
}

const headingLevel = (h) => {
  const n = Number(h.level);
  if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
  const m = /^h([1-6])$/i.exec(typeof h.tag === 'string' ? h.tag : '');
  return m ? Number(m[1]) : null;
};
const primaryFamily = (stack) => unquote(String(stack ?? '').split(',')[0].trim());
const count = (v) => (Array.isArray(v) ? v.length : 0);

/** One page record (either shape) → { slug, url, outline, modules, tokens, slots }, uncapped. */
export function summarizePage(record, fileSlug) {
  const raw = arr(record.headings);
  const headings = raw.filter(isMap);
  // headlineRef indexes the record's own headings[], odd entries included
  const headingText = (i) => (Number.isInteger(i) && isMap(raw[i]) ? clean(raw[i].text) : '');
  const s = { slug: clean(record.slug) || fileSlug };
  if (clean(record.url)) s.url = clean(record.url);
  s.outline = headings.map((h) => ({ level: headingLevel(h), text: clean(h.text) })).filter((h) => h.level && h.text);

  // modules
  const modules = {};
  const main = arr(record.landmarks).find((l) => isMap(l) && (l.tag === 'main' || l.role === 'main'));
  const children = main ? arr(main.children).filter(isMap) : [];
  if (main) {
    modules.sections = children.map((c) => {
      const sec = {};
      if (clean(c.purpose)) sec.purpose = clean(c.purpose);
      if (clean(c.id)) sec.id = clean(c.id);
      const cls = arr(c.classes).map(clean).find(Boolean);
      if (cls) sec.class = cls;
      if (headingText(c.headlineRef)) sec.headline = headingText(c.headlineRef);
      return sec;
    });
  }
  if (isMap(record.components)) {
    modules.components = {};
    for (const [k, v] of Object.entries(record.components)) {
      const n = k === 'other' ? count(v) : (typeof v === 'number' ? v : Number(isMap(v) ? v.count : 0));
      if (Number.isFinite(n) && n > 0) modules.components[k] = n;
    }
  }
  const media = isMap(record.media) ? record.media : null;
  const images = media ? (Array.isArray(media.imgs) ? media.imgs : media.images) : undefined;
  if (!Array.isArray(record.landmarks) && !isMap(record.components)) {
    const forms = [record.forms, record.dynamic?.forms, record.dynamic?.dynamicDom?.forms, record.dynamicDom?.forms].find(Array.isArray);
    const m = {};
    if (Array.isArray(images)) m.images = images.length;
    if (media && Array.isArray(media.videos)) m.videos = media.videos.length;
    if (media && Array.isArray(media.iframes)) m.iframes = media.iframes.length;
    if (Array.isArray(record.codeBlocks)) m.codeBlocks = record.codeBlocks.length;
    if (forms) m.forms = forms.length;
    if (Object.keys(m).length) modules.media = m;
  }
  s.modules = modules;

  // brand tokens
  const tokens = {};
  const props = customProps(record);
  if (props) {
    const sorted = [...props].sort((a, b) => byCodePoint(a.name, b.name));
    tokens.colors = sorted.filter((p) => classifyToken(p.name, p.value) === 'color');
    tokens.fonts = sorted.filter((p) => classifyToken(p.name, p.value) === 'font');
    tokens.other = sorted.length - tokens.colors.length - tokens.fonts.length;
  }
  const families = [
    ...headings.map((h) => (isMap(h.style) ? h.style.fontFamily : null)),
    ...arr(record.perSectionStyle).filter(isMap).flatMap((p) => arr(p.fontFamilies)),
  ].filter((f) => typeof f === 'string').map(primaryFamily).filter(Boolean);
  if (families.length) tokens.fontFamilies = [...new Set(families)];
  if (record.themeColor != null && record.themeColor !== '') tokens.themeColor = record.themeColor;
  s.tokens = tokens;

  // slot candidates
  const slots = {};
  const h1 = s.outline.find((h) => h.level === 1);
  if (clean(record.heroHeadline)) slots.headline = { text: clean(record.heroHeadline), from: 'heroHeadline' };
  else if (h1) slots.headline = { text: h1.text, from: 'h1' };
  const firstBody = arr(record.body).map(clean).find(Boolean);
  if (clean(record.heroLede)) slots.lede = { text: clean(record.heroLede), from: 'heroLede' };
  else if (firstBody) slots.lede = { text: firstBody, from: 'body' };
  if (clean(record.title)) slots.title = clean(record.title);
  const description = clean(record.description) || clean(record.metaDescription);
  if (description) slots.description = description;
  if (Array.isArray(record.ctas)) {
    const ctas = new Map();
    for (const c of record.ctas.filter(isMap)) {
      const label = clean(c.label) || clean(c.text);
      if (!label || ctas.has(label)) continue;
      ctas.set(label, clean(c.href) ? { label, href: clean(c.href) } : { label });
    }
    slots.ctas = [...ctas.values()];
  }
  if (Array.isArray(images)) {
    const withAlt = images.filter((im) => isMap(im) && clean(im.alt)).length;
    slots.images = { count: images.length, withAlt, withoutAlt: images.length - withAlt };
  }
  if (main) {
    slots.sections = children.map((c) => {
      const sec = {};
      if (clean(c.purpose)) sec.purpose = clean(c.purpose);
      if (headingText(c.headlineRef)) sec.headline = headingText(c.headlineRef);
      return { ...sec, paragraphs: count(c.body), lists: count(c.lists), qa: count(c.qa), quotes: count(c.quotes) };
    });
  }
  s.slots = slots;
  return s;
}

const tally = (entries) => Object.fromEntries([...entries].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0])));

/** Summaries (and each page's custom property names) → { pages, sectionsByPurpose, components, customProperties }. */
export function aggregate(summaries, propNames = []) {
  const purposes = new Map();
  const components = new Map();
  for (const s of summaries) {
    for (const sec of arr(s.modules.sections)) if (sec.purpose) purposes.set(sec.purpose, (purposes.get(sec.purpose) ?? 0) + 1);
    for (const [k, n] of Object.entries(s.modules.components ?? {})) components.set(k, (components.get(k) ?? 0) + n);
  }
  return {
    pages: summaries.length,
    sectionsByPurpose: tally(purposes),
    components: tally(components),
    customProperties: new Set(propNames.flat()).size,
  };
}

const times = (o) => Object.entries(o).map(([k, n]) => `${k}×${n}`).join(', ');
const more = (lines, total, shown, what) => { if (total > shown) lines.push(`    … ${total - shown} more${what ? ` ${what}` : ''}`); };
const themeText = (t) => (isMap(t) ? Object.entries(t).map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
  : typeof t === 'string' ? t : JSON.stringify(t));

/** One summary → the text lines of its four blocks (capped, texts cut). */
export function formatPage(s) {
  const C = CAPS;
  const lines = [`== ${cut(s.slug, 200)}${s.url ? `  ${cut(s.url, 200)}` : ''}`];
  const block = (title, body) => { lines.push(`  ${title}`); if (body.length) lines.push(...body); else lines.push('    (none)'); };

  const outline = [];
  const top = s.outline.reduce((m, h) => Math.min(m, h.level), 6);
  for (const h of s.outline.slice(0, C.headings)) outline.push(`    ${'  '.repeat(h.level - top)}h${h.level} ${cut(h.text, C.headingChars)}`);
  more(outline, s.outline.length, C.headings);
  block('outline', outline);

  const modules = [];
  for (const sec of s.modules.sections ?? []) {
    const at = sec.id ? ` #${sec.id}` : sec.class ? ` .${sec.class}` : '';
    modules.push(`    ${sec.purpose ?? '-'}${at}${sec.headline ? ` "${cut(sec.headline, C.headingChars)}"` : ''}`);
  }
  if (s.modules.components && Object.keys(s.modules.components).length) modules.push(`    components: ${times(s.modules.components)}`);
  if (s.modules.media) modules.push(`    media: ${times(s.modules.media)}`);
  block('modules', modules);

  const tokens = [];
  const t = s.tokens;
  if (t.colors) {
    tokens.push(`    custom properties: ${t.colors.length + t.fonts.length + t.other} — colours ${t.colors.length} · fonts ${t.fonts.length} · other ${t.other}`);
    for (const c of t.colors.slice(0, C.colors)) tokens.push(`    colour ${c.name} ${cut(c.value, C.headingChars)}`);
    more(tokens, t.colors.length, C.colors, 'colours');
    for (const f of t.fonts.slice(0, C.fonts)) tokens.push(`    font ${f.name} ${cut(f.value, C.headingChars)}`);
    more(tokens, t.fonts.length, C.fonts, 'fonts');
  }
  if (t.fontFamilies) tokens.push(`    font families: ${t.fontFamilies.join(', ')}`);
  if (t.themeColor !== undefined) tokens.push(`    themeColor: ${cut(themeText(t.themeColor), C.slotChars)}`);
  block('brand tokens', tokens);

  const slots = [];
  const sl = s.slots;
  const n = C.slotChars;
  if (sl.headline) slots.push(`    headline (${sl.headline.from}): ${cut(sl.headline.text, n)}`);
  if (sl.lede) slots.push(`    lede (${sl.lede.from}): ${cut(sl.lede.text, n)}`);
  if (sl.title) slots.push(`    title: ${cut(sl.title, n)}`);
  if (sl.description) slots.push(`    description: ${cut(sl.description, n)}`);
  for (const c of (sl.ctas ?? []).slice(0, C.ctas)) slots.push(`    cta: ${cut(c.label, n)}${c.href ? ` → ${cut(c.href, n)}` : ''}`);
  more(slots, sl.ctas?.length ?? 0, C.ctas, 'ctas');
  if (sl.images) slots.push(`    images: ${sl.images.count} · alt ${sl.images.withAlt} · no alt ${sl.images.withoutAlt}`);
  for (const sec of sl.sections ?? []) {
    const head = [sec.purpose ?? '-', ...(sec.headline ? [cut(sec.headline, n)] : [])];
    slots.push(`    section: ${[...head, `${sec.paragraphs} paragraphs`, `${sec.lists} lists`, `${sec.qa} q&a`, `${sec.quotes} quotes`].join(' · ')}`);
  }
  block('slot candidates', slots);
  return lines;
}

export function formatAggregate(a) {
  const part = (o) => (Object.keys(o).length ? times(o) : 'none');
  return `extract-report: ${a.pages} page${a.pages === 1 ? '' : 's'} · sections by purpose: ${part(a.sectionsByPurpose)} · components: ${part(a.components)} · custom properties: ${a.customProperties}`;
}

// ---- main --------------------------------------------------------------------------------------
const NO_PAGES = `no page JSON under ${PAGES_DIR} (run extract first)`;

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const o = parseArgs(argv);
  let names;
  try { names = readdirSync(PAGES_DIR); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new UsageError(NO_PAGES);
    throw e;
  }
  if (!selectPages(names).length) throw new UsageError(NO_PAGES);
  const picked = selectPages(names, o.pages);
  if (!picked.length) throw new UsageError(`--pages ${o.pages} matched no page`);

  const summaries = [];
  const propNames = [];
  for (const p of picked) {
    let text;
    try { text = readFileSync(`${PAGES_DIR}/${p.file}`, 'utf8'); } catch (e) {
      if (e.code === 'EISDIR') { console.error(`extract-report: ${p.rel} skipped — a directory`); continue; }
      throw e;
    }
    let record;
    try { record = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
      console.error(`extract-report: ${p.rel} skipped — not JSON (${String(e.message).split('\n')[0]})`);
      continue;
    }
    if (!isMap(record)) {
      console.error(`extract-report: ${p.rel} skipped — not an object (${Array.isArray(record) ? 'array' : record === null ? 'null' : typeof record})`);
      continue;
    }
    summaries.push(summarizePage(record, p.slug));
    propNames.push((customProps(record) ?? []).map((x) => x.name));
  }
  if (!summaries.length) throw new UsageError(`no page reported — ${picked.length} skipped`);
  const agg = aggregate(summaries, propNames);
  if (o.json) console.log(JSON.stringify({ pages: summaries, aggregate: agg }));
  else console.log([...summaries.flatMap(formatPage), formatAggregate(agg)].join('\n'));
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  // process.exitCode, not process.exit(): a large report on a pipe must drain first.
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    console.error(`extract-report: ${String(e?.message ?? e).split('\n')[0]}`);
    process.exitCode = e instanceof UsageError ? e.code : 1;
  }
}
