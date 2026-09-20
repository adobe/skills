# Delivery-contract lint (static pre-deploy gate)

The delivery gates have two halves. **Static** — can this authored HTML even
satisfy the EDS/DA contract — runs *before* PUT, offline, deterministically:
`scripts/delivery-lint.mjs`. **Dynamic** — does the delivered page actually
render — runs *after* preview/live: `scripts/verify.mjs` (§ Typed render-truth).

This file documents the static half. It exists because the contract rules below
are deterministic truths the pipeline otherwise re-learns by shipping a broken
page and reading it back — the migration prompt is essentially a long list of
them. Encoding them as a linter moves the knowledge from "the agent remembers"
to "the tool enforces".

## Run it

```bash
node skills/rollout/scripts/delivery-lint.mjs --file <content.html> \
  --path </da/target/path> [--type page|fragment|index] [--icons-dir icons] \
  [--allow-empty <names>] [--allow-no-h1] \
  [--chrome-docs content/nav.html,content/footer.html,… [--content content]] [--json]
```

`--type` is inferred from the path when omitted (`/nav`, `/footer`, `*/fragments/*`
→ fragment; `*/query-index`, `*.json` → index; else page). Exit `1` on any
**P0 or P1** — wire it as a blocking gate in Phase C before the PUT. P2 is
advisory (surfaced, never blocks).

## What it checks

| Rule | Sev | Why it breaks delivery |
|---|---|---|
| `wrapper` | P0 | No `<body>…<main>…</main></body>` → DA silently discards the content. `<header>`/`<footer>` absent → P1. |
| `h1` / `h1-deviation` | P0/P1/P2 | A page needs exactly one `<h1>` (SEO + decoration). 0 → P0; >1 → P1. A fragment must have none. A source with no h1: prefer a visually-hidden default-content `<h1>` from the title; the recorded fallback is `--allow-no-h1` (passed per page) — 0 becomes P2 `h1-deviation` and `--json` carries `deviation` for the coverage row. |
| `one-cta-per-p` | P1 | `decorateButtons` only buttonizes a link that is the **sole** content of its `<p>`. Two emphasized links in one paragraph ship as unstyled text — invisible on light grounds, glaring on a photo hero. Split each CTA into its own `<p>`. Fires only when the paragraph holds nothing but the links — prose with inline links is silent. |
| `about-error` | P0 | `about:error` in the source means a broken image rendition already shipped. |
| `img-path` | P0 | A `/img/...` src 404s at delivery. |
| `cross-origin-optimize` | P2 | An external `<img>` inside a block that runs `createOptimizedPicture` (cards/columns/hero) may be corrupted (dropped `?v=`, added `&format=webply`). Advisory — the authoritative resolve is `media-reconcile.mjs`. |
| `trailing-slash` / `html-extension` | P1 | Internal links with a trailing slash or `.html` 404 on EDS (it serves extensionless, no-trailing-slash). |
| `path-safety` | P0 | `--path` differs from `normalizeDaPath(--path)` (`skills/stardust/scripts/da-path.mjs`, the one rule: per segment percent-decode, fold diacritics, lowercase, non-`[a-z0-9]` runs → `-`, trim edge `-`; the leaf drops `.html|.php|…`; query/fragment dropped). DA accepts the PUT, preview/live 400/404 — a silent partial. The message names the safe target; `deploy-batch.mjs` folds it before the PUT and writes the `redirects.tsv` row (`delivery-gates.md` § Gate 3). A segment that empties (non-Latin script) has no safe form → P0 `transliterate before deploy`. |
| `metadata` | P2 | No metadata block → thin query-index rows (no description/og:image at import time). |
| `description-alt` | P2 | The metadata `description` starts with "Image" or equals an `<img alt>` on the page — an importer wrote alt text into the description; write a real one. |
| `icon-missing` | P0 | `:x:` (or `<span class="icon icon-x">`) with no `icons/x.svg\|png` in the code tree — the runtime fetches `/icons/x.svg` and renders a broken-image box; the asset must exist in the branch before the PUT. Needs `--icons-dir`; silent without it. |
| `icon-prefix` | P0 | `:icon-x:` doubles the prefix the runtime adds (`icons/x.svg` exists, `icon-x.svg` does not) — author `:x:`. Same scan as `deploy`'s `davids-model-lint` ICON-PREFIX / ICON-MISSING. |
| `empty-block` | P2 | A block table with 0 rows inside `<main>` — the encoder's selector missed the source items, silent content loss (mirror of deploy lint D1-EMPTY 🟡; advisory first, B7). `--allow-empty <names>` exempts declared runtime-widget placeholders. |
| `href-scheme` | P1 | A `javascript:` or bare `#` / `#!` href — a dead CTA once `decorateButtons` styles it. |
| `href-whitespace` | P1 | Whitespace inside the href value — the browser trims it locally, delivery 404s. |
| `chrome-variant` | P1 | With `--chrome-docs`, on a site whose nav (or footer) documents dedupe by content hash to more than one variant, a page without an explicit `nav:` / `footer:` metadata row (the `--file` page and every page under `--content`; chrome docs and fragments excluded). Single-variant sites are silent — `../../deploy/reference/chrome.md` § Chrome states and variants. |
| `chrome-variant-count` | P2 | More than three distinct documents of one chrome kind — a vocabulary smell to report (D9/D12). |

`--optimizing-blocks a,b,c` overrides the block list for the cross-origin check
(default `cards,columns,hero`) when a project's block set differs.

The script imports `../../stardust/scripts/da-path.mjs`: a project copy of
`delivery-lint.mjs` must carry that module too — never an inline re-implementation
of the path rule (the per-script copies are how the rule drifted in the field).

## Where it sits in Phase C

```
author content.html
  → delivery-lint  (static; P0/P1 blocks)         ← THIS FILE
  → media-reconcile (resolve every image; C)       ← reference/media-reconciliation.md
  → PUT → preview → live
  → verify.mjs (typed render-truth; D below)       ← reference/delivery-gates.md
  → flip to deployed/verified
```

The static lint catches the cheap, deterministic failures before spending a
network round-trip; the dynamic verify catches what only the renderer knows.
