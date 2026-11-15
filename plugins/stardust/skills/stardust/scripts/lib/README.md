# Shared script library

One copy of every rule more than one stardust skill's scripts apply: EDS paths, names and the widget contract, kinds,
the dynamics taxonomy, and the resolver that finds a sibling skill's script in either layout. Pure ESM, no I/O at import.
Consumers import it through `../contracts.mjs`, which re-exports every file here.
Each file's header says what it owns and which consumers it replaced; the characterization test
(`../test/contracts-characterize.test.mjs`) pins every variant's output and the golden chain (`evals/golden/`) pins the
pipeline's bytes, so a change here is visible before it ships.

| file | owns |
|---|---|
| `paths.mjs` | the canonical delivered-path contract (`deliveredUrl`, `daPath`, `pathKey`, formerly `deploy/scripts/eds-path.mjs`) plus one named variant per consumer whose output differs (`treePath`, `rosterPath`, `pathSlug`, `sidecarName`, `sitemapKey`, `servedPath`, `safePath`, `documentPath`, `listingKey`/`listingUrl`, `chromeHrefKey`, `redirectKey`, `urlForm`) |
| `names.mjs` | `RESERVED`, `edsName`, `reservedStem`; the widget contract `widgetStem`, `widgetHref`, `widgetCodePath`, `pageWidgets`, `widgetLinks(html, { mount, base, dedupeBy })` |
| `kinds.mjs` | `CODED`, `CHROME_IDS`, `kindOf`, `isChromeName`, `QA_CHROME_PATHS`, `documentKind`, `META_BLOCKS`/`KEY_VALUE_BLOCKS`, `DEFAULT_CONTENT`, the kind enums (`SPEC_MAP_KINDS`, `SPEC_CATALOG_KINDS`, `ROLLOUT_KINDS`, `DYNAMICS_TARGETS`), `AI_EXCLUDE_DEFAULT` |
| `taxonomy.mjs` | dynamics `TAXONOMY` and the single `CLASS_NAMES` |
| `resolve.mjs` | `layout`, `siblingCandidates`, `sibling`/`siblingPath`/`loadSibling` |

Centralise first, converge later: a variant keeps its consumer's current output until a deliberate commit removes its
`KNOWN_DIVERGENCE` rows from the characterization test and says why.

## Layout

The library ships the way `browser.mjs` does (0.38.0): Setup step 7 (`../../SKILL.md`) copies the master's whole
`scripts/` dir, `lib/` and `contracts.mjs` included, to `stardust/scripts/stardust/` before any other skill's script
runs; every other skill's scripts sit at `stardust/scripts/<skill>/`.

```
plugin tree                                       project copy
plugins/stardust/skills/stardust/scripts/         stardust/scripts/stardust/        browser.mjs, contracts.mjs, lib/
plugins/stardust/skills/<skill>/scripts/*.mjs     stardust/scripts/<skill>/*.mjs
```

A consumer looks for `contracts.mjs` in both layouts with the same candidate list it uses for `browser.mjs`:

```js
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const { pathKey, widgetStem } = await import(CONTRACTS.href);
```

- **Resolve once per skill** where the skill has a `lib.mjs` (dynamics, qa, rollout, spec): it does the lookup and
  re-exports what its scripts use, so they keep importing from `./lib.mjs`. Other consumers (deploy, diff, migrate,
  replica) carry the lookup themselves, as they do for `browser.mjs`.
- **Missing**, the lookup names the fix — copy the master skill's scripts dir to `stardust/scripts/stardust/` — the same
  sentence a missing `browser.mjs` prints. A project set up before this release has a master copy without `lib/`:
  re-copy it.
- **Sibling skills' own scripts** (deploy's `ai-readability.mjs`, the rollout lint, the diff probes) are not in `lib/`;
  reach them with `loadSibling(skill, file)` / `siblingPath(skill, file)` from `contracts.mjs`. `resolve.mjs` knows its
  layout from its own location, so the consumer carries no candidate list.
- **Layout check**: `node skills/stardust/scripts/test/layout.test.mjs` copies every skill into a temp project the way
  the copy steps do and runs each script's `--help` (or imports it when it is a library), so a broken cross-skill path
  fails there, not in the field.
- The old entry points keep working for in-flight project copies: `deploy/scripts/eds-path.mjs` re-exports
  `paths.mjs`, `spec/scripts/lib.mjs loadSibling` re-exports `resolve.mjs`'s.
