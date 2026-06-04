---
name: aem-agentkit
description: |
  [BETA] Bootstrap an AEM as a Cloud Service repository for agentic workflows
  across Claude Code, Cursor, GitHub Copilot, Codex, Continue, Cline, Windsurf,
  Augment Code, and any AGENTS.md-spec-compliant agent. Trigger phrases:
  "set up agentic context", "bootstrap aem-agentkit", "make this repo
  agent-ready", "agentkit", "agentic workflow bootstrap for AEM". Generates
  per-module AGENTS.md, machine-readable codified context under .aem/context/,
  project-scoped subagents / slash commands / rule files / Copilot
  instructions, MCP wiring placeholders, and guardrail rules — without
  modifying customer source code. Detects installed agent stacks silently and
  writes only matching tool-specific artifacts. Defers root AGENTS.md to
  ensure-agents-md when present and only fires when the root AGENTS.md
  already exists or when ensure-agents-md is unavailable; works standalone
  when not.
  This skill is in beta. Verify all outputs before applying them to production
  projects.
license: Apache-2.0
compatibility: AEM as a Cloud Service projects (Java stack, Maven, Dispatcher).
metadata:
  status: beta
  version: "0.1.0-beta"
  aem_version: "Cloud Service"
  complements: ensure-agents-md
---

# aem-agentkit — bootstrap for agentic workflows on AEM as a Cloud Service

> **Beta Skill**: This skill is in beta and under active development. Results
> should be reviewed carefully before use in production. Report issues at
> https://github.com/adobe/skills/issues

## What this skill does, in one sentence

Writes a small set of agent-meta files at the workspace root and inside
existing modules so coding agents (Claude Code, Cursor, GitHub Copilot, Codex,
Continue, and any agentic harness on top of them) can perform agentic
workflows on the customer's AEM as a Cloud Service repository with high
reliability and low hallucination — without ever modifying customer source
code.

## Hard guarantee — never modifies customer source

This skill writes **only** into the following paths, all relative to the
workspace root:

- `<module>/AGENTS.md` for each detected AEM module (recursively, including nested AEM sub-projects)
- `.aem/context/` (`components.json`, `osgi-services.json`, `conventions.md`,
  `avoid.md`, `glossary.md`, `test-patterns.md`, `aem-api-namespaces.md`, `README.md`) — written at the workspace root **and** scoped per nested AEM sub-project
- `.claude/agents/aem-*.md`, `.claude/commands/<owned-names>.md`,
  `.mcp.json` *(only when `.claude/` is detected and the file is missing)*
- `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` *(only when `.cursor/` is
  detected and the file is missing)*
- `.github/copilot-instructions.md` *(only when missing and Copilot is
  detected)*, `.github/instructions/aem-*.instructions.md`
- `.continue/rules/aem-*.md` *(only when `.continue/` is detected)*
- `.clinerules` *(only when `.clinerules` or `.vscode/extensions.json` Cline signal is detected, and only when missing — never modified if present)*
- `.windsurfrules` *(only when `.windsurfrules` or `.codeium/` is detected, and only when missing)*
- `augment.md` *(only when `.augment/` or pre-existing `augment.md` is detected, and only when missing)*

Outside this allow-list, every pre-existing file is read-only. The skill's
own temporary `<path>.tmp` files and `<path>.agentkit-new` sidecar files
(see § Idempotency) are the only other paths the skill writes to, and both
sit alongside an allow-listed target. The root `AGENTS.md` and `CLAUDE.md` are
owned by `ensure-agents-md` and are never modified by this skill. Every
generated artifact carries a marker comment so the customer can identify,
delete, or regenerate them safely.

## Relationship to `ensure-agents-md`

`aem-agentkit` complements `ensure-agents-md` — they are not replacements
for each other.

| Skill | Owns | Outputs |
|---|---|---|
| `ensure-agents-md` (stable) | Root `AGENTS.md` + `CLAUDE.md` | 2 files |
| `aem-agentkit` (beta) | Per-module `AGENTS.md`, `.aem/context/`, tool-specific files | Everything else |

| Customer state | `aem-agentkit` behavior |
|---|---|
| Root `AGENTS.md` present (any author) | Use it as-is, never modify |
| Root `AGENTS.md` missing AND `ensure-agents-md` installed | Defer to `ensure-agents-md` as step 0, then continue |
| Root `AGENTS.md` missing AND `ensure-agents-md` not installed | Proceed with everything else; one-line notice asks user to add a root `AGENTS.md` |

## Trigger and invocation

This skill is **opt-in** — it does not auto-bootstrap like `ensure-agents-md`.
It runs when:

- The user invokes it by name ("set up agentic context", "bootstrap aem-agentkit", "make this repo agentic-ready", etc.).
- The host routes here because the user is doing component / Sling Model / dispatcher work and codified context would reduce hallucination, AND the repo has root `AGENTS.md` but no `.aem/context/`.
- The slash commands it installs are invoked: `/regen-context`, `/agents-md-check`.

The skill skips silently and exits cleanly when:

- Root `pom.xml` is missing AND no single-level fallback `pom.xml` is found (the skill checks `<workspace>/pom.xml`, then one level down at `aem/pom.xml`, `aemproject/pom.xml`, `project/pom.xml`; if exactly one fallback is found, the skill treats that directory as the AEM project root and emits a one-line notice. Two or more fallbacks → skip with diagnostic.).
- A `_disable_agentkit` regular file exists at the workspace root. **Behavior is the same regardless of file contents** (empty or not). A directory or symlink named `_disable_agentkit` is treated as the opt-out signal. The skill makes no writes and exits with code 0. Per-sub-project opt-out: place `_disable_agentkit` inside a nested AEM sub-project root to skip that sub-project only; the rest of the run proceeds.
- Every universal-layer artifact already exists with a matching marker checksum and no tool-specific layer is missing.

## Silent IDE detection

The skill does **not** prompt the user. It detects installed agent stacks
from filesystem signals and writes only the matching tool-specific layer.

| Tool | Detection signal | Tool-specific artifacts |
|---|---|---|
| Claude Code | `.claude/` directory or `CLAUDE.md` at root | `.claude/agents/aem-*.md`, `.claude/commands/<owned>.md`, `.mcp.json` placeholder |
| Cursor | `.cursor/` directory | `.cursor/rules/aem-*.mdc`, `.cursor/mcp.json` placeholder |
| GitHub Copilot | `.github/copilot-instructions.md` present, or `.github/` with any workflow file | `.github/instructions/aem-*.instructions.md`; `.github/copilot-instructions.md` only if missing |
| Codex | (always — reads `AGENTS.md` natively per the open standard) | (none — universal layer is sufficient) |
| Continue.dev | `.continue/` directory | `.continue/rules/aem-*.md` |
| Cline (VS Code) | `.clinerules` file at workspace root or `.vscode/extensions.json` listing the Cline extension (`saoudrizwan.claude-dev`) | `.clinerules` (only when missing) |
| Windsurf | `.windsurfrules` file at workspace root or `.codeium/` directory | `.windsurfrules` (only when missing) |
| Augment Code | `.augment/` directory or pre-existing `augment.md` at root | `augment.md` (only when missing) |
| Aider, Gemini CLI, Zed, Factory, Jules, Devin, Amp, Kilo, RooCode, Warp, JetBrains Junie, Ona, Phoenix | (always — read `AGENTS.md` natively per the open standard) | (none — universal layer is sufficient) |

If **no** signal is detected, only the universal layer is written and the
summary block lists what would be generated if each tool were detected,
so the customer can opt in later by creating the corresponding directory
and re-running the skill.

## Generation order (fixed)

The skill writes artifacts in this order. Earlier outputs are read by later
steps so cross-references stay consistent.

1. `.aem/context/components.json` — see [references/codified-context.md](./references/codified-context.md). Written at the workspace root **and** at each detected nested AEM sub-project root (scoped to that sub-project).
2. `.aem/context/osgi-services.json` — same per-scope rule.
3. `.aem/context/conventions.md` — derived rules with evidence pointers.
4. `.aem/context/avoid.md` — anti-patterns with evidence pointers.
5. `.aem/context/glossary.md` — domain disambiguation.
6. `.aem/context/test-patterns.md` — testing conventions.
7. `.aem/context/aem-api-namespaces.md` — canonical AEM API namespace reference (static guardrail support for "verify before import").
8. `.aem/context/README.md` — human-readable index of the above.
9. Per-module `AGENTS.md` (recursive — supports nested AEM monorepos where a top-level module is itself a full archetype) — see [references/per-module-agents-md.md](./references/per-module-agents-md.md)
10. Tool-specific artifacts (Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment) — see [references/per-tool-artifacts.md](./references/per-tool-artifacts.md)
11. `.mcp.json` and `.cursor/mcp.json` — see [references/mcp-wiring.md](./references/mcp-wiring.md)

After step 11, run the **self-validation pass**:

- Every evidence pointer in `conventions.md`, `avoid.md`, `glossary.md`, `test-patterns.md` resolves to an existing file (and line, when given).
- Every `slingModelFqcn` in `components.json` resolves to an existing `.java` file.
- Every `implFqcn` in `osgi-services.json` resolves to an existing `.java` file.
- Every per-module `AGENTS.md` corresponds to an existing directory.
- Every tool-specific file carries the marker, the marker checksum recomputes correctly, and the canonical role-source body appears verbatim across all projected shapes for the same role.
- No file contains marketing language; framing stays factual.

On validation failure, the skill prints a one-line diagnostic naming the
failing file (workspace-relative path) and the failing check. **Each
individual file write is atomic** (`.tmp` + rename) so no file is left
half-written, but earlier successful writes from steps 1–11 remain on
disk. The next invocation resumes idempotently: completed files match
their checksum and are skipped; the failing file is re-attempted. The
customer can also remove every aem-agentkit-marker file at once with the
grep helper in [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) § Reversibility.

## Reference files

| File | Purpose |
|---|---|
| [references/per-module-agents-md.md](./references/per-module-agents-md.md) | Rules, templates, and size budgets for per-module `AGENTS.md` files |
| [references/codified-context.md](./references/codified-context.md) | `.aem/context/*` schemas, discovery rules, evidence-pointer format, schema versioning |
| [references/per-tool-artifacts.md](./references/per-tool-artifacts.md) | Tool detection signals, canonical role-prompt source, projection into Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment formats |
| [references/mcp-wiring.md](./references/mcp-wiring.md) | `.mcp.json` and `.cursor/mcp.json` non-destructive merge rules |
| [references/guardrails.md](./references/guardrails.md) | Guardrail rule text (search-before-create, verify-API, etc.) |
| [references/module-catalog.md](./references/module-catalog.md) | Module descriptions and add-on detection table |
| [references/collision-rules.md](./references/collision-rules.md) | Complete pre-existing-state behavior table (25+ scenarios) |
| [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) | Skill version bump + JSON schema migration rules |
| [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) | Privacy deny-list, symlink hardening, Unicode sanitization rules |
| [references/output-format.md](./references/output-format.md) | Exact preamble / summary / error templates |

## Idempotency

- **Never overwrite** any pre-existing file lacking our marker.
- Each generated artifact's first content line is a marker:
  - Markdown / `.mdc`: `<!-- aem-agentkit: generated v0.1.0-beta; safe to delete or edit. checksum: <sha256> -->`
  - JSON: leading top-level fields `"_generatedBy": "aem-agentkit"`, `"_skillVersion": "0.1.0-beta"`, `"schemaVersion": "1"`.
- Re-running the skill is a no-op when nothing has drifted.
- A file lacking the marker is treated as **human-curated**; the skill never touches it. When the skill would otherwise write to such a path, it writes to `<path>.agentkit-new` instead and surfaces a one-line diff summary.
- A marker-bearing file with a different checksum (because we ship new templates) is **not** overwritten — the new content goes to `.agentkit-new`; the customer chooses whether to swap.

## Modes

| Mode | Trigger | Behavior |
|---|---|---|
| Default | Skill invoked, opt-out signals absent | Step 0: defer to `ensure-agents-md` if root `AGENTS.md` missing and that skill is available. Step 1+: generate missing universal + matching tool-specific artifacts. |
| Refresh | `/regen-context` slash command (per detected tool) or skill argument | Regenerate only `.aem/context/*`. Diffs go to `.agentkit-new` per § Idempotency. |
| Check | `/agents-md-check` slash command or `--check` | Read-only drift report. Non-zero exit when stale. |

## What this skill never does

- Modify customer source code (Java, HTL, JSP, JS/TS/CSS, dispatcher `.conf`/`.any`/`.farm`, FileVault XML, `pom.xml`, content `.json`, OSGi config, `README`, `CONTRIBUTING`, `LICENSE`, or any other pre-existing file lacking the marker).
- Modify the root `AGENTS.md` or `CLAUDE.md`.
- Write into `.git/`, `target/`, `node_modules/`, `dist/`, `build/`, `out/`.
- Read any file matching the **privacy deny-list** in [`references/privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1. Matching is case-insensitive on every platform; the deny-list covers `.cloudmanager/env*` and `.cloudmanager/secrets*`, `.env`/`.env.*`, generic credential / secret / token / password / API-key patterns, PKI and keystores, SSH keys, cloud SDK credentials (AWS / GCP / Azure / kubeconfig), package-registry build secrets (npm / yarn / pip / Maven `~/.m2/settings.xml`), Adobe IO / IMS configs, IaC state, PGP / encrypted archives. `.git/HEAD` and `.git/refs/heads/*` are the only files read from `.git/`. Fail closed on uncertainty.
- Mention specific MCP server packages by name in the bodies of generated AGENTS.md / per-module AGENTS.md files. Server names belong in `.mcp.json` / `.cursor/mcp.json`, which the skill seeds as inert placeholders only — never as live wiring (see [references/mcp-wiring.md](./references/mcp-wiring.md)).
- Use marketing language in any generated artifact. Generated content frames itself as agentic workflow context.
- Embed AEM 6.5 documentation URLs. All resource links use the Cloud Service namespace.
- Prompt the customer for input. IDE detection is silent.

## Communication contract

The skill writes to the user at exactly three points: a one-line
preamble before any writes, a deterministic summary after all writes
(with counts, detected-tool rows, and a `MCP placeholders to replace`
row when applicable), and a one-line workspace-relative diagnostic on
any error. The skill never leaves partial outputs — each file write is
atomic (`.tmp` + rename), the multi-step run resumes idempotently. Full
templates and conditional-row rules in
[references/output-format.md](./references/output-format.md).

## Rules

- **Never overwrite** any pre-existing file (§ Idempotency).
- **Never hallucinate.** Only emit a derived rule when ≥ 3 evidence points exist; otherwise emit a TODO marker.
- **Never read** files in § "What this skill never does". Path matching is case-insensitive on every platform.
- **Never write** outside the allow-list in § "Hard guarantee".
- **Customer-only discovery.** Components, models, and services are discovered from the customer's source modules. Do not index Core Components or anything under `/libs`.
- **Workspace boundary + symlink hardening.** Only walk paths under the workspace root. Realpath check, workspace-escape rejection, deny-list rejection, visited-set loop guard, `O_NOFOLLOW` open, depth cap 32, file-walk cap 100,000 with `truncated: true` index marker. Full rules in [`references/privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 1.2.
- **Output stability.** JSON sorted-keys + 2-space indent + LF + final newline + UTF-8 no BOM. Markdown LF + final newline + no trailing whitespace. Discovery enumerates with `sort()` on POSIX paths before processing. `generatedAt` uses the format `YYYY-MM-DDTHH:MM:SSZ` exactly.
- **Determinism tiebreaker.** Whenever a derivation selects "N evidence pointers" or "N samples" out of a larger candidate set, choose by `sort()` on POSIX path (ascending), then `sort()` on line number (ascending), then `sort()` on the sanitized extracted value (ascending, byte order over UTF-8 NFC-normalized bytes), then take the first N. The third tiebreaker handles line-less artifacts (glossary terms, taxonomy node names, `cq:title` values) where the same path produces multiple candidate strings. Every rendered list (evidence pointers, glossary entries, conventions samples, avoid.md anti-patterns, test-patterns) follows this rule so re-runs are byte-identical.
- **Evidence-pointer format.** `<repo-relative-posix-path>:<1-based-line>`. Path uses `/` separators on every platform.
- **Sanitize extracted strings.** Length-cap 80 chars, inline-code wrap, strip the exhaustive Unicode code-point set (control, line/paragraph separators, zero-width, bidirectional overrides). Strings failing sanitization produce a TODO marker, not a partial value. Full rule and code-point list in [`references/privacy-and-sanitization.md`](./references/privacy-and-sanitization.md) § 2.
- **Diagnostic-path scrubbing.** Error messages reference paths relative to the workspace root only; never include absolute filesystem paths or `~/`.
- **Atomic write per file.** Every output goes to `<path>.tmp` and is renamed to `<path>` on success. Orphan `.tmp` files from a previous interrupted run are deleted at startup. Note: "atomic" applies to each individual file. A multi-step run that crashes between steps can leave earlier outputs on disk. The next invocation resumes idempotently because completed files carry markers with matching checksums (§ Idempotency).
- **Marker verification.** A file is treated as skill-owned only when (a) the marker line matches the documented format (§ Idempotency) **and** (b) the embedded `sha256` recomputed over the file body (excluding the marker line) matches the marker's stated value. A marker with a wrong, malformed, missing, or duplicated checksum is treated as **human-curated** and never overwritten. This prevents marker-spoofing attacks.
- **Equivalence guarantee.** A single canonical role-prompt source is projected into Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment formats so the content seen by the agent is identical regardless of IDE. The body is copied verbatim; only frontmatter, file extension, and per-IDE wrapper text differ.
