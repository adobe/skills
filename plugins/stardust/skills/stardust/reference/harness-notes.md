# Harness notes

Skill text stays harness-neutral ("invoke impeccable with `craft …`", "ask
the user", "run it in the background"). This card maps each neutral phrase
to the harness running you. Read only your harness's row. Vendor facts as of
2026-10: only the Claude Code and Copilot CLI rows are smoke-verified so far
(`evals/harness-smoke/RECORDED.md`);
*unverified* marks a fact the vendor docs leave open.

## Skills: loading a sibling, invoking impeccable

| Harness | Stardust skill names | Impeccable call |
|---|---|---|
| Claude Code | `stardust:<name>` via the Skill tool | `Skill { skill: "impeccable:impeccable", args: "<cmd> <args>" }` |
| GitHub Copilot CLI | bare `<name>` (plugin skills flattened); VS Code: `/stardust:<name>` | the `impeccable` skill with `<cmd> <args>` |
| Grok Build | bare `<name>`, `/stardust:<name>` on a clash | `/impeccable <cmd> <args>` |
| OpenCode | `skill({ name: "<name>" })` | `skill({ name: "impeccable" })`, then follow it with `<cmd> <args>` |
| Cursor | bare `<name>` (auto or `/<name>`) | `/impeccable <cmd> <args>` |
| Codex CLI | `$<name>` (also listed with its path) | `$impeccable <cmd> <args>` |
| Antigravity | `/<name>` | `/impeccable <cmd> <args>` |
| Pi | `/skill:<name>`, or read the listed SKILL.md path | `/skill:impeccable <cmd> <args>` |

No skill tool, or the call fails: read the sibling's `SKILL.md` and follow
it inline (master § Routing). `<skills-root>` is the directory holding the
stardust skill folder: the path the harness lists for a skill, minus
`/stardust/SKILL.md`.

## Asking, delegating, waiting

| Harness | Ask the user | Subagents (nesting) | Background shell | Foreground limit |
|---|---|---|---|---|
| Claude Code | AskUserQuestion | Agent tool (depth 1) | `run_in_background`, task notification | 120 s default, longer when declared |
| GitHub Copilot CLI | `ask_user` (off under `--no-ask-user`); cloud agent: none, run hands-off | custom agents, `/fleet` | async shell / `detach` | model-set |
| Grok Build | `ask_user_question` | `spawn_subagent` (depth 1) | `background: true` | 120 s |
| OpenCode | `question` | Task tool, parallel | `nohup … &` (*unverified*: `background` param) | 120 s |
| Cursor | AskQuestion (model-dependent) | Task tool, parallel (depth 1) | auto-backgrounded after ~10 min | ~10 min |
| Codex CLI | plain chat (structured input only in Plan mode) | when a skill asks; inherits the sandbox | yields after 30 s, poll the terminal | 30 s yield |
| Antigravity | `ask_question` | `invoke_subagent` | `/tasks` | headless: `--print-timeout` 5 min total |
| Pi | plain chat | none: run the sequential path | `nohup … &` | none by default |

`run-bg.mjs wait --max` must sit under the foreground limit; pass
`--max 25` on Codex. An answer that is empty, timed out or auto-resolved is
never consent: treat it as "no answer" and stop at the gate.

## Images, sandbox, headless

| Harness | Read a PNG | Sandbox stardust needs | Headless form |
|---|---|---|---|
| Claude Code | Read tool | none by default | `claude -p` |
| GitHub Copilot CLI | `view` (dropped on BYOK models) | none by default; cloud agent: Playwright in `copilot-setup-steps.yml`, crawl targets on the firewall allowlist | `copilot -p … --allow-all-tools` |
| Grok Build | `read_file` | none by default | `grok -p … --always-approve` |
| OpenCode | read tool (vision model required) | none | `opencode run --format json` |
| Cursor | Read File | outbound network and Chromium need a run mode outside the sandbox or an allowlist (*unverified*) | `agent -p --force` |
| Codex CLI | `view_image` | network on (`-c sandbox_workspace_write.network_access=true`); Chromium crashes under the macOS Seatbelt sandbox, so Playwright steps need `--sandbox danger-full-access` or an approved escalation | `codex exec --json` |
| Antigravity | `view_file` | none by default | `agy -p` |
| Pi | read tool (vision model required) | none (no sandbox, no approvals: run in a container) | `pi -p` |

Headless runs are unattended: pass `--hands-off` (master § Hands-off mode),
or the first gate stops the run.
