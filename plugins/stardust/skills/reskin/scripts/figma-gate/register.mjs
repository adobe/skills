// skills/reskin/scripts/figma-gate/register.mjs — B4, the divergence register: what the Figma checks say
// about a page, in five classes. mandated (a joined module section whose geometry and type entries all
// pass: the page follows Figma there), unmandated (each failing entry), out-of-kit (each new-module
// mapping row: nothing in Figma to follow), conflict (a Figma text color that misses WCAG contrast on its
// own ground, so following Figma would ship an unreadable page) and pre-existing (each ledger flag).
// Pure: the CLI reads the step files and writes register.json and register.md.
import { REFERENCE_CLASSES } from './pixel.mjs';

const CLASSES = ['mandated', 'unmandated', 'out-of-kit', 'conflict', 'pre-existing'];
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i;

function luminance(css) {
  const m = RGB.exec(String(css ?? ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 contrast ratio of two rgb()/rgba() strings (alpha ignored); NaN when either is not one.
export function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  if (a === null || b === null) return NaN;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const needFor = ({ fontSize, fontWeight }) => ((fontSize ?? 0) >= 24 || ((fontSize ?? 0) >= 18.66 && (fontWeight ?? 0) >= 700) ? 3 : 4.5);

// Visible TEXT with a solid color against the nearest painting ancestor inside the root; a gradient,
// image or composite ground, or no painting ancestor, is skipped (no honest single background).
export function mandateConflicts(box) {
  const hits = [];
  const walk = (b, ground) => {
    if (b.type === 'TEXT' && b.text?.color && b.text.characters.trim() !== '' && ground?.fillKind === 'SOLID') {
      const ratio = contrast(b.text.color, ground.fill);
      const need = needFor(b.text);
      if (ratio < need) hits.push({ node: b.id, ratio: Math.round(ratio * 100) / 100, need, fg: b.text.color, bg: ground.fill });
    }
    const next = b.fillKind !== 'NONE' ? b : ground;
    for (const c of b.children) walk(c, next);
  };
  walk(box, null);
  return hits;
}

const failing = (r) => r.status !== 'PASS' && r.status !== 'UNASSERTED';
const asserted = (r) => r.status !== 'UNASSERTED';

export function buildRegister({ join, geometry, ramp, pixel, mapping, boxes, flags, link }) {
  const rows = [];
  const row = (cls, slot, module, node, check, detail) => rows.push({ class: cls, slot, module, node, check, detail, link: node ? link(node) : null });
  const sections = join.sections || [];
  const moduleOf = (slot) => sections.find((s) => s.slot === slot)?.module ?? null;
  const notRun = [['geometry', geometry], ['ramp', ramp], ['pixel', pixel]].filter(([, v]) => !v).map(([k]) => k);

  const geo = geometry?.results || [];
  const typ = ramp?.results || [];

  if (geometry && ramp) {
    for (const s of sections.filter((x) => x.module)) {
      const g = geo.filter((r) => r.slot === s.slot && asserted(r));
      const t = typ.filter((r) => r.slot === s.slot && asserted(r));
      if (g.length + t.length && ![...g, ...t].some(failing)) {
        row('mandated', s.slot, s.module, s.node, 'geometry and type', `${g.length} geometry and ${t.length} type entries pass`);
      }
    }
  }
  for (const r of geo.filter(failing)) row('unmandated', r.slot, moduleOf(r.slot), r.node ?? null, `geometry ${r.id} ${r.measure}`, r.detail ?? '');
  for (const r of typ.filter(failing)) {
    if (r.slot === null) row('unmandated', null, null, null, `:root ${r.id}`, r.detail ?? '');
    else row('unmandated', r.slot, moduleOf(r.slot), r.node ?? null, `type ${r.id} ${r.property}`, r.detail ?? '');
  }
  for (const m of mapping.filter((x) => x.status === 'new-module')) {
    row('out-of-kit', m.slot, null, null, 'new-module', 'no Figma module to follow: the slot is composed beyond the kit');
  }
  for (const s of sections) {
    const root = s.node && boxes?.roots?.[s.node]?.box;
    if (!root) continue;
    for (const c of mandateConflicts(root)) {
      row('conflict', s.slot, s.module, c.node, 'contrast', `${c.ratio.toFixed(2)}:1 < ${c.need}:1 (${c.fg} on ${c.bg})`);
    }
  }
  for (const f of flags || []) row('pre-existing', null, null, null, 'ledger flag', f);

  rows.sort((a, b) => CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class));
  const counts = Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length]));
  return { regime: join.regime ?? null, counts, rows, notRun, pixel: pixel ? pixel.results : null };
}

export const countsLine = (counts) => CLASSES.map((c) => `${c} ${counts[c]}`).join(' · ');

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function pixelLine(r) {
  if (r.verdict === 'advisory') return `${r.slot} ${r.pct.toFixed(2)}% (text ${r.textPct === null || r.textPct === undefined ? 'n/a' : `${r.textPct.toFixed(2)}%`}, Δh ${r.heightDelta})`;
  return `${r.slot} ${r.verdict === 'n/a' ? 'n/a' : 'no verdict'}: ${r.reason}`;
}

export function registerMd(register) {
  const { page, regime, counts, rows, notRun, pixel } = register;
  const out = [`# Divergence register: ${page}`, ''];
  out.push(`${countsLine(counts)}${regime ? ` · regime ${regime}` : ''}`, '');
  if (notRun.length) out.push(`Not run: ${notRun.join(', ')}`, '');
  for (const cls of CLASSES) {
    const mine = rows.filter((r) => r.class === cls);
    if (!mine.length) continue;
    out.push(`## ${cls} (${mine.length})`, '', '| Slot | Module | Node | Check | Detail | Link |', '|---|---|---|---|---|---|');
    for (const r of mine) out.push(`| ${cell(r.slot ?? '—')} | ${cell(r.module ?? '—')} | ${cell(r.node ?? '—')} | ${cell(r.check)} | ${cell(r.detail)} | ${r.link ? `[Figma](${r.link})` : '—'} |`);
    out.push('');
  }
  if (pixel?.length) {
    const ref = REFERENCE_CLASSES;
    out.push('## Pixel (advisory)', '', `Reference classes are uncalibrated (light text ${ref.lightText}%, inverted ${ref.inverted}%, raster ground ${ref.rasterGround}%): orientation, not a bar. Nothing here fails the gate.`, '');
    for (const r of pixel) out.push(`- ${pixelLine(r)}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
