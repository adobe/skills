---
name: diff
description: Reconcile a converted/built web page against its source prototype with two complementary probes — a PIXEL/layout diff (stretched images, dropped wraps, blank renders, colour flips) and a STRUCTURAL content+typography diff (dropped/mis-slotted headings, eyebrows, CTAs; rendered-face font forks). Stack-agnostic via profiles (eds | generic). Use after converting a prototype to EDS/AEM (the stardust:deploy Step 10), or for any prototype↔build fidelity check; invocable as stardust:diff and from workflows.
license: Apache-2.0
---

# stardust:diff — prototype ↔ build reconcile

Two probes that compare a **source** prototype against a **built** page. They catch
**disjoint** failure classes — run BOTH; either alone gives a false "looks fine".

Both are framework-agnostic Playwright probes that compare two rendered URLs by
**computed style + DOM** (not pixels). All stack-specific language lives in a
**profile** (`--profile eds|generic`); the comparison logic is generic.

## When to use

- After converting a prototype to EDS (the `stardust:deploy` skill's Step 10) — use `--profile eds`.
- Any "does the build match the design?" check between two rendered URLs (a Figma export vs a React build, a legacy page vs a rebuild) — use `--profile generic`.
- Inside a conversion/QA workflow as the validation gate (see *Workflow use*).

Not for: a single static file with no JS decoration (use the build/harness URL so components are decorated — a raw `.plain.html` has no roles to classify).

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
# Copy the WHOLE skills/diff/scripts/ dir: content-diff imports its local diff-profiles.mjs
# AND content-inventory.mjs. (The deploy gates #93/#94 now use their OWN synced copies in
# skills/deploy/scripts/ — A6/A2 are independent of this skill; the two copies must stay in
# sync until the diff-skill abrasion PR consolidates them.)
# Prereq: a RENDERABLE source. Static → serve from its own dir (python3 -m http.server).
# The build URL must be the DECORATED page (live/preview or a local harness), not raw markup.
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

- **`eds`** (default) — Edge Delivery / DA remediation language + `stardust:deploy` finding numbers.
- **`generic`** — neutral source/build language for any stack.

Add a profile by copying `generic` in `diff-profiles.mjs` and editing `hints`.

## Shared engine + the in-loop sibling

The structural probe's classifier + differ live in `skills/diff/scripts/content-inventory.mjs`
(and a synced copy in `skills/deploy/scripts/content-inventory.mjs` that the deploy gates import
locally so they don't depend on this skill — keep the two copies in sync until consolidated).
They measure with the same instrument as two `stardust:deploy` gates:
`section-schema.mjs` (the pre-code ENCODE/DECODE contract, deploy #93) and `block-roundtrip.mjs`
(the in-loop per-block gate, deploy #94 — the same inventory diff, run per block at authoring time
against a local decorate() harness, no DA needed, exit-code gated). Run the in-loop gate while
converting; run THIS skill's two probes as the final post-deploy proof. A defect first found here
that the in-loop gate passed = the delivery pipeline reshaped the content in transport — fix the
block's flattened-shape fallback, not the authoring.

## Workflow use

Call both scripts in a validation phase and gate on the output. The
`stardust:deploy` conversion workflow's Validate phase runs both after building
a local harness; mirror that:

1. Build/serve the decorated build page (e.g. a local QA harness, or the branch preview).
2. `visual-diff … --profile eds` → fix STRETCHED/FLUSH-LEFT/SURFACE-GROUND/GAP flags (unless justified).
3. `content-diff … --profile eds` → fix every 🔴; confirm 🟡/🟠.
4. Loop until visual none/justified AND content-diff 0 structural 🔴.

> Naming note: this skill ships in the `stardust` plugin and is invoked as
> `stardust:diff`. It pairs with `stardust:deploy`, whose Step 10 runs both probes
> as its Validate gate.
