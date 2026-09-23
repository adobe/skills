# Stardust on GitHub Copilot and other agents

Assessment written 2026-09-17 on the `copilot-compat` branch. It answers four
questions: what stardust needs to be installable and usable in GitHub Copilot,
whether impeccable's multi-harness approach is the right model, how far
compatibility can be pushed to other agents, and what each option costs to
maintain. Every "works" claim below was exercised on this date against
Copilot CLI 1.0.85, stardust 0.22.0 and impeccable 4.3.1 unless marked
otherwise.

## 1. Short answer

Stardust already installs into Copilot CLI with two commands and no repo
change. Copilot reads Claude-style `.claude-plugin/plugin.json` and
`marketplace.json`, so the adobe/skills marketplace is a Copilot marketplace
as it stands:

```bash
copilot plugin marketplace add adobe/skills
copilot plugin install stardust@adobe-skills      # "Installed 15 skills"
copilot plugin marketplace add pbakaus/impeccable
copilot plugin install impeccable@impeccable      # "Installed 1 skill"
```

An authenticated headless session then lists all fifteen stardust skills plus
`impeccable`, and running the `stardust` master skill's Setup section resolves
its own plugin path, finds impeccable under `~/.copilot/installed-plugins/`,
runs the bundled version-check script and reads impeccable's command
registry.

What does not work is stardust's *wording*, not its packaging. Five classes of
Claude-Code-specific assumptions in the skill text break or degrade on
Copilot, and two of them are impeccable API drift that breaks on Claude Code
too. Fixing all of them is prose and a few small script edits, roughly one to
two days, with no build step and no per-harness output.

Impeccable's compile-to-seventeen-providers approach is the right approach
for impeccable and the wrong one for stardust. The reasons are in section 4.

## 2. What was verified

| Check | Result |
|---|---|
| `copilot plugin marketplace add adobe/skills` | Marketplace `adobe-skills` added. Copilot read the existing `.claude-plugin/marketplace.json`. |
| `copilot plugin install stardust@adobe-skills` | Installed 15 skills; version reported as 0.22.0, taken from `plugin.json`, not the stale 0.20.0 in `marketplace.json`. |
| Direct install `pbakaus/impeccable:plugin` | Works, but Copilot prints a deprecation warning: only `plugin@marketplace` installs will be supported. Use impeccable's own marketplace instead. |
| `copilot plugin install impeccable@impeccable` | Works. `dependencies` in stardust's `plugin.json` is ignored by Copilot; impeccable has to be installed by hand. |
| Installed payload | Copilot copies the whole plugin directory: 271 files, 3.5 MB, of which `evals/` (452 KB) and `notes/` (132 KB) are never loaded by a skill. |
| Headless skill listing | All 15 stardust skills and `impeccable` listed by name. Names are **flat**: `extract`, `deploy`, `qa`. No plugin prefix. |
| `skill(stardust:extract)` | "Skill not found". `skill(extract)` loads the stardust extract skill. |
| Master skill Setup, steps 1 to 6 | 1 ran (see caveat below), 2 failed with file-not-found on impeccable's `load-context.mjs`, 3 to 6 behaved correctly on an empty scratch directory. |
| `<plugin>` and `<harness>` placeholders | The model substituted the real installed paths without help. |

Caveat on step 1: `impeccable-version-check.mjs` reported "impeccable 4.3.1
installed — current" because it read `~/.claude/plugins/installed_plugins.json`
on a machine that also has Claude Code. On a Copilot-only machine it reports
"unknown" for the installed side. The script never looks at
`~/.copilot/installed-plugins/`.

## 3. What stardust must change

Ordered by how much they break, with the count of places to touch.

### 3.1 Namespaced sub-skill names (181 references in 56 files)

Every routing table and cross-reference uses the Claude Code plugin form
`stardust:extract`. Copilot CLI exposes plugin skills under their bare
`name:`, so the master skill's routing table names skills that do not exist
there. Copilot in VS Code namespaces plugin skills as `/plugin:skill`, so the
same text may work in one Copilot surface and fail in another.

Fix: write skill references once, harness-neutrally. Name the skill by its
bare `name:` and say how it is addressed: "the `extract` skill
(`stardust:extract` in Claude Code, `/extract` or the `skill` tool elsewhere)".
Put the addressing note in the master skill once and drop the prefix
everywhere else. This is a search-and-replace with a review pass, not a
rewrite. The `$stardust extract` command form (108 references) is stardust's
own vocabulary for the user and can stay.

Flat namespaces also mean collisions. Stardust's names (`extract`, `audit`,
`deploy`, `qa`, `diff`, `migrate`) do not collide inside adobe/skills today,
but sixteen names already collide between the two AEM plugins, so a Copilot
user installing several Adobe plugins already gets ambiguous `skill()` calls.
That is a marketplace-level decision, not stardust's, and prefixing stardust's
skill names (`stardust-extract`) would change every Claude Code invocation, so
it is not recommended unless the marketplace adopts a convention.

### 3.2 Impeccable API drift (breaks everywhere, not only on Copilot)

Stardust targets impeccable's pre-4.x JavaScript layout. Impeccable 4.x ships a
Rust engine behind a launcher, and three things stardust calls are gone:

| Stardust calls | Impeccable 4.3.1 has | Where |
|---|---|---|
| `scripts/load-context.mjs` | `scripts/impeccable context` (launcher, downloads the engine once) | `stardust/SKILL.md` Setup step 2 |
| `teach` command | `init` | 11 references, mostly `reference/impeccable-command-map.md` |
| "the 23 impeccable commands" | 24 (`generate` added) | master skill, command map |

`command-metadata.json` still exists and is still the right source of truth,
so the command map's fallback rule holds. Step 2 must call the launcher and
tolerate its first-run download; on Copilot the launcher prompted for one
command approval in impeccable's own smoke test, which is normal.

### 3.3 Impeccable discovery and the version check

The master skill tells the model to look for impeccable in `.claude/skills/`,
`.agents/skills/`, `.cursor/skills/`. Copilot installs plugins under
`~/.copilot/installed-plugins/<marketplace>/<plugin>/skills/`. The model found
it anyway, but the instruction should say "wherever the harness installs
skills or plugins, including the harness's plugin cache" and give the Copilot
path as an example.

`impeccable-version-check.mjs` should read Copilot's
`~/.copilot/installed-plugins.lock` (or the `.claude-plugin/plugin.json` inside
the installed directory) as a second "installed" source, and its update hint
should print the `copilot plugin update` form when that is where it found
impeccable. The upstream check over raw.githubusercontent.com is already
harness-neutral.

### 3.4 Claude-specific tool names (about 30 references in 12 files)

- `Skill { skill: "impeccable:impeccable", args: "craft ..." }` in
  `prototype/SKILL.md`. On Copilot the equivalent is the `skill` tool with
  name `impeccable`, then the sub-command as prompt text. Say "invoke the
  impeccable skill with `craft <description>` as its argument, using the
  harness's skill-invocation tool" and keep the Claude example as one line.
- "dispatch the `Explore` subagent" in `deploy/SKILL.md`, and the
  design-review and per-variant subagents in `prototype` and `uplift`.
  Copilot CLI has a general `task` subagent and custom agents; Codex and
  Gemini have their own. Phrase as "a read-only subagent where the harness
  offers one, otherwise do the search inline" and keep the isolation
  requirement (uplift's workspace copies) as the contract.
- The "Claude Code only announces plugin updates through marketplace
  auto-update" sentence in the master skill is true and harmless but should
  not be the only harness mentioned.

### 3.5 Prerequisites that no harness installs for you

Stardust's 72 bundled scripts import `playwright`, `pngjs` and `pixelmatch`
from the project's `node_modules`, and 24 skill files call `playwright-cli`
from the adobe/skills `web` plugin. Copilot CLI ships no browser tooling by
default (only the GitHub MCP), and the cloud agent's built-in Playwright is
not what these scripts use. This is already the case on Claude Code; the
skills' own `npm i -D playwright --no-save` probe handles it. The change is
documentation: the README needs a prerequisites block naming Node 22+,
Playwright with Chromium, and `playwright-cli`, so a Copilot user does not
discover them one failure at a time.

### 3.6 Packaging hygiene (small)

- Sync `marketplace.json` `version` (0.20.0) with `plugin.json` (0.22.0), or
  have `prepare-release.sh` write both.
- Consider excluding `evals/` and `notes/` from the installed payload. Copilot
  and Claude Code both copy the whole plugin directory; neither offers an
  ignore list, so the practical option is moving them one level up, next to
  the plugin, if the 600 KB matters. It does not affect behaviour.
- `deploy/SKILL.md` is 187 KB. No Copilot limit is documented for skills (the
  30,000-character limit is for custom agents), but it is loaded in full on
  every invocation on every harness. This is an existing cost, not a Copilot
  one.

## 4. Is impeccable's approach the right one for stardust?

What impeccable does: one source tree (`skill/SKILL.src.md`, `reference/`,
`agents/`), a 963-line `build.js` with a `PROVIDERS` table of seventeen
harnesses, provider-conditional blocks (`<codex>`, `<claude>`, `<gemini>`),
compile-time placeholders (`{{scripts_path}}`, `{{command_prefix}}`,
`{{ask_instruction}}`, `{{config_file}}`), per-provider subagent emission
(Claude markdown, Copilot `.agent.md`, Cursor markdown, Codex TOML), per-provider
hook manifests, a GitHub Action that commits the generated output into
twenty-two dot-directories at the repo root, a slim `plugin/` package for
Claude and Grok, a Cursor plugin, a VS Code extension published to the
Marketplace, an OpenAI plugin zip, and an `npx impeccable install` CLI that
detects harnesses and writes payload plus hooks. Build, transformers and
packagers are about 2,500 lines with ten test files, plus a hand-maintained
`docs/HARNESSES.md` capability matrix.

Impeccable needs that machinery because of four properties stardust does not
have:

1. **Hooks.** Impeccable's value includes an edit-time detector, which needs a
   native hook manifest per harness (five formats today). Stardust has no
   hooks.
2. **Subagents in the package.** Four agents shipped in three on-disk formats.
   Stardust references subagents in prose but ships none.
3. **A native binary.** The launcher and per-provider `scripts_path` exist
   because the engine must be found relative to the skill. Stardust's scripts
   are plain `node` files that the model already locates by path.
4. **One slash command with 24 sub-commands.** `{{command_prefix}}` and
   `{{command_hint}}` exist because `/impeccable` versus `$impeccable`
   matters for a skill whose whole UX is a slash command. Stardust's
   frontmatter is already spec-only (`name`, `description`, `license`) and
   uses no harness extension fields.

The ecosystem has also moved since impeccable built this. Copilot reads
Claude plugin manifests natively. Cursor, Codex, Copilot and Kiro accept the
Agent Plugins 1.0 root `plugin.json` (published August 2026 by Amazon,
Cursor, Microsoft, OpenAI, Vercel and Google). `npx skills add` reads
`.claude-plugin/plugin.json` and installs to about eighty agents.
`gh skill install` (GitHub CLI 2.90+, preview) covers forty-six. Amp reads the
Claude plugin cache directly. Impeccable's own generated trees for Copilot
and Claude differ only in the `scripts_path` string and provider blocks.

Verdict: do not copy the build. Take two ideas from it and nothing else:

- Write harness-neutral prose once instead of compiling it per provider.
  Where impeccable substitutes `{{ask_instruction}}`, stardust can write
  "ask the user" and let each harness's model pick its tool.
- Keep a recorded per-harness smoke, the way impeccable records its Copilot
  smoke in `docs/VSCODE-EXTENSION.md`. The headless commands in section 2
  cost about 1.5 Copilot credits per run and take under two minutes.

## 5. How far can compatibility go?

Three tiers, by what has to be true for stardust to run, not just be found.

**Tier 1, plugin install, no repo change.** Claude Code, GitHub Copilot (CLI,
VS Code, cloud agent), Grok Build (Claude-plugin compatible), Amp (reads the
Claude plugin cache). Copilot is verified; the other two are documented but
not exercised here.

**Tier 2, skills-only install through a generic installer.** `npx skills add
adobe/skills` and `gh skill install adobe/skills --all` copy each SKILL.md
directory into the agent's skills folder. That reaches Codex, Cursor, Gemini
CLI, OpenCode, Windsurf, Kiro, Zed, JetBrains Junie, Roo, Cline, Goose,
Antigravity, Trae and the rest of the `.agents/skills/` adopters. Stardust's
skills carry their `scripts/` and `reference/` with them, which every listed
agent supports. What is lost: plugin grouping (fifteen loose skills), the
`dependencies` hint, and any notion of versioned update beyond
`skills-lock.json` or `gh skill update`.

**Tier 3, capability floor.** Installability is not usability. A harness
runs stardust only if it has: a shell tool that can run `node` and `npm`; a
project-local Playwright with Chromium; `playwright-cli` on PATH; impeccable
installed the same way and reachable at a path; enough context to load a
40 to 187 KB skill file; and, for `uplift` and the optional design review, a
subagent primitive or a graceful inline fallback. Copilot CLI, Codex, Cursor,
Gemini CLI and OpenCode meet the shell and context requirements. Browser and
subagent support vary and are exactly what a per-harness smoke should record.

Impeccable's "8 or 9" is now seventeen emission targets; stardust can be
*installable* on roughly the same set through Tier 1 plus Tier 2 with zero
generated output, and *verified usable* on as many harnesses as someone is
willing to smoke-test. The honest recommendation is to claim two verified
harnesses (Claude Code, Copilot CLI), document the installer path for the
rest, and add harnesses to the verified list one smoke at a time.

## 6. Cost of each option

| Option | One-time | Recurring | What you get |
|---|---|---|---|
| A. Prose fixes (3.1 to 3.5) plus README install and prerequisite sections | 1 to 2 days | None beyond normal skill editing; write neutral prose from now on | Copilot CLI, VS Code and cloud agent usable; the impeccable drift fixed for Claude Code too |
| B. A plus static manifests: Agent Plugins 1.0 root `plugin.json`, Cursor `.cursor-plugin/plugin.json` (the app-builder pilot already has one), keep `.tessl-plugin` | Half a day | Version sync in `prepare-release.sh`; three JSON files that rarely change | Codex, Cursor and Kiro plugin installs with grouping; Tessl registry |
| C. A per-harness smoke in `evals/` (headless Copilot run, later Codex and Gemini) | Half a day for Copilot | 1 to 2 credits and two minutes per run; one recorded result per release | A "verified on" list that means something |
| D. Impeccable-style build: source templates, provider table, generated trees, sync workflow, installer CLI, VSIX | Weeks | Track seventeen harnesses' file layouts and frontmatter quirks; regenerate and commit on every skill edit; test the build itself | Nothing stardust needs that A plus B do not already give |

Recommendation: A, then C for Copilot, then B when a Codex or Cursor user
asks. Not D.

## 7. Concrete next steps

1. Replace `stardust:<name>` references with bare skill names plus one
   addressing note in `skills/stardust/SKILL.md`.
2. Update Setup step 2 to run `scripts/impeccable context` through the
   launcher; rename `teach` to `init` and "23" to "24" in the command map and
   master skill.
3. Extend `impeccable-version-check.mjs` to read Copilot's installed-plugins
   lock and print the matching update command; widen the "where impeccable
   lives" instruction.
4. Neutralise the Skill-tool, `Explore` and subagent phrasing in `prototype`,
   `deploy` and `uplift`.
5. Add "Install" and "Prerequisites" sections to `plugins/stardust/README.md`
   (started on this branch) and a Copilot CLI section to the root README
   (started on this branch).
6. Sync `marketplace.json` to 0.22.0 and teach `prepare-release.sh` to do it.
7. Add `evals/copilot-smoke/` with the two headless commands from section 2
   and a recorded result.

## 8. Work breakdown for the tiered plan

Grounded on 2026-09-17 counts. "Tier 1" is plugin install with no repo change
(Claude Code, Copilot, Grok Build, Amp); "Tier 2" is loose skills through
`npx skills add` or `gh skill install`; "verified" means a recorded smoke.

### Skill text (makes Tier 1 usable, fixes Claude Code drift)

| # | Change | Files | Notes |
|---|---|---|---|
| T1 | Replace `stardust:<name>` skill references with bare names plus one addressing note | 56 files, 181 refs; heaviest in `stardust/reference` (7), `direct/reference` (7), `prototype/reference` (6), `extract/reference` (5) | Keep `$stardust <cmd>` user vocabulary (108 refs). Also in 12 skill `description:` fields, which list `/stardust:audit`-style trigger phrases; those are what Copilot and `npx skills` show users. |
| T2 | Setup step 2: call impeccable's launcher (`<impeccable-skill>/scripts/impeccable context`) instead of `load-context.mjs`; tolerate the first-run engine download and one command approval | `skills/stardust/SKILL.md` | Launcher path resolves from the impeccable skill directory, whatever harness installed it. |
| T3 | `teach` to `init`; "23 commands" to "24" | 7 files, 11 refs (`direct/SKILL.md`, `extract/SKILL.md`, 5 under `stardust/reference`); 3 refs for the count | `impeccable-command-map.md` gains a `generate` entry. |
| T4 | Widen "where impeccable lives": add harness plugin caches (`~/.copilot/installed-plugins/*/impeccable/skills/impeccable`, `~/.claude/plugins/cache/...`) to the three project dirs listed | `skills/stardust/SKILL.md` step 1 | |
| T5 | Neutralise Claude tool names: `Skill { skill: "impeccable:impeccable" }`, "`Explore` subagent", subagent spawning | `prototype/SKILL.md` (7), `prepare-migration/SKILL.md` (4), `audit/SKILL.md` (2) + `report-format.md`, `uplift/SKILL.md` (2), `deploy/SKILL.md` (1) | Pattern: state the contract (isolation, read-only, parallel where possible), then "use the harness's skill-invocation or subagent tool; fall back inline if there is none". |

### Scripts

| # | Change | File | Notes |
|---|---|---|---|
| S1 | Add a Copilot "installed" source: glob `~/.copilot/installed-plugins/*/impeccable/.claude-plugin/plugin.json` and `_direct/*impeccable*`; Copilot keeps no registry (the `.lock` is empty), so the installed directory's own manifest is the only version source | `skills/stardust/scripts/impeccable-version-check.mjs` | Print `copilot plugin update impeccable` when that is where it was found; keep `--local` for skills-only installs. |
| S2 | No other script changes. The 72 `.mjs` files are already path-neutral and run via `node`; the `<plugin>` placeholder resolved correctly on Copilot. | | |

### Metadata

| # | Change | File | Notes |
|---|---|---|---|
| M1 | Sync `version` to `plugin.json` (0.22.0 vs 0.20.0) and make `scripts/prepare-release.sh` update the marketplace entry on release | `.claude-plugin/marketplace.json`, `scripts/prepare-release.sh` | Five other plugins have no version in the marketplace at all. |
| M2 | Add `compatibility:` to each of the 15 `SKILL.md` frontmatters: "Requires Node 22+, Playwright with Chromium in the project, playwright-cli on PATH, and the impeccable skill installed." | 15 files | Spec-standard field, 500 chars max, honoured or safely ignored everywhere. This is the only cross-agent place to state the impeccable dependency. |
| M3 | Optional, Tier 2 grouping for Codex, Cursor, Kiro: root `plugin.json` per Agent Plugins 1.0 (`$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`; schema is closed, skills must sit in `skills/`, which they already do) | `plugins/stardust/plugin.json` | Also `.cursor-plugin/plugin.json`, copying the app-builder pilot. Both are static; version sync goes in `prepare-release.sh`. |
| M4 | Leave `dependencies` in `.claude-plugin/plugin.json`; only Claude Code reads it, and it is correct there. | | |

### READMEs and docs

| # | Change | File |
|---|---|---|
| R1 | Install and Prerequisites sections (done on this branch) | `plugins/stardust/README.md` |
| R2 | Copilot CLI section (done on this branch) | root `README.md` |
| R3 | Tier 2 instructions. `npx skills add adobe/skills --list` shows 108 flat skills for the whole repo, so stardust users need the per-skill form: `npx skills add adobe/skills -s stardust -s extract -s direct ... ` (15 names) plus `npx skills add pbakaus/impeccable -s impeccable`. State plainly that this path installs loose skills with no grouping or dependency check. | `plugins/stardust/README.md` |
| R4 | A "Verified on" table: harness, version, date, what was run. Start with Claude Code and Copilot CLI 1.0.85. | `plugins/stardust/README.md` |
| R5 | Tier 1 for Grok Build and Amp: documented as "expected to work, not verified" until someone runs the smoke. | `plugins/stardust/README.md` |

### Verification

| # | Change | Location | Notes |
|---|---|---|---|
| V1 | Copilot smoke: the two headless prompts from section 2 (list skills; run Setup only and report) as a script with expected assertions (15 names present, `extract` loads, no file-not-found in Setup) | `evals/copilot-smoke/` | About 1.5 credits and two minutes per run; run per release, record the result in R4. |
| V2 | Repo-wide guard in `npm run validate`: fail if any `SKILL.md` under `plugins/stardust` contains `stardust:` followed by a skill name, or a Claude-only tool name outside an explicitly marked "Claude Code" example | root `package.json` or `.github/workflows/validate.yml` | Cheap regex; stops the prose from drifting back. |
| V3 | Same smoke for Codex or Gemini CLI once someone has one installed; each adds a row to R4 | `evals/<harness>-smoke/` | Not needed to ship Tier 1. |

### Sequence

1. T1 to T5 and S1 in one pass (one to two days; T1 is mechanical, T5 needs judgement).
2. M1, M2, R3 to R5, V2 (half a day).
3. V1 and the first recorded run (half a day).
4. M3 only when a Codex, Cursor or Kiro user asks.

### Out of scope

- Renaming skills to `stardust-*` for flat namespaces: changes every Claude Code invocation; only worth it if the whole marketplace adopts a prefix convention.
- Moving `evals/` and `notes/` out of the installed payload: 600 KB, no behavioural effect.
- Anything generated per harness.

## 9. Validation record (2026-09-17)

- **Copilot CLI 1.0.85 smoke** (`evals/copilot-smoke/run.sh --plugin-dir`): 5/5 on the PR stack. Skill listing, bare-name load, master Setup with impeccable found, no missing plugin file, no call to the removed loader. First attempt scored 4/5 because the prompt let the model count an empty project's absent `PRODUCT.md` as a failure; the prompt now excludes absent project state.
- **Claude Code evals** (`evals/runner`, baseline `main` vs the stack): direct-from-phrase N=3 vs N=3, ten stable criteria 3/3 on both sides, the two documented-noisy criteria 1/3 → 0/3 with the same failure mechanism as the baseline's own failing runs. extract-multipage N=1 vs N=1, 12/13 equal; `provenance_stamped` regressed because the new PRODUCT.md instruction displaced stardust's provenance block, fixed in the stack; the rerun scored 100/100 with 13/13 criteria. Details and tables in `evals/BASELINE.md`.
- **Static**: `npm run validate` and the new harness-neutral lint pass on every branch of the stack.
- **CI caveat**: the repository's PR workflows run only for PRs whose base is `main`, so the stacked PRs #369–#371 show only the CLA and Kodiak checks until #368 merges and GitHub retargets them. Tessl Skill Review on #368 fails on `dynamics` at 78% against an 80% bar; the reviewer's notes concern that skill's pre-existing body (worked examples, reference bundle), not the one-line `compatibility` addition. `main` has no branch protection, so the check is informational.
