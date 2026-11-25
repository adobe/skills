# stardust:stardust: setup, impeccable version hint

The text of this part of `skills/stardust/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

## Setup (run before anything else)

1. **Verify impeccable is installed.** (continued)

   **Version hint (advisory, never blocking).** Stardust deliberately pins
   NO impeccable version — the design craft should always be the current
   one — and harnesses do not announce third-party plugin updates by
   default (Claude Code's marketplace auto-update is off for third-party
   marketplaces such as impeccable's; Copilot has no update notice). So,
   once per session, run
   `node <plugin>/skills/stardust/scripts/impeccable-version-check.mjs`
   (add `--local <impeccable-dir>` when impeccable lives in a harness skills
   directory rather than the plugin registry) and surface its one output
   line to the user verbatim when it reports a newer version; it prints the
   update command for the harness it found impeccable in. Any other outcome (current, unknown, offline) is
   noise — do not mention it, and never stop or degrade a run over it.
   The same script with `--where` prints impeccable's skill directory
   (the one holding its `SKILL.md` and `reference/`); note it once — the
   phases that read impeccable's format specs (`reference/init.md`,
   `reference/document.md`) read them from there by section, never after
   a filesystem search.
