# Chrome states — the matrix, the instrument, the gate cells

## When to read what

- § The matrix — the named list of states · § Contract — condition, escape hatch, hands-off.
- § Instrument — `../scripts/chrome-states.mjs`: cache, exit codes, the deadline rule · § Nav model.
- § Chrome variants — fingerprint, chrome archetype row, the `progress.json` `chrome` block · § Residual route.

The resting header crop (`source-fidelity-gate.md` § Pass bar, item 5) measures
ONE cell of a matrix. Recorded across the field runs: replicas passed the
resting crop and shipped inert triggers (flat lists for hover mega-menus, a
link for a search panel, an accordion for a drill-down) — every cell the gate
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

A state the probe opens on live is a **cell**; a trigger that opens nothing is
a plain link — recorded, never a cell. The trigger → panel association
(`aria-controls`, `data-menu`, newly-visible diff, `details` parent) is
recorded per cell: panels commonly live OUTSIDE the trigger's `<li>`, and the
nav document is authored from the ASSOCIATED panel, never the visible anchors.

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
variant has no gated row (§ Chrome variants); closing a journal "Open:
site-scope item" (menu, search, language outside the captured page) without
a plan row — it is a plan row with a phase, never a journal note.

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

**Protected.** Exit 124 = no verdict; thresholds unchanged; deploy ledger and
default ports untouched (replica-phase instrument; the deployed open-state
gate is `chrome-parity --open` on the preview origin, `deploy/reference/chrome.md`);
hit-minimisation — every state is a same-navigation action: one live
navigation per breakpoint per URL plus one per variant sample, cached in
`chrome-live-states.json` (keyed on URL, widths and overrides — never the
sample list, so the gate rounds below hit the `--from-state` run's file;
`gate.sh`'s live-drift recapture deletes it with the other live caches);
consent via live-session (default `accept`); no inlining (the model is a
`/nav` fragment); no behaviour assertion — `opens on hover|click` is recorded
per cell (`trigger`) and said as a WARN, evidence for `motion-assert`, never
a delta.

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

Exit 0 = inventory (live only) or every paired cell within tolerance; 2 =
deltas, an over-bar crop or `missing on build`; 1 = error; 3 = bot challenge.
Per cell: chrome-parity's findings (one diff engine, imported), the crop result,
the panel rect delta; per panel the nav model; `variants[]` = distinct header
identities across the sample. `chrome-parity.mjs` stays the rest-state
diagnostic, `motion-observe.mjs` the motion evidence. Fan-out briefs carry the
matrix and this command block verbatim.

## Nav model
Per opened panel the probe emits a neutral JSON model — `groups[] {label, href,
icon, items[] {label, href, description, external}, action}`, `promos[]
{image, title, description, cta}`, `footerLinks[]` — merged under the top-level
items (plain links included) as `navModel`. Link-set check: the model must
contain every flat visible nav link at rest (a miss is a WARN — an enumeration
gap); model-only links are `panel-only (off-DOM at rest)`, the content a
rest-state gate never sees. The `/nav` HTML serialisation follows the deploy
grammar (`../../deploy/reference/chrome.md` § Chrome states and variants —
"N-level nav grammar"); this file owns the JSON, not a second grammar.

## Chrome variants

`../scripts/chrome-variants.mjs` buckets the whole inventory at zero live hits
by a static fingerprint of the captured record (`chrome` field —
`../../extract/reference/current-state-schema.md` § Chrome: header/footer
landmark class sets minus state classes, nav-row count, stylesheet paths
without cache-busters) and writes `state.json.pages[].chromeVariant`
(`--write`). Names persist, never renumbered: home bucket `default`, others
`variant-<key>`; records without the field are `unfingerprinted` — blocked,
never merged. One live probe per bucket (`chrome-states.mjs --from-state`)
prints the buckets that render identically; the merge is the agent's, written
to `chrome.variants[]` by hand (the instrument records, never renames). **The chrome archetype row comes
before the first page archetype of its variant**: item 5 at both breakpoints
plus every state of § The matrix recorded as `gated` (crop passed), `dead`
(observed absent on live — evidence, never inference) or `unprobed:<reason>`
(bot challenge, auth-gated, headed-window ban — residual class
`chrome-state-unprobed`, in the approval message and the hand-off, never
silent); `gated` needs its artefact (`gates.<bp>` for every configured
breakpoint — `chrome-variants.mjs --progress` re-reads it, a typed word blocks);
later archetypes on the variant import the row and re-run only the rest crop.
Hands-off applies the `chrome-variant` default and prints the row; it never
skips the probe and never approves around an unrowed bucket. A second variant opens the `chrome-variant`
Default row (`../../stardust/reference/decisions.md`: a template body class or
a `nav:`/`footer:` document, never page-local CSS) BEFORE its fan-out;
`chrome-variants.mjs --progress` exits 2 while a variant lacks its row.

```json
"chrome": { "variants": [ { "key": "3f9a1c2d", "name": "default", "pages": 84, "archetype": "home",
  "fingerprint": { "header": ["site-header"], "footer": ["site-footer"], "navRows": 1, "stylesheets": ["…/main.css"] },
  "states": { "rest": "gated", "scrolled": "gated", "menu:Products": "gated", "search": "dead",
              "drawer": "gated", "drawer-drilled": "unprobed:auth-gated", "footer-accordion:Company": "gated" },
  "gates": { "1440": "gates/home-1440/chrome-states/chrome-states.json", "360": "gates/home-360/chrome-states/chrome-states.json" } } ] }
```

Each `archetypes[]` entry carries `chromeVariant: <name>`; the tablet pass, the
deploy `nav:`/`footer:` documents and the hand-off cite these names.

## Residual route
Log the cell in the breakpoint's `residuals[]` with `region: "<state name>"`,
the `cause` class (`third-party-in-flow`, `live-data-embed`, `capture-state`,
`authored-volatile-masked` for a carousel under a transparent header — crop the
opaque panel only), the crop and the probe JSON as `artifacts[]`, and
`acceptedBy`. A cell missing on build is never a residual: it is unfinished
authoring.
