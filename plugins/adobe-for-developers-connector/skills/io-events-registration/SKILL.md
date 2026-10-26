---
name: io-events-registration
description: Use when the user wants to subscribe to Adobe I/O Events, create an event registration, set up a webhook, configure event delivery, or manage existing registrations — phrases like "subscribe to events", "register for events", "set up webhook", "listen to events", "event registration", "I/O Events", "configure journal", "set up event delivery", "delete registration", "remove event registration", "unsubscribe from events", "list registrations", "update registration", "disable registration", "enable registration", "trace events", "debug delivery", "check event delivery", "why didn't I receive events", "event trace", "webhook verification failed", "re-verify webhook", "retry webhook", "webhook not verified", "webhook challenge", "add event to registration", "subscribe to more events", "add event type", "read journal", "fetch events", "poll journal", "get journal events".
license: Apache-2.0
---

# I/O Events Registration Flow

Guide the user through creating an event registration to receive events from Adobe services.

**Before starting:** invoke the `dev-console-context` skill.

## Steps

### Step 1 — Org, Project, Workspace

1. Call `get_organisations` → ask user to pick org. Store both `id` (numeric) and `code` (IMS org code).
2. Ask: *"Do you want to use an existing project or create a new one?"*

   **If existing project:**
   - Call `get_projects` with `filterBy: "me"` → show as numbered list → user picks project.

   **If new project:**
   - Ask for a **title** only. Derive `name` automatically (strip non-alphanumeric, camelCase, truncate to 20 chars).
   - Call `create_project` with `projectType: "default"`, the derived `name`, and title.
   - The response returns `projectId` and `workspaceId` directly — the default workspace is **Production**. Use these directly.

3. For existing projects: call `list_workspaces` → auto-select if only one workspace (Production), otherwise ask user to pick.

---

### Step 2 — Pick event provider

Call **both** in parallel:
- `list_event_providers` with both `consumerOrgId` (org `id` field) and `imsOrgCode` (org `code` field)
- `get_provider_metadata` with `imsOrgCode` (the org `code` field)

**Map and enrich:** 
1. From `list_event_providers`, collect the unique `provider_metadata` values across all returned providers.
2. Filter `get_provider_metadata` results to **only those whose `id` matches one of the collected `provider_metadata` values** — discard the rest.
3. For display, use the enriched metadata (`group`, `label`, `description`, `type`) for the filtered entries only.

Show the enriched list grouped by `group` — **only providers actually available to this org**:

```
Creative Cloud:
  1. Adobe Illustrator Cloud Docs — OAuth S2S or User Auth
Adobe Services:
  2. Adobe Admin Console Audit Logs — OAuth S2S only
```

**Credential type display** — map `providerMetadata.type` field:
- `entp` → show **"OAuth S2S only"**
- `adobeid` → show **"User Auth only"**
- `entp_and_adobeid` → show **"OAuth S2S or User Auth"**

Ask the user to pick one provider category.

After picking, if `has_multiple_providers: true` → show instances (from `list_event_providers` filtered by `providerMetadataId`) and let the user pick one or more. If `has_multiple_providers: false` → auto-select the single instance.

---

### Step 3 — Pick event types

For each selected provider `id`, call `list_provider_events`.

Combine all returned event types. Show and ask user to pick one or more:

```
1. Cloud Doc Deleted   (ai_cloud_docs_deleted)
2. Cloud Doc Created   (ai_cloud_docs_created)
3. Cloud Doc Updated   (ai_cloud_docs_updated)
```

---

### Step 4 — Pick credential

Use the `type` from the selected provider metadata to determine which credential types are valid:

| Provider metadata `type` | Valid credentials to show |
|---|---|
| `entp` | OAuth S2S only |
| `adobeid` | User Auth (AdobeId) only |
| `entp_and_adobeid` | Both OAuth S2S and User Auth |

**4a. Ask credential type first** (based on provider `type`):

- If `entp` → skip asking, proceed with OAuth S2S automatically
- If `adobeid` → skip asking, proceed with User Auth automatically
- If `entp_and_adobeid` → ask:
  ```
  This provider supports multiple credential types. Which would you like to use?
  1. OAuth Server-to-Server
  2. User Auth (AdobeId)
  ```

**4b. If OAuth S2S selected:**
- Call `get_credentials` and check if one exists (`flow_type: "entp"` or `integration_type: "oauth_server_to_server"`)
- If exists → use it, call `get_credential_secrets` with `id_integration` to get `client_id`
- If not → **follow the OAuth S2S credential creation steps from the `dev-console-subscribe-api` skill** (`### OAuth Server-to-Server` section), then call `get_credential_secrets`

**4c. If User Auth selected:**

Ask for platform: WebApp, SinglePageApp, NativeApp, or apiKey.

- Call `get_credentials` and check if a User Auth credential exists for that platform (`flow_type: "adobeid"`)
- If exists → use it, call `get_credential_secrets` to get `client_id`
- If not → **follow the User Auth credential creation steps from the `dev-console-subscribe-api` skill** (`### User Auth — AdobeId` section) for the chosen platform, then call `get_credential_secrets`

---

### Step 5 — Pick delivery type

Ask the user to pick **one** delivery type:

```
How would you like to receive events?
1. Journal         — poll events from a journal endpoint (Adobe manages the queue)
2. Webhook         — push events to a URL in real time
3. AWS EventBridge — deliver events to AWS
4. Runtime Action  — invoke an App Builder runtime action
```

**If Journal selected:** no extra inputs needed.

**If Webhook selected:**
1. Ask for **webhook URL**
2. Ask: *"Single events or batches?"* → Single = `"webhook"`, Batch = `"webhook_batch"`

**If AWS EventBridge selected:**
- Ask for **AWS Region** and **AWS Account ID**
- `delivery_type: "aws_eventbridge"`, goes into `destination_metadata: { aws_region, aws_account_id }`

**If Runtime Action selected:**
- Ask for **runtime action path** (e.g. `my-org/my-app/my-action`)
- Goes into top-level `runtime_action` field

---

### Step 6 — Registration name

Ask: *"What would you like to name this event registration?"*

---

### Step 7 — Create registration

One `create_event_registration` call for the delivery type the user picked. Use `consumerOrgId`, `projectId`, `workspaceId`, `client_id`, `events_of_interest`, `enabled: true`.

| Delivery | `delivery_type` | Extra fields |
|---|---|---|
| Journal | `"journal"` | — |
| Webhook | `"webhook"` or `"webhook_batch"` | `webhook_url` |
| AWS EventBridge | `"aws_eventbridge"` | `destination_metadata` |
| Runtime Action | `"journal"` | `runtime_action` |

> **Note:** Adobe automatically provisions a journal in the background for non-journal registrations — do not create a separate journal registration unless the user explicitly chose Journal.

---

### Step 8 — Report success

```
✓ Event registration created successfully!

   Provider:      {providerLabel}
   Events:        {event_codes}
   Credential:    {credentialName} ({credentialType})
   Delivery:      {delivery_type}
   Registration:  {name}  (ID: {registration_id})
```

**If `delivery_type` is `webhook` or `webhook_batch`**, check `webhook_status` in the response:

- `verified` → all good, Adobe confirmed the endpoint.
- `verification_pending` → Adobe hasn't sent the challenge yet or the endpoint hasn't responded. Tell the user:
  ```
  ⏳ Webhook verification is pending.
  Adobe will send a GET request with a `challenge` query param to your URL.
  Your endpoint must respond with the `challenge` value to complete verification.
  Run `get_event_registration` in a few moments to check the status.
  ```
- `verification_failed` → offer to re-trigger (see **Webhook Verification Flow** below).

**If `delivery_type` is `journal`**, tell the user:
```
📋 Your journal registration is ready. Events will queue here as they arrive.
Use the Journal Reading Flow to fetch them with `get_journal_events_batch`.
```

---

## Journal Reading Flow

Trigger when user says *"read journal"*, *"fetch events"*, *"poll journal"*, *"get journal events"*, *"what events came in"*, *"show me my events"*, *"read from journal"*.

> **Journal is pull-based.** Unlike webhook/runtime/AWS EventBridge (push), the consumer fetches batches on demand. Adobe queues events; you drain them.

1. If workspace context is not set, run **Step 1** first.
2. Call `get_registrations_for_workspace` → **filter to `delivery_type: "journal"`** → show as numbered list → user picks one.
3. Call `get_credentials` → match the registration's `client_id` to a credential's `client_id` → use its `id_integration` as `credentialId`.
4. Ask: *"Start from the beginning, the latest event, or a specific position (`since` cursor)?"*
   - **Beginning / default** → call `get_journal_events_batch` with `consumerOrgId`, `imsOrgCode`, `credentialId`, `registrationId`.
   - **Latest** → call with `latest: true`.
   - **Cursor** → ask for the `since` value → pass as `since`.
5. Display results:
   - If empty → *"No events in the journal yet. Events will appear once the source produces them."*
   - If events found → show a compact summary, then offer to fetch more:
     ```
     Fetched {count} event(s):
     1. {type}  {time}  source: {source}

     Fetch more?
     ```
6. If the user wants more, call `get_journal_events_batch` again with the `since` cursor from the previous response's `_links.next` link.

---

## Tracing Flow

Trigger when user says *"trace events"*, *"debug delivery"*, *"check event delivery"*, *"why didn't I receive events"*, *"event trace"*.

> **Tracing is push-based only.** Applicable to `webhook`, `webhook_batch`, `aws_eventbridge`, and `runtime_action` registrations. Journal registrations have no delivery attempts to trace.

1. If workspace context is not set, run **Step 1** first.
2. Call `get_registrations_for_workspace` → **filter out `delivery_type: "journal"`** → show remaining registrations → user picks one.
3. Call `get_credentials` → match `client_id` → use `id_integration` as `credentialId`.
4. Call `get_tracing_for_registration` with `consumerOrgId`, `imsOrgCode`, `credentialId`, `registrationId`.
5. Display results:
   - If empty array → *"No trace events found — no events have been delivered to this registration yet."*
   - If traces found → show as a table:
     ```
     Date                  Event Code              Status
     2026-06-20T10:00:00   ai_cloud_docs_deleted   delivered
     ```

---

## Add Event Providers to Existing Registration

Trigger when user says *"add more events"*, *"add another provider"*, *"subscribe to more events"*, *"add event type"*, *"extend registration"*, *"add provider to registration"*.

> A registration can cover multiple providers and event types. Adding more must go through `update_event_registration` — never create a new registration for this.

### Step A1 — Pick registration

Call `get_registrations_for_workspace` → show as numbered list → user picks one.

### Step A2 — Show current events

Call `get_event_registration` to fetch the full registration. Display what's already subscribed:

```
Current events on "{name}":
  1. {providerLabel} — {event_code}
  2. {providerLabel} — {event_code}
```

### Step A3 — Pick new provider

Follow **Step 2** (Pick event provider) from the main flow to let the user pick a new provider and event types. Skip any providers/event codes already in `events_of_interest`.

### Step A4 — Pick new event types

Follow **Step 3** (Pick event types) for the newly selected provider.

### Step A5 — Confirm

```
I'll add the following to "{name}":
  + {providerLabel} — {event_codes}

Existing subscriptions are preserved. Proceed?
```

### Step A6 — Update

Call `update_event_registration` with all existing fields from Step A2 plus the new entries appended to `events_of_interest`.

Report:
```
✓ Registration updated!

   Name:    {name}
   Events:  {all event_codes, old + new}
```

---

## Delete Registration Flow

Trigger when user says *"delete registration"*, *"remove event registration"*, *"unsubscribe from events"*.

1. If the user hasn't specified which registration, call `get_registrations_for_workspace` and show the list.
2. Once the user picks one, tell them which registration is about to be deleted and that it can't be undone: *"This will permanently delete registration **{name}**."* **Do not ask them to type the name.** The client shows its own Yes / No approval prompt when you call the tool; that prompt is the confirmation.
3. Call `delete_event_registration` for the chosen registration. If the user declines the approval prompt, stop — do not retry or work around it — and ask what they would like to do instead.
4. Report: *"✓ Registration '{name}' deleted successfully."*

---

## Webhook Verification Flow

Trigger when:
- The user says *"webhook verification failed"*, *"re-verify webhook"*, *"retry webhook"*, *"webhook status failed"*, *"webhook not verified"*, *"webhook challenge"*, *"re-trigger webhook"*
- You see `webhook_status: "verification_failed"` in any registration response

**How it works:** Calling `update_event_registration` with the same fields re-triggers Adobe's challenge flow.

### Step V1 — Identify the registration

Call `get_registrations_for_workspace` → filter to webhook/webhook_batch registrations with `webhook_status: "verification_failed"` → show as numbered list → user picks one. Auto-select if only one.

### Step V2 — Show status and explain

```
⚠️  Webhook verification failed for "{name}"

   Webhook URL:  {webhook_url}
   Status:       verification_failed

Adobe sent a GET challenge request to your webhook URL but did not receive
the correct response. Your endpoint must echo back the `challenge` query
parameter value in the response body.

Would you like me to re-trigger the verification challenge now?
```

### Step V3 — Re-trigger the challenge

Call `get_event_registration` to fetch the full current registration.

Then call `update_event_registration` with the **exact same values** as the current registration:

```
consumerOrgId, imsOrgCode, projectId, workspaceId, registrationId  ← from context
name, description, webhook_url, events_of_interest, delivery_type, enabled  ← from current registration
```

### Step V4 — Confirm and advise

```
✓ Webhook verification re-triggered!

Adobe will now send a new challenge GET request to:
{webhook_url}

Your endpoint must respond with:
  HTTP 200
  Body: the value of the `challenge` query parameter

Run `get_event_registration` in a few seconds to confirm the status
changes from `verification_pending` → `verified`.
```

---

## When Instructions Are Unclear

If the user's intent is ambiguous, a concept is unfamiliar, or you need more context about an Adobe product or API before proceeding — call `search_adobe_docs` with the relevant question before asking the user to clarify. For example:

- Not sure what delivery type fits the user's use case → search *"Adobe I/O Events delivery types comparison"*
- Unclear what credential type a provider requires → search *"Adobe I/O Events credential types entp adobeid"*
- User mentions a product you don't recognise → search *"what is {product} Adobe developer platform"*

Always prefer fetching from official docs over guessing.

---

## Rules

- **Do not assume anything not explicitly described in this skill** — if a behavior, field, or API detail is unclear or not covered here, call `search_adobe_docs` to look it up in official Adobe documentation before proceeding.
- Always show name and ID together — never show a raw ID alone
- Never show `client_secret` values
- Use **`patch_event_registration`** for targeted changes (enable/disable, rename, change webhook URL)
- Use **`update_event_registration`** when changing multiple fields at once (events, delivery type, etc.)
- JSON Patch path examples: `"/enabled"`, `"/name"`, `"/webhook_url"`, `"/delivery_type"`
- Never guess `event_code` or `provider_id` — always fetch from the API
- Use `providerMetadata.type` to determine valid credential types — never offer credential types not supported by the provider
- Only create one registration — the delivery type the user explicitly chose
- A registration can include events from multiple providers — if the user wants to add more providers to an existing registration, use the **Add Event Providers to Existing Registration** flow (`update_event_registration`); if they explicitly want a new separate registration, proceed with the main creation flow
- Never create an extra journal registration alongside another delivery type — Adobe provisions one in the background automatically
- For `journal` delivery, remind the user to use the **Journal Reading Flow** (`get_journal_events_batch`) to fetch events
- Tracing only applies to push-based registrations — never call `get_tracing_for_registration` for a journal registration
- When `webhook_status: "verification_failed"` is seen on any registration, proactively flag it and offer the Webhook Verification Flow
- To re-trigger webhook verification, call `update_event_registration` with the exact same fields — always fetch the current registration first via `get_event_registration`
