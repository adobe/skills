---
name: appbuilder-action-scaffolder
description: Create, implement, deploy, and debug Adobe Runtime actions with consistent layout, validation, and error handling. Use this skill whenever the user needs to add actions to an App Builder project, understand action structure (params, response format, web/raw actions), configure actions in the manifest, use App Builder SDKs (State, Files, Events, database), deploy and invoke actions via CLI, debug action issues, or implement patterns such as webhook receivers, custom event providers, journaling consumers, large payload redirects, action sequence pipelines, and Asset Compute workers. Also trigger when users mention serverless functions in Adobe context, action logging, IMS authentication for actions, or cron-style scheduled actions.
metadata:
  category: action-lifecycle
license: Apache-2.0
compatibility: Requires aio CLI (Adobe I/O CLI), Node.js 18+, and Python 3 for manifest validation
allowed-tools: Bash(aio:*) Bash(npm:*) Bash(node:*) Bash(python3:*) Read Write Edit
---
# App Builder Action Scaffolder

Full lifecycle skill for Adobe Runtime actions — scaffold, implement, deploy, and debug. Place action code at `src/<extension-dir>/actions/<action-name>/index.js` and register in `src/<extension-dir>/ext.config.yaml`.

## Pattern Quick-Reference

Pick the template that matches the user's intent. Default to `assets/action-boilerplate.js` for generic actions.

| User wants | Template |
| --- | --- |
| Simple action / generic starting point | assets/action-boilerplate.js |
| Minimal prototype (bare-bones) | assets/action-scaffold-template.js |
| Database CRUD (durable records, indexes) | assets/database-action-template.js |
| Webhook receiver (I/O Events) | assets/event-webhook-template.js |
| Custom event provider | assets/event-provider-template.js |
| Journaling consumer (replayable events) | assets/journaling-consumer-template.js |
| Large payload response (>1 MB) | assets/large-payload-template.js |
| Action sequence pipeline | assets/action-sequence-template.js |
| Asset Compute worker (AEM renditions) | assets/asset-compute-worker-template.js |
| Debug Runtime action issues | references/debugging.md |

## Fast Path (for clear requests)

When the user's request maps unambiguously to a single pattern above — they name a specific pattern, reference a template, or describe a use case that clearly matches one entry — skip straight to scaffolding. Use the matched template and proceed directly.

Examples of fast-path triggers:

- "Add a webhook receiver action" → `assets/event-webhook-template.js`, scaffold directly
- "Create an Asset Compute worker" → `assets/asset-compute-worker-template.js`, scaffold directly
- "Add a database CRUD action" → `assets/database-action-template.js`, scaffold directly
- "Add an action called process-order" (simple, no ambiguity) → `assets/action-boilerplate.js`, scaffold directly

If there is any ambiguity — multiple patterns could fit, constraints are unclear, or the user hasn't specified enough to pick a single approach — fall through to the full workflow below.

## Quick Reference

- **Action entry point:** Place action code at `src/<extension-dir>/actions/<action-name>/index.js`. This keeps paths aligned with the generated extension layout.
- **Manifest location:** Register actions in `src/<extension-dir>/ext.config.yaml`. Do **not** put a root-level `runtimeManifest` in `app.config.yaml`; the CLI silently ignores it.
- **Extension directory name:** The extension directory name varies by project template:
  - `src/dx-excshell-1/` — Experience Cloud Shell SPA (default)
  - `src/aem-cf-console-admin-1/` — AEM Content Fragment Console extension
  - `src/dx-asset-compute-worker-1/` — Asset Compute worker
  Use the actual directory name from your project's `app.config.yaml` `$include` entries.
- **Web action response shape:** Return `{ statusCode, body }` for standard web actions; add `headers` only when needed.
- **Key CLI loop:** `aio app dev` for local iteration (use `aio app run` if actions use State SDK, Files SDK, or sequences), `aio rt action invoke` for direct testing, `aio app deploy` for publishing.
- **State vs database:** State for ephemeral job tracking; database for durable records, indexed queries, or document-style CRUD.
- **Events delivery choice:** Webhook for push delivery, custom event provider to publish domain events, journaling consumer for replayability or back-pressure.
- **Large payload and sequence patterns:** Large payload redirect when >1 MB response limit; action sequence for linear multi-action flows.
- **Asset Compute worker fit:** Use for AEM rendition processing; different SDK and extension layout than standard Runtime actions.

## Full Workflow (for ambiguous or complex requests)

1. Confirm target outcome, constraints, and acceptance criteria.
2. Collect current implementation context from code, environment, and Adobe configuration.
3. Apply the detailed procedure in `references/playbook.md` for this capability.
4. Produce implementation artifacts and validation evidence.
5. Run through `references/checklist.md` before final handoff.
6. Summarize decisions, risks, and immediate next actions.

## Example User Prompts

- "Add a new action to my App Builder project that calls the AEM Assets API."
- "My runtime action is timing out after 60 seconds. How do I increase the limit without breaking the app?"
- "Set up a cron action that runs every 5 minutes to sync data from an external API."
- "Create a web action that accepts file uploads and stores them using the Files SDK."
- "Store customer preferences in the App Builder Database."
- "Set up a webhook to receive I/O Events for asset changes."
- "My action response is too large — how do I handle payloads over 1MB?"

## Inputs To Request

- Current repository path and module boundaries
- Target Adobe organization, project, and workspace
- Non-functional constraints: latency, cost, compliance, and support model
- Definition of done with measurable acceptance criteria

## Deliverables

- Implementation updates for the requested capability
- Validation evidence: tests, checks, or reproducible verification steps
- Handoff summary with explicit tradeoffs and follow-up actions

## Quality Bar

- Keep decisions explicit and traceable to project constraints
- Prefer deterministic automation for repeatable steps
- Fail safely with actionable diagnostics
- Document tradeoffs and next-step risks in handoff notes

## References

- Use `references/playbook.md` for detailed execution guidance.
- Use `references/checklist.md` for pre-handoff validation.
- Use `references/prompt-pack.md` for ready-to-use execution prompts.
- Use `references/runtime-reference.md` for action structure, params, response formats, SDK usage, and CLI operations.
- Use `references/aem-apis.md` for AEM Content Fragment API surfaces — decision table, Delivery OpenAPI, Management OpenAPI, GraphQL persisted queries, and the deprecated Assets HTTP API — with auth patterns and action code for each.
- Use `references/action-patterns.md` for common action patterns, including CRUD API, cron, multi-step processing, database CRUD, webhook intake, custom event providers, journaling consumers, large payload redirects, action sequence composition, and Asset Compute workers.
- Use `assets/database-action-template.js`, `assets/event-webhook-template.js`, `assets/event-provider-template.js`, `assets/journaling-consumer-template.js`, `assets/large-payload-template.js`, `assets/action-sequence-template.js`, and `assets/asset-compute-worker-template.js` when the user request maps directly to one of the newer boilerplate patterns.
- Use `../_shared/categories/architecture-runtime.md` for Adobe service-specific guidance.

## Common Manifest Guardrail

- Keep App Builder action definitions under `application.runtimeManifest` in `app.config.yaml`.
- Do not use root-level `runtimeManifest`; App Builder CLI ignores it for action configuration.
- Validate manifest structure before deploy: `python3 ../_shared/scripts/validate_manifest_structure.py <path-to-app.config.yaml>`.
- Use `../_shared/references/appbuilder-manifest-guardrail.md` for valid and invalid examples.

## Common Issues

- **Action deployment fails:** Most deploy failures come from invalid manifest structure or missing dependencies. Check that actions are nested under `application.runtimeManifest` (or the extension `ext.config.yaml` pattern), run the manifest validator, run `npm install`, then retry `aio app deploy`.
- **Action timeout:** Runtime execution defaults to 60 seconds and can be extended to 300 seconds for non-web actions. Reduce work per invocation, move long-running tasks to async/background flows, or raise the timeout in manifest limits when the action type supports it.
- **Payload too large:** Web actions are limited to 1 MB for both request and response payloads. Trim request bodies, avoid returning large blobs inline, and use external storage or pass URLs instead.
- **IMS token not available / auth fails:** If an action expects Adobe user context, set `annotations.require-adobe-auth: true`, confirm the shell or caller actually provides the token, and verify `aio auth login` plus Adobe project/workspace access for the target APIs.
- **Two-layer auth confusion:** Actions can enforce auth at two independent layers — the `require-adobe-auth: true` manifest annotation (gateway-level rejection) and a code-level `Authorization` header check inside the action. Disabling one layer does not disable the other. During local dev, set `require-adobe-auth: false` *and* stub the code-level check; otherwise 401 errors persist across redeploy cycles. See `references/runtime-reference.md` § "Common Auth Issues" for the full debugging guide.

## First-Wave Accelerator Kit

- Use `references/implementation-template.md` to structure delivery artifacts for this high-frequency capability.
- Run `scripts/accelerator.py` to generate an execution checklist from request context.

## Asset Templates

- `assets/action-scaffold-template.js` — Minimal scaffold for quick prototyping. Use this when you are starting from scratch, want the bare minimum action shape, or need to validate the basic params-in / response-out flow before adding production concerns.
- `assets/action-boilerplate.js` — Production-ready template with logging, input validation, error handling, and response formatting. Use this when the action is meant for production use, shared team handoff, or any implementation that should start with observability and defensive defaults already in place.
- `assets/database-action-template.js` — Durable database CRUD starter with collection initialization, indexes, and document-style operations.
- `assets/event-webhook-template.js` — Adobe I/O Events webhook receiver with challenge handling, signature verification, and idempotent event processing.
- `assets/event-provider-template.js` — Custom event provider starter for bootstrapping provider metadata and publishing domain events.
- `assets/journaling-consumer-template.js` — Scheduled journaling consumer that polls the journal, stores the cursor, and processes replayable event batches.
- `assets/large-payload-template.js` — large payload response starter that writes oversized responses to Files storage and returns a redirect URL.
- `assets/action-sequence-template.js` — Starter manifest and action layout for a linear action sequence pipeline.
- `assets/asset-compute-worker-template.js` — Asset Compute worker scaffold for AEM rendition processing with the Asset Compute SDK.

## Agent Integration

- The `agents/` directory stores agent-platform integration metadata that complements the standard skill directories.
- `agents/openai.yaml` defines the OpenAI-facing skill configuration, including the display name, short description, and default prompt used to invoke this skill in OpenAI-compatible agent experiences.
- Keep the core skill instructions in `SKILL.md`; use `agents/` only for platform-specific integration details.