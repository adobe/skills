---
name: commerce-app-migrate
description: >
  Migrate an Adobe Commerce App Builder project from the Integration Starter Kit or Checkout Starter Kit to the new App Management approach. Run from the root of the App Builder project to be migrated. Pass --auto to skip confirmation prompts (suitable for CI or batch use) — auto mode prints a summary of all Q&A questions answered with their defaults. Pass --doc-scan-only to scan README.md and env.dist for outdated content without modifying any files. Use when the user wants to migrate an App Builder project from the Integration Starter Kit or Checkout Starter Kit to the App Management approach, or mentions upgrading their Adobe Commerce extension architecture.
license: Apache-2.0
compatibility: >
  Requires Node.js 22+, aio CLI, and @adobe/aio-commerce-lib-app.
  Run from the root of the App Builder project being migrated.
metadata:
  author: adobe
  sdk-package: "@adobe/aio-commerce-lib-app"
  version: "0.0.1"
---

# Migrate to App Management

Use this skill when the user wants to migrate an Adobe Commerce App Builder
project from the Integration Starter Kit or Checkout Starter Kit to the new
App Management approach using `@adobe/aio-commerce-lib-app`.

This skill orchestrates the full migration: detection → domain analysis → Q&A →
config assembly → execution. It leaves the project fully migrated and ready to deploy.

### Confirmation protocol

At each step marked **[await]**: end your turn immediately, output nothing further,
and wait for the developer's reply before proceeding.

**Autonomous mode:** If invoked with `--auto` or `--yes`, or the context indicates an
automated pipeline (no interactive terminal), skip all **[await]** points and proceed
directly to the next step.

**Doc-scan-only mode:** If invoked with `--doc-scan-only`, skip all migration steps after
the Analyzer. After Step 1 completes (Analyzer returns a `ProjectSnapshot`):

- If `alreadyMigrated === false`, output:

      --doc-scan-only requires the project to already be migrated to App Management.
      No app.commerce.config.ts (or .js) was found.

      Run /commerce-app-migrate (without --doc-scan-only) to perform the migration first.

  Then stop.

- If `alreadyMigrated === true`, apply any applicable Cross-cutting Warnings, then
  dispatch the Executor in doc-scan-only mode. No files are modified.
  Do not proceed to Steps 2–5.

---

## Preflight Check

Before doing anything else, verify the current directory looks like an App Builder project.
Check that ALL of these exist:

- `app.config.yaml`
- `package.json`
- At least one of: `actions/` directory OR `src/` directory OR `actions-src/` directory
  (some projects compile TypeScript from `actions-src/` to `actions/`; `actions/` may be
  gitignored and absent in a fresh checkout)

If none of those pass, stop immediately and output:

    This directory does not appear to be a Commerce App Builder project.
    Expected to find: app.config.yaml, package.json, and an actions/ or src/ directory.

    Please run this skill from the root of your App Builder project.

Do not proceed further if the preflight fails.

---

## Step 1: Run Analyzer Agent

Dispatch the Analyzer agent (defined in `${CLAUDE_SKILL_DIR}/agents/analyzer.md`) using the Agent tool.
The Analyzer reads the current directory and returns a `ProjectSnapshot` JSON object
(schema defined in `${CLAUDE_SKILL_DIR}/shared/schema.md`).

**Before printing the summary, check these early-exit conditions:**

**If `alreadyMigrated === true`:** Output:

    This project appears to already be migrated to App Management.
    Found: app.commerce.config.ts (or app.commerce.config.js with ESM defineConfig)

    Re-running migration would overwrite your existing configuration.
    If you want to re-generate specific sections, please specify which
    section to update: metadata / eventing / installation / adminUi / businessConfig

Then apply any applicable Cross-cutting Warnings (see subsection below).

Then dispatch the Executor agent (`${CLAUDE_SKILL_DIR}/agents/executor.md`) in
**doc-scan-only mode** to produce documentation recommendations for the project:

- Pass `mode = "doc-scan-only"` to the Executor
- Pass the `ProjectSnapshot` JSON from the Analyzer
- Pass `assembled config = null` (no new config to write)

The Executor will scan `README.md` and `env.dist` against the existing
`app.commerce.config.ts` and print the "Documentation recommendations" report
without modifying any files.

**Do not proceed to Steps 2–5 (domain agents, Q&A, config assembly, full execution)
unless the developer explicitly requests a specific section update.**

After the Executor prints the documentation recommendations, **stop**. Do not continue to
the "Detected project:" summary block or the migration confirmation prompt below.

After the Analyzer returns, print a human-readable summary:

    Detected project:
      Type:             <starterKitType> Starter Kit
      Auth mode:        <authMode> (<paas = "PaaS/OAuth1" | saas = "SaaS/IMS" | dual = "Both PaaS + SaaS" | unknown = "Unknown">)
      Action packages:  <comma-separated list of package names> (<count> packages)
      Onboarding:       <comma-separated list of script paths with purposes, or "none">
      Package manager:  <packageManager>

    Migration will include: <list domains where confidence !== "none">

Apply any applicable Cross-cutting Warnings (see subsection below).

**If `hasMeshConfig === true`**, also append:

    ⚠ API Mesh configuration detected (mesh.json).
    Mesh configuration cannot be migrated automatically and must be preserved manually.

Then ask:

    Does this look correct? (yes / no — if no, describe what's wrong)
    Press Enter or type "yes" to proceed automatically.

**[await]**

**Handle corrections:**

- If developer corrects `starterKitType`, update it in the ProjectSnapshot before proceeding
- If developer corrects `authMode`, update it
- Re-print summary with corrections and ask again until confirmed

**Handle unknown starterKitType:**
If `starterKitType === "unknown"`, check `extensionPointsInUse`:

- If `"commerce/backend-ui/1"` is present → this is an **Admin UI SDK v1 extension**. Proceed
  with `starterKitType = "unknown"` — the admin-ui-sdk domain agent will migrate it to v2.
  Print a note: "Detected Admin UI SDK v1 (commerce/backend-ui/1). Migrating to v2 (commerce/backend-ui/2)."
- If all confidence values are `"none"` AND `extensionPointsInUse` is empty:
  Output:

      This project does not appear to be based on the Integration Starter Kit
      or Checkout Starter Kit. No event consumers, webhooks, or Admin UI SDK
      patterns were detected.

      Migration can still generate a minimal app.commerce.config.ts with metadata
      only. Continue? (yes / no)

  If developer says no, stop. If yes, proceed with empty domain results.

- Otherwise, ask the developer:

      I couldn't determine which starter kit this project is based on.
      Is this an Integration Starter Kit or a Checkout Starter Kit?
      Options: [integration / checkout / adminUiSdk / custom]

      Not sure? See the documentation:
        • Integration Starter Kit: https://developer.adobe.com/commerce/extensibility/starter-kit/integration/
        • Checkout Starter Kit:     https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/

  Update the ProjectSnapshot with their answer before proceeding.

### Cross-cutting Warnings

Apply these whenever the corresponding field is set in the ProjectSnapshot, regardless
of migration state. Append each matching block to whatever output is currently being built.

**If `openWhiskTriggers` is non-empty**, append:

    ⚠ OpenWhisk triggers detected (cannot be auto-migrated):
      <list each trigger description>
    These scheduled triggers have no direct equivalent in App Management.

Read `${CLAUDE_SKILL_DIR}/shared/migration-warnings.md` (OpenWhisk Triggers section)
and present the replacement options to the developer.

**If `hasApiGateway === true`**, append:

    ⚠ OpenWhisk API Gateway routes detected (apis: blocks in runtime manifest).
    These HTTP routes have no direct equivalent in App Management.

Read `${CLAUDE_SKILL_DIR}/shared/migration-warnings.md` (API Gateway section)
and present the migration options to the developer.

**If `hasSequences === true`**, append:

    ⚠ OpenWhisk sequences detected.
    Action sequences have no equivalent in App Management.

Read `${CLAUDE_SKILL_DIR}/shared/migration-warnings.md` (Sequences section)
and present the refactoring guidance to the developer.

---

## Step 2: Dispatch Domain Agents in Parallel

For each domain where `confidence !== "none"`, dispatch the corresponding agent
**at the same time** using the Agent tool (all in one parallel call):

| confidence field                       | Agent file                                      |
| -------------------------------------- | ----------------------------------------------- |
| `confidence.events !== "none"`         | `${CLAUDE_SKILL_DIR}/agents/events.md`          |
| `confidence.webhooks !== "none"`       | `${CLAUDE_SKILL_DIR}/agents/webhooks.md`        |
| `confidence.adminUiSdk !== "none"`     | `${CLAUDE_SKILL_DIR}/agents/admin-ui-sdk.md`    |
| `confidence.businessConfig !== "none"` | `${CLAUDE_SKILL_DIR}/agents/business-config.md` |

Each agent receives:

- The `ProjectSnapshot` JSON
- Instruction to read the relevant files in the current directory using their own Read tools

Collect all returned `DomainResult` objects. Each has `domain`, `configFragment`,
and `unresolvedQuestions` fields (schema in `${CLAUDE_SKILL_DIR}/shared/schema.md`).

---

## Step 3: Grouped Q&A

Collect all `unresolvedQuestions` from every `DomainResult`.
If there are no unresolved questions across all domains, skip to Step 4.

Present all questions in a single grouped session (format defined in `${CLAUDE_SKILL_DIR}/shared/questions.md`):

- Group by domain
- For questions with `default` values, show as confirmations: "(suggested: X)"
- Number questions sequentially across domains

**[await]**

For each answer received:

- Apply it to the `configFragment` of the corresponding `DomainResult`
- Use the question `id` to locate the exact field to update

If the developer accepts a suggested value (presses Enter / says "yes"), use the `default`.

**Special case — skip-by-default questions** (where `default` is `"no"`):
These questions ask whether to include an optional section that was omitted from the
`configFragment` because required data was missing (e.g. a provider direction with no
deployed action package). Interpret the developer's reply as:

- `"no"` (or pressing Enter) → leave the section out of the `configFragment`; do nothing
- `"yes"` or any action string → add the section back; prompt for the runtime action name
  if not already specified in the reply, then apply it to the `configFragment`

**Autonomous mode — auto-accepted defaults summary:**

In `--auto` mode, after applying all question defaults, print:

    ── Auto-accepted defaults ────────────────────────────────────────
      The following questions were answered automatically (--auto mode):
      [  <domain> : <question id> = "<default value>"  ]
         ← one line per question that had an explicit default; omit entire section if no questions existed →

Omit this section entirely if there were no unresolved questions across all domains.

---

## Step 4: Assemble app.commerce.config.ts

Read `package.json` from the current directory to extract metadata.

Assemble the full config content by merging all `configFragment` objects:

```typescript
import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

export default defineConfig({
  metadata: {
    id: "<derived from package.json name>",
    displayName: "<derived from package.json name>",
    version: "<from package.json version or 1.0.0>",
    description:
      "<from package.json description or 'Commerce App Builder application'>",
  },
  // eventing: { ... }          ← from events DomainResult, if present
  // installation: { ... }      ← from webhooks DomainResult, if present
  // adminUi: { ... }           ← from admin-ui-sdk DomainResult (migrated from v1), if present
  // businessConfig: { ... }    ← from business-config DomainResult, if present
});
```

**Metadata derivation rules:**

- `id`: Check `extension-manifest.json` first — if it has an `id` field and it is not
  the same as the package name boilerplate, use it (apply same normalization: lowercase,
  replace non-alphanumeric with `-`, trim, max 50 chars).
  Otherwise take `name` from `package.json`. Strip npm scope (`@scope/`). Replace
  any non-alphanumeric characters (except `-`) with `-`. Lowercase the entire string.
  Trim leading/trailing dashes. Max 50 chars.
  Known ISK boilerplate names to skip in favor of extension-manifest.json:
  `commerce-integration-starter-kit`, `starter-kit`, `commerce-checkout-starter-kit`,
  `aio-app-builder-template`.
- `displayName`: Check `extension-manifest.json` first — if it has a `displayName` field,
  use it (truncated to 50 chars). Otherwise title-case the `id` (replace `-` with spaces).
  Max 50 chars.
- `version`: Use `package.json` `version`. Default: `"1.0.0"`.
- `description`: Use `package.json` `description` if present.
  If the description exceeds 255 characters, truncate it to 252 characters and append `"..."`.
  If absent or empty, check `extension-manifest.json` `description` field (truncate to 255 if needed).
  If neither has a description: `"Commerce App Builder application"`.

**productDependencies comment:**
If `ProjectSnapshot.productDependencies` is non-null (has `minVersion` and/or `maxVersion`):
Insert this comment block in the assembled TypeScript, immediately AFTER the copyright header
and BEFORE the `import { defineConfig }` line:

```typescript
// Product version constraints (no App Management equivalent — for reference only):
// Adobe Commerce compatibility: >= <minVersion>, < <maxVersion>
// Contact Adobe Commerce Marketplace for guidance on version enforcement.
```

Omit the `< <maxVersion>` part if `maxVersion` is null. Omit the `>= <minVersion>` part if
`minVersion` is null. If both are null or `productDependencies` is null, omit the comment entirely.

Print the assembled TypeScript content to the terminal:

    Here is the app.commerce.config.ts that will be created:

    ─────────────────────────────────────────────────────────
    import { defineConfig } from '@adobe/aio-commerce-lib-app/config'

    export default defineConfig({
      ...assembled content...
    })
    ─────────────────────────────────────────────────────────

    Does this look correct? (yes / no — if no, which section needs updating?)
    Press Enter or type "yes" to proceed automatically.

**[await]**

**Handle rejection:**
If the developer says no, ask: "Which section needs updating? (metadata / eventing /
installation / adminUi / businessConfig)"

Then ask the specific corrective question for that section, update the assembled
config accordingly, re-print, and ask for confirmation again.

Repeat until the developer confirms. Do NOT restart the entire flow — only
re-enter the Q&A for the specific section being corrected.

---

## Step 5: Execute Migration

Dispatch the Executor agent (`${CLAUDE_SKILL_DIR}/agents/executor.md`) with:

1. The assembled `app.commerce.config.ts` TypeScript content as a string
2. The final `ProjectSnapshot` JSON

The Executor performs all file writes and CLI commands and prints the migration summary.

If the Executor reports an error, relay the error message and the step that failed.
Do not attempt to roll back changes — the git branch created by the Executor provides
a rollback point (`git checkout main` to abandon the migration).

---

## Notes

- Domain agents (Step 2) run **in parallel** — dispatch all eligible agents in one Agent tool call
- Analyzer (Step 1) and Executor (Step 5) are sequential — Analyzer first, Executor last
- This skill runs in the **developer's project directory**, not the migration skill repository
- **Documentation recommendations** are produced by the Executor and cover:
  - README.md sections flagged by 5 patterns: ISK onboarding commands, old env var references, outdated architecture diagrams, credential-family semantic matching (IMS/SaaS, PaaS/OAuth1, workspace), and env setup boilerplate (`cp env.dist .env`)
  - env.dist entries grouped into three buckets: safe-to-remove (managed by App Management), review-manually (referenced in action source files, grouped by file), and onboarding-only (used only in onboarding scripts)
  - Rule 9 catches unreferenced env.dist variables not matched by any other rule and flags them for manual review
  - Category C (README) requires ≥ 5 flagged sections to emit the recommendations block
- **`--auto` mode** prints a summary of all Q&A questions answered automatically with their defaults (omitted if no questions existed)
- **`productDependencies`** version constraints from `extension-manifest.json` are auto-inserted as a comment block immediately before the `import { defineConfig }` line in the generated `app.commerce.config.ts`
- **Internal metadata fields** (`_directionWarning`, `_source`) may be added by domain agents to `configFragment` objects — the Executor strips these before writing files so they never appear in the output TypeScript

## Supporting Files

Agent files dispatched by this skill:

- [Analyzer](agents/analyzer.md)
- [Events](agents/events.md)
- [Webhooks](agents/webhooks.md)
- [Admin UI SDK](agents/admin-ui-sdk.md)
- [Business Config](agents/business-config.md)
- [Executor](agents/executor.md)

Shared reference files:

- [Schema](shared/schema.md)
- [Questions format](shared/questions.md)
- [Migration warnings](shared/migration-warnings.md)
- [External references](shared/references.md)
