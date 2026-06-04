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

## Scope: AEM as a Cloud Service only

This skill targets **AEM as a Cloud Service** projects exclusively. It is
not applicable to AEM 6.5 LTS, AMS-hosted AEM, or on-premise AEM. The
skill exits early with a one-line notice when a non-Cloud-Service layout
is detected (signals: `core/wcm.io`/`pom.xml` declaring `uber-jar`
`6.5.*` classifiers, `dispatcher` legacy `conf/` only without
`conf.d/`, or `.cloudmanager/` absent **and** `aem.dispatcher.module`
referenced in any module pom).

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
  `avoid.md`, `glossary.md`, `test-patterns.md`, `aem-api-namespaces.md`, `README.md`, `.agentkit-manifest.json`, `.agentkit.lock`) — written at the workspace root **and** scoped per nested AEM sub-project (`.agentkit-manifest.json` and `.agentkit.lock` are workspace-root only)
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
own temporary `<path>.tmp` files (deleted at startup only when sitting next to
a marker-bearing target with the matching basename — never a blanket sweep),
and `<path>.agentkit-new` sidecar files (see § Idempotency), are the only
other paths the skill writes to; both sit alongside an allow-listed target.
The root `AGENTS.md` and `CLAUDE.md` are owned by `ensure-agents-md` and are
never modified by this skill. Every generated artifact carries a marker
comment so the customer can identify, delete, or regenerate them safely.

## Relationship to `ensure-agents-md`

`aem-agentkit` complements `ensure-agents-md` — they are not replacements
for each other.

| Skill | Owns | Outputs |
|---|---|---|
| `ensure-agents-md` | Root `AGENTS.md` + `CLAUDE.md` | 2 files |
| `aem-agentkit` | Per-module `AGENTS.md`, `.aem/context/`, tool-specific files | Everything else |

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
- Any of the slash commands it installs is invoked: `/new-component`, `/new-sling-model`, `/validate-dispatcher`, `/regen-context`, `/agents-md-check`. The full owned-names list lives in [references/per-tool-artifacts.md](./references/per-tool-artifacts.md) § 3.1.

The skill skips silently and exits cleanly when:

- Root `pom.xml` is missing AND no single-level fallback `pom.xml` is found (the skill checks `<workspace>/pom.xml`, then one level down at `aem/pom.xml`, `aemproject/pom.xml`, `project/pom.xml`; if exactly one fallback is found, the skill treats that directory as the AEM project root and emits a one-line notice. Two or more fallbacks → skip with diagnostic.).
- A `_disable_agentkit` regular file, directory, or symlink exists at the workspace root. Detection is by `lstat`-by-name only — the inode named `_disable_agentkit` is the signal; the skill never dereferences the symlink target. Contents are ignored. The skill makes no writes and exits with code 0. **Single-archetype workspaces:** when the workspace root is itself the only AEM project root, `_disable_agentkit` always means full skip — the preamble explicitly enumerates the disabled sub-project list (which equals "all detected sub-projects") so the customer cannot mistake partial-scope intent for whole-workspace skip. **Per-sub-project opt-out:** place `_disable_agentkit` inside a nested AEM sub-project root (depth ≥ 1 under the workspace root, and that directory must independently pass nested-AEM-project detection in [references/per-module-agents-md.md](./references/per-module-agents-md.md) § 1) to skip that sub-project only; the rest of the run proceeds.
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

If **no** signal is detected, the universal layer is written and the
preamble emits a one-line notice (`"aem-agentkit: no IDE signal detected;
writing universal layer only. Create .claude/, .cursor/, .continue/,
.github/instructions/, .clinerules, .windsurfrules, or augment.md and
re-run to layer in tool-specific artifacts."`). The summary block lists
what each undetected tool would receive on a later run.

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
12. `.aem/context/.agentkit-manifest.json` — run manifest (workspace root only). One entry per file the skill wrote, with the post-write checksum and the canonical workspace-relative path. Schema and consumer rules in [references/manifest.md](./references/manifest.md).

After step 12, run the **self-validation pass**:

- Every evidence pointer in `conventions.md`, `avoid.md`, `glossary.md`, `test-patterns.md` resolves to an existing file (and line, when given).
- Every `slingModelFqcn` in `components.json` resolves to an existing `.java` file.
- Every `implFqcn` in `osgi-services.json` resolves to an existing `.java` file.
- Every per-module `AGENTS.md` corresponds to an existing directory.
- Every tool-specific file carries the marker, the marker checksum recomputes correctly, and the canonical role-source body appears verbatim across all projected shapes for the same role.
- Every URL in every generated artifact resolves to either `experienceleague.adobe.com/en/docs/experience-manager-cloud-service/...` or `developer.adobe.com/experience-manager/reference-materials/cloud-service/...`. Any URL containing `/6.5/` or `experience-manager-65/` aborts the write.
- Every sanitized string in every generated Markdown contains zero code points from the strip-list in [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) § 2.1 (the deterministic helper re-checks every output before signaling success).
- Every entry in `.agentkit-manifest.json` matches the on-disk checksum of the named path.

On validation failure, the skill prints a one-line diagnostic naming the
failing file (workspace-relative path) and the failing check. **Each
individual file write is atomic** (`.tmp` + rename via the deterministic
helper) so no file is left half-written. Earlier successful writes from
steps 1–12 remain on disk and resume idempotently on the next invocation
because completed files carry markers whose checksums match. Exit code is
`0` on full success, `2` on a run that completed every step but recorded one
or more `warningStubs` entries, `1` on hard failure (a step did not complete).
The customer can remove every aem-agentkit-marker file at once with the grep
helper in [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) § Reversibility.

## Reference files

| File | Purpose |
|---|---|
| [references/per-module-agents-md.md](./references/per-module-agents-md.md) | Rules, templates, and size budgets for per-module `AGENTS.md` files |
| [references/codified-context.md](./references/codified-context.md) | `.aem/context/*` schemas, discovery rules, evidence-pointer format, schema versioning |
| [references/per-tool-artifacts.md](./references/per-tool-artifacts.md) | Tool detection signals, canonical role-prompt source, projection into Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment formats |
| [references/mcp-wiring.md](./references/mcp-wiring.md) | `.mcp.json` and `.cursor/mcp.json` non-destructive merge rules |
| [references/guardrails.md](./references/guardrails.md) | Guardrail rule text (search-before-create, verify-API, etc.) |
| [references/module-catalog.md](./references/module-catalog.md) | Module descriptions and add-on detection table |
| [references/collision-rules.md](./references/collision-rules.md) | Complete pre-existing-state behavior table |
| [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) | Skill version bump + JSON schema migration rules |
| [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) | Privacy deny-list, symlink hardening, Unicode sanitization rules |
| [references/output-format.md](./references/output-format.md) | Exact preamble / summary / error templates |
| [references/helpers.md](./references/helpers.md) | Deterministic helper specification (realpath, checksums, atomic write, sanitization, deny-list match, file walk) |
| [references/manifest.md](./references/manifest.md) | Run manifest schema and consumer rules |

## Deterministic helper (required)

The skill performs every operation listed in [references/helpers.md](./references/helpers.md)
through a single deterministic helper invoked via the agent's `Bash` tool.
The helper closes the gap between guarantees the LLM cannot uphold on its
own (`O_NOFOLLOW`, byte-exact SHA-256, atomic `rename(2)`, exhaustive
Unicode strip, sorted-key JSON re-serialization, bounded file walk) and
the spec's contracts that depend on those operations. The skill **refuses
to run** when the helper is not available on `PATH` or in the published
skill bundle; this is the only authoritative dependency the skill carries.
The helper is content-addressable and version-pinned to the skill's
`metadata.version`; a mismatch aborts the run with a single diagnostic
naming the expected and observed versions. Helper failure on any
individual call surfaces a one-line workspace-relative diagnostic and
aborts the current step; the multi-step run resumes idempotently on the
next invocation.

## Concurrency control

At startup the skill acquires an exclusive advisory lock on
`.aem/context/.agentkit.lock` (created on first run; never deleted, so the
lock-file inode is stable across runs and parallel invocations contend
correctly). The lock is held for the entire run and released on exit (clean
or error). A second invocation that finds the lock held prints a single
workspace-relative diagnostic (`aem-agentkit: another invocation is
already running (.aem/context/.agentkit.lock); skipping.`) and exits `1`.
Acquisition is via `flock(LOCK_EX | LOCK_NB)` on POSIX and
`LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)` on
Windows; both are performed by the deterministic helper (see
[references/helpers.md](./references/helpers.md) § Concurrency).

## Idempotency

- **Never overwrite** any pre-existing file lacking our marker.
- Each generated artifact's first content line is a marker:
  - Markdown / `.mdc`: `<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->`
  - JSON: leading top-level fields `"_generatedBy": "aem-agentkit"`, `"_skillVersion": "1.0.0-beta"`, `"schemaVersion": "1"`, `"_markerChecksum": "<sha256>"`. `generatedAt` is **not** part of the checksummed body (see [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) § 1).
- Re-running the skill is a no-op when nothing has drifted.
- A file lacking the marker is treated as **human-curated**; the skill never touches it. When the skill would otherwise write to such a path, it writes to `<path>.agentkit-new` instead and surfaces a one-line diff summary.
- A marker-bearing file with a different checksum (because we ship new templates) is **not** overwritten — the new content goes to `.agentkit-new`; the customer chooses whether to swap. **Static-reference files** (`.aem/context/aem-api-namespaces.md`, `.aem/context/README.md`) are flagged with a `_static: true` field in their marker and **are** overwritten in place on a skill version bump because they have no customer content to lose; this exception is the only place the skill rewrites a marker-bearing file without customer review.

## Modes

| Mode | Trigger | Behavior |
|---|---|---|
| Default | Skill invoked, opt-out signals absent | Step 0: defer to `ensure-agents-md` if root `AGENTS.md` missing and that skill is available. Step 1+: generate missing universal + matching tool-specific artifacts. |
| Refresh | `/regen-context` slash command (per detected tool) or skill argument | Regenerate only `.aem/context/*`. Diffs go to `.agentkit-new` per § Idempotency. |
| Check | `/agents-md-check` slash command or `--check` | Read-only drift report driven by `.aem/context/.agentkit-manifest.json` (see [references/manifest.md](./references/manifest.md) § Consumer rules). Non-zero exit when stale. |

## What this skill never does

- Modify customer source code (Java, HTL, JSP, JS/TS/CSS, dispatcher `.conf`/`.any`/`.farm`, FileVault XML, `pom.xml`, content `.json`, OSGi config, `README`, `CONTRIBUTING`, `LICENSE`, or any other pre-existing file lacking the marker).
- Modify the root `AGENTS.md` or `CLAUDE.md`.
- Write into `.git/`, `target/`, `node_modules/`, `dist/`, `build/`, `out/`, `crx-quickstart/`, `.idea/`, `.vscode/` (except for the documented read of `.vscode/extensions.json`).
- Read any file matching the **privacy deny-list** in [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) § 1. Matching is case-insensitive (ASCII lowercase casefold pinned, see § 1) on every platform and is applied to **every path segment**, so a directory whose name matches a deny pattern prunes the entire subtree from the walk. `.git/HEAD` and `.git/refs/heads/*` are the only files read from `.git/`. Fail closed on uncertainty.
- Mention specific MCP server packages by name in the bodies of generated AGENTS.md / per-module AGENTS.md files. Server names belong in `.mcp.json` / `.cursor/mcp.json`, which the skill seeds as inert placeholders only — never as live wiring (see [references/mcp-wiring.md](./references/mcp-wiring.md)).
- Use marketing language in any generated artifact. Generated content frames itself as agentic workflow context.
- Embed AEM 6.5 documentation URLs. All resource links use the Cloud Service namespace. The self-validation pass rejects any URL containing `/6.5/` or `experience-manager-65/` before the manifest is written.
- Prompt the customer for input. IDE detection is silent.

## Communication contract

The skill writes to the user at exactly three points: a one-line
preamble before any writes, a deterministic summary after all writes
(with counts, detected-tool rows, a `MCP placeholders to replace` row
when applicable, and a `Warnings` row enumerating every `warningStubs`
entry), and a one-line workspace-relative diagnostic on any error. Each
file write is atomic (`.tmp` + rename via the deterministic helper); a
multi-step run that is interrupted leaves earlier completed files on
disk and resumes idempotently on the next invocation. Full templates and
conditional-row rules in
[references/output-format.md](./references/output-format.md).

## Rules

- **Never overwrite** any pre-existing file (§ Idempotency).
- **Never hallucinate.** Only emit a derived rule when ≥ 3 evidence points exist; otherwise emit a TODO marker.
- **Never read** files in § "What this skill never does". Path matching is case-insensitive (ASCII lowercase casefold) on every platform and applies to every path segment, pruning matching directories from the walk.
- **Never write** outside the allow-list in § "Hard guarantee".
- **Customer-only discovery.** Components, models, and services are discovered from the customer's source modules. Do not index Core Components or anything under `/libs`.
- **Workspace boundary + symlink hardening.** Only walk paths under the workspace root. The workspace root is realpath-resolved once at startup; every subsequent realpath comparison is against that resolved root (so platforms where the workspace lives below a symlinked prefix like `/var/folders → /private/var/folders` on macOS are handled correctly). Realpath check, workspace-escape rejection, deny-list rejection on every path segment, special-filesystem rejection (`/proc`, `/sys`, `/dev`, `/var/run`, `/run`, `\\?\` device paths and UNC roots on Windows — rejected even when the workspace itself lives under one), visited-set loop guard, `O_NOFOLLOW` open, depth cap 32, file-walk cap 100,000 with `truncated: true` index marker. Full rules in [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) § 1.2.
- **Output stability.** JSON sorted-keys + 2-space indent + LF + final newline + UTF-8 no BOM. Markdown LF + final newline + no trailing whitespace. Discovery enumerates with `sort()` on POSIX paths before processing. `generatedAt` uses the format `YYYY-MM-DDTHH:MM:SSZ` exactly and is excluded from the marker checksum so re-runs that produce identical content remain byte-identical under the marker contract.
- **Determinism tiebreaker.** Whenever a derivation selects "N evidence pointers" or "N samples" out of a larger candidate set, sort by `sort()` on POSIX path (ascending), then `sort()` on line number (ascending), then `sort()` on the **pre-sanitization** extracted value (ascending, byte order over UTF-8 NFC-normalized bytes), then `sort()` on the SHA-256 of the pre-sanitization value (ascending lowercase hex), then take the first N. The third tiebreaker handles line-less artifacts and the fourth closes ambiguity when post-sanitization truncation would collide. Every rendered list (evidence pointers, glossary entries, conventions samples, avoid.md anti-patterns, test-patterns) follows this rule so re-runs are byte-identical.
- **Evidence-pointer format.** `<repo-relative-posix-path>:<1-based-line>`. Path uses `/` separators on every platform.
- **Sanitize extracted strings.** Performed by the deterministic helper (see [references/helpers.md](./references/helpers.md) § Sanitize): length-cap 80 chars, inline-code wrap, strip the exhaustive Unicode code-point set in [references/privacy-and-sanitization.md](./references/privacy-and-sanitization.md) § 2.1. Strings failing sanitization produce a TODO marker, not a partial value. The self-validation pass re-checks every output for any code point from the strip-list.
- **Diagnostic-path scrubbing.** Error messages reference paths relative to the workspace root only; never include absolute filesystem paths or `~/`.
- **Atomic write per file.** Every output goes to `<path>.tmp` and is renamed to `<path>` via the deterministic helper. Orphan `.tmp` files are deleted at startup **only** when the `.tmp` sits next to a marker-bearing target with the matching basename (e.g. `core/AGENTS.md.tmp` cleanup requires `core/AGENTS.md` with a valid marker). A bare `target/foo.tmp` left by a customer's build is never touched.
- **Marker verification.** A file is treated as skill-owned only when (a) the marker line matches the documented format (§ Idempotency) **and** (b) the embedded `sha256` recomputed over the canonical body bytes (see [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) § 1 for the byte-exact canonical-body definition) matches the marker's stated value. A marker with a wrong, malformed, missing, or duplicated checksum is treated as **human-curated** and never overwritten. This prevents marker-spoofing attacks. Markers whose first line *almost* matches the shape but fails to parse are surfaced as a distinct `suspiciousMarkers` category by `/agents-md-check` so the customer can investigate.
- **Equivalence guarantee.** A single canonical role-prompt source is projected into Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment formats so the body seen by the agent is byte-identical regardless of IDE. Frontmatter, file extension, and per-IDE wrapper text differ; the role body does not. Concatenated single-file projections (Cline / Windsurf / Augment) inline the deferred roles into a sibling `<file>.aem-roles-extra.md` so the customer always has the full set on disk; the spec never expects the customer to traverse back to the published skill bundle.
- **Sub-project resolution in role bodies.** Role bodies that reference paths like `ui.apps/src/main/content/jcr_root/apps/<project>/components/<name>/` resolve `<project>` and the prefix at runtime by walking up from the file under edit to the closest `pom.xml` whose directory either is the workspace root or matches a nested-AEM-project detection from [references/per-module-agents-md.md](./references/per-module-agents-md.md) § 1. The role bodies state this explicitly; in multi-brand monorepos the agent therefore writes into the correct sub-project tree instead of a single hard-coded path.
- **Input validation for slash-command arguments.** `<name>` and `<FQCN>` arguments in slash-command templates are validated against an anchored regex before any shell or filesystem interpolation. The `MVN_CMD` template variable is restricted to the literal set `{"mvn", "./mvnw"}`; any other resolved value emits a `warningStubs` entry and the build line is omitted from the rendered artifact.
- **Heuristic transparency.** Every heuristic decision the skill makes (module shape per [references/per-module-agents-md.md](./references/per-module-agents-md.md) § 1.2, frontend variant per [references/module-catalog.md](./references/module-catalog.md), DS generation per [references/codified-context.md](./references/codified-context.md) § 4, add-on detection) is recorded in `.agentkit-manifest.json` under `heuristics[]` and surfaced in the summary block. Customers can override an inferred decision by populating `.aem/agentkit-overrides.yml` at the workspace root (schema in [references/manifest.md](./references/manifest.md) § Overrides) — the override takes precedence on the next run.
