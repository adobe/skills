// skills/reskin/scripts/figma/normalize.mjs — Figma REST values → the strings reskin's donor files
// carry: computed-style forms for donor-tokens.json (what donor-probe asserts verbatim) and hex for
// the descriptive DESIGN files. Pure functions, no I/O. Library for figma-donor.mjs, no CLI.

// Half away from zero, so -1.125 → -1.13 like a person would round it.
const round = (n, digits) => {
  const f = 10 ** digits;
  return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f || 0;
};
const num = (n, digits) => String(round(n, digits));
const channel = (x) => Math.min(255, Math.max(0, Math.round((x ?? 0) * 255)));
const hex2 = (n) => n.toString(16).padStart(2, '0');

export function colorToCss(color, opacity = 1) {
  const a = (color?.a ?? 1) * opacity;
  const rgb = [color?.r, color?.g, color?.b].map(channel).join(', ');
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${num(a, 3)})`;
}

export function colorToHex(color) {
  const a = color?.a ?? 1;
  const base = `#${[color?.r, color?.g, color?.b].map((x) => hex2(channel(x))).join('')}`;
  return a >= 1 ? base : `${base}${hex2(channel(a))}`;
}

export function px(n) {
  return `${num(n ?? 0, 2)}px`;
}

// CSS shorthand collapse, the form getComputedStyle(el).padding serializes to.
export function paddingShorthand([top = 0, right = 0, bottom = 0, left = 0] = []) {
  const [t, r, b, l] = [top, right, bottom, left].map(px);
  if (r === l) {
    if (t === b) return t === r ? t : `${t} ${r}`;
    return `${t} ${r} ${b}`;
  }
  return `${t} ${r} ${b} ${l}`;
}

// Figma's rectangleCornerRadii order (top-left, top-right, bottom-right, bottom-left) is CSS's.
export function radiusCss(node) {
  const corners = node?.rectangleCornerRadii;
  if (Array.isArray(corners) && corners.length === 4) {
    const parts = corners.map(px);
    return parts.every((p) => p === parts[0]) ? parts[0] : parts.join(' ');
  }
  return typeof node?.cornerRadius === 'number' ? px(node.cornerRadius) : null;
}

export function shadowCss(effects) {
  const shadows = (effects || [])
    .filter((e) => e && e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map((e) => {
      const css = `${colorToCss(e.color)} ${px(e.offset?.x)} ${px(e.offset?.y)} ${px(e.radius)} ${px(e.spread)}`;
      return e.type === 'INNER_SHADOW' ? `${css} inset` : css;
    });
  return shadows.length ? shadows.join(', ') : null;
}

export function lineHeightCss(style, unitless = false) {
  if (!style || style.lineHeightUnit === 'INTRINSIC_%' || typeof style.lineHeightPx !== 'number') return 'normal';
  return unitless ? num(style.lineHeightPx / style.fontSize, 3) : px(style.lineHeightPx);
}

export function letterSpacingCss(style, unit = 'px') {
  const ls = style?.letterSpacing || 0;
  if (!ls) return 'normal';
  return unit === 'em' ? `${num(ls / style.fontSize, 3)}em` : px(ls);
}

export function weightCss(n) {
  return String(Math.round(n));
}

// Figma lists paints bottom to top: the last visible paint is the one seen. A gradient or image on top
// is not a color; a translucent solid over another visible paint is a composite, not a color either.
export function topPaint(paints) {
  const vis = (paints || []).filter((p) => p && p.visible !== false);
  return vis.length ? vis[vis.length - 1] : null;
}

export function solidFill(paints) {
  const vis = (paints || []).filter((p) => p && p.visible !== false);
  const paint = vis[vis.length - 1];
  if (!paint) return { css: null, hex: null, kind: 'NONE' };
  if (paint.type !== 'SOLID') return { css: null, hex: null, kind: paint.type };
  const opacity = paint.opacity ?? 1;
  const alpha = (paint.color?.a ?? 1) * opacity;
  if (alpha < 1 && vis.length > 1) return { css: null, hex: null, kind: 'COMPOSITE' };
  return {
    css: colorToCss(paint.color, opacity),
    hex: colorToHex({ ...paint.color, a: alpha }),
    kind: 'SOLID',
  };
}
