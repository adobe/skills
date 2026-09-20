# Fixture provenance & known limitations

`fixture/stardust/` is a `cp -R` of the shared post-migrate fixture
(`evals/_shared/fixture-post-migrate/stardust/`, see its README — never
symlinked, never copied with the README) plus a Spanish twin subtree captured
by an extract supplement run. Everything under `fixture/` is visible to the
agent under test; this note is not. There is no `answers.md`: the task runs
hands-off.

## What this eval adds on top of the shared tree

- `stardust/current/pages/{home,business}.{json,html}` — the default-language
  archetype and sibling records (`lang: "en"`, `alternates[]` with `hreflang`
  `en`/`es` hrefs pointing at `/es/` and `/es/negocios/`); the shared tree's
  `current/` holds only `pages/business.html`, so these are new files, not edits.
- `stardust/current/pages/{es,es__negocios}.{json,html}` — the two twins
  (`lang: "es"`, `discovery.source: "hreflang"`, alternates back to the
  English pages, `renderedHtml` with the captured Spanish copy).
- `stardust/current/trees/es/chrome.json` — the Spanish chrome hover probe:
  `header` (primary links, hover children, switcher label), `footer` (legal
  line) and `strings` (`menu`, `search`, `close` lifted; `form-confirmation`
  `null` — no lift path, an OWNER item).
- `stardust/current/_brand-extraction.json` — the default-language Phase 3
  surface (`_provenance.writtenBy: stardust:extract`, 0.22.2); the file the
  supplement run must leave byte-identical.
- `stardust/state.json` — `pages[]` gains `es` and `es__negocios`
  (`status: extracted`, `lang: es`, `twin` naming `home` / `business`);
  `handsOff` is not set — the prompt's `--hands-off` activates the mode
  (`stardust/SKILL.md` § Hands-off).
- `stardust/status.jsonl` — one appended `stardust:extract` line: the
  supplement run (`2 /es/ twins captured via hreflang (--pages); brand
  surface not re-aggregated`).

`stardust/replica/progress.json` is the shared ledger: `landing` (`home`)
passes at 1440 and 360, so the twins are twins of a passed archetype. No
`stardust/trees.json`, no `stardust/rollout/`, no EDS checkout.

## What the fixture deliberately makes true

- `multilingual.md` § Manifest precondition has every input it needs
  (twins typed, chrome probe, strings with one `null`) and no manifest — the
  first correct write is `stardust/trees.json`.
- The `form-confirmation` string can only be resolved by the owner: a
  translated value is fabrication.
- The `.example` origin is unreachable: the twin gate has no verdict.

## Known limitations

- No `trees.schema.json` exists in the plugin; criterion 1 grades the shape
  documented in `multilingual.md` § Manifest precondition.
- Content staging has no EDS checkout to land in; the agent stages under
  `content/` and `stardust/.work/` and says so (task.md § Setup).
- Expected to fail on the 0.24.0-next.3 baseline (no D3 manifest rule): the
  baseline authors twins without `trees.json` and hard-codes `/es/`.
