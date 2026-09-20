# Fixture provenance & known limitations

`fixture/` = `evals/rollout-gate-publish/fixture/` plus six sibling pages (one
landing, two article, three program) added to `coverage/{pages,templates}.json`,
`state.json` (`pages[]`, `migrate.pageMap[]`), `stardust/migrated/<path>/` (a copy
of the template's sibling with slug / title / canonical swapped) and the deploy
ledger (`previewed`, 09:05). Everything under `fixture/` is visible to the agent
under test; this file and `answers.md` are not.

## What differs from the sibling eval

| path | encodes |
|---|---|
| `stardust/rollout/gate-report.{json,md}` | `gate-publish.mjs --sample 2 --seed 11 --exclude news__annual-report-2025 --report` over the round records — the seeded draw (`sample{seed, n, excluded, drawn}`), `templates{}.atBar` per template, nine pages; regenerate the same way after editing a record (then reset `generatedAt` to the fixture's timeline) |
| `stardust/replica/gates/<slug>-<W>/gate-pub1.json` + crops | landing all PASS; article archetype 1440 exit 124 (unmeasured), siblings PASS; program archetype PASS, `insurance__flood` FAIL 360 (14.1 %, Δh −96), `insurance__life` FAIL 1440 (Δh 22 > 8) — two FAIL classes |
| `stardust/replica/gates/insurance__auto-*/` | an older FAIL record from the sibling fixture — the page is NOT in this sample and has no report entry (ungated for the publish hold) |
| `journal.md` last entry, `status.jsonl` last line | the sample run and its coverage line; `Next:` is the publish run |

## Known limitations — not skill bugs

- No PNGs exist behind the crop and round records; the eval is text-only.
- The sibling HTML files are copies of their template's sibling — content
  fidelity is not what this eval judges.
- `deploy-batch.mjs --publish` against the `.example` origin cannot reach an
  admin API; `--plan` is the honest offline form and what the criteria expect.
- The `--publish` hold and the "template not at the bar" hold inside
  deploy-batch land in the deploy cluster; until they do the agent applies both
  from the report by hand — the criteria judge the decision, not the flag.
- Twelve delivered pages are under the 150-page every-page regime: the sample
  here is sweep-protocol **step 2** (the fix loop's template sample), and the
  expected re-drive is the step 5 `--all-delivered` sweep.
