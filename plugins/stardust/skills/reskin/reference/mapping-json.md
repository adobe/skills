# mapping.json — the machine half of the mapping

`stardust/reskin/mapping.json` is the Phase 3 deliverable `stream-render.mjs` reads: every per-section
decision (module, layout, width, tone, heading role, chrome zones) for every page. `mapping.md`
(`mapping-brief.md`) is the human brief that justifies those decisions; the JSON is what renders. Both
are written in Phase 3, and `stream-render.mjs --check` must exit 0 before Phase 4.

Every later per-section decision lives here too. A design change found in a gate, in review or on the
EDS preview is made in `mapping.json` (or in `donor-tokens.json`), re-rendered and re-gated — never only
in the reskin page or only in EDS blocks.

## Shape

```json
{
  "chrome": { "model": "stardust/reskin/content-model/_chrome", "header": ["s01"], "footer": ["s03"],
              "footerTone": "dark", "navAlign": "center" },
  "blocks": { "M1": "hero", "M4": "cards" },
  "pages": {
    "home": { "template": "home",
      "slots": {
        "s01": { "module": "M1", "layout": "media-band", "width": "wide", "tone": "dark" },
        "s02": { "module": "M4", "layout": "cards", "columns": 3, "heading": "h2" },
        "s03": { "module": "M7", "layout": "split", "split": "531px 1fr", "inset": "80px" }
      } } }
}
```

Keys starting with `_` or `$` (`$schema`, `_note`) are annotations: allowed anywhere, never read. Any
other key not listed below is an error for `--check` (the renderer ignores it, so a typo renders silently).

## `chrome` (optional)

| key | type | values / default | effect |
|---|---|---|---|
| `model` | string | directory (project-relative) holding a `content-model.json` | the chrome capture `header` / `footer` read; required when either is set |
| `header` | string[] | chrome-model slot ids | each renders as a header row in `<header data-canon="header">`; a row with a logo and list items (or buttons) is zoned brand / menu / actions: its plain texts ahead of the primary links (site name, motto) join the logo as `.brand-text` and a link with only screen-reader text goes to the utility bar. A zoned row with no primary links of its own takes a logo-less link row's links into its menu when the header is one row (`navAlign` set, or the donor's `layout.navAlign`), else that row stays below and the zoned row's toggle opens it |
| `footer` | string[] | chrome-model slot ids | each renders in `<footer data-canon="footer">`; zoned (brand, titled columns, social row) when its stream has headings and list items. Several slots with one zoned among them are one zoned footer: a leading single-text slot is the footer name, every slot's logos and prose join the brand column (logo ≥ 48px: `footer.logoHeight`, else `header.logoHeight`, else 48px), its links one column. A link whose text names a social network (Facebook, Instagram, X/Twitter, LinkedIn, YouTube, TikTok) is an icon in the social row, its text kept as `.sr-only`; no empty list is printed |
| `footerTone` | string | `dark` \| `light` \| `accent`; default none | paints the footer from the palette |
| `navAlign` | string | `start` \| `center` \| `end`; default the donor's `layout.navAlign`, else `end` | where a zoned header puts its menu |

## `blocks` (optional)

`{ "<module id>": "<eds block name>" }` — the EDS block each donor module becomes on the deployed leg
(`deployed-leg.md` § Recipe). A name is lower-case letters, digits and hyphens. A module with no entry is
the EDS block `donor-modules.md` records for it — `deploy` Step 2
([`../../deploy/SKILL.md` § 2](../../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code)) applied by `scripts/figma/eds-map.mjs`: Q&A → `accordion`, Teaser →
`cards` (variant `teaser`), Button → default content (no block), Chips → `chips` — else its id lower-cased
(`M4` → `m4`). Several modules on one block are its variants; set an entry only to override Step 2's
choice. `canon-from-reskin` records the result per module in `DESIGN.json` `extensions.modules[].eds`. Not
read by the renderer.

## `pages.<slug>`

| key | type | values / default | effect |
|---|---|---|---|
| `template` | string | the archetype slug; default `<slug>` | `main[data-template]` and the provenance `template` |
| `slots` | object | `{ "<slot id>": { … } }`, ids from the page's `content-model.json` `sections[].slot` | per-slot decisions; a model slot with no entry renders as `stack` / `narrow` with no `data-module` |

`stream-render <slug>` refuses a page with no `pages.<slug>` entry (exit 2).

## `pages.<slug>.slots.<id>`

| key | type | values / default | effect |
|---|---|---|---|
| `module` | string | a `donor-modules.md` id (`M4`); omit for `new-module` / `carried-invisible` | `section[data-module]`; the canon bridge lifts one skeleton per module, preflight requires one per mapped module |
| `layout` | string | space-separated `stack` \| `grid-2` \| `media-band` \| `split` \| `cards`; default `stack` | stream order; form fields two-up; first image as a cover behind a panel; first image beside the text; the repeating run as a card grid |
| `width` | string | `narrow` (panel max 550px) \| `wide`; default `narrow` | the panel measure |
| `tone` | string | `dark` \| `light` \| `accent`; default none | panel colours from `palette.darkBand*` / `lightBandBg` / `accent` |
| `columns` | integer > 0 | default 3 when the card count divides by 3, else 2 | `cards` grid width |
| `heading` | string | `display` \| `h2` \| `h3` \| `h4`; default `display` | the type role of the slot's `.heading` (`display` when the donor lacks `type.<role>`) |
| `inset` | string | a length `<n>px` \| `rem` \| `%` | full-width container with that side gutter |
| `split` | string | two tracks, each `<n>px` \| `fr` \| `%` (`531px 1fr`); default `1fr 1fr` | the `split` layout's columns |

The renderer warns and ignores a bad `tone`, `heading`, `inset` or `split`, falls back for `columns`, and
emits an unknown `layout` word as a class with no style; `--check` reports all of them.

## Readers

`stream-render.mjs` (everything above; `blocks` only for `--deploy-map`); `canon-from-reskin.mjs` (`module`, `layout`, `width`, `tone`,
`chrome.header` / `footer`); `reskin-preflight.mjs` (`module`).

## `--check`

```bash
node stardust/scripts/reskin/stream-render.mjs --check [<slug>…] [--mapping <f>] [--model-dir <d>]
```

Reports, one per line on stdout: unknown keys, values outside the enums, malformed `columns` / `inset` /
`split`, slot ids absent from the page's content model (checked when the model exists; a missing model is
a note on stderr), chrome slot ids absent from the chrome model, `header` / `footer` without `model`, and
each requested `<slug>` with no `pages` entry. Nothing is rendered or written. Exit 0 valid, 1 problems,
2 the file is missing.
