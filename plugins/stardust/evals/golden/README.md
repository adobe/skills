# Golden pipeline snapshots

`run.mjs` drives the deterministic script chain on the fixtures under `fixtures/` and writes a
byte-stable snapshot; `expected/` is that snapshot, committed; `golden.test.mjs` runs `run.mjs` into a
temp dir and asserts byte identity with `expected/` (same file list, same bytes — the first differing
file is shown as a unified diff). Offline: no browser, no network, no `node_modules`; well under a minute.

```
node plugins/stardust/evals/golden/golden.test.mjs            # the check
node plugins/stardust/evals/golden/run.mjs --out /tmp/golden  # a snapshot to look at
```

## Covered

| chain | scripts | fixture |
|---|---|---|
| migrate | `migrate/migrate.mjs render --all` | `fixtures/migrate/`: a three-page project of a developer-tools vendor — a landing archetype (hero + cards modules, a bundled image, a broken internal link, a `data-module="nav"` mount standing for the chrome fragment the rollout ledger lists under `fragments`), a docs index with one widget mount (`a[data-widget]` → `/widgets/search/site-search.html?q=docs`) and its own JSON-LD, and a directed sibling rendered as A' of the docs archetype; `stardust/canon/{canon.css,header.html,footer.html}` for the canon shas |
| rollout | `rollout/inventory.mjs → blocks.mjs → plan.mjs`, then `delivery-lint.mjs --json` on every migrated page | the migrate output above (coverage, ledger, plan, one lint document per served path) |
| dynamics | `dynamics/dynamics-plan.mjs` | `fixtures/dynamics/findings.json`: a tag manager, a site search, a form-less control group, a locator API, an authored form, a listing, a modal, a decided-out account row — every `target` value |
| spec | `spec/spec-knowledge.mjs` | `fixtures/spec/`: a saved S1–S9 work tree (inventory, fetch, links, parse, map, chrome) plus the judgement files; the catalog has `block`, `global` and `widget` kinds |

Left out, deliberately: the spec crawl/parse stages (`spec-inventory`, `spec-fetch`, `spec-links`:
network), `dynamics-detect` and the deploy/verify half of rollout (Playwright or a live target). The
field replay (plan § Phase 0 step 4) covers those on real captures, locally.

## Normalisations

The scripts stamp wall-clock times and one absolute path with no flag to fix them, so `run.mjs`
rewrites, in every text file of the snapshot:

1. every ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`) → the `--now` value
   (`migratedAt`, `writtenAt`, `generatedAt`, the `lastRun` stamp, `built_at`, the HTML provenance comments);
2. the scratch directory's absolute path → `<work>`, the plugin root's → `<plugin>`;
3. `"stardustVersion": "…"` in JSON → `"stardustVersion": "<plugin-version>"` (rollout reads the plugin
   version from `plugin.json`; a release bump is not a behaviour change). `migrate` has a
   `--stardust-version` flag, so its stamp is fixed to `golden` without rewriting.

Nothing else is touched: a new key, a reordered array or a changed count fails the test.

## Re-baselining

```
node plugins/stardust/evals/golden/run.mjs --out plugins/stardust/evals/golden/expected
```

A re-baseline is a deliberate commit of its own: its message says which output changed and why
(the diff of `expected/` is the evidence). Never re-baseline to make a red test green inside an
unrelated change — a difference the commit did not intend is a regression, not a new baseline.
Fixtures carry role names only, never a site name (`evals/lint/site-names.mjs`).
