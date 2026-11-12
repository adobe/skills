# Browser front door: design note

Status: stage 1 (the move) is built, in 0.38.0. Stage 2 (the remote switch) is design only. Dates: 2026-11-09 and
2026-11-10. Three throwaway checks back the remote part. Their results are at the end.

## Why

Every stardust script that drives a browser starts it on its own. Today 43 scripts do this. Four helper files load
Playwright in their own way. To try a different browser, someone must edit about 40 files.

The first such browser is Bright Data's Browser API. It is a remote Chrome that gets past bot managers (Cloudflare,
Akamai) where our own Chrome fails. A replica run on a blocked site needs every source-site page to come through it.
The operator must switch this on once for a whole run.

The goal is one place that owns browser handling for the whole plugin. Bright Data is the first case, not the shape.

## Goals

- One module is the only code that loads Playwright, starts or connects browsers, and navigates pages.
- Every script gets its browsers, contexts and pages from that module. Each script keeps its own measuring logic.
- One switch makes a remote browser fetch the source site for a whole run. Local Chrome still draws every page.
- With the switch off, every script behaves as it does today, and every gate gives the same numbers.

## Non-goals

- A plugin system or a config file for many providers. There is one remote case today. Add the next when it exists.
- Plain HTTP traffic: `curl` by the agent, Node `fetch` in the spec and dynamics stages. It still leaves from the
  local machine.
- The service that runs the agent: its run flag, the secret, the container env. That is a follow-up there.
- Changing which browser a script uses by default. The move keeps each script's current choice (see Known gaps).

## Anti-goals

- A refactor that moves gate numbers. With the switch off, any changed number is a bug.
- A replayed source that looks like a live one. Every output must say that the source was replayed, and from when.
- A credential in a log, an error message or an artifact.

## Constraints

From Bright Data (docs and our own checks, see Sources and the results):

- A session is one CDP connection. A session navigates one domain only (`navigate_domains_limit`).
- A session ends after 60 minutes, or after 5 minutes without activity.
- A first navigation can take up to 2 minutes. Bright Data advises a 120 s navigation timeout.
- The zone we tested accepts a changed user agent and changed request headers. It refuses cookies that the
  client sets (`Overriding <name> cookie is forbidden`). Bright Data documents `custom_headers` for zones that
  refuse header changes.
- Without KYC, pages that robots.txt disallows fail (`brob`).
- Many sessions started at once fail with `bucket_rate_limit`.
- Traffic is billed per GB.
- The remote browser cannot reach `localhost` or `file:` pages.
- The zone we tested is a Browser API zone. It refuses proxy use (`client_10090`).

From the plugin:

- The plugin ships no `node_modules`. Scripts run from project copies under `stardust/scripts/<skill>/`.
- A script must find its sibling-skill imports in both layouts: the plugin tree and the project copy.
- Every CLI script answers `--help` before any I/O. Each has one `scripts-index.md` row and a test file whose pure
  part needs no browser.
- A rule has one home. Other files point to it.
- No site names anywhere in the plugin. The `site-names` lint checks notes too.

## How it works today

- Most scripts import `playwright` themselves. Four helpers have their own project-relative loader: `qa/scripts/lib.mjs`,
  `spec/scripts/lib.mjs`, `dynamics/scripts/lib.mjs` and `diff/scripts/chrome-explore.mjs`.
- `diff/scripts/live-session.mjs` holds the live-site rules. 25 scripts import it. The rules are:
  - browser identity
  - per-host pacing across processes
  - block-page detection
  - consent and pop-up dismissal
  - a cookie store
  - site auth on one origin (`attachOriginAuth`)
- It offers two launch modes: `launchLiveBrowser` (real Chrome, bundled Chromium as fallback) and
  `launchStealthHeaded` (the `--headed` mode). 35 scripts also call `chromium.launch()` directly.
- `newLiveContext(browser, { stateUrl: url, … })` builds a context for one URL. Most gate scripts create one context
  per URL and navigate it once. This is the natural place to choose how a page is served.
- Several instruments open the source and the build in the same browser: `content-diff`, `visual-diff`,
  `chrome-parity`, `measure --against` and `cap-probe --against`.
- 28 script files call `page.goto()` themselves. The others navigate with `gotoLive`.
- Three files carry their own copy of the site-auth request handler: `deploy/scripts/ai-readability.mjs`,
  `dynamics/scripts/lib.mjs` and `qa/scripts/lib.mjs`.
- Four files pass requests on with `route.continue()`: those three and `deploy/scripts/ew-editability-probe.mjs`.
  `live-session.mjs` does it too. A request passed on this way skips every handler behind it.

## Approaches

### Where browser handling lives

**Chosen: one explicit front door.** Scripts ask one module for browsers, pages and navigation. The module decides
how each page is served. A lint keeps it the only place.

Dropped:

- **A hook loaded before every script** (`NODE_OPTIONS=--import …`) that patches `chromium.launch()`. It needs no
  script edits. It also catches probes the agent writes. But a script launches a browser before it names a URL. So
  the hook must move pages between browsers behind the script. That loses the listeners and handlers that the script
  set up before navigation.
- **A background browser service** that scripts connect to. Playwright can share a browser it launched, but not one
  it reached over CDP. It cannot hand out Bright Data sessions. It also adds a process to start, watch and clean up.
- **A proxy in front of local Chrome.** That is the residential-proxy route, a different product. A Browser API zone
  refuses proxy use.

### How the remote browser is used

**Chosen: the remote browser records, local Chrome draws.** The remote browser visits a source page once and
records every response. Every script then draws that page in local Chrome from the recording. A replayed page
differs from the live page by 0 to 0.35 %. That is the same as two live captures of one page.

Dropped:

- **The remote browser draws the source.** It is Chrome on Windows. Its fonts and scrollbars differ from ours. The
  same page then differs by 1.5 to 2.3 % at 1440 px. At 360 px it differs by 2.4 to 9.1 %. The pass bar is 10 %.
  The agent then tunes a prototype to Windows rendering.

## The design

### 1. Home

- The front door is `skills/stardust/scripts/browser.mjs`. The master skill is set up before every other skill, so
  every project has its copy at `stardust/scripts/stardust/browser.mjs`.
- `live-session.mjs` moves from the diff skill to `skills/stardust/scripts/`, beside the front door. Its test file
  moves too. Scripts stop importing it directly. The front door re-exports what scripts need from it.
- `diff/scripts/measure-live.mjs` stays in the diff skill. It is measurement code. It gets its pages from the front
  door.
- The master Setup owns the copy of `skills/stardust/scripts/`. Each skill's copy-set text drops "copy the diff
  scripts because live-session lives there" and points to the master Setup.
- Scripts find the front door in both layouts with the candidate-path pattern they use today. If no candidate
  exists, the script stops and prints the master Setup copy step.
- Three scripts also run from a flat copy in `stardust/scripts/`, as on `main`: `crawl.mjs`, `style-census.mjs` and
  `dynamics/scripts/lib.mjs`.

### 2. What the front door owns

- **Loading Playwright.** One loader: the project at the working directory first (its `package.json` via
  `createRequire`), then `import('playwright')`. On failure it prints the install line from extract § Setup. The
  four helper loaders go away.
- **Opening browsers.** `openBrowser({ mode, launchOptions })` returns the browser. The modes are today's:
  - `chrome`: real Chrome, bundled Chromium as fallback
  - `headed`: today's `--headed`
  - `plain`: a plain launch with the caller's options. Without options it is bundled Chromium. Some scripts add
    their own (`--disable-blink-features=AutomationControlled`, `--disable-dev-shm-usage`, a channel).
- **Contexts and pages for a URL.** The handle opens a context for a given URL. Two setups exist, as today:
  - the live setup: today's `newLiveContext` (identity, document headers, webdriver flag, cookie store, site auth)
  - the plain setup: today's bare `browser.newContext(options)`

  A script keeps the setup it uses today. Scripts that need the context first (init scripts, request handlers) get
  the context. Others get the page directly.
- **Navigation.** Scripts navigate through the front door. Two kinds exist, as today:
  - with the live rules: today's `gotoLive` (pacing, block-page detection)
  - plain: today's `page.goto` with the caller's options

  A script keeps the kind it uses today. `dismissOverlays`, `defaultWaitUntil` and `isLiveHttpUrl` are re-exported
  unchanged.
- **Site auth.** One implementation: today's `attachOriginAuth`. The three copies go away.
- **Request handlers pass on with `route.fallback()`** (stage 2). No handler calls `route.continue()`, in scripts or
  in the front door. A handler behind it, such as replay, then still sees the request.
- **Evidence.** The handle reports the browser that drew each page: `chrome`, `chrome-window`, `chromium-fallback`
  or `chromium`. It also reports how the source was served: `live` or `replay`.
- **Closing.** Closing the browser also closes every remote session that is still open (stage 2).

### 3. The remote switch: record remotely, replay locally

Three environment variables, read once per process. Set them in the environment that starts the agent, so every
command of the run inherits them:

- `STARDUST_REMOTE_BROWSER`: the CDP endpoint (`ws:`, `wss:` or `http:`). Set means on. For Bright Data it is the
  zone's `wss://…:9222` endpoint. Pin a country with `-country-<cc>` in its user name.
- `STARDUST_REMOTE_HOSTS`: optional. A comma list of hosts. A host also matches its subdomains. If it is set, only
  these hosts are remote hosts.
- `STARDUST_REMOTE_STRICT=1`: optional. The front door aborts a request that a recording lacks. By default such a
  request goes to the network.

Which pages are remote pages:

- If the switch is off, no page is.
- If the switch is on and `STARDUST_REMOTE_HOSTS` is set, a page is remote only if its host matches the list.
- If the switch is on without a list, two tests pick the remote pages. A page is remote if it passes both:
  - Its URL is a live `http(s)` URL (`isLiveHttpUrl`).
  - Its host is not an EDS or DA host: `aem.page`, `aem.live`, `hlx.page`, `hlx.live` or `da.live`.
- This default covers the source site, its subdomains and donor sites. Builds, published EDS pages and local pages
  are not remote pages.
- `file:` pages are never remote pages.

Recording:

- A recording is a HAR file of one page: every response that the remote browser received.
- Its key is the URL, the viewport width and the `deviceScaleFactor`. Other context options rarely change what a
  page requests.
- The front door records a remote page when a script first needs it. That is when the script opens a context for
  the URL, or navigates to it. A lock per key makes a second process wait. It does not record the page twice.
- A recording visit uses one remote session (`connectOverCDP`). The front door closes the session after the visit.
  This fits the one-domain rule. The visit follows these rules:
  - The context gets the key's viewport and `deviceScaleFactor`, `serviceWorkers: 'block'` and `recordHar` with
    embedded content.
  - The context gets no identity setup: no user-agent override, no extra headers, no webdriver script, no cookies.
    The remote service manages its own identity, and the zone refuses cookies.
  - The visit hides scrollbars with `Emulation.setScrollbarsHidden`. Remote scrollbars take 15 px of layout width.
  - The visit never resizes a page. One context serves one viewport size.
  - The navigation timeout is at least 120 s.
  - Block-page detection applies. On a block the front door saves no recording and the script exits 3. The message
    says that the remote browser did not clear the block. It does not suggest `--headed`.
  - The visit dismisses overlays and clicks consent. The recording then holds what the page loads after consent.
  - The visit scrolls the whole page slowly. The recording then holds lazy-loaded content.
  - Per-host pacing applies across processes, as for live navigations.
- **Retries.**
  - `bucket_rate_limit`: retry after 5, 15 and 30 s. This follows the web-cli precedent.
  - `no_free_workers`, `browser_disconnected`, `worker_disconnect`, `job_killed` and `page_navigated_error`: retry
    once on a new session.
  - Every other error fails at once.
- **Clear errors.**
  - `navigate_domains_limit`: the source redirected to another domain. The message names that domain.
  - `brob`: robots.txt disallows the page. The service allows it only after the account passes KYC.
  - `brul`: Bright Data's compliance rules block the site.
  - `407`: account or network problem.
- **Cleaning.** The front door drops every 2xx entry without a body. It keeps redirects. Replay never finishes an
  entry without a body, and the page's `load` event then never fires.
- **Storage.** Recordings go to live-session's shared state folder, beside the cookie store. That folder is in the OS
  temp directory, scoped to the repository and the host. A recording holds the cookies the site set, so it stays out
  of the working tree. One recording takes up to 20 MB.
- **Age.** A recording expires after `STARDUST_LIVE_STATE_TTL_MS` (12 hours by default). The front door then records
  the page again.

Replay:

- A context for a remote page is the script's normal local context, with the recording attached (`routeFromHAR`).
  The script keeps its launch mode and its context setup. Local Chrome draws the page.
- The context blocks service workers, so that none can bypass the recording.
- A request that the recording lacks goes to the network. The front door logs it beside the recording. With
  `STARDUST_REMOTE_STRICT=1` the front door aborts it.
- When a script navigates an open context to another remote page, the front door attaches that page's recording
  first. `crawl.mjs` and the spec stages work this way.
- `--headed` and `--ua` apply to the local browser, as today. They do not change a recording visit.
- Site auth applies to local pages only. If a script asks for site auth on a remote page, the front door stops with
  a clear error.
- The replayed source is the page at recording time. Every gate round then compares against the same source.

Evidence and caches:

- An output with a replayed source records `replay`, the recording time and the number of missing requests.
- The gate reuses live-side captures across rounds (`live.png`, the anchor, chrome and measure caches). Each cache
  records how its source was served. If that differs from the current run, the cache is stale and the script
  captures again. A cache without the field counts as `live`.

Credentials:

- The endpoint is read from the environment only.
- Every message the front door prints or throws goes through one redaction step: `scheme://user:pass@` and the
  password itself.
- The first remote use prints one line with the endpoint host and port and the routing rule. It never prints the
  full endpoint.

### 4. Two stages

1. **The move.** All scripts go through the front door. The switch does not exist yet. Each script keeps its launch
   mode, its launch options, its context setup and its kind of navigation. Every `browserTier` value and every gate
   number stays the same. Request handlers still pass on with `route.continue()`.
2. **The switch.** Recording and replay, inside the front door and `live-session.mjs`. Request handlers change to
   `route.fallback()`. With site auth attached, that changes which handlers see a request. Scripts change only where
   they write evidence, read caches and pass requests on.

Each stage is one pull request.

### 5. Guardrail

- A new lint, `evals/lint/browser-front-door.mjs`, joins `npm run lint:stardust`.
- It checks every script under `skills/`, except the front door, `live-session.mjs` and test files.
- It fails if a file imports `playwright`.
- It fails if a file starts a browser itself: `.launch(`, `launchPersistentContext(`, `connectOverCDP(`,
  `launchLiveBrowser(` or `launchStealthHeaded(`.
- It fails if a file opens a context or a page on the browser itself: `.newContext(` or `browser.newPage(`.
- It fails if a file calls a raw `page.goto(` or `routeFromHAR(`.
- Stage 2 adds one rule: a file that calls `route.continue(` fails.

### 6. Probes the agent writes

The lint covers plugin scripts only. The master skill gets one rule, in one place: a script the agent writes gets its
browser from `browser.mjs`. A short example goes with the rule. The existing "never hand-roll an instrument" rules
stay where they are.

The rule lives in the master Setup, in the step that copies the master scripts. Every run reads that step. The
replica and dynamics skills point to it. A first version sat in the validate-and-fix loop, with an example for local
pages. A recorded run showed that it steered nothing: four scripts the agent wrote opened the source with
`chromium.launch()`.

A second run, with the rule in the Setup, had seven scripts that opened the source:

- Four followed the recipe.
- Two took the browser from `browser.mjs` and then called `page.goto` themselves. Such a script sends
  `HeadlessChrome` in the user agent and leaves `navigator.webdriver` true. The first wording said that a script
  "gets its browser" from the front door. The rule now names `newLiveContext` and `gotoLive`.
- One launched its own browser.

One check backs the rule. `ledger.mjs … end` names the scripts written in the phase that import Playwright
themselves. It is a warning, after the script ran. It does not stop the script. It reads the `stardust/` folder
only. In the second run, six of the seven scripts were in `/tmp`.

### 7. Docs and cleanup

- The plugin README gets one short section on the switch. The operator sets it, not the agent, so skill text does
  not describe it.
- `extract/reference/playwright-recipe.md` § Bot-management fallback teaches launch flags and the webdriver spoof by
  hand. That becomes a pointer to the front door. The browser settings and the capture list stay.
- Copy-set lines in the skill Setups point to the master Setup.
- `scripts-index.md`: new row for `stardust/browser.mjs`, moved row for `stardust/live-session.mjs`.
- Remove `playwright-cli` from the 15 `compatibility:` headers and from the README prerequisites. No script uses it.
- Add Bright Data's docs domain and its endpoint domain to the `site-names` allowlist. They belong to the remote
  vendor, not to a site.
- Release: minor bump (the copy set changes). Bump `plugin.json`, the root `marketplace.json` entry and the CHANGELOG
  heading together.

## Testing

- **Unit tests** (pure, no browser):
  - the routing rule and environment parsing
  - the recording key and HAR cleaning
  - redaction
  - the retry and error mapping
- **Remote path without Bright Data.** Start a local Chrome with `--remote-debugging-port`. Point
  `STARDUST_REMOTE_BROWSER` at it. Name a local fixture host in `STARDUST_REMOTE_HOSTS`. This runs the whole remote
  branch end to end:
  - a recording visit and its cleaning
  - replay, with and without `STARDUST_REMOTE_STRICT=1`
  - the lock, with two processes that ask for the same page
  - redaction, with fake credentials in the URL
- **Behaviour kept.** Before and after the move, run `gate.sh --full` with two local fixture pages. Also run
  `crawl.mjs` on a local fixture site, and the deploy and qa checks on a fixture. The outputs must be the same.
- **Every touched script's test file passes**, from a project copy, as `CLAUDE.md` asks.
- **Bright Data smoke run.** One `gate.sh --full` round on a bot-protected source with the switch on. The verdict
  line must report `replay` for the live side.

## Known gaps, for later

- The default browser differs between gate instruments:
  - real Chrome: `stitch-shot`, `chrome-parity`, `motion-observe`, `content-diff`, `visual-diff`, the
    `measure-live` probes, `crawl` and `style-census`
  - bundled Chromium: `anchor`, `measure`, `cap-probe`, `sibling-variance`, the four reskin probes, the dynamics
    scripts and `spec-capture`

  The replica skill says every instrument runs real Chrome (#151). After the move this is a one-line change. Do it in
  its own change, with before and after numbers.
- A request that no recording visit made is a miss. It goes to the network from the local address, where a blocked
  site refuses it. The checks found these kinds:
  - a page that a replayed page navigates to, such as search results
  - a request that a script makes inside the page, such as the sitemap fetch in `crawl.mjs`
  - content that a timer or a click loads, such as rotating images or a font for an open menu
- Plain HTTP stages stay local.
- A large crawl is the main traffic cost: one recording per page.

## Left to the builder

- Where each output records how its source was served.
- Recording time against the gate deadlines. A recording visit took 14 to 220 s. Either `gate.sh` records before its
  deadlines start, or the deadlines get an allowance.
- How several recordings attach to one context, also with `STARDUST_REMOTE_STRICT=1`.
- The recording file layout and its lock, on the helpers that `live-session.mjs` has.

## Follow-ups, out of scope

- The service that runs the agent:
  - Add a run flag that sets `STARDUST_REMOTE_BROWSER` from a secret.
  - Remove the `playwright-cli` stand-in from the image.
  - If the gate needs longer deadlines, pass the overrides.
- Make the default browser the same for all instruments (see Known gaps).
- Fill missing requests through the remote browser, not from the local address (see Known gaps).
- If wanted, let `playwright-cli` follow the same switch for the agent's own browsing.
- Traffic metering per run.
- Detect an off-site redirect at run start.

## Results of the checks

All three checks ran from a Mac. They used a throwaway workspace: the real
`stitch-shot.mjs`, `pixel-compare.mjs`, `chrome-explore.mjs` and `motion-observe.mjs`, and a copy of
`live-session.mjs` with a remote branch of about 40 lines. Local side: Chrome 157 on macOS.

### Step 0: the remote browser (2026-11-09)

Pages: `www.aem.live/`, `www.aem.live/docs/` and `example.com`.

What the remote browser is:

- Chrome 156 on Windows (user agent and fonts agree), time zone `America/New_York`, `navigator.webdriver` false.
- It draws classic scrollbars. They take 15 px of layout width. Local headless Chrome hides them.

Features:

| Feature | Result |
|---|---|
| context viewport 1440 and 360, `deviceScaleFactor` 1 and 2, `reducedMotion`, `locale` | works |
| `addInitScript`, request handler that continues or aborts | works |
| full-page and clipped screenshots, `evaluate`, mouse, keyboard | works |
| user-agent override, changed request header | works |
| `addCookies` | refused: `Overriding <name> cookie is forbidden` |
| `setViewportSize` on an open page | unreliable: layout and screenshot follow, `innerWidth` and `screen.width` stay |
| `Emulation.setScrollbarsHidden` | works |
| navigation to a second domain | refused: `Page.navigate domain limit reached (navigate_domains_limit)` |

Timing (pages without bot protection): connect 0.5 to 0.9 s, first navigation 2 to 14 s, a later navigation on the
same domain 0.8 s. One `stitch-shot` capture took 29 to 66 s remote and 16 to 26 s local.

Noise floor when the remote browser draws (`pixel-compare` against the first local capture):

| Page | Width | Local again | Remote | Remote, scrollbars hidden |
|---|---|---|---|---|
| EDS home | 1440 | 0.24 % | 4.52 % | 1.46 % |
| EDS home | 360 | 0.47 % | 19.39 %, height −241 px | 5.57 % |
| EDS docs | 1440 | 0 % | 5.14 % | 1.65 % |
| EDS docs | 360 | 0 % | 36.45 %, height +203 px | 2.41 % |
| placeholder page | 1440 | 0 % | 2.29 % | 2.29 % |
| placeholder page | 360 | 0 % | 12.03 % | 9.1 %, height +22 px |

What the differences are:

- Without hidden scrollbars, the narrow layout reflows.
- Text in a web font renders close but not equal: other glyph rasterising on Windows.
- Text in the system font stack uses other fonts (Segoe UI against San Francisco). Lines wrap differently and the
  page height changes.
- Part of the EDS home number is the page itself: an animated search demo. That band also differs between two local
  captures.

Verdict: with hidden scrollbars, the floor is 1.5 to 2.3 % at 1440 and 2.4 to 9.1 % at 360. That is too much for a
gate with a 10 % pass bar. It led to step 0b.

### Step 0b: record and replay (2026-11-09)

The question: if the remote browser only records and local Chrome draws, does the gate see the real page?

How: the remote browser visited each page at each width the way the instruments do. It hid scrollbars, dismissed
overlays and scrolled slowly for lazy loads. It recorded every response into a HAR (`recordHar`). The real
`stitch-shot` then captured the page locally twice: live, and replayed from the HAR (`routeFromHAR`). Two replay modes:

- fallback: a request missing from the recording goes to the network
- strict: a missing request is aborted, as if the origin refused everything

Pages: the three pages from step 0, and two pages of a Cloudflare-managed professional-services site (home, a
service page).

Result, with recordings cleaned (see the gotcha below):

| Page | Width | Live against fallback replay | Live against strict replay |
|---|---|---|---|
| EDS home | 1440 | 0.24 % | 6.14 % |
| EDS home | 360 | 0.35 % | 12.61 % |
| EDS docs | 1440 and 360 | 0 % | 0 % |
| placeholder page | 1440 and 360 | 0 % | 0 % |
| managed site, home | 1440 | 0 % | 0.05 % |
| managed site, home | 360 | 0 % | 0.11 % |
| managed site, service page | 1440 | 0 % | 0.02 % |
| managed site, service page | 360 | 0 % | 0.04 % |

For comparison, two live local captures of EDS home differ by 0.24 % (1440) and 0.47 % (360). The system-font page that
showed 9.1 % when drawn remotely shows 0 % when replayed.

What the misses are:

- Managed site: 76 to 85 requests per page under strict replay. Almost all are trackers and analytics beacons. The
  only same-host misses are a bot-detection beacon with a timestamp in its URL and a CAPTCHA badge stylesheet.
- EDS home: about 20 images per page. An animated search demo requests them on a timer, so each visit asks for
  other images. Fallback loads them. Strict replay leaves them blank.

Gotcha: a recording keeps some 2xx responses without a body (iframes, beacons), 50 per page on the managed site.
Replay serves such an entry and never finishes it. The window `load` event then never fires, and scripts that wait
for it (here a carousel) never run. The page grew by 1,440 px. Dropping 2xx entries without a body fixes it in both
modes. Redirect entries have no body by design and must stay.

Cost per width:

- EDS pages: a recording visit took 14 to 28 s, with 2.3 to 2.6 MB of bodies.
- Managed site: a recording visit took 190 to 218 s. It held about 16.5 MB of bodies, in 20 MB of HAR.
- Replayed captures took the same time as live ones.

Verdict: replay draws the source as local Chrome draws the live page.

### Step 0c: probes that click and hover, under replay (2026-11-10)

The question: do the instruments that use the page work on a replayed page?

How: the managed site's home page at 1440, on its recording from step 0b, then 14 hours old. `chrome-explore` and
`motion-observe` each ran four times: live twice as the control, with fallback replay and with strict replay. No
remote traffic.

Header exploration (`chrome-explore`): all four runs found 5 controls, 14 open states and 44 links, in 121 to 123 s.
`chrome-compare` with the `replica` profile:

| Compared | Errors |
|---|---|
| live against live | 0 |
| fallback replay against strict replay | 0 |
| live against either replay | 2, in one menu panel |

Both errors have one cause. The site replaced one article teaser in that panel during the 14 hours. The replay shows
the panel as recorded.

Motion (`motion-compare`, 9 behaviours with one hover family and one carousel click):

| Compared | Parity |
|---|---|
| live against live | 9 of 9 |
| live against fallback replay | 9 of 9 |
| live against strict replay | 8 of 9 |

The one missing behaviour is a transition of a third-party accessibility widget. Strict replay aborted its requests.

Misses under strict replay during the exploration: 527, almost all trackers on each reload. The others:

- the search results page: a submitted search navigates to a page without a recording
- one web-font face that only an open menu uses
- one stylesheet with a timestamp in its URL

Verdict: the probes work under replay. Two things to know:

- The replayed source is frozen at recording time. A live source moves.
- The default age limit is 12 hours. This recording was older than that.

Not tested in any step: a page that blocks our local browser outright, `brob`, a crawl of many pages.

## Sources

```text
Bright Data error codes:  https://docs.brightdata.com/products/scraping-browser/error-codes
Bright Data FAQs:         https://docs.brightdata.com/products/scraping-browser/faqs
Bright Data CDP functions: https://docs.brightdata.com/products/scraping-browser/cdp-functions/custom
web-cli remote browser:   plugins/web/cli/src/docs/remote-browser.md (#555)
```
