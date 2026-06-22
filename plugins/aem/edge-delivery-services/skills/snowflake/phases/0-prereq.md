# Phase 0 — Prerequisites

Goal: confirm the target EDS repository has the **overlay substrate**
in place. Runs once per repository. Subsequent invocations of the
skill see `.snowflake/config.json` and skip this phase silently.

## Why this phase exists

The skill's overlay pattern relies on substrate changes to the EDS
boilerplate (overlay engine in `scripts/overlay-engine.js`, lifecycle
CSS, header/footer block decorators, etc.). Without them, none of the
later phases work. Phase 0 detects whether the substrate is installed
and installs it if not.

## Check first

From the target repo's root:

```bash
cd "$(git rev-parse --show-toplevel)"
if [ -f .snowflake/config.json ]; then
  cat .snowflake/config.json
  # If "substrateVersion" matches the bundled VERSION → skip to Phase 1
fi
```

The bundled version is in `<SKILL_DIR>/assets/substrate/VERSION`. If the
installed version matches, **skip the rest of this phase** — substrate
is current.

## Install (or upgrade)

If `.snowflake/config.json` is absent or its `substrateVersion`
doesn't match the bundled VERSION, the dry-run during initialization
(see SKILL.md "Initialization") will have reported one of two outcomes.
Act based on which case was found.

### Fresh install (no snowflake substrate present)

The marker (the `overlay-engine.js` import in `scripts/scripts.js`) is absent — the repo has no snowflake
substrate yet. This is the common case: a vanilla `aem-boilerplate` clone
whose stock files are exactly what the skill replaces. The init summary
already disclosed the file count, and every replaced file is backed up to
`.snowflake/.backup/<timestamp>/`, so this is safe and reversible.

Run the installer directly — no pause needed:

```bash
node <SKILL_DIR>/scripts/install-substrate.mjs
```

The installer logs each pre-existing file it replaces. If that list
surprises you (e.g. it names a hand-rolled overlay engine you wrote
rather than stock boilerplate), stop and restore from the backup — but
the default is to proceed.

### Drift (a prior snowflake substrate that diverged)

The marker IS present but one or more files differ from the bundled
version — a customized substrate, an older version, or an interrupted
install. Here overwriting could lose intentional customization, so the
installer refuses without `--force`. Surface the drifted files and the
version mismatch, and let the user decide:

> The installed substrate differs from the bundled v`<VERSION>`.
> Drifted files: `<list from dry-run output>`
>
> Options:
> 1. If the divergence is intentional (your substrate is ahead of the
>    bundled one, or you customized it), keep it as-is and skip Phase 0.
> 2. If the divergence is unintended, I can overwrite with `--force`
>    (originals backed up).

Run with `--force` only after the user confirms:

```bash
node <SKILL_DIR>/scripts/install-substrate.mjs --force
```

## What gets installed

See `assets/substrate/MANIFEST.json` for the authoritative list. Summary:

| File | What changes |
|---|---|
| `scripts/overlay-engine.js` | New snowflake-owned module: overlay engine (`applyTemplateOverlay`, `writeSlot`, slot mapping, template resolution). Replaced wholesale. |
| `scripts/scripts.js` | **Not replaced** — hooked in place: one `import` + one `loadEager` guard injected idempotently. Upstream boilerplate changes are preserved. If the installer can't find the anchor, it prints the snippet to add manually. |
| `scripts/delayed.js` | HEAD-probes per-template animation engine before loading CDN deps |
| `styles/styles.css` | Lifecycle visibility CSS with direct-child selectors |
| `blocks/header/header.js` | Fetches static fragment instead of parsing DA-shape markup |
| `blocks/header/header.css` | Emptied (boilerplate's rules leaked into our fragments) |
| `blocks/footer/footer.js` | Same as header for footer |
| `blocks/footer/footer.css` | Emptied |
| `head.html` | Minimal head — no per-template stylesheet (engine loads dynamically) |
| `.eslintignore` | Patterns added (idempotent merge) |
| `.stylelintignore` | Patterns added (idempotent merge) |
| `.gitignore` | Patterns added (in-progress run state excluded) |

`scripts.js` is the only file snowflake hooks rather than replaces, so that
Adobe's ongoing boilerplate improvements to it survive an install.

## After install

Confirm `.snowflake/config.json` was written with the bundled version
stamped in. The installer also writes the default config keys
(`projectsDir`, `daRoot`, `branchPrefix`, `trunkBranch`, `tagPrefix`)
on a fresh install — user-edited values from an existing config are
preserved. The `.snowflake/` directory is now seeded:

```
.snowflake/
├── config.json                ← substrateVersion + default keys
└── .backup/<timestamp>/       ← originals of files we replaced
```

Continue to Phase 1 (Capture).

## What if substrate is more advanced than bundled

If the user's repo has a NEWER substrate version than the bundled one
(possible if the user is on a snowflake skill release that's behind
their own substrate work), the installer refuses to downgrade. The
user should either update the skill (re-clone the latest) or stay on
the current substrate and skip this phase manually.

## What if the user does NOT want to install substrate

Then this skill cannot help — every later phase assumes the overlay
engine is present. The user has two options:
1. Install substrate, run the conversion.
2. Use a different skill (e.g., `migrate-page` in the same repo) which
   takes a different approach (rewrite into EDS-shape markup instead
   of overlaying).
