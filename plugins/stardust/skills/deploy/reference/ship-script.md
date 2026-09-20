# Ship script — `stardust/.work/ship.sh`

Read this chapter when a privileged action (push to the serving branch, live
publish) was denied under hands-off and the run continues author-only
(master `../stardust/SKILL.md` § Hands-off mode): the run writes this one
file, names its path in the `Blocked on owner:` line, and never runs it.

## Template

```bash
#!/usr/bin/env bash
# stardust ship script — written by the run, run once by the owner. Edit the variables only.
set -euo pipefail
ORG=<org>; REPO=<repo>; WORK=<work-branch>; SERVE=main; PROJECT=<eds-project-dir>; CONTENT="$PROJECT/content"
ISSUE=<the stardust/decisions.md tracking row: issue number, or empty>; PLUGIN=<plugin-dir>
git -C "$PROJECT" switch "$SERVE" && git -C "$PROJECT" merge --ff-only "$WORK"           # 1 merge
git -C "$PROJECT" push origin "$SERVE"                                                    # 2 push — Code Sync builds
node "$PLUGIN/skills/deploy/scripts/deploy-batch.mjs" --org "$ORG" --repo "$REPO" \
  --branch "$SERVE" --content "$CONTENT" --publish                                        # 3 explicit publish (D1, D16)
node "$PLUGIN/skills/rollout/scripts/verify.mjs" --base "https://$SERVE--$REPO--$ORG.aem.live"   # 4 post-ship gate
[ -z "$ISSUE" ] || gh issue comment "$ISSUE" --repo "$ORG/$REPO" \
  --body "shipped $(git -C "$PROJECT" rev-parse --short HEAD) at $(date -u +%FT%TZ)"      # 5 issue comment
```

## Rules

- **One command, never a list.** The owner runs `bash stardust/.work/ship.sh`;
  a numbered to-do in a reply is the failure this chapter replaces.
- Step 3 is the explicit publish run (`deploy-batch.mjs --publish`; a run
  without the flag is preview-only). It never rides on a preview batch (D16)
  and runs only after the gate PASS (D1).
- Values come from the decision register (`../stardust/reference/decisions.md`
  rows `target`, `branch`, `publish`) — never re-asked.
- `stardust/.work/` is untracked: the script is run residue; the register row
  and the `status.jsonl` `blocked` line (`owner: "bash stardust/.work/ship.sh"`)
  are the record.
