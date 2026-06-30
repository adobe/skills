---
name: code-assessment
description: |
  [BETA] Detect, review, and fix code-quality and correctness issues in an AEM as a Cloud Service
  project — locally, with no external services or network calls. Use whenever a user wants to
  check, review, assess, audit, scan, modernize, upgrade, or fix AEM Java, Sling Models, OSGi,
  or Maven code — for example: "check my Sling Models are implemented correctly", "review my
  @Inject usage", "are my Maven dependencies up to date", "scan this AEM project for issues",
  "modernize my Sling Models", or "fix code-quality problems". Name the files to assess, or ask
  it to scan the repo; it detects issues, plans, and — only when you ask — applies surgical
  edits on a branch or in place, then verifies with mvn compile. It recognises the intent and
  handles each issue type itself, reporting anything it cannot yet fix.
  This skill is in beta. Verify all outputs before applying them to production projects.
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# AEM as a Cloud Service — Code Assessment

Single skill for detecting and fixing AEM CS code-quality issues, **entirely against the local workspace** — no external services or network calls. Findings reach the runbook from one of two sources; everything downstream is identical.

## Findings sources

| Source | When | Target versions (deps) |
|---|---|---|
| **User-named** | the user names files or coordinates | user-supplied |
| **Discover** | the user asks to scan, or names no files | user-supplied (per the pattern's resolution contract) |

Discovery runs through the deterministic **analyzer** ([`scripts/analyze.sh`](scripts/README.md)):
it parses the workspace once and runs the enabled detectors, emitting the shared findings shape.
Every `ready` pattern has an analyzer detector. Patterns without one are `planned` only — not yet
detectable and not yet built; there is **no LLM-scan fallback** in this version (see Scope &
limitations) — the `scan` value on `planned` rows in [`references/patterns.md`](references/patterns.md)
marks the intended future detection method, not an active code path.

## Routing

1. **User named files / coordinates** → run the runbook in `with_findings` mode against those paths.
2. **"Scan my repo" / no files named** → run the runbook in `discover` mode (per-pattern Discovery, workspace roots only).

Then follow the runbook: [`references/runbook.md`](references/runbook.md).

## Manual Pattern Hints (classification → expert skill)

Route the request to one expert skill. Two pattern families share this skill:

**Mechanical fixes** (analyzer-driven detection, deterministic edits — follow the runbook flow):

| User said / saw | Expert skill |
|---|---|
| "update aem sdk", "upgrade mockito", stale `<version>` or `${property}` in pom | [`outdated-dependencies/`](outdated-dependencies/SKILL.md) |
| "fix @Inject", "modernize Sling Models", `javax.inject.Inject` on `@Model` fields | [`inject-in-sling-model/`](inject-in-sling-model/SKILL.md) |
| "add HTTP timeouts", "outbound/external call has no timeout", `HttpClient` / `HttpClients` / `OkHttpClient` built without a timeout | [`outbound-call-timeouts/`](outbound-call-timeouts/SKILL.md) |
| "bound my query", "unbounded query", "query causing OOM", `p.limit=-1`, `setLimit(-1)` | [`unbounded-query/`](unbounded-query/SKILL.md) |
| "remove deprecated API", "fix deprecated imports", "Cloud Manager deprecated API failure", `import org.apache.log4j`, `import org.apache.commons.lang`, `import com.adobe.granite.xss`, `import com.day.cq.xss`, commons-lang/collections upgrade, log4j migration, unmodifiable OSGi configs | [`remove-deprecated-api/`](remove-deprecated-api/SKILL.md) _(apply uses JAR scripts — see recipe.md)_ |

**Architectural migration patterns** (guided remediation — full before/after, troubleshooting, modern alternatives; invoked directly or via `migration` for BPA/CAM-driven discovery):

| User said / saw | Expert skill | BPA pattern ID |
|---|---|---|
| `org.apache.sling.commons.scheduler.Scheduler` or `scheduler.schedule(` with `Runnable` | [`scheduler/`](scheduler/SKILL.md) | `scheduler` |
| `implements ResourceChangeListener`, lightweight listener + JobConsumer | [`resource-change-listener/`](resource-change-listener/SKILL.md) | `resourceChangeListener` |
| `com.day.cq.replication.Replicator`, `org.apache.sling.replication.*`, "publish/preview activation" | [`replication/`](replication/SKILL.md) | `replication` |
| `javax.jcr.observation.EventListener`, `org.osgi.service.event.EventHandler` on non-resource topics (replication, workflow, custom) | [`event-migration/`](event-migration/SKILL.md) | `eventListener` / `eventHandler` |
| `com.day.cq.dam.api.AssetManager` create/upload/delete APIs, `createAssetForBinary`, `removeAssetForBinary` | [`asset-manager/`](asset-manager/SKILL.md) | `assetApi` |
| HTL build warning `data-sly-test: redundant constant value comparison` | [`references/data-sly-test-redundant-constant.md`](references/data-sly-test-redundant-constant.md) | `htlLint` (reference, no expert skill subdirectory) |

**Broad / correctness-review asks** ("check my Sling Models are implemented correctly", "review my code", "is my AEM project healthy", "assess this project") are not a single pattern: run the runbook in `discover` mode with intent `report` — the analyzer runs every detector and the report covers all built patterns, explicitly noting aspects not yet supported. Only narrow to one pattern when the user targets a specific fix.

If nothing matches, say the issue is not yet supported and offer to file a request for a new expert skill.

**Full catalog** (built + `planned` patterns, with severity / detection / fix): [`references/patterns.md`](references/patterns.md).

## Invocation from the `migration` skill

`migration` performs BPA/CAM/MCP discovery and handles batching + one-pattern-per-session workflow. After it has identified `(pattern, file)` pairs from BPA findings, it hands off here for the actual transformation. When invoked with `(pattern, file)` from `migration`:

- **Skip** HA/analyzer discovery (caller already identified the pattern + file)
- Open the pattern's expert skill directly (per the Manual Pattern Hints table above)
- Apply the steps in the expert skill against the named file(s)
- Return the result; `migration` continues with the next finding in its batch

The pattern guides themselves are agnostic about who invoked them — they apply identically whether reached from `migration` (BPA/CAM) or from the runbook in this skill (HA / analyzer).

## Runbook

All detection, planning, edits, verification, git/in-place handling, and the run log live in
[`references/runbook.md`](references/runbook.md). The runbook is the **sole owner** of repo-environment
detection (`edit_mode`, git snapshot) — this control plane does not duplicate it.

## One pattern per session

Report may span every pattern found; **apply touches one pattern per session** (atomic revert,
single-story diff). Refuse "fix everything" for the apply phase. Rationale:
[`references/shared-principles.md`](references/shared-principles.md#one-pattern-per-session).

## Critical rules

- **Local only** — no network calls or external services; operate solely on the workspace.
- **Requires a local JDK** (Java 11+) for detection — the analyzer compiles/runs in memory; no
  install beyond the JDK, no network. If absent, detection stops with a clear message.
- **The analyzer is detection — never substitute external tooling.** Do not run
  `mvn versions:display-dependency-updates` / `mvn versions:display-property-updates`,
  `npm outdated`, or Maven Central / registry lookups in place of analyzer discovery. Those answer
  "what is the latest on the network" — outside this skill's local-only contract. If the user
  explicitly wants a live registry comparison, say it needs network and offer it as a separate step
  **after** delivering the skill report.
- **Never commit, push, or open a PR** — branch (git) or in-place edits only; the developer reviews and commits.
- **Surgical edits** — no reformatting / re-serialization.
- **Skip with a reason** — record un-applicable findings as `skipped` with an exact reason; never silently drop.
- **One pattern per session** for apply.

Full rationale: [`references/shared-principles.md`](references/shared-principles.md).

## Scope & limitations

Local static detection and remediation only — no external services, no network, no live AEM instance. Issues that require runtime or live-repository state, telemetry, or history across runs are out of scope for this skill.
Detection requires a local JDK (Java 11+); there is no remote or LLM-scan fallback in this version.
A large apply (e.g. an `@Inject` migration across 100+ files) is processed in **resumable batches**: the run checkpoints each file to `.autofix/last-run.json` and pauses at a per-pass cap, so it survives context limits — reply **apply `<pattern>`** to continue (see [`references/git-workflow.md`](references/git-workflow.md)).

## Adding a new pattern

Full end-to-end procedure — detector → fixtures/tests → catalog + routing → expert skill → verify:
**[`references/adding-a-pattern.md`](references/adding-a-pattern.md)**. The `[wiring]` test keeps the
detector, catalog row, and expert-skill directory in sync.

**Triggering scales without touching the description.** The `description` above is intentionally
broad (intent verbs + AEM domain), so it already fires on "check / review / fix my &lt;AEM thing&gt;";
a new pattern is reached by its **Manual Pattern Hints + `patterns.md` rows**, not by editing the
description. Update the description **only** if the new pattern introduces a domain keyword it does
not already cover (a new subsystem or file type). The `[wiring]` test keeps the detector, catalog
row, and expert-skill directory in sync.

## Related skills

- **`migration`** — drives BPA/CAM/MCP-based legacy-AEM migration workflow. Discovers findings, batches them, enforces one-pattern-per-session, and hands off `(pattern, file)` pairs to this skill for transformation. See the "Invocation from the `migration` skill" section above.
