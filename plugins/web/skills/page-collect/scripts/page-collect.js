#!/usr/bin/env node
'use strict';

/**
 * page-collect — Extract structured resources from a webpage via playwright-cli.
 *
 * Usage:
 *   node page-collect.js <subcommand> <url> [--output <dir>] [--browser-recipe <path>]
 *
 * Subcommands:
 *   all       Run all collectors
 *   icons     Extract and classify SVG icons
 *   metadata  Extract meta tags, OG, structured data
 *   text      Extract visible body text and headings
 *   forms     Extract form structures
 *   videos    Extract video embeds
 *   socials   Extract social media links
 *
 * Requires playwright-cli on PATH.
 */

const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { join, resolve, dirname } = require('node:path');
const { tmpdir } = require('node:os');

const SUBCOMMANDS = ['all', 'icons', 'metadata', 'text', 'forms', 'videos', 'socials'];

// ─── Icon processing (Node-side pure functions) ──────────────────────────────

const ICON_MAX_SIZE = 48;

const KNOWN_PATTERNS = [
  'search', 'cart', 'account', 'user', 'menu',
  'hamburger', 'close', 'globe', 'language', 'phone',
  'mail', 'email', 'heart', 'star', 'share',
  'download', 'arrow', 'chevron', 'caret', 'plus',
  'minus', 'check', 'info', 'warning', 'home',
  'settings', 'notification', 'bell', 'lock',
];

function classify(entry) {
  const maxDim = Math.max(entry.width, entry.height);
  const allClasses = [
    entry.parentClass, entry.containerClass,
    entry.imgClass, entry.svgClass, entry.className,
  ].filter(Boolean).join(' ').toLowerCase();
  const alt = (entry.alt || entry.parentAriaLabel || '').toLowerCase();

  if (allClasses.includes('logo') || allClasses.includes('brand') || alt.includes('logo')) {
    return 'logo';
  }
  if (maxDim > ICON_MAX_SIZE && !entry.parentTag) return 'image';
  return 'icon';
}

function deriveName(entry, index) {
  const candidates = [entry.parentAriaLabel, entry.alt, entry.id].filter(Boolean);
  const allClasses = [entry.parentClass, entry.imgClass, entry.svgClass, entry.className]
    .filter(Boolean).join(' ').toLowerCase();

  for (const pattern of KNOWN_PATTERNS) {
    if (allClasses.includes(pattern)) return { name: pattern, confidence: 'high' };
  }
  for (const candidate of candidates) {
    const clean = candidate.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (clean.length > 0 && clean.length < 30) return { name: clean, confidence: 'high' };
  }
  return { name: `icon-${index}`, confidence: 'low' };
}

function optimizeSvg(svgString, classification) {
  let svg = svgString;
  svg = svg.replace(/<\?xml[^?]*\?>\s*/g, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  svg = svg.replace(/<title[\s\S]*?<\/title>/gi, '');
  svg = svg.replace(/<desc[\s\S]*?<\/desc>/gi, '');
  svg = svg.replace(
    /\s*(xmlns:xlink|xmlns:sketch|xmlns:dc|xmlns:cc|xmlns:rdf|xmlns:sodipodi|xmlns:inkscape)="[^"]*"/g, ''
  );
  svg = svg.replace(/\s*(sketch:|sodipodi:|inkscape:)[a-z-]+="[^"]*"/gi, '');
  svg = svg.replace(/\s*data-name="[^"]*"/g, '');
  svg = svg.replace(/\s*(?:class|aria-hidden|focusable|display|style)="[^"]*"/g, '');

  if (!svg.includes('viewBox')) {
    const wMatch = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)["']/);
    const hMatch = svg.match(/\bheight=["'](\d+(?:\.\d+)?)["']/);
    if (wMatch && hMatch) {
      svg = svg.replace('<svg', `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`);
    }
  }
  svg = svg.replace(/\s*(?<![\w-])width=["'][^"']*["']/g, '');
  svg = svg.replace(/\s*(?<![\w-])height=["'][^"']*["']/g, '');

  if (classification === 'icon') {
    svg = svg.replace(/\b(fill|stroke)="(?!none|currentColor|transparent)[^"]+"/g, '$1="currentColor"');
    svg = svg.replace(/\b(fill|stroke)='(?!none|currentColor|transparent)[^']+'/g, "$1='currentColor'");
  }
  svg = svg.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
  return svg;
}

// ─── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0];
  const url = args.find((a) => a.startsWith('http') || a.startsWith('file://'));
  let output = './page-collect-output';

  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) output = args[outputIdx + 1];

  const recipeIdx = args.indexOf('--browser-recipe');
  const browserRecipe = (recipeIdx !== -1 && args[recipeIdx + 1]) ? args[recipeIdx + 1] : null;

  if (!subcommand || !url) {
    process.stderr.write(
      'Usage: node page-collect.js <subcommand> <url> [--output <dir>] [--browser-recipe <path>]\n'
      + `Subcommands: ${SUBCOMMANDS.join(', ')}\n`
    );
    process.exit(1);
  }
  if (!SUBCOMMANDS.includes(subcommand)) {
    process.stderr.write(`Unknown subcommand: ${subcommand}\nValid: ${SUBCOMMANDS.join(', ')}\n`);
    process.exit(1);
  }
  return { subcommand, url, output: resolve(output), browserRecipe };
}

// ─── Browser recipe ──────────────────────────────────────────────────────────

function loadBrowserRecipe(recipePath) {
  if (!recipePath) return { cliConfig: {}, stealthScript: null };
  let recipe;
  try {
    recipe = JSON.parse(readFileSync(recipePath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Failed to load browser recipe from ${recipePath}: ${err.message}\n`);
    process.exit(1);
  }
  return { cliConfig: recipe.cliConfig || {}, stealthScript: recipe.stealthInitScript || null };
}

// ─── Envelope stripping ──────────────────────────────────────────────────────

/**
 * playwright-cli wraps run-code/eval output in:
 *   ### Result\n<content>\n### Ran Playwright code
 * Strip the envelope if present.
 */
function stripEnvelope(output) {
  const resultStart = output.indexOf('### Result');
  if (resultStart === -1) return output.trim();
  const afterResult = output.slice(resultStart + '### Result'.length);
  // lastIndexOf: playwright-cli always appends the marker at the very end,
  // so the first occurrence could be inside page content (e.g. SVG text).
  const endIdx = afterResult.lastIndexOf('### Ran Playwright code');
  return (endIdx === -1 ? afterResult : afterResult.slice(0, endIdx)).trim();
}

// ─── playwright-cli helpers ──────────────────────────────────────────────────

function detectPlaywrightCli() {
  const check = spawnSync('playwright-cli', ['--version'], { encoding: 'utf-8' });
  if (check.error || check.status !== 0) {
    process.stderr.write(
      'playwright-cli not found. Run `playwright-cli --help` for install guidance.\n'
    );
    process.exit(1);
  }
}

function buildCliConfig(cliConfig, bundlePath, stealthScript, tmpPrefix) {
  const config = {
    browser: { ...cliConfig.browser, initScript: [] },
  };
  if (stealthScript) {
    const stealthPath = `${tmpPrefix}-stealth.js`;
    writeFileSync(stealthPath, stealthScript);
    config.browser.initScript.push(stealthPath);
  }
  config.browser.initScript.push(bundlePath);
  return config;
}

// ─── Icon output writer ──────────────────────────────────────────────────────

async function writeIcons(svgs, url, outputDir) {
  const iconsDir = join(outputDir, 'icons');
  await mkdir(iconsDir, { recursive: true });

  const icons = [];
  let unnamedIndex = 1;
  const usedNames = new Set();
  const nameCollisionCounts = new Map();

  for (const entry of svgs) {
    const classification = classify(entry);
    if (classification === 'image') continue;

    let svgContent = null;
    if (entry.source === 'inline-svg') {
      svgContent = entry.svg;
    } else if (entry.source === 'img-svg') {
      svgContent = entry.resolvedSvg || null;
    } else if (entry.source === 'css-bg-svg') {
      svgContent = entry.resolvedSvg || null;
    } else if (entry.source === 'svg-sprite') {
      if (entry.symbolSvg) {
        svgContent = entry.symbolSvg
          .replace(/^<symbol/, '<svg xmlns="http://www.w3.org/2000/svg"')
          .replace(/<\/symbol>$/, '</svg>');
      } else {
        svgContent = entry.fallbackSvg;
      }
    }

    if (!svgContent) continue;

    const { name: rawName, confidence } = deriveName(entry, unnamedIndex);
    let name = rawName;
    if (usedNames.has(name)) {
      const count = (nameCollisionCounts.get(rawName) || 1) + 1;
      nameCollisionCounts.set(rawName, count);
      name = `${rawName}-${count}`;
    }
    if (confidence === 'low') unnamedIndex++;
    usedNames.add(name);

    const optimized = optimizeSvg(svgContent, classification);
    const filename = `${name}.svg`;
    await writeFile(join(iconsDir, filename), optimized);

    const context = [
      entry.containerTag ? entry.containerTag.toLowerCase() : '',
      entry.parentTag    ? entry.parentTag.toLowerCase()    : '',
      entry.parentAriaLabel || '',
    ].filter(Boolean).join(' ');

    icons.push({
      name,
      class: classification,
      source: entry.source,
      file: `icons/${filename}`,
      nameConfidence: confidence,
      context: context || 'unknown',
    });
  }

  const manifest = { url, icons };
  await writeFile(join(outputDir, 'icons.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { subcommand, url, output, browserRecipe } = parseArgs(process.argv);

  detectPlaywrightCli();
  await mkdir(output, { recursive: true });

  const { cliConfig, stealthScript } = loadBrowserRecipe(browserRecipe);
  const scriptDir = dirname(require.resolve('./page-collect.js'));
  const bundlePath = join(scriptDir, 'page-collect-bundle.js');
  const tmpPrefix = join(tmpdir(), `page-collect-${process.pid}`);

  // Build playwright-cli --config JSON
  const config = buildCliConfig(cliConfig, bundlePath, stealthScript, tmpPrefix);
  const configPath = `${tmpPrefix}-config.json`;
  writeFileSync(configPath, JSON.stringify(config));

  // Write the run-code extraction script
  const collectors = subcommand === 'all' ? null : [subcommand];
  const runCodePath = `${tmpPrefix}-extract.js`;
  writeFileSync(
    runCodePath,
    `async page => {\n  return await page.evaluate(`
    + `(c) => window.__pageCollect.extract(c), ${JSON.stringify(collectors)});\n}`
  );

  const cleanup = () => {
    for (const p of [configPath, runCodePath, `${tmpPrefix}-stealth.js`]) {
      if (existsSync(p)) rmSync(p, { force: true });
    }
  };

  const OPEN_TIMEOUT_MS = 60_000;
  const RUN_TIMEOUT_MS  = 30_000;
  const SS_TIMEOUT_MS   = 10_000;

  try {
    // Open the URL with bundle injected
    process.stderr.write(`Navigating to ${url}...\n`);
    const openResult = spawnSync(
      'playwright-cli',
      ['open', url, `--config=${configPath}`],
      { encoding: 'utf-8', timeout: OPEN_TIMEOUT_MS }
    );
    if (openResult.error) {
      const extra = openResult.error.code === 'ETIMEDOUT'
        ? ` (timed out after ${OPEN_TIMEOUT_MS / 1000}s — page may be too slow or unreachable)`
        : '';
      throw new Error(`playwright-cli open failed: ${openResult.error.message}${extra}`);
    }
    if (openResult.status !== 0) {
      throw new Error(`playwright-cli open exited ${openResult.status}: ${openResult.stderr}`);
    }

    // Run extraction
    process.stderr.write('Extracting page resources...\n');
    const runResult = spawnSync(
      'playwright-cli',
      ['run-code', `--filename=${runCodePath}`],
      { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024, timeout: RUN_TIMEOUT_MS }
    );
    if (runResult.error) {
      const extra = runResult.error.code === 'ETIMEDOUT'
        ? ` (timed out after ${RUN_TIMEOUT_MS / 1000}s — try a narrower subcommand)`
        : runResult.error.code === 'ENOBUFS'
        ? ' (output exceeded 100 MB — try a narrower subcommand)'
        : '';
      throw new Error(`playwright-cli run-code failed: ${runResult.error.message}${extra}`);
    }
    if (runResult.status !== 0) {
      throw new Error(`playwright-cli run-code exited ${runResult.status}: ${runResult.stderr}`);
    }

    const raw = stripEnvelope(runResult.stdout);
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse extraction result: ${err.message}\nRaw: ${raw.slice(0, 500)}`);
    }

    // Process and write output
    if (subcommand === 'all') {
      // Screenshot via playwright-cli
      const screenshotPath = join(output, 'screenshot.jpg');
      const ssResult = spawnSync(
        'playwright-cli',
        ['screenshot', '--filename', screenshotPath],
        { encoding: 'utf-8', timeout: SS_TIMEOUT_MS }
      );
      if (ssResult.error || ssResult.status !== 0) {
        process.stderr.write(
          `Warning: screenshot failed — ${ssResult.error?.message ?? ssResult.stderr}\n`
        );
      }

      const results = {};
      if (data.svgs) {
        process.stderr.write('Processing icons...\n');
        results.icons = await writeIcons(data.svgs, data.url, output);
      }
      if (data.metadata) {
        results.metadata = data.metadata;
        await writeFile(join(output, 'metadata.json'), JSON.stringify(data.metadata, null, 2));
      }
      if (data.text) {
        results.text = data.text;
        await writeFile(join(output, 'text.json'), JSON.stringify(data.text, null, 2));
      }
      if (data.forms) {
        results.forms = data.forms;
        await writeFile(join(output, 'forms.json'), JSON.stringify(data.forms, null, 2));
      }
      if (data.videos) {
        results.videos = data.videos;
        await writeFile(join(output, 'videos.json'), JSON.stringify(data.videos, null, 2));
      }
      if (data.socials) {
        results.socials = data.socials;
        await writeFile(join(output, 'socials.json'), JSON.stringify(data.socials, null, 2));
      }

      const collection = {
        url: data.url,
        collectedAt: new Date().toISOString(),
        screenshot: 'screenshot.jpg',
        collectors: results,
      };
      await writeFile(join(output, 'collection.json'), JSON.stringify(collection, null, 2));
      process.stderr.write(`Done. Output: ${output}/collection.json\n`);

    } else if (subcommand === 'icons') {
      const manifest = await writeIcons(data.svgs || [], data.url, output);
      await writeFile(join(output, 'icons.json'), JSON.stringify(manifest, null, 2));
      process.stderr.write(`Done. Output: ${output}/icons.json\n`);

    } else {
      const result = data[subcommand];
      await writeFile(join(output, `${subcommand}.json`), JSON.stringify(result, null, 2));
      process.stderr.write(`Done. Output: ${output}/${subcommand}.json\n`);
    }

  } finally {
    cleanup();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadBrowserRecipe, classify, deriveName, optimizeSvg };
