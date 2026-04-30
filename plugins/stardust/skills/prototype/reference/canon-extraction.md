# Canon extraction

Canon is the **load-bearing visual record** extracted from approved
prototypes. It captures the chrome HTML, the compound CSS visual
language, the pinned token values, the module canonical renderings,
and the free-text compositional moves that govern every other
template's rendering. Canon is what makes a multi-template site
visually coherent — once the home prototype is approved, its load-
bearing decisions become the law that the article, listing, program,
and form prototypes must respect (or deliberately deviate from with a
logged reason).

This reference is consumed by `$stardust prototype --prep` (which
authors canon on first approval and extends it on subsequent
approvals). Migrate consumes the canon transparently — see
`skills/migrate/SKILL.md` and
`skills/migrate/reference/template-and-module-rendering.md`.

## When canon is written

- **First prototype approval** writes canon. By default the home is
  the canon-author (it's always extracted, the most-trafficked, has
  the densest design surface); pass `--canon-from <slug>` to
  override.
- **Subsequent prototype approvals** extend canon **additively**.
  Novel patterns introduced by article/listing/program prototypes
  are appended to canon; conflicts default to logged-as-deviation
  (see § Conflict resolution).
- **Re-iterating the canon-author prototype** (e.g., user re-runs
  prototype on home and approves a new variant) updates canon and
  triggers stale-flagging on every downstream page that consumed
  the changed canon item per `state-machine.md` § Stale flagging.

## The five extraction steps

### 1. Chrome HTML — files

From the approved prototype's body, lift verbatim:

- The `<header>` element → `stardust/canon/header.html`
- The `<footer>` element → `stardust/canon/footer.html`
- Any global chrome (skip-link, persistent help dock, persistent
  banner) → `stardust/canon/<region>.html`

The extracted HTML is structural: element tags, attributes
(including `data-canon`, `data-section`, `data-module`), inline
class names, and any inline styles present in the prototype.

Other templates inject these files into their proposed and
migrated output verbatim. The injection happens at render time;
the files are never rewritten by consumers.

### 2. Compound CSS — one file

DESIGN.md owns primitive tokens (colors, spacing, type, radii).
Canon owns the **compound CSS** — the named visual language that
consumes those tokens to define `.btn-primary`, `.btn-secondary`,
`.card`, `.link`, form inputs, and any other reusable visual
treatments the approved prototype establishes.

Lift those rules from the prototype's `<style>` block into:

```
stardust/canon/canon.css
```

The file is injected into every migrated page's `<style>` block
alongside `:root`. This is what guarantees a button looks like a
button on every page without DESIGN.md having to specify button
HTML.

**Selection rule.** Lift CSS rules that:

- Are class-based, not element-based (a `.btn-primary` rule, not
  a global `button` rule — global resets stay in DESIGN.md
  baseline).
- Are reusable across templates (the article hero is page-
  specific, not lifted; the button language is universal,
  lifted).
- Reference DESIGN.md tokens via `var(--*)` so the rules cascade
  correctly with the token contract.

LLM judgment determines reusability. A class that appears once
and is unlikely to recur (e.g., `.home-hero-asymmetric-grid`)
stays in the prototype's inline styles. A class that's clearly
the site's button language is lifted.

### 3. Pinned tokens — JSON in DESIGN.json

DESIGN.md tokens may be ranges or have a default-with-corridor
(e.g., `sectionPadding.desktop: "48–64px"`). Canon **pins** them
to the concrete value the approved prototype chose:

```json
"canon": {
  "pinned": {
    "sectionPadding.desktop": "56px",
    "sectionPadding.tablet":  "44px",
    "sectionPadding.mobile":  "32px",
    "densityTier":            "balanced",
    "typeScale":              1.25
  }
}
```

DESIGN.md keeps the corridor; canon names the chosen instance.
Migrate consults `canon.pinned` first, falls back to DESIGN.md
range otherwise.

Token paths to pin: `sectionPadding.{desktop,tablet,mobile}`,
`densityTier`, `typeScale` (chosen modular ratio),
`lineHeights.{display,body,small}`, and any other token DESIGN.md
declared as a range or corridor.

### 4. Module canonical renderings — files per module

For each module instance found in the approved prototype, lift its
HTML structure:

```
stardust/canon/modules/
  <module-id>.html
```

The HTML carries the module's canonical structure — slot
placeholders (`data-slot="..."`) for content-injection, treatment
for visual-only elements, container structure. Migrate forks this
file when rendering a module instance and injects the page's slot
values into the placeholders.

`DESIGN.json.extensions.modules[].canonicalRendering` becomes a
`{ path, sha }` reference:

```json
{
  "id": "hotline-211",
  "slots": [...],
  "canonicalRendering": {
    "path": "stardust/canon/modules/hotline-211.html",
    "sha":  "..."
  }
}
```

### 5. Compositional moves — free text

The load-bearing **non-token, non-CSS** decisions that govern how
a page composes itself. They can't be extracted by structure-
matching; the LLM authors them by reasoning about which decisions
in the approved variant are *system-level* (affecting all pages)
vs. *page-specific* (only the home).

```json
"canon": {
  "compositionalMoves": [
    "12-column asymmetric grid with left-edge centennial spine is the layout system",
    "Full-bleed photography moments allowed once per page, never twice",
    "Section markers use flat-banner monumental treatment, not subtle dividers",
    "Hero docks the 211 panel right of headline, above the fold"
  ]
}
```

Other prototypes consume these as **guidance, not strict rules**.
The LLM reading them during another template's render decides
how they apply (or don't) for that page type.

**Authoring rule.** 3–7 moves per canon. Each move:

- Is one sentence describing a system-level decision.
- Names the affordance, not the value (good: "section markers
  use flat-banner monumental treatment"; bad: "section markers
  are 56px tall in #DC323D").
- Is consumable by another LLM as soft guidance — a human
  reading it should also understand the intent.

Token-pinnable values do **not** appear here — those go in
`pinned`. Compositional moves are for decisions that have no
representation in the token system.

## File structure (full)

```
stardust/canon/
├── header.html               # canonical header chrome
├── footer.html               # canonical footer chrome
├── canon.css                 # compound CSS (button/card/link/form language)
└── modules/
    └── <module-id>.html      # canonical rendering per brand module
```

`DESIGN.json.extensions.canon` shape:

```json
{
  "sourceSlug":  "home",
  "approvedAt":  "2026-04-28T16:40:00Z",
  "files": {
    "header": { "path": "stardust/canon/header.html", "sha": "..." },
    "footer": { "path": "stardust/canon/footer.html", "sha": "..." },
    "css":    { "path": "stardust/canon/canon.css",   "sha": "..." }
  },
  "pinned": {
    "sectionPadding.desktop": "56px",
    "...": "..."
  },
  "compositionalMoves": ["..."],
  "history": [
    { "at": "2026-04-28T16:40:00Z", "from": "home", "kind": "first-approval" },
    { "at": "2026-05-02T10:15:00Z", "from": "news/post-housing-summit", "kind": "extension", "added": ["module:byline-lockup"] }
  ]
}
```

Per-module entries reference their canonical rendering separately
under `DESIGN.json.extensions.modules[i].canonicalRendering`.

## Conflict resolution on subsequent approvals

When `prototype --prep` approves a non-canon-author template
(article, listing, etc.), canon-extraction runs in **diff mode**:

1. Compute the new prototype's load-bearing items (chrome,
   compound CSS classes, pinned tokens, modules, compositional
   moves) — the same five categories.
2. Compare against existing canon:
   - **Net-new items** → add to canon additively. Append a
     history entry naming what was added.
   - **Match canon byte-for-byte** → no-op.
   - **Items that conflict with canon** → default behavior is
     **log as deviation**.

### Default: log as deviation

When a non-canon-author template's chrome differs from canon, or
its compound CSS differs, or its pinned tokens differ:

- The migrated/prototyped page carries the deviation inline,
  marked with `data-deviation="<reason>"` on the affected
  elements (per `data-attributes.md` § Canon and deviation
  markers).
- The page's `migrationDecisions[]` records a `canon-deviation`
  entry with `where`, `what`, `reason`.
- Canon stays unchanged — the article doesn't promote its
  variation back into canon.
- The user audits via the prep summary and migration run
  summary; they can decide to either accept the deviation as a
  template-specific affordance or re-iterate the prototype to
  match canon.

This default keeps the system additive and judgment-friendly.
Conflicts surface; they don't block.

### Opt-in alternatives

The user can override the default per-conflict during the prep
summary:

- **Accept new (promote to canon).** The new prototype's version
  becomes canon; downstream pages get stale-flagged per
  `state-machine.md` § Stale flagging. Useful when the home
  approval was rough and the article's choice is what the brand
  actually wants.
- **Reject (re-iterate prototype).** Refuse the approval; user
  iterates via `$impeccable live` until the prototype matches
  canon. Useful when the deviation is a mistake.

Both are explicit user gestures during prep summary. Without an
override, conflict is logged as deviation and approval proceeds.

## Provenance

Each canon file carries an HTML/CSS comment provenance block as
its first content:

```html
<!-- stardust:canon
  writtenBy:        stardust:prototype --prep
  writtenAt:        2026-04-28T16:40:00Z
  sourceSlug:       home
  sourcePrototype:  stardust/prototypes/home-proposed.html
  region:           header                       # or footer, css, module:hotline-211
  stardustVersion:  0.2.0
-->
```

DESIGN.json's `extensions.canon` carries the consolidated record
(sourceSlug, approvedAt, file references with paths + shas, pinned
tokens, compositional moves, history). The history array gains an
entry on every canon write or extension so the lineage stays
auditable.

## What canon never does

- **Re-style chrome.** Canon HTML is preserved verbatim. Chrome
  changes require re-iterating the canon-author prototype; the
  re-approval cascades stale-flags.
- **Override DESIGN.md tokens.** Canon pins choices within ranges
  DESIGN.md declares; it cannot violate the token contract.
- **Hold per-page content.** Canon is structural and visual;
  page-specific content (headlines, copy, imagery) lives in
  `current/pages/<slug>.json` and is injected at render time.

## References

- `skills/stardust/reference/state-machine.md` — page lifecycle
  and stale-flagging cascade for canon updates.
- `skills/stardust/reference/data-attributes.md` — `data-canon`
  and `data-deviation` markers.
- `skills/stardust/reference/artifact-map.md` — file structure
  and DESIGN.json shape.
- `skills/migrate/reference/template-and-module-rendering.md` —
  how migrate consumes canon at render time (Path A′).
