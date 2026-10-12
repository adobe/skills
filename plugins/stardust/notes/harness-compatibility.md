# Stardust harness compatibility

Analysis of stardust 0.32.0 against the ten harnesses impeccable advertises:
Codex CLI, Claude Code, GitHub Copilot, Cursor, Gemini CLI, Grok Build,
Antigravity, OpenCode, Pi, Hermes Agent. Research date 2026-10-12. Harness
facts come from each vendor's current docs and issue trackers; claims marked
*unverified* were not confirmed in a primary source. Nothing here was run
outside Claude Code and (earlier, 2026-09-17) Copilot CLI.

## Verdict

| Harness | Status | Install path today | Main blockers | Work size |
|---|---|---|---|---|
| Claude Code | **Works, verified** (eval runner, continuous) | plugin marketplace | — | none |
| GitHub Copilot CLI | **Works, verified at 0.22.0** (1.0.85); 0.32.0 and `dynamics`/`qa`/`spec` unverified | plugin marketplace (reads `.claude-plugin/`) | no dependency resolution (impeccable installed by hand, already documented) | S — re-run smoke |
| Copilot VS Code / cloud agent | Expected, not run | same plugin / `.github/skills` | cloud agent has no ask-user tool and a Bash firewall; Playwright must be installed in `copilot-setup-steps.yml` | S–M |
| Grok Build | **Likely works with one hard fix** | `grok plugin install` reads `.claude-plugin/` | **skill bodies inlined only to 25k tokens: `deploy/SKILL.md` is ~49k**; plugin `dependencies` undocumented; `CLAUDE_PLUGIN_ROOT` only in hooks | M |
| OpenCode | **Likely works** | `npx skills add` (reads `.claude/skills`, `.agents/skills`) | no plugin compat; `skill` tool + Task subagents + `question` tool all exist; 2-min shell timeout fits `run-bg` | S |
| Cursor | **Likely works, sandbox risk** | `npx skills add`, or a `.cursor-plugin` manifest (not shipped for stardust) | default Auto-review sandbox blocks network except package registries — crawling live sites and Chromium need escalation (*unverified* for headless Chromium) | M |
| Codex CLI | **Needs work** | `npx skills add` → `.agents/skills`; `$name` invocation already matches stardust's `$stardust <x>` prose | network off in `workspace-write`; **Playwright Chromium crashes under macOS Seatbelt** (needs escalated / full-access); ask-user only in Plan mode, Default-mode flag auto-resolves to an empty answer; smaller context than the 500–900k the wait discipline assumes | M–L |
| Antigravity | **Needs work** | `npx skills add` → `.agents/skills` (global path differs per surface) | own plugin format (`name`/`description` only, no deps); headless `--print-timeout` 5 min and soft-denied approvals exit 0 | M |
| Hermes Agent | **Needs work, low priority** | `npx skills add` → `.hermes/skills` (+ `hermes skills trust`); not in `gh skill` | general-purpose agent that can rewrite its own skills; 24k-char body lint (advisory); `-q` mode denies dangerous commands; exposes `${HERMES_SKILL_DIR}` | M |
| Pi | **Needs work** | `npx skills add` → `.agents/skills` (Pi does not read `.claude/skills`) | **no subagents, no ask-user tool** (extensions only), no approvals/sandbox; MCP built in since 0.99.0 | M (shared with fan-out fallback) |
| Gemini CLI | **Deprioritise** | `npx skills add` → `.agents/skills` | stopped serving personal tiers 2026-06-18 (migrated to Antigravity CLI); otherwise capable (skills, subagents, `ask_user`, vision) | S if pursued |

Every harness on the list now loads `SKILL.md` natively and reads
`.agents/skills/` at project scope, so **discovery is no longer the problem**.
The gaps are packaging, how scripts and impeccable are located, orchestration
assumptions, skill size, and sandbox/runtime defaults.

## What stardust assumes of a harness

| Capability | Criticality | Neutral today? |
|---|---|---|
| Load 16 skills, route to siblings by bare name | hard | yes — master falls back to "read the sub-skill's SKILL.md and follow it inline" (`skills/stardust/SKILL.md:89-99`) |
| Invoke impeccable and read its files on disk | hard | partly — `impeccable-version-check.mjs` only knows Claude Code and Copilot install dirs |
| Locate own scripts (`node skills/<skill>/scripts/…`, 64 sites) | hard | partly — relative to the plugin root; in a loose install the root is `.agents/skills/` and there is no `skills/` segment |
| Shell + Node 22 + Playwright/Chromium + localhost servers + outbound network | hard | yes, but sandbox defaults differ (Codex, Cursor, Copilot cloud) |
| Long steps through `run-bg` (`--max` 100 s) | hard for replica/rollout gates | yes — fits 120 s (Grok, OpenCode, Claude), 180 s (Hermes), Codex's 30 s yield + poll; Antigravity headless 5-min total cap does not fit |
| Vision on local PNGs (extract 2.5, prototype gate, deploy eyeball, reskin, audit) | effectively hard | all ten can read images; Copilot drops images on BYOK models; Codex `view_image` by path reported unreliable |
| Subagent fan-out (deploy Step 7, replica C-deliver, rollout waves, uplift, extract `--prep`) | degrades | **no sequential fallback** for deploy Step 7 (`deploy/SKILL.md:611`), replica C0–Cn, rollout waves; Pi has no subagents, Grok/Cursor allow depth 1 |
| Interactive gates (plain prose, no tool names) | hard when attended | yes; but headless runs only go hands-off with an explicit flag/phrase |
| MCP (refero, Playwright MCP) | optional | ladder exists; tool names `mcp__refero__*` are Claude's naming |
| Large context | degrades | `deploy/SKILL.md` 196 KB, `prototype` 73 KB; wait discipline assumes 1M-context sessions and a 5-min prompt-cache TTL |

## Work packages

### WP1 — Packaging and install (S, unblocks Cursor/Codex/Grok plugin paths)
- `.tessl-plugin/plugin.json` is stale (0.21.1, 13 skills; missing `dynamics`, `qa`, `spec`).
- Root `.cursor-plugin/marketplace.json` lists only `app-builder`; add stardust and a `.cursor-plugin/plugin.json` (Cursor expands `${CLAUDE_PLUGIN_ROOT}`).
- Codex plugin manifest (`.codex-plugin/plugin.json` or root Agent Plugins `plugin.json`) once CLI-only install is confirmed.
- Grok: verify `grok plugin install adobe/skills#…` loads stardust and whether `dependencies` resolve; impeccable ships a `.grok-plugin` manifest we can mirror.
- README: per-harness install table (stardust + impeccable — impeccable's own `npx impeccable install --providers=…` covers all ten), recommend `npx skills add --copy`, extend "Verified on" with Antigravity, Pi, Hermes.
- `compatibility` lists `playwright-cli on PATH` in 15 skills and README says several skills call it; no skill body does. Drop it.

### WP2 — Locate scripts, impeccable and version mechanically (S–M)
- `impeccable-version-check.mjs`: add discovery for `.agents/skills`, `~/.agents/skills`, `~/.grok`, `~/.cursor/skills`, `~/.config/opencode/skills`, `~/.pi/agent/skills`, `~/.hermes/skills`, `~/.gemini/*/skills`, project dot-dirs; fall back to `pbakaus/impeccable` upstream when no Claude marketplace file exists (today `latest` is null off Claude Code).
- One rule for the skill base directory ("the directory containing this SKILL.md"; `${HERMES_SKILL_DIR}` on Hermes, the listed path on Codex/Pi, the returned base dir on OpenCode v2) and write commands as `<skill-dir>/scripts/…` / `<skills-root>/<sibling>/scripts/…` so they hold in both plugin and loose layouts.
- Provenance version reads `../../../.claude-plugin/plugin.json` (`qa/scripts/lib.mjs:22`, `rollout/scripts/inventory.mjs:69`) and falls to 0.0.0 in loose installs: ship the version in SKILL.md `metadata.version` or a `VERSION` file.
- Generic bare names (`deploy`, `diff`, `audit`, `qa`, `spec`, `extract`, `migrate`) collide easily in flat namespaces; Copilot silently prefers project/personal skills over plugin skills. Decide whether to prefix (`stardust-deploy`) — a contract change, minor bump — or detect collisions in Setup.

### WP3 — Harness-neutral prose, enforced (S)
Extend `evals/lint/harness-neutral.mjs` to catch what slips through today:
`Skill { skill: "impeccable:impeccable" … }` (`prototype/SKILL.md:790,793,976`),
`mcp__refero__*` (`audit/SKILL.md:90,228`, `stardust/reference/reference-research.md:27`),
`WebSearch`/`WebFetch` tool names, `promptCacheTtl`/settings.json
(`stardust/SKILL.md:291`), "plan mode", CLAUDE.md-only companion docs, the
"~2-minute default" shell timeout, macOS-only `open` (`uplift`, `audit`, `migrate`).
Then add one short harness-notes reference (ask tool, subagent spawn name,
background mechanism, shell timeout, skill dir per harness) that skills point
to instead of naming tools inline.

### WP4 — Orchestration fallbacks (M, required for Pi; protects every harness)
- Sequential fallback for deploy Step 7, replica C-deliver (C0 + per-cluster), rollout waves — same briefs, run in-line one cluster at a time, with the progress file as the hand-off.
- Note depth-1 nesting (Grok, Cursor): a coordinator that is itself a subagent cannot fan out.
- Headless detection: `codex exec`, `copilot -p`, `agy -p`, `grok -p`, `pi -p`, `hermes -q` sessions should either be told `--hands-off` or recognise they are unattended. Rule to add: **an empty or timed-out answer is not consent** (Codex Default-mode auto-resolve, Antigravity soft-deny exit 0).

### WP5 — Skill size (M, hard blocker on Grok)
- Split `deploy/SKILL.md` (196 KB ≈ 49k tokens) into a card plus section references, under Grok's 25k-token inline cap and ideally under Hermes' 24k-char advisory. `prototype` (73 KB ≈ 18k tokens) is next in line.
- Generalise the wait discipline: it is written for Claude's 1M context and prompt-cache TTL; Codex/Cursor/Copilot sessions run 128–400k and compact earlier.

### WP6 — Sandbox and runtime profiles (M)
- Runtime preflight should recognise the sandbox failure signatures (Chromium `MachPortRendezvousServer … Permission denied` under Codex Seatbelt; DNS/connection refused under Cursor's network allowlist) and print the harness's fix (Codex: `--sandbox danger-full-access` or `-c sandbox_workspace_write.network_access=true` plus escalation; Cursor: run mode / allowlist; Copilot cloud: `copilot-setup-steps.yml` + firewall allowlist).
- Antigravity headless: document `--print-timeout` for long phases.

### WP7 — Verification (M, the evidence the README table needs)
Generalise `evals/copilot-smoke/run.sh` into a per-harness smoke with the
same checks plus three runtime probes: (1) all 16 skills + impeccable listed,
(2) a sibling loads by bare name, (3) master Setup completes, (4) one
Playwright script captures a page, (5) the model reads a PNG and describes
it, (6) an attended gate stops and an unattended one goes hands-off.
Headless entry points: `codex exec --json`, `copilot -p`, `agent -p`
(Cursor), `grok -p`, `opencode run --format json`, `agy -p`, `pi -p`,
`hermes chat -q`. Fix the "all 15 stardust skills" label (checks 16).
The quality runner stays Claude Agent SDK only.

## Build pipeline or single source?

Impeccable keeps one source (`skill/SKILL.src.md`, `skill/agents/`) and
generates a per-harness tree (`.claude/`, `.agents/`, `.github/`, `.cursor/`,
`.grok/`, `.gemini/`, `.agent/`, `.opencode/`, `.pi/`, `.hermes/`) with
sentence-level placeholders (`{{ask_instruction}}`, `{{command_prefix}}`,
`{{scripts_path}}`), `<harness>` blocks, per-harness subagent formats (Claude
md, Copilot `.agent.md`, Cursor md, Codex TOML inside the skill) and
generated `reference/degraded/<role>.md` for harnesses without subagents.

Stardust has 16 skills, ~635 KB of SKILL.md and ~1 MB of references, no
shipped agents, no hooks and no `$ARGUMENTS`. Its prose is already mostly
neutral. **Recommendation: stay single-source** and close WP2–WP5; adopt
impeccable's pipeline only if per-harness wording becomes unavoidable (most
likely trigger: shipping named subagents for the fan-out steps). Reusable
lessons either way: no `agents` key in the Claude `plugin.json`;
`npx skills add --copy`; Codex frontmatter minimal (version under
`metadata`); `allowed-tools` breaks Claude skill activation under `claude -p`.

## Suggested order

1. WP1 + WP3 lint + WP2 locator — cheap, unblocks honest install docs.
2. WP7 smoke on the three harnesses closest to working: Copilot (re-verify), OpenCode, Grok.
3. WP5 deploy split (Grok) and WP4 sequential fallback (Pi, and robustness everywhere).
4. WP6 sandbox profiles, then smoke Codex, Cursor, Antigravity.
5. Hermes and Gemini CLI on demand.
