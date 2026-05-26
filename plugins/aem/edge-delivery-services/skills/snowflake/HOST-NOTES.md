# Host Notes — snowflake

This file describes how the skill plugs into specific host
environments. It is **not** loaded by the agent at invocation time —
it's a reference for whoever installs/maintains the skill on a given
host.

The skill body (SKILL.md + phases/*.md) is deliberately host-
agnostic: it uses only `bash`, `node` (≥22), `git`, `curl`, `jq`,
`npm`/`npx`, `playwright-cli`, and POSIX `sed`/`grep`/`awk`. The
notes below document the per-host adapters that wire those phases
into the host's invocation model.

---

## Slicc

**Install:**
```
upskill aemcoder/skills --path skills/snowflake
```

This drops the skill into `/workspace/skills/snowflake/` inside the
Slicc cone container. SKILL.md's `<SKILL_DIR>` references resolve to
that path.

**Invocation:**
- Chat trigger: user phrases matching SKILL.md `description` activate
  the cone. The cone reads SKILL.md, then walks the phases.
- Sprinkle trigger: if the user clicks a "Convert with snowflake"
  button (if any UI is built), Slicc emits a sprinkle event of type
  `sprinkle`, skill `snowflake`. The cone handles the lick directly
  (does not delegate to a scoop) and walks the phases.

**Cone vs. scoop:** the skill is single-actor — no scoops are
spawned in this version. Future versions that fan out at Generate
should be cone-orchestrated (scoops cannot create scoops in Slicc).

**Browser:** `playwright-cli` is pre-installed in Slicc cones. Use
`--tab <id>` per the Slicc stateless-tab convention.

**Progress reporting (optional):** if the host wants live UI
updates, a wrapper script can read the project's `state.json`
between phases and emit `sprinkle send snowflake '<json>'` events.
The skill body itself does NOT emit sprinkle events — it only writes
state.json.

**Worktree config (optional):** the skill writes to the target EDS
repo (not the skills repo). The cone's working directory must be the
target repo when phases run. Slicc's typical pattern (`cd` into
`/shared/<target-repo>`) works fine.

---

## Claude Code (Anthropic CLI)

**Install (project-level, recommended):**
- Clone or symlink the skill bundle into `.claude/skills/snowflake/`
  in the target EDS repo.
- `<SKILL_DIR>` is `${CLAUDE_SKILL_DIR}` at runtime.

**Install (global, alternative):**
- Clone into `~/.claude/skills/snowflake/`.
- Works across any repo, but the skill assumes the CWD is an EDS
  overlay-substrate repo. CD before invoking.

**Invocation:**
- Manual: user types `/snowflake` in the chat.
- Automatic: the description triggers it on phrases like
  "convert this page to EDS overlay", "start run #N", etc.

**Subagent fan-out:** out of scope in v1. If a future version wants
parallelism, Claude Code's Agent tool with `subagent_type` and
`isolation: "worktree"` is the natural fit. For now, all phases run
in the main agent's context.

**Browser:** the agent must have `playwright-cli` available on the
`bash` PATH. Don't use `mcp__playwright__*` tools — those are
Claude-Code-only and break host portability.

**Auto-memory:** the skill notes in `phases/6-reflect.md` step 6.5
that hosts with persistent memory should record user-feedback rules.
Claude Code's auto-memory at
`~/.claude/projects/<project>/memory/MEMORY.md` is the canonical
location.

**Permission prompts:** the user will see permission prompts for
`git push`, `curl ... admin.da.live`, and similar mutating
operations. The skill's idempotency (state.json) means a denied
prompt can be retried after the user adjusts permissions.

---

## Generic shell / other hosts

The skill body is bash-and-node only. Any host that gives the agent
a bash shell can run it:

1. Make sure these are on PATH: `node` (≥22), `git`, `curl`, `jq`,
   `npm`, `playwright-cli`.
2. Place the skill bundle somewhere reachable. Make sure the
   assistant knows where (so `<SKILL_DIR>` references resolve).
3. CD into the target EDS repo. The skill's state files and outputs
   are project-relative.
4. The assistant walks the phases in order, reading each
   `phases/<N>-*.md` and executing the bash blocks within.

There's no progress-reporting primitive in generic shell — the
agent's text output IS the progress.

---

## The substrate installer (all hosts)

A target EDS repo can be a vanilla `adobe/aem-boilerplate` clone OR
a repo already partially modified by an earlier overlay attempt. The
skill ships an idempotent installer that brings either to the
expected overlay-substrate state:

```bash
node <SKILL_DIR>/scripts/install-substrate.mjs [--dry-run] [--force]
```

The installer is pure Node (built-ins only) and uses
`import.meta.url` to self-locate the bundled `assets/substrate/` directory
— it works regardless of where the skill is mounted on a given host.

It is driven by `<SKILL_DIR>/assets/substrate/MANIFEST.json` (declarative)
and stamps `.snowflake/config.json` with the installed version on
success. Files it overwrites are backed up to
`.snowflake/.backup/<timestamp>/`.

Phase 0 of the skill (see `phases/0-prereq.md`) drives this
installer. Subsequent invocations see the matching version in
`.snowflake/config.json` and skip Phase 0 silently.

## The `.snowflake/` directory (all hosts)

All per-repo state, project artifacts, and project-specific
knowledge live under `.snowflake/` at the target repo's root:

```
.snowflake/
├── config.json                ← substrate version + repo defaults
├── knowledge/                 ← OPTIONAL project-specific overrides
├── projects/<NNN>-<slug>/     ← per-run state, notes, learnings,
│                                input/output/diff artifacts
└── .backup/<timestamp>/       ← substrate-install rollback
```

Phase prompts resolve knowledge with
`.snowflake/knowledge/<file>.md` first, then bundled
`<SKILL_DIR>/knowledge/<file>.md`. Project-specific overrides win.

Defaults are set in `<SKILL_DIR>/assets/substrate/MANIFEST.json` and can
be overridden by writing to `.snowflake/config.json` directly:

```json
{
  "projectsDir": ".snowflake/projects",
  "daRoot": "/marketing",
  "branchPrefix": "snowflake-",
  "trunkBranch": "main",
  "tagPrefix": "snowflake-"
}
```

A maintainer extending the skill should treat `.snowflake/` as the
single source of truth for any per-repo state, NEVER write to the
skill bundle, NEVER write to `/workspace`.

## DA token & GitHub auth (all hosts)

The skill expects:

- A DA admin token from one of (in order):
  - `$DA_TOKEN` environment variable.
  - `~/.aem/da-token.json` (the cache the **da-auth** skill writes).
  - File shape: `{ "access_token": "<jwt>", "expires_at": <epoch_ms>, ... }`.
  - If absent: Phase 5 fails early. The user (or the calling agent)
    should invoke the **da-auth** skill to fetch one.

- GitHub auth via `gh` CLI (`gh auth status` should be green for
  the target repo's owner). Used for the `git push` in Phase 5 and
  for repo-identity lookups.

These are user prerequisites, not things the skill provisions.

---

## Resolving `<SKILL_DIR>` paths

Phase prompts reference files like `<SKILL_DIR>/knowledge/methodology.md`
or invoke `node <SKILL_DIR>/scripts/install-substrate.mjs`. The assistant
resolves `<SKILL_DIR>` to the absolute path of the directory containing
`SKILL.md`, then substitutes that absolute path into the bash invocation.

Per host:

- **Claude Code (plugin)**: the agent reads `SKILL.md` from the plugin
  cache (e.g. `~/.claude/plugins/cache/.../skills/snowflake/`) and
  substitutes that path. Bash CWD is the target EDS repo, not the
  skill directory — never use bare `./scripts/foo.mjs`.
- **`gh upskill` / `npx skills`**: skills are installed to
  `.claude/skills/snowflake/` at the target repo root; `<SKILL_DIR>`
  resolves there.
- **Slicc**: `<SKILL_DIR>` = `/workspace/skills/snowflake/`.
- **Generic**: assistant computes the directory of `SKILL.md` and
  uses that absolute path.

Node scripts inside `scripts/` self-locate via `import.meta.url` and
work regardless of CWD once invoked with the correct absolute path.

---

## Forbidden cross-host primitives

When extending the skill, do NOT use:

- Slicc-only: `sprinkle send`, `upskill`, `workspace_*` helpers,
  scoop dispatch.
- Claude-Code-only: `mcp__*` tool calls, `WebFetch`, `WebSearch`,
  named Agent subagent types, `${CLAUDE_SKILL_DIR}` in skill body
  prompts (it's fine in HOST-NOTES.md and in scripts that auto-locate).
- Any IDE-specific bridge (VS Code commands, JetBrains actions).
- Long-running daemons or sockets.
- Anything that prompts via TTY (the agent may not have one).

If a host has an obvious richer primitive (live status updates, GUI
preview, etc.), wire it up at the host's outer layer — by reading the
skill's `state.json` and emitting host-specific events — not by
editing the skill body.
