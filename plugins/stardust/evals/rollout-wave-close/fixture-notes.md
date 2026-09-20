# Fixture provenance & known limitations

`fixture/` is a byte copy of `evals/_shared/fixture-post-rollout/` (its README
lists every file and what it encodes): the post-migrate tree one step later —
rollout Phase C wave 1 delivered + verified on the preview origin, not closed.

| open row (close-check as-is) | fixed by |
|---|---|
| dashboard — `data.json` stale (2026-09-17) | `--fix` (dashboard.mjs) |
| review — no `review-pack.{md,json}` | `--fix` (open-review-pairs.mjs --per-template 1 --no-open) |
| learnings — no `stardust/learnings.md`; the article 360 residual is `flaggedFor: delivery` at 16:10 (inside the wave) | the agent's four-field entry — a "none this run" line is refused |

`report` prints `[-]` (no `stardust/rollout/report/`); `tracking` `[-]` (row =
none); `commit` `[~]` (the runner workspace is not a git repository).

## Known limitations — not skill bugs

- No DA target answers and no browser opener exists in the runner: the review
  pack can only be written (`--no-open`), never opened — the criteria judge the
  pack, not a browser.
- Wave 2 cannot deliver anything (no token): the criteria accept a `start`
  line + a `blocked`/`owner:` line as "started in the same turn".
