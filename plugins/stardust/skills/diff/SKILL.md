---
name: diff
description: Reconcile a converted/built web page against its source prototype with two complementary probes — a PIXEL/layout diff (stretched images, dropped wraps, blank renders, colour flips) and a STRUCTURAL content+typography diff (dropped/mis-slotted headings, eyebrows, CTAs; rendered-face font forks). Stack-agnostic via profiles (eds | generic). Use after converting a prototype to EDS/AEM (the stardust `deploy` skill Step 10), or for any prototype↔build fidelity check; invocable as the stardust `diff` skill and from workflows.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:diff — prototype ↔ build reconcile

Two probes that compare a **source** prototype against a **built** page. They catch
**disjoint** failure classes — run BOTH; either alone gives a false "looks fine".

Both are framework-agnostic Playwright probes that compare two rendered URLs by
**computed style + DOM** (not pixels). All stack-specific language lives in a
**profile** (`--profile eds|generic`); the comparison logic is generic.

## When to use

- After converting a prototype to EDS (the stardust `deploy` skill's Step 10) — use `--profile eds`.
- Any "does the build match the design?" check between two rendered URLs (a Figma export vs a React build, a legacy page vs a rebuild) — use `--profile generic`.
- Inside a conversion/QA workflow as the validation gate (see *Workflow use*).

Not for: a single static file with no JS decoration (use the build/harness URL so components are decorated — a raw `.plain.html` has no roles to classify).

## The two probes

| Probe | Script | Sees | Blind to |
|---|---|---|---|
| **Pixel / layout** | `skills/diff/scripts/visual-diff.mjs` | stretched images, dropped max-width wraps, blank renders, surface/ground colour flips, image-count gaps | "right text, wrong slot"; a dropped CTA (full pixels, plausible colours → no flag) |
| **Structural content + type** | `skills/diff/scripts/content-diff.mjs` | MISSING / ROLE-SWAPPED headings·eyebrows·CTAs, invented/dropped body copy, rendered-FACE font forks (width probe); dropped `placeholder`/`aria-label`/`title` values, missing/wrong/moved icons — on the main root AND the `header`/`footer` chrome roots by default | geometry / layout regressions |

`content-diff` extracts an ordered, role-classified inventory (`heading` / `eyebrow` /
`cta`+href / `body`) from each root — the `--main` root(s) plus, by default, the `header`
and `footer` chrome roots — classifying by **computed style + tag** so the prototype's DOM
and the built DOM compare symmetrically, then diffs them root by root; a second inventory per
root carries the `placeholder` / `aria-label` / `title` values and the icons.

## Run it

```bash
# Prereq 0: playwright importable from the project root (node -e "import('playwright')"), else
# npm i -D playwright pixelmatch pngjs cheerio --legacy-peer-deps, never --no-save (extract
# SKILL.md § Setup). Run the copied scripts from the project root: ESM resolves from the script.
# Copy the WHOLE skills/diff/scripts/ dir: content-diff imports its local diff-profiles.mjs
# AND content-inventory.mjs (deploy keeps its own synced copies for #93/#94).
# Prereq: a RENDERABLE source. Static → serve from its own dir (python3 -m http.server).
# The build URL must be the DECORATED page (live/preview or a local harness), not raw markup.
# ONE server, ONE port — probe before starting one (curl is always present, lsof is not):
curl -sI localhost:8791/ | head -1                   # 200/404 = something serves the port; no line = free
curl -sI localhost:8791/<prototype>.html | head -1   # 200 = it serves YOUR dir: reuse it
command -v lsof >/dev/null && lsof -nP -iTCP:8791 -sTCP:LISTEN   # optional: names the pid
# Nothing answered → start yours. A foreign server: never kill it; use a per-project port
# (the traps: ../deploy/SKILL.md § Step 10).
PROTO="http://localhost:8791/<prototype>.html"
BUILD="https://<branch>--<repo>--<owner>.aem.page/<path>"   # or http://localhost:3000/<harness>

# 1. PIXEL/layout
node skills/diff/scripts/visual-diff.mjs   "$PROTO" "$BUILD" --profile eds --sections ".hero"

# 2. STRUCTURAL content + type
node skills/diff/scripts/content-diff.mjs  "$PROTO" "$BUILD" --profile eds   # --json dumps both inventories
```

Flags (both tools): `--profile eds|generic` (default `eds`), `--width <px>` (default 1280),
`--main <selector[,selector…]>` (content root; content-diff defaults from the profile and takes a
comma-separated list — every root is inventoried and diffed on its own and each finding line
carries its root as `[root]`; visual-diff takes one selector, default `main`), content-diff only:
`--chrome` / `--no-chrome` (default on — the `header` and `footer` roots, resolved as the first
`<header>`/`[role=banner]` and `<footer>`/`[role=contentinfo]` outside the main root(s), are
compared beside it; a side lacking one is measured as empty there and the root line says so),
plus the live-target set (shared engine: `scripts/live-session.mjs` — every context sends the
real-Chrome UA **and** the standard Chrome request headers; the UA alone still 403s on
Akamai-class bot management):

- `--ua <string>` — user agent override (default: real-Chrome desktop UA).
- `--wait-until <state>` — goto wait override. Default rule (one shared
  `defaultWaitUntil` in `scripts/live-session.mjs`), decided **per URL side**, three tiers:
  - localhost/127.0.0.1 → `networkidle` (local prototypes / harnesses, unchanged);
  - EDS build/preview origins — hostnames ending in `.aem.page`, `.aem.live`, `.hlx.page`,
    `.hlx.live` → `networkidle` (they decorate asynchronously and reliably reach
    networkidle; measuring at domcontentloaded reads the pre-decoration DOM — flaky
    false reds / FONT FORK on deploy Step 10);
  - all other live http(s) → `domcontentloaded` (live sites with analytics beacons
    never reach networkidle).

  `--wait-until` overrides all three tiers.
- `--dismiss [sel,...]` — dismiss overlays on both sides: cookie consent (clicked, not
  removed) AND timed marketing/newsletter modals, plus optional extra site-specific
  selectors; the mouse is parked afterwards.
- `--headed` — escalation for bot-managed sites: headed stealth real Chrome.
- `--locale <tag>` — pin Accept-Language + context locale (geo-redirecting sites capture a
  different locale per run otherwise).

`visual-diff` also: `--out <dir>`, `--sections a,b` (per-section screenshots).

A bot-management challenge/blocked interstitial on either navigation fails LOUD with
**exit 3** — it is never measured as the source. Escalate with `--headed`; if that is still
blocked, the site needs crawl.mjs-class capture and the check cannot run headless.

A plain (non-challenge) HTTP error on either side — e.g. a **404 build side, normal on
aem.page before preview propagation** — is NOT fatal: the probe logs a loud warning,
measures the error page, and the flags (BLANK RENDER / content asymmetry) carry the
signal with **exit 0**. That is the probes' advisory contract: 0 = ran (flags advisory),
1 = probe error, 3 = bot challenge.

## The published-origin probes (#125)

`content-diff` reconciles a prototype with its build; against a LIVE commerce origin its per-node
findings were false, and the pixel gate passed a page whose every card was clipped
(`../replica/reference/source-fidelity-gate.md` § The all-pages published-origin gate). Three
probes ask the checkable questions; all load both sides in the same window-free real-Chrome tier
and settle them the same way (`scripts/measure-live.mjs`).

```bash
ORIGIN="https://www.example.com/<path>"; SERVED="https://main--repo--owner.aem.live/<path>"
node stardust/scripts/diff/clip-probe.mjs "$SERVED" [--json clip.json]                       # D1: exit 2 on cut / hidden text or controls
node stardust/scripts/diff/content-presence.mjs "$ORIGIN" "$SERVED" [--variable "<selO>=<selE>"]  # D2: exit 2 on MISSING/HIDDEN link or heading
node stardust/scripts/diff/unit-geometry.mjs "$ORIGIN" "$SERVED" --unit "<selO>=<selE>" --n 2      # D3: exit 2 on an element off / hidden / missing
```

Reading: a 🔴 clip group names the clipper (a fixed-height box with `overflow: hidden`) — fix
that block's CSS, never the content. HIDDEN LINK = in the DOM but clipped (CSS); MISSING LINK =
not served (encoder); CONTROL STATE = same control, another value; COUNT … = session-variable
region, confirm by eye. The origin side fails loud on HTTP ≥ 400 (exit 4) and a bot challenge
(exit 3). Traps: an infinite-scroll origin keeps loading under the settle — mark the region
`--variable`; a live origin without `<main>` compares whole page against whole page (the scope
line says so), header / footer left to the chrome crop gate unless `--chrome`; the count-phrase
and "read more" heuristics are English word lists (`--count-words`, `--more-words`).

## The header contract (#132)

Every probe above sees the header at rest (pointer parked, motion frozen), so it passes with every menu wrong;
runs shipped boilerplate click dropdowns for hover mega menus, search and cart as plain links, a static list for a
drill-down drawer. The header's behaviour is recorded from the source once and the build compared with it:

```bash
node stardust/scripts/diff/chrome-explore.mjs "$ORIGIN" stardust/chrome/header-contract.json   # 1440 + 390
node stardust/scripts/diff/chrome-explore.mjs "$SERVED" stardust/chrome/header-build.json
node stardust/scripts/diff/chrome-compare.mjs stardust/chrome/header-contract.json stardust/chrome/header-build.json \
  --profile replica --json stardust/chrome/header-parity.json    # functional under redesign and reskin
```

The explorer hovers (desktop), clicks and keys every header control and records each opened state (links,
headings, crop, `aria-expanded`, focus, scroll lock, motion, close paths), nested levels within `--max-states 400
--max-depth 4`, search typeahead and submit, and the header scrolled; its summary line sizes the work. The comparer
exits 2 on a missing control or state (hover rebuilt as click included), panel links, keyboard, close paths or
scroll lock; `replica` adds open-state crops (2 %), motion (max(80 ms, 25 %)) and scroll states. **Only the site
owner clears a finding**: `stardust/chrome/header-decisions.json` (`{ decisions: [{ finding, decision, reason, by,
at }] }`), never signed by an agent. It runs at extract `--prep` (the contract), on the foundation shell and in
deploy Step 10, on the live host before handover (`done-check` `header_parity`), and in qa. Crops stay in
`stardust/.work/chrome/`.

## Reading content-diff

- 🔴 **MISSING CTA / HEADING / EYEBROW** — real dropped content. FIX. A missing eyebrow is most often a segmentation drop where the eyebrow precedes its heading; a missing CTA means the component never rendered the link. These are exactly what the pixel probe cannot see.
- 🔴 **ROLE SWAP** — same text under a different role (body painted as eyebrow, eyebrow folded into a teaser). FIX the component's node segmentation.
- 🔴 **MISSING PLACEHOLDER / ARIA-LABEL, MISSING ICON, ICON DIFF on an interactive element** (an input, a button, a link or inside one) — a dropped localized search placeholder, a share link without its aria-label or icon, a wrong flag in a locale link, an empty icon box. FIX. Outside interactive elements the same findings are 🟡.
- 🟡 **MISSING TITLE** — always 🟡: a title tooltip is not read by most assistive tech and is commonly dropped by design. 🟡 **ICON MOVED** — the same icon (glyph code point / file name / svg signature) at another anchor, paired by identity and document order after the anchor passes (typically a text-less `<button>` host that anchors as `button#n`): the icon is present, CONFIRM its placement. 🟡 **ICON KIND** (glyph vs svg vs image — the pixel probe judges) and every **EXTRA**.
- Every finding line names its root — `🔴 MISSING PLACEHOLDER [header]: …` — and the report prints one block per root (`root "main"`, `root "header"`, …; a root a side lacks is measured as empty there and the line says which side).
- 🟡 **MISSING BODY / EXTRA** — body prose dropped, or build copy with no source. Usually a placeholder→real-copy rewrite. CONFIRM intended; don't blindly "fix".
- 🟠 **FONT FORK** — matched lines whose rendered FACE differs (width probe, never `document.fonts.check`). `source X→sys` means the prototype named font X but never loaded it and fell back to system — the build self-hosting the intended fallback is then CORRECT, not a bug. All forked lines are grouped into one advisory.
- **Known limitation — node-granularity JOIN/SPLIT reads as 🔴 (#87).** When the source renders one text run as N sibling nodes and the build renders the same text as ONE node (or vice versa — e.g. three fact chips vs one combined chip span), the diff currently reports MISSING + ROLE SWAP + EXTRA for what is a non-defect. Until concat-matching lands (a source node that is a substring of a same-region build node → 🟡 JOIN/SPLIT advisory), verify a 🔴 whose texts concatenate into an EXTRA finding's text before treating it as dropped content — confirmed-justified is a pass.

**Pass bar:** visual red flags none/justified **AND** content-diff **0 structural 🔴** (🟡/🟠 confirmed intended). Re-run BOTH after each fix.

## Profiles

`skills/diff/scripts/diff-profiles.mjs` holds them. A profile supplies the source/target **labels**,
per-flag **remediation hints**, the **font-delta** threshold, the default content-root
**selector**, and the **eyebrow** classifier thresholds. The engines carry no stack
strings.

- **`eds`** (default) — Edge Delivery / DA remediation language + the stardust `deploy` skill's finding numbers.
- **`generic`** — neutral source/build language for any stack.

Add a profile by copying `generic` in `diff-profiles.mjs` and editing `hints`.

## Shared engine + the in-loop sibling

The structural probe's classifier + differ live in `skills/diff/scripts/content-inventory.mjs`
(deploy imports its synced copy). They measure with the same instrument as two gates of the stardust `deploy` skill:
`section-schema.mjs` (the pre-code ENCODE/DECODE contract, deploy #93) and `block-roundtrip.mjs`
(the in-loop per-block gate, deploy #94 — the same inventory diff, run per block at authoring time
against a local decorate() harness, no DA needed, exit-code gated). Run the in-loop gate while
converting; run THIS skill's two probes as the final post-deploy proof. A defect first found here
that the in-loop gate passed = the delivery pipeline reshaped the content in transport — fix the
block's flattened-shape fallback, not the authoring.

## Workflow use

Call both scripts in a validation phase and gate on the output, as deploy's Validate phase does on a served,
decorated build (local harness or branch preview): fix visual-diff's STRETCHED/FLUSH-LEFT/SURFACE-GROUND/GAP flags
(unless justified) and every content-diff 🔴, confirm 🟡/🟠, loop until both are clean.
