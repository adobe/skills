import { execFileSync } from 'node:child_process';

/**
 * Evals must never open a visible browser window. Three layers:
 *  1. a shell prelude (exported before every agent shell command) that refuses `--headed` and `open`,
 *  2. a grader that fails any run whose commands tried to get a window anyway,
 *  3. a sweeper that kills automation browsers started without --headless.
 */
export const HEADLESS_PRELUDE = [
  'playwright-cli() { for a in "$@"; do case "$a" in --headed|--headed=*) echo "playwright-cli: --headed is disabled here, run headless" >&2; return 2;; esac; done; command playwright-cli "$@"; }',
  'open() { echo "open: opening windows is disabled here, run headless" >&2; return 2; }',
].join('\n');

const TRIES_FOR_A_WINDOW = [
  /--headed\b/,
  /headless["']?\s*:\s*false/,
  /(^|[;&|(]\s*)open\s/,
  /(Google Chrome|Chromium)(\.app\/Contents\/MacOS\/[\w ]+)?["']?\s+[^|;&]*(--remote-debugging|--user-data-dir)(?![^|;&]*--headless)/,
];

/** Commands in this run that tried to open a visible browser. */
export const headedAttempts = (providerResponse) =>
  (providerResponse.metadata?.toolCalls ?? [])
    .map((c) => String(c.input?.command ?? ''))
    .filter((cmd) => TRIES_FOR_A_WINDOW.some((re) => re.test(cmd)));

/** Grader: a run that tried to open a window is invalid, whatever else it achieved. */
export function headlessOnly(_output, { providerResponse }) {
  const attempts = headedAttempts(providerResponse);
  return attempts.length
    ? { pass: false, score: 0, reason: `tried to open a visible browser: ${attempts[0].replace(/\s+/g, ' ').slice(0, 140)}` }
    : { pass: true, score: 1, reason: 'headless only' };
}

const AUTOMATION_FLAGS = /--remote-debugging-(port|pipe)|--enable-automation|--user-data-dir=(\/tmp|\/var\/folders|\/private)/;
const BROWSER = /^(\/Applications\/(Google Chrome( Canary| for Testing)?|Chromium)\.app\/Contents\/MacOS\/|.*\/ms-playwright\/.*(Chromium|chrome-headless-shell|Google Chrome for Testing))/;

/** Kills automation browsers running without --headless (main processes only). Returns how many. */
export function killHeadedBrowsers() {
  let killed = 0;
  for (const line of execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8' }).split('\n')) {
    const [, pid, command] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    if (command && BROWSER.test(command) && !command.includes('--type=') && AUTOMATION_FLAGS.test(command) && !command.includes('--headless')) {
      try {
        process.kill(Number(pid));
        killed += 1;
      } catch {
        // already gone
      }
    }
  }
  return killed;
}
