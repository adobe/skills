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
| `ensure-agents-md` | Root `AGENTS.md` + the base `CLAUDE.md` |
| `aem-agentkit` | Per-module `AGENTS.md`, `.aem/context/`, tool-specific files; **with consent**, an "AEM as a Cloud Service" section appended to root `CLAUDE.md` |

When root `AGENTS.md` is missing and `ensure-agents-md` is installed, this
skill defers to it as step 0 before continuing.

Root `AGENTS.md` is **never** written by `aem-agentkit` — it is always
deferred to `ensure-agents-md`. Root `CLAUDE.md` is different: if
`ensure-agents-md` is present it still creates root `AGENTS.md` and the
base `CLAUDE.md`; `aem-agentkit` then only **offers** (consent-gated, see
§ "Root `CLAUDE.md` consent prompt") to append its marked "AEM as a Cloud
Service" agentic-context section to that `CLAUDE.md`. On decline, the
file is left exactly as `ensure-agents-md` wrote it.

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

After detection, the skill prompts the customer with **all** / **single**
/ **multi** / **none** (universal layer only) and persists the answer
under `decision: ide-targets` in `.aem/agentkit-overrides.yml`. The
prompt is suppressed under `--silent`, `AEM_AGENTKIT_SILENT=1`, or a
pre-existing `decision: ide-targets` entry (CI default = write for every
detected toolchain). Template + the full suppression contract in
[`references/output-format.md`](./references/output-format.md) § 1.1.

When no IDE signal fires the universal layer is still written; the
preamble lists which toolchain dirs the customer can create to layer in
tool-specific artifacts on a later run.

### Root `CLAUDE.md` consent prompt

After IDE selection the skill issues a **second** prompt asking whether
it may add or update an "AEM as a Cloud Service" agentic-context section
in the customer's root `CLAUDE.md`. Root `AGENTS.md` is **never**
touched — it is deferred to `ensure-agents-md`. State detection,
decision flow (missing → write; skill-owned → re-render; human-curated →
append with consent), persistence under `decision: claude-md`, CI
suppression (`--silent` / `AEM_AGENTKIT_SILENT=1` / pre-existing
override), and the safe DENY default are documented in
[`references/collision-rules.md`](./references/collision-rules.md)
§ "Root `CLAUDE.md` consent prompt". Prompt template in
[`references/output-format.md`](./references/output-format.md) § 1.2.

## Hard guarantee — allow-list of paths the skill writes

Every output sits under one of:

- `<module>/AGENTS.md` for each detected AEM module (recursive for nested monorepos)
- `.aem/context/` files: `components.json`, `osgi-services.json`, `conventions.md`, `avoid.md`, `glossary.md`, `test-patterns.md`, `aem-api-namespaces.md`, `README.md`, `.agentkit-manifest.json`, `.agentkit.lock` (manifest and lock are workspace-root only; the other files are mirrored per detected nested sub-project)
- Per-tool artifacts under `.claude/agents/`, `.claude/commands/`, `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, `.continue/rules/`, plus single-file `.clinerules` / `.windsurfrules` / `augment.md` when their signal fires
- `.mcp.json` and `.cursor/mcp.json` placeholders (only when missing)
- `.aem/agentkit-overrides.yml` (one entry per resolved decision)
- Root `CLAUDE.md` — **only with explicit developer consent** (see § "Root `CLAUDE.md` consent prompt"). Created when missing, or its marked "AEM as a Cloud Service" section re-rendered / appended. Root `AGENTS.md` is NOT on this list — it is never written by this skill.

**Helper-enforced.** The allow-list is enforced inside
`bin/aem-agentkit-helper`'s `write-atomic` op
([`references/helpers.md`](./references/helpers.md) § 2.5). The deny-list
(privacy patterns — `node_modules/`, `.git/`, `.env`, `*.pem`, …) is
checked **before** the allow-list and refuses regardless of intent.
Sidecars `<path>.tmp` (atomic write) and `<path>.agentkit-new` (diff
review) inherit their target's allow-list status. Customer source is
never modified; reads honor the same deny-list and no generated URL
contains `/6.5/` or `experience-manager-65/` (self-validation rejects).

The skill prompts for exactly two decisions: **IDE selection** and
**root `CLAUDE.md` consent**. No prompts for content, path resolution,
or other overwrites.

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

**Step 10 — Per-module `AGENTS.md`** (recursive — see [`references/per-module-agents-md.md`](./references/per-module-agents-md.md)). Includes a `## After making changes` block that instructs the agent to run `/regen-context` after any code change touching `core/`, `ui.apps/apps/`, or `ui.config/` so the indexes don't drift. This is the per-module surface of the **Registration Rule** ([`references/manifest.md`](./references/manifest.md) § 8) — the cross-skill index-mutation protocol delivered via the document every spec-compliant agent reads at session start, rather than requiring sibling skills to opt into a SKILL.md hook.

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
- `source-vs-index-drift` — a component (`jcr:primaryType="cq:Component"`) or `@Model`-annotated `.java` exists on disk but is not present in the closest `.aem/context/components.json` / `.aem/context/osgi-services.json`, or an index entry resolves to no source file. The Registration Rule ([`references/manifest.md`](./references/manifest.md) § 8) defines the protocol the slash commands and sibling skills must follow to prevent this.

`source-vs-index-drift` is reported as a warning during a full skill run
(not a hard failure — the agent may not have run `/regen-context` yet at
the moment of self-validation). `/agents-md-check` re-evaluates the same
condition read-only and exits non-zero on drift so CI gates catch the
case where a previous session left the indexes stale.

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
| [`threat-model.md`](./references/threat-model.md) | Defended trust boundaries and explicit out-of-scope items |

## Deterministic helper

Every byte-exact operation runs in [`bin/aem-agentkit-helper`](./bin/aem-agentkit-helper)
(Python 3.10+, no third-party deps). The skill version-pins the helper
via `--version`/`--protocol-version` at startup and refuses to run on
mismatch. Op surface, JSON-line protocol, and the byte-exact contracts
are in [`references/helpers.md`](./references/helpers.md); unit-test
suite at [`tests/run-tests.sh`](./tests/run-tests.sh). The orchestrator
MUST use `read-for-context` (not raw `open`) whenever file content will
be passed into agent or LLM context.

## Concurrency, idempotency, modes

- **Lock.** Workspace advisory lock at `.aem/context/.agentkit.lock`; a second invocation exits `1` cleanly. Crash-safe via `fcntl.flock`.
- **Markers.** Markdown first-line comment / top-level JSON fields carry skill version + SHA-256 over the canonical body (`generatedAt` excluded so identical content does not churn the file). Marker spoofing is treated as human-curated. Byte-exact rules in [`references/upgrade-and-migration.md`](./references/upgrade-and-migration.md) § 1.
- **Modes.** `Default` runs the full order. `/regen-context` re-renders only `.aem/context/*`. `/agents-md-check` is read-only drift detection driven by the run manifest.

## Communication

The skill emits a one-line preamble before any writes, a deterministic
summary after the manifest is written (with `Heuristics`, `Warnings`,
`MCP placeholders to replace`, and `Manifest` rows always present), and a
one-line workspace-relative diagnostic on any error. Templates in
[`references/output-format.md`](./references/output-format.md).

## Threat model

The defended trust boundaries (customer source, privacy-sensitive
files, workspace boundary, TOCTOU on read, marker spoofing, concurrent
invocations) and explicitly out-of-scope concerns (natural-language
prompt injection, helper binary supply-chain tampering, adversarial
Windows hosts) are documented in [`references/threat-model.md`](./references/threat-model.md).

## Rules

Every rule is enforced by the helper and/or the self-validation pass.
The references hold the byte-exact definitions; the list below is the
review-checklist surface — each bullet links to where the rule is
authoritative.

- **Allow-list writes only** (this file § Hard guarantee).
- **Never overwrite human-curated files** ([`collision-rules.md`](./references/collision-rules.md)); root `CLAUDE.md` is the only consent-gated exception.
- **Root `AGENTS.md` never written** — deferred to `ensure-agents-md`; root `CLAUDE.md` only on `allow` consent (default DENY).
- **Privacy deny-list, segment + realpath** ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1).
- **Workspace boundary + symlink hardening** ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1.2).
- **Output stability + determinism tiebreaker** ([`codified-context.md`](./references/codified-context.md) § 2).
- **Sanitize extracted strings** ([`privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 2).
- **Hallucination guard.** Derived rule only when ≥ 3 evidence pointers exist; otherwise emit a TODO marker.
- **Customer-only discovery.** Never index Core Components or anything under `/libs`.
- **Sub-project resolution in role bodies** ([`per-tool-artifacts.md`](./references/per-tool-artifacts.md) § 2).
- **Slash-command input validation**: `<name>` and `<FQCN>` against anchored regex; `MVN_CMD` ∈ `{"mvn", "./mvnw"}` literally.
- **Use `read-for-context` for LLM-bound reads** ([`helpers.md`](./references/helpers.md) § 2 — `read-for-context`).
- **No inline mutation of `.aem/context/*.json`** — roles delegate to `/regen-context`.
- **Follow the Registration Rule** ([`manifest.md`](./references/manifest.md) § 8) when authoring an indexable artifact.
- **Diagnostic-path scrubbing.** Workspace-relative paths only; never absolute, never `~/`.
- **Semantically equivalent role bodies across IDE projections** ([`per-tool-artifacts.md`](./references/per-tool-artifacts.md) § 7).

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
