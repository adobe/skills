# Multilingual (per-language trees) — Phase D3, optional

When the source has language trees (`/fr/…`, `/en/…` beside `/de/…`), add them as
**parallel content trees that REUSE the same block library** — block structure is
language-agnostic; only authored content and a few wiring pieces change. Proven on
a ~90-pages-per-language add (≥5 per template).

- **Author by mirroring the default-language archetype per type, in the target
  language.** A target-language page is the default page's block composition with
  translated content at the localized path (e.g. `/fr/…/<slug>`). Dispatch author
  agents grouped by template-type, each given the default-language reference file to
  mirror — *no new blocks*.

- **Language-route the static header/footer.** A single `loadStaticFragment`
  (`postlcp.js`) serves one fragment for all pages; make it pick by path prefix and
  fall back to the default:
  ```js
  const seg = window.location.pathname.split('/')[1];
  const lang = (seg === 'fr' || seg === 'en') ? `${seg}/` : '';
  let resp = await fetch(`${codeBase}/fragments/${lang}${name}.html`);
  if (!resp.ok && lang) resp = await fetch(`${codeBase}/fragments/${name}.html`);
  ```
  Add `fragments/fr/{header,footer}.html` + `fragments/en/…`: translated labels,
  links localized to *live* same-language pages (else a source bounce), and a
  **language switcher that targets each language's home** — don't try to compute
  per-page cross-language equivalents.

- **Per-language indexes** in `helix-query.yaml`: clone each index with a
  language-scoped `include` glob + a language-prefixed `target`, and **fix the
  selectors that encode language** — a facet selector like
  `a[href*="/specialites-medicales/"]` (FR) / `a[href*="/specialities/"]` (EN) is
  not the default-language `a[href*="/fachgebiete/"]`. Same metadata contract per
  type.

- **Path-safety is per-language too.** The leading/trailing-`-`, `--`, `_`, and
  uppercase normalization (delivery-gates Gate 3) applies to every language tree —
  record slugs in particular recur with a leading hyphen across languages.

- The per-language indexes are empty until the pages are published under the synced
  config — same republish that propagates a `head.html` change (see
  operational-learnings).
