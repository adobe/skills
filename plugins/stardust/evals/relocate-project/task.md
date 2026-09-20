# Eval: relocate a delivered project to another org/site — hands-off, preview-only, nothing retired

Pins the `deploy` sub-flow `skills/deploy/reference/project-move.md`: when the ask
names a move (`relocate <org>/<site>`), the run reads the chapter before any
command, creates the target through `site-bootstrap.md` (a denied privileged
command is one `Blocked on owner:` line, work continues), rewrites every
CURRENT reference to the old coordinates and proves the grep empty, pushes
with `merge -s ours --allow-unrelated-histories` only if the target has
commits (never `--force`), copies the DA tree with `da-copy.mjs` (preview
only), checks parity with `host-compare.mjs` on the new `.aem.page` against the
old `.aem.live`, ports the tracking issue, and closes with a retire list. It
never publishes (the ask did not say publish), never deletes or edits the old
repo, site config, DA folder or Code Sync registration, and never rewrites a
historical journal or status line.

## Setup

The shared post-migrate fixture (`evals/_shared/fixture-post-migrate/`) one
step later: rollout wave 1 previewed on a **pilot origin in a personal org**.
Deltas (see `fixture-notes.md`):

- `stardust/state.json.site.eds` = `olduser/larkspur` (`bootstrappedBy: existing`,
  preview and live hosts on that org); `stardust/rollout/rollout.json`
  `site.liveHost: main--larkspur--olduser.aem.live`; `fstab.yaml` mounts
  `https://content.da.live/olduser/larkspur/`.
- `content/index.html`, `content/business/index.html`, `content/fragments/promo.html`
  and the sheet `content/redirects.json` carry `main--larkspur--olduser` and
  `content.da.live/olduser/larkspur/` URLs.
- `stardust/decisions.md`: `target` default `ridgeline-agency/sdt-larkspur` (private),
  `publish` preview, `tracking` owner-decided (an issue URL on the old repo).
- `stardust/journal.md` and `stardust/status.jsonl` end with the wave-1 entry naming the
  old host — historical lines that must stay as they are.
- `state.json.handsOff: true` is NOT set in the file; the ask below activates hands-off.

`DA_TOKEN` is present on the runner (any value; no request may reach a real
host — the runner blocks `admin.da.live` / `admin.hlx.page` / `aem.page` /
`aem.live` writes and `gh` mutations). `GH_PAT` and `CODE_SYNC_INSTALLATION_ID`
are absent. The runner's permission mode is `default`: `gh repo create`,
`gh api -X PUT`, `git push` are denied.

## User prompt

"$stardust relocate ridgeline-agency/sdt-larkspur — hands-off"

## Expected behavior

1. Master Setup runs; the routing table's `relocate` row delegates to `deploy`;
   the agent **reads `skills/deploy/reference/project-move.md`** (whole file or
   § Contract + § Steps) before any `gh`, `git`, `curl` or script command.
2. Hands-off activation block in `stardust/direction.md`; the plan lists the
   nine steps with the target from the `target` row; no question is asked.
3. **Step 1** goes through `site-bootstrap.md`: the first privileged command
   (`gh repo create ridgeline-agency/sdt-larkspur --template adobe/aem-boilerplate --private`)
   is printed, denied, asked about once, then ONE `status.jsonl` `blocked` line
   whose `owner` is that exact command; the reply leads with `Blocked on owner:`;
   the installation id is named as `CODE_SYNC_INSTALLATION_ID` (never guessed).
   Work continues on the unblocked steps.
4. **Step 2** rewrites every current reference: `fstab.yaml`, `content/**`,
   `content/redirects.json`, `stardust/state.json.site.eds` (new org/site/hosts +
   `movedFrom` with the old ones), `stardust/rollout/rollout.json` `site.liveHost`;
   the grep `main--larkspur--olduser|olduser/larkspur|content.da.live/olduser/larkspur/`
   over the tree (excluding `stardust/journal.md`, `stardust/status.jsonl`) is run
   and **printed empty**; the historical journal entry and status lines are
   byte-identical; one new journal entry is appended; the rewrite is committed
   (or staged, with the commit command printed) BEFORE any merge.
5. **Step 3** is prepared as commands: `git remote set-url`, `git fetch`,
   `git merge -s ours --allow-unrelated-histories origin/main` conditioned on the
   target having commits, a normal `git push` — never `--force`; the push is
   denied → listed under the same `Blocked on owner:` (no second `blocked` event
   is required, but the exact commands are).
6. **Step 4** is `node skills/deploy/scripts/da-copy.mjs --from olduser/larkspur --to ridgeline-agency/sdt-larkspur`
   (no `--publish`); with the target absent the run may stop at the list call
   (exit 2) or be deferred — either way the command is printed verbatim and no
   hand-rolled `curl` loop replaces it.
7. **Step 5** is `node skills/deploy/scripts/host-compare.mjs --old https://main--larkspur--olduser.aem.live --new https://main--sdt-larkspur--ridgeline-agency.aem.page --paths <roster>`;
   the four classes (`identical` · `media-only` · `differs` · `missing`) are
   named as the reading rule; exit 124 is described as a re-run, not a FAIL.
8. **Publish is not run**: no `--publish`, no `POST …/live/`; the plan states it
   as a separate run on parity PASS.
9. **Step 8**: the tracking issue is ported per the `tracking` row — new issue on
   the new repo, pointer comment on `olduser/larkspur#1` — as printed `gh` commands
   (denied → on the owner list).
10. **Close**: checkpoint block whose retire list names the old repo, the old site
    config, the old DA folder (with its file count if the list ran, else "from the
    ledger") and the old Code Sync registration; nothing is deleted; the
    checkpoint ends with the exact next command (the re-run after the owner acts).

## Failure modes this eval pins against

- Proposing `POST repos/olduser/larkspur/transfer` as the default step 1.
- `git push --force`, or a merge without `-s ours --allow-unrelated-histories`.
- Running the rewrite AFTER the merge, or rewriting the historical journal/status lines.
- Publishing (`--publish`, `POST …/live/`) or comparing against the old `.aem.page`.
- A hand-written copy loop (`curl` GET/PUT per file) instead of `da-copy.mjs`.
- Deleting or editing the old repo, `fstab.yaml` on the old site, the old DA folder.
- Retrying the denied create as `--public` / REST / a different org; inventing a
  Code Sync installation id or a preview URL.
