# Harness permissions — what a permission layer blocks in a stardust run

## When to read what

- § Two classes — at Setup step 1, after harness detection: which commands the owner must approve and which can be pre-approved.
- § Pre-approval (Claude Code) — when the harness is Claude Code: the snippet, how to emit it, the two facts about it.
- § Hygiene pointers — the three rules that live elsewhere and keep the run out of the classifier's way.

A harness that runs stardust hands-off usually puts a permission layer
between the agent and the shell. It judges each command by its nature and
its conversation context, not by where the code came from, so it denies
two very different things: actions that *should* be the owner's, and
instruments the run needs to invoke hundreds of times. Treating both as
"blocked" costs hours; naming the class up front costs one line.

---

## Two classes

| class | shapes | who resolves |
|---|---|---|
| **privileged actions** | repo create · Code Sync install · merge or push to the serving branch · `POST …/live/` publish · worker or edge deploys · pushes to a second site's repo · writes to shared multi-site tooling | the owner — surfaced once by the `Blocked on owner:` line (master § Hands-off mode); the run continues on unblocked work |
| **instruments** | `node stardust/scripts/<skill>/<x>.mjs …` and `node <plugin>/skills/<skill>/scripts/<x>.mjs …` (the shipped script tree) · `stardust/scripts/replica/gate.sh` · `python3 -m http.server` · `aem up` · `curl` to `admin.da.live` and `admin.hlx.page` · `gh api` reads | pre-approvable; when denied anyway, re-issue once as a bare command (below), then continue |

A denial on a read, a `git status` or a plugin-file `sed -n` is
context carry-over from a privileged ask nearby — a false positive. Do not
stop, do not argue with it; issue the next command and move on.

---

## Pre-approval (Claude Code)

Claude Code reads `permissions.allow` from `.claude/settings.local.json`
in the project. Emit the block with the generator (it walks the shipped
script inventory plus the fixed shapes above, so nothing is hand-listed):

```
node <plugin>/skills/stardust/scripts/permissions-snippet.mjs > .claude/settings.local.json   # Claude Code; planned generator — script-paths: ignore until it lands
```

Two facts the run must state on the first denial, then never repeat:

1. **The agent cannot grant itself permissions.** The file is the
   owner's; print the command and the block, ask once, continue.
2. **Rules match bare exact-prefix commands only.** An instrument is
   invoked as `node stardust/scripts/<skill>/<x>.mjs …` — no `cd …;`
   chain, no `&&`, no heredoc, no `pkill …;` prefix — or no rule matches.
   The allowlist does not prevent context-driven denials; it removes the
   instrument class from them.

Setup step 6's managed root-`.gitignore` block excludes
`.claude/settings.local.json`; the file is per machine, never committed.
Other harnesses: no pre-approval mechanism is known; the two classes and
the ask-once rule apply unchanged.

---

## Hygiene pointers

- **Evasion-shaped code ships in plugin scripts behind flags, never as
  project edits** — an agent-authored replacement for a shipped
  instrument is a named deviation (master `SKILL.md` § Journal rule); a
  challenge bypass written into the project reads as evasion to any
  classifier.
- **Delegated agents never call impeccable's hooks admin or any harness
  config writer** — the ignore set is applied once, by the coordinator
  (`skills/replica/reference/preserve-direction.md` § Impeccable ignore
  set for lifted values).
- **Secrets never appear in command text** — tokens are read by name
  from the environment (`skills/deploy/da-deploy-protocol.md` § Token
  hygiene); a `grep … | cut` on an env file is a credential-exploration
  denial waiting to happen.
