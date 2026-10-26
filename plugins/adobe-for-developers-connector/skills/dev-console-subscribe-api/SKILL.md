---
name: dev-console-subscribe-api
description: Use when the user wants to add, subscribe, enable, or integrate an Adobe API — phrases like "add Analytics", "subscribe Firefly", "enable API", "add API to project", "create credential", "set up OAuth S2S", "subscribe to service", "add service", "connect API", "integrate Adobe API", "I need access to", "set up credentials for", "create project", "create a new project", "new project", "set up a project", "provision API", "provision access", "get API access", "generate credentials", "new credential", "create OAuth", "create S2S". Handles the full flow — finding the API, picking a credential type, selecting a product profile, creating a credential if needed, and subscribing to the API.
license: Apache-2.0
---

# Subscribe API Flow

Guide the user through subscribing an Adobe API to a credential in their workspace, step by step.

**Before starting:** invoke the `dev-console-context` skill.

## Steps

1. **Get org** — Call `get_organisations` and ask the user which org to use.

2. **New or existing project?** — Ask the user:
   ```
   1. Create a new project
   2. Use an existing project
   ```

   **If new project (1):**
   - Ask the user for a **title** only (e.g. "My Analytics Project"). Do NOT ask for a name.
   - Derive the `name` from the title automatically: strip all non-alphanumeric characters, camelCase or concatenate words, truncate to 20 characters. For example: "My Analytics Project" → "MyAnalyticsProject".
   - Call `create_project` with `projectType: "default"`, the derived `name`, and the user's title.
   - The response returns both `projectId` and `workspaceId` directly — the default workspace is always **Production**. Do NOT call `list_workspaces` unless the credential type is **User Auth (AdobeId)**, in which case call `list_workspaces` to confirm the available workspaces.

   **If existing project (2):**
   - Ask:
     ```
     1. All projects
     2. My projects (created or modified by me)
     ```
     - 1 → call `get_projects` with `filterBy: "all"`
     - 2 → call `get_projects` with `filterBy: "me"`
   - Show the returned project list as a numbered list (names only, no raw IDs) and ask the user which project they want.
   - Call `list_workspaces` with the chosen project → show workspace list as a numbered list → ask which workspace to use.
   - Once the workspace is selected, **automatically** (without asking):
     1. Call `get_credentials` for that workspace.
     2. For each credential in the response, call `get_credential_services` with its `id_integration`. Only show credentials returned by `get_credentials` — do NOT include org-level credentials.
     3. Display a summary like:
        ```
        Here's what's already set up in this workspace:
        
        📋 Credential: "My S2S Cred" (OAuth Server-to-Server)
           APIs subscribed: Adobe Analytics, Firefly API
        
        📋 Credential: "My Web App" (AdobeId)
           APIs subscribed: none
        ```
        If `get_credentials` returns an empty list, say: *"No credentials found in this workspace yet."*
     4. Then proceed to ask which API they want to add.

3. **Find the API** — If the user asks *"what APIs are available"*, *"show me available APIs"*, or similar, call `list_services` with `filterBy: "enabled"` and display only the enabled APIs as a list (name + description, no raw codes). If the user named a specific API, call `list_services` with `filterBy: "enabled"` to find its `code` and full details. Never guess an SDK code.

4. **Pick credential type** — **Always run this step based on the API's supported types — never skip it because an existing credential was found.** An API can have multiple enabled instances with different `type` values. Collect ALL enabled instances for the API code, then:
   - Any instance whose `type` is `admin_entp` → **do not offer it as a selectable option**, but show a note to the user:
     ```
     ⚠️  Admin Enterprise credential is also available for this API but is not yet
         supported in this connector. You can still subscribe to it via the
         Adobe Developer Console.
     ```
   - If **no instances remain** after setting aside `admin_entp` → tell the user:
     ```
     This API only supports Admin Enterprise credentials, which are not yet supported
     in this connector. You can subscribe via the Adobe Developer Console directly.
     ```
     and stop.
   - If only **one** remaining credential type → proceed with it automatically.
   - If **multiple** remaining credential types → show them as a numbered list and ask: *"This API supports multiple credential types. Which would you like to use?"*
     1. Analytics credential *(internal: `analytics`)* — if an `analytics` instance is present
     2. User Auth (AdobeId) — for user-facing apps *(internal: `adobeid`)*
     3. OAuth Server-to-Server — for server-to-server access *(internal: `oauth_server_to_server`, also used for `entp`)*
   - **Wait for the user to pick before proceeding.** Do not auto-select based on what credentials already exist in the workspace.
   - **Show only credential type names in this list — never mention existing credentials here.** Do not append "subscribe to the existing X credential" or any reference to existing workspace credentials. Existing credential lookup happens in step 6, after the type is chosen.

5. **Check for product profiles** — After the credential type is decided, inspect its `properties.licenseConfigs` array from the matching API instance:
   - If it is **non-empty**: present the profiles as a numbered list (show `name`, never raw `id` or `productId`) and tell the user: *"You can select one or more of these profiles."* Collect their choices — you'll need the selected profiles' `id` and `productId` fields when subscribing.
   - If it is **empty or absent**: skip directly to step 6 with no `licenseConfigs`.
   - **This step must complete before any credential creation or subscription call** — even when creating a new credential. Never pass `services` to `create_oauth_s2s_credential` until `licenseConfigs` have been resolved.

6. **Subscribe** — All credentials are workspace-scoped, so always use the workspace-level tools:

   **OAuth Server-to-Server credential** (`oauth_server_to_server`) → call `subscribe_credential_to_services`:
   - Pass `orgId`, `projectId`, `workspaceId`, `credentialType: "oauth_server_to_server"`, `credentialId`, and `services`.
   - Each service entry must include `licenseConfigs` if the user selected product profiles in step 5. An empty `licenseConfigs: []` is NOT the same as omitting it — pass the user's selections.
   - The `credentialType` must always match the **credential's** actual type (`oauth_server_to_server`), never the API's type (`entp`).

   **All credential types** use `subscribe_credential_to_services` (PUT). The server automatically preserves all already-subscribed services — only pass the service(s) you want to add or change; do NOT pre-fetch and re-send the full existing list. Preservation is per-service, not per-licenseConfig: if you're adding a licenseConfig to an already-subscribed service, include that service's full intended licenseConfigs list (existing plus new), not just the new one.

7. **Report success** — If `subscribe_credential_to_services` returns a 200, report success immediately without a separate verification call:
   *"✓ [API name] has been successfully subscribed to your [credential type] credential."*
   List all currently subscribed APIs from the services array you sent (no need to re-fetch).
   Only call `get_credential_services` if the response is ambiguous or an error was returned.

## Unsubscribe API Flow

Trigger when the user wants to remove an API from a credential — phrases like *"unsubscribe X"*, *"remove Analytics from this credential"*, *"stop using Firefly API"*, *"disconnect this API"*.

1. If org/project/workspace/credential context isn't already established, run **Step 1–2** of the flow above to get there, then call `get_credentials` + `get_credential_services` (per the pairing rule) to show the user which credentials exist and what's subscribed to each.
2. Ask the user which credential and which subscribed API(s) they want to remove — show names, never raw IDs or SDK codes.
3. Tell the user exactly what is about to be removed — the API name(s), the credential, and the project, by name (never raw IDs or SDK codes) — and that it can't be undone. **Do not ask them to type the project title or any other name.** The client shows its own Yes / No approval prompt when you call the tool; that prompt is the confirmation.
4. Call `unsubscribe_credential_from_service` with `orgId`, `projectId`, `workspaceId`, `credentialType`, `credentialId`, and `sdkCodes` (the codes to remove). This is the only tool used for unsubscribing, for every credential type. If the user declines the approval prompt, stop — do not retry or work around it — and ask what they would like to do instead.
   - **Never build this manually by re-PUTting a reduced service list via `subscribe_credential_to_services`.** Always use `unsubscribe_credential_from_service`.
   - **For `oauth_server_to_server` credentials specifically**, this tool internally calls the dedicated Console unsubscribe endpoint (`unsubscribe_oauths2s_to_service`) once per `sdkCode`, instead of the fetch-then-resubscribe path used for other credential types. You don't call that endpoint directly — always go through `unsubscribe_credential_from_service`; it selects the right path automatically based on `credentialType`.
5. Report success: *"✓ [API name] has been removed from your [credential type] credential."* List the `remaining` APIs from the tool's response — no need to re-fetch.

## Credential creation inputs

When no credential exists and one must be created, **never ask the user for a name or description** — derive them automatically using the pattern `{projectName}-{type}[-{subtype}]`:

| Credential type | Platform / subtype | Auto-generated name example |
|---|---|---|
| OAuth S2S | — | `mcptesting-s2s` |
| AdobeId | WebApp | `mcptesting-adobeid-webApp` |
| AdobeId | SinglePageApp | `mcptesting-adobeid-singlePageApp` |
| AdobeId | NativeApp | `mcptesting-adobeid-native` |
| AdobeId | apiKey | `mcptesting-adobeid-apikey` |
| Analytics | Web | `mcptesting-analytics-web` |
| Analytics | iOS | `mcptesting-analytics-ios` |
| Analytics | Android | `mcptesting-analytics-android` |

Set description to: `"{Type} credential for {projectTitle}"` (e.g. `"OAuth S2S credential for mcptesting"`).

Truncate the name to 50 characters if needed. Use lowercase and hyphens only.

### OAuth Server-to-Server (`create_oauth_s2s_credential`)
- Auto-generate name and description. No further input needed — proceed directly to creation.
- **Never pass `services` to `create_oauth_s2s_credential`** — always create the credential first (no `services`), then subscribe in a separate `subscribe_credential_to_services` call. Inline service attachment is unreliable and causes confusing retry flows.

### User Auth — AdobeId (`create_user_auth_credential`)
- Auto-generate name and description.
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
- Auto-generate name and description.
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

After creating any credential, use its returned `id` as `credentialId` in the subscription call. Never re-fetch credentials after a fresh creation.

**Whenever any tool response includes a `console_url` field** (project creation, credential creation, subscription), always display it to the user as a clickable link:
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

- **Do not assume anything not explicitly described in this skill** — if a behavior, field, or API detail is unclear or not covered here, call `search_adobe_docs` to look it up in official Adobe documentation before proceeding.
- **`entp` APIs** (e.g. Adobe Campaign) use an OAuth S2S credential. Never show "entp" to the user.
- **`admin_entp` instances are never selectable** — always show a "coming soon" note with a link to the Console, but never block the rest of the flow. Only stop entirely if ALL instances are `admin_entp`.
- **Always use the API `type` field to determine credential type. Completely ignore `oauthServerToServerOnly`.** Mapping: `adobeid` → `create_user_auth_credential`, `analytics` → `create_analytics_credential`, `entp` → `create_oauth_s2s_credential`, `oauth_server_to_server` → `create_oauth_s2s_credential`.
- **Never skip step 4.** Credential type must be chosen based on the API's supported types every time — not inferred from what credentials already exist in the workspace.
- **Always pair `get_credentials` with `get_credential_services`.** Whenever `get_credentials` is called, immediately follow up by calling `get_credential_services` for each credential returned before presenting anything to the user. Never show credentials without their subscribed APIs.
- Never show raw IDs (licenseConfigId, credentialId, productId) to the user — use names instead.
- **Integrations and credentials are the same concept.** The `get_credentials` response uses `id_integration` as the credential ID — use this value wherever `credentialId` is required in any tool call. `integration_name` is the credential's display name.
- Never use internal jargon — present `licenseConfigs` as "product profiles" to the user.
- **Never skip product profile selection.** If `properties.licenseConfigs` is non-empty for an API, always complete step 5 and include the selected `licenseConfigs` in the `services` array — both when subscribing to an existing credential and when creating a new one. An omitted or empty `licenseConfigs` means the subscription will have no product profile attached.
- `list_services` returns a very large payload that exceeds the inline token limit. When you need to find an API code or inspect its details, search the saved file with a shell command (e.g. `python3 -c "import json; ..."` filtering by name/code) rather than reading the full response inline.
