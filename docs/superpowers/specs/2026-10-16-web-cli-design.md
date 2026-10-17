# `web` CLI — design

Status: approved for planning · Date: 2026-10-16 · Scope: `plugins/web`

## Intent

The web plugin holds ~6.8k lines of browser scripts spread across nine skills.
They work, but they are only reachable from inside their skill folder, so agents
working in other repos copy pieces of them and the copies drift. Several skills
(page-tree, page-reduce) have no script at all: the SKILL.md itself is the
script, in copy-paste form, which is exactly what gets copied.

Replace the per-skill scripts with one CLI, `web`, that any layer can call: the
skills in this plugin, other plugins in this repo (e.g. aem/scrape-webpage), and
AI agents in unrelated projects. Skills become thin: when to use, which `web`
command to run, how to read its output.

## Goals

- One entry point, discoverable end to end through `--help`: an agent reading
  `web --help` and `web <group> <cmd> --help` needs nothing else.
- Machine-readable, uniform output and exit codes across every command.
- One browser layer, so playwright-cli quirks are fixed once, not nine times.
- Multiple independent browser sessions; several agents can each own several
  browsers side by side without collisions.
- Usable from any repo (publishable to npm), while this plugin stays
  self-contained with zero install.

## Non-goals

- Reimplementing playwright-cli. Anything it already does well (snapshot, click,
  fill, tabs, network, storage) is reached by using playwright-cli directly on
  the same session; `web` wraps only what the analysis commands need plus the
  session plumbing.
- A plugin or extension system for the CLI. New capabilities are new
  subcommands in this package.
- Interactive/TTY UX (prompts, spinners, colours). Consumers are agents.
- Backward compatibility with the old `node scripts/*.js` invocations.

## Anti-goals (would make this a failure even if it "works")

- Orphan browsers: a `web` command that exits leaving a browser it started.
- Output an agent must parse heuristically: mixed text and JSON on stdout,
  errors as prose, or exit 0 on failure.
- A second home for browser quirks: any file other than the driver spawning
  `playwright-cli`.
- Two implementations kept alive during "migration". Old scripts are deleted in
  the same change that ships their replacement.

## Constraints

- Node ≥ 22.12, ESM only. No TypeScript build step is required (plain `.mjs`
  with JSDoc is the current repo style); builder may add `tsc --noEmit` with
  `checkJs` if cheap.
- Browser backend is `playwright-cli` on PATH, minimum version 0.1.20
  (`--json`, `attach --cdp`, `run-code --filename`, `/tmp` file access). The CLI
  checks the version once at startup and exits 2 with an install hint if absent
  or too old.
- playwright-cli facts the driver must absorb (see
  `plugins/web/docs/playwright-cli-constraints.md`, kept and extended):
  `eval` takes a single expression (no `;`, no `return`); files handed to
  playwright-cli live under the output dir or `.playwright-cli/`; session names are
  global per user and machine (any directory); a session must be `open`ed before any other
  command; `screenshot` takes `--filename`, not a positional path.
- Repo conventions: `AGENTS.md` at `~/.pi/agent` applies (≤100 lines/function,
  absolute imports, no dead code, zero warnings). Per-skill semantic-release
  stays; the CLI is one more release unit.

## Decisions

### Package and distribution

- Location: `plugins/web/cli/`. `package.json` name `@adobe/web-cli`, `bin:
  { "web": "./bin/web.mjs" }`, `type: module`, `private: false`,
  `files: [bin, dist]`. Version managed by semantic-release like the skills.
- Dependencies: `commander@15` (runtime). `esbuild` (dev) produces
  `plugins/web/cli/dist/web.mjs`, a single file with commander inlined,
  **committed to the repo** so the plugin runs with no `npm install`:
  skills call `node <plugin-dir>/cli/dist/web.mjs …`. When `@adobe` npm scope
  access is confirmed, publishing is a release-config addition; callers switch
  to `npx -y @adobe/web-cli@1 …` with no code change. A CI check fails if
  `dist/` is stale relative to `src/`.
- `page langs` needs `cld3-asm` (WASM). Builder's choice between inlining the
  WASM into the bundle and lazy-importing with a clear "run `npm install` in
  `<cli-dir>`" error (exit 2). Preference: inline if the bundle stays under
  ~5 MB; otherwise lazy-import. Either way the other commands never pay for it.

### CLI framework

commander 15: zero deps, ESM, nested subcommands, variadic args, rejects
unknown options (agents invent flags; silent acceptance is a bug factory),
`showHelpAfterError`, `showSuggestionAfterError`. Every command and option
has a one-line description; every group has `addHelpText('after', …)` with one
realistic example invocation and the shape of its output.

### Command tree

```
web [--session <name>] [--format json|text] [--output <dir>] [--headed] [--recipe <file>]
├── browser                         session plumbing
│   ├── open [url]                  launch a browser; prints { session, url, headed, cdpPort? }
│   │     --session <name>          name to assign (default: generated web-xxxx)
│   │     --recipe <file>           browser-recipe.json from `web probe`
│   │     --cdp-port <n>            launch with --remote-debugging-port=<n>
│   │     --headed
│   ├── attach <cdp-url>            join a running Chrome (http://host:port or ws://…)
│   ├── list                        all sessions: { sessions: [{ name, url, headed, status }] }
│   ├── close                       close the --session browser
│   ├── close-all                   close every session started in this cwd
│   ├── eval <expr>                 JS expression in the page (single expression)
│   ├── run <file|code>             Playwright snippet; receives `page`
│   ├── cdp <Method> [params-json]  raw CDP via page.context().newCDPSession(page)
│   └── screenshot [--full-page] [--selector <css>]   writes to --output, prints { path }
├── probe <url>                     bot/CDN protection → { report, recipePath }
├── page                            analysis commands; ephemeral session unless --session given
│   ├── tree [url]                  spatial DOM tree (page-tree): text, json, id→node map
│   ├── reduce [url]                skeleton (page-reduce)
│   ├── collect <what> [url]        what ∈ all|icons|metadata|text|forms|videos|socials
│   ├── langs [url]                 language detection (page-langs)
│   └── overlays [url]              consent/overlay detection (page-prep)
│         --dismiss                 run the dismiss recipe (quick|thorough via --mode)
│         --mode quick|thorough     default thorough
│         --refresh-db              re-fetch Consent-O-Matic rules first
├── ext                             Chrome extension pilot (cdp-ext-pilot)
│   ├── launch <dist-dir>           starts Chrome with the unpacked extension; prints { session, cdpPort }
│   ├── open sidepanel|popup|options
│   ├── status
│   └── close
└── mask <display-domain> <target-url>   local HTTPS proxy with a fake domain (domain-mask)
```

Naming rule: groups are nouns an agent reasons about (browser, page, ext);
leaf commands are verbs or the thing produced. No skill names leak into the
tree.

`--recipe` is global because ephemeral `page *` runs need it as
much as `browser open` does. `page *` commands encapsulate every step the old
SKILL.md orchestrated by hand (scroll to bottom and back for lazy content,
neutralise fixed/sticky positioning, inject bundle, capture); the agent never
repeats those steps.

### Sessions

- Every command that touches a browser, except `probe`, takes `--session <name>`; env var
  `WEB_SESSION`, then `PLAYWRIGHT_CLI_SESSION`, is the fallback so an agent sets it once per run. No shared
  `default` session: two agents on `default` would stomp on each other.
- `browser open` without `--session` generates `web-<4 hex>` and returns it.
  `browser open --session <name>` where `<name>` is already open exits 2
  (`SESSION_EXISTS`, hint: `web browser close` or pick another name); it never
  silently reuses or replaces a browser.
- `page *` with a `<url>` and no `--session` run **ephemeral**:
  open `web-<4 hex>`, work, print, close in `finally` (also on SIGINT/SIGTERM).
  `--session <name>` reuses an open browser; with a `<url>` it opens one under that
  name if needed; either way the browser stays open. `<url>` is optional when the
  session is open (operate on the loaded page); not open and no `<url>` exits 2.
- `browser eval|run|cdp|screenshot|close` require an open session and fail
  fast (exit 2) with `hint: "run: web browser open <url> --session <name>"`.
  No lazy start: eval against about:blank is never intended, and lazy starts
  are how orphans happen.
- `probe` always opens its own browsers (it compares configurations); `--session` and
  `--recipe` are rejected (exit 2).
- Sessions are playwright-cli sessions: `playwright-cli -s <name> snapshot`
  works on a browser `web` opened. Document this as the escape hatch.
- `ext launch` is a session like any other (`--cdp-port` set); `ext *`
  commands take `--session`.

### Output contract

- stdout: exactly one JSON document per invocation (`--format json`, default).
  `--format text` prints the human form a skill would otherwise render
  (e.g. the indented tree); still nothing else on stdout.
- stderr: progress, warnings, debug (`WEB_DEBUG=1` adds the playwright-cli
  commands issued).
- Artifacts (screenshots, recipe files, large reports) are written under
  `--output <dir>` (default `./.web/`, project-relative to satisfy playwright-cli
  file-access rules) and referenced by path in the JSON.
- Exit codes: `0` ok · `1` command failed · `2` usage / environment (bad
  args, no session, playwright-cli missing) · `3` blocked by bot protection.
- Errors: `{ "error": { "code": "BLOCKED" | "NO_SESSION" | "USAGE" |
  "PLAYWRIGHT_CLI" | "TIMEOUT" | …, "message": "…", "hint": "…" } }` on
  stdout, same exit codes. `BLOCKED` hint is always `web probe <url>` then
  retry with `--recipe`. No auto-probe.
- Every `page *` result carries `{ url, session, durationMs }` alongside its
  payload so results can be correlated.
- Commands with several natural outputs nest them in the one document
  (`page tree` → `{ text, tree, nodeMap }`); `--format text` prints the text
  member, or pretty JSON when a command has no text form.
- Artifacts live under `--output` in a per-session directory `<session>-<command>/`
  with stable file names, so concurrent runs sharing a cwd never overwrite each other.

### Browser driver

`src/driver/playwright-cli.mjs` is the **only** module that spawns
`playwright-cli`. Interface (all async, all throw typed errors):

```
open({ session, url, headed, recipe, cdpPort })  → SessionInfo
attach({ session, cdpUrl })                        → SessionInfo
list()                                             → SessionInfo[]
close(session) · closeAll()
eval(session, expr)                                → parsed JSON or string
run(session, codeOrFile)                           → result
inject(session, bundlePath)                        → void   (initScript via --config)
cdp(session, method, params)                       → result (through run + newCDPSession)
screenshot(session, { path, fullPage, selector })  → { path }
```

Rules: always pass `--json`; always `-s=<session>`; temp files it must create
go under `--output` and are removed in `finally`; expressions handed to `eval`
are wrapped as an IIFE so callers may use statements; anything larger than an
expression goes through `run`. Blocked-page detection (status 403/503 bodies,
challenge titles, known CDN markers — lifted from browser-probe) runs after
`open`/`attach` navigation only, not on every `eval`, so every command gets
exit 3 for free without paying per call. Timeouts are per call with a sane default
and overridable by the command.

Analysis logic (`src/commands/page/*.mjs`) never knows playwright-cli exists:
it receives a `driver` and a `session`. In-page bundles (page-tree, page-reduce,
page-collect) move unchanged to `src/bundles/` and are injected via
`driver.inject`.

### Skills after the change

- Each SKILL.md: trigger conditions, the exact `web …` command(s), how to
  interpret the JSON, and when to chain (`probe` → `--recipe`; `overlays
  --dismiss` before `tree`). No shell orchestration, no `scripts/` dir.
- `cdp-connect` skill is removed; its SKILL.md is replaced by a short pointer
  to `web browser attach|eval|cdp`. Plugin `plugin.json` description updated.
- `plugins/web/docs/playwright-cli-constraints.md` is kept as the driver's
  reference; `docs/testing-locally.md` updated for the CLI.
- Evals under `plugins/web/evals/` are updated to invoke `web` commands.

### Testing

- Unit tests (`node --test`, colocated `*.test.mjs`): analysis commands with a
  fake driver; output contract (one JSON doc, exit codes, error shapes);
  session-name generation; arg parsing edge cases (unknown flag → exit 2,
  missing url and no session → exit 2).
- One real smoke test, gated on `playwright-cli` being present: `browser open`
  a local `file://` fixture, `page tree --session`, `browser close`, assert
  `browser list` is empty afterwards (no orphans).
- A `dist/` freshness check in CI.

## Left to the builder

- Internal file layout under `src/`, beyond the driver/commands/bundles split.
- Exact JSON schema of each `page *` result — keep the shapes the existing
  scripts emit (`references/output-schema.md`, `references/collectors.md`)
  unless a field is clearly redundant; document each in `--help` "after" text.
- How `mask` is wired (it needs `sudo` + mkcert; keep its current behaviour,
  just re-homed).
- cld3-asm bundling choice (see Distribution).
- Whether `page overlays --dismiss thorough` keeps the screenshot verification
  step or returns the data for the agent to verify. `--dismiss` itself runs the
  cmp-match dismiss sequences and hide rules; heuristic overlays (no known
  sequence) get hide-only, and the result reports per overlay which strategy
  was applied so the agent can finish by hand.
- Test runner: `node:test`, matching the existing `*.test.mjs` files; no new
  dev dependency.

## Risks

- `ext launch` today launches Chrome directly with `--load-extension`. Through
  playwright-cli this means `open --headed --persistent` with
  `launchOptions.args`; extensions do not load in classic headless. If
  playwright-cli cannot do it, the raw Chrome launcher from cdp-ext-pilot
  survives inside the driver as the one documented exception, still behind the
  same `open()` interface. Spike this first; it is the only place the
  single-backend decision could crack.
- playwright-cli is 0.1.x and changes fast. The driver plus the version floor
  are the containment; the smoke test is the alarm.

## Open questions

- `@adobe` npm scope publish rights (does not block building; blocks `npx`).
- Bin name `web` is generic and may collide on PATH. Acceptable while the plugin
  invokes it by path; revisit before publishing (`adobe-web`?).
