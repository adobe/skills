---
name: runmode-restructure
description: Detect and fix unsupported OSGi run-mode config folders flagged by BPA finding code URC, subtype unsupported.runmode, when migrating legacy AEM (6.x / AMS / on-prem) to AEM as a Cloud Service. AEM 6.x allowed custom run modes (config.qa, config.uat, config.local, config.preview, config.ams, ...) and any token order; Cloud Service honors only a closed set — services author, publish and environments dev, stage, prod, with service before environment. This skill scans config folders, classifies each as valid / reorder / unsupported / invalid_combo, and mechanically restructures the fixable ones via scripts/restructure_runmodes.py (scan, plan, apply, verify). Use for BPA URC findings, unsupported.runmode, "fix my run mode folders", "config.<runmode> not applied on Cloud", or moving OSGi configs to a Cloud-safe folder layout. Pure folder/file restructuring — no business logic changes. Values that genuinely vary per environment are surfaced for $[env:] / $[secret:] externalization, not guessed.
license: Apache-2.0
---

# AEM as a Cloud Service — Run-mode Config Restructure (BPA `URC` / `unsupported.runmode`)

**Source → target:** Legacy **AEM 6.x / AMS / on-prem** → **AEM as a Cloud Service**.
Scoped under `plugins/aem/cloud-service/skills/runmode-restructure/`.

This is a **mechanical restructuring** skill. The work is moving and renaming OSGi
config folders so they match the Cloud's closed run-mode grammar — **no business
logic changes**. The bundled script does the deterministic 90%; the agent only
brokers the handful of genuine judgment calls (mapping a custom run mode to a Cloud
environment, or resolving an ambiguous two-service / two-environment folder).

It complements the `migration` skill's OSGi/Cloud-Manager reference module, which
**flags** invalid run-mode folders but does **not** move them. This skill moves them.

## The rule (read `references/runmode-rules.md` for the full Adobe-aligned ruleset)

Valid run-mode tokens on Cloud Service:

| Kind | Tokens |
|------|--------|
| Service | `author`, `publish` |
| Environment | `dev`, `stage`, `prod` |

A config folder is **valid** iff it is `config` plus **at most one** service token
and/or **at most one** environment token, **service before environment**:

```
config   config.author   config.publish   config.dev   config.stage   config.prod
config.author.dev   config.author.stage   config.author.prod
config.publish.dev  config.publish.stage  config.publish.prod
```

Everything else is **silently ignored at runtime** on the Cloud. PID resolution is
per-PID: the folder with the most matching run modes wins, and **one PID cannot be
split across folders** — which is why merges guard against same-PID collisions.

## Classification → action

| Status | Meaning | Action |
|--------|---------|--------|
| `valid` | Already Cloud-compatible | leave untouched |
| `reorder` | Valid tokens, wrong order (`config.prod.author`) | **auto** rename → `config.author.prod` |
| `unsupported` | Custom token (`config.qa`, `config.preview`, `config.ams`) | rename **once a token mapping is supplied** (e.g. `qa=stage`) |
| `invalid_combo` | Two services or two environments (`config.author.publish`) | **needs_user_review** — never auto-fixed |

## When to use this skill

- A BPA report lists **`URC` / `unsupported.runmode`** findings.
- "My `config.<runmode>` settings aren't taking effect on Cloud Service."
- "Move / restructure my OSGi run-mode config folders for AEMaaCS."
- Pre-migration cleanup of `ui.config` (or `ui.apps`) config folders.

If the work is really "move secret/environment-specific **values** out of OSGi into
Cloud Manager" (`$[secret:]` / `$[env:]`), that is the `migration` skill's
OSGi → Cloud Manager branch. This skill handles the **folder layout**; it only
*flags* values that look environment-specific so you can hand them off.

## Workflow (agent)

1. **Scope to the workspace.** Only scan the user's AEM project (typically the
   `ui.config` or `ui.apps` content package). Do not wander outside the workspace
   root or named paths.

2. **Scan (read-only):**
   ```bash
   python3 scripts/restructure_runmodes.py scan <project-root>
   ```
   Present the report: counts per status, and the specific folders.

3. **Resolve the judgment calls — ask, don't guess.**
   - For each **`unsupported`** custom token, ask the user which Cloud environment
     it maps to, or to drop it. Common cases to *propose* (still confirm):
     `uat`/`qa` → `stage`; `local` → `dev` or `drop`; `preview` → `publish`
     (preview inherits publish config on Cloud); `ams`/`integration` → usually `drop`.
   - For each **`invalid_combo`** (e.g. `config.author.publish`), there is no
     mechanical fix: the same PID set was scoped to two services/environments at
     once. Ask the user how to split it; do not invent an answer.

4. **Plan (read-only) with the agreed mapping:**
   ```bash
   python3 scripts/restructure_runmodes.py plan <project-root> --map "qa=stage,uat=stage,preview=publish"
   ```
   Review `actions` and especially any `conflicts` (same-PID collisions) and
   `needs_user_review` entries before touching the tree.

5. **Apply** (prefer `--git` to preserve history):
   ```bash
   python3 scripts/restructure_runmodes.py apply <project-root> --map "<same mapping>" --git
   ```
   Apply **refuses** if any PID collision exists, unless `--allow-conflicts` (which
   skips only the colliding files and reports them for manual merge).

6. **Verify** (must exit 0; `invalid_combo` folders you intentionally deferred will
   still fail — resolve or document them):
   ```bash
   python3 scripts/restructure_runmodes.py verify <project-root> --map "<same mapping>"
   ```

7. **Hand off environment-varying values.** If collapsing a custom run mode means a
   property now needs to differ per Cloud environment, note it and route the value
   externalization to the `migration` skill's OSGi → Cloud Manager branch
   (`$[env:]` / `$[secret:]`). Never put secret values in chat.

## Critical rules

- **No business logic changes.** This skill only moves/renames folders and the
  config files inside them. It never edits `.cfg.json` property *values*.
- **Never guess a custom-run-mode mapping or an `invalid_combo` split.** Surface
  them; the user decides.
- **Respect PID resolution.** A `.cfg.json` for the same PID in both source and
  target is a real collision — report it, do not overwrite. (`.content.xml` is the
  shared `sling:Folder` marker, not a PID, and is handled automatically.)
- **One project root per run.** Stay inside the workspace; don't scan parents/siblings.
- **Prefer `git mv`** (`--apply --git`) so the history of each config follows the move.

## Script reference

`scripts/restructure_runmodes.py` — pure standard library, Python ≥ 3.8.

| Subcommand | Effect |
|------------|--------|
| `scan ROOT [--map ...] [--strict]` | classify and print (read-only; `--strict` exits 1 if anything fixable remains) |
| `plan ROOT [--map ...] [--out file]` | emit JSON plan: `actions`, `conflicts`, `needs_user_review` (read-only) |
| `apply ROOT [--map ...] [--git] [--allow-conflicts]` | execute moves (mutates the tree) |
| `verify ROOT [--map ...]` | exit non-zero if any non-compatible folder remains |

`--map` format: `qa=stage,uat=stage,preview=publish,local=drop` (`drop` or empty
removes the token).

Tests: `python3 scripts/test_restructure_runmodes.py -v` (32 cases, no third-party deps).

## Relationship to other skills

- **`migration`** — orchestrator for the broader 6.x → Cloud Service effort; its
  `references/osgi-cfg-json-cloud-manager.md` *flags* invalid run-mode folders and
  owns OSGi-value externalization. Delegate folder restructuring here; delegate
  value externalization (`$[env:]`/`$[secret:]`) there.
- **`best-practices`** — Java/OSGi transformation patterns; out of scope for this
  purely structural skill.
