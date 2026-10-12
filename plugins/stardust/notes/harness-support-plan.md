# Plan — stardust on eight harnesses

Target: Claude Code, GitHub Copilot, Grok Build, OpenCode, Cursor, Codex CLI,
Antigravity, Pi. Builds on the gap analysis in `harness-compatibility.md`.
Hermes Agent and Gemini CLI are out of scope (Gemini CLI's personal tiers
moved to Antigravity CLI).

## Definition of supported

A harness is **supported** for a stardust release when all of these hold and
are recorded in `evals/harness-smoke/RECORDED.md`:

1. **Install.** One documented command sequence installs stardust and
   impeccable from a clean machine (`README.md` § Installing, per harness).
2. **Conformance smoke, 8/8:** all 16 skills + impeccable listed; a sibling
   loads by bare name; master Setup completes; scripts sync into the project
   and one runs `--help`; one Playwright capture of a localhost fixture; one
   live-network fetch; the model reads a PNG and describes it correctly; an
   attended gate stops, an unattended run goes hands-off.
3. **Golden path A (core):** `extract` (2-page fixture) → `direct --hands-off`
   → `prototype` (1 page) → `diff` produces the expected artifacts under
   `stardust/` with no missing-file or missing-tool failure.
4. **Golden path B (delivery):** `deploy` of one migrated page to a sandbox
   EDS repo passes its own Step 10 contract.

Golden paths check that the pipeline *runs*; design quality stays measured by
the Claude-only eval runner. Path B runs per minor release, path A and the
smoke per release.

## Decisions

D1, D2 and D4 adopted as recommended (2026-10-12). D6: accounts are
requested before M2 starts.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Single source vs impeccable-style per-harness build | Single source + one `harness-notes.md` adapter table. Revisit only if named subagents get shipped. |
| D2 | Bare skill names (`deploy`, `diff`, `qa`) vs prefixed (`stardust-deploy`) | Keep bare names; Setup detects a shadowing skill of the same name and warns. Prefixing is a breaking contract for every existing user. |
| D3 | Distribution per harness | Native plugin where the harness reads a manifest we can ship (Claude, Copilot, Grok, Cursor, Codex); `npx skills add --copy` for OpenCode, Antigravity, Pi. |
| D4 | One script convention | Everything runs from the project copy `stardust/scripts/<skill>/` (already 68 of 136 call sites); the skill tree is only the copy source. |
| D5 | Models for open harnesses | OpenCode and Pi verified with one vision-capable frontier model each; recorded in RECORDED.md, others "may work". |
| D6 | Harness accounts | Codex (ChatGPT plan), Cursor (`CURSOR_API_KEY`), Grok (SuperGrok / `XAI_API_KEY`), Antigravity (Google login), model keys for OpenCode and Pi. Needed before M2. |

## M1 — Foundation (harness-agnostic, every harness benefits)

Each item is one PR with its tests; `npm run lint:stardust` green; prose
moves quote `prose-delta.mjs`.

**PR1 — Packaging hygiene (patch).**
`.tessl-plugin/plugin.json` to current version with all 16 skills; drop
`playwright-cli on PATH` from the 15 `compatibility` fields and the README;
fix the copilot-smoke "15 skills" label; README install section restructured
as a per-harness table (filled in by M3).

**PR2 — One script location (minor, contract change).**
- Setup resolves the stardust skills root once: the parent of the directory
  holding the master `SKILL.md` — `<plugin>/skills/` in a plugin,
  `.agents/skills/` (or the harness's dir) in a loose install.
- New `skills/stardust/scripts/sync-scripts.mjs`: copies every skill's
  `scripts/` byte-identical to `stardust/scripts/<skill>/`, writes
  `stardust/scripts/VERSION` (stardust version + source root + harness
  guess). Idempotent, `--check` for staleness.
- Rewrite the 64 `node skills/<x>/scripts/…` and 4 `node <plugin>/skills/…`
  call sites to `node stardust/scripts/<x>/…`; `extract`'s copy step calls
  the sync.
- Provenance reads `stardust/scripts/VERSION` (fixes the 0.0.0 fallback in
  `qa/scripts/lib.mjs`, `rollout/scripts/inventory.mjs`).
- `script-paths` lint understands the single convention.

**PR3 — Find impeccable anywhere (patch).**
`impeccable-version-check.mjs` discovers impeccable in every target layout
(Claude and Copilot plugin caches, Grok and Cursor plugin dirs,
`.agents/skills`, `~/.agents/skills`, `~/.cursor/skills`,
`~/.config/opencode/skills`, `~/.pi/agent/skills`,
`~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills`, project dot
dirs); defaults the upstream to `pbakaus/impeccable` when no Claude
marketplace file exists; prints the right update command per layout
(`npx impeccable install --providers=…` for loose installs). Setup step 1
uses `--where` only. Fixture-directory tests per layout.

**PR4 — Harness notes + lint v2 (patch).**
- `skills/stardust/reference/harness-notes.md`: one row per harness — ask
  tool, subagent primitive and nesting depth, background-process mechanism,
  foreground timeout, skill-dir exposure, image read, headless flags,
  sandbox profile needed.
- Extend `harness-neutral.mjs`: `Skill {` syntax, `impeccable:` namespace,
  `mcp__*` names, `WebSearch`/`WebFetch`, `promptCacheTtl`/settings.json,
  "plan mode", bare `open <file>`, hard-coded shell-timeout numbers.
- Fix the hits (`prototype/SKILL.md:790,793,976`, `audit/SKILL.md:90,228`,
  `reference-research.md:27,35`, `stardust/SKILL.md:291,296`, `uplift`,
  `audit`, `migrate` `open` calls) by pointing at harness-notes.

**PR5 — Orchestration that works without subagents (minor).**
- Sequential path for deploy Step 7, replica C-deliver (C0 + per-cluster),
  rollout waves: same brief files, one cluster at a time in-line, progress
  file as the hand-off; fan-out stays the default where available.
- Nesting rule: a coordinator that is itself a subagent never fans out
  (Grok, Cursor depth 1).
- Unattended detection: a non-interactive session (headless flags in
  harness-notes) without `--hands-off` stops at the first gate with a clear
  message instead of guessing; **an empty or timed-out answer is never
  consent** (Codex Default-mode auto-resolve, Antigravity soft-deny).

**PR6 — Skill size (patch, prose moved not added).**
- Split `deploy/SKILL.md` (196 KB ≈ 49k tokens) into a card ≤ 60 KB plus
  `reference/` sections: Steps 3–5, 8, ENCODE contract, anti-patterns,
  checklist (natural seams at the existing `##`/`###` headings).
- Budget lint: every `SKILL.md` ≤ 80 KB (Grok inlines 25k tokens);
  `prototype` (73 KB) stays under with margin.
- Wait discipline rewritten in harness-neutral terms (no 1M-context or
  5-min-cache assumptions; "compaction-safe" checkpoints instead).

**PR7 — Runtime preflight (patch).**
`skills/stardust/scripts/runtime-preflight.mjs`: Node version, Playwright
import resolvability from the project, Chromium launch, localhost bind +
fetch, outbound fetch. On failure it matches known sandbox signatures
(Chromium `MachPortRendezvousServer … Permission denied`, DNS / ECONNREFUSED
under a network allowlist) and prints the fix for the detected harness from
harness-notes. Called from Setup and before any renderer.

**Follow-ups found during M1.**
- `migrate/fixtures/*.mjs` and `prototype/fixtures/mobile-nav-audit.mjs`
  import Playwright yet run from the skill tree (`node skills/<x>/fixtures/…`);
  move them under `scripts/` (with `--help`, index rows, tests) so the sync
  covers them.

## M2 — Conformance kit

`evals/harness-smoke/` replaces `evals/copilot-smoke/`:
- `run.mjs --harness <id> [--plugin-dir|--skills-dir]` with one adapter per
  harness: install-from-checkout, list skills, headless prompt
  (`claude -p`, `copilot -p`, `grok -p`, `opencode run --format json`,
  `agent -p` (Cursor), `codex exec --json`, `agy -p`, `pi -p`), restore.
- The 8 smoke checks + golden path A on a fixture site served from
  localhost (`evals/harness-smoke/fixture/`), so results are deterministic.
- Golden path B against a dedicated sandbox EDS repo + DA folder.
- Results to `results/` (gitignored); summary lines into `RECORDED.md`.
- Release checklist (`AGENTS.md` § Releases): smoke + path A on all eight
  per release, path B per minor; README "Verified on" updated from
  RECORDED.md.

## M3 — Per-harness enablement

Each harness = one PR: install docs, any manifest, harness-notes row
verified, fixes found by the smoke, RECORDED.md entry.

| Wave | Harness | Specific work beyond M1 | Main risk |
|---|---|---|---|
| 1 | Claude Code | Eval runner baseline vs post-M1 (`compare.mjs`) to prove no quality regression from the split and path rewrite. | Regression from PR2/PR6 |
| 1 | Copilot (CLI, VS Code, cloud agent) | Re-verify CLI; VS Code manual check (plugin skills are namespaced there); sample `copilot-setup-steps.yml` (Node 22, Playwright, Chromium) + firewall allowlist note for the cloud agent, which always runs hands-off. | Cloud firewall blocking crawl targets |
| 1 | Grok Build | Verify `grok plugin install` from adobe/skills and whether `dependencies` resolve; add `.grok-plugin/plugin.json` if needed (impeccable ships one); impeccable via `grok plugin install pbakaus/impeccable#plugin --trust`. | Undocumented dependency handling |
| 1 | OpenCode | `npx skills add --copy`; optional `.opencode/commands/stardust.md` bridge (skills are hidden from autocomplete); background via `nohup` until stable ships the `background` param; `question` tool row. | v1/v2 churn |
| 2 | Cursor | `plugins/stardust/.cursor-plugin/plugin.json` + entry in root `.cursor-plugin/marketplace.json`; run-mode guidance (allowlist or escalation for crawl + Chromium); AskQuestion is model-dependent, prose gates cover the rest. | Sandbox + headless Chromium (unverified) |
| 2 | Codex CLI | `.codex-plugin/plugin.json` (or skills-only if CLI plugin install stays app-only); documented profile: `workspace-write` + `network_access=true`, escalated/full-access for Playwright on macOS; `view_image` for vision gates; long steps through `run-bg` polling. | Seatbelt Chromium crash; smaller context |
| 3 | Antigravity | `.agents/skills` install; per-surface global path note; headless `--print-timeout` guidance for long phases; `ask_question` row. | Closed-source CLI, fast-moving |
| 3 | Pi | `.agents/skills` install (Pi ignores `.claude/skills`); relies on PR5 sequential path and prose gates; recommend running in a container (no approvals, no sandbox); vision-capable model required. | No subagents/ask tool; model variance |

## Sequencing and effort

```
M0 decisions + accounts ─┐
M1 PR1 PR3 PR4 ──────────┼─ PR2 ─ PR5 ─ PR6 ─ PR7
M2 kit (needs PR2, PR7) ─┘          └──────────────┐
M3 wave 1 ── wave 2 ── wave 3 ─────────────────────┴─ release
```

Rough single-engineer effort: M1 ≈ 9–11 days (PR2 and PR6 are the large
ones), M2 ≈ 4–5 days, M3 ≈ 1–3 days per harness (≈ 15 days), release and
docs ≈ 2 days — about six to seven weeks, roughly half that with M1 and M2
split across two people. Ship M1 as one minor release (contract change in
PR2/PR5), then add harnesses to "Verified on" as each wave lands.

## Risks

- **Unverified vendor claims** (Grok dependencies, Codex CLI-only plugin
  install, Cursor sandbox + Chromium, OpenCode background shell): each is
  the first task of its wave, resolved by running, not reading.
- **Model variance.** Stardust's long skills are tuned on Claude; a passing
  smoke does not prove output quality elsewhere. Porting the judge-based eval
  runner beyond the Claude SDK is a follow-up, not in this plan.
- **Harness churn.** OpenCode v2, Antigravity CLI and Grok Build are months
  old; RECORDED.md pins the version each result was measured on.
- **Cost.** Golden path B per harness per minor release needs a sandbox EDS
  repo and a DA token; budget it into the release checklist.
