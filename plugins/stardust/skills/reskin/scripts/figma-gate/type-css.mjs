// skills/reskin/scripts/figma-gate/type-css.mjs — the type of every checks-file Type entry, written as CSS from its
// Figma TEXT node, so the reskin page asserts what B3 (ramp.mjs) measures by construction instead of by tag-level
// tokens (an h2 styled site-wide at the type.h2 size when the module's title is drawn smaller). One rule per entry:
// its selector scoped to its section (the local join's selector), each branch raised by :not(#figma-type) so it
// outranks the renderer's class and tag rules, one more per narrower width so a mobile entry outranks the desktop
// one, and the narrower widths in @media (max-width) blocks. Color goes in its own rule that leaves :hover,
// :focus-visible and :active to the page. A color equal to a :root token value is written as var(<token>).
// typeCss and injectTypeCss are pure.
import { join } from 'node:path';
import { findBox } from './boxes.mjs';
import { scopeSelector, selectorBranches } from './checks.mjs';
import { normalizeColor, textExpect } from './ramp.mjs';

export const typeCssPath = (dir, slug) => join(dir, 'reskin', 'figma-type', `${slug}.css`);

const BOOST = ':not(#figma-type)';
const AT_REST = ':not(:hover):not(:focus-visible):not(:active)';
const PSEUDO_ELEMENT = /(?:::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter))$/i;
const DECLS = [['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['lineHeight', 'line-height'], ['letterSpacing', 'letter-spacing'], ['fontFamily', 'font-family']];

// suffix on every branch of a selector list, before a branch's trailing pseudo-element.
export function suffixSelector(selector, suffix) {
  return selectorBranches(selector).map((branch) => {
    const b = branch.trim();
    const pe = PSEUDO_ELEMENT.exec(b);
    return pe ? `${b.slice(0, pe.index)}${suffix}${pe[0]}` : `${b}${suffix}`;
  }).join(', ');
}

const quoteFamily = (f) => (/^[\w-]+$/.test(f) && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(f) ? f : `"${f.replace(/"/g, '\\"')}"`);
const generic = (f) => (/mono|code|courier/i.test(f) ? 'monospace' : /serif/i.test(f) && !/sans/i.test(f) ? 'serif' : 'sans-serif');

// The max-width of the @media block for a width narrower than the next wider one: 899px across the 900px line
// (desktop above, tablet or phone below), else the midpoint.
export function breakpoint(narrow, wide) {
  return narrow < 900 && wide >= 900 ? 899 : Math.floor((narrow + wide) / 2) - 1;
}

// → { css, rules, entries, families: [first family …], conflicts: [{ width, selector, a, b }] }.
// join: the local join (its sections' selectors); checks: prepare's validated sections; boxes: the Figma boxes;
// norm: parseNormalizations(rules.normalizations); rootEntries: rootTokens(tokens).entries.
export function typeCss({ join: joined, checks, boxes, norm, rootEntries = [], slug = null }) {
  const colorVar = new Map();
  for (const e of rootEntries) {
    const c = normalizeColor(e.value);
    if (c && !colorVar.has(c)) colorVar.set(c, `var(${e.name})`);
  }
  const byWidth = new Map();
  const families = new Set();
  const conflicts = [];
  const seen = new Map();
  let entries = 0;
  for (const s of joined.sections.filter((x) => checks[x.slot])) {
    const section = checks[s.slot];
    for (const entry of section.type) {
      const rootBox = boxes.roots[section.roots[entry.width]]?.box;
      const box = rootBox && findBox(rootBox, entry.node);
      if (!box?.text) throw new Error(`${s.slot} ${entry.id}: ${entry.node} is not a TEXT node inside the root for width ${entry.width}`);
      const want = textExpect(box.text, norm);
      const selector = scopeSelector(s.selector, entry.selector);
      const decls = DECLS.filter(([p]) => want[p] !== null).map(([p, css]) => {
        if (p !== 'fontFamily') return `${css}: ${want[p]}`;
        families.add(want.fontFamily);
        return `${css}: ${quoteFamily(want.fontFamily)}, ${generic(want.fontFamily)}`;
      });
      const color = want.color === null ? null : colorVar.get(normalizeColor(want.color)) ?? want.color;
      const key = `${entry.width} ${selector}`;
      const value = JSON.stringify([decls, color]);
      const prior = seen.get(key);
      if (prior && prior.value !== value) conflicts.push({ width: entry.width, selector, a: prior.label, b: `${s.slot} ${entry.id}` });
      if (prior) continue;
      seen.set(key, { value, label: `${s.slot} ${entry.id}` });
      entries += 1;
      if (!byWidth.has(entry.width)) byWidth.set(entry.width, []);
      byWidth.get(entry.width).push({ label: `${s.slot} ${entry.id} (${entry.node})`, selector, decls, color });
    }
  }
  const widths = [...byWidth.keys()].sort((a, b) => b - a);
  let rules = 0;
  const blocks = widths.map((w, rank) => {
    const boost = BOOST.repeat(rank + 1);
    const indent = rank ? '  ' : '';
    const lines = [];
    for (const r of byWidth.get(w)) {
      lines.push(`${indent}/* ${r.label.replace(/\*\//g, '* /')} */`);
      if (r.decls.length) { lines.push(`${indent}${suffixSelector(r.selector, boost)} { ${r.decls.join('; ')}; }`); rules += 1; }
      if (r.color) { lines.push(`${indent}${suffixSelector(r.selector, `${boost}${AT_REST}`)} { color: ${r.color}; }`); rules += 1; }
    }
    return rank ? `@media (max-width: ${breakpoint(w, widths[rank - 1])}px) {\n${lines.join('\n')}\n}` : lines.join('\n');
  });
  const head = `/* stardust:figma-type${slug ? ` ${slug}` : ''}: written by figma-gate.mjs type-css from the Figma text node of each Type entry of the checks file. Do not edit: fix the checks file and re-run type-css. */`;
  return { css: `${[head, ...blocks].join('\n')}\n`, rules, entries, families: [...families].sort(), conflicts };
}

const TYPE_STYLE = /[ \t]*<style data-figma-type>[\s\S]*?<\/style>\n?/gi;

// html with css as its last <style> in <head> (<style data-figma-type>), replacing one it already has.
export function injectTypeCss(html, css) {
  const clean = html.replace(TYPE_STYLE, '');
  const at = clean.search(/<\/head>/i);
  if (at < 0) throw new Error('the page has no </head> to put <style data-figma-type> before');
  return `${clean.slice(0, at)}<style data-figma-type>\n${css.endsWith('\n') ? css : `${css}\n`}</style>\n${clean.slice(at)}`;
}

export const hasTypeCss = (html) => /<style data-figma-type>/i.test(html);
