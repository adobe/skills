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
  --path </da/target/path> [--type page|fragment|index] [--json]
```

`--type` is inferred from the path when omitted (`/nav`, `/footer`, `*/fragments/*`
→ fragment; `*/query-index`, `*.json` → index; else page). Exit `1` on any
**P0 or P1** — wire it as a blocking gate in Phase C before the PUT. P2 is
advisory (surfaced, never blocks).

## What it checks

| Rule | Sev | Why it breaks delivery |
|---|---|---|
| `wrapper` | P0 | No `<body>…<main>…</main></body>` → DA silently discards the content. `<header>`/`<footer>` absent → P1. |
| `h1` | P0/P1 | A page needs exactly one `<h1>` (SEO + decoration). 0 → P0; >1 → P1. A fragment must have none. |
| `one-cta-per-p` | P1 | `decorateButtons` only buttonizes a link that is the **sole** content of its `<p>`. Two emphasized links in one paragraph ship as unstyled text — invisible on light grounds, glaring on a photo hero. Split each CTA into its own `<p>`. |
| `about-error` | P0 | `about:error` in the source means a broken image rendition already shipped. |
| `img-path` | P0 | A `/img/...` src 404s at delivery. |
| `cross-origin-optimize` | P2 | An external `<img>` inside a block that runs `createOptimizedPicture` (cards/columns/hero) may be corrupted (dropped `?v=`, added `&format=webply`). Advisory — the authoritative resolve is `media-reconcile.mjs`. |
| `trailing-slash` / `html-extension` | P1 | Internal links with a trailing slash or `.html` 404 on EDS (it serves extensionless, no-trailing-slash). |
| `path-safety` | P0 | The target DA path must be lowercase, hyphenated, no `_`, no `//`. A double slash makes the PUT 400 while preview/live still 200 — a silent partial. Normalize and record the original → safe mapping in `redirects.tsv`. |
| `metadata` | P2 | No metadata block → thin query-index rows (no description/og:image at import time). |

`--optimizing-blocks a,b,c` overrides the block list for the cross-origin check
(default `cards,columns,hero`) when a project's block set differs.

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
