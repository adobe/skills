# Project move — relocate an EDS project to another org/site

Sub-flow of `deploy`, entered by the master's `relocate <org>/<site>` row or by an ask that names a move
("move this project to …", "rename the site", personal org → customer org). Read:
- § Contract — before the first command: what a move is allowed to touch and what it never touches;
- § Steps — the nine steps, each with its command and pass bar;
- § Transfer alternative, § Failure modes — when the owner asks for a repo transfer, or a step fails.

## Contract

- **One privileged bundle.** Every remote step is a privileged action (`../../stardust/reference/harness-permissions.md`
  § Two classes): repo create, Code Sync install, push to a second site's repo, `POST …/live/`. A `relocate`
  ask IS the owner's instruction for the create/push half, so those run; a denial asks once, prints
  `Blocked on owner:` with the exact command and the run continues on the unblocked work (step 2's rewrite,
  the ledger, the retire list). Publish stays preview-only unless the ask said publish.
- **Preview first, parity on `.aem.page`, live is its own run (D1, D16).** The copy previews; parity is checked
  against the OLD LIVE tree (the truth), on the new preview host; `--publish` is a separate explicit run on PASS.
- **Old surfaces are never deleted or edited.** The old repo, site config, DA folder and Code Sync registration
  stay as they are until the owner acts on the retire list; a rollback is "keep using the old host".
- **Not a gate.** No fidelity number is re-judged here; the pass bar is byte parity after host normalisation
  with one benign class (`media-only` — upstream re-encode). The published-origin gate re-runs on the new host
  through its own skill (`../../rollout/reference/publish-gate.md`), not here.
- **Never**: `git push --force`, a repo transfer as the default, an edit to `scripts/aem.js`, a new secret
  in `.env` (the target reuses `DA_TOKEN`; a locked target gets its own `SITE_TOKEN_<SLUG>` from step 7),
  a request to the customer site (the move touches the two EDS origins and DA only).

## Inputs

`<old org>/<old site>` from `stardust/state.json.site.eds` (or `fstab.yaml`); `<new org>/<new site>` from the ask
or the `target` default (`../../stardust/reference/decisions.md` § Default rows, `<org>/sdt-<slug>`);
`DA_TOKEN` (reads the source, writes the target — one token, by name); the target org's Code Sync installation
id `CODE_SYNC_INSTALLATION_ID` (per account, never the old org's); the page roster (`stardust/rollout/rollout.json`
inventory, or `content/**`). The read side of the Source API this flow adds: `GET admin.da.live/list/<org>/<site>/<dir>`
(one folder level; the script recurses) and `GET admin.da.live/source/<path>`; sheets round-trip as `application/json`.

## Steps

| # | step | command | pass bar |
|---|---|---|---|
| 1 | Target | `reference/site-bootstrap.md` § The six steps with the new coordinates (repo from the boilerplate template, private; Code Sync on the target org's installation; `fstab.yaml` → the new DA folder) | `preflight-transports.mjs --org <new> --repo <new-site>` reports the repo present; served `/scripts/aem.js` after the capped wait |
| 2 | Rewrite | replace every CURRENT reference — `fstab.yaml`, `content/**`, `redirects` / `metadata` sheets, converters and importers, `stardust/state.json.site.eds` (+ `movedFrom`), `stardust/rollout/rollout.json` `site.liveHost`, `stardust/scripts/**`, ledgers; historical journal and status lines stay; add one journal entry; commit BEFORE step 3 | `grep -rn -E "main--<old>--<org>\|<org>/<old>\|content.da.live/<org>/<old>/" --exclude-dir=.git --exclude=journal.md --exclude=status.jsonl .` prints nothing |
| 3 | Push | `git remote set-url origin <new repo>`; `git fetch origin`; `git merge -s ours --allow-unrelated-histories origin/main` ONLY if the target has commits (the boilerplate's); `git push origin main`; `node skills/deploy/scripts/served-check.mjs https://main--<new>--<org>.aem.page/blocks/<one>/<one>.css --grep <marker> --wait 180` | served-check exit 0 (the new host serves the moved code); never `--force` |
| 4 | Copy | `node skills/deploy/scripts/da-copy.mjs --from <org>/<old> --to <org>/<new>` (media → html → sheets; host rewrite inside documents; preview only; own ledger `stardust/da-copy-ledger.json`) | `SUMMARY … failed=0 exit=0`; a `failed` row is re-run by the same command (resumable) |
| 5 | Parity | `node skills/deploy/scripts/host-compare.mjs --old https://main--<old>--<org>.aem.live --new https://main--<new>--<org>.aem.page --paths <roster> --sitemap [--render --paths <archetypes>]` | `differs=0 missing=0`; `media-only` rows listed as benign; `stale-on-old` rows go to the retire list; exit 124 = re-run, not a failure |
| 6 | Publish | on step 5 PASS and (gate PASS or the ask said publish): `node skills/deploy/scripts/da-copy.mjs --from <org>/<old> --to <org>/<new> --publish`; then the published-origin gate through its own skill on the new live host | `SUMMARY … live=<docs> exit=0`; gate table copied, never re-judged |
| 7 | Lockdown | `node skills/deploy/scripts/lockdown.mjs --org <org> --repo <new-site>` (`reference/site-lockdown.md`) | exit 0, or `blocked` + `owner:` |
| 8 | Tracking | port the tracking issue per the `tracking` row (`../../stardust/reference/handoff-report.md` § Tracking issue): new issue on the new repo with the status comment, a pointer comment on the old issue | both URLs in the journal entry |
| 9 | Close | checkpoint block + **retire list** (`../../stardust/reference/run-status.md` § Phase close): old repo, old site config, old DA folder (file count from the ledger), old Code Sync registration, stale-on-old paths — named, never executed here | `end` line carries `next`; nothing deleted |

Order matters twice: the `fstab.yaml` rewrite is committed BEFORE the `-s ours` merge (or the merge discards
it with the rest of the target tree), and the copy (4) runs after the push (3) so previews render with the
moved code. `deploy-batch.mjs` cannot replace step 4: it re-drives pages from the local `content/` tree only —
sheets, media and DA-only documents move with `da-copy.mjs`. D13: the query index rebuilds on publish of the
new site — state it in the close, the flow does not fix it.

## Ledgers and state

`stardust/da-copy-ledger.json` (`{ from, to, rows: { "<path>": { status: copied | previewed | live | failed,
attempts, ts, lastError } } }`) is the copy's own — `content/.deploy-ledger.json` is never written by a move.
`state.json.site.eds` gains `movedFrom: { org, site, liveHost, at }` (`../../stardust/reference/state-machine.md`
§ File: `stardust/state.json`); `site.eds.org/site/repoUrl/previewHost/liveHost` become the new coordinates;
`bootstrappedBy` records `project-move`. `credentials.siteTokenEnv` changes only when step 7 creates a token.

## Transfer alternative

`POST repos/<org>/<repo>/transfer` keeps history, issues and a GitHub redirect — and still needs the new Code
Sync installation, a new site config, the DA copy and the rewrite, while the OLD host stops serving at once
(no rollback window). Use it only when the owner asks for it by name; the default is create-new + `-s ours`.

## Failure modes

- **Repo transfer proposed as step 1** — Code Sync and the site config do not follow a transfer; the field run
  was redirected to create-new. Default stays create-new.
- **`--force` denied by the runner** — expected; the merge is `-s ours --allow-unrelated-histories`, then a
  normal push.
- **Boilerplate cleanup workflow not run on the target** — the template's README/workflow stubs ship; harmless,
  listed in the retire list's "target hygiene" line.
- **`media-only` rows** — an upstream re-encode (hash and extension differ); benign, listed, never re-copied.
- **`differs` rows** — re-copy that path once (`da-copy.mjs` re-run after deleting its ledger row), re-compare;
  still `differs` → report it, never hand-patch the target document.
- **Stale fragments on the old sitemap** — `only-on-old` from `--sitemap`; they retire with the old site, they
  are not copied.
- **Hands-off denial mid-bundle** — one `Blocked on owner:` with the exact command; rewrite, ledger and retire
  list still complete; no variant retry (`--public`, another org, a transfer).
