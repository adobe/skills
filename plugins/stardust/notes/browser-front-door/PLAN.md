# Browser front door, stage 1 (the move): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stardust script gets its browser, its contexts, its pages and its navigation from one module, with
no change in behaviour.

**Architecture:** A new module `skills/stardust/scripts/browser.mjs` is the only code that loads Playwright and
starts a browser. `live-session.mjs` moves beside it, and the front door re-exports it. Scripts swap their own
launch, context and navigation calls for front-door calls, one skill per task. A lint keeps it that way.

**Tech stack:** Node 22+, ESM `.mjs`, Playwright (a project devDependency, never imported at module load), the
plugin's own test files (`node <file>.test.mjs`) and lints. No new dependency.

**Spec:** `plugins/stardust/notes/browser-front-door/README.md`. This plan covers § 4 stage 1 only. Stage 2 (the
remote switch) gets its own plan.

**Status:** executed. Three instructions below were wrong and the code does not follow them. See "Deviations during
execution" at the end.

## Global constraints

- No behaviour change. Each script keeps its launch mode, launch options, context options and navigation options.
  The tables in each task are the contract.
- Request handlers keep `route.continue()`. Stage 2 changes that.
- A script must run in both layouts: the plugin tree (`skills/<skill>/scripts/`) and the project copy
  (`stardust/scripts/<skill>/`).
- Every CLI script answers `--help` before any other work. It has one `scripts-index.md` row. It has a test file
  whose pure part needs no browser.
- `skills/stardust/reference/scripts-index.md` stays under 12,288 bytes. It has 12,281 today.
- No site names. Harness-neutral text. Docs name only paths that exist.
- `npm run lint:stardust` (from the repo root) passes after every task.
- Skill prose: when a task adds text to `skills/**/*.md`, it removes at least as much elsewhere.
- Commits: conventional commits, imperative, subject of 72 characters or fewer, one commit per task.
- Paths in this plan are relative to `plugins/stardust/` unless they start with `$SCRATCH`.

## Review focus

Failure modes that the spec implies. Each has a test in the task named.

1. A script that used bundled Chromium gets real Chrome after the move, and gate numbers shift. Task 2 tests that
   `plain` passes its options through unchanged. Task 16 compares the `tier` in smoke outputs.
2. A skill's scripts are in the project but the master skill's are not. The script must stop with the copy
   instruction, not with a stack trace. Task 2.
3. A script runs from the plugin tree and Playwright is only in the project at the working directory. Task 2.
4. Playwright is installed nowhere. One error must carry the install line. Task 2.
5. Real Chrome is not installed. Mode `chrome` must fall back to bundled Chromium and tag it `chromium-fallback`.
   Task 2.

## The front door (decided here, used by every task)

```js
// skills/stardust/scripts/browser.mjs
export * from './live-session.mjs';
export async function loadPlaywright();                        // → the playwright module ({ chromium, … }), cached
export async function openBrowser({ mode = 'chrome', launchOptions = {}, tier, playwright } = {});  // → Browser
export function newContext(browser, options = {});             // → browser.newContext(options)
export function newPage(browser, options = {});                // → browser.newPage(options)
export function goto(page, url, options = {});                 // → page.goto(url, options)
```

- `openBrowser` modes: `chrome` → `launchLiveBrowser(chromium)`. `headed` → `launchStealthHeaded(chromium)`.
  `plain` → `chromium.launch(launchOptions)`, tagged `browser.stardustTier = tier || 'chromium'`.
- `launchOptions` and `tier` with a mode other than `plain` throw. An unknown mode throws.
- `playwright` is for tests: a stub module. The default is `await loadPlaywright()`.
- `loadPlaywright` tries `import('playwright')`, then the `package.json` at the working directory through
  `createRequire`. It returns `mod.chromium ? mod : mod.default`. On failure it throws an `Error` with
  `code: 'PLAYWRIGHT_MISSING'` and this message:
  `playwright is not importable from <dir of browser.mjs> or from <cwd>. From the project root run: npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps`

How a script finds the front door (one snippet, in every script or in its skill's `lib.mjs`):

```js
const BROWSER = ['../../stardust/scripts/browser.mjs', '../stardust/browser.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
```

If `BROWSER` is undefined, the script stops the way it stops today for a missing `live-session.mjs` (same exit
code, same mechanism) with this message:
`<script name>: browser.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill's scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).`

How a call changes (the same rule in every skill task):

| Today | After |
|---|---|
| `import('playwright')` or `from 'playwright'`, own loader functions | `await loadPlaywright()` at the same place, same `try`/`catch` and exit code. The message is the loader's. |
| `launchLiveBrowser(chromium)` | `openBrowser({ mode: 'chrome' })` |
| `launchStealthHeaded(chromium)` | `openBrowser({ mode: 'headed' })` |
| `chromium.launch()` | `openBrowser({ mode: 'plain' })` |
| `chromium.launch(X)` | `openBrowser({ mode: 'plain', launchOptions: X })` |
| `browser.newContext(X)` | `newContext(browser, X)` |
| `browser.newPage(X)` | `newPage(browser, X)` |
| `page.goto(url, X)` | `goto(page, url, X)` |
| `newLiveContext`, `gotoLive`, `dismissOverlays` and the other `live-session` names | the same names, from the front door |

## The check after every task

```bash
npm run lint:stardust                                                  # repo root, exit 0
node plugins/stardust/evals/lint/browser-front-door.mjs <skill>        # from task 4 on: 0 findings for the skill
"$SCRATCH/run-tests.sh" plugins/stardust "$SCRATCH/project" "$SCRATCH/after.txt" <skill…>
diff <(grep -E " (<skill>|<skill>)/" "$SCRATCH/baseline-tests.txt") "$SCRATCH/after.txt"
```

`<skill…>` names the skills whose files the task changed. The full run takes about 11 minutes, so only tasks 1 and 16
run it. The `diff` must show only the lines that the task names under "Expected test differences". If
another line differs, run that test again on both sides before you call it a regression.

---

### Task 1: Branch, scratch project and baseline

**Files:**
- Commit: `notes/browser-front-door/README.md`, `notes/browser-front-door/PLAN.md`
- Create (not committed): `$SCRATCH/run-tests.sh`, `$SCRATCH/smoke.sh`, `$SCRATCH/fixture/`, `$SCRATCH/project/`

**Interfaces:**
- Produces: `$SCRATCH/baseline-tests.txt`, `$SCRATCH/baseline-smoke/`, `$SCRATCH/smoke-gaps.txt`. Every later task
  reads them.

- [ ] **Step 1: Create the worktree and commit the two notes**

Use superpowers:using-git-worktrees. Branch name: `stardust-browser-front-door`, from `origin/main`. Move the two
untracked notes into the worktree.

```bash
git add plugins/stardust/notes/browser-front-door/
git commit -m "docs(stardust): design and plan for the browser front door"
```

- [ ] **Step 2: Create the scratch project**

```bash
export SCRATCH="${TMPDIR:-/tmp}/stardust-front-door"
mkdir -p "$SCRATCH/project" && cd "$SCRATCH/project"
printf '{ "name": "front-door-scratch", "private": true, "type": "module" }\n' > package.json
npm i --save-exact --ignore-scripts --no-audit --no-fund playwright@1.65.0 pngjs@7.0.0 pixelmatch@8.0.0
npx playwright install chromium
```

Expected: `node -e "import('playwright').then(()=>console.log('ok'))"` prints `ok`. Real Chrome must be installed.

- [ ] **Step 3: Write `$SCRATCH/run-tests.sh`**

```bash
#!/usr/bin/env bash
# usage: run-tests.sh <plugin-dir> <project-dir> <out-file> [skill…]   (run from the repo root)
set -euo pipefail
PLUGIN=$(cd "$1" && pwd); PROJ=$2; OUT=$3; shift 3
ONLY=" $* "
want() { [ "$ONLY" = "  " ] || [[ "$ONLY" == *" $1 "* ]]; }
rm -rf "$PROJ/stardust/scripts"
for d in "$PLUGIN"/skills/*/scripts; do
  s=$(basename "$(dirname "$d")"); mkdir -p "$PROJ/stardust/scripts/$s"; cp -R "$d/." "$PROJ/stardust/scripts/$s/"
done
: > "$OUT"
run() { # layout label, cwd, test file
  local rc=0 log; log=$(mktemp)
  (cd "$2" && node "$3") > "$log" 2>&1 || rc=$?
  printf '%s %s rc=%s %s\n' "$1" "$4" "$rc" "$(grep -v '^[[:space:]]*$' "$log" | tail -1)" >> "$OUT"
  rm -f "$log"
}
for t in "$PLUGIN"/skills/*/scripts/test/*.test.mjs; do
  l=${t#"$PLUGIN/skills/"}; if want "${l%%/*}"; then run plugin "$PWD" "$t" "$l"; fi
done
for t in "$PROJ"/stardust/scripts/*/test/*.test.mjs; do
  l=${t#"$PROJ/stardust/scripts/"}; if want "${l%%/*}"; then run project "$PROJ" "$t" "$l"; fi
done
sort -o "$OUT" "$OUT"
```

- [ ] **Step 4: Record the test baseline**

Run: `"$SCRATCH/run-tests.sh" plugins/stardust "$SCRATCH/project" "$SCRATCH/baseline-tests.txt"`
Expected: 156 lines (78 test files, two layouts). On `main` at `5bf22347`, 12 lines have `rc=1`: one in the plugin
layout (`qa/scripts/test/dropdown-unreachable.test.mjs` needs Playwright) and 11 in the project layout. Several
test files resolve sibling files in the plugin-tree layout only. These lines stay in the baseline as they are.

- [ ] **Step 5: Write the fixture and `$SCRATCH/smoke.sh`, then record the smoke baseline**

Fixture: `$SCRATCH/fixture/src/index.html`, `src/about.html` and `build/index.html`. Static pages with a header
that holds nav links, a `<main>` with an `h1`, two sections and one inline SVG image, and a footer. `build/index.html` equals
`src/index.html` except for one paragraph. Serve with `python3 -m http.server 8811 --directory "$SCRATCH/fixture"`.

`smoke.sh <out-dir>` runs from `$SCRATCH/project`, on the project copy that `run-tests.sh` made. It writes one
`<name>.out` (stdout and stderr), one `<name>.rc` and the script's output files per command. These must run:

| Name | Command (URLs: `S`=`http://localhost:8811/src/index.html`, `B`=`…/build/index.html`) |
|---|---|
| gate | `stardust/scripts/replica/gate.sh home $S $B 1440 smoke --full --main main` |
| anchor | `node stardust/scripts/replica/anchor.mjs $S --width 1440` |
| measure | `node stardust/scripts/replica/measure.mjs $S --against $B --selectors "h1,header,footer"` |
| cap-probe | `node stardust/scripts/replica/cap-probe.mjs $S` |
| motion | `node stardust/scripts/replica/motion-observe.mjs $S <out>/motion.json --hover "nav a"` |
| diff-report | `node stardust/scripts/replica/diff-report.mjs stardust/replica/gates/home-1440 $B` |
| explore | `node stardust/scripts/diff/chrome-explore.mjs $S <out>/explore.json --width 1440` |
| crawl | `node stardust/scripts/extract/crawl.mjs --url $S --max 3 --out <out>/crawl` |
| census | `node stardust/scripts/extract/style-census.mjs --urls $S --width 1440` |
| fingerprint | `node stardust/scripts/deploy/style-fingerprint.mjs file://$SCRATCH/fixture/src/index.html` |
| schema | `node stardust/scripts/deploy/section-schema.mjs $S --out <out>/schema.json` |
| detect | `node stardust/scripts/dynamics/dynamics-detect.mjs --urls $S` |
| forms | `node stardust/scripts/dynamics/snapshot-forms.mjs --urls $S --out <out>/forms` |
| nav-ok, nav-broken | `node stardust/scripts/fixtures/mobile-nav-audit.mjs` on its two example files |
| file-audit | `node stardust/scripts/fixtures/file-protocol-audit.mjs "$SCRATCH/fixture/src/"` |

The last two rows run copies. `smoke.sh` first copies `skills/prototype/fixtures/` and `skills/migrate/fixtures/`
into `stardust/scripts/fixtures/`. There the scripts find Playwright on `main` and the front door after the move.

These other scripts start a browser too:

- replica: `sibling-variance`
- reskin: all four scripts
- deploy: `block-roundtrip`, `render-harness`, `qa-gate`, `ew-editability-probe`, `ai-readability`
- qa: the checks, through `qa.mjs`
- dynamics: `dynamics-check`, `snapshot-api`
- spec: `spec-capture`, `spec-fetch`, `spec-inventory`, `spec-sheet`

For each one, read its `--help` and build the smallest call on the fixture. If the fixture cannot give an input
the script needs, write one line to `$SCRATCH/smoke-gaps.txt`: `<script>: <missing input>`. Every script is in
`smoke.sh` or in `smoke-gaps.txt`.

`smoke.sh` ends with a normalise pass over the text and JSON files in `<out-dir>`:

- Replace ISO timestamps with `<time>`.
- Replace the scratch path with `<scratch>`.
- Replace the value of every JSON key that matches `/(At|Ms|ms|duration|elapsed|seconds)$/` with `0`.

Run `"$SCRATCH/smoke.sh" "$SCRATCH/baseline-smoke"` twice, into two folders. If the two runs on `main` differ in
a text or JSON file, add that field to the normalise pass. Repeat until `diff -r` of the two runs is empty.

- [ ] **Step 6: No commit.** The scratch files are not part of the repo.

---

### Task 2: The front door, with `live-session.mjs` beside it

**Files:**
- Create: `skills/stardust/scripts/browser.mjs`, `skills/stardust/scripts/test/browser.test.mjs`
- Move: `skills/diff/scripts/live-session.mjs` → `skills/stardust/scripts/live-session.mjs`
- Move: `skills/diff/scripts/test/live-session.test.mjs` → `skills/stardust/scripts/test/live-session.test.mjs`
- Modify (candidates and message only): the importers listed in step 5
- Modify: `evals/lint/script-help.mjs` (the `EXEMPT` list), `skills/stardust/reference/scripts-index.md`

**Interfaces:**
- Produces: the front door API and the finder snippet above.

- [ ] **Step 1: Write the failing test `skills/stardust/scripts/test/browser.test.mjs`**

Use the `check` helper and the summary line of `skills/stardust/scripts/test/ledger.test.mjs`. Checks:

```js
// stub: const calls = []; const chromium = { launch: async (o) => { calls.push(o); return {}; } };
'exports': loadPlaywright, openBrowser, newContext, newPage, goto are functions;
           browser.gotoLive === session.gotoLive, same for newLiveContext, dismissOverlays, defaultWaitUntil,
           isLiveHttpUrl, browserTier, attachOriginAuth   // session = import('../live-session.mjs')
'openBrowser chrome': calls deepEqual [{ headless: true, channel: 'chrome' }]; browserTier(b) === 'chrome'
'openBrowser chrome, Chrome missing': launch throws when o.channel → calls[1] deepEqual { headless: true };
           browserTier(b) === 'chromium-fallback'
'openBrowser headed' (STARDUST_STEALTH and STARDUST_HEADED_WINDOW unset): calls[0] deepEqual { headless: true,
           channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'],
           ignoreDefaultArgs: ['--enable-automation'] }
'openBrowser plain': no options → calls deepEqual [{}], tier 'chromium';
           launchOptions { headless: true, args: ['--x'] } → calls[0] deepEqual that object (no channel added);
           tier: 'chrome-escalated' → browserTier(b) === 'chrome-escalated'
'openBrowser refuses': mode 'nope' rejects /mode/; mode 'chrome' with launchOptions { args: [] } rejects /plain/;
           mode 'headed' with tier 'x' rejects /plain/
'newContext, newPage, goto': each calls the stub's method once with the same arguments and returns its result
'loadPlaywright, project at cwd': copy browser.mjs and live-session.mjs alone to a temp dir; cwd = a temp project
           with package.json and node_modules/playwright/index.js `export const chromium = { fake: 1 }`;
           a child `node -e` prints (await loadPlaywright()).chromium.fake → '1'
'loadPlaywright, nowhere': same copy, cwd = an empty temp dir → the child rejects; the message includes
           'npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps'; error.code === 'PLAYWRIGHT_MISSING'
```

- [ ] **Step 2: Run it**

Run: `node plugins/stardust/skills/stardust/scripts/test/browser.test.mjs`
Expected: fails, `Cannot find module … browser.mjs`.

- [ ] **Step 3: Move `live-session.mjs` and its test with `git mv`**

The test's import `../live-session.mjs` still resolves. Change the path in the header comment of both files.

- [ ] **Step 4: Write `skills/stardust/scripts/browser.mjs`**

The API above. A header comment says what the file is for in three lines. No CLI.

- [ ] **Step 5: Point every importer at the front door**

Change only the candidate paths, the file name and the "not found" message. The script still calls
`launchLiveBrowser(chromium)` and the other names. They arrive through `export *`. Drop the third candidate
`./live-session.mjs` where it exists.

- Candidate arrays: `replica/scripts/{anchor,cap-probe,chrome-parity,measure,motion-observe,sibling-variance,stitch-shot}.mjs`,
  `reskin/scripts/{capture-content,dom-equality,donor-probe,slot-coverage}.mjs`,
  `extract/scripts/{crawl,style-census}.mjs`, `dynamics/scripts/lib.mjs`
- `spec/scripts/lib.mjs`: `loadLiveSession` returns `loadSibling('stardust', 'browser.mjs')`
- Static imports `from './live-session.mjs'` in `diff/scripts/{content-diff,visual-diff,measure-live}.mjs`: replace
  with the finder snippet and `const { … } = await import(BROWSER.href)`. `measure-live.mjs` keeps
  `export const browserTier`.
- Tests that name the old path: `replica/scripts/test/{stitch-shot,measure}.test.mjs`,
  `extract/scripts/test/{crawl,style-census}.test.mjs`, `diff/scripts/test/content-diff.test.mjs`,
  `spec/scripts/test/spec-fetch.test.mjs`. Each resolves `browser.mjs` in both layouts.
- `extract/scripts/test/crawl.test.mjs` has a check that puts a fake `live-session.mjs` beside a copy of the
  crawler. Change it to the project-copy layout: the fake goes to `../stardust/browser.mjs`.

- [ ] **Step 6: Add the missing-front-door check to `replica/scripts/test/stitch-shot.test.mjs`**

```js
'a copy without the master scripts stops with the copy instruction': copy stitch-shot.mjs alone to a temp dir;
  `node stitch-shot.mjs --help` → status 1; stderr includes 'browser.mjs not found' and 'stardust/scripts/stardust/'
```

- [ ] **Step 7: Update the two lists**

- `evals/lint/script-help.mjs` `EXEMPT`: remove `diff/scripts/live-session.mjs`. Add
  `'stardust/scripts/live-session.mjs': 'library: the live-site rules behind browser.mjs; no CLI'` and
  `'stardust/scripts/browser.mjs': 'library: the one entry to the browser for every script; no CLI'`.
- `scripts-index.md`: remove the `diff/live-session.mjs` row. Add the two rows below. Shorten other rows until the
  file is under 12,288 bytes. Never drop a script.

```text
- `stardust/browser.mjs` — library (the one browser entry: load, open, context, navigate), no CLI
- `stardust/live-session.mjs` — library (live-site rules behind browser.mjs), no CLI
```

- [ ] **Step 8: Run the checks**

Run: `node plugins/stardust/skills/stardust/scripts/test/browser.test.mjs` → all checks pass.
Run the check after every task, for the skills `stardust diff replica extract dynamics spec`. Expected test
differences, in both layouts: the `live-session.test.mjs` lines move from `diff` to `stardust`, the
`browser.test.mjs` lines arrive, and the `stitch-shot.test.mjs` count rises by one. Step 5 also makes four test files
resolve their paths in the project layout: `crawl.test.mjs`, `spec-fetch.test.mjs`, `measure.test.mjs` and
`style-census.test.mjs`. Their project lines can go from `rc=1` to `rc=0`, or to fewer failing checks.

- [ ] **Step 9: Commit**

```bash
git commit -am "refactor(stardust): add the browser front door beside live-session"
```

---

### Task 3: The lint

**Files:**
- Create: `evals/lint/browser-front-door.mjs`

**Interfaces:**
- Produces: `node plugins/stardust/evals/lint/browser-front-door.mjs [skill…]`. Exit 0 without findings, 1 with
  findings. One line per finding: `<path>:<line>: <rule> — <trimmed source line>`. Last line:
  `browser-front-door lint: <n> files, <m> findings`.

- [ ] **Step 1: Write the lint**

Follow the shape of `evals/lint/script-paths.mjs`: a header comment with the why, the rules and the usage.

- Files: every `.mjs`, `.js` and `.sh` under `skills/`, any depth. Skip `test/` folders,
  `skills/stardust/scripts/browser.mjs` and `skills/stardust/scripts/live-session.mjs`. With skill names as
  arguments, check only those skills.
- Skip lines that start with `//`, `*` or `#` after trimming, and lines that contain `browser-front-door: ignore`.
- Rules, as regular expressions on each remaining line:

| Rule | Pattern |
|---|---|
| `imports-playwright` | `from 'playwright'`, `import('playwright')` or `resolve('playwright')`, either quote |
| `starts-a-browser` | `\.launch\(`, `launchPersistentContext\(`, `connectOverCDP\(`, `launchLiveBrowser\(`, `launchStealthHeaded\(` |
| `opens-on-the-browser` | `\.newContext\(` or `\b(browser|b)\.newPage\(` |
| `navigates-itself` | `\.goto\(` or `routeFromHAR\(` |

- [ ] **Step 2: Run it and keep the list**

Run: `node plugins/stardust/evals/lint/browser-front-door.mjs > "$SCRATCH/lint-todo.txt"; echo $?`
Expected: exit 1. The list names files in `deploy`, `diff`, `dynamics`, `extract`, `migrate`, `prototype`, `qa`,
`replica`, `reskin` and `spec`. It names `skills/replica/scripts/anchor.mjs:59` (`imports-playwright`). It names
no file in `skills/stardust/`.

- [ ] **Step 3: Commit**

```bash
git add plugins/stardust/evals/lint/browser-front-door.mjs
git commit -m "test(stardust): lint that scripts take their browser from the front door"
```

The lint joins `npm run lint:stardust` in task 15, when the tree passes it.

---

### Tasks 4 to 13: one skill each

Every skill task has the same steps:

- [ ] **Step 1:** Run `node plugins/stardust/evals/lint/browser-front-door.mjs <skill>`. The findings are the work list.
- [ ] **Step 2:** Apply the call-change table from "The front door" to each file. Take the launch mode from the
  task's table. Remove the script's own Playwright import, loader and `chromium` variable.
- [ ] **Step 3:** Update the test files that the change breaks. A test that stubbed `chromium` or
  `launchLiveBrowser` stubs `openBrowser` in its place.
- [ ] **Step 4:** Run the lint for the skill (0 findings) and the check after every task.
- [ ] **Step 5:** Commit: `refactor(stardust): <skill> scripts take their browser from the front door`.

**Interfaces (all skill tasks):** Consumes the front door API. Produces nothing new, except where a task says so.

### Task 4: diff

| File | Launch today | After |
|---|---|---|
| `measure-live.mjs` | `openBrowser(chromium, { tier })` | Delete its `openBrowser`. `openPage` and `visit` stay. |
| `clip-probe.mjs`, `content-presence.mjs`, `unit-geometry.mjs`, `chrome-explore.mjs` | `openBrowser(chromium, { tier: opts.plain ? 'plain' : 'stealth' })` | `openBrowser({ mode: opts.plain ? 'plain' : 'headed' })` from the front door |
| `content-diff.mjs`, `visual-diff.mjs` | `opts.headed ? launchStealthHeaded : launchLiveBrowser` | `openBrowser({ mode: opts.headed ? 'headed' : 'chrome' })` |

`chrome-explore.mjs` also loses its own `loadPlaywright`. Its reload `page.goto(at, { waitUntil: 'load', timeout: 60000 })`
becomes `goto(page, at, …)`.

### Task 5: replica

| File | Launch today | After |
|---|---|---|
| `stitch-shot.mjs`, `chrome-parity.mjs`, `motion-observe.mjs` | `opts.headed ? launchStealthHeaded : launchDefault` | `mode: opts.headed ? 'headed' : 'chrome'` |
| `anchor.mjs`, `sibling-variance.mjs` | `opts.headed ? launchStealthHeaded : chromium.launch()` | `mode: opts.headed ? 'headed' : 'plain'` |
| `measure.mjs`, `cap-probe.mjs` | `o.headed ? launchStealthHeaded : chromium.launch({ headless: true })` | `o.headed ? { mode: 'headed' } : { mode: 'plain', launchOptions: { headless: true } }` |
| `diff-report.mjs` | `chromium.launch()` | `mode: 'plain'` |

Remove the code that ran for a `live-session.mjs` copy older than the script:

- the `launchDefault` guards
- in `stitch-shot.mjs`, the "predates pageDenial" branch of `recheckDenial`, with its test check

Expected test differences: the `replica/test/stitch-shot.test.mjs` count falls by one.

### Task 6: reskin

`capture-content.mjs`, `dom-equality.mjs`, `donor-probe.mjs`, `slot-coverage.mjs`: all four launch with
`headed ? launchStealthHeaded : chromium.launch()`. After: `mode: headed ? 'headed' : 'plain'`. Their
`page.goto(…, { waitUntil: 'networkidle', timeout: 60000 })` calls on local targets become `goto(page, …)`.
The skill has no test files. The smoke lines for these four scripts are the check.

### Task 7: extract

| File | Launch today | After |
|---|---|---|
| `style-census.mjs` | `o.headed` → `launchStealthHeaded`, else `launchLiveBrowser`, else `chromium.launch({ headless: true })` | `mode: o.headed ? 'headed' : 'chrome'`. The third branch is dead. |
| `crawl.mjs` `launchWithFallback` | `launchLiveBrowser`, with an inline copy when the module is absent | `openBrowser({ mode: 'chrome' })`. `technique` is `browserTier(browser)`. |
| `crawl.mjs` `launchEscalated` | `chromium.launch(opts)`, tagged `chrome-escalated`, `null` on failure | `openBrowser({ mode: 'plain', launchOptions: opts, tier: 'chrome-escalated' })` in the same `try`/`catch` |

In `crawl.mjs`:

- `liveSession()` resolves the front door with the finder snippet. If the front door is missing, the crawler
  stops with exit 1 and the message above.
- The three `page.goto` calls inside `sharedNavigate` and `navigateLive` become `goto(page, …)`.
- The fallback `newLiveContext: (browser, options) => browser.newContext(options)` calls `newContext(browser, options)`.
- Leave the other fallbacks for an absent module in place. Task 14 removes them.

### Task 8: deploy

All seven scripts launch with `chromium.launch()`: `mode: 'plain'`. Files: `ai-readability.mjs`,
`block-roundtrip.mjs`, `ew-editability-probe.mjs`, `qa-gate.mjs`, `render-harness.mjs`, `section-schema.mjs`,
`style-fingerprint.mjs`.

- `ai-readability.mjs` and `ew-editability-probe.mjs` lose their own `loadPlaywright`.
- `ai-readability.mjs` loses its own site-auth handler (lines 129 to 138 today). It calls the front door's
  `attachOriginAuth(context, origin, headerValue)`.
- `ew-editability-probe.mjs` keeps its `route.continue()`. If the lint flags a line that is not a browser call,
  add `// browser-front-door: ignore` with the reason on that line.

### Task 9: qa

- `lib.mjs`: resolve the front door once with the finder snippet. Export `loadPlaywright`, `openBrowser`,
  `newContext`, `newPage` and `goto` from it. Delete its own `loadPlaywright`. Its `attachOriginAuth(context)`
  keeps its signature and calls the front door's `attachOriginAuth(context, ORIGIN_AUTH.origin, ORIGIN_AUTH.value)`.
- `checks/{browse,perf,editability,ai-readability,links}.mjs`: `chromium.launch()` becomes
  `openBrowser({ mode: 'plain' })`. All import from `../lib.mjs`.

### Task 10: dynamics

- `lib.mjs`: resolve the front door once. Re-export `loadPlaywright` and `attachOriginAuth` from it, and delete its
  own copies. `settlePage` calls the front door's `acceptConsent`. Remove `sharedAcceptConsent` and the
  `CONSENT_ACCEPT` fallback branch. If no other file imports `CONSENT_ACCEPT`, remove the export too.

| File | Launch today | After (`mode: 'plain'`, `launchOptions`) |
|---|---|---|
| `dynamics-check.mjs` | `chromium.launch({ headless: !headed })` | `{ headless: !headed }` |
| `dynamics-detect.mjs` | `chromium.launch({ headless: !flag('headed'), args: [AC] })` | the same object |
| `snapshot-api.mjs`, `snapshot-forms.mjs` | `chromium.launch({ headless: true, args: [AC] })` | the same object |

`AC` is `'--disable-blink-features=AutomationControlled'`.

### Task 11: spec

- `lib.mjs`: `loadLiveSession` becomes `loadBrowser = () => loadSibling('stardust', 'browser.mjs')`. Its own
  `loadPlaywright` goes. Callers take `openBrowser`, `newContext`, `newPage` and `goto` from `await loadBrowser()`.

| File | Launch today | After |
|---|---|---|
| `spec-capture.mjs` | `headed ? launchStealthHeaded : chromium.launch({ args: ['--disable-dev-shm-usage'] })` | `headed ? { mode: 'headed' } : { mode: 'plain', launchOptions: { args: ['--disable-dev-shm-usage'] } }` |
| `spec-fetch.mjs`, `spec-inventory.mjs` | `launchStealthHeaded` (only with `--headed`) | `mode: 'headed'` |
| `spec-sheet.mjs` | `chromium.launch()` | `mode: 'plain'` |

### Task 12: fixtures

`prototype/fixtures/mobile-nav-audit.mjs` and `migrate/fixtures/file-protocol-audit.mjs`: `chromium.launch()`
becomes `mode: 'plain'`. Each keeps its exit code for a missing Playwright. Replace the two install lines in each
header comment and error text with the loader's message. Lint arguments: `prototype migrate`.

### Task 13: sweep

- [ ] **Step 1:** Run `node plugins/stardust/evals/lint/browser-front-door.mjs`. Expected: 0 findings, exit 0.
- [ ] **Step 2:** Run `rg -n "chromium" plugins/stardust/skills --glob '*.mjs' --glob '!**/test/**' --glob '!**/stardust/scripts/*'`.
  Each remaining hit is a comment, a help text or a tier name. Remove unused `chromium` variables and parameters.
- [ ] **Step 3:** Commit what step 2 changed: `refactor(stardust): drop unused chromium bindings`. Without a
  change, skip this step.

---

### Task 14: `crawl.mjs` without the branches for an absent module

**Files:**
- Modify: `skills/extract/scripts/crawl.mjs`, `skills/extract/scripts/test/crawl.test.mjs`

The front door always brings `live-session.mjs`. The branches for a crawler without it cannot run.

- [ ] **Step 1:** In `crawl.test.mjs`, delete the checks that run the crawler bindings without a shared module.
  Keep the checks that a hook which throws is reported once per host and does not stop the crawl.
- [ ] **Step 2:** In `crawl.mjs`, remove `LIVE_SESSION_FALLBACKS` and every `|| LIVE_SESSION_FALLBACKS.<name>`.
  Remove each `typeof <module>.<name> === 'function'` guard on a front-door export, with its `else` branch. Keep
  the error-tolerant wrappers in `crawlerLiveBindings`. Update the header comment lines that describe a crawl
  without the module.
- [ ] **Step 3:** Run `node plugins/stardust/skills/extract/scripts/test/crawl.test.mjs` → all checks pass. Run the
  check after every task. Expected test differences: the `extract/test/crawl.test.mjs` count falls.
- [ ] **Step 4:** Run the `crawl` smoke line and compare with the baseline: `diff -r` is empty.
- [ ] **Step 5:** Commit: `refactor(stardust): crawl drops the branches for an absent live-session`.

A reviewer can drop this task without effect on the others.

---

### Task 15: Lint in CI, docs and release

**Files:**
- Modify: `package.json` (repo root), `.github/workflows/validate.yml`
- Modify: `skills/stardust/SKILL.md`, the docs listed below, `README.md`, `CHANGELOG.md`,
  `.claude-plugin/plugin.json`, the root `.claude-plugin/marketplace.json`

- [ ] **Step 1: The lint joins the others**

Append `&& node plugins/stardust/evals/lint/browser-front-door.mjs` to `lint:stardust` in the root `package.json`.
Add a step to the `stardust-harness-neutral` job in `validate.yml`, after the scripts-index step:
`Stardust scripts take their browser from the front door`.

- [ ] **Step 2: The master Setup owns the copy**

In `skills/stardust/SKILL.md` § Setup, add one step: copy this skill's `scripts/` dir to
`stardust/scripts/stardust/` before any other skill's script runs. It holds `ledger.mjs`, `state.mjs` and
`browser.mjs`, the one entry to the browser for every script.

In the same file, § validate-and-fix loop, step 1: a probe the agent writes opens its pages through
`stardust/scripts/stardust/browser.mjs`. Give this example and nothing more:

```js
const { openBrowser, newPage, goto } = await import('./stardust/scripts/stardust/browser.mjs');
const browser = await openBrowser({ mode: 'plain' });
const page = await newPage(browser, { viewport: { width: 1440, height: 900 } });
await goto(page, url, { waitUntil: 'networkidle' });
```

- [ ] **Step 3: Every other doc points there**

Rule: a mention of where `live-session.mjs` lives becomes `stardust/scripts/browser.mjs`, or goes. A sentence that
tells the agent to copy the diff scripts because `live-session.mjs` is there goes. What the shared rules do stays.
Line numbers are those on `main` at the branch point.

- `skills/replica/SKILL.md`: Setup step 4 (the master scripts and the reason for the diff copy), lines 332 and 351
- `skills/replica/reference/source-fidelity-gate.md`: lines 535, 680 and 714
- `skills/replica/reference/handoff-contract.md`: lines 100 and 143 (the master copy becomes a pointer)
- `skills/replica/reference/recreation-procedure.md`: line 595
- `skills/extract/SKILL.md`: Setup "Script location matters", lines 391 and 398
- `skills/diff/SKILL.md`: lines 45, 72 and 80
- `skills/reskin/SKILL.md`: Setup step 3. `skills/reskin/reference/gates.md`: lines 60, 69 and 97.
  `skills/reskin/reference/content-model.md`: line 339
- `skills/spec/SKILL.md`: lines 28 and 66. `skills/deploy/SKILL.md`: line 816
- `skills/extract/reference/playwright-recipe.md` § Bot-management fallback: the hand-written launch flags and the
  webdriver spoof become one pointer to `openBrowser({ mode: 'headed' })`. The browser settings and the capture
  list stay.

- [ ] **Step 4: `playwright-cli` is not a requirement**

Remove `, playwright-cli on PATH` from the `compatibility:` line of the 15 `SKILL.md` files that have it. In
`README.md` § Prerequisites, remove the sentence about `playwright-cli`.

- [ ] **Step 5: Release**

Set version `0.38.0` in `.claude-plugin/plugin.json` and in the stardust entry of the root
`.claude-plugin/marketplace.json`. Add this `CHANGELOG.md` heading:

```text
## 0.38.0 — every script takes its browser from one place
```

The entry says, in this order:

1. what moved: `browser.mjs`, with `live-session.mjs` beside it
2. what a project copy needs now: the master scripts
3. what no longer works: a script copied alone, and the flat `./live-session.mjs` layout
4. that no script changed its browser

- [ ] **Step 6: Check and commit**

Run: `npm run lint:stardust` → exit 0, and the new lint line is in the output.
Run: `node plugins/stardust/evals/lint/prose-delta.mjs --ref origin/main` → the net total of words is zero or
negative. Keep the output for the pull request text.

```bash
git commit -am "feat(stardust): 0.38.0 — every script takes its browser from one place"
```

---

### Task 16: Final check

- [ ] **Step 1: Tests against the baseline**

Run `run-tests.sh` without skill names and `diff` against the whole baseline. The only differences are the ones
named in tasks 2, 5 and 14, plus changed counts in test files that tasks 4 to 12 edited. No line goes from `rc=0`
to `rc=1`.

- [ ] **Step 2: Smoke against the baseline**

Run: `"$SCRATCH/smoke.sh" "$SCRATCH/after-smoke" && diff -r "$SCRATCH/baseline-smoke" "$SCRATCH/after-smoke"`
Expected: no difference in `.rc` files, in text or in JSON. Every `tier` and `technique` value is the same.
For each pair of PNG files, `node stardust/scripts/replica/pixel-compare.mjs <before> <after> --json` reports
`"pct": 0`.

- [ ] **Step 3: Both layouts answer `--help`**

Run: `node plugins/stardust/evals/lint/script-help.mjs` → 0 failed. Fewer scripts are skipped than on `main`,
because no script imports Playwright at load.
Run from `$SCRATCH/project`: `for f in stardust/scripts/*/*.mjs; do node "$f" --help >/dev/null 2>&1 || echo "FAIL $f"; done`
Expected: only the libraries in the `EXEMPT` list of `script-help.mjs` print `FAIL`, or none.

- [ ] **Step 4: Hand over**

Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch. The pull request
text lists `$SCRATCH/smoke-gaps.txt`: the scripts that the smoke run did not exercise.

---

## Deviations during execution

The plan had three defects. Each one broke the rule "no behaviour change". The reviews found them and the code
follows the spec, not the plan text.

1. **The loader order** ("The front door"). The plan says the bare import first. Six callers on `main` tried the
   project at the working directory first. The front door does the same: working directory first, then the bare
   import.
2. **The flat layout** (task 2, step 5). The plan says to drop the third candidate. The docs run the crawler from
   `stardust/scripts/crawl.mjs`. So `crawl.mjs`, `style-census.mjs` and `dynamics/scripts/lib.mjs` keep a third
   candidate: `./stardust/browser.mjs`.
3. **The consent click** (task 10). The plan says to remove the `CONSENT_ACCEPT` fallback in `settlePage`. That
   click also ran when the shared consent pass clicked nothing. It stays, and a test pins it.

Two more changes came from the final review:

- The diff scripts stop with one line and exit 1 when the master scripts are missing. `chrome-explore.mjs` and
  `measure-live.mjs` load the front door only when they need a browser.
- The probe example in the master skill resolves `browser.mjs` from the working directory.

Tasks 4 to 13 ran as three batches, with one review each.
