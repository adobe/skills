# Eval: rollout Phase D3 — the locale-tree wave runs on a manifest

Pins `skills/rollout/reference/multilingual.md`: D3 starts from
`stardust/trees.json`, twins carry `lang` + `alternate-*` metadata rows, chrome
is authored per locale from the locale's own probe, the runtime hook is the
documented two lines, twins of a passed archetype gate 360 before 1440, a
supplement run leaves the default-language brand surface untouched, and no
tree path is wired into project code.

## Setup

`fixture/` is the shared post-migrate project (`evals/_shared/fixture-post-migrate/`,
see its README — a fictional regional insurer on a `.example` origin; nothing
is reachable) plus a Spanish twin subtree captured by a supplement run:

- `stardust/current/pages/{home,business}.json|html` — the default-language
  archetype and sibling records, each carrying `lang: "en"` and `hreflang`
  alternates pointing at `/es/` and `/es/negocios/`.
- `stardust/current/pages/{es,es__negocios}.json|html` — the two twins,
  `lang: "es"`, `discovery.source: "hreflang"`, alternates back to the English
  pages; `state.json` lists them as `extracted` with `twin` naming their
  English page.
- `stardust/current/trees/es/chrome.json` — the Spanish chrome hover probe:
  primary links, hover children, switcher label, footer legal line and a
  `strings` table where `form-confirmation` is `null` (no lift path).
- `stardust/current/_brand-extraction.json` — the default-language Phase 3
  surface, byte-identical before and after the run by contract.
- `stardust/replica/progress.json` — `landing` (archetype `home`) passes at
  1440 and 360; the twins are landing pages.
- No `stardust/trees.json` yet. No EDS project checkout; the agent stages
  content under `content/` and project edits under `stardust/.work/` or a
  clearly named staging path, and says so.

The run is hands-off (`state.json.handsOff` is not set; the prompt says it):
no questions, owner items recorded by name.

## User prompt

"$stardust rollout --hands-off — run Phase D3 for the Spanish tree only; the
English pages are already delivered."

## Expected behavior

1. **The manifest comes first.** Before any twin is authored or any
   per-language document is staged, `stardust/trees.json` exists in the
   shape `multilingual.md` § Manifest precondition documents: `default`,
   `decisions.locale`, one entry per tree with `lang`, `root`, `twinRoot`,
   `source`, `nav`/`footer`/`search`/`contact`, `chromeSource`, and a
   `strings` table whose every entry is lifted (`lifted: true`, value from
   the probe) or `owner: true` — `form-confirmation` is OWNER, never
   translated by the agent.
2. **Twins mirror their archetype.** `/es/` and `/es/negocios/` are authored
   as the `landing` archetype's composition with the captured Spanish
   content — no new blocks, no invented copy.
3. **Metadata rows.** Every staged page (twins and, when touched, the English
   pages) carries a `lang` row; twins carry `alternate-en` and `alternate-es`
   rows with the captured hrefs.
4. **Chrome per locale.** `/es/nav` and `/es/footer` documents exist, built
   from `trees/es/chrome.json` (labels verbatim, switcher targets `/` and
   `/es/`), and the twins reach them through `nav`/`footer` metadata rows or
   the documented path-prefix fallback — not through a hard-coded `/es/` in
   block code.
5. **The runtime hook is the two documented lines.** The only `scripts.js`
   change is inside `buildAutoBlocks(main)`: the `lang` metadata read that sets
   `document.documentElement.lang`, plus the `alternate-*` link builder;
   `decorateMain`/`loadEager` are not touched.
6. **Twin gate order.** The gate plan (or attempt) for `/es/` runs 360 first,
   then 1440, at unchanged bars. The origin is unreachable, so the gate has
   no verdict; the agent reports that as no verdict, never as a pass, and
   never publishes (hands-off stays preview-only).
7. **Write-once supplement.** `stardust/current/_brand-extraction.json` is
   byte-identical to the fixture at the end; locale evidence stays under
   `stardust/current/trees/es/`.
8. **No literal tree paths** (`/es/`, `/en/`) in any staged block JS/CSS or
   `scripts.js`; per-language indexes and the `helix-sitemap.yaml` `languages`
   entries are the only places a locale root appears in config.
