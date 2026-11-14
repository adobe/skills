import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { findJson } from '../../lib/outputs.mjs';

// The grader's own copy of the skill's page-health rules. Keeping it here means no copy of the skill has to
// sit anywhere an agent could find it, which matters for the no-skill arm.
const ERROR_TITLE_PATTERN = /error|denied|blocked|not satisfied|403|captcha|challenge|attention required|just a moment/i;
const MIN_BODY_LENGTH = 100;

// The script the CLI injects for `stealth: true`.
const STEALTH_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../cli/src/bundles/stealth-init.js',
);

function checkHealth(health) {
  if (health.url?.startsWith('chrome-error://')) return 'blocked';
  if (health.status === 0 || health.status >= 400) return 'blocked';
  if (ERROR_TITLE_PATTERN.test(health.title)) return 'blocked';
  if (health.bodyLength < MIN_BODY_LENGTH && !health.hasMainContent) return 'blocked';
  return 'success';
}

/** Unwraps the value printed by `playwright-cli eval`. */
function parseEvalOutput(raw) {
  const start = raw.indexOf('### Result');
  if (start === -1) return raw;
  const end = raw.indexOf('### Ran Playwright code');
  let value = raw.slice(start + '### Result'.length, end === -1 ? undefined : end).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      value = typeof parsed === 'string' ? parsed : value.slice(1, -1);
    } catch {
      value = value.slice(1, -1);
    }
  }
  return value;
}

const HEALTH_JS = `JSON.stringify({
  title: document.title || '',
  url: location.href,
  bodyLength: document.body ? document.body.innerText.length : 0,
  status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0,
  hasMainContent: !!document.querySelector('main, [role="main"], article, #content')
})`;

const pw = (session, ...args) =>
  execFileSync('playwright-cli', [`-s=${session}`, ...args], { encoding: 'utf-8', timeout: 60_000 }).trim();

/** Reads the agent's files from the `out` dir of the run that produced `providerResponse`. */
export const readOutputs = (providerResponse) => ({
  report: findJson(providerResponse, 'probe-report.json'),
  recipe: findJson(providerResponse, 'recipe.json')?.probe?.[0],
});

/** Expected recipe shape for each probe step, from the SKILL.md mapping table. */
export function recipeProblems(recipe, firstSuccess) {
  const opts = recipe.config?.launchOptions ?? {};
  const wantStealth = firstSuccess !== 'default';
  const wantUa = ['stealth-ua', 'chrome', 'persistent'].includes(firstSuccess);
  const wantChrome = ['chrome', 'persistent'].includes(firstSuccess);
  const checks = {
    'stealth flag': Boolean(recipe.stealth) === wantStealth,
    'user-agent arg': (opts.args ?? []).some((a) => a.startsWith('--user-agent=')) === wantUa,
    'chrome channel': (opts.channel === 'chrome') === wantChrome,
    'persistent flag': Boolean(recipe.persistent) === (firstSuccess === 'persistent'),
  };
  return Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
}

/** Loads `url` with the recipe the way the SKILL.md consumer section describes. */
export function loadWithRecipe(recipe, url) {
  const id = randomUUID().slice(0, 8);
  const session = `verify-${id}`;
  const dir = join(tmpdir(), `bp-${session}`);
  mkdirSync(dir, { recursive: true });
  const initScript = [];
  if (recipe.stealth) {
    const stealthPath = join(dir, 'stealth-init.js');
    copyFileSync(STEALTH_SCRIPT, stealthPath);
    initScript.push(stealthPath);
  }
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ browser: { ...recipe.config, initScript } }));
  const args = ['open', url, `--config=${configPath}`];
  if (recipe.persistent) args.push('--persistent');
  try {
    pw(session, ...args);
    for (let i = 0; i < 10 && parseEvalOutput(pw(session, 'eval', 'document.readyState')) !== 'complete'; i++);
    const health = JSON.parse(parseEvalOutput(pw(session, 'eval', HEALTH_JS)));
    return { health, result: checkHealth(health) };
  } finally {
    for (const cmd of ['close', 'delete-data']) {
      try { pw(session, cmd); } catch { /* session already gone */ }
    }
  }
}
