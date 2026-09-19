---
name: diff
description: Reconcile a converted/built web page against its source prototype with two complementary probes — a PIXEL/layout diff (stretched images, dropped wraps, blank renders, colour flips) and a STRUCTURAL content+typography diff (dropped/mis-slotted headings, eyebrows, CTAs; rendered-face font forks). Stack-agnostic via profiles (eds | generic). Use after converting a prototype to EDS/AEM (the stardust `deploy` skill Step 10), or for any prototype↔build fidelity check; invocable as the stardust `diff` skill and from workflows.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, and playwright-cli on PATH.
metadata:
  impeccable: none
---

# stardust:diff — prototype ↔ build reconcile

## Operator card

Steps, in order: Prereq 0 (playwright probe; copy the whole `skills/diff/scripts/` dir into the project) → serve a renderable source → 1 pixel/layout probe → 2 structural probe → read → loop on both.

| Step | Command |
|---|---|
| 0 | `node -e "import('playwright').then(()=>process.exit(0))"`; on failure `npm i -D playwright --no-save --legacy-peer-deps`; `lsof -nP -iTCP:<port> -sTCP:LISTEN` to confirm the port is yours |
| serve | `python3 -m http.server` from the prototype's dir; build side = the decorated page (preview or local harness) |
| 1 | `node skills/diff/scripts/visual-diff.mjs "$PROTO" "$BUILD" --profile eds|generic [--width <px>] [--main <sel>] [--sections a,b] [--out <dir>]` |
| 2 | `node skills/diff/scripts/content-diff.mjs "$PROTO" "$BUILD" --profile eds|generic [--width <px>] [--main <sel>] [--json]` |
| live targets (both) | `--ua <string>`, `--wait-until <state>`, `--dismiss [sel,...]`, `--consent-mode accept\|deny`, `--headed[=window]` (ladder start tier: 2 = real Chrome headless; `=window` = 3, off-screen; default = the tier `_crawl-log.json#discovery.fetchTechnique` records — `skills/extract/reference/playwright-recipe.md` § Bot-management fallback), `--locale <tag>` — engine `scripts/live-session.mjs` |

Exit codes: 0 ran (flags advisory) · 1 probe error · 3 bot challenge (never measured). Pass bar: visual red flags none/justified AND content-diff 0 structural 🔴 (🟡/🟠 confirmed intended); re-run both after each fix.

Outputs: reports on stdout; `visual-diff` screenshots under `--out <dir>`; `content-diff --json` dumps both inventories.

| At step | Read |
|---|---|
| 0 / serve | `../extract/SKILL.md` § Setup |
| 1 / 2 | `scripts/diff-profiles.mjs` (labels, hints, thresholds per profile); `scripts/content-inventory.mjs` (classifier + differ) |
| live targets | `../replica/reference/source-fidelity-gate.md` § Hardening rules · § Script adaptations |
| read (🔴 JOIN/SPLIT) | `../replica/reference/recreation-procedure.md` § Granularity parity |
| in-loop sibling gates | `../deploy/SKILL.md` § 2b. Section schema + decode tier · § Step 10 — Reconcile on the DEPLOYED URL |

Sections: When to use · The two probes · Run it · Reading content-diff · Profiles · Shared engine + the in-loop sibling · Workflow use.

Two probes compare a **source** prototype against a **built** page; they catch
**disjoint** failure classes — run BOTH, either alone gives a false "looks fine".

Both are framework-agnostic Playwright probes comparing two rendered URLs by
**computed style + DOM** (not pixels); stack-specific language lives in a
**profile** (`--profile eds|generic`).

## When to use

- After converting a prototype to EDS (the stardust `deploy` skill's Step 10) — use `--profile eds`.
- Any "does the build match the design?" check between two rendered URLs (Figma export vs React build, legacy page vs rebuild) — `--profile generic`.
- Inside a conversion/QA workflow as the validation gate (see *Workflow use*).

Not for: an undecorated static file (use the build/harness URL — a raw `.plain.html` has no roles to classify).

## The two probes

| Probe | Script | Sees | Blind to |
|---|---|---|---|
| **Pixel / layout** | `skills/diff/scripts/visual-diff.mjs` | stretched images, dropped max-width wraps, blank renders, surface/ground colour flips, image-count gaps | "right text, wrong slot"; a dropped CTA (full pixels, plausible colours → no flag) |
| **Structural content + type** | `skills/diff/scripts/content-diff.mjs` | MISSING / ROLE-SWAPPED headings·eyebrows·CTAs, invented/dropped body copy, rendered-FACE font forks (width probe) | geometry / layout regressions |

`content-diff` extracts an ordered, role-classified inventory (`heading` / `eyebrow` /
`cta`+href / `body`) from each `<main>`, classifying by **computed style + tag** so the
prototype's DOM and the built DOM compare symmetrically, then diffs them.

## Run it

```bash
# Prereq 0: playwright importable from the project root — probe
#   node -e "import('playwright').then(()=>process.exit(0))"
# and re-install (npm i -D playwright --no-save --legacy-peer-deps) on failure:
# a --no-save install from extract is PRUNED by any later real npm i
# (extract SKILL.md § Setup). Run the copied scripts from the project, not the plugin.
# Copy the WHOLE skills/diff/scripts/ dir: content-diff imports diff-profiles.mjs and
# content-inventory.mjs (the deploy gates use their own synced copies in skills/deploy/scripts/).
# Prereq: a RENDERABLE source. Static → serve from its own dir (python3 -m http.server).
# The build URL must be the DECORATED page (live/preview or a local harness), not raw markup.
# verify the port is YOURS (lsof -nP -iTCP:8791 -sTCP:LISTEN) — a foreign server = a foreign page
PROTO="http://localhost:8791/<prototype>.html"
BUILD="https://<branch>--<repo>--<owner>.aem.page/<path>"   # or http://localhost:3000/<harness>

# 1. PIXEL/layout
node skills/diff/scripts/visual-diff.mjs   "$PROTO" "$BUILD" --profile eds --sections ".hero"

# 2. STRUCTURAL content + type
node skills/diff/scripts/content-diff.mjs  "$PROTO" "$BUILD" --profile eds   # --json dumps both inventories
```

Flags (both tools): `--profile eds|generic` (default `eds`), `--width <px>` (default 1280),
`--main <selector>` (content root; content-diff defaults from the profile, visual-diff to `main`),
plus the live-target set (shared engine: `scripts/live-session.mjs` — every context sends the
real-Chrome UA **and** the standard Chrome request headers; the UA alone still 403s on
Akamai-class bot management):

- `--ua <string>` — user-agent override (default real-Chrome desktop).
- `--wait-until <state>` — goto wait override. Default (shared `defaultWaitUntil`
  in `scripts/live-session.mjs`), decided **per URL side**, three tiers:
  - localhost/127.0.0.1 → `networkidle` (local prototypes / harnesses, unchanged);
  - EDS build/preview origins — hostnames ending in `.aem.page`, `.aem.live`, `.hlx.page`,
    `.hlx.live` → `networkidle` (they decorate asynchronously; domcontentloaded
    reads the pre-decoration DOM — false reds / FONT FORK on deploy Step 10);
  - all other live http(s) → `domcontentloaded` (live sites with analytics beacons
    never reach networkidle).

  `--wait-until` overrides all three tiers.
- `--dismiss [sel,...]` — dismiss overlays on both sides: cookie consent (clicked, not
  removed; `--consent-mode deny` clicks reject-all, never accept) AND timed
  marketing/newsletter modals, plus extra site-specific selectors; mouse parked after.
  `../replica/scripts/stitch-shot.mjs` adds `--allow-consent`, `--no-dismiss-defaults`,
  `--remove-text`, `--keep-pinned`, `--exclude` (its `--help`).
- `--headed[=window]` — bot-management ladder start tier (Operator card, live targets row).
- `--locale <tag>` — pin Accept-Language + context locale (geo-redirecting sites capture a
  different locale per run otherwise).

`visual-diff` also: `--out <dir>`, `--sections a,b` (per-section screenshots).

A bot-management challenge/blocked interstitial on either navigation fails LOUD with
**exit 3** — never measured as the source. Escalate with `--headed`, then `--headed=window`;
still blocked at tier 3 means the gate fails, it does not degrade.

A plain (non-challenge) HTTP error on either side — e.g. a **404 build side, normal on
aem.page before preview propagation** — is NOT fatal: the probe logs a loud warning,
measures the error page, and the flags (BLANK RENDER / content asymmetry) carry the
signal with **exit 0**. That is the probes' advisory contract: 0 = ran (flags advisory),
1 = probe error, 3 = bot challenge.

## Reading content-diff

- 🔴 **MISSING CTA / HEADING / EYEBROW** — real dropped content. FIX. A missing eyebrow is most often a segmentation drop where the eyebrow precedes its heading; a missing CTA means the component never rendered the link. These are exactly what the pixel probe cannot see.
- 🔴 **ROLE SWAP** — same text under a different role (body painted as eyebrow, eyebrow folded into a teaser). FIX the component's node segmentation.
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
(and a synced copy in `skills/deploy/scripts/content-inventory.mjs` that the deploy gates import
locally so they don't depend on this skill — keep the two copies in sync until consolidated).
They measure with the same instrument as two gates of the stardust `deploy` skill:
`section-schema.mjs` (the pre-code ENCODE/DECODE contract, deploy #93) and `block-roundtrip.mjs`
(the in-loop per-block gate, deploy #94 — the same inventory diff, run per block at authoring time
against a local decorate() harness, no DA needed, exit-code gated). Run the in-loop gate while
converting; run THIS skill's two probes as the final post-deploy proof. A defect first found here
that the in-loop gate passed = the delivery pipeline reshaped the content in transport — fix the
block's flattened-shape fallback, not the authoring.

## Workflow use

Call both scripts in a validation phase and gate on the output. The stardust
`deploy` skill's conversion workflow Validate phase runs both after building a
local harness; mirror that:

1. Build/serve the decorated build page (e.g. a local QA harness, or the branch preview).
2. `visual-diff … --profile eds` → fix STRETCHED/FLUSH-LEFT/SURFACE-GROUND/GAP flags (unless justified).
3. `content-diff … --profile eds` → fix every 🔴; confirm 🟡/🟠.
4. Loop until visual none/justified AND content-diff 0 structural 🔴.

> Naming note: this skill ships in the `stardust` plugin and is invoked as
> the stardust `diff` skill.
