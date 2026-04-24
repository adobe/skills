# Soft Dependencies

The `stardust` skills run standalone. When a recognized peer plugin is installed, they delegate to it for a richer experience; when absent, an inline fallback produces a usable (if lighter) result.

## Peers

| Peer | Detection | Fallback location | Announcement policy |
|---|---|---|---|
| `superpowers` | `/brainstorm`, `/write-plan`, `/execute-plan` slash commands registered in the session | [`fallback-brainstorm.md`](fallback-brainstorm.md) | Announce **once per session** the first time a fallback is used. Losing `/write-plan` noticeably changes prototype iteration pacing. |
| `impeccable` | `/impeccable critique`, `/impeccable shape`, `/impeccable teach` slash commands registered | [`fallback-critique.md`](fallback-critique.md) | **Silent.** Fallback is viable; announcing adds noise. |

## Detection pattern

Before invoking a peer-plugin slash command, check registration. In Claude Code, skill loaders expose available commands; in SLICC, skills are discovered by filesystem scan of `.claude/skills/` and `.agents/skills/`.

Practical detection in a skill body:

1. Attempt the delegated call (`/impeccable critique` or equivalent).
2. If the host returns "command not found" or the equivalent unknown-command signal, switch to the inline fallback.
3. Do not fail or block — the soft-dep policy guarantees forward progress.

## What soft-deps are NOT

- **Not hard deps.** A missing peer never stops the skill from running.
- **Not installer hooks.** This plugin does not attempt to install peers for the user.
- **Not version-pinned.** Any version that registers the named slash commands satisfies the detection.
- **Not EDS.** `aem-edge-delivery-services` and `eds-site-builder` are **not** soft-deps for `stardust`. The plugin is self-contained.

## Announcement text (copy verbatim when announcing)

For superpowers (once per session, first time used):

> *Note: `superpowers` is not installed. Using an inline interview pattern for this step — works fine, but `/brainstorm` and `/write-plan` give a richer loop. Install with `/plugin install superpowers` if you want the full experience.*

For impeccable: no announcement.
