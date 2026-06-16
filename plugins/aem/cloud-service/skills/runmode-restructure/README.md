# runmode-restructure

Fix unsupported AEM as a Cloud Service OSGi **run-mode config folders** — the BPA
finding `URC` / `unsupported.runmode`.

AEM 6.x / AMS / on-prem let you scope OSGi config to any run mode via a
`config.<runmode>` folder, in any token order. AEM as a Cloud Service honors only a
closed set — services `author`, `publish` and environments `dev`, `stage`, `prod`,
**service before environment**. Folders outside that grammar are silently ignored at
runtime, so the customer's config never applies on the Cloud.

This skill scans the project, classifies every config folder, and mechanically
restructures the fixable ones. It is pure folder/file work — **no business logic
changes**.

## Quick start

```bash
S=scripts/restructure_runmodes.py

# 1. See what's wrong (read-only)
python3 $S scan path/to/ui.config

# 2. Preview the moves with a mapping for custom run modes (read-only)
python3 $S plan path/to/ui.config --map "qa=stage,uat=stage,preview=publish"

# 3. Apply, preserving git history
python3 $S apply path/to/ui.config --map "qa=stage,uat=stage,preview=publish" --git

# 4. Confirm nothing non-compatible remains
python3 $S verify path/to/ui.config --map "qa=stage,uat=stage,preview=publish"
```

## What it fixes automatically vs. asks about

| Case | Example | Handling |
|------|---------|----------|
| Wrong token order | `config.prod.author` → `config.author.prod` | automatic |
| Custom run mode | `config.qa` → `config.stage` | needs a `--map` entry |
| Preview tier | `config.preview` → `config.publish` | needs a `--map` entry (preview inherits publish) |
| Two services/envs | `config.author.publish` | flagged `needs_user_review`, never auto-fixed |
| Already valid | `config.author.prod` | left untouched |

PID safety: a `.cfg.json` for the same PID present in both a source and an existing
target folder is a real collision (a PID can't be split across folders) — `apply`
refuses unless you pass `--allow-conflicts`, which skips only the colliding files.

## Files

- `SKILL.md` — agent instructions and workflow.
- `references/runmode-rules.md` — the Adobe-aligned run-mode ruleset.
- `scripts/restructure_runmodes.py` — deterministic scan/plan/apply/verify (stdlib only).
- `scripts/test_restructure_runmodes.py` — 32-case test suite (`python3 scripts/test_restructure_runmodes.py -v`).

## Requirements

Python ≥ 3.8. No third-party dependencies.
