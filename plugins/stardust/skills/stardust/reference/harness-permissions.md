# Harness permissions — what a permission layer blocks in a stardust run

## When to read what

- § Two classes — at Setup step 1, after harness detection: what the owner must approve, what can be pre-approved.
- § Pre-approval (Claude Code) — the generated `permissions.allow` block and the two facts about it.
- § Privileged-action preflight — at hands-off Setup: the capability probes (the rule itself is master § Hands-off mode).
- § Hygiene pointers — three rules that live elsewhere and keep the run out of the classifier's way.

A permission layer judges a command by its nature and conversation context,
not by where the code came from — so it denies owner-grade actions and the
run's own instruments alike. Naming the class up front costs one line.

## Two classes

| class | shapes | who resolves |
|---|---|---|
| **privileged actions** | repo create · Code Sync install · merge or push to the serving branch · `POST …/live/` publish · repo visibility change (`gh repo edit --visibility`) · site-auth config writes (`config/<org>/sites/<site>/secrets.json`, `access/site.json` — `skills/deploy/reference/site-lockdown.md`) · worker or edge deploys · pushes to a second site's repo · writes to shared multi-site tooling | the owner — surfaced once by the `Blocked on owner:` line (master § Hands-off mode); the run continues on unblocked work |
| **instruments** | `node <plugin>/skills/<skill>/scripts/<x>.mjs …` (and, for skills not yet on the resolution chain, the legacy copy `node stardust/scripts/<skill>/<x>.mjs …`) · `stardust/scripts/replica/gate.sh` · `python3 -m http.server` · `aem up` · `curl` to `admin.da.live` and `admin.hlx.page` · `gh api` reads | pre-approvable; when denied anyway, re-issue once as a bare command (below), then continue |

Scripts that import the shared helper (rollout `verify.mjs`, qa `qa.mjs`)
also need `skills/stardust/scripts/class-report.mjs` copied to
`stardust/scripts/stardust/`.

A denial on a read, a `git status` or a plugin-file `sed -n` is carry-over
from a privileged ask nearby — a false positive: issue the next command.

## Pre-approval (Claude Code)

Claude Code reads `permissions.allow` from `.claude/settings.local.json`.
The generator walks the shipped script tree plus the fixed instrument shapes,
so nothing is hand-listed (`--help` lists the flags; `curl` is opt-in because
a prefix rule cannot be scoped to a host):

```
node <plugin>/skills/stardust/scripts/permissions-snippet.mjs > .claude/settings.local.json   # Claude Code
```

Two facts the run states on the first denial, then never repeats:

1. **The agent cannot grant itself permissions.** The file is the owner's;
   print the command and the block, ask once, continue.
2. **Rules match bare exact-prefix commands only.** Invoke an instrument as
   `node stardust/scripts/<skill>/<x>.mjs …` — no `cd …;` chain, no `&&`,
   no heredoc, no `pkill …;` prefix — or no rule matches. The allowlist
   removes the instrument class from context-driven denials, nothing more.

Setup step 6's managed root-`.gitignore` block excludes the file (per
machine, never committed). Other harnesses: no pre-approval mechanism is
known; the two classes and the ask-once rule apply unchanged.

## Privileged-action preflight

The rule — probe first, bootstrap at Setup, ask once, lead with `Blocked on
owner:` — is master § Hands-off mode ("Transports and privileged actions
first"); the ship script the ask offers is `skills/deploy/reference/ship-script.md`.
The **capability probes** it names, within the first five minutes: `gh api user`
· `gh api repos/<org>/<repo>` (exists?) or `gh api orgs/<org>` · `git push
--dry-run origin <branch>` · DA `PUT` of a 1-byte `/.stardust-preflight/<ts>`
then `DELETE` · admin `GET /status/<org>/<repo>/main/`. Results go to
`stardust/.work/env.json` under `transports` (`ok` | `denied` | `unreachable` |
`absent`). `absent` is `gh-repo` only — the repo answers 404 while the org or
user is reachable: no origin yet, not a denial (exit unchanged); the probe
prints `No origin … bootstrap: deploy/reference/site-bootstrap.md` and master
Setup step 9 runs that chapter now, never after migrate.
`node skills/stardust/scripts/preflight-transports.mjs --org <org> --repo <repo>
[--branch main] [--token-env DA_TOKEN]` runs the five and writes that block
(exit 2 on any denial; `--help` lists the flags). It pairs at Setup with
`node skills/deploy/scripts/da-token-check.mjs --credentials --site <slug>
--state stardust/state.json` (`state-machine.md` § Credentials key): the token
check decides whether `DA_TOKEN` is usable, the transport probe whether the
write lands — both resolve the token by NAME (shell → `.env` files), so a
`.env`-only token is never reported as `denied`.
A probe proves capability — token, reachability, org access — not permission:
a read that passes says nothing about the write that follows.

## Hygiene pointers

- **Evasion-shaped code ships in plugin scripts behind flags, never as project
  edits** — a replacement for a shipped instrument is a named deviation (master
  `SKILL.md` § Journal rule).
- **Delegated agents never call impeccable's hooks admin or a harness config
  writer** — the coordinator applies the ignore set once (planned home:
  `skills/replica/reference/preserve-direction.md` § Impeccable ignore set for
  lifted values, the replica lane).
- **Secrets never appear in command text** — tokens are read by name from the
  environment (`skills/deploy/da-deploy-protocol.md` § Token hygiene).
