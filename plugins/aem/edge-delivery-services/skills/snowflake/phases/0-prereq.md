# Phase 0 — Prerequisites

Goal: confirm the target EDS repository has the **overlay substrate**
in place. Runs once per repository. Subsequent invocations of the
skill see `.snowflake/config.json` and skip this phase silently.

## Why this phase exists

The skill's overlay pattern relies on substrate changes to the EDS
boilerplate (engine in `scripts/scripts.js`, lifecycle CSS, header/
footer block decorators, etc.). Without them, none of the later
phases work. Phase 0 detects whether the substrate is installed and
installs it if not.

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
doesn't match the bundled VERSION:

1. **Surface to the user first.** This is a substrate change — it
   modifies files the user wrote (or didn't, if they're starting from
   vanilla boilerplate). Explicitly confirm before running. Show the
   list of files that will change (from `assets/substrate/MANIFEST.json`
   `replace` and `ignorePatches` arrays).

2. **Dry-run before applying:**

   ```bash
   node <SKILL_DIR>/scripts/install-substrate.mjs --dry-run
   ```

   Read the output. The installer compares every bundled substrate
   file byte-for-byte against the target repo. There are four
   outcomes:
   - **No-op** — all bundled files already exist byte-identical in
     the repo at the bundled version. Substrate is current; phase 0
     is done.
   - **Fresh install (clean)** — none of the targeted files exist,
     or all are empty. Vanilla EDS boilerplate. Installer proceeds.
   - **Fresh install (custom code detected)** — marker absent but
     one or more targeted files exist with non-empty custom content.
     The user likely has their own work there (e.g. a hand-rolled
     overlay engine that doesn't use `applyTemplateOverlay`). The
     installer refuses without `--force` and lists the affected
     files. With `--force`, the originals are backed up and replaced.
   - **Drift** — substrate is partially present (marker found) but
     one or more files differ from the bundled version. Installer
     refuses without `--force` and lists the diverging files. Common
     causes: a hand-customized substrate, an older version installed
     before snowflake existed, an interrupted install.

   For drift or custom-code cases: investigate the named files first.
   If the divergence is intentional (the repo's substrate is ahead
   of the bundled one, or the custom code is the user's own engine),
   don't `--force`. If the divergence is unintended (you want the
   bundled version), `--force` is safe; originals get backed up.

3. **Install:**

   ```bash
   node <SKILL_DIR>/scripts/install-substrate.mjs
   # …or with --force if the drift case above is intentional
   ```

   Idempotent: re-running is safe. Files are backed up to
   `.snowflake/.backup/<timestamp>/` before being replaced.

4. **Confirm `.snowflake/config.json` was written** with the bundled
   version stamped in. This is how subsequent invocations know to
   skip Phase 0.

## What gets installed

See `assets/substrate/MANIFEST.json` for the authoritative list. Summary:

| File | What changes |
|---|---|
| `scripts/scripts.js` | New overlay engine: `applyTemplateOverlay`, `writeSlot` (5 cases), template-name resolution, eager/lazy/delayed branches |
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

## Substrate flavors: EDS vs Milo

The installer auto-detects which **flavor** to install and reports it
(`substrate flavor: <eds|milo> (auto-detected|explicit)`). Override with
`--flavor=milo` / `--flavor=eds` (or `--milo` / `--eds`).

- **`eds`** (default for vanilla `adobe/aem-boilerplate`): the full overlay
  substrate described above — replaces `head.html`, `scripts/scripts.js`,
  `styles/styles.css`, and the header/footer blocks.

- **`milo`** (auto-detected when the repo boots milolibs — `head.html`
  contains `milolibs`, or `scripts/scripts.js` calls `setLibs()`): a
  **minimal** substrate. It installs **only** `blocks/snowflake/{js,css}`
  plus the ignore patches, and **leaves Milo's `head.html`,
  `scripts/scripts.js`, and `styles/styles.css` untouched**. Replacing them
  would rip out the Milo runtime — the very thing that loads the live
  `global-navigation` + footer from `gnav-source`/`footer-source` metadata.
  On a Milo repo the chrome is owned by Milo; the bespoke body is drawn by
  the `snowflake` overlay block, which Milo loads from the project's
  `codeRoot`. `.snowflake/config.json` records `substrateFlavor: "milo"`.

The later phases branch on `.snowflake/config.json` `substrateFlavor` — read
it before Generate/Wire.

## After install

Phase 0 completes. The `.snowflake/` directory is now seeded:

```
.snowflake/
├── config.json                ← substrateVersion stamped
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
