> Copy of a working file from the 2026-08 learnings harvest, pushed to `stardust/next` on 2026-09-23 for reference. Real site names are replaced by generic sector descriptors (0.19.2 policy); local paths and `analysis/` pointers refer to the maintainer's machine and are not in this repo.

# Promotion runbook — `stardust/next` → main

Written 2026-09-20 while B3's eval gate runs. Use once `next` carries 0.24.0-next.4 (B3 closed); until then the channel worktree is pinned at the last closed batch.

## 1. Install the `next` channel (your machine only)

The repo's marketplace manifest is named `adobe-skills`, the same name as the GitHub marketplace you already use, so Claude Code cannot hold both at once. Run in a Claude Code session (the `!` prefix runs a shell command; `/plugin` commands are typed as-is):

```
/plugin marketplace remove adobe-skills
/plugin marketplace add /Users/paolo/stardust/source/190926/wt/next-channel
/plugin install stardust@adobe-skills
/reload-plugins
```

The worktree `wt/next-channel` is a detached checkout of `stardust/next`; I move it to each closed batch. Check the version you got: `cat /Users/paolo/stardust/source/190926/wt/next-channel/plugins/stardust/.claude-plugin/plugin.json | grep version`.

To go back to the published plugin afterwards:

```
/plugin marketplace remove adobe-skills
/plugin marketplace add adobe/skills
/plugin install stardust@adobe-skills
```

Before the first migration: `promptCacheTtl: "1h"` in your Claude Code settings.json is the harness lever the T01 analysis found (−29 % modelled cache spend); it is independent of the plugin.

## 2. Run the G3 migrations

Two or three real migrations on the channel, in fresh project directories: one **replica** (keep-design) with a rollout of at least one template cluster, one **redesign** (`prepare-migration` → `migrate` → `deploy`), and if time allows one **rollout at scale** (≥ 50 pages). Let them run as you normally would; do not steer around the new gates — the point is to see whether they fire, whether their escape hatches are usable, and what the hands-off defaults do.

Note per run: the project dir, the session id (`ls -t ~/.claude/projects/-Users-paolo-<project-dir>/*.jsonl | head -1`), and the delivered page count.

## 3. Compare against the harvest baseline

```
cd /Users/paolo/stardust/source/190926/analysis
node compare-run.mjs <session.jsonl> --pages <N> --project-dir <project> --label <name>
```

One table per session: cache hit %, full misses after ≥ 5-min gaps, sleep commands and minutes, tokens per request, hours active and wall, compactions, agent-authored scripts, plugin text read, tokens injected per skill invocation, gate results from `progress.json`. The verdict column marks each KPI better / worse / same vs the 48-session baseline. `--json` for the raw numbers.

Promotion rule from the plan (§ 5 G3): nothing regresses, the targeted KPIs move — cache/sleep/tokens down, agent-authored scripts down, plugin text read not up, gate pass at first publish not worse. Hours to first page cannot come from a transcript; note it by hand.

## 4. Promote

If the table holds: I open one PR `stardust/next` → `main` (batch commits preserved, consolidated changelog section for 0.24.0 or 1.0.0 — your call on the number), you merge, semantic-release publishes, users update. If a KPI regresses: the ledger row for the dimension names the items to bisect (revert the batch commit or the item on `next`, re-run one migration).

## 5. What to read first as G2 for B3

`PROGRESS.md` § "G2 read for B3" (written at close): the new gates with their escape hatches, the two decision-register defaults the lanes applied without a D-number (lockdown on by default with an operator-domain allow-list; chrome-variant as a template body class), the D15 LOCALIZE tier left 🟡, and the design-level items deliberately left.
