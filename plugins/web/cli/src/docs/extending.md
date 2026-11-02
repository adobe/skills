# Extending `web` with your own commands

`@adobe/web-cli` is also a library (`dist/lib.mjs`, the package's `exports`). A program
can build the stock `web` program, add its own subcommands and ship the result as its own
binary. The added commands get the same contract as the built-in ones: one JSON document on
stdout, `--format text`, `--session` and one-shot browsers, `--output` artifacts, the
blocked-page gate, JSON errors and exit codes 0/1/2/3.

## Minimal program

```js
#!/usr/bin/env node
import { runCli, runPageCommand, CliError } from '@adobe/web-cli';

const extend = (program, deps) =>
  program
    .command('acme')
    .command('audit [url]')
    .option('--strict')
    .action((url, _opts, command) =>
      runPageCommand(command, deps, {
        url,
        fn: (driver, session, opts) => {
          const n = driver.run(session, { code: 'document.querySelectorAll("h1").length' });
          if (opts.strict && n !== 1) throw new CliError('EMPTY_RESULT', `${n} h1 elements`);
          return { h1: n };
        },
      }),
    );

process.exitCode = await runCli(process.argv, { extend });
```

`acme-web acme audit https://example.com` prints `{ "h1": 1, "url", "session", "durationMs" }`;
`acme-web page tree …` and every other stock command keep working. The skills of the web
plugin run through the extended binary with `WEB=acme-web`.

## Surface

Everything exported by the library; nothing else is public.

- `runCli(argv, deps)`: build the program, parse, print errors as JSON, return the exit
  code. `deps.extend(program, deps)` runs after the stock groups are registered.
- `createProgram(deps)`: the commander root alone, when you need to own parsing; thrown
  errors are then yours to print (`fail`).
- `runPageCommand(command, deps, { url, fn, records })`: run `fn(driver, session, opts)` on a page.
  Resolves `<url>` or `--session`, applies the recipe (`--recipe`, `$WEB_RECIPE` or
  `./recipe.json`) and `--headed`, rejects blocked
  pages, adds `url`, `session` and `durationMs`, prints. `records` names the recipe type a
  `--save-recipe` command replaces; recording launches without that type.
- `createContext(command, deps)`: `{ opts, driver, print, recipe }` (`recipe` is the path to launch
  browsers with, if any) for commands that are not
  "one page"; `opts` merges the global and the command options.
- `withSession(driver, { session, url, headed, recipePath }, fn)`: the session rule on
  its own: opens an ephemeral or named browser, runs `fn(name)`, closes only ephemeral ones.
- `artifactDir(outputDir, session, command)` and `artifactPath(…, name)`: where to write
  files, `<output>/<session>-<command>/<name>`, absolute.
- `emit(result, { format, text, stdout })`: print one result document (JSON, or `text`
  with `--format text`).
- `fail(err, { stdout, stderr })`: print an error document, return its exit code.
- `CliError(code, message, { hint })` and `EXIT`: codes map to exits, `USAGE NO_SESSION
  SESSION_EXISTS PLAYWRIGHT_CLI UNSUPPORTED` → 2, `BLOCKED` → 3, others → 1.
- `createDriver({ outputDir, timeoutMs })`: the playwright-cli driver (`open`, `attach`,
  `goto`, `close`, `closeAll`, `list`, `evaluate`, `run`, `inject`, `cdp`, `screenshot`,
  `pageHealth`, `requests`, `responseHeaders`). Only this module spawns `playwright-cli`.

`deps` also accepts `env`, `stdout`, `stderr` and `driverFactory` (a fake driver for tests;
see `src/lib.test.mjs` in the package for a complete example).

## Rules for added commands

- Print exactly one document on stdout through `emit` or `runPageCommand`; logs go to stderr.
- Throw `CliError` with a code from the list above and a `hint` that names the next command.
- Never spawn `playwright-cli` yourself; go through the driver so `WEB_DEBUG=1` and
  session rules keep working.
- Never invent a fixed session name; reuse the name `web browser open` returns.
- Write files under `artifactDir` with stable names so callers can find them without parsing.
