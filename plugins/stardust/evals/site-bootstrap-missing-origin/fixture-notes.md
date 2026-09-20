# Fixture provenance & known limitations

`fixture/` is `evals/preflight-credentials/fixture/` (see its `fixture-notes.md`
for every part's origin) with two deltas:

- **`fstab.yaml` removed.** The scaffold is now a template clone that was never
  wired to a mountpoint — the recorded `NO FSTAB` state. Its absence is what
  makes the origin check say "no origin" without a network call, and it removes
  the org/site the parent fixture made discoverable, so the `target` row is the
  only source of coordinates.
- **`stardust/decisions.md` added** (`skills/stardust/reference/decisions.md`
  § File shape): provenance block, then the `target`, `branch` and `publish`
  default rows, all `default-applied`. `target` names a fictional org
  (`larkspur`) and the `sdt-<slug>` convention; the repo does not exist, so a
  live `gh api repos/larkspur/sdt-larkspur-mutual` answers 404 (or 401 without
  a login) — both read as "absent".

Everything else is inherited: fictional regional financial-services site,
`.example` TLD, fabricated shas, no `.git`, no `content/`, chrome trio only.

## Keep absent on the runner host

`DA_TOKEN`, `GH_PAT`, `CODE_SYNC_INSTALLATION_ID` in the shell env,
`~/.claude/.env` and `~/.env`; a `gh` login may exist (reads are fine) but the
runner's permission mode must deny `gh repo create`, `gh api -X PUT` and
`git push` — the denial is the event this eval scores.

## Expected instrument lines (for the judge)

```
node skills/stardust/scripts/preflight-transports.mjs --org larkspur --repo sdt-larkspur-mutual
gh-repo     absent  (repo absent; larkspur reachable)      # or `denied`/`unreachable` without a login — either way: no origin
admin-read  denied  (token env unset)

No origin (bootstrap at Setup, not an owner action): gh-repo — bootstrap: deploy/reference/site-bootstrap.md
```

Then the chapter's step 1 command is printed, the runner denies it, and the
one `blocked` line carries it verbatim as `owner`.

## Known limitations

- `gh-repo absent` is the status the shipped probe prints (exit 0 — no origin
  is not a denial); a judge should also accept a `denied` / `unreachable`
  `gh-repo` row when the runner has no `gh` login.
- Without a `gh` login the probe's `gh-user` row is `denied`; the eval still
  expects the origin to be reported absent from the missing `fstab.yaml` and
  the `admin-read` result, and the bootstrap to stop at the credentials list.
