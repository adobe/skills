#!/usr/bin/env node

/**
 * page-collect — Extract structured resources from a webpage.
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
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { collectIcons } from './collect-icons.js';
import { collectMetadata } from './collect-metadata.js';
import { collectText } from './collect-text.js';
import { collectForms } from './collect-forms.js';
import { collectVideos } from './collect-videos.js';
import { collectSocials } from './collect-socials.js';

const COLLECTORS = {
  icons: collectIcons,
  metadata: collectMetadata,
  text: collectText,
  forms: collectForms,
  videos: collectVideos,
  socials: collectSocials,
};

export function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0];
  const url = args.find(
    (a) => a.startsWith('http') || a.startsWith('file://')
  );
  let output = './page-collect-output';

  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    output = args[outputIdx + 1];
  }

  const recipeIdx = args.indexOf('--browser-recipe');
  const browserRecipe = (recipeIdx !== -1 && args[recipeIdx + 1])
    ? args[recipeIdx + 1]
    : null;

  if (!subcommand || !url) {
    console.error(
      'Usage: node page-collect.js <subcommand> <url>'
        + ' [--output <dir>] [--browser-recipe <path>]'
    );
    console.error(
      'Subcommands: all, icons, metadata, text, forms, videos, socials'
    );
    process.exit(1);
  }

  if (subcommand !== 'all' && !COLLECTORS[subcommand]) {
    console.error(`Unknown subcommand: ${subcommand}`);
    console.error(
      'Valid subcommands: all, icons, metadata, text, forms, videos, socials'
    );
    process.exit(1);
  }

  return { subcommand, url, output: resolve(output), browserRecipe };
}

export function applyBrowserRecipe(recipePath) {
  if (!recipePath) {
    return {
      launchOptions: { headless: true },
      userAgent: null,
      stealthScript: null,
    };
  }

  let recipe;
  try {
    recipe = JSON.parse(readFileSync(recipePath, 'utf-8'));
  } catch (err) {
    console.error(
      `Failed to load browser recipe from ${recipePath}: ${err.message}`
    );
    process.exit(1);
  }
  const launchOpts = recipe.cliConfig?.browser?.launchOptions || {};

  const launchOptions = { headless: true };
  if (launchOpts.channel) {
    launchOptions.channel = launchOpts.channel;
  }

  let userAgent = null;
  const uaArg = (launchOpts.args || [])
    .find((a) => a.startsWith('--user-agent='));
  if (uaArg) {
    userAgent = uaArg.split('=').slice(1).join('=');
  }

  return {
    launchOptions,
    userAgent,
    stealthScript: recipe.stealthInitScript || null,
  };
}

function detectPlaywright() {
  try {
    execSync('npx playwright --version', { stdio: 'pipe' });
  } catch {
    console.error(
      'Playwright not found. Install with: npx playwright install chromium'
    );
    process.exit(1);
  }
}

async function launchBrowser(url, recipeOpts) {
  detectPlaywright();

  const { chromium } = await import('playwright');
  const browser = await chromium.launch(recipeOpts.launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: recipeOpts.userAgent
      || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  if (recipeOpts.stealthScript) {
    await page.addInitScript(recipeOpts.stealthScript);
  }

  console.error(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  return { browser, page };
}

async function takeScreenshot(page, outputDir) {
  const screenshotPath = join(outputDir, 'screenshot.jpg');
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    type: 'jpeg',
    quality: 80,
  });
  return 'screenshot.jpg';
}

async function main() {
  const { subcommand, url, output, browserRecipe } = parseArgs(process.argv);
  await mkdir(output, { recursive: true });

  const recipeOpts = applyBrowserRecipe(browserRecipe);
  const { browser, page } = await launchBrowser(url, recipeOpts);

  try {
    if (subcommand === 'all') {
      const screenshot = await takeScreenshot(page, output);
      const results = {};

      for (const [name, collector] of Object.entries(COLLECTORS)) {
        console.error(`Running ${name} collector...`);
        results[name] = await collector(page, output);
      }

      const collection = {
        url,
        collectedAt: new Date().toISOString(),
        screenshot,
        collectors: results,
      };

      await writeFile(
        join(output, 'collection.json'),
        JSON.stringify(collection, null, 2)
      );
      console.error(`Done. Output: ${output}/collection.json`);
    } else {
      console.error(`Running ${subcommand} collector...`);
      const result = await COLLECTORS[subcommand](page, output);

      const outputFile = `${subcommand}.json`;
      await writeFile(
        join(output, outputFile),
        JSON.stringify(result, null, 2)
      );
      console.error(`Done. Output: ${output}/${outputFile}`);
    }
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
