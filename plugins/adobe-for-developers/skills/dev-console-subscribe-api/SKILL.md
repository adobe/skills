---
name: dev-console-subscribe-api
description: Use when the user wants to add, subscribe, enable, or integrate an Adobe API in an existing project — phrases like "add Analytics", "subscribe Firefly", "enable API", "add API to project", "create credential", "set up OAuth S2S", "subscribe to service", "add service", "connect API", "integrate Adobe API", "I need access to", "set up credentials for", "provision API", "provision access", "get API access", "generate credentials", "new credential", "create OAuth", "create S2S". Handles finding the API, picking a credential type, selecting product profiles, creating a credential if needed, and subscribing to the API. For a new project, use dev-console-create-project first.
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).


# Subscribe API Flow

Guide the user through subscribing an Adobe API to a credential in an existing project, step by step.

**Before starting:** invoke the `dev-console-context` skill to establish the org, project, and workspace. If the user wants a new project, invoke `dev-console-create-project` first and continue with the context it returns. After the workspace is selected or created, call `get_credentials` and immediately call `get_credential_services` for each returned credential before presenting the credentials and their subscriptions. Do not repeat these calls if the context skill already made them during this request.

## Steps

1. **Find the API** — If the user asks *"what APIs are available"*, *"show me available APIs"*, or similar, call `list_services` with `filterBy: "enabled"` and display only the enabled APIs as a list (name + description, no raw codes). If the user named a specific API, call `list_services` with `filterBy: "enabled"` to find its `code` and full details. Never guess an SDK code.

2. **Pick credential type** — **Always run this step based on the API's supported types — never skip it because an existing credential was found.** An API can have multiple enabled instances with different `type` values. Collect ALL enabled instances for the API code, then:
   - Include `admin_entp` instances as **Admin Enterprise** credentials; do not filter them out or redirect the user to Console for creation or subscription.
   - If only **one** credential type → proceed with it automatically, including when that type is Admin Enterprise.
   - If **multiple** credential types → show them as a numbered list and ask: *"This API supports multiple credential types. Which would you like to use?"*
     1. Analytics credential *(internal: `analytics`)* — if an `analytics` instance is present
     2. User Auth (AdobeId) — for user-facing apps *(internal: `adobeid`)*
     3. OAuth Server-to-Server — for server-to-server access *(internal: `oauth_server_to_server`, also used for `entp`)*
     4. Admin Enterprise *(internal: `admin_entp`)* — if an `admin_entp` instance is present
   - **Wait for the user to pick before proceeding.** Do not auto-select based on what credentials already exist in the workspace.
   - **Show only credential type names in this list — never mention existing credentials here.** Do not append "subscribe to the existing X credential" or any reference to existing workspace credentials. Existing credential lookup happens after the type is chosen.

3. **Check for product profiles** — After the credential type is decided, inspect its `properties.licenseConfigs` array from the matching API instance:
   - If it is **non-empty**: present the profiles as a numbered list (show `name`, never raw `id` or `productId`) and tell the user: *"You can select one or more of these profiles."* Collect their choices — you'll need the selected profiles' `id` and `productId` fields when subscribing.
   - If it is **empty or absent**: continue with no `licenseConfigs`.
   - **This step must complete before any credential creation or subscription call** — even when creating a new credential. Never pass `services` to `create_oauth_s2s_credential` until `licenseConfigs` have been resolved.

4. **Subscribe** — Use a credential of the selected type from the chosen workspace. If several matching credentials exist, ask the user to choose by credential name. If none exists, create one using **Credential creation inputs** below. For a newly created project, use the selected workspace ID from the creation/context flow for every credential creation and subscription call. For an App Builder project, preserve the user's Production or Stage selection; never replace a selected Stage workspace with Production. Automatically use Production only for a default project with a single workspace. If no workspace has been selected, use the returned workspace details or call `list_workspaces` to resolve the selection before proceeding. If the selected type is User Auth (AdobeId), call `list_workspaces` to confirm the selected workspace before creating that credential; this confirmation must not change the user's selection.

   **Admin Enterprise credential** (`admin_entp`):
   - For a new credential, call `create_admin_enterprise_credential` with `orgId`, `projectId`, `workspaceId`, the creation inputs below, and `services` including any product profiles selected in step 3. This creates the credential and subscribes the API in one call.
   - For an existing credential, call `subscribe_admin_enterprise_credential_to_services` with `orgId`, `credentialId`, and `services` including any product profiles selected in step 3. No project or workspace ID is required by this tool; choose only a credential from the selected workspace.
   - Pass only the services to add or change. The connector fetches existing subscriptions and merges them before calling the replacement PUT endpoint, preserving other APIs. For an already-subscribed SDK code, include all intended license configs and roles (existing plus new), because that service's settings are replaced.
   - `update_admin_enterprise_credential` changes only the credential's name, description, and redirect settings; it does not add, replace, or remove API subscriptions. Never call it to subscribe an API or report a subscription success based on its response.
   - Do **not** pass `admin_entp` to `subscribe_credential_to_services`; that tool does not support it.

   **OAuth Server-to-Server credential** (`oauth_server_to_server`) → call `subscribe_credential_to_services`:
   - Pass `orgId`, `projectId`, `workspaceId`, `credentialType: "oauth_server_to_server"`, `credentialId`, and `services`.
   - Each service entry must include `licenseConfigs` if the user selected product profiles in step 3. An empty `licenseConfigs: []` is NOT the same as omitting it — pass the user's selections.
   - The `credentialType` must always match the **credential's** actual type (`oauth_server_to_server`), never the API's type (`entp`).

   **Other credential types** (`adobeid`, `analytics`, `entp`, `oauth_server_to_server`) use `subscribe_credential_to_services` (PUT). The server automatically preserves all already-subscribed services — only pass the service(s) you want to add or change; do NOT pre-fetch and re-send the full existing list. Preservation is per-service, not per-licenseConfig: if you're adding a licenseConfig to an already-subscribed service, include that service's full intended licenseConfigs list (existing plus new), not just the new one.

5. **Report success** — If the subscription tool succeeds, report success without a separate verification call. For Admin Enterprise service tools, the DTO-derived JSON body uses `sdkList`, `error`, and `errorDetails` (not `errorList`). HTTP 200 can contain partial failures: the connector returns an MCP error if either error array is non-empty, including the failed SDK codes and returned SDK list. Some changes may already have applied; inspect current subscriptions before retrying and never automatically retry the whole list. For Admin Enterprise creation, inspect `subscriptionResult` when present; do not report an API as subscribed if it appears in `errorList` or its subscription is otherwise unconfirmed.
   *"✓ [API name] has been successfully subscribed to your [credential type] credential."*
   List the APIs confirmed by the response. The services array may contain only additions, so do not present it as the full current list.
   Only call `get_credential_services` if the response is ambiguous or an error was returned.

## Credential creation inputs

When no credential exists and one must be created, apply the Common Skill Rules for names, titles, and descriptions. Preserve valid user-supplied values; otherwise derive the missing name using the pattern `{projectName}-{type}[-{subtype}]`, without a naming prompt:

| Credential type | Platform / subtype | Auto-generated name example |
|---|---|---|
| OAuth S2S | — | `mcptesting-s2s` |
| Admin Enterprise | — | `mcptesting-admin-enterprise` |
| AdobeId | WebApp | `mcptesting-adobeid-webapp` |
| AdobeId | SinglePageApp | `mcptesting-adobeid-singlepageapp` |
| AdobeId | NativeApp | `mcptesting-adobeid-native` |
| AdobeId | apiKey | `mcptesting-adobeid-apikey` |
| Analytics | Web | `mcptesting-analytics-web` |
| Analytics | iOS | `mcptesting-analytics-ios` |
| Analytics | Android | `mcptesting-analytics-android` |

For a missing description, use: `"{Type} credential for {projectTitle}"` (e.g. `"OAuth S2S credential for mcptesting"`).

For generated names, use lowercase letters, digits, and hyphens, and truncate to 50 characters if needed. Do not silently modify user-supplied values; follow the shared validation and fallback rules.

### OAuth Server-to-Server (`create_oauth_s2s_credential`)
- Use the name and description resolved above. No further input needed — proceed directly to creation.
- **Never pass `services` to `create_oauth_s2s_credential`** — always create the credential first (no `services`), then subscribe in a separate `subscribe_credential_to_services` call. Inline service attachment is unreliable and causes confusing retry flows.

### Admin Enterprise (`create_admin_enterprise_credential`)
- Use the name and description resolved above.
- Ask for `defaultRedirectUri` (the OAuth callback URL) and `redirectUriPattern` (the regex for allowed redirect URIs). Never invent placeholder values or use an unrestricted pattern by default.
- Pass the selected API in `services`, including product profiles selected in step 3. Do not make a separate subscription call after successful inline subscription.

### User Auth — AdobeId (`create_user_auth_credential`)
- Use the name and description resolved above.
- Ask only for **platform**. Present only platforms the API supports (from its `platformList`) as a numbered list:
  ```
  1. WebApp — web application
  2. SinglePageApp — SPA/React/Angular app
  3. NativeApp — desktop or mobile app
  4. apiKey — server-side API key access
  ```

**Before asking for platform, if `available_scopes` is present:**
- Display a table of available scopes and tell the user: *"All scopes are granted by default and cannot be deselected."*

**Platform-specific inputs** — NEVER invent placeholder values, always wait for the user:
- `WebApp` / `SinglePageApp`: ask for both:
  1. `defaultRedirectUri` — plain URL (e.g. `https://example.com/callback`)
  2. `redirectUriList` — one or more redirect URI patterns; pass as plain URLs, the server escapes dots automatically
- `NativeApp`: no extra inputs required — proceed directly.
- `apiKey`: ask for `domain`. No redirect URI needed.

### Analytics (`create_analytics_credential`)
- Use the name and description resolved above.
- Ask only for **platform** as a numbered list:
  ```
  1. Web — web app
  2. iOS — iOS mobile app
  3. Android — Android mobile app
  ```

**Platform-specific inputs** — NEVER invent placeholder values:
- `Web`: ask for both:
  1. `defaultRedirectUri` — plain URL (e.g. `https://example.com/callback`)
  2. `redirectUriList` — one or more redirect URI patterns; pass as plain URLs, the server escapes dots automatically
- `iOS`: ask for `urlScheme`. No redirect URI needed.
- `Android`: no extra inputs required — proceed directly.

After creating a credential that needs a separate subscription call, use its returned `id` as `credentialId`. Admin Enterprise creation already includes the requested services. Never re-fetch credentials after a fresh creation.

**Whenever any tool response includes a `console_url` field** (credential creation or subscription), always display it to the user as a clickable link:
```
🔗 View in Adobe Developer Console: {console_url}
```

## When Instructions Are Unclear

If you're unsure about an API, credential type, product profile, or Adobe concept during this flow — call `search_adobe_docs` before asking the user to clarify. For example:

- User asks to subscribe an API you don't recognise → search *"Adobe {API name} API developer documentation"*
- Unclear what scopes or product profiles an API requires → search *"Adobe {API name} OAuth scopes product profile"*
- Unsure which credential type fits the user's use case → search *"Adobe Developer Console credential types OAuth S2S user auth"*

Always prefer fetching from official docs over guessing.

---

## Rules

- **`entp` APIs** (e.g. Adobe Campaign) use an OAuth S2S credential. Never show "entp" to the user.
- **`admin_entp` instances are selectable as Admin Enterprise credentials.** Use `create_admin_enterprise_credential` for creation with inline services and `subscribe_admin_enterprise_credential_to_services` to add or update APIs on existing credentials. API removal is handled by `dev-console-unsubscribe-api` skill. `update_admin_enterprise_credential` only updates credential details and does not change subscriptions.
- **Always use the API `type` field to determine credential type. Completely ignore `oauthServerToServerOnly`.** Mapping: `adobeid` → `create_user_auth_credential`, `analytics` → `create_analytics_credential`, `entp` → `create_oauth_s2s_credential`, `oauth_server_to_server` → `create_oauth_s2s_credential`, `admin_entp` → `create_admin_enterprise_credential`.
- **Never skip step 2.** Credential type must be chosen based on the API's supported types every time — not inferred from what credentials already exist in the workspace.
- Never show raw IDs (licenseConfigId, credentialId, productId) to the user — use names instead.
- **Integrations and credentials are the same concept.** The `get_credentials` response uses `id_integration` as the credential ID — use this value wherever `credentialId` is required in any tool call. `integration_name` is the credential's display name.
- Never use internal jargon — present `licenseConfigs` as "product profiles" to the user.
- **Never skip product profile selection.** If `properties.licenseConfigs` is non-empty for an API, always complete step 3 and include the selected `licenseConfigs` in the `services` array — both when subscribing to an existing credential and when creating a new one. An omitted or empty `licenseConfigs` means the subscription will have no product profile attached.
- `list_services` returns a very large payload that exceeds the inline token limit. When you need to find an API code or inspect its details, search the saved file with a shell command (e.g. `python3 -c "import json; ..."` filtering by name/code) rather than reading the full response inline.
