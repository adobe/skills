/**
 * skills/deploy/scripts/css-as-text.mjs — is this authored text CSS? Library, no CLI; pure, nothing runs on import.
 * Shared by davids-model-lint.mjs (D15 🔴/🟡 per cell and paragraph) and ew-editability-probe.mjs (an @ew-exempt
 * tag never covers a style value — the exempt cell is reported dead).
 *
 * Field case (#134): a hero-carousel authored one cell per slide reading `padding: 200px 10px 10px 50px` — the
 * source's Magento PageBuilder per-slide overlay style, ported as a "config" cell that decorate() copied into
 * el.style. It never displays, so every content gate passed, and the author saw CSS as body text in DA. Pixels
 * are block CSS; an author-facing choice is ONE plain word from a closed variant set.
 *
 *   cssAsText(text)  → null | { sev: '🔴' | '🟡', what }  — 🔴 a declaration list / custom-property assignment,
 *                      🟡 a cell that is only CSS lengths or a lone hex colour (a data table may hold those).
 *   decodeEntities(text) — the few entities raw content HTML carries (&nbsp; &amp; &quot; &#39;).
 */
// D15 / #134 — CSS as content. A per-item visual knob authored as a cell
// ("padding: 200px 10px 10px 50px" per carousel slide, applied by decorate()
// to el.style) is the smallest form of CSS-in-the-document: it never displays,
// so every content gate passes, and the author sees CSS as body text. Pixels
// are block CSS; an author-facing choice is ONE plain word from a closed set.
const CSS_PROP = /^(?:--[a-z0-9-]+|(?:padding|margin|border|outline|background|color|font|text|line-height|letter-spacing|word-spacing|white-space|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|inset|gap|row-gap|column-gap|display|position|float|clear|flex|grid|place|align|justify|opacity|visibility|transform|transition|animation|z-index|object-fit|object-position|overflow|box-shadow|box-sizing|border-radius|aspect-ratio|order|cursor|pointer-events|filter|backdrop-filter|clip-path|mix-blend-mode|vertical-align)(?:-[a-z]+)*)$/i;
const CSS_LENGTH = /^-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|fr|ch|ex|deg|ms|s)$/i;
// Bare-length rule excludes time units: "1970s" / "40s" are decades, not seconds.
const CSS_SPACE_LENGTH = /^-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|fr|ch|ex)$/i;
const CSS_KEYWORD = /^(?:auto|none|inherit|initial|unset|revert|flex|grid|block|inline|inline-block|inline-flex|absolute|relative|sticky|fixed|static|center|start|end|flex-start|flex-end|space-between|space-around|stretch|cover|contain|solid|dashed|dotted|bold|italic|normal|uppercase|lowercase|capitalize|nowrap|wrap|hidden|visible|transparent|currentcolor|ease|ease-in|ease-out|ease-in-out|linear|pointer|left|right|top|bottom|both|row|column|baseline|middle|underline|!important)$/i;
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Every whitespace-separated token of a declaration's value must be CSS-shaped
// — a length, a number, a colour, a function call (rgba(…), var(--x), calc(…),
// url(…)), a keyword, or a separator. Prose that merely CONTAINS a CSS word
// ("color: text-only teaser boxes, 6-up grid") is a description, not a rule.
function cssShapedValue(value) {
  const tokens = value.replace(/\([^)]*\)/g, '()').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((tok) => {
    const t = tok.replace(/,$/, '');
    return t === '/' || t === ',' || CSS_LENGTH.test(t) || /^-?\d*\.?\d+%?$/.test(t) || HEX_COLOUR.test(t)
      || /^(?:rgba?|hsla?|var|calc|url|linear-gradient|radial-gradient|clamp|min|max|translate[XY]?|scale|rotate)\(\)$/i.test(t)
      || CSS_KEYWORD.test(t);
  });
}

export function decodeEntities(text) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// Classify a cell/paragraph's whole text. Returns null, or { sev, what }.
export function cssAsText(raw) {
  const text = decodeEntities(raw);
  if (!text || text.length > 400) return null;
  // One or more declarations: "prop: value" [; "prop: value"] [;]. Every part must be a
  // `name: value` pair and at least one a recognised CSS property with a CSS-shaped value —
  // so the recorded `padding: 190px 10px 0 35px; size: auto` (a block-private key riding
  // beside a real declaration) is CSS, while "Phone: 555; Fax: 666" is not.
  const parts = text.split(';').map((d) => d.trim()).filter(Boolean);
  const pairs = parts.map((d) => d.match(/^([a-z-]+)\s*:\s*(\S.*)$/i));
  const isDecl = (m) => m && CSS_PROP.test(m[1]) && (m[1].startsWith('--') || cssShapedValue(m[2]));
  if (pairs.length && pairs.every(Boolean) && pairs.some(isDecl)) {
    const custom = parts.some((d) => d.startsWith('--'));
    return { sev: '🔴', what: custom ? 'CSS custom-property assignment' : `CSS declaration${parts.length > 1 ? 's' : ''}` };
  }
  // Only CSS lengths ("200px", "200px 10px 10px 50px").
  const words = text.split(/\s+/);
  if (words.length <= 4 && words.every((w) => CSS_SPACE_LENGTH.test(w))) return { sev: '🟡', what: 'bare CSS length' };
  if (HEX_COLOUR.test(text)) return { sev: '🟡', what: 'lone hex colour' };
  return null;
}
