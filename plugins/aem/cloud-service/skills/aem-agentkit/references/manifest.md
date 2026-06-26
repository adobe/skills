# Run manifest — `.aem/context/.agentkit-manifest.json`

> **Beta Skill:** Outputs must be reviewed before applying to production.

The manifest is the authoritative record of what the most recent skill
run wrote, the post-write checksum of each artifact, and every heuristic
decision the skill made. It is the input to `/agents-md-check` (drift
detection) and the source of truth for `.agentkit-new` rotation.

## 1. Location and lifecycle

- Path: `.aem/context/.agentkit-manifest.json` (workspace root only;
  nested AEM sub-projects share the root manifest — their entries are
  scoped by path prefix).
- Written as the **last** step of every full run, after step 12 in
  SKILL.md § "Generation order".
- Always rewritten in full; the manifest's own marker checksum is
  computed over the canonical body bytes per
  [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 1.
- A run that aborts before step 12 leaves the previous manifest on
  disk; the customer can still consult it and `/agents-md-check`
  remains usable.
- The manifest itself is in the SKILL.md § "Hard guarantee" allow-list
  and carries the same `_generatedBy` / `_skillVersion` /
  `schemaVersion` / `_markerChecksum` marker fields as every other
  JSON artifact.

## 2. Schema

```json
{
  "_generatedBy": "aem-agentkit",
  "_skillVersion": "1.0.0-beta",
  "schemaVersion": "1",
  "_markerChecksum": "<sha256>",
  "generatedAt": "2026-06-04T11:30:53Z",
  "exitCode": 0,
  "files": [
    {
      "path": "core/AGENTS.md",
      "sha256": "<sha256-of-file-bytes>",
      "kind": "per-module-agents-md",
      "subprojectRoot": null,
      "static": false
    },
    {
      "path": ".aem/context/components.json",
      "sha256": "<sha256-of-canonical-body>",
      "kind": "index",
      "subprojectRoot": null,
      "static": false
    },
    {
      "path": ".aem/context/aem-api-namespaces.md",
      "sha256": "<sha256-of-canonical-body>",
      "kind": "static-reference",
      "subprojectRoot": null,
      "static": true
    },
    {
      "path": "brand-a/.aem/context/components.json",
      "sha256": "<sha256-of-canonical-body>",
      "kind": "index",
      "subprojectRoot": "brand-a",
      "static": false
    }
  ],
  "heuristics": [
    {
      "decision": "module-shape",
      "path": "brand-a",
      "value": "nested-aem-project",
      "evidence": ["brand-a/pom.xml:3", "brand-a/core", "brand-a/ui.apps"],
      "overriddenBy": null
    },
    {
      "decision": "frontend-variant",
      "path": "ui.frontend",
      "value": "react-spa",
      "evidence": ["ui.frontend/package.json:5"],
      "overriddenBy": null
    },
    {
      "decision": "ds-generation",
      "path": "core/src/main/java/com/example/MyService.java",
      "value": "R7",
      "evidence": ["core/src/main/java/com/example/MyService.java:3"],
      "overriddenBy": null
    }
  ],
  "warningStubs": [
    {
      "category": "slash-command-collision",
      "message": "/new-component is human-curated; aem-agentkit slash command not installed; invoke `@aem-component-author` directly via the IDE's subagent invocation",
      "path": ".claude/commands/new-component.md"
    }
  ],
  "mcpPlaceholders": [
    {"path": ".mcp.json", "todoKeys": ["_TODO_aem_developer", "_TODO_cloud_manager", "_TODO_content"]}
  ],
  "helperVersion": "1.0.0-beta",
  "skillRunDurationMs": 4382
}
```

## 3. Field reference

| Field | Meaning |
|---|---|
| `files[].path` | Workspace-relative POSIX path of every file the run wrote. |
| `files[].sha256` | SHA-256 of the canonical body (for marker-bearing files) or of the file bytes (for non-marker files). Used by `/agents-md-check` to detect drift. |
| `files[].mtime` | Post-write `mtime` (epoch seconds, integer) of the file. v2 of `/agents-md-check` will use this for incremental drift detection: entries whose on-disk mtime is unchanged skip the checksum recompute. v1 records the field but ignores it for compatibility. Setting the schema field now means v2 isn't a manifest migration. |
| `files[].kind` | One of `per-module-agents-md`, `index`, `derived`, `static-reference`, `subproject-overview`, `tool-claude-agent`, `tool-claude-command`, `tool-claude-rule`, `tool-cursor-rule`, `tool-copilot-instructions`, `tool-continue-rule`, `tool-clinerules`, `tool-windsurfrules`, `tool-augment`, `mcp-placeholder`. |
| `files[].subprojectRoot` | Workspace-relative path of the nested sub-project root this file belongs to, or `null` for workspace-root scope. |
| `files[].static` | `true` when the file is a static-reference template (eligible for in-place overwrite on a skill version bump). |
| `heuristics[].decision` | The heuristic category. |
| `heuristics[].value` | The skill's inferred decision. |
| `heuristics[].evidence` | List of `<path>:<line>` pointers that drove the decision. |
| `heuristics[].overriddenBy` | Either `null` or the `.aem/agentkit-overrides.yml` path that took precedence. |
| `warningStubs[]` | Every degraded-run condition surfaced during the run, mirrored from the index files. |
| `mcpPlaceholders[]` | Every `.mcp.json` / `.cursor/mcp.json` whose `_TODO_*` keys remain unset. |
| `helperVersion` | The version of `aem-agentkit-helper` that was used. |
| `skillRunDurationMs` | End-to-end wall-clock of the run (driven by the deterministic helper's monotonic clock — never the agent's). |

## 4. Consumer rules

- **`/agents-md-check`** reads the manifest and for each entry
  recomputes the canonical body checksum from the on-disk file. A
  mismatch is reported as drift (categorised as: marker missing,
  marker checksum mismatch, file deleted, file replaced without
  marker). Missing manifest entries for marker-bearing files in the
  workspace are reported as "unknown skill-marker file" so a customer
  can identify files left over from a previous skill version.
- **`/agents-md-check` enforces the Registration Rule** (§ 8.1).
  Source-vs-index drift (an on-disk component / Sling Model / OSGi
  service / Sling Servlet that is not in the closest `.aem/context/*.json`,
  or vice versa) is reported under `source-vs-index-drift` and exits
  non-zero. The surfaced remediation is **always** "run
  `/regen-context`" — never an inline JSON edit.
- **`/agents-md-check` also enforces per-sub-project completeness.**
  For every `heuristics[]` entry with `decision: module-shape, value:
  nested-aem-project`, the check confirms that
  `<path>/.aem/context/components.json` and
  `<path>/.aem/context/osgi-services.json` exist with valid markers.
  Missing per-sub-project context is reported under a distinct
  `missing-subproject-context` category and exits non-zero so CI gates
  catch the case where a prior run skipped step 9 of the generation
  order (see [`SKILL.md`](../SKILL.md) § "Generation order").
- **`/regen-context`** consults the manifest to decide whether each
  index file is currently in its skill-owned state before refreshing.
- **`.agentkit-new` rotation** (`collision-rules.md` § `.agentkit-new`
  lifecycle) uses the manifest to identify pre-existing skill-owned
  files; the rotation is no-op when the manifest and the on-disk file
  agree.
- **Heuristic surfacing.** The summary block (`output-format.md` § 2)
  prints every `heuristics[]` entry under a `Heuristics` group so the
  customer can review the inferences without reading the JSON.

## 5. Overrides — `.aem/agentkit-overrides.yml`

`.aem/agentkit-overrides.yml` lives at the workspace root and carries
two classes of override:

1. **Customer-authored heuristic overrides** — when the customer
   disagrees with the skill's inference for module shape, frontend
   variant, DS generation, recursion depth, etc. Read-only from the
   skill's perspective.
2. **`ide-targets` selection** — written by the skill itself the first
   time the IDE-selection prompt is answered
   ([`output-format.md`](./output-format.md) § 1.1). Read-only on
   subsequent runs; deleting the entry forces the prompt to fire
   again.

Example:

```yaml
# Workspace-root only. Read at the start of every run.
schemaVersion: "1"
overrides:
  # IDE selection (written by the skill on the answer to the prompt;
  # see output-format.md § 1.1). Valid entries: claude, cursor,
  # copilot, continue, cline, windsurf, augment. Empty list means
  # "universal layer only".
  - decision: ide-targets
    value: [claude, copilot]

  # Heuristic overrides (customer-authored).
  - decision: module-shape
    path: brand-a
    value: leaf-module
  - decision: frontend-variant
    path: ui.frontend
    value: angular-spa
  - decision: ds-generation
    path: core/src/main/java/com/example/MyService.java
    value: R7
  - decision: max-recursion-depth
    value: 4
```

Rules:

- Customer-authored entries are read-only by the skill; the skill
  never modifies them. The `ide-targets` entry is the **only** value
  the skill writes into this file, and only on first-run answer to
  the selection prompt.
- Each heuristic override entry must specify `decision`, `path`, and
  `value`. The `ide-targets` and `max-recursion-depth` entries omit
  `path` (they are workspace-scoped). An entry missing required
  fields is reported in `warningStubs` and ignored.
- Override `value` must be a valid value for the decision (e.g.
  `module-shape` ∈ {`leaf-module`, `nested-aem-project`};
  `ide-targets` ⊂ {`claude`, `cursor`, `copilot`, `continue`,
  `cline`, `windsurf`, `augment`}). Invalid values are reported in
  `warningStubs` and ignored.
- The manifest records each applied override under
  `heuristics[].overriddenBy` so a customer reading the manifest sees
  which inferences were customer-controlled.
- The override file is **not** secret. Secrets do not belong here.

## 6. Reversibility

To remove the manifest (and start over): delete
`.aem/context/.agentkit-manifest.json`. The next skill run rebuilds it.
The marker on the manifest itself is the only thing protecting it from
being clobbered when a customer hand-edits an unrelated `.aem/context/`
file; if the marker is corrupted, the manifest is treated as
human-curated per
[`collision-rules.md`](./collision-rules.md) § Marker check.

## 7. What the manifest never contains

- Absolute filesystem paths.
- Customer source-file content (only paths and checksums).
- Credentials, tokens, or any value derived from a deny-listed file.
- `~/` references.
- Timestamps with sub-second resolution (every timestamp is
  second-resolution UTC).

## 8. Registration Rule (slash commands and sibling skills)

Every aem-agentkit-owned slash command that authors indexable artifacts
(`/new-component`, `/new-sling-model`) and every sibling skill that
authors an indexable artifact (component, Sling Model, OSGi service,
Sling Servlet) MUST follow this four-step protocol, in order, after the
authoring step succeeds. The rule is named so that future skills can
cite it by name (`Registration Rule`) instead of re-deriving the order.

`/validate-dispatcher` is read-only — it runs the Dispatcher SDK
validator and reports findings without writing source — so it is
**exempt** from the Registration Rule. `/regen-context` and
`/agents-md-check` are themselves the helpers consumed by the Rule
(steps 2 and 8.1 respectively); they are not bound by it either.

| Step | Action | Why |
|---|---|---|
| **1. Write source** | Write the new source file(s) under the customer's source tree. | Indexable artifact lives in customer source first; index reflects source, never the reverse. |
| **2. Refresh the index** | Invoke `/regen-context` so the closest `.aem/context/*.json` is recomputed end-to-end by the skill helper and gets a valid marker checksum. **Never** mutate the JSON inline from the slash command or sibling skill — the agent cannot reliably recompute the SHA-256 canonical body. | Inline mutation corrupts the marker and turns the file `human-curated` on the next run. |
| **3. Confirm the index reflects the source** | After `/regen-context` finishes, read the closest `.aem/context/*.json` back and verify the new artifact appears (component name in `components.json[].name`, FQCN in `osgi-services.json.slingModels[].fqcn`, etc.). | Catches the case where the artifact was written outside the discovery scope; surfaces a path mismatch the next session would otherwise inherit silently. |
| **4. Let the manifest reconcile on the next run** | No explicit action — the next full `aem-agentkit` run (or the next `/regen-context`) rewrites `.aem/context/.agentkit-manifest.json` so the new files appear under `files[]` with current SHA-256 checksums. Between runs, `/agents-md-check` compares the on-disk state against the most recent manifest and reports `source-vs-index-drift` (§ 8.1). | Manifest reconciliation is best-effort post-write — the agent never edits the manifest inline, the helper rewrites it on the next skill invocation. |

**Per-module `AGENTS.md` refresh — separate from the Registration Rule.**
`/regen-context` only refreshes the `.aem/context/*` indexes. Per-module
`<module>/AGENTS.md` files are re-rendered by a full skill run, not by
`/regen-context`. When the customer adds enough new artifacts that the
per-module file's "Common entry points" section is meaningfully stale,
they re-run the full skill. This separation keeps the Registration Rule
fast (no recursive markdown re-render after every new component) without
silently leaving stale `AGENTS.md` references around — `/agents-md-check`
flags marker drift on per-module files independently.

### 8.1 What `/agents-md-check` enforces against the Registration Rule

`/agents-md-check` runs read-only and reports a `source-vs-index-drift`
category when any of the following hold:

- A `.html` component descriptor (`jcr:primaryType="cq:Component"`) exists
  under `<module>/ui.apps/.../jcr_root/apps/<project>/components/<name>/`
  but `<name>` is not present in the closest `.aem/context/components.json`
  (or the entry's `path` does not resolve back to the source).
- A `.java` class carries the `@Model` annotation but its FQCN is not
  present in the closest `.aem/context/osgi-services.json` under
  `slingModels`, or vice versa.
- A `.java` class registers an OSGi component (`@Component`,
  `@Designate`, `@SlingServlet`) but its PID/path is not in
  `osgi-services.json` under `services` / `servlets`.

Any non-empty `source-vs-index-drift` category causes
`/agents-md-check` to exit non-zero so CI gates catch it. The
remediation surfaced in the report is "run `/regen-context`" (step 2 of
the Registration Rule); after a successful refresh, re-running
`/agents-md-check` returns clean.

### 8.2 Sibling-skill contract

A skill that creates indexable artifacts MUST either:

- Invoke `/regen-context` itself after the authoring step (preferred,
  matches the slash-command pattern), OR
- Print a single-line warning in its summary block telling the customer
  to run `/regen-context` before any subsequent agent session.

The skill MUST NOT write to `.aem/context/*.json` directly. The
allow-list in SKILL.md § "Hard guarantee" reserves those paths for the
helper; the helper recomputes the marker checksum from the canonical
body and the orchestrator cannot reproduce that step deterministically.
