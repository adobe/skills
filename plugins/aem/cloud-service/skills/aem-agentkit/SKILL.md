---
name: aem-agentkit
description: |
  [BETA] Bootstrap an AEM as a Cloud Service repository for agentic workflows
  across Claude Code, Cursor, GitHub Copilot, Codex, Continue, Cline, Windsurf,
  Augment, and any AGENTS.md-spec-compliant agent. Triggers: "set up agentic
  context", "bootstrap aem-agentkit", "make this repo agent-ready", "agentkit".
  Generates per-module AGENTS.md, codified context under .aem/context/,
  project-scoped subagents, slash commands, rule files, Copilot instructions,
  MCP placeholders, and guardrails — without modifying customer source.
  Detects installed agent stacks silently. Defers root AGENTS.md to
  ensure-agents-md when present. Deterministic operations (realpath, SHA-256
  canonical-body checksum, atomic write, Unicode sanitization, deny-list,
  bounded walk) run through the helper in references/helpers.md. AEM as a
  Cloud Service only; exits early on 6.5 LTS, AMS, on-premise. Beta — verify
  outputs before production use.
license: Apache-2.0
compatibility: AEM as a Cloud Service projects only (Java stack, Maven, Dispatcher). Not for AEM 6.5 LTS, AMS, or on-premise.
metadata:
  status: beta
  version: "1.0.0-beta"
  aem_version: "Cloud Service"
  complements: ensure-agents-md
---

# aem-agentkit — bootstrap for agentic workflows on AEM as a Cloud Service

> **Beta Skill**: This skill is in beta and under active development. Results
> should be reviewed carefully before use in production. Report issues at
> https://github.com/adobe/skills/issues

Writes per-module `AGENTS.md`, codified context under `.aem/context/`, and
tool-specific projections so coding agents work the repo with high
reliability and low hallucination — without modifying customer source.

**Scope: AEM as a Cloud Service only.** The skill exits early on 6.5 LTS,
AMS, or on-premise layouts (signals: `pom.xml` declaring `uber-jar` `6.5.*`
classifiers; `dispatcher` legacy `conf/` only without `conf.d/`;
`.cloudmanager/` absent alongside `aem.dispatcher.module` references).

## Relationship to `ensure-agents-md`

| Skill | Owns |
|---|---|
| `ensure-agents-md` | Root `AGENTS.md` + `CLAUDE.md` |
| `aem-agentkit` | Per-module `AGENTS.md`, `.aem/context/`, tool-specific files |

When root `AGENTS.md` is missing and `ensure-agents-md` is installed, this
skill defers to it as step 0 before continuing.

## Trigger

- User invokes by trigger phrase (see `description`).
- One of the owned slash commands fires (`/new-component`,
  `/new-sling-model`, `/validate-dispatcher`, `/regen-context`,
  `/agents-md-check` — see [references/per-tool-artifacts.md](./references/per-tool-artifacts.md)).
- Skip with one-line preamble notice when `_disable_agentkit` exists at
  workspace root (`lstat`-by-name; symlink target never dereferenced;
  contents ignored) or no root `pom.xml` is found within the documented
  fallback set. Per-sub-project opt-out via the same file at a nested
  AEM project root. Full collision behavior in
  [references/collision-rules.md](./references/collision-rules.md).

## IDE detection and selection

The skill detects agentic toolchain signals from the filesystem and then
**asks the customer** which detected toolchains to materialize artifacts
for. The universal layer (`AGENTS.md` + `.aem/context/*`) is always
written; the tool-specific layer is opt-in per IDE.

Detection signals are tightened to avoid false positives — having
`.github/*.yml` workflow files no longer counts as a Copilot signal,
and an empty `.claude/` directory (often left by IDE installers) no
longer fires.

| Tool | Signal (must include the "content" half) | Artifacts (when selected) |
|---|---|---|
| Claude Code | `.claude/agents/` or `.claude/commands/` is non-empty | `.claude/agents/aem-*.md`, `.claude/commands/<owned>.md`, `.mcp.json` placeholder |
| Cursor | `.cursor/rules/` is non-empty or `.cursor/mcp.json` exists | `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` placeholder |
| GitHub Copilot | `.github/copilot-instructions.md` exists | `.github/instructions/aem-*.instructions.md` (+ `.github/copilot-instructions.md` only when missing) |
| Codex / Aider / native-AGENTS.md tools | always | (universal layer only — never IDE-specific files) |
| Continue.dev | `.continue/rules/` is non-empty | `.continue/rules/aem-*.md` |
| Cline | `.clinerules` exists OR `.vscode/extensions.json` lists `saoudrizwan.claude-dev` | `.clinerules` (when missing) |
| Windsurf | `.windsurfrules` exists OR `.codeium/` is non-empty | `.windsurfrules` (when missing) |
| Augment | `.augment/` exists OR `augment.md` exists | `augment.md` (when missing) |

After detection, the skill prompts the customer with the detected
toolchains and the choices: **all**, **single (pick one)**,
**multi-select**, or **none** (universal layer only). The selection
is recorded under `decision: ide-targets` in
`.aem/agentkit-overrides.yml` so subsequent runs skip the prompt.
Prompt template in [`references/output-format.md`](./references/output-format.md) § 1.1.

The prompt is **suppressed** (and the skill falls back to writing for
every detected toolchain — the original silent behavior) under any of:

- CLI flag `--silent` on the invocation.
- Environment variable `AEM_AGENTKIT_SILENT=1` set in the shell.
- `.aem/agentkit-overrides.yml` already contains a
  `decision: ide-targets` entry — that entry wins outright.

These three escape hatches keep CI / scripted invocations fully
reproducible: a skill run in a non-interactive context with the
override file present makes no decisions of its own.

When no IDE signal fires, the universal layer is still written and the
preamble lists which toolchain dirs the customer can create to layer in
tool-specific artifacts on a later run.

## Hard guarantee — allow-list of paths the skill writes

Every output sits under one of:

- `<module>/AGENTS.md` for each detected AEM module (recursive for nested monorepos)
- `.aem/context/` files: `components.json`, `osgi-services.json`, `conventions.md`, `avoid.md`, `glossary.md`, `test-patterns.md`, `aem-api-namespaces.md`, `README.md`, `.agentkit-manifest.json`, `.agentkit.lock` (manifest and lock are workspace-root only; the other files are mirrored per detected nested sub-project)
- Per-tool artifacts under `.claude/`, `.cursor/`, `.github/instructions/`, `.continue/`, plus single-file `.clinerules` / `.windsurfrules` / `augment.md` when their signal fires
- `.mcp.json` and `.cursor/mcp.json` placeholders (only when missing)
- `.aem/agentkit-overrides.yml` (one entry per resolved decision)

**Helper-enforced.** The allow-list is enforced inside `bin/aem-agentkit-helper`'s `write-atomic` op (see [`references/helpers.md`](./references/helpers.md) § 2.5). A write request for any path outside the allow-list is rejected by the helper; the orchestrating LLM cannot bypass this even if prompt-injected. The deny-list (per-segment privacy patterns) is enforced before the allow-list - `node_modules/`, `.git/`, `.env`, `*.pem`, and the full privacy list are always refused regardless of intent.

Outside this list every pre-existing file is read-only. The skill's own
`<path>.tmp` (atomic-write only, cleaned at startup when adjacent to a
marker-bearing target OR when orphaned at an allow-listed path) and
`<path>.agentkit-new` (diff sidecar) are the only other paths it touches.
Root `AGENTS.md` / `CLAUDE.md` are owned by `ensure-agents-md` and are
never modified.

The skill never reads anything matching the deny-list in
[references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md)
§ 1, never embeds AEM 6.5 documentation URLs (the self-validation pass
rejects `/6.5/` and `experience-manager-65/`), and never names specific
MCP server packages in any AGENTS.md body. The skill prompts the
customer only for **IDE selection** (§ "IDE detection and selection")
— no prompts for content decisions, file overwrites, or path
resolution.

## Generation order

The order is fixed. Skipping any step breaks downstream consumers. All
13 steps are numbered explicitly; the workspace-root universal layer
(steps 1-8) is a coherent first batch that materializes
`.aem/context/*` for the whole workspace.

**Step 1 — `.aem/context/components.json`** (workspace-wide component catalog).
**Step 2 — `.aem/context/osgi-services.json`** (Sling Models, OSGi services, Sling Servlets).
**Step 3 — `.aem/context/conventions.md`** (derived conventions with evidence pointers).
**Step 4 — `.aem/context/avoid.md`** (anti-patterns detected in the repo).
**Step 5 — `.aem/context/glossary.md`** (domain disambiguation).
**Step 6 — `.aem/context/test-patterns.md`** (project test patterns).
**Step 7 — `.aem/context/aem-api-namespaces.md`** (static reference).
**Step 8 — `.aem/context/README.md`** (static index of the above).

**Step 9 — Per-sub-project universal layer (MANDATORY for nested AEM monorepos).** For every nested AEM project the discovery in [`references/per-module-agents-md.md`](./references/per-module-agents-md.md) § 1 detected (and recorded under `heuristics[].decision == "module-shape"` with `value: nested-aem-project`), **repeat steps 1-7 scoped to that sub-project's source tree** and write the files to `<sub-project>/.aem/context/`. Skip the static-reference files (`aem-api-namespaces.md`, `README.md` already cover the whole workspace) and the manifest (workspace-root only). A sub-project with `_disable_agentkit` is skipped per [`references/collision-rules.md`](./references/collision-rules.md). This step is **not optional** — when nested sub-projects are detected, their per-sub-project `.aem/context/` directories MUST exist before the generation order proceeds. See [`references/codified-context.md`](./references/codified-context.md) § 11 for the schema and discovery scope rules.

**Step 10 — Per-module `AGENTS.md`** (recursive — see [`references/per-module-agents-md.md`](./references/per-module-agents-md.md)). Includes a `## After making changes` block that instructs the agent to run `/regen-context` after any code change touching `core/`, `ui.apps/apps/`, or `ui.config/` so the indexes don't drift. This is the cross-skill index-mutation protocol delivered via the document every spec-compliant agent reads at session start, rather than requiring sibling skills to opt into a SKILL.md hook.

**Step 11 — Tool-specific artifacts** — see [`references/per-tool-artifacts.md`](./references/per-tool-artifacts.md).

**Step 12 — `.mcp.json` / `.cursor/mcp.json` placeholders** — see [`references/mcp-wiring.md`](./references/mcp-wiring.md).

**Step 13 — `.aem/context/.agentkit-manifest.json`** — see [`references/manifest.md`](./references/manifest.md).

Then run the **self-validation pass**. Each failure is reported with one
of these category tags so the customer immediately knows the class of fix:

- `evidence-resolution` — an evidence pointer in derived Markdown does not resolve to an existing file (or line, when given).
- `evidence-resolution` — a `slingModelFqcn` / `implFqcn` does not resolve to an existing `.java` file.
- `module-mismatch` — a per-module `AGENTS.md` does not match an existing directory.
- `marker-checksum` — a marker checksum does not recompute correctly via the helper's `sha256-canonical` op.
- `url-scoping` — a URL is not Cloud-Service-scoped (matches `/6.5/` or `experience-manager-65/`).
- `strip-list-survivor` — a sanitized string carries strip-list code points.
- `manifest-drift` — a manifest entry's checksum does not match the on-disk file.
- `missing-subproject-context` — for some `heuristics[]` entry with `decision: module-shape, value: nested-aem-project`, the corresponding `<path>/.aem/context/components.json` or `<path>/.aem/context/osgi-services.json` is missing or marker-invalid.

Missing per-sub-project context is a hard failure (exit `1`). Exit `0`
clean, `2` completed-with-warnings, `1` hard failure.

## Reference files

| File | Purpose |
|---|---|
| [`per-module-agents-md.md`](./references/per-module-agents-md.md) | Per-module `AGENTS.md` rules, recursion, build-command resolution |
| [`codified-context.md`](./references/codified-context.md) | `.aem/context/*` schemas, discovery, output stability, determinism tiebreaker |
| [`per-tool-artifacts.md`](./references/per-tool-artifacts.md) | IDE detection, canonical role source, projection rules, size budgets |
| [`mcp-wiring.md`](./references/mcp-wiring.md) | `.mcp.json` / `.cursor/mcp.json` placeholder + validity definitions |
| [`guardrails.md`](./references/guardrails.md) | Canonical guardrail block and inter-skill index-mutation contract |
| [`module-catalog.md`](./references/module-catalog.md) | Module descriptions, frontend variants, add-on detection |
| [`collision-rules.md`](./references/collision-rules.md) | Pre-existing-state behavior table + marker check + `.agentkit-new` lifecycle |
| [`upgrade-and-migration.md`](./references/upgrade-and-migration.md) | Marker canonical-body bytes, version bumps, schema migration, static-reference handling |
| [`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) | Deny-list, symlink hardening, Unicode strip-list, casefold rule |
| [`output-format.md`](./references/output-format.md) | Preamble + summary + diagnostic templates with conditional rows |
| [`helpers.md`](./references/helpers.md) | Deterministic helper protocol, ops, version pinning |
| [`manifest.md`](./references/manifest.md) | Run-manifest schema, `/agents-md-check` consumer rules, overrides |

## Deterministic helper

Every operation that must be byte-exact (realpath + workspace boundary,
`O_NOFOLLOW` + TOCTOU re-check, SHA-256 canonical-body checksum, atomic
`.tmp` + `rename(2)`, Unicode sanitization, deny-list segment matching,
bounded file walk, advisory file lock) is performed by the helper at
[`bin/aem-agentkit-helper`](./bin/aem-agentkit-helper) (Python 3.10+, no
third-party deps). The skill compares `--version` against
`metadata.version` at startup and refuses to run on mismatch or absence.
Full protocol in [`references/helpers.md`](./references/helpers.md);
unit-test suite at [`tests/run-tests.sh`](./tests/run-tests.sh).

## Concurrency, idempotency, modes

- **Lock.** Workspace advisory lock at `.aem/context/.agentkit.lock`
  (acquired through the helper); a second invocation exits `1` with a
  clean diagnostic instead of racing on `.tmp` files.
- **Markers.** Markdown: first line is `<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->`. JSON: top-level `"_generatedBy": "aem-agentkit"`, `"_skillVersion": "1.0.0-beta"`, `"schemaVersion": "1"`, `"_markerChecksum": "<sha256>"` (plus `"_static": true` for static-reference files). The marker checksum covers the canonical body bytes only; `generatedAt` is excluded so identical content does not churn the file across runs. Marker spoofing (wrong / malformed / duplicated checksum) is treated as human-curated. Full byte-exact rules in [`references/upgrade-and-migration.md`](./references/upgrade-and-migration.md) § 1.
- **Modes.** `Default` runs the full order. `Refresh` (`/regen-context`) re-renders only `.aem/context/*`. `Check` (`/agents-md-check`) is read-only drift detection driven by the run manifest.

## Communication

The skill emits a one-line preamble before any writes, a deterministic
summary after the manifest is written (with `Heuristics`, `Warnings`,
`MCP placeholders to replace`, and `Manifest` rows always present), and a
one-line workspace-relative diagnostic on any error. Templates in
[`references/output-format.md`](./references/output-format.md).

## Threat model

The skill operates inside a developer's workspace with the privileges
of the developer's user account. It reads files in the customer repo
and writes a bounded set of agent-context files. Key trust boundaries:

| Asset | Defended against | Mechanism |
|---|---|---|
| Customer source files | Accidental modification | Allow-list (helper-enforced in `write-atomic`) + marker-based human-curated detection |
| Privacy-sensitive files (`.env`, `*.pem`, `.aws/`, `.git/config`) | Indexing into LLM context | Deny-list per path segment, ASCII casefold + NFC normalize, applied at both walk-name AND resolved-realpath segments |
| Filesystem outside workspace | Reading or writing via symlink | Workspace realpath cached at startup; in-workspace symlinks pointing outside are rejected; special filesystems (`/proc`, `/sys`, `/dev`, `/var/run`, `/run`, macOS `/private/var/run`) rejected even when the workspace lives inside them |
| TOCTOU on read | Reading a swapped file | `O_NOFOLLOW` + post-open re-check via `/proc/self/fd/N` (Linux) or `F_GETPATH` (macOS); fail-closed when re-check is unavailable |
| Marker spoofing | Pasting our marker into a customer file | SHA-256 over canonical body bytes is recomputed on every "is this ours?" check; mismatch → human-curated → never overwritten |
| Concurrent invocations | Racing on `.tmp` files | Advisory `flock` with PID + start-time defense against PID reuse; stale-lock recovery is race-safe |

**Explicitly out of scope:**

- **Prompt injection via raw file content.** When the orchestrating LLM
  reads source files via the helper's `open` op, the helper returns the
  raw bytes. The helper sanitizes only strings it is told to sanitize
  (`cq:title` values, package names, glossary terms). Bidi-override,
  zero-width, and "ignore prior instructions" payloads embedded in Java
  comments, HTL files, or `pom.xml` `<description>` can hijack an agent
  if the orchestrator places opened bytes into LLM context unfiltered.
  This is the orchestrator's responsibility; see
  [`references/privacy-and-sanitization.md`](./references/privacy-and-sanitization.md)
  § 3 for the recommended `sanitize-bytes` wrapping flow. A future
  `op_read_for_context` is tracked as a follow-up.
- **Supply-chain tampering with the helper binary.** The helper's
  content-addressable SHA-256 pin is documented in
  [`references/upgrade-and-migration.md`](./references/upgrade-and-migration.md)
  § 1.1 and baked into the release notes. A plugin marketplace
  replacement of the helper would be detected only by that pin, not by
  any in-skill mechanism.
- **Adversarial Windows hosts.** Windows is rejected at startup; no
  hardening claims apply on that platform. Use WSL.

## Rules

Every rule is enforced by the helper and / or the self-validation pass.
The references hold the byte-exact definitions; this section is a
checklist for review.

- **Allow-list writes only** (this file § Hard guarantee, enforced inside the helper's `write-atomic` op).
- **Never overwrite** any pre-existing file lacking the skill's marker (see [`collision-rules.md`](./references/collision-rules.md)).
- **Never read** any path matching the privacy deny-list ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1) — segment-by-segment match, ASCII-lowercase casefold + NFC normalize, fail-closed on uncertainty. Deny-list also applies to the **resolved realpath segments** to defeat in-workspace symlink bypass.
- **Workspace boundary + symlink hardening** ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1.2): realpath check, workspace-escape rejection, special-filesystem rejection (`/proc`, `/sys`, `/dev`, `/var/run`, `/run`, macOS `/private/var/run`, UNC paths), `O_NOFOLLOW` open on the resolved target with TOCTOU re-check (fail-closed when re-check is unavailable), depth cap 32, global file cap 100,000, per-subtree cap 10,000.
- **Output stability** ([`codified-context.md`](./references/codified-context.md) § 2): JSON sorted-keys + 2-space indent + LF + final newline + UTF-8 no BOM; Markdown LF + final newline + no trailing whitespace; `generatedAt` is `YYYY-MM-DDTHH:MM:SSZ` and excluded from the checksum. String leaves are NFC-normalized before checksum so HFS+ (NFD) and ext4/APFS (NFC) hash identically.
- **Determinism tiebreaker** ([`codified-context.md`](./references/codified-context.md) § 2): path → line number → pre-sanitization value → SHA-256 of pre-sanitization value.
- **Sanitize extracted strings** ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 2): NFC normalize, drop on strip-list match, 80-char cap, inline-code wrap with escalating fence.
- **Hallucination guard.** Emit a derived rule only when ≥ 3 evidence pointers exist; otherwise emit a TODO marker.
- **Customer-only discovery.** Never index Core Components or anything under `/libs`.
- **Sub-project resolution in role bodies** ([`per-tool-artifacts.md`](./references/per-tool-artifacts.md) § 2): role bodies walk up from the file under edit to the closest enclosing AEM project root before resolving `<project>` or `<module>`.
- **Slash-command input validation**: `<name>` and `<FQCN>` against anchored regex before any shell or filesystem interpolation; `MVN_CMD` ∈ `{"mvn", "./mvnw"}` literally.
- **No inline mutation of `.aem/context/*.json`**: roles delegate to `/regen-context` so the marker checksum is recomputed by the helper, not by the agent.
- **Diagnostic-path scrubbing.** Workspace-relative paths only; never absolute, never `~/`.
- **Semantically equivalent role bodies across IDE projections** ([`per-tool-artifacts.md`](./references/per-tool-artifacts.md) § 7): the canonical role-source body is the same content materialized in each IDE's preferred wrapper. Light per-projection adapters (frontmatter, file extension, IDE-specific directives) are permitted so the design survives IDE format evolution without forking the canonical source.

## Example invocation

```
> bootstrap aem-agentkit
aem-agentkit: Bootstrapping agentic workflow context for this AEM as a Cloud Service repository. No source files will be modified.
…
aem-agentkit: complete
  Universal layer:
    Per-module AGENTS.md: 7 across [core, ui.apps, ui.frontend, dispatcher, it.tests, ui.tests, all]
    Indexes: components.json (24), osgi-services.json (11)
    Derived: conventions.md (7 rules, 1 TODO), avoid.md (3 entries), glossary.md (14 terms), test-patterns.md (4 rules)
    Static refs: aem-api-namespaces.md, README.md
  Tool-specific layer (detected: Claude):
    Claude:   8 agents, 5 commands, mcp.json (new-placeholder)
    Cursor:   0 rules, mcp.json (absent)
    Copilot:  0 instructions, copilot-instructions.md (absent)
    Continue: 0 rules
    Cline:    .clinerules (absent), .clinerules.aem-roles-extra.md (absent)
    Windsurf: .windsurfrules (absent), .windsurfrules.aem-roles-extra.md (absent)
    Augment:  augment.md (absent), augment.md.aem-roles-extra.md (absent)
  Heuristics (3): module-shape=leaf-module at core; frontend-variant=webpack at ui.frontend; ds-generation=R7 at core/.../MyService.java
  TODO markers: 1 items pending human review
  Warnings (0): none
  MCP placeholders to replace: 3 (in .mcp.json) — agent will not connect until set
  Manifest: .aem/context/.agentkit-manifest.json (24 entries, helper v1.0.0-beta)
  Refresh:   /regen-context
  Drift:     /agents-md-check
  Exit code: 0 (clean)
```
