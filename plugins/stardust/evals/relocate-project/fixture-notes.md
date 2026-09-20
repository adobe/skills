# Fixture provenance & known limitations

`fixture/stardust/` is a copy of `evals/_shared/fixture-post-migrate/stardust/`
(see its README for every part's origin) frozen one step later — rollout wave 1
previewed on a pilot origin — plus the pieces a move touches:

- **`stardust/state.json`** — `site.eds` = `olduser/larkspur` (`bootstrappedBy: existing`,
  `private: false`, hosts on that org), `site.deployUrl` set; provenance bumped to
  0.24.0-next.3. Shape: `state-machine.md` § File: `stardust/state.json`.
- **`stardust/rollout/rollout.json`** — `site.da` and `site.liveHost` on the old org
  (shape from `_shared/fixture-post-rollout`).
- **`fstab.yaml`** — mountpoint `https://content.da.live/olduser/larkspur/`.
- **`content/`** — three body fragments (`index.html`, `business/index.html`,
  `fragments/promo.html`) and the sheet `content/redirects.json`; each carries at
  least one `main--larkspur--olduser` or `content.da.live/olduser/larkspur/` URL —
  the references step 2 must rewrite.
- **`stardust/decisions.md`** — `target` default `ridgeline-agency/sdt-larkspur` (a
  fictional delivery org), `publish` preview, `tracking` owner-decided
  (`https://github.com/olduser/larkspur/issues/1`), `commit` phase-end.
- **`stardust/journal.md`**, **`stardust/status.jsonl`** — one appended wave-1 entry /
  two status lines that NAME the old host. They are history: the eval scores them
  byte-identical after the run.

No `.git`, no `blocks/`, `styles/` or `scripts/` (the move does not touch code
beyond `fstab.yaml`); `stardust/da-copy-ledger.json` absent. `olduser` and
`ridgeline-agency` are fictional; the `.example` source TLD guarantees no live site.

## Keep on the runner host

`DA_TOKEN` present with any value (the scripts resolve it by name; the mock or a
blocked network answers the list call); `GH_PAT`, `CODE_SYNC_INSTALLATION_ID`
absent; permission mode `default` — `gh repo create`, `gh api -X PUT`, `git push`
denied. Outbound writes to `admin.da.live`, `admin.hlx.page` and the two EDS
hosts must be blocked; reads may 404.

## Expected instrument lines (for the judge)

```
node skills/deploy/scripts/da-copy.mjs --from olduser/larkspur --to ridgeline-agency/sdt-larkspur
node skills/deploy/scripts/host-compare.mjs --old https://main--larkspur--olduser.aem.live --new https://main--sdt-larkspur--ridgeline-agency.aem.page --paths <roster>
```

The grep after step 2 (journal.md and status.jsonl excluded) prints nothing.

## Known limitations

- With the target absent, `da-copy.mjs` stops at its list call (exit 2, "list
  failed"); the judge accepts the printed command plus its re-run in the checkpoint.
- `host-compare.mjs` cannot run before the copy; the command and its reading rule
  are what is scored.
- The tracking-issue port is scored on the printed `gh` commands (denied on this runner).
