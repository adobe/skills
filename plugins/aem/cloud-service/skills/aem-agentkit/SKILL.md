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
| [references/per-tool-artifacts.md](./references/per-tool-artifacts.md) | Tool detection signals, canonical role-prompt source, projection into Claude / Cursor / Copilot / Continue formats |
| [references/mcp-wiring.md](./references/mcp-wiring.md) | `.mcp.json` and `.cursor/mcp.json` non-destructive merge rules |
| [references/guardrails.md](./references/guardrails.md) | Guardrail rule text (search-before-create, verify-API, etc.) |
| [references/module-catalog.md](./references/module-catalog.md) | Module descriptions and add-on detection table |
| [references/collision-rules.md](./references/collision-rules.md) | Complete pre-existing-state behavior table (25+ scenarios) |
| [references/upgrade-and-migration.md](./references/upgrade-and-migration.md) | Skill version bump + JSON schema migration rules |

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
- Read any path matching the privacy deny-list. Match is **case-insensitive** on every platform (so `Credentials.json`, `SECRETS.txt`, and `.ENV` are denied). Patterns:
  - `.cloudmanager/env*.json`, `.cloudmanager/secrets*` (the only file read from `.cloudmanager/` is `java-version`)
  - `.env`, `.env.*`
  - `**/credentials*`, `**/credential*`, `**/*creds*`, `**/*cred`, `**/*secret*`, `**/*secrets`, `**/*password*`, `**/*passwd*`, `**/*token*`, `**/api[-_]key*`, `**/apikey*`, `**/auth.json`, `**/auth-config*`
  - PKI / keystores: `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/*.p8`, `**/*.jks`, `**/*.jceks`, `**/*.keystore`, `**/*.truststore`, `**/keystore`, `**/truststore`, `**/*.p7b`
  - SSH keys: `**/id_rsa*`, `**/id_dsa*`, `**/id_ecdsa*`, `**/id_ed25519*`, `**/.ssh/**`, `**/*.ovpn`
  - Cloud SDK credentials: `**/.aws/**`, `**/.gcp/**`, `**/*.key.json` (`*.key` does **not** glob-match `.key.json` on its own), `**/.azure/**`, `**/.kube/**`, `**/kubeconfig`
  - Package registry / build secrets: `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml`, `**/.pypirc`, `**/.gem/credentials`, `**/.dockercfg`, `**/.docker/config.json`, `**/.m2/**/settings.xml`, `**/.m2/**/settings-security.xml` (Maven user-home settings, classified by path alone to avoid the bootstrap-loop of reading-to-classify; project-local `pom.xml` and any other `settings.xml` outside `.m2/` are not denied), `**/.netrc`, `**/_netrc`, `**/.htpasswd`
  - Adobe IO / IMS: `**/.adobe-aio*`, `**/aio-config.json`, `**/*-private.pem`, `**/*ims*credentials*`, `**/serviceuser*key*`
  - IaC state and secret vars: `**/*.tfvars`, `**/*.tfstate`, `**/*.tfstate.backup`, `**/.terraform/**`
  - PGP / encrypted: `**/*.gpg`, `**/*.asc`, `**/*.kdbx`, `**/wallet.dat`, `**/.gnupg/**`
  - `.git/` is never read except for `.git/HEAD` (top-of-tree branch) and `.git/refs/heads/*` (current SHA); `.git/config` is never read because it may contain `https://oauth2:<TOKEN>@…` URLs.
  - **Fail closed.** If a path's classification is ambiguous, skip it and emit a `warningStubs` entry; never read on uncertainty.
- Mention specific MCP server packages by name in the bodies of generated AGENTS.md / per-module AGENTS.md files. Server names belong in `.mcp.json` / `.cursor/mcp.json`, which the skill seeds as inert placeholders only — never as live wiring (see [references/mcp-wiring.md](./references/mcp-wiring.md)).
- Use marketing language in any generated artifact. Generated content frames itself as agentic workflow context.
- Embed AEM 6.5 documentation URLs. All resource links use the Cloud Service namespace.
- Prompt the customer for input. IDE detection is silent.

## Communication contract

The skill writes only at three points to the user:

**Before any writes — one line:**

> Bootstrapping agentic workflow context for this AEM as a Cloud Service repository. No source files will be modified.

**When `_disable_agentkit` is detected — one line, then exit 0:**

> aem-agentkit: skipped (opt-out signal `_disable_agentkit` present at `<workspace-relative-path>`). No writes performed.

**After all writes — concise deterministic summary:**

```
aem-agentkit: complete
  Universal layer:
    Per-module AGENTS.md: <N> across [<modules>]
    Indexes: components.json (N), osgi-services.json (N)
    Derived: conventions.md (N rules, T TODOs), avoid.md (N entries),
             glossary.md (N terms), test-patterns.md (N rules)
    Static refs: aem-api-namespaces.md, README.md
  Tool-specific layer (detected: <tool list>):
    Claude:   <count> agents, <count> commands, mcp.json (existing|new-placeholder|absent)
    Cursor:   <count> rules, mcp.json (existing|new-placeholder|absent)
    Copilot:  <count> instructions
    Continue: <count> rules
    Cline:    .clinerules (existing|new|absent)
    Windsurf: .windsurfrules (existing|new|absent)
    Augment:  augment.md (existing|new|absent)
  TODO markers: <T> items pending human review
  MCP placeholders to replace: <N> (in <files>) — agent will not connect until set
  Refresh:   /regen-context
  Drift:     /agents-md-check
```

The `MCP placeholders to replace` row is emitted whenever `.mcp.json` or
`.cursor/mcp.json` was written from the placeholder template and still
contains one or more `_TODO_*` server-name keys (the inert sentinel
shape used in `templates/mcp.json.template`). The customer must rename
each `_TODO_*` key and supply `command` / `args` before any MCP server
will connect; see [references/mcp-wiring.md](./references/mcp-wiring.md).

**On any error:** a single line describing the failure plus the diagnostic path. The skill never leaves partial outputs (atomic write: `.tmp` + rename).

After the summary, the skill yields back so the user's original request proceeds with the new context loaded.

## Rules

- **Never overwrite** any pre-existing file (§ Idempotency).
- **Never hallucinate.** Only emit a derived rule when ≥ 3 evidence points exist; otherwise emit a TODO marker.
- **Never read** files in § "What this skill never does". Path matching is case-insensitive on every platform.
- **Never write** outside the allow-list in § "Hard guarantee".
- **Customer-only discovery.** Components, models, and services are discovered from the customer's source modules. Do not index Core Components or anything under `/libs`.
- **Workspace boundary + symlink hardening.** Only walk paths under the workspace root. Before opening any file, resolve its canonical realpath and reject the path if (a) the realpath escapes the workspace root, (b) the realpath matches the deny-list, or (c) the walk has already visited that realpath (loop guard). Open with `O_NOFOLLOW` (platform equivalents: `FILE_FLAG_OPEN_REPARSE_POINT` on Windows, `O_NOFOLLOW_ANY` on macOS) and re-check the opened descriptor's canonical path before reading, closing the TOCTOU window between resolve and open. Deduplication uses realpath, not inode, so filesystems with unstable inodes (some Windows mounts) are handled correctly. Hard depth cap: 32 directories from the workspace root. Hard file-walk cap: 100,000 files; on overflow, mark every index `truncated: true`, emit `warningStubs`, and refuse to declare indexes authoritative (downstream slash commands gate on `truncated`).
- **Output stability.** JSON sorted-keys + 2-space indent + LF + final newline + UTF-8 no BOM. Markdown LF + final newline + no trailing whitespace. Discovery enumerates with `sort()` on POSIX paths before processing. `generatedAt` uses the format `YYYY-MM-DDTHH:MM:SSZ` exactly.
- **Determinism tiebreaker.** Whenever a derivation selects "N evidence pointers" or "N samples" out of a larger candidate set, choose by `sort()` on POSIX path (ascending), then `sort()` on line number (ascending), then `sort()` on the sanitized extracted value (ascending, byte order over UTF-8 NFC-normalized bytes), then take the first N. The third tiebreaker handles line-less artifacts (glossary terms, taxonomy node names, `cq:title` values) where the same path produces multiple candidate strings. Every rendered list (evidence pointers, glossary entries, conventions samples, avoid.md anti-patterns, test-patterns) follows this rule so re-runs are byte-identical.
- **Evidence-pointer format.** `<repo-relative-posix-path>:<1-based-line>`. Path uses `/` separators on every platform.
- **Sanitize extracted strings.** Any string extracted from customer source (evidence-pointer line snippets, `cq:title` values, Content Fragment model titles, taxonomy node names, Java package names) and baked into a generated Markdown file must be (a) length-capped to 80 characters with `…` suffix if truncated, (b) wrapped in backticks (inline code) so it cannot be parsed as instruction text by a downstream agent, (c) stripped of the following code points (exhaustive list):
  - **Control characters:** U+0000 – U+001F except `\t` (U+0009).
  - **Line/paragraph separators that escape inline-code wrap:** U+2028, U+2029.
  - **Zero-width / invisible:** U+00AD (soft hyphen), U+180E (Mongolian vowel separator), U+200B – U+200F (zero-width set), U+2060 (word joiner), U+FEFF (zero-width no-break space / BOM).
  - **Bidirectional / directional overrides:** U+061C (Arabic letter mark), U+202A – U+202E, U+2066 – U+2069.

  Strings failing sanitization produce a TODO marker in place of the value, not a partial value. **Implementation note (v0.2 roadmap).** This rule is at the limit of what an LLM can execute deterministically over arbitrary Unicode input; a future release will move sanitization into a deterministic helper invoked from the skill (Python one-liner over `unicodedata` plus the explicit code-point set above). Until then, regenerate `glossary.md` only when content drifts and review TODO markers after every run.
- **Diagnostic-path scrubbing.** Error messages reference paths relative to the workspace root only; never include absolute filesystem paths or `~/`.
- **Atomic write per file.** Every output goes to `<path>.tmp` and is renamed to `<path>` on success. Orphan `.tmp` files from a previous interrupted run are deleted at startup. Note: "atomic" applies to each individual file. A multi-step run that crashes between steps can leave earlier outputs on disk. The next invocation resumes idempotently because completed files carry markers with matching checksums (§ Idempotency).
- **Marker verification.** A file is treated as skill-owned only when (a) the marker line matches the documented format (§ Idempotency) **and** (b) the embedded `sha256` recomputed over the file body (excluding the marker line) matches the marker's stated value. A marker with a wrong, malformed, missing, or duplicated checksum is treated as **human-curated** and never overwritten. This prevents marker-spoofing attacks.
- **Equivalence guarantee.** A single canonical role-prompt source is projected into Claude / Cursor / Copilot / Continue / Cline / Windsurf / Augment formats so the content seen by the agent is identical regardless of IDE. The body is copied verbatim; only frontmatter, file extension, and per-IDE wrapper text differ.
