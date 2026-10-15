// skills/reskin/scripts/render/root-tokens.mjs — render the :root token contract block from
// donor-tokens.json. Pure: no imports, no I/O. Contract names: stardust/reference/token-contract.md.

const SPACING = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

// First present path wins; order is the contract's order.
export const ROOT_MAP = [
  { name: '--heading-font-family', paths: ['type.headingFamily', 'type.display.fontFamily', 'type.family'] },
  { name: '--body-font-family', paths: ['type.family'] },
  { name: '--heading-xxl', paths: ['type.display.fontSize'] },
  { name: '--heading-xl', paths: ['type.h2.fontSize'] },
  { name: '--heading-lg', paths: ['type.h3.fontSize'] },
  { name: '--heading-md', paths: ['type.h4.fontSize'] },
  { name: '--body', paths: ['type.body.fontSize'] },
  { name: '--body-sm', paths: ['type.bodySmall.fontSize', 'type.small.fontSize'] },
  { name: '--line-height-heading', paths: ['type.display.lineHeight'] },
  { name: '--line-height-body', paths: ['type.body.lineHeight'] },
  { name: '--color-bg', paths: ['palette.pageBg'] },
  { name: '--color-fg', paths: ['palette.bodyFg'] },
  { name: '--color-accent', paths: ['palette.accent', 'buttons.primary.background'] },
  ...SPACING.map((s) => ({ name: `--spacing-${s}`, paths: [`layout.spacing.${s}`] })),
  { name: '--section-padding', paths: ['layout.sectionPaddingY'] },
  { name: '--max-width', paths: ['layout.containerMaxWidth'] },
  { name: '--radius', paths: ['radii.primary', 'buttons.primary.borderRadius'] },
];

const TYPE_PROPS = [['size', 'fontSize'], ['line-height', 'lineHeight'], ['weight', 'fontWeight'], ['letter-spacing', 'letterSpacing']];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const kebab = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const lookup = (tokens, path) => path.split('.').reduce((o, k) => (isObject(o) ? o[k] : undefined), tokens);
const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

function checked(value, path) {
  if (typeof value !== 'string') throw new Error(`root-tokens: ${path} must be a string, got ${typeof value}`);
  if (/[;{}<\n\r]/.test(value)) throw new Error(`root-tokens: ${path} holds a character that cannot appear in a CSS value (; { } < or a newline)`);
  return value.trim();
}

export function rootTokens(donorTokens) {
  const tokens = isObject(donorTokens) ? donorTokens : {};
  const entries = [];
  const absent = [];
  for (const { name, paths } of ROOT_MAP) {
    const from = paths.find((p) => present(lookup(tokens, p)));
    if (from) entries.push({ name, value: checked(lookup(tokens, from), from), from });
    else absent.push({ name, paths });
  }
  if (isObject(tokens.type)) {
    for (const [key, group] of Object.entries(tokens.type)) {
      if (!isObject(group)) continue;
      for (const [suffix, prop] of TYPE_PROPS) {
        if (!present(group[prop])) continue;
        const from = `type.${key}.${prop}`;
        entries.push({ name: `--type-${kebab(key)}-${suffix}`, value: checked(group[prop], from), from });
      }
    }
  }
  const lines = entries.map((e) => `  ${e.name}: ${e.value};`);
  if (absent.length) lines.push(`  /* absent in donor-tokens.json: ${absent.map((a) => a.name).join(', ')} */`);
  return { css: `:root {\n${lines.join('\n')}\n}\n`, entries, absent };
}
