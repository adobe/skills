// skills/reskin/scripts/figma-gate/derive.mjs — a previewSelector for every checks entry that has none, read from the two
// pages on a deployed preview (--target preview). EDS blocks rebuild the markup the reskin page was written with, so an
// entry's selector often matches nothing there. For each entry the elements its selector matches in the reskin page's
// section are found again in the preview's section by their text (each text node trimmed, joined with one space, lower
// case), the deepest element with that text, the same tag and image count first, and are named by their path from the
// section (`:scope > :nth-child(2) > :nth-child(1)`). The selector is kept when it already finds as many elements on the
// preview (it measures as before); an element found nowhere (or found out of order) leaves the entry on its selector, which then measures as
// before. An explicit previewSelector always wins, and the checks file is never rewritten: the derived selectors ride on
// the target (derivedSelector) and land in <out>/preview-selectors.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { CHROME_SELECTORS } from './join.mjs';
import { localAttributes, localTarget, openPlain } from './target.mjs';

export const entryKey = (slot, kind, id) => `${slot} ${kind} ${id}`;

// The selector an entry is measured by on the target: its previewSelector, else the derived one, else its selector.
export const derivedSelector = (target, slot, kind, entry) => (target.regime === 'preview'
  ? entry.previewSelector ?? target.derived?.get(entryKey(slot, kind, entry.id)) ?? entry.selector
  : entry.selector);

// In a page. mode "read": { sections: [{ root, chrome, selectors }] } → per section, per selector, the fingerprints of its
// matches ({ tag, text, imgs, alt }) or { error }. mode "locate": { sections: [{ root, entries: [{ selector, prints }] }] }
// → per entry { keep: true } | { selector } | { why }. Self-contained: it is serialised into the page.
export function inPage({ mode, sections }) {
  const textOf = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement?.closest('script, style, template, noscript')) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(' ').toLowerCase();
  };
  const print = (el) => {
    const imgs = el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')];
    return { tag: el.tagName.toLowerCase(), text: textOf(el), imgs: imgs.length, alt: imgs[0]?.getAttribute('alt') || '' };
  };
  const rootOf = (s) => {
    if (!s.chrome) return document.querySelector(s.root);
    const sel = s.chrome.find((c) => { try { return !!document.querySelector(c); } catch { return false; } });
    return sel ? document.querySelector(sel) : null;
  };
  // The matches of a selector scoped to root, as scopeSelector reads it: a branch that starts with :scope may match root
  // itself, any other branch only its descendants. Commas inside (…) or […] do not split branches.
  const branchesOf = (selector) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const c of selector) {
      if (c === '(' || c === '[') depth += 1;
      if (c === ')' || c === ']') depth -= 1;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  };
  const matchesIn = (root, selector) => {
    const own = branchesOf(selector).filter((b) => b.startsWith(':scope'));
    const self = own.length && root.matches(own.join(', ')) ? [root] : [];
    return [...self, ...root.querySelectorAll(selector)];
  };
  if (mode === 'read') {
    return sections.map((s) => {
      const root = rootOf(s);
      return s.selectors.map((selector) => {
        if (!root) return { error: 'section not found' };
        try { return { prints: matchesIn(root, selector).map(print) }; } catch { return { error: 'invalid selector' }; }
      });
    });
  }
  const pathOf = (root, el) => {
    const steps = [];
    for (let n = el; n !== root; n = n.parentElement) steps.unshift(`:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`);
    return [':scope', ...steps].join(' > ');
  };
  return sections.map((s) => {
    const root = rootOf(s);
    return s.entries.map(({ selector, prints }) => {
      if (!root) return { why: 'section not found' };
      if (!prints.length) return { why: `${selector} matched nothing on the reskin page` };
      let same = null;
      try { same = matchesIn(root, selector).map(print); } catch { same = null; }
      // A selector that already finds as many elements on the preview as on the reskin page measures as before: kept.
      if (same && same.length >= prints.length) return { keep: true };
      const all = [root, ...root.querySelectorAll('*')];
      const info = new Map(all.map((el) => [el, print(el)]));
      const picked = [];
      for (let i = 0; i < prints.length; i += 1) {
        const p = prints[i];
        if (!p.text && !p.alt) return { why: `match ${i + 1} of ${selector} has no text and no image alt` };
        const rank = prints.slice(0, i).filter((q) => q.text === p.text && q.alt === p.alt).length;
        let found = all.filter((el) => {
          const f = info.get(el);
          return f.text === p.text && (p.text || (f.imgs > 0 && f.alt === p.alt));
        });
        found = found.filter((el) => !found.some((o) => o !== el && el.contains(o)));
        const narrow = (keep) => { const n = found.filter(keep); if (n.length) found = n; };
        narrow((el) => info.get(el).tag === p.tag);
        narrow((el) => info.get(el).imgs === p.imgs);
        const el = found[rank];
        if (!el) return { why: `no element with the text "${p.text.slice(0, 60) || `[img alt ${p.alt}]`}" in the preview's section` };
        picked.push(el);
      }
      const ordered = picked.every((el, i) => i === 0 || (picked[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (!ordered) return { why: `the matches of ${selector} are in another order on the preview` };
      return { selector: picked.map((el) => pathOf(root, el)).join(', ') };
    });
  });
}

// The entries to derive: every geometry and type entry of a joined section with no previewSelector, by width.
export function pending({ join, checks }) {
  const bySlot = new Map(join.sections.map((s) => [s.slot, s]));
  const out = [];
  for (const [slot, section] of Object.entries(checks)) {
    const joined = bySlot.get(slot);
    if (!joined) continue;
    for (const [kind, list] of [['geometry', section.geometry], ['type', section.type]]) {
      for (const entry of list) {
        if (entry.previewSelector === undefined) out.push({ key: entryKey(slot, kind, entry.id), slot, kind, id: entry.id, width: entry.width, selector: entry.selector, previewRoot: joined.selector, chrome: joined.slot === 'header' || joined.slot === 'footer' ? joined.slot : null });
      }
    }
  }
  return out;
}

// On a preview target: → { target (with derived), derived: [{ key, selector }], kept, missed: [{ key, why }] }; on any
// other regime, or with nothing to derive, the target as given. reskin is the reskin page (previewTarget's --reskin).
export async function derivePreviewSelectors({ target, join, checks, out, reskin, browser: given = null }) {
  const todo = target.regime === 'preview' ? pending({ join, checks }) : [];
  if (!todo.length) return { target, derived: [], kept: 0, missed: [] };
  const local = localTarget(reskin ?? target.reskin);
  const browser = given ?? await openPlain();
  const derived = [];
  const missed = [];
  let kept = 0;
  try {
    for (const width of [...new Set(todo.map((t) => t.width))]) {
      const at = todo.filter((t) => t.width === width);
      const groups = [...new Set(at.map((t) => t.slot))].map((slot) => at.filter((t) => t.slot === slot));
      const localPage = await local.open(browser, width);
      let read;
      try {
        read = await localPage.evaluate(inPage, {
          mode: 'read',
          sections: groups.map((g) => ({ root: localAttributes.selector(g[0].slot), chrome: g[0].chrome ? CHROME_SELECTORS[g[0].chrome] : null, selectors: g.map((t) => t.selector) })),
        });
      } finally { await localPage.context().close(); }
      const previewPage = await target.open(browser, width);
      let located;
      try {
        located = await previewPage.evaluate(inPage, {
          mode: 'locate',
          sections: groups.map((g, i) => ({ root: g[0].previewRoot, entries: g.map((t, j) => ({ selector: t.selector, prints: read[i][j].prints ?? [] })) })),
        });
      } finally { await previewPage.context().close(); }
      groups.forEach((g, i) => g.forEach((t, j) => {
        const r = located[i][j];
        const readErr = read[i][j].error;
        if (readErr) missed.push({ key: t.key, why: `reskin page: ${readErr}` });
        else if (r.keep) kept += 1;
        else if (r.selector) derived.push({ key: t.key, selector: r.selector });
        else missed.push({ key: t.key, why: r.why });
      }));
    }
  } finally { if (!given) await browser.close(); }
  mkdirSync(out, { recursive: true });
  writeFileSync(pathJoin(out, 'preview-selectors.json'), `${JSON.stringify({ version: 1, url: target.url, derived, kept, missed }, null, 2)}\n`);
  return { target: { ...target, derived: new Map(derived.map((d) => [d.key, d.selector])) }, derived, kept, missed };
}
