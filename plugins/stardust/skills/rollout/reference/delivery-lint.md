# Delivery-contract lint (static pre-deploy gate)

The delivery gates have two halves. **Static** — can this authored HTML even
satisfy the EDS/DA contract — runs *before* PUT, offline, deterministically:
`scripts/delivery-lint.mjs`. **Dynamic** — does the delivered page actually
render — runs *after* preview/live: `scripts/verify.mjs` (§ Typed render-truth).

This file documents the static half: rules the pipeline otherwise re-learns by
shipping a broken page and reading it back, moved from "the agent remembers" to
"the tool enforces".

## Run it

```bash
node skills/rollout/scripts/delivery-lint.mjs --file <content.html> \
  --path </da/target/path> [--type page|fragment|index] [--slug <s>] [--json]
```

`--type` is inferred from the path when omitted (`/nav`, `/footer`, `*/fragments/*`
→ fragment; `*/query-index`, `*.json` → index; else page). Exit `1` on any
**P0 or P1** — wire it as a blocking gate in Phase C before the PUT. P2 and
`note` are advisory (surfaced, never block).

## What it checks

| Rule | Sev | Why it breaks delivery |
|---|---|---|
| `wrapper` | P0 | No `<body>…<main>…</main></body>` → DA silently discards the content. `<header>`/`<footer>` absent → P1. |
| `h1` | P0/P1 | A page needs exactly one `<h1>` (SEO + decoration). 0 → P0; >1 → P1. A fragment must have none. 0 is a `note` when the source capture records no h1 either (`--slug`, else the coverage row matching `--path`; `--current` defaults to `stardust/current`) — content is never edited to satisfy a verifier; `verify.mjs`, `optimize.mjs` (source parity) and `qa-gate.mjs --source-capture` (a WARN) keep the same exception. The capture records VISIBLE headings with text only, so a hidden or image-only source `<h1>` reads as "no h1": judge such a page by eye before relying on the note. |
| `one-cta-per-p` | P1 | `decorateButtons` only buttonizes a link that is the **sole** content of its `<p>`. Two emphasized links in one paragraph ship as unstyled text. Split each CTA into its own `<p>`. |
| `about-error` | P0 | `about:error` in the source means a broken image rendition already shipped. |
| `img-path` | P0 | A `/img/...` src 404s at delivery. |
| `cross-origin-optimize` | P2 | An external `<img>` inside a block that runs `createOptimizedPicture` (cards/columns/hero; `--optimizing-blocks a,b,c` overrides) may be corrupted (dropped `?v=`, added `&format=webply`). Advisory — the authoritative resolve is `media-reconcile.mjs`. |
| `trailing-slash` / `html-extension` | P1 | `.html`, or a slash on a leaf, 404s; a folder index lives at `/x/` (`--content` tells them apart; unresolved → P2). |
| `folder-index-slash` | P1 | A folder-index link without its slash: `/x` 404s on a plain EDS site. |
| `path-safety` | P0 | The target DA path must be lowercase, hyphenated, no `_`, no `//`. A double slash makes the PUT 400 while preview/live still 200 — a silent partial. Normalize and record the original → safe mapping in `redirects.tsv`. |
| `metadata` | P2 | No metadata block → thin query-index rows (no description/og:image at import time). |
| `spacer-whitespace` | P2 | A `<p>`/`<h1>`–`<h6>` of only whitespace, `&nbsp;` or `<br>` (or a `<div>` of only `<br>`) is dropped by the content pipeline: model the source's spacer height as spacing CSS (deploy SKILL.md § The ENCODE contract, #112). |

## Where it sits in Phase C

```
author content.html
  → delivery-lint  (static; P0/P1 blocks)         ← THIS FILE
  → media-reconcile (resolve every image; C)       ← reference/media-reconciliation.md
  → PUT → preview → live
  → verify.mjs (typed render-truth; D below)       ← reference/delivery-gates.md
  → flip to deployed/verified
```
