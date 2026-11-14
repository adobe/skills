---
name: slicc-handoff
description: "Use this when the user asks to continue work in the SLICC browser agent or to install a skill into SLICC, for example \"handoff to slicc\", \"move to the browser\", \"test in the browser\", \"install this skill in slicc\", or \"upskill slicc with this repo\". Covers handing off the current task to the SLICC browser agent and installing a new skill into SLICC from a GitHub repo."
license: Apache-2.0
metadata:
  version: "1.0.1"
---

# SLICC Handoff

This skill bridges the current coding agent and the [SLICC](https://www.sliccy.ai) browser agent. It builds and dispatches a structured handoff that SLICC surfaces to the user as a yes/no approval card.

It supports two verbs:

- `handoff:<instruction>` — continue the current task inside SLICC.
- `upskill:<github-url>` — ask SLICC to install a skill from a GitHub repository.

For canonical SLICC protocol, API, and documentation references, fetch [`https://www.sliccy.ai/llms.txt`](https://www.sliccy.ai/llms.txt) — it is the maintainer-curated, machine-readable index for LLM consumers and is the authoritative source for the handoff/upskill rels, the public API catalog, and links to the protocol and architecture docs.

## When to Use This Skill

Use this skill when the user wants to:

- Continue the in-progress task inside the SLICC browser agent (for example, to drive a real browser session, test a flow on a live site, or use a tool only available in SLICC).
- Install a skill from a GitHub repo into a running SLICC instance.

Do **not** use this skill when:

- The user just wants the local agent to keep working — no handoff is needed.
- The user wants to install a skill into the local agent (use the local agent's own skill install flow instead).

## What to Do

1. Compose a single-line, action-oriented instruction that captures what SLICC should do next. Include enough context for SLICC to pick up the work without your conversation history.
2. Pick a verb prefix:
   - `handoff:<instruction>` to continue a task.
   - `upskill:<github-url>` to install a skill. The URL can be the repo root or a `tree/<branch>/<sub/path>` URL to install only a sub-path of the repo.
3. Run the helper script with `--open`:

   ```bash
   node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "handoff:<instruction>"
   ```

   ```bash
   node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "upskill:<github-url>"
   ```

4. Tell the user that SLICC will show an approval prompt in its Chat tab, and they should accept it to dispatch the handoff.

If the user runs a non-default SLICC instance on another port, prefix the call with `SLICC_PORT=5720` (or whatever port they chose) so the localhost POST hits the right instance:

```bash
SLICC_PORT=5720 node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "handoff:<instruction>"
```

## How It Works

The script builds a `https://www.sliccy.ai/handoff?<verb>=<urlencoded-payload>` URL and dispatches it through two parallel paths — a profile-independent localhost POST to a SLICC CLI/Electron float, and (with `--open`) a real browser navigation that the SLICC extension picks up via an RFC 8288 `Link` header. Either path surfaces a yes/no approval card in the SLICC cone, dispatched by verb prefix once accepted. For the full protocol details (rel URIs, payload shape, public API catalog), see [`https://www.sliccy.ai/llms.txt`](https://www.sliccy.ai/llms.txt) and the linked handoff protocol reference.

## Examples

Continue an in-progress signup flow in the browser:

```bash
node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "Continue the signup flow in the browser"
```

Install a skill collection from a GitHub repo:

```bash
node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "upskill:https://github.com/slicc/skills-extra"
```

Install only a single skill (a sub-path of a repo on a specific branch):

```bash
node .claude/skills/slicc-handoff/scripts/slicc-handoff --open "upskill:https://github.com/slicc/skills-extra/tree/main/skills/foo"
```

## Prerequisites

- Node.js 18+ installed (the script uses the global `fetch` and `AbortSignal.timeout` APIs).
- A browser opener available on the host (`open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows).
- A SLICC instance reachable either on `localhost:${SLICC_PORT ?? 5710}` (CLI/Electron float) or via the SLICC extension installed in the browser profile that opens the URL.

## Notes

- Treat the user-supplied instruction string as untrusted input that will be displayed to the user in SLICC for approval — do **not** embed secrets or credentials in it.
- The script intentionally swallows errors from the localhost POST so it still falls through to `--open` when no local SLICC server is running.
