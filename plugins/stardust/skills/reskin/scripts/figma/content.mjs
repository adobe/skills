// skills/reskin/scripts/figma/content.mjs — Figma as the CONTENT source (reskin Phase 2′, Figma-only sites).
// Pure: one page frame from the Figma REST nodes response → a content-model.json of source.kind "figma"
// (reference/content-model.md § Figma-sourced models), the flags the run report lists, the assets to fetch
// and the chrome slots. figma-donor.mjs content does the I/O (figma/content-run.mjs); figma-text-gate.mjs
// re-reads the same tree through textReference() and never through the model.
//
// Rules, each recorded in the model's _provenance:
//   visibility   effective: a node is hidden when it or any ancestor is visible:false.
//   order        auto-layout frames: child order (absolutely positioned children after, geometric);
//                other frames: geometric (rows by vertical overlap ≥ 50 %, then x). Overlapping text in a
//                geometric frame is listed as ambiguous for a human to confirm.
//   segmentation the page frame's top-level children sorted by y; chrome (header, nav, footer by name)
//                leaves the body; content-less layers fold away; overlapping bands merge; a body of one
//                wrapper whose content children form ≥ 2 bands is descended.
//   casing       text = characters with textCase applied (UPPER, LOWER, TITLE; SMALL_CAPS leaves innerText
//                unchanged); characters and textCase stay as side fields for the renderer.
//   headings     from the donor's type roles (donor-tokens.json type.display|h1…h6 fontSize); a size above
//                the body that matches no role is flagged; the first heading is the page h1.
//   links        per-run hyperlink (URL or NODE) and prototype interactions (URL, NODE): http(s), mailto,
//                tel or a root-relative path only; NODE targets resolve to a page slug; anything else is
//                flagged and left as "#". Nothing is invented: SEO, alt text and link targets are flagged.
// Design strings are untrusted: the model keeps them raw and every renderer escapes them; layer names
// never become class tokens unless they pass block-name validation (safeClassToken).

export const MODEL_VERSION = 2;
export const SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
export const ORDER_RULE = 'auto-layout: child order (absolute children after, geometric); otherwise geometric: rows by vertical overlap >= 50%, then x';
export const VISIBILITY_RULE = 'effective: hidden when the node or any ancestor is visible:false';
export const SEGMENT_RULE = 'top-level children by y; chrome by name leaves the body; content-less layers fold; overlapping bands merge; a single wrapper with >= 2 content bands is descended';

export const DEFAULT_RULES = {
  chrome: { header: '^(page )?header$|^nav(igation)?( bar)?$|^top ?bar$|^site header$', footer: '^(page )?footer$|^site footer$' },
  kinds: [
    { match: '\\b(button|btn|cta)\\b', kind: 'button' },
    { match: '\\b(checkbox|radio|toggle|switch)\\b', kind: 'check' },
    { match: '\\b(select|dropdown|combo ?box)\\b', kind: 'select' },
    { match: '\\b(input|text ?field|text ?area|search ?field)\\b', kind: 'field' },
    { match: '\\b(icons?|glyph)\\b', kind: 'icon' },
    { match: '\\b(logos?)\\b', kind: 'logo' },
    { match: '\\b(tabs?|carousel|slider|accordion|stepper)\\b', kind: 'interactive' },
  ],
  linkNames: '\\blinks?\\b',
};

const KIT_WORDS = new Set(['button', 'button text', 'label', 'link', 'title', 'heading', 'subtitle', 'subheading', 'text', 'placeholder', 'caption', 'headline', 'body text', 'your text here', 'sample text', 'click here', 'tag', 'lorem', 'lorem ipsum']);
const KIT_TERMS = /\b(heading|headline|title|subtitle|placeholder|caption|lorem)\b/i;

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const visible = (n) => n && n.visible !== false;
const box = (n) => n?.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
const isText = (n) => n?.type === 'TEXT';
const imageFill = (n) => (n.fills || []).find((f) => f.type === 'IMAGE' && f.visible !== false);
const solidFill = (n) => (n.fills || []).find((f) => f.type === 'SOLID' && f.visible !== false && (f.opacity ?? 1) > 0 && (f.color?.a ?? 1) > 0);
const VECTORISH = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'ELLIPSE', 'RECTANGLE', 'STAR', 'REGULAR_POLYGON']);

export const safeId = (id) => String(id).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Layer names are design input: a class token from one must pass block-name validation, else none.
export function safeClassToken(name) {
  const t = String(name ?? '').trim().toLowerCase().replace(/[\s_/]+/g, '-').replace(/^[.\-]+|-+$/g, '');
  return /^[a-z][a-z0-9-]{0,63}$/.test(t) ? t : '';
}

// The link allowlist (#310's sanitization contract): http(s), mailto, tel or a root-relative path.
export function safeHref(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { href: '#', rejected: 'empty' };
  if (s.startsWith('/') && !s.startsWith('//') && !/[\s\\]/.test(s)) return { href: s };
  let u;
  try { u = new URL(s); } catch { return { href: '#', rejected: `not an absolute URL or a root-relative path: ${s.slice(0, 80)}` }; }
  if (!SCHEMES.includes(u.protocol)) return { href: '#', rejected: `scheme ${u.protocol} not allowed` };
  return { href: s };
}

// CSS text-transform as Chrome renders it, so the model's text equals the render's innerText.
export function applyCase(s, textCase) {
  const str = String(s ?? '');
  if (textCase === 'UPPER') return str.toUpperCase();
  if (textCase === 'LOWER') return str.toLowerCase();
  if (textCase === 'TITLE') return str.replace(/(^|[^\p{L}\p{N}\p{M}'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return str;
}
export const CSS_CASE = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize', SMALL_CAPS: 'small-caps', SMALL_CAPS_FORCED: 'all-small-caps' };

export function titleFromName(name) {
  const s = norm(name);
  const pair = s.match(/^[^=,]+=\s*([^,]+)/);
  return norm(pair ? pair[1] : s);
}

// ---- rules ---------------------------------------------------------------------------------------------------
export function compileRules(rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules, chrome: { ...DEFAULT_RULES.chrome, ...(rules.chrome || {}) } };
  const kinds = [...(rules.kinds || []), ...DEFAULT_RULES.kinds].map((k) => ({ re: new RegExp(k.match, 'i'), kind: k.kind }));
  return {
    header: new RegExp(r.chrome.header, 'i'),
    footer: new RegExp(r.chrome.footer, 'i'),
    kinds,
    linkName: new RegExp(r.linkNames, 'i'),
    pages: r.pages || {},
  };
}
const cleanName = (s) => norm(String(s ?? '').replace(/^[.\s_]+/, '').replace(/[/]+/g, ' '));

export function kindOf(n, rules, lookup = {}) {
  if (!n || isText(n)) return null;
  const names = [n.name, lookup.componentSet?.(n), lookup.component?.(n)].filter(Boolean).map(cleanName);
  for (const k of rules.kinds) if (names.some((nm) => k.re.test(nm))) return k.kind;
  return null;
}

export function chromeRole(n, rules) {
  const nm = cleanName(n.name).toLowerCase();
  if (rules.header.test(nm)) return 'header';
  if (rules.footer.test(nm)) return 'footer';
  return null;
}

// ---- reading order -------------------------------------------------------------------------------------------
function geometric(kids) {
  const sorted = [...kids].sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x);
  const rows = [];
  for (const k of sorted) {
    const b = box(k);
    const row = rows.find((r) => {
      const top = Math.max(r.y, b.y); const bottom = Math.min(r.y + r.h, b.y + b.height);
      return bottom - top >= 0.5 * Math.min(r.h || 1, b.height || 1);
    });
    if (row) { row.items.push(k); row.y = Math.min(row.y, b.y); row.h = Math.max(row.y + row.h, b.y + b.height) - row.y; } else rows.push({ y: b.y, h: b.height, items: [k] });
  }
  return rows.sort((a, b) => a.y - b.y).flatMap((r) => r.items.sort((a, b) => box(a).x - box(b).x));
}

const hasText = (n) => visible(n) && (isText(n) ? norm(n.characters).length > 0 : (n.children || []).some(hasText));
const hasContent = (n) => visible(n) && (hasText(n) || Boolean(imageFill(n)) || (n.children || []).some(hasContent));
const overlap = (a, b) => {
  const A = box(a); const B = box(b);
  return Math.min(A.x + A.width, B.x + B.width) > Math.max(A.x, B.x) && Math.min(A.y + A.height, B.y + B.height) > Math.max(A.y, B.y);
};

export function orderedChildren(n, log) {
  const kids = (n.children || []).filter(visible);
  if (n.layoutMode && n.layoutMode !== 'NONE') {
    const flow = kids.filter((k) => k.layoutPositioning !== 'ABSOLUTE');
    const abs = kids.filter((k) => k.layoutPositioning === 'ABSOLUTE');
    log?.rule(n, 'auto-layout');
    if (abs.some(hasText)) log?.ambiguous(n, 'absolutely positioned text inside an auto-layout frame');
    return [...flow, ...geometric(abs)];
  }
  if (kids.length > 1) {
    log?.rule(n, 'geometric');
    const texty = kids.filter(hasText);
    for (let i = 0; i < texty.length; i += 1) {
      for (let j = i + 1; j < texty.length; j += 1) if (overlap(texty[i], texty[j])) log?.ambiguous(n, `overlapping text layers ${texty[i].id} and ${texty[j].id}`);
    }
  }
  return geometric(kids);
}

// ---- segmentation --------------------------------------------------------------------------------------------
export function segment(frame, rules) {
  const tops = (frame.children || []).filter(visible).sort((a, b) => box(a).y - box(b).y);
  const chrome = { header: [], footer: [] };
  let body = [];
  const folded = [];
  for (const k of tops) {
    const role = chromeRole(k, rules);
    if (role) chrome[role].push(k);
    else if (hasContent(k)) body.push(k);
    else folded.push(k.id);
  }
  const bands = (nodes) => {
    const out = [];
    for (const n of [...nodes].sort((a, b) => box(a).y - box(b).y)) {
      const b = box(n);
      const last = out[out.length - 1];
      if (last && b.y < last.y + last.h - 1) { last.nodes.push(n); last.h = Math.max(last.h, b.y + b.height - last.y); } else out.push({ y: b.y, h: b.height, nodes: [n] });
    }
    return out;
  };
  let descended = 0;
  let result = bands(body);
  while (result.length === 1 && result[0].nodes.length === 1) {
    const only = result[0].nodes[0];
    const inner = (only.children || []).filter(hasContent);
    const innerBands = bands(inner);
    if (innerBands.length < 2) break;
    body = inner; result = innerBands; descended += 1;
  }
  return { chrome, sections: result, folded, descended };
}

// ---- text runs -----------------------------------------------------------------------------------------------
// characters + characterStyleOverrides + styleOverrideTable → runs of equal effective style.
export function textRuns(n) {
  const chars = String(n.characters ?? '');
  const ovr = n.characterStyleOverrides || [];
  const table = n.styleOverrideTable || {};
  const base = n.style || {};
  const runs = [];
  for (let i = 0; i < chars.length; i += 1) {
    const id = ovr[i] ?? 0;
    const last = runs[runs.length - 1];
    if (last && last.id === id) last.end = i + 1;
    else runs.push({ id, start: i, end: i + 1 });
  }
  return runs.map((r) => {
    const o = r.id ? table[String(r.id)] || {} : {};
    const style = { ...base, ...o };
    return { start: r.start, end: r.end, chars: chars.slice(r.start, r.end), textCase: style.textCase || null, hyperlink: o.hyperlink ?? base.hyperlink ?? null, decoration: style.textDecoration || null };
  });
}

// ---- the builder ---------------------------------------------------------------------------------------------
export function buildContentModel({ frame, fileKey, version, slug, tokens = null, rules: rawRules = {}, lookup = {}, assets = () => null, capturedAt, responsive = null, pageName = null }) {
  if (!frame?.children) throw new Error(`frame ${frame?.id ?? '(none)'} has no children: pass a page frame`);
  const rules = compileRules(rawRules);
  const flags = [];
  const flag = (id, severity, node, detail, slot = null) => flags.push({ id, severity, node: node ?? null, slot, detail });
  const orderLog = { rules: {}, ambiguous: [] };
  const log = {
    rule: (n, r) => { orderLog.rules[r] = (orderLog.rules[r] || 0) + 1; },
    ambiguous: (n, why) => { if (!orderLog.ambiguous.some((a) => a.node === n.id && a.why === why)) orderLog.ambiguous.push({ node: n.id, name: norm(n.name), why }); },
  };
  const needs = new Map();
  const decorative = [];

  // heading roles from the donor's type ramp
  const px = (v) => { const m = String(v ?? '').match(/^(\d+(?:\.\d+)?)px$/); return m ? Number(m[1]) : null; };
  const type = tokens?.type || {};
  const roles = Object.entries(type).filter(([k, v]) => /^(display|h[1-6])$/.test(k) && px(v?.fontSize)).map(([k, v]) => ({ role: k, size: px(v.fontSize), level: k === 'display' ? 1 : Number(k[1]) }));
  const bodySize = px(type.body?.fontSize) || 16;
  function headingOf(n) {
    const size = n.style?.fontSize;
    if (!size) return null;
    const exact = roles.find((r) => Math.abs(r.size - size) < 0.5);
    if (exact) return { level: exact.level, role: exact.role };
    if (size < bodySize * 1.25) return null;
    const nearest = [...roles].sort((a, b) => Math.abs(a.size - size) - Math.abs(b.size - size))[0];
    flag('heading.ambiguous', 'review', n.id, `${size}px matches no donor type role; ${nearest ? `nearest ${nearest.role} (${nearest.size}px)` : 'no heading roles in donor-tokens'}`);
    return nearest ? { level: nearest.level, role: nearest.role } : { level: 2, role: null };
  }

  function linkOf(n, where) {
    const actions = (n.interactions || []).flatMap((it) => it.actions || (it.action ? [it.action] : []));
    for (const a of actions) {
      if (a?.type === 'URL' && a.url) return resolveLink({ type: 'URL', url: a.url }, n, where);
      if (a?.type === 'NODE' && a.destinationId && (a.navigation ?? 'NAVIGATE') === 'NAVIGATE') return resolveLink({ type: 'NODE', nodeID: a.destinationId }, n, where);
    }
    return null;
  }
  function resolveLink(h, n, where) {
    if (h.type === 'NODE') {
      const slugFor = rules.pages[h.nodeID] ?? rules.pages[String(h.nodeID).replace(/:/g, '-')];
      if (slugFor) return { href: `/${String(slugFor).replace(/^\/+/, '')}` };
      flag('link.unresolved', where === 'chrome' ? 'info' : 'review', n.id, `NODE link to ${h.nodeID} is not a known page (rules.pages)`);
      return { href: '#' };
    }
    const r = safeHref(h.url);
    if (r.rejected) flag('link.rejected', 'block', n.id, r.rejected);
    return { href: r.href };
  }
  const ctaNode = (text, href, n, extra = {}) => ({ kind: 'cta', text, href, absHref: href, classes: extra.buttonLike ? 'button' : 'link', node: n.id, ...extra });

  function imageNode(n, { svg = false } = {}) {
    const fill = svg ? null : imageFill(n);
    const key = svg ? `svg:${n.id}` : fill.imageRef;
    if (!needs.has(key)) needs.set(key, { key, kind: svg ? 'svg' : 'fill', node: n.id, imageRef: fill?.imageRef ?? null, name: safeId(n.id) });
    const got = assets(key);
    const b = box(n);
    const node = { kind: 'image', currentSrc: got?.src ?? `assets/${safeId(n.id)}.${svg ? 'svg' : 'png'}`, alt: null, w: Math.round(b.width), h: Math.round(b.height), node: n.id };
    if (fill) {
      node.scaleMode = fill.scaleMode || 'FILL';
      if (fill.imageTransform) { node.imageTransform = fill.imageTransform; flag('image.crop', 'info', n.id, 'the frame crops this image (imageTransform); the uncropped bytes are used with a CSS cover fit'); }
    }
    if (!got) node.missing = true;
    return node;
  }

  // one TEXT node → stream nodes
  function textNodes(n, where, ground) {
    const chars = String(n.characters ?? '');
    if (!norm(chars)) return [];
    const base = n.style || {};
    if (ground === 'image') flag('legibility.over-image', 'review', n.id, 'text sits on an image with no solid fill between: check contrast');
    if (base.textTruncation === 'ENDING') flag('text.truncated', 'info', n.id, `truncated to ${base.maxLines ?? 1} line(s) in the design; the full string is kept and clamped in CSS`);
    const runs = textRuns(n);
    const caseOf = runs.map((r) => r.textCase).find(Boolean) || null;
    const lines = n.lineTypes && n.lineTypes.some((t) => t && t !== 'NONE') ? n.lineTypes : null;
    const side = (s, tc) => (tc && tc !== 'ORIGINAL' ? { characters: norm(s), textCase: tc } : {});
    const trunc = base.textTruncation === 'ENDING' ? { truncation: { maxLines: base.maxLines ?? 1 } } : {};
    const runNodes = (rs) => {
      const out = [];
      for (const r of rs) {
        const text = norm(applyCase(r.chars, r.textCase));
        if (!text) continue;
        const prev = out[out.length - 1];
        const sep = prev && (/^\s/.test(r.chars) || /\s$/.test(prev._raw)) ? ' ' : '';
        if (r.hyperlink) {
          const { href } = resolveLink(r.hyperlink, n, where);
          out.push({ ...ctaNode(text, href, n), sep, _raw: r.chars, ...side(r.chars, r.textCase) });
        } else out.push({ kind: 'text', text, parentTag: 'span', parentClass: '', sep, _raw: r.chars, ...side(r.chars, r.textCase) });
      }
      for (const o of out) delete o._raw;
      if (out.length) out[0].sep = '';
      return out;
    };
    const fromRuns = (rs, kind, extra = {}) => {
      const kids = runNodes(rs);
      if (!kids.length) return null;
      const text = norm(kids.map((k, i) => (i ? k.sep : '') + k.text).join(''));
      if (kids.length === 1 && kids[0].kind === 'cta') return { ...kids[0], ...extra, sep: ' ' };
      const node = { kind, text, node: n.id, sep: ' ', ...extra };
      if (kids.some((k) => k.kind === 'cta')) node.children = kids;
      else if (kids.length === 1) Object.assign(node, side(rs.map((r) => r.chars).join(''), kids[0].textCase));
      else if (rs.every((r) => r.textCase === rs[0].textCase) && rs[0].textCase) Object.assign(node, side(rs.map((r) => r.chars).join(''), rs[0].textCase));
      else if (kids.some((k) => k.textCase)) node.children = kids;
      return node;
    };
    const slice = (start, end) => runs.filter((r) => r.end > start && r.start < end).map((r) => ({ ...r, chars: r.chars.slice(Math.max(0, start - r.start), end - r.start), start: Math.max(r.start, start), end: Math.min(r.end, end) }));
    if (lines) {
      const out = [];
      let at = 0;
      chars.split('\n').forEach((line, i) => {
        const t = lines[i] || 'NONE';
        const rs = slice(at, at + line.length);
        at += line.length + 1;
        const node = fromRuns(rs, t === 'NONE' ? 'paragraph' : 'listItem', t === 'NONE' ? {} : { listType: t === 'ORDERED' ? 'ordered' : 'unordered', display: 'list-item' });
        if (node) out.push(node);
      });
      return out;
    }
    const h = where === 'body' ? headingOf(n) : null;
    const linkWhole = linkOf(n, where);
    if (linkWhole) return [{ ...ctaNode(norm(applyCase(chars, caseOf)), linkWhole.href, n), sep: ' ', ...side(chars, caseOf), ...trunc }];
    if (h) return [{ kind: 'heading', level: `h${h.level}`, role: h.role, text: norm(applyCase(chars, caseOf)), node: n.id, sep: ' ', ...side(chars, caseOf), ...trunc }];
    const p = fromRuns(runs, 'paragraph', trunc);
    return p ? [p] : [];
  }

  const textsIn = (n) => {
    const out = [];
    (function walk(x) {
      if (!visible(x)) return;
      if (isText(x)) { if (norm(x.characters)) out.push(x); return; }
      for (const c of orderedChildren(x, log)) walk(c);
    }(n));
    return out;
  };
  const caseText = (t) => { const tc = textRuns(t).map((r) => r.textCase).find(Boolean); return norm(applyCase(t.characters, tc)); };

  // a drawn form field: label texts above the box, the box's text as the placeholder, the rest after
  function fieldNodes(n, kind) {
    const texts = textsIn(n);
    if (!texts.length) return [];
    let boxNode = null;
    (function find(x) {
      if (!visible(x) || isText(x) || boxNode) return;
      if (x !== n && (x.strokes || []).some((s) => s.visible !== false) && textsIn(x).length) { boxNode = x; return; }
      for (const c of x.children || []) find(c);
    }(n));
    const inBox = boxNode ? textsIn(boxNode) : [texts[texts.length - 1]];
    const outside = texts.filter((t) => !inBox.includes(t));
    const boxTop = boxNode ? box(boxNode).y : box(inBox[0]).y;
    const above = outside.filter((t) => box(t).y + box(t).height <= boxTop + 1);
    const label = above.filter((t) => !rules.linkName.test(cleanName(t.name)));
    const links = above.filter((t) => rules.linkName.test(cleanName(t.name)));
    const after = outside.filter((t) => !above.includes(t));
    const value = norm(inBox.map((t) => t.characters).join(' '));
    const mask = /^[*•●·]{3,}$/.test(value.replace(/\s/g, ''));
    const tall = boxNode && box(boxNode).height > 2.5 * (inBox[0]?.style?.lineHeightPx || 24);
    const out = [];
    if (label.length) out.push({ kind: 'text', text: norm(label.map(caseText).join(' ')), parentTag: 'label', parentClass: '', node: label[0].id, sep: ' ' });
    for (const t of links) { flag('link.unresolved', 'review', t.id, `"${norm(t.characters).slice(0, 40)}" is drawn as a link with no target`); out.push(ctaNode(caseText(t), '#', t, { sep: ' ' })); }
    if (kind === 'select') out.push({ kind: 'formControl', control: 'select', name: '', text: value, options: [value], selectedIndex: 0, node: n.id, textNodes: inBox.map((t) => t.id), sep: ' ' });
    else out.push({ kind: 'formControl', control: tall ? 'textarea' : 'input', inputType: mask ? 'password' : 'text', name: '', text: '', placeholder: value, node: n.id, textNodes: inBox.map((t) => t.id), sep: ' ' });
    flag('field.inferred', 'info', n.id, `drawn ${kind}: label "${norm(label.map((t) => t.characters).join(' ')).slice(0, 40)}", ${mask ? 'masked value (password)' : `placeholder "${value.slice(0, 40)}"`}`);
    for (const t of after) out.push(...textNodes(t, 'body', null));
    return out;
  }

  function emit(n, where, ground) {
    if (!visible(n)) return [];
    if (isText(n)) return textNodes(n, where, ground);
    const out = [];
    const fill = imageFill(n);
    const kind = kindOf(n, rules, lookup);
    const nextGround = solidFill(n) ? 'solid' : fill ? 'image' : ground;
    if (fill && kind !== 'icon' && kind !== 'logo') {
      out.push(imageNode(n));
      flag('image.alt', where === 'chrome' ? 'info' : 'review', n.id, 'no alt text in Figma: write it or mark the image decorative');
    }
    const link = linkOf(n, where);
    if (kind === 'icon' || (!hasText(n) && !fill && isVectorOnly(n))) {
      if (link) return [ctaNode('', link.href, n, { children: [imageNode(n, { svg: true })] })];
      decorative.push(n.id);
      return out;
    }
    if (kind === 'logo') {
      const img = imageNode(n, { svg: !fill });
      flag('image.alt', 'info', n.id, 'logo: alt text from the brand name is the author\'s call');
      return [...out, link ? ctaNode('', link.href, n, { children: [img] }) : img];
    }
    const art = kind === 'button' || fill ? null : artOf(n);
    if (art === 'backdrop') {
      decorative.push(n.id);
      flag('image.decorative', 'info', n.id, `"${cleanName(n.name)}" sits behind text or bleeds past the frame: a backdrop motif, left to the band's CSS`);
      return out;
    }
    if (art === 'media' || art === 'placeholder') {
      const img = imageNode(n, { svg: true });
      if (art === 'placeholder') flag('image.placeholder', 'review', n.id, `"${cleanName(n.name)}" is an empty fill frame standing in for media: supply the real image`);
      flag('image.alt', where === 'chrome' ? 'info' : 'review', n.id, 'no alt text in Figma: write it or mark the image decorative');
      return [...out, link ? ctaNode('', link.href, n, { children: [img] }) : img];
    }
    const nestedButtons = kind === 'button' && orderedChildren(n).filter((c) => hasText(c) && kindOf(c, rules, lookup) === 'button').length > 1;
    if (kind === 'button' && !nestedButtons) {
      const label = norm(textsIn(n).map(caseText).join(' '));
      if (!label) { decorative.push(n.id); return out; }
      if (link) return [...out, ctaNode(label, link.href, n, { buttonLike: true, sep: ' ' })];
      return [...out, { kind: 'text', text: label, parentTag: 'button', parentClass: '', inButton: true, node: n.id, sep: ' ' }];
    }
    if (kind === 'check') {
      const label = norm(textsIn(n).map(caseText).join(' '));
      const radio = /radio/i.test(cleanName(n.name));
      return [...out, { kind: 'formControl', control: 'input', inputType: radio ? 'radio' : 'checkbox', name: '', text: '', node: n.id, sep: ' ' }, ...(label ? [{ kind: 'text', text: label, parentTag: 'label', parentClass: '', node: n.id, sep: ' ' }] : [])];
    }
    if (kind === 'field' || kind === 'select') return [...out, ...fieldNodes(n, kind)];
    if (kind === 'interactive') flag('interactive.flatten', 'review', n.id, `"${cleanName(n.name)}" looks interactive: its default state is the content, other states are declared deltas (keep vs flatten is the author's call)`);
    const kids = orderedChildren(n, log).flatMap((c) => emit(c, where, nextGround));
    if (link && kids.length) {
      const text = norm(kids.map((k) => k.text || '').join(' '));
      return [...out, ctaNode(text, link.href, n, { buttonLike: Boolean(solidFill(n) || (n.strokes || []).length), children: kids.map((k) => ({ ...k })) })];
    }
    return [...out, ...kids];
  }
  // A text-less vector/fill composition larger than an icon is artwork the stream would otherwise drop
  // silently: content media (an illustration, or an empty fill frame standing in for media), unless it sits
  // behind the band's text or bleeds past the frame (a backdrop motif). An auto-layout row of two or more
  // such items (a logo strip) recurses so each item is its own image. Thin rules (lines, dividers) stay out.
  let bandTexts = [];
  const textBoxesIn = (nodes) => {
    const out = [];
    (function walk(x) { if (!visible(x)) return; if (isText(x)) out.push(box(x)); (x.children || []).forEach(walk); }({ children: nodes }));
    return out;
  };
  const overlaps = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  function artOf(n) {
    if (hasText(n)) return null;
    const b = box(n);
    if (Math.max(b.width, b.height) <= 64 || Math.min(b.width, b.height) < 32) return null;
    let vectors = false;
    let fills = false;
    const ok = (function walk(x) {
      if (!visible(x)) return true;
      if (isText(x) || imageFill(x)) return false;
      if (VECTORISH.has(x.type)) { vectors = true; return true; }
      const kids = (x.children || []).filter(visible);
      if (!kids.length && solidFill(x)) { fills = true; return true; }
      return kids.every(walk);
    }(n));
    if (!ok || (!vectors && !fills)) return null;
    const kids = (n.children || []).filter(visible);
    if (n.layoutMode && n.layoutMode !== 'NONE' && kids.length >= 2) return null;
    const fb = box(frame);
    if (b.x < fb.x - 1 || b.x + b.width > fb.x + fb.width + 1 || bandTexts.some((t) => overlaps(t, b))) return 'backdrop';
    return vectors ? 'media' : 'placeholder';
  }
  function isVectorOnly(n) {
    let any = false;
    const ok = (function walk(x) {
      if (!visible(x)) return true;
      if (VECTORISH.has(x.type)) { any = true; return true; }
      if (isText(x) || imageFill(x)) return false;
      return (x.children || []).every(walk);
    }(n));
    const b = box(n);
    return ok && any && b.width <= 64 && b.height <= 64;
  }

  // ---- page -----------------------------------------------------------------------------------------------
  const seg = segment(frame, rules);
  const sections = seg.sections.map((band, i) => {
    const slot = `s${String(i + 1).padStart(2, '0')}`;
    const area = (n) => box(n).width * box(n).height;
    const bandArea = Math.max(...band.nodes.map(area));
    const bg = band.nodes.filter((n) => imageFill(n) && !hasText(n) && area(n) >= 0.9 * bandArea);
    const ordered = [...bg, ...geometric(band.nodes.filter((n) => !bg.includes(n)))];
    const before = flags.length;
    bandTexts = textBoxesIn(band.nodes);
    const stream = ordered.flatMap((n) => emit(n, 'body', null));
    for (const f of flags.slice(before)) f.slot = slot;
    return finishSection(slot, stream, band.nodes.map((n) => n.id));
  });

  // headings: the first is the page h1, one h1 only, no skipped levels
  const heads = sections.flatMap((s) => s.ordered.filter((o) => o.kind === 'heading').map((o) => ({ o, s })));
  let prev = 0;
  heads.forEach(({ o, s }, i) => {
    let lv = Number(o.level.slice(1));
    const was = lv;
    if (i === 0) lv = 1;
    else if (lv === 1) lv = 2;
    else if (lv > prev + 1) lv = prev + 1;
    if (lv !== was) flag('heading.level', 'info', o.node, `${o.role || 'size'} heading set to h${lv} (was h${was}): ${i === 0 ? 'the first heading is the page h1' : lv === 2 && was === 1 ? 'one h1 per page' : 'no skipped levels'}`, s.slot);
    o.level = `h${lv}`;
    prev = lv;
  });
  for (const s of sections) s.headings = s.ordered.filter((o) => o.kind === 'heading').map((o) => ({ level: o.level, text: o.text }));
  if (!heads.length) flag('heading.none', 'review', frame.id, 'no text matches a heading role: the page has no h1');

  // chrome slots (a declared delta outside the content gate)
  const chromeSlots = [];
  for (const role of ['header', 'footer']) {
    for (const c of seg.chrome[role]) {
      const rows = (c.layoutMode === 'VERTICAL' ? orderedChildren(c, log).filter(hasContent) : [c]);
      for (const r of rows.length > 1 ? rows : [c]) {
        bandTexts = textBoxesIn([r]);
        const stream = emit(r, 'chrome', null);
        const flat = stream.flatMap((x) => (x.children ? [x, ...x.children] : [x]));
        const texts = flat.filter((x) => x.kind !== 'image' && x.kind !== 'formControl' && x.text);
        const isPara = (t) => t.text.length > 40;
        const slot = { slot: `s${String(chromeSlots.length + 1).padStart(2, '0')}`, role, node: r.id, visibleText: norm(texts.map((t) => t.text).join(' ')), headings: [], paragraphs: texts.filter(isPara).map((t) => t.text), listItems: [],
          ctas: texts.filter((t) => !isPara(t)).map((t) => ({ text: t.text, href: t.href || '#', absHref: t.href || '#', classes: 'link' })),
          images: flat.filter((x) => x.kind === 'image').map(({ currentSrc, alt, w, h }) => ({ currentSrc, alt, w, h })), formControls: [], leftovers: [], ordered: stream, orderedVerified: true };
        for (const t of texts.filter((x) => !isPara(x) && !x.href)) flag('link.unresolved', 'info', t.node, `chrome "${t.text.slice(0, 40)}" has no link target in the design`, slot.slot);
        chromeSlots.push(slot);
      }
    }
  }

  // placeholder copy (#310's real-content rule)
  const bodyTexts = sections.flatMap((s) => s.ordered.flatMap((o) => (o.children ? o.children : [o])).filter((o) => o.text).map((o) => ({ ...o, slot: s.slot })));
  let blocking = 0;
  for (const t of bodyTexts) {
    const s = t.text.toLowerCase();
    if (/lorem ipsum|dolor sit amet|consectetur adipiscing/.test(s)) { flag('placeholder.lorem', 'block', t.node, t.text.slice(0, 60), t.slot); blocking += 1; } else if (KIT_WORDS.has(s)) { flag('placeholder.kit-word', 'block', t.node, t.text, t.slot); blocking += 1; } else if (/^x{2,}[x\d\-/.]*$/i.test(t.text)) { flag('placeholder.pattern', 'block', t.node, t.text, t.slot); blocking += 1; } else if ((t.kind === 'heading' || t.kind === 'paragraph') && KIT_TERMS.test(s) && t.text.split(/\s+/).length <= 6) flag('placeholder.suspect', 'review', t.node, `"${t.text}" reads like kit copy`, t.slot);
  }
  for (const s of sections) {
    const counts = {};
    for (const o of s.ordered) if (o.text && o.text.length >= 12) counts[o.text] = (counts[o.text] || 0) + 1;
    for (const [t, c] of Object.entries(counts)) if (c >= 3) flag('placeholder.repeated', 'block', null, `"${t.slice(0, 50)}" repeats ${c} times`, s.slot);
  }
  const placeholderOnly = bodyTexts.length > 0 && blocking / bodyTexts.length >= 0.8;
  if (placeholderOnly) flag('placeholder.only', 'block', frame.id, `${blocking}/${bodyTexts.length} body texts are placeholder copy: the design holds no real content`);
  for (const a of orderLog.ambiguous) flag('order.ambiguous', 'review', a.node, a.why);

  // responsive variant: same text, or the differences are listed
  if (responsive?.frame) {
    const mine = textReference(frame, { rules: rawRules }).map((r) => r.text);
    const theirs = textReference(responsive.frame, { rules: rawRules }).map((r) => r.text);
    const missingThere = mine.filter((t) => !theirs.includes(t));
    const extraThere = theirs.filter((t) => !mine.includes(t));
    if (missingThere.length || extraThere.length) flag('variant.text-differs', 'review', responsive.frame.id, `the responsive variant differs: ${missingThere.length} text(s) only here${missingThere.length ? ` ("${missingThere[0].slice(0, 30)}"…)` : ''}, ${extraThere.length} only there${extraThere.length ? ` ("${extraThere[0].slice(0, 30)}"…)` : ''}`);
  }

  const visibleTextNormalized = norm(sections.map((s) => s.visibleText).join(' '));
  const h1 = sections.flatMap((s) => s.headings).find((h) => h.level === 'h1');
  const title = titleFromName(pageName || frame.name);
  flag('metadata.title-derived', 'review', frame.id, `title "${title}" derived from the frame name; description, canonical, OG and Twitter tags are absent`);
  const fb = box(frame);
  const model = {
    _provenance: {
      writtenBy: 'stardust:reskin/figma-donor.mjs',
      command: 'content',
      modelVersion: MODEL_VERSION,
      capturedAt,
      source: { kind: 'figma', figma: { fileKey, node: frame.id, version, name: norm(frame.name) } },
      viewport: `${Math.round(fb.width)}x${Math.round(fb.height)}`,
      scope: `figma:${frame.id}`,
      visibility: VISIBILITY_RULE,
      readingOrder: { rule: ORDER_RULE, frames: orderLog.rules, ambiguous: orderLog.ambiguous },
      segmentation: { rule: SEGMENT_RULE, sections: seg.sections.map((b, i) => ({ slot: `s${String(i + 1).padStart(2, '0')}`, y: Math.round(b.y - fb.y), h: Math.round(b.h), nodes: b.nodes.map((n) => n.id) })), chrome: { header: seg.chrome.header.map((n) => n.id), footer: seg.chrome.footer.map((n) => n.id) }, folded: seg.folded, descended: seg.descended },
      responsive: responsive?.frame ? { node: responsive.frame.id, name: norm(responsive.frame.name) } : null,
      decorative,
    },
    metadata: { title, description: '', canonical: null, ogTags: {}, twitterTags: {}, jsonLd: [], lang: 'en', favicon: null, declaredAbsent: ['description', 'canonical', 'ogTags', 'twitterTags', 'jsonLd'], derived: { title: 'frame name' } },
    scope: [{ sel: `figma:${frame.id}`, whole: false }],
    visibleTextNormalized,
    coverage: { bodyTextLen: visibleTextNormalized.length, scopeTextLen: visibleTextNormalized.length, ratio: 1, h1Text: h1?.text ?? null, h1InScope: Boolean(h1) },
    sections,
    flags,
  };
  return { model, flags, needs: [...needs.values()], chrome: chromeSlots, placeholderOnly, slug };
}

// Per-type arrays and visibleText from the stream, in stream (render) order.
function finishSection(slot, ordered, nodes) {
  const flat = ordered.flatMap((o) => (o.children && o.kind !== 'cta' ? [o, ...o.children.filter((c) => c.kind === 'cta')] : [o]));
  const textOf = (o) => (o.kind === 'formControl' ? (o.control === 'select' ? o.text : '') : o.text || '');
  return {
    slot, rootTag: null, rootClass: '', node: nodes[0], nodes,
    visibleText: norm(ordered.map(textOf).filter(Boolean).join(' ')),
    headings: [],
    paragraphs: ordered.filter((o) => o.kind === 'paragraph').map((o) => o.text),
    listItems: ordered.filter((o) => o.kind === 'listItem').map((o) => o.text),
    ctas: flat.filter((o) => o.kind === 'cta' && o.text).map((o) => ({ text: o.text, href: o.href, absHref: o.absHref, classes: o.classes })),
    images: flat.filter((o) => o.kind === 'image').concat(ordered.flatMap((o) => (o.kind === 'cta' ? (o.children || []).filter((c) => c.kind === 'image') : []))).map(({ currentSrc, alt, w, h }) => ({ currentSrc, alt, w, h })),
    formControls: ordered.filter((o) => o.kind === 'formControl').map(({ kind, sep, node, textNodes, ...rest }) => rest),
    leftovers: ordered.filter((o) => o.kind === 'text').map((o) => ({ text: o.text, parentTag: o.parentTag, parentClass: o.parentClass })),
    ordered,
    orderedVerified: true,
  };
}

// The text gate's reference, read from the tree (never from the model): every effectively-visible TEXT node
// in the body sections, in reading order, rendered-case. Chrome is outside the gate (a declared delta).
export function textReference(frame, { rules: rawRules = {} } = {}) {
  const rules = compileRules(rawRules);
  const seg = segment(frame, rules);
  const refs = [];
  seg.sections.forEach((band, i) => {
    const slot = `s${String(i + 1).padStart(2, '0')}`;
    const nodes = [...band.nodes].sort((a, b) => box(a).y - box(b).y || box(a).x - box(b).x);
    const area = (n) => box(n).width * box(n).height;
    const bandArea = Math.max(...nodes.map(area));
    const bg = nodes.filter((n) => imageFill(n) && !hasText(n) && area(n) >= 0.9 * bandArea);
    for (const top of [...bg, ...geometric(nodes.filter((n) => !bg.includes(n)))]) {
      (function walk(x) {
        if (!visible(x)) return;
        if (isText(x)) {
          const runs = textRuns(x);
          const chars = String(x.characters ?? '');
          if (x.lineTypes && x.lineTypes.some((t) => t && t !== 'NONE')) {
            let at = 0;
            for (const line of chars.split('\n')) {
              const t = norm(runs.filter((r) => r.end > at && r.start < at + line.length).map((r) => applyCase(r.chars.slice(Math.max(0, at - r.start), at + line.length - r.start), r.textCase)).join(''));
              at += line.length + 1;
              if (t) refs.push({ node: x.id, text: t, slot });
            }
            return;
          }
          const t = norm(runs.map((r) => applyCase(r.chars, r.textCase)).join(''));
          if (t) refs.push({ node: x.id, text: t, slot, ...(runs.some((r) => r.textCase === 'TITLE') ? { title: true } : {}) });
          return;
        }
        for (const c of orderedChildren(x)) walk(c);
      }(top));
    }
  });
  return refs;
}
