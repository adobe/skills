#!/usr/bin/env node
/**
 * skills/deploy/scripts/block-lint.mjs — static runtime-order lint for block JS
 * (see ../reference/block-js-scaffold.md § Runtime order for the rules).
 *
 * Three facts about the boilerplate runtime are grep-checkable before any
 * render, so they are checked here instead of being re-learned in the QA loop:
 *
 *   BL-CSS   🔴  a block that imports another block's builder
 *                (`import … from '../<dep>/<dep>.js'`) must await
 *                `loadCSS(\`${window.hlx.codeBasePath}/blocks/<dep>/<dep>.css\`)`
 *                — the runtime auto-loads CSS only for blocks authored on the page.
 *   BL-MEDIA 🔴  `querySelectorAll(<sel>)` whose selector lists BOTH `picture`
 *                and `img` collects every pipelined image twice (the pipeline
 *                wraps each <img> in <picture>; the harness never shows it).
 *   BL-GUARD 🟡  a project decorator called from `decorateMain()` in
 *                scripts/scripts.js re-runs on every chrome fragment
 *                (loadFragment → decorateMain); it should carry a
 *                `data-decorated` / `dataset.decorated` idempotency guard.
 *   IMG-HARDCODED 🔴  content imagery baked into block JS: an array/object of
 *                ≥ 2 /img|/icons image paths consumed by index or key, a
 *                template path interpolating slug()/slugify()/toClassName()/
 *                textContent, or createOptimizedPicture('/img/…'). Per-row
 *                imagery is authored content (encode-contract § Images). A
 *                single literal path (logo, fallback) never fires; a JSDoc
 *                `@fixed-asset <path> — <reason>` exempts a deliberate one.
 *
 * Experience Workspace rules (the former manual "static review" checklist item —
 * each rule is the static signature of a recorded dead-text class). POSITION-AWARE: reading `cell.textContent` to
 * classify (#79: a class, dataset, attribute or condition) is legal and silent;
 * only text written back into DISPLAYED positions fires.
 *   EW-VALUE 🔴  authored text re-emitted as text: `x.textContent|innerHTML|innerText =`
 *                whose RHS reads `.textContent|.innerHTML|.innerText` (directly or via
 *                a variable whose initializer IS a text read — `const t = cell.textContent.trim();`;
 *                a ternary, a template or a line that merely mentions `.textContent` taints
 *                nothing), or `${…}` of such a read at TEXT position in a template literal
 *                (after a `>`, before the next `<`; nested literals inherit the position).
 *                Class/attribute positions (`class="x-${kind}"`, `aria-label="${score}"`)
 *                and a template of empty `.ew-text` slots are silent. EW1: MOVE the element.
 *   EW-JOIN  🔴  `.join(…)` over collected texts (`[...ps].map((p) => p.textContent).join(' ')`).
 *   EW-RETAG 🔴  an element created as h1–h6/p (`createElement('h2')`, `el('p')`)
 *                filled from authored text — the heading loses its index.
 *   EW-HEADER 🔴 `<header` / `createElement('header')` in block DOM (#107: the stock
 *                `header { height }` reservation clamps and hides it).
 *   EW-CLONE 🟡  `cloneNode(true)` in a file that never calls stripInstrumentation()
 *                (🔴 when the clone source is a picture/a/p/heading query — EW4).
 *   EW-CLASS 🟡  `classList.add` / `className =` on an element queried as an authored
 *                h1–h6/p/ul/ol/a/picture (the class dies in the editor swap — EW2).
 *   EW2-CSS  🟡  block CSS with `>` or a positional pseudo-class between a wrapper
 *                token and an authored tag (`.text > p`, `h3:first-child`), outside
 *                `:has()`/`:not()`/`:where()` and outside `.prosemirror-editor` rules.
 *   EW-RHYTHM 🟡 `p + p` (any authored-tag adjacency) in block CSS — each moved element
 *                sits in its own wrapper on the published page, so it never matches.
 *   EW-COMPOSED 🟡 (with --styles) a styles.css selector under `body.<class>`,
 *                `.section:first-of-type` or `main > .section:has(…)` ending on prose.
 * Chrome blocks (header/footer) and any file that DECLARES an `@ew-exempt` item (EW5 —
 * `parseExemptTags` from ew-editability-probe.mjs, any block comment) are capped at 🟡
 * with the reason appended: the static lint cannot see the text, `block-roundtrip --ew`
 * decides per text against the declared tag/regex. Undeclared shapes stay 🔴.
 *
 *   node skills/deploy/scripts/block-lint.mjs blocks/ [scripts/scripts.js] [--styles styles/styles.css] [--json]
 *
 * Exit codes: 0 = clean (🟡 allowed), 2 = at least one 🔴, 1 = usage failure.
 * No npm dependency (regex + a small template-literal scanner over source text — blocks
 * are small and regular); imports only the pure exemption parser from the probe.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseExemptTags } from './ew-editability-probe.mjs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node skills/deploy/scripts/block-lint.mjs <blocks-dir> [scripts/scripts.js] [--styles styles/styles.css] [--json]');
  process.exit(args.length ? 0 : 1);
}
const json = args.includes('--json');
const stylesAt = args.indexOf('--styles');
const stylesCss = stylesAt >= 0 ? args[stylesAt + 1] : null;
if (stylesAt >= 0 && (!stylesCss || stylesCss.startsWith('--'))) { console.error('block-lint: --styles needs a path'); process.exit(1); }
const paths = args.filter((a, i) => !a.startsWith('--') && (stylesAt < 0 || i !== stylesAt + 1));
const blocksDir = paths[0];
const scriptsJs = paths[1] || (existsSync('scripts/scripts.js') ? 'scripts/scripts.js' : null);
if (!existsSync(blocksDir) || !statSync(blocksDir).isDirectory()) {
  console.error(`block-lint: ${blocksDir} is not a directory`);
  process.exit(1);
}

const STOCK = new Set(['decorateButtons', 'decorateIcons', 'buildAutoBlocks', 'decorateSections', 'decorateBlocks', 'decorateTemplateAndTheme']);
const findings = [];
// one finding per (code, file, line): an innerHTML template literal with two
// interpolations is one defect, reported once
const add = (level, code, file, line, msg) => { if (!findings.some((f) => f.code === code && f.file === file && f.line === line)) findings.push({ level, code, file, line, msg }); };
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

// ---- blocks/*/*.js (+ *.css for the EW2/rhythm rules)
const blockFiles = [];
const cssFiles = [];
for (const name of readdirSync(blocksDir)) {
  const dir = path.join(blocksDir, name);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.js')) blockFiles.push(path.join(dir, f));
    else if (f.endsWith('.css')) cssFiles.push(path.join(dir, f));
  }
}
const AUTHORED = 'h[1-6]|p|ul|ol|picture|a';
const TEXT_READ = /\.(?:textContent|innerHTML|innerText)\b(?!\s*=[^=])/;
const isChrome = (file) => /[\/\\](?:header|footer)[\/\\][^\/\\]+$/.test(file);
// Strip comments and string-literal noise is NOT attempted: blocks are small; a
// comment quoting a signature is a false positive the author can rephrase.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

// Every `${…}` in every template literal, with its POSITION in the literal's own
// markup: 'text' (after a `>`, before the next `<`), 'attr' (inside a tag), or the
// inherited position when the literal shows no tag before it (a nested literal
// inherits from its interpolation; a top-level literal that is the RHS of
// `.innerHTML =` / `insertAdjacentHTML(…,` starts at 'text', any other at 'none').
// `target` is the assigned element for the innerHTML case (EW-RETAG needs it).
function interpolations(code) {
  const out = [];
  let i = 0;
  const skipString = (q) => { i += 1; while (i < code.length && code[i] !== q && code[i] !== '\n') { if (code[i] === '\\') i += 1; i += 1; } i += 1; };
  const scanTemplate = (inherit, target) => { // code[i] === '`'
    const start = i; i += 1;
    let last = null;
    while (i < code.length) {
      const ch = code[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { i += 1; return; }
      if (ch === '$' && code[i + 1] === '{') {
        const pos = last === '>' ? 'text' : last === '<' ? 'attr' : inherit;
        i += 2; const exprStart = i; let depth = 1;
        while (i < code.length && depth) {
          const c = code[i];
          if (c === '{') depth += 1;
          else if (c === '}') { depth -= 1; if (!depth) break; }
          if (c === '`') { scanTemplate(pos, target); continue; }
          if (c === '"' || c === "'") { skipString(c); continue; }
          i += 1;
        }
        out.push({ expr: code.slice(exprStart, i), pos, index: start, target });
        i += 1; continue;
      }
      if (ch === '<' || ch === '>') last = ch;
      i += 1;
    }
  };
  while (i < code.length) {
    const ch = code[i];
    if (ch === '`') {
      const before = code.slice(Math.max(0, i - 80), i);
      const html = before.match(/([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\.(?:innerHTML|outerHTML)\s*=\s*$/) || before.match(/insertAdjacentHTML\(\s*['"][^'"]*['"]\s*,\s*$/);
      scanTemplate(html ? 'text' : 'none', html ? html[1] || null : null);
      continue;
    }
    if (ch === '"' || ch === "'") { skipString(ch); continue; }
    i += 1;
  }
  return out;
}

for (const file of blockFiles) {
  const src = readFileSync(file, 'utf8');
  const code = stripComments(src);
  // 🔴 → 🟡 for chrome and for a file that declares an @ew-exempt item (EW5): the lint
  // cannot see the text, the runtime gate matches it against the declared tag/regex.
  const ew = parseExemptTags(src);
  const capWhy = isChrome(file) ? 'chrome block' : ew ? (ew.all ? '@ew-exempt all' : `${ew.items.length} @ew-exempt item(s) declared`) : null;
  const flag = (level, ruleCode, line, msg) => add(level === '🔴' && capWhy ? '🟡' : level, ruleCode, file, line, level === '🔴' && capWhy ? `${msg} [capped 🟡: ${capWhy} — block-roundtrip --ew decides per text (EW5)]` : msg);
  // ── EW value-slotting family ──
  // identifiers whose INITIALIZER is a text read: const title = cell.textContent.trim();
  // (a ternary, a template literal or a line that merely mentions .textContent taints nothing)
  const textVars = new Set([...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.?[\]()'"]*\.(?:textContent|innerText|innerHTML)\b(?:\.\w+\([^)]*\))*\s*[;\n]/g)].map((m) => m[1]));
  const readsText = (expr) => TEXT_READ.test(expr) || [...textVars].some((v) => new RegExp(`(?<![\\w$.])${v.replace(/\$/g, '\\$')}(?![\\w$])`).test(expr));
  // elements created as heading/paragraph: const h = document.createElement('h2') | el('p', …)
  const retagVars = new Set([...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:document\.)?(?:createElement|el|create|dom|h)\(\s*['"](?:h[1-6]|p)['"]/g)].map((m) => m[1]));
  const retag = (target, line, what) => flag('🔴', 'EW-RETAG', line, `${target} was created as a heading/paragraph and is filled from authored text (${what}) — the authored element loses its index; MOVE the authored h*/p into the wrapper (EW1)`);
  for (const m of code.matchAll(/([A-Za-z_$][\w$.]*)\.(textContent|innerHTML|innerText)\s*=(?!=)\s*([^;\n]+)/g)) {
    const [, target, , rhs] = m;
    if (/^\s*`/.test(rhs)) continue; // a template-literal RHS is judged by position below
    const plain = rhs.replace(/`(?:[^`\\]|\\.)*`/g, '``'); // inline literals inside a call chain: idem
    if (!readsText(plain)) continue; // a literal / runtime value: ai-readability's domain, not EW1
    const base = target.split('.')[0];
    if (retagVars.has(base)) retag(target, lineOf(code, m.index), rhs.trim().slice(0, 50));
    else flag('🔴', 'EW-VALUE', lineOf(code, m.index), `${target}.${m[2]} = ${rhs.trim().slice(0, 60)} — authored text re-emitted as text is dead in the workspace; MOVE the element (EW1); classify from textContent, never display from it (#79)`);
  }
  // template literals: only an interpolation at TEXT position that reads authored text fires
  const withoutNested = (expr) => { let e = expr; let prev; do { prev = e; e = e.replace(/`(?:[^`\\]|\\.)*`/g, '``'); } while (e !== prev); return e; };
  for (const t of interpolations(code)) {
    if (t.pos !== 'text' || !readsText(withoutNested(t.expr))) continue; // nested literals are judged on their own position
    if (t.target && retagVars.has(t.target)) retag(t.target, lineOf(code, t.index), `\${${t.expr.trim().slice(0, 40)}}`);
    else flag('🔴', 'EW-VALUE', lineOf(code, t.index), `template literal interpolates authored text at text position (\${${t.expr.trim().slice(0, 40)}}) — a rebuilt DOM carries no index; MOVE the authored element into an empty slot (EW1); class/attribute positions are legal (#79)`);
  }
  for (const m of code.matchAll(/\.join\(\s*(['"`])[^'"`]*\1\s*\)/g)) {
    const stmtStart = Math.max(code.lastIndexOf(';', m.index), code.lastIndexOf('\n', code.lastIndexOf('\n', m.index) - 1)) + 1;
    const stmt = code.slice(stmtStart, m.index);
    if (TEXT_READ.test(stmt) || /\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.(?:textContent|innerText)/.test(stmt)) flag('🔴', 'EW-JOIN', lineOf(code, m.index), `texts joined into one string (${m[0]}) — N authored elements become one dead node; keep each element and wrap them (EW1)`);
  }
  // ── EW-HEADER (#107) ──
  for (const m of code.matchAll(/createElement\(\s*['"]header['"]\s*\)|<header[\s>]/g)) {
    add('🔴', 'EW-HEADER', file, lineOf(code, m.index), '<header> emitted in block DOM — the stock header { height: var(--nav-height) } + visibility rules clamp and hide it (#107); use <div class="…-head">');
  }
  // ── EW-CLONE (EW4) ──
  if (!/stripInstrumentation\s*\(/.test(code)) {
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\([^)]*\))?)\.cloneNode\(\s*true\s*\)/g)) {
      const source = m[1];
      const base = source.split(/[.(]/)[0];
      const fromQuery = new RegExp(`(?:const|let|var)\\s+${base}\\s*=\\s*[^;\\n]*querySelector(?:All)?\\(\\s*['"][^'"]*\\b(?:${AUTHORED})\\b`).test(code) || new RegExp(`querySelector(?:All)?\\(\\s*['"][^'"]*\\b(?:${AUTHORED})\\b[^'"]*['"]\\s*\\)\\.cloneNode`).test(m[0]);
      flag(fromQuery ? '🔴' : '🟡', 'EW-CLONE', lineOf(code, m.index), `${source}.cloneNode(true) with no stripInstrumentation() in the file — the clone keeps data-prose-index and the editor attaches to the first copy in DOM order (EW4)`);
    }
  }
  // ── EW-CLASS (EW2) ──
  const authoredVars = new Set([...code.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;\\n]*?(?:querySelector\\(\\s*['"][^'"]*\\b(?:${AUTHORED})\\b[^'"]*['"]|closest\\(\\s*['"](?:${AUTHORED})['"])`, 'g'))].map((m) => m[1]));
  for (const m of code.matchAll(new RegExp(`querySelectorAll\\(\\s*['"][^'"]*\\b(?:${AUTHORED})\\b[^'"]*['"]\\s*\\)\\.forEach\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)[^)]*\\)?\\s*=>\\s*\\{?\\s*\\1\\.(?:classList\\.add|className\\s*=)`, 'g'))) {
    add('🟡', 'EW-CLASS', file, lineOf(code, m.index), 'class added to authored elements in a querySelectorAll().forEach — classes on an authored h*/p/ul/a die in the editor swap; put the class on the wrapper and style by descent (EW2)');
  }
  for (const v of authoredVars) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${v.replace(/\$/g, '\\$')}\\.(?:classList\\.add\\(|className\\s*=(?!=))`, 'g'))) {
      add('🟡', 'EW-CLASS', file, lineOf(code, m.index), `${v} (queried as an authored element) gets a class — it dies in the editor swap; wrap it (labelWrap) and style .wrap :where(${v.length > 12 ? 'tag' : v}) (EW2)`);
    }
  }
  // BL-CSS
  const importRe = /import\s+[^;]*?from\s+['"]\.\.\/([a-z0-9-]+)\/\1\.js['"]/g;
  for (const m of src.matchAll(importRe)) {
    const dep = m[1];
    const cssRe = new RegExp(`loadCSS\\([^)]*blocks/${dep}/${dep}\\.css`);
    if (!cssRe.test(src)) {
      add('🔴', 'BL-CSS', file, lineOf(src, m.index), `imports ../${dep}/${dep}.js but never loadCSS()s /blocks/${dep}/${dep}.css — the built ${dep} DOM ships unstyled unless a ${dep} block is authored on the page`);
    }
  }
  // IMG-HARDCODED
  const exempt = [...src.matchAll(/@fixed-asset\s+(\S+)/g)].map((m) => m[1]);
  const isExempt = (p) => exempt.some((e) => p.includes(e.replace(/\*.*$/, '')));
  const IMG = /(['"`])(\/(?:img|icons)\/[^'"`\s]+\.(?:png|jpe?g|webp|avif|svg|gif))\1/g;
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[[{]([\s\S]*?)[\]}]\s*;/g)) {
    const paths = [...m[2].matchAll(IMG)].map((x) => x[2]).filter((p) => !isExempt(p));
    if (paths.length >= 2 && new RegExp(`\\b${m[1]}\\s*\\[`).test(src)) {
      add('🔴', 'IMG-HARDCODED', file, lineOf(src, m.index), `${m[1]} holds ${paths.length} image paths consumed by index/key — per-row imagery is authored content (<img> in the row), not a JS table`);
    }
  }
  for (const m of src.matchAll(/`\/(?:img|icons)\/[^`]*\$\{[^}]*(?:slug|slugify|toClassName|textContent)[^}]*\}[^`]*`/g)) {
    if (!isExempt(m[0])) add('🔴', 'IMG-HARDCODED', file, lineOf(src, m.index), `image path derived from authored text (${m[0].slice(0, 60)}) — a title edit drops the asset and authors have no swap path; author the <img> per row`);
  }
  for (const m of src.matchAll(/createOptimizedPicture\(\s*(['"`])(\/(?:img|icons)\/[^'"`]+)\1/g)) {
    if (!isExempt(m[2])) add('🔴', 'IMG-HARDCODED', file, lineOf(src, m.index), `createOptimizedPicture('${m[2]}') builds content imagery from a code-origin path — author the <img>, or declare @fixed-asset for a genuine brand fixture`);
  }
  // BL-MEDIA
  const qsaRe = /querySelectorAll\(\s*(['"`])([^'"`]*)\1/g;
  for (const m of src.matchAll(qsaRe)) {
    const sel = m[2];
    if (/(^|[\s,>+~(])picture\b/.test(sel) && /(^|[\s,>+~(])img\b/.test(sel)) {
      add('🔴', 'BL-MEDIA', file, lineOf(src, m.index), `querySelectorAll('${sel}') matches every pipelined image twice (<picture><img>) — collect pictures when present, else imgs, never both`);
    }
  }
}

// ---- blocks/*/*.css — EW2-CSS, EW-RHYTHM
const stripGroups = (sel) => { // drop the content of :has(…) / :not(…) / :where(…) — a `>` inside them is below the authored element
  let out = sel; let prev;
  do { prev = out; out = out.replace(/:(?:has|not|where)\([^()]*\)/g, ':__()'); } while (out !== prev);
  return out;
};
const selectorsOf = (css) => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(noComments))) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('@')) continue;
    const line = noComments.slice(0, m.index + m[1].search(/\S/)).split('\n').length;
    // split the selector list on top-level commas only (`:is(h2, h3)` stays whole)
    let depth = 0; let cur = '';
    for (const ch of raw) {
      if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { out.push({ sel: cur.trim(), line }); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push({ sel: cur.trim(), line });
  }
  return out;
};
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8');
  for (const { sel, line } of selectorsOf(css)) {
    if (/\.prosemirror-editor|\.ProseMirror/.test(sel)) continue; // edit-mode foundation rules are written against the editor DOM on purpose
    const s2 = stripGroups(sel);
    const child = s2.match(new RegExp(`[\\w\\])]\\s*>\\s*(?::is\\([^)]*\\b(?:${AUTHORED})\\b[^)]*\\)|(?:${AUTHORED})\\b)`));
    const positional = s2.match(new RegExp(`\\b(?:${AUTHORED})(?::(?:first|last|only)-child|:nth-(?:last-)?child\\([^)]*\\)|:nth-(?:last-)?of-type\\([^)]*\\))`));
    if (child || positional) add('🟡', 'EW2-CSS', file, line, `\`${sel}\` — a child combinator / positional pseudo-class on the path to an authored element stops matching in edit mode (the editor inserts div.prosemirror-editor > div.ProseMirror above it); use descendant selectors on the wrapper (EW2)`);
    const adj = s2.match(new RegExp(`\\b(?:${AUTHORED})\\s*\\+\\s*(?:${AUTHORED})\\b`));
    if (adj) add('🟡', 'EW-RHYTHM', file, line, `\`${sel}\` — \`${adj[0]}\` never matches once each moved element sits in its own wrapper; write the rhythm at wrapper level (.text > * + *, .wrap + .wrap)`);
  }
}
// ---- styles.css — EW-COMPOSED (T32.4 bullet 4), only with --styles
if (stylesCss) {
  if (!existsSync(stylesCss)) { console.error(`block-lint: --styles ${stylesCss} not found`); process.exit(1); }
  const css = readFileSync(stylesCss, 'utf8');
  for (const { sel, line } of selectorsOf(css)) {
    if (/\.prosemirror-editor|\.ProseMirror/.test(sel)) continue;
    const composed = /^body\.[\w-]+|\.section:first-of-type|main\s*>\s*\.section:has\(/.test(sel);
    const endsOnProse = /(?:^|[\s>+~])(?:h[1-6]|p|ul|ol|li|a)(?::[\w-]+(?:\([^)]*\))?)*\s*$/.test(sel);
    if (composed && endsOnProse) add('🟡', 'EW-COMPOSED', stylesCss, line, `\`${sel}\` — a composed page/section selector ending on prose drifts in edit mode (the two editor wrappers break the path) and hides the rule from block-roundtrip; scope it on the section or wrapper, not the prose element (EW10)`);
  }
}

// ---- scripts/scripts.js — BL-GUARD
if (scriptsJs && existsSync(scriptsJs)) {
  const src = readFileSync(scriptsJs, 'utf8');
  // Body of the function named `fn`: text between its first `{` and the matching `}`.
  const bodyOf = (fn) => {
    const head = src.match(new RegExp(`(?:function\\s+${fn}\\s*\\([^)]*\\)|(?:const|let|var)\\s+${fn}\\s*=[^{;]*)\\s*\\{`));
    if (!head) return null;
    let depth = 0;
    for (let i = head.index + head[0].length - 1; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}' && (depth -= 1) === 0) return { index: head.index, text: src.slice(head.index, i + 1) };
    }
    return null;
  };
  const dm = bodyOf('decorateMain');
  if (dm) {
    const calls = [...dm.text.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((c) => c[1]);
    for (const fn of new Set(calls)) {
      if (STOCK.has(fn) || fn === 'decorateMain' || fn === 'function') continue;
      const body = bodyOf(fn);
      if (!body) continue; // imported or inline — cannot judge
      if (!/data-decorated|dataset\.decorated/.test(body.text)) {
        add('🟡', 'BL-GUARD', scriptsJs, lineOf(src, body.index), `${fn}() runs from decorateMain() on the page AND on every chrome fragment (loadFragment → decorateMain) with no data-decorated guard — a second pass double-decorates the footer/nav`);
      }
    }
  }
}

// ---- report
const red = findings.filter((f) => f.level === '🔴').length;
if (json) {
  console.log(JSON.stringify({ files: blockFiles.length, cssFiles: cssFiles.length, scriptsJs, stylesCss, findings, red }, null, 2));
} else {
  for (const f of findings) console.log(`${f.level} ${f.code} ${f.file}:${f.line} — ${f.msg}`);
  console.log(`block-lint: ${blockFiles.length} block JS + ${cssFiles.length} block CSS${scriptsJs ? ` + ${scriptsJs}` : ''}${stylesCss ? ` + ${stylesCss}` : ''}, ${red} 🔴, ${findings.length - red} 🟡`);
}
process.exit(red ? 2 : 0);
