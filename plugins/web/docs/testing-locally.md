# Testing Skills Locally

This document explains how to test changes to web plugin skills in a Claude Code
session before opening a PR.

## Setup

Copy the skills you want to test into a project-scope `.claude/skills/` directory
in your worktree. Claude Code loads project-scope skills before global ones, so
your local copies take effect in any session started from that worktree.

```bash
# From the worktree root
mkdir -p .claude/skills

for skill in plugins/web/skills/*/; do
  cp -r "$skill" ".claude/skills/$(basename $skill)"
done
```

Use copies, not symlinks. Symlinks to directories cause a path mismatch in
`isMain` guards that use `import.meta.url` — the guard sees the real path but
`process.argv[1]` has the symlink path, so the script's `main()` never runs.

## Precedence Limitation

Project-scope skills only override globally installed skills for skill names that
**do not already exist globally**. If a user has `cdp-connect` installed globally,
your project-scope copy of `cdp-connect` will be ignored — the global version wins.

This means:
- **New skills** (e.g. `browser-probe`, `page-tree`, `page-reduce`) — project-scope
  works correctly; invoke them with the `Skill` tool as normal.
- **Updated existing skills** — the global version loads. To test changes, either
  update the global install directly (`~/.claude/skills/<name>/`) or read and
  follow the project-local `SKILL.md` manually, pointing scripts at the local path.

## Syncing Edits Back

The `.claude/skills/` directory is untracked (add it to `.gitignore` if needed).
Edits you make to test a fix must be **manually synced back** to `plugins/web/skills/`
before committing — the repo tracks the plugin source, not the test copies.

```bash
# After editing .claude/skills/<name>/scripts/foo.js
cp .claude/skills/<name>/scripts/foo.js plugins/web/skills/<name>/scripts/foo.js
git add plugins/web/skills/<name>/scripts/foo.js
```

## Starting a Test Session

Start Claude Code from the worktree root. The project-scope skills load at
session start — changes to `.claude/skills/` after session start are not picked up
until the next session.

```bash
cd <worktree-root>
claude
```

Invoke skills via the `Skill` tool as you normally would. The base directory
printed at skill load time confirms which copy loaded:
- `Base directory: /path/to/worktree/.claude/skills/<name>` → project-scope copy
- `Base directory: /Users/<you>/.claude/skills/<name>` → global install
