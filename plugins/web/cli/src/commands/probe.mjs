import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { CliError } from '#src/errors.mjs';
import { createContext } from '#src/context.mjs';
import { artifactDir, withSession } from '#src/session.mjs';
import { loadBundle } from '#src/bundles/index.mjs';
import { checkHealth, detectSignals, findDocumentChain } from '#src/driver/blocked.mjs';

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' +
  ' AppleWebKit/537.36 (KHTML, like Gecko)' +
  ' Chrome/120.0.0.0 Safari/537.36';

export const STEPS = [
  {
    name: 'default',
    browser: 'chromium',
    stealth: false,
    uaOverride: false,
    persistent: false,
    config: { browser: 'chromium', stealth: false, uaOverride: false },
  },
  {
    name: 'stealth',
    browser: 'chromium',
    stealth: true,
    uaOverride: false,
    persistent: false,
    config: { browser: 'chromium', stealth: true, uaOverride: false },
  },
  {
    name: 'stealth-ua',
    browser: 'chromium',
    stealth: true,
    uaOverride: true,
    persistent: false,
    config: { browser: 'chromium', stealth: true, uaOverride: true },
  },
  {
    name: 'chrome',
    browser: 'chrome',
    stealth: true,
    uaOverride: true,
    persistent: false,
    config: { browser: 'chrome', stealth: true, uaOverride: true },
  },
  {
    name: 'persistent',
    browser: 'chrome',
    stealth: true,
    uaOverride: true,
    persistent: true,
    config: { browser: 'chrome', stealth: true, uaOverride: true },
  },
];

function buildBrowserConfig(stepDef) {
  const launchOptions = {};
  if (stepDef.browser !== 'chromium') launchOptions.channel = stepDef.browser;
  if (stepDef.uaOverride) launchOptions.args = [`--user-agent=${REALISTIC_UA}`];
  return { browserName: 'chromium', launchOptions };
}

function waitForStable(driver, session) {
  for (let i = 0; i < 10; i += 1) {
    if (driver.evaluate(session, 'document.readyState') === 'complete') return;
  }
}

function documentHeaderLines(driver, session, finalUrl) {
  const indices = findDocumentChain(driver.requests(session), finalUrl);
  return indices.flatMap((i) => driver.responseHeaders(session, i).split('\n').filter(Boolean));
}

function collectHeaders(driver, session, health, log) {
  try {
    return { networkLines: documentHeaderLines(driver, session, health.url) };
  } catch (err) {
    const headerError = `Failed to read main-document response headers: ${err.message}`;
    log(`  warning: ${headerError}`);
    return { networkLines: [], headerError };
  }
}

async function runStep(driver, { url, dir, stepDef, headed, log }) {
  const stealthPath = join(dir, `stealth-${stepDef.name}.js`);
  const browserConfig = buildBrowserConfig(stepDef);
  const base = { name: stepDef.name, config: stepDef.config };
  const start = Date.now();
  const initScripts = [];
  try {
    if (stepDef.stealth) {
      writeFileSync(stealthPath, loadBundle('stealth-init.js'));
      initScripts.push(stealthPath);
    }
    const launch = {
      url,
      headed,
      config: browserConfig,
      persistent: stepDef.persistent,
      initScripts,
    };
    const out = await withSession(driver, launch, (session) => observe(driver, session, log));
    const step = {
      ...base,
      result: out.result,
      health: out.health,
      durationMs: Date.now() - start,
    };
    if (out.headerError) step.headerError = out.headerError;
    return { step, networkLines: out.networkLines, browserConfig };
  } catch (err) {
    const health = {
      title: '',
      url: '',
      bodyLength: 0,
      status: 0,
      hasMainContent: false,
      error: err.message,
    };
    const step = { ...base, result: 'error', health, durationMs: Date.now() - start };
    return { step, networkLines: [], browserConfig };
  } finally {
    rmSync(stealthPath, { force: true });
  }
}

function observe(driver, session, log) {
  waitForStable(driver, session);
  const health = driver.pageHealth(session);
  const result = checkHealth(health);
  return { result, health, ...collectHeaders(driver, session, health, log) };
}

const HELP = `
Example:
  web probe https://example.com
Output:
  { report: { url, timestamp, steps, firstSuccess, detectedSignals }, recipePath }
  recipe file: { url, cliConfig, persistent }
Notes:
  Tries default, stealth, stealth-ua, chrome, persistent until a page loads. Writes
  <output>/probe-<id>/probe-report.json and browser-recipe.json (stealth-init.js beside
  them); pass recipePath to other commands with --recipe. Progress goes to stderr.
  Each playwright-cli call is capped at 30 s per step.
  Always opens its own browsers (it compares configurations): an explicit --session or
  --recipe is rejected, an exported WEB_SESSION/PLAYWRIGHT_CLI_SESSION is ignored;
  --headed is honoured.
Exit codes:
  3 BLOCKED when all steps are blocked (no recipe is written).
`;

/**
 * Try each probe step until a page loads unblocked.
 * @returns {{ report: object, recipePath: string|null }}
 */
export async function runProbe(driver, { url, outputDir, headed, log = () => {} }) {
  const dir = artifactDir(outputDir, 'probe', randomBytes(2).toString('hex'));
  const steps = [];
  const networkLines = [];
  let success = null;
  for (const stepDef of STEPS) {
    log(`Probing with ${stepDef.name} config...`);
    const out = await runStep(driver, { url, dir, stepDef, headed, log });
    steps.push(out.step);
    networkLines.push(...out.networkLines);
    log(
      `  ${stepDef.name}: ${out.step.result} (${out.step.health.title || 'no title'}, ` +
        `${out.step.durationMs}ms)`,
    );
    if (out.step.result === 'success') {
      success = { stepDef, browserConfig: out.browserConfig };
      break;
    }
  }
  const report = {
    url,
    timestamp: new Date().toISOString(),
    steps,
    firstSuccess: success?.stepDef.name ?? null,
    detectedSignals: detectSignals(
      networkLines,
      steps.map((s) => s.health),
    ),
  };
  writeFileSync(join(dir, 'probe-report.json'), JSON.stringify(report, null, 2));
  if (!success) return { report, recipePath: null };
  const recipePath = join(dir, 'browser-recipe.json');
  const browser = { ...success.browserConfig };
  if (success.stepDef.stealth) {
    const stealthPath = join(dir, 'stealth-init.js');
    writeFileSync(stealthPath, loadBundle('stealth-init.js'));
    browser.initScript = [resolve(stealthPath)];
  }
  const recipe = {
    url,
    cliConfig: { browser },
    persistent: success.stepDef.persistent,
  };
  writeFileSync(recipePath, JSON.stringify(recipe, null, 2));
  return { report, recipePath };
}

/**
 * Register `probe <url>`.
 * @param {import('commander').Command} program
 * @param {object} deps
 */
export function registerProbe(program, deps) {
  program
    .command('probe <url>')
    .description('detect bot/CDN protection and produce a browser recipe')
    .addHelpText('after', HELP)
    .action(async (url, _opts, command) => {
      const { opts, driver, print } = createContext(command, deps, { timeoutMs: 30_000 });
      const explicit = (name) => command.getOptionValueSourceWithGlobals(name) === 'cli';
      if (explicit('session') || explicit('recipe')) {
        throw new CliError(
          'USAGE',
          'probe launches its own browsers; --session and --recipe are not supported',
          { hint: 'run: web probe <url> [--headed] [--output <dir>]' },
        );
      }
      const stderr = deps.stderr ?? process.stderr;
      const log = (msg) => stderr.write(`${msg}\n`);
      const { report, recipePath } = await runProbe(driver, {
        url,
        outputDir: opts.output,
        headed: opts.headed,
        log,
      });
      if (report.firstSuccess === null) {
        throw new CliError('BLOCKED', 'all probe steps were blocked', {
          hint:
            'see report.steps for per-step health; ' +
            'the site may require a persistent profile or manual login',
        });
      }
      print({ report, recipePath });
    });
}
