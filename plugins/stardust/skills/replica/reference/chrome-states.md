# Chrome states — the matrix, the instrument, the gate cells

## When to read what

- § The matrix — before the first chrome sign-off of an archetype set: the named list of states.
- § Contract — what the item-5 chrome gate now requires per cell, the escape hatch, hands-off.
- § Instrument — running `../scripts/chrome-states.mjs`; cache, exit codes, the deadline rule.
- § Nav model — the JSON the probe emits per opened panel and who serialises it.
- § Residual route — when a cell cannot be reproduced in a static prototype.

The resting header crop (`source-fidelity-gate.md` § Pass bar, item 5) measures
ONE cell of a matrix. Recorded across the field runs: replicas passed the
resting crop and shipped inert triggers — flat link lists where the source
opens hover mega-menus, a link where the source opens a search panel, a
boilerplate accordion where the source drills down behind a Back bar — and the
first partner review opened on "the header does not work". Every cell the gate
never opened was wrong; every cell it measured was right.

## The matrix

Per chrome variant (one per distinct header identity — `recreation-procedure.md`
§ Chrome archetype and the state matrix), the states are a NAMED list; ledgers,
briefs and hand-offs use these names verbatim:

| state | how the probe reaches it | crop |
|---|---|---|
| `rest` | the settled page at scroll 0 (item 5 as before) | header band + footer band |
| `scrolled` | `scrollTo(0, 800)`, 400 ms — header identity (height, position, pinned) | identity only, no crop |
| `menu:<label>` | each top-level trigger: hover → 150 ms → click if nothing opened → `transitionend`/400 ms | the opened panel's rect |
| `search` | the search control | the opened panel's rect |
| `language` | the language / region switcher | the opened panel's rect |
| `drawer` | at the mobile width: the menu toggle | the drawer's rect |
| `drawer-drilled` | one level into the open drawer (a Back bar is recorded) | the drilled level's rect |
| `footer-accordion:<label>` | at the mobile width: footer `details`/`summary` or `aria-expanded` groups | the opened content's rect |

A state the probe opens on live is a **cell**. A trigger that opens nothing is
a plain link — recorded, never a cell. The trigger → panel association is
recorded per cell (`aria-controls`, `data-menu`, the newly-visible diff, a
`details` parent), because panels commonly live OUTSIDE the trigger's `<li>`
(portal roots): the nav document is authored from the ASSOCIATED panel, never
from the header's visible anchors.

## Contract

**Condition.** An archetype's Phase 4 chrome sign-off (item 5) requires the
matrix probed once per archetype set and every live-observed cell either
crop-passed on the build or logged as a residual with a cause. Cells are
gated at the SAME bar as the resting bands — crop-compare ≥ 98 % match on the
panel rect, same width both sides (cells added, threshold unchanged). A cell
observed live and absent on the build (`missing on build`) is a MISSING
finding, exit 2, like chrome-parity's MISSING.

**What it blocks.** Presenting an archetype for approval while a cell is
neither crop-passed nor a named residual; fan-out of a page whose chrome
variant has no gated row (`progress.json.chrome`, § below when it lands).

**Escape hatch.** The residual ledger only (`source-fidelity-gate.md`
§ Residual logging format): a cell a static prototype cannot reproduce —
search posting to a live backend, third-party content inside the panel, a
carousel drifting under a transparent header — is logged with a `cause` and
the opaque-panel crop as its artifact; never a pass. There is no `--skip
<state>` flag: skipping is a ledger entry. Selector overrides (`--trigger`,
`--panel`, `--search`, `--toggle`) exist for sites where the attribute pass
finds nothing — they change what is probed, never what passes.

**Hands-off.** Same bar. The run iterates within the item-5 cap, then logs the
residuals and prints the matrix in the hand-off table — never approves
silently, never lowers the bar (master § Hands-off: who answers changes, what
must pass does not). A `run-capped` deadline (exit 124) on the probe is
printed as `chrome-states: no verdict (deadline)` — not a FAIL, not a MISSING,
the same rule as `gate.sh`'s drift probe.

**Protected.** Exit 124 = no verdict; thresholds unchanged; the deploy ledger
untouched (this is a replica-phase instrument — the deployed open-state gate
is `chrome-parity --open` on the preview origin, `deploy/reference/chrome.md`);
default ports untouched (the build URL is the caller's); hit-minimisation —
every state is a same-navigation action: one live navigation per breakpoint
per URL plus one per variant sample, cached in `chrome-live-states.json`
(state-aware key; `gate.sh`'s live-drift recapture deletes it with the other
live caches); consent via live-session (`--consent-mode` default `accept`);
no inlining — the model is authored as a `/nav` fragment; no behaviour
assertion — `opens on hover|click` and durations are evidence for the motion
pass, not asserted here.

## Instrument

```bash
G="stardust/replica/gates/<slug>-1440"
# once per archetype set: every state on live (1440 + 360), one sample per page type for variants
node stardust/scripts/replica/run-capped.mjs --timeout 300 -- \
  node stardust/scripts/replica/chrome-states.mjs "$LIVE" --from-state stardust/state.json \
    --live-cache "$G/chrome-live-states.json" --out "$G/chrome-states"
# every gate round on chrome: replay the cells on the build, crop + diff each (live side from the cache)
node stardust/scripts/replica/chrome-states.mjs "$LIVE" "$PROTO" \
  --live-cache "$G/chrome-live-states.json" --out "$G/chrome-states" --json "$G/chrome-states-iter<k>.json"
```

Exit 0 = inventory written (live only) or every paired cell within tolerance;
2 = deltas, an over-bar crop or `missing on build`; 1 = error; 3 = bot
challenge (fail loud). Per cell the report carries the chrome-parity findings
(PAIR / MISSING / EXTRA / OCCLUDED / STATE / PSEUDO — one diff engine, imported),
the crop result and the panel rect delta; the desktop model of every panel;
`variants[]` — distinct header identities across the sample (each is a chrome
variant needing its own resting crop and a page-level marker). The rest-state
diagnostic stays `chrome-parity.mjs`; `motion-observe.mjs` stays the motion
evidence. Fan-out briefs carry the matrix and this command block verbatim.

## Nav model

Per opened panel the probe emits a neutral JSON model — `groups[] {label, href,
icon, items[] {label, href, description, external}, action}`, `promos[]
{image, title, description, cta}`, `footerLinks[]` — merged under the top-level
items (plain links included) as `navModel`. Link-set check: the model must
contain every flat visible nav link at rest (a miss is a WARN — an enumeration
gap, fix the probe target); model-only links are `panel-only (off-DOM at
rest)` — the content a rest-state gate never sees, informational. The `/nav`
HTML serialisation follows the deploy grammar (`../../deploy/reference/chrome.md`
§ N-level nav grammar — nested `<ul>` per level, description `<p>`, trailing
action link, trailing promo `<li>`); this file owns the JSON, not a second
grammar.

## Residual route

Log the cell in the breakpoint's `residuals[]` with `region: "<state name>"`,
the `cause` class (`third-party-in-flow`, `live-data-embed`, `capture-state`,
`authored-volatile-masked` for a carousel under a transparent header — crop the
opaque panel only, never a full-width band), the crop and the probe JSON as
`artifacts[]`, and `acceptedBy`. A cell missing on build is never a residual:
it is unfinished authoring.
