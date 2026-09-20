# Fixture provenance & known limitations

`fixture/stardust/` is the shared post-migrate replica tree
(`evals/_shared/fixture-post-migrate/`, copied at commit `34fdad3`) with four
defect classes seeded on top by `seed-defects.mjs` (sibling of this file;
usage in its header). This file, `answers.md` and `seed-defects.mjs` live
outside `fixture/` on purpose — everything under `fixture/` is visible to
the agent under test.

## Where each shape came from

The shared tree's shapes and their reference sources are documented in
`evals/_shared/fixture-post-migrate/README.md`; nothing there was changed
except the six `index.html` files listed below. Copied before the shared tree
gained `usage.json` / `usage.md` (T13.4), `current/pages/business.html` and
the `chrome.variants[]` / `archetypes[].chromeVariant` rows in
`replica/progress.json` (T18.1) — absent here; `verify.mjs` reads none of them.

## Seeded defects (the answer key)

| edit | files | `verify.mjs --root` reason |
|---|---|---|
| D1 — footer link `href="/claims/"` (root-relative, section not in the migrated set) | all six pages | `broken internal links: /claims` |
| D2 — primary-nav link `href="/members/login/"` | `insurance/home`, `insurance/auto` | second target on the same line |
| D3 — section `<h2>` promoted to a second `<h1>` | `news/annual-report-2025` | `page should render exactly one <h1>, found 2` |
| D4 — `<img src="about:error">` | `business` | `about:error in body (#75 broken image)` |

Dry run on 0.23.0 (`inventory.mjs`, then `verify.mjs --root stardust/migrated --all`):

```
Checked 6 · 0 verified · 6 failed · types: page:6
  ✗ business (page): about:error in body (#75 broken image)
  ✗ home (page): broken internal links: /claims
  ✗ insurance__auto (page): broken internal links: /members/login, /claims
  ✗ insurance__home (page): broken internal links: /members/login, /claims
  ✗ news__annual-report-2025 (page): page should render exactly one <h1>, found 2
  ✗ news__storm-season-checklist (page): broken internal links: /claims
```

## Deliberate design choices

- **Root-relative links, not relative ones.** The shared tree's links are
  relative and resolve inside the bundle; `verify.mjs` only checks
  `href="/…"`. Root-relative targets are what a migrated tree gains when a
  footer is lifted from the live site, and exactly what the sidecar counter
  missed — so the `_meta.json` `brokenInternalLinks: 0` values and the HTML
  provenance comments are left as they were. The agent should trust the
  runner over the sidecar; a report that repeats "0 broken links" from the
  sidecar is wrong.
- **First-reason-wins masking.** `verify.mjs` records one reason per page:
  `about:error` before `<h1>` before links. `/claims/` is present on six
  pages but surfaces on four. A class count of 4 (from the runner) or 6
  (from reading the HTML or a fuller summary) are both defensible; the
  criterion asks that the conversation's counts match `summary.json`, not a
  fixed number.
- **No `stardust/rollout/` in the fixture.** Inventory never ran in the
  story (rollout was blocked at Setup), so Phase A is part of the run.
- **No hands-off flag.** The contract under test is a report contract, not
  a waiting rule; an interactive session with the `answers.md` persona keeps
  the run honest about what the skill text says today.

## Known limitations — don't mistake these for skill bugs

- `verify.mjs --root --all` flips `pending` pages to `verified` / `failed`
  in `coverage/pages.json` although nothing was deployed — a runner quirk
  of offline mode, not something the agent should "fix".
- `stardust/current/`, the root `PRODUCT.md` / `DESIGN.md` / `DESIGN.json`,
  `stardust/prototypes/` and `stardust/replica/gates/` are absent (see the
  shared README § Known limitations); `rollout` Phase E does not read them.
- Every sha in the tree is fabricated; `inventory.mjs` computes its own
  `sourceHash` from the files, so nothing depends on them.
- The seeded `about:error` sits in an `<img src>`; a browser would show a
  broken image, but the fixture is never rendered — the eval is text-only.
