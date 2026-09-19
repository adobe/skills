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
 *
 *   node skills/deploy/scripts/block-lint.mjs blocks/ [scripts/scripts.js] [--json]
 *
 * Exit codes: 0 = clean (🟡 allowed), 2 = at least one 🔴, 1 = usage failure.
 * Dependency-free (regex over source text — blocks are small and regular).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node skills/deploy/scripts/block-lint.mjs <blocks-dir> [scripts/scripts.js] [--json]');
  process.exit(args.length ? 0 : 1);
}
const json = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));
const blocksDir = paths[0];
const scriptsJs = paths[1] || (existsSync('scripts/scripts.js') ? 'scripts/scripts.js' : null);
if (!existsSync(blocksDir) || !statSync(blocksDir).isDirectory()) {
  console.error(`block-lint: ${blocksDir} is not a directory`);
  process.exit(1);
}

const STOCK = new Set(['decorateButtons', 'decorateIcons', 'buildAutoBlocks', 'decorateSections', 'decorateBlocks', 'decorateTemplateAndTheme']);
const findings = [];
const add = (level, code, file, line, msg) => findings.push({ level, code, file, line, msg });
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

// ---- blocks/*/*.js
const blockFiles = [];
for (const name of readdirSync(blocksDir)) {
  const dir = path.join(blocksDir, name);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) blockFiles.push(path.join(dir, f));
}
for (const file of blockFiles) {
  const src = readFileSync(file, 'utf8');
  // BL-CSS
  const importRe = /import\s+[^;]*?from\s+['"]\.\.\/([a-z0-9-]+)\/\1\.js['"]/g;
  for (const m of src.matchAll(importRe)) {
    const dep = m[1];
    const cssRe = new RegExp(`loadCSS\\([^)]*blocks/${dep}/${dep}\\.css`);
    if (!cssRe.test(src)) {
      add('🔴', 'BL-CSS', file, lineOf(src, m.index), `imports ../${dep}/${dep}.js but never loadCSS()s /blocks/${dep}/${dep}.css — the built ${dep} DOM ships unstyled unless a ${dep} block is authored on the page`);
    }
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
  console.log(JSON.stringify({ files: blockFiles.length, scriptsJs, findings, red }, null, 2));
} else {
  for (const f of findings) console.log(`${f.level} ${f.code} ${f.file}:${f.line} — ${f.msg}`);
  console.log(`block-lint: ${blockFiles.length} block files${scriptsJs ? ` + ${scriptsJs}` : ''}, ${red} 🔴, ${findings.length - red} 🟡`);
}
process.exit(red ? 2 : 0);
