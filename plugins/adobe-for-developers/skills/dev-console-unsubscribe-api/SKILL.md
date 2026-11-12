---
name: dev-console-unsubscribe-api
description: Use when the user wants to remove an Adobe API from a credential — phrases like "unsubscribe from Analytics", "remove Firefly from this credential", "stop using this API", or "disconnect an API".
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).


# Unsubscribe API Flow

Remove one or more API subscriptions from a credential in the selected workspace.

**Before starting:** invoke the `dev-console-context` skill to establish the org, project, workspace, and credential context. If no credential is selected, list credentials in the selected workspace and inspect each with `get_credential_services` before asking which one to use.

## Steps

1. **Confirm the target** — Ask which subscribed API or APIs the user wants to remove from the selected credential. Show API, credential, and project names only; never show raw IDs or SDK codes. Only offer APIs confirmed by `get_credential_services` as currently subscribed.

2. **Explain the change and request approval** — Before calling a tool, summarize the API name(s), credential name, and project name that will be affected, and say that the change has no automatic undo. Do not ask the user to type a name or provide a typed confirmation. The client's Yes/No approval prompt is the confirmation.

3. **Remove the subscription**:
   - For credential types `adobeid`, `analytics`, `entp`, and `oauth_server_to_server`, call `unsubscribe_credential_from_service` with `orgId`, `projectId`, `workspaceId`, the credential's actual `credentialType`, `credentialId`, and the selected API's `sdkCode` in `sdkCodes`.
   - For **Admin Enterprise** (`admin_entp`), call `unsubscribe_admin_enterprise_credential_from_service` with `orgId`, `credentialId`, and one `service` item containing the selected API's `sdkCode` plus any required subscription settings. Use the existing subscription details; do not invent settings. Make one call per API so the client can approve each removal separately.
   - Never emulate unsubscription by sending a reduced service list to a subscription or update tool. For OAuth Server-to-Server, always use `unsubscribe_credential_from_service`; it selects the dedicated upstream unsubscribe path.
   - If the user declines a client approval prompt, stop without retrying or working around it.

4. **Report the result** — Report removal only when the tool confirms success. For Admin Enterprise, inspect the returned `status` and `body` for failures before claiming success. For other credential types, use the tool's returned `remaining` APIs when available; do not make a verification call unless the response is ambiguous or an error occurred.

## Rules

- Use the credential's actual type, not the API's type. In particular, an API with type `entp` may be subscribed to an OAuth Server-to-Server credential.
- For Admin Enterprise, `update_admin_enterprise_credential` changes credential details only; it cannot remove an API subscription.
- If an API's identity or required Admin Enterprise subscription settings are unclear, inspect the available subscription details or call `search_adobe_docs`. Never guess an SDK code or settings.
