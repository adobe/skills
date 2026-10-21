import { Command, CommanderError, Option } from 'commander';
import { CliError, EXIT } from '#src/errors.mjs';
import { fail } from '#src/output.mjs';
import { registerBrowser } from '#src/commands/browser.mjs';
import { registerProbe } from '#src/commands/probe.mjs';
import { registerExt } from '#src/commands/ext.mjs';
import { registerMask } from '#src/commands/mask.mjs';
import { registerPage } from '#src/commands/page.mjs';
import { registerCache } from '#src/commands/cache.mjs';
import { registerSite } from '#src/commands/site.mjs';
import { registerDoc } from '#src/commands/doc.mjs';

const ROOT_HELP = `
Output contract:
  stdout is one JSON document (or one text block with --format text); stderr carries
  progress and logs. WEB_DEBUG=1 echoes every playwright-cli call to stderr.
  Errors: { "error": { "code", "message", "hint" } }. Main codes: USAGE, NO_SESSION,
  SESSION_EXISTS, PLAYWRIGHT_CLI, BLOCKED, TIMEOUT, UNSUPPORTED, EMPTY_RESULT, INTERNAL.

Exit codes:
  0 ok · 1 failure · 2 usage or environment · 3 blocked by bot protection
  By code: 2: USAGE NO_SESSION SESSION_EXISTS PLAYWRIGHT_CLI UNSUPPORTED · 3: BLOCKED ·
  1: everything else

Sessions:
  With a <url> and no --session, a browser is opened and closed for that one command.
  --session <name> reuses an open browser; with a <url> it opens one under that
  name if needed; either way the browser stays open. WEB_SESSION, then
  PLAYWRIGHT_CLI_SESSION, is the default for --session. Session names are global per
  user and machine: never invent a fixed name, reuse the name browser open returns.
  The escape hatch
  \`playwright-cli -s <session> …\` drives the same browser.

Artifacts:
  Written under --output (default ./.web) in a per-session directory
  <session>-<command>/ with stable file names (metadata.json, probe-report.json, ...).

Requires playwright-cli >= 0.1.20 on PATH (npm install -g @playwright/cli@latest).

Long-form docs ship in the binary: web doc (topics), web doc extending (add your own
commands on top of web through the library export of @adobe/web-cli).

Typical flows:
  one-shot:  web page tree <url>
  scripted:  S=$(web browser open <url> | jq -r .session)   # generated name, never a fixed one
             web page overlays --session "$S" --dismiss; web page tree --session "$S";
             web browser close --session "$S"
  blocked:   web probe <url>, then re-run with --recipe <recipePath>
             (printed by probe, e.g. .web/probe-<id>/browser-recipe.json)
`;

/**
 * Build the root program with all command groups. `deps.extend(program, deps)` runs last,
 * so a consumer can add its own commands and still get the error and exit-code contract.
 * @param {{ driverFactory?: Function, env?: NodeJS.ProcessEnv, stdout?: object,
 *   stderr?: object, extend?: Function }} [deps]
 */
export function createProgram(deps = {}) {
  const { env = process.env, stdout = process.stdout, stderr = process.stderr } = deps;
  const program = new Command('web')
    .description('Drive a browser and analyze pages')
    .option(
      '--session <name>',
      'browser session name',
      env.WEB_SESSION ?? env.PLAYWRIGHT_CLI_SESSION,
    )
    .addOption(
      new Option('--format <format>', 'output format: json or text')
        .choices(['json', 'text'])
        .default('json'),
    )
    .option('--output <dir>', 'directory for artifacts', './.web')
    .option('--headed', 'show the browser window')
    .option('--recipe <file>', 'browser recipe produced by `web probe`')
    .configureOutput({
      writeOut: (s) => stdout.write(s),
      writeErr: (s) => stderr.write(s),
    })
    .addHelpText('after', ROOT_HELP)
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();
  registerBrowser(program, deps);
  registerProbe(program, deps);
  registerPage(program, deps);
  registerExt(program, deps);
  registerMask(program, deps);
  registerSite(program, deps);
  registerCache(program, deps);
  registerDoc(program, deps);
  deps.extend?.(program, deps);
  return program;
}

/**
 * Parse argv and return the process exit code.
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function runCli(argv, deps = {}) {
  const { stdout = process.stdout, stderr = process.stderr } = deps;
  try {
    await createProgram(deps).parseAsync(argv);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      const help = err.code === 'commander.helpDisplayed' || err.code === 'commander.help';
      if (help || err.code === 'commander.version') return EXIT.OK;
      const message = err.message.replace(/^error: /, '').trimEnd();
      const usage = new CliError('USAGE', message, { hint: 'run: web <command> --help' });
      return fail(usage, { stdout, stderr });
    }
    const wrapped = err instanceof Error ? err : new CliError('INTERNAL', String(err));
    return fail(wrapped, { stdout, stderr });
  }
}
