---
name: io-events-filtering
description: Use when the user wants to filter events, test event registrations with sample events, or manage subscriber defined filters — phrases like "add filter", "create filter", "subscriber filter", "filter events", "define filter", "filter registration", "validate filter", "update filter", "edit filter", "delete filter", "remove filter", "show my filters", "list filters", "show sample event", "test my registration", "send test event", "what does the event look like", "sample payload", "send a test event", "view sample payload", "custom event payload", "send custom event".
license: Apache-2.0
---

# I/O Events — Filtering & Sample Events
**Before starting:** invoke the `io-events-registration` skill.
---

## Sample Events Flow

Trigger when the user asks about sample events, wants to test their registration, or says things like *"show me a sample event"*, *"test my registration"*, *"what does the event look like"*, *"send a test event"*.

### Step 1 — Check availability

Call `check_sample_event` with `providerId` and `eventCode`.

- If `{ available: false }` → tell the user: *"No sample event is available for this event type."* and stop.
- If `{ available: true }` → proceed to Step 2.

### Step 2 — Ask the user

*"A sample event is available. Would you like to:*
*1. View the sample payload*
*2. Send it to your registration as-is (for testing)*
*3. Send a custom version of it (edit the payload before sending)*
*4. All of the above"*

### Step 3a — View sample payload

Call `get_sample_event` with `providerId` and `eventCode`. Display the result:

```
📦 Sample Event

Format:  cloud_events_v1
Payload:
{
  "specversion": "1.0",
  "type": "ai_cloud_docs_deleted",
  ...
}
```

### Step 3b — Send to registration (as-is)

Call `get_registrations_for_workspace` to fetch existing registrations. Show as a numbered list and ask the user to pick one:
```
1. My Journal Reg     (journal)   ID: reg-abc123
2. My Webhook Reg     (webhook)   ID: reg-def456
```

Call `post_sample_event` with `providerId`, `eventCode`, `registrationId` and no custom payload.

- If `{ posted: true }` → *"✓ Sample event sent to your registration successfully."*
- If `{ posted: false }` → *"This event type does not support posting sample events."*

### Step 3c — Send a custom event

Call `get_sample_event` to fetch the sample payload (if not already done in Step 3a).

To determine the format, use `event_delivery_format` from the provider returned by `list_event_providers` — not the `format` field on the sample payload.

**CloudEvents format** (`event_delivery_format === "cloud_events_v1"`):

Parse `sample_payload` as JSON and show the user every field — marking `type` and `source` as read-only (Adobe enforces these server-side):

```
📦 Sample Event — customise before sending:

Editable:
  specversion:      "1.0"
  id:               "abc-123"
  time:             "2026-06-30T10:00:00Z"
  datacontenttype:  "application/json"
  data:             { ... }

Read-only (set by Adobe):
  type:    "{type value}"
  source:  "{source value}"

Change any editable field and I'll send it.
```

Wait for the user's changes. Build the final payload by merging their edits with the canonical `type` and `source` from the original sample.

**Other formats** (`event_delivery_format` is not `"cloud_events_v1"`):

Show the full `sample_payload` as editable — user can change any field including envelope fields. No restrictions apply.

Once ready, confirm before sending:
```
I'll send this custom event to your registration. Proceed?
```

Call `get_registrations_for_workspace` if a registration hasn't been selected yet → show list → user picks.

Call `post_sample_event` with `providerId`, `eventCode`, `registrationId`, and `payload` set to the merged payload.

- If `{ posted: true }` → *"✓ Custom event sent to your registration successfully."*
- If `{ posted: false }` → *"This event type does not support posting sample events."*

---

## Subscriber Filter Flow

Trigger when user says *"add filter"*, *"create filter"*, *"subscriber filter"*, *"filter events"*, *"define filter"*, *"filter registration"*, *"validate filter"*.

Subscriber Defined Filters use **AWS Event Ruler JSON syntax** to match against event payloads. Only events that match the filter reach the registration's endpoint.

---

### Step F1 — Resolve registration context

If `consumerOrgId`, `projectId`, `workspaceId` are not already known, invoke the `io-events-registration` skill Step 1 first.

Call `get_registrations_for_workspace` to get all registrations. Then validate eligibility:

**Step F1a — Filter by delivery type**

Exclude any registration with `delivery_type: "aws_eventbridge"` — AWS EventBridge handles its own filtering natively.

**Step F1b — Validate CloudEvents v1 format**

For the remaining registrations, collect all unique `provider_id` values from their `events_of_interest`. Call `list_event_providers` with `consumerOrgId` and `imsOrgCode` to get provider details.

For each provider, check its `event_delivery_format` field:
- `"cloud_events_v1"` → eligible ✅
- `"adobe_io"` → **not eligible** — Subscriber Defined Filters are not supported for the Adobe I/O format ❌
- Any other value (or missing) → not eligible ❌

A registration is **fully eligible** if all its providers use `"cloud_events_v1"`.
A registration is **partially eligible** if only some providers do — show it but warn that events from `"adobe_io"` providers will be delivered unfiltered.
A registration is **ineligible** if none of its providers use `"cloud_events_v1"` — exclude it.

**Step F1c — Show eligible registrations**

```
Eligible: 1. My Journal Reg (journal)  2. My Webhook Reg ⚠️ (webhook)
Not eligible: ✗ My EventBridge Reg (aws_eventbridge)
```

Ask the user to pick from the eligible list only.

If **no eligible registrations exist**, tell the user:
```
Subscriber Defined Filters are only supported for journal, webhook, and runtime action
registrations whose events use the CloudEvents v1 format.

None of your current registrations are eligible. Create an eligible registration first.
```

If the user picks a partially eligible registration, warn before proceeding:
```
⚠️  One or more providers in this registration do not use CloudEvents v1 format.
    Filters will only apply to events from eligible providers.
    Events from other providers will be delivered unfiltered.
```

**Step F1d — Check for existing filter**

Call `get_subscriber_filters` on the selected registration. Only one filter is allowed per registration.

- If a filter already exists → tell the user:
  ```
  ⚠️  This registration already has a Subscriber Defined Filter:
      Name:       {name}
      Expression: {subscriber_filter}

  Only one filter is allowed per registration.
  Would you like to update the existing filter instead?
  ```
  If yes → redirect to the Update Filter Flow (Step U3, skipping U1 and U2).
  If no → stop.

- If no filter exists → proceed to Step F2.

---

### Step F2 — Introduce the DSL and show available patterns

Call `get_subscriber_filter_patterns` to retrieve all supported patterns.

Explain briefly: Adobe I/O Events uses the AWS Event Ruler DSL — you write a JSON expression matched against each event's payload, and only matching events are delivered.

Show the patterns as a numbered list using the `name` from each entry. Ask which pattern the user would like to use.

---

### Step F3 — Show the example for the chosen pattern

Find the entry in the `get_subscriber_filter_patterns` response whose `name` matches what the user picked. Display its `value` as formatted JSON:

```
Here is an example for "{patternName}":

{value as pretty-printed JSON}
```

Then ask:
> *"Would you like to create a filter like this for your registration, or combine multiple patterns?"*

---

### Step F3.5 — Offer a sample event payload for reference

After showing the pattern example, ask:
> *"Would you also like to see a real sample event payload? This can help you identify the exact field names to use in your filter."*

If the user says yes:

1. From the registration selected in Step F1, get the `events_of_interest` list (call `get_event_registration` if not already in context).
2. If multiple event types, show them as a numbered list and ask which one to preview.
3. Call `check_sample_event` with `providerId` and `eventCode`.
   - If `{ available: false }` → *"No sample payload is available for this event type."*
   - If `{ available: true }` → call `get_sample_event` and display:

```
📦 Sample Event Payload

Format:  {format}
Payload:
{sample_payload as pretty-printed JSON}

Use the field names from this payload in your filter expression.
Top-level CloudEvent fields (specversion, id, source, type, datacontenttype, time)
can be referenced directly. Event-specific data lives under the "data" key.
```

4. Proceed to Step F4.

---

### Step F4 — User writes the filter expression

Ask:
> *"Write your filter expression in Event Ruler JSON. Conditions on different fields are implicitly AND-ed together."*

If the user is unsure, offer to help build it field by field:
> *"What field in the event payload do you want to filter on? (e.g. `data.status`, `type`, `source`)"*

---

### Step F5 — Validate the filter

Call `validate_subscriber_filter` with:
- `consumerOrgId`, `projectId`, `workspaceId`, `registrationId` from context
- `subscriber_filter`: an object with `name: "validation-check"` and `subscriber_filter`: the user's expression string

**If validation succeeds (200):**
```
✓ Your filter expression is valid!

It will match events where:
  {plain-English summary of the filter}

Would you like to go ahead and create this filter?
```

**If validation fails (400):**
```
✗ The filter expression has an issue:
  {error message from the API}

Please correct the expression and try again.
```

Return to Step F4 if the user wants to fix it.

---

### Step F6 — Confirm and collect metadata

Once the user confirms, ask:

1. *"What would you like to name this filter?"* (3–80 characters)
2. *"Add a short description? (optional, up to 250 characters)"*

---

### Step F7 — Create the filter

Call `create_subscriber_filter` with `consumerOrgId`, `projectId`, `workspaceId`, `registrationId`, `name`, `description`, and `subscriber_filter`.

Report:
```
✓ Subscriber filter created!

   Name:        {name}
   ID:          {id}
   Expression:  {subscriber_filter}

Events that match this filter will now be delivered to registration "{registrationName}".
```

---

### Managing existing filters

| User intent | Action |
|---|---|
| *"show my filters"* / *"list filters"* | Call `get_subscriber_filters` → display as numbered list with name, ID, expression |
| *"view filter"* / *"get filter details"* | Call `get_subscriber_filter` with the filter ID |
| *"delete filter"* / *"remove filter"* | Run the Delete Filter Flow below |

---

### Delete Filter Flow

**Step D1 — Pick registration**

Call `get_registrations_for_workspace` → show all registrations. Ask the user to pick one.

**Step D2 — Show available filters**

Call `get_subscriber_filters`. Display as a numbered list:
```
Filters on "{registrationName}":
1. My Status Filter  (ID: 497f6eca-…)  {"data":{"status":[{"equals":"published"}]}}
```

If no filters exist → *"This registration has no subscriber filters to delete."* and stop.

**Step D3 — Announce the deletion**

Once the user picks a filter, tell them which one is about to be deleted and that it can't be undone:
> *"This will permanently delete the filter **{name}** from **{registrationName}**."*

**Do not ask them to type the filter name.** The client shows its own Yes / No approval prompt when you call the tool; that prompt is the confirmation.

**Step D4 — Delete**

Call `delete_subscriber_filter` with `consumerOrgId`, `projectId`, `workspaceId`, `registrationId`, and `subscriberFilterId`. If the user declines the approval prompt, stop — do not retry or work around it — and ask what they would like to do instead.

Report: *"✓ Filter "{name}" deleted successfully."*

---

### Update Filter Flow

**Step U1 — Pick registration**

Call `get_registrations_for_workspace` → show all registrations. Ask the user to pick one.

**Step U2 — Pick filter**

Call `get_subscriber_filters`. Display as a numbered list. If no filters exist → redirect to Step F2.

**Step U3 — Show current filter and pick a new pattern**

Display the current filter, then call `get_subscriber_filter_patterns` and show the pattern list as in Step F2.

**Step U4 — Show pattern example** — same as Step F3. Optionally offer a sample event payload (Step F3.5).

**Step U5 — User writes the new filter expression** — same as Step F4.

**Step U6 — Validate** — same as Step F5. Loop back to Step U5 if invalid.

**Step U7 — Update name and description**

Pre-fill with the current name and description. Ask if the user wants to keep or change them.

**Step U8 — Call update**

Call `update_subscriber_filter` with `consumerOrgId`, `projectId`, `workspaceId`, `registrationId`, `subscriberFilterId`, `name`, `description`, and the new `subscriber_filter`.

Report:
```
✓ Subscriber filter updated!

   Name:        {name}
   ID:          {subscriberFilterId}
   Expression:  {subscriber_filter}
```

---

## When Instructions Are Unclear

If the user's intent is ambiguous or a concept needs clarification — call `search_adobe_docs` before asking the user. For example:

- Unsure how AWS Event Ruler syntax works → search *"Adobe I/O Events subscriber defined filter AWS Event Ruler syntax"*
- User mentions a filter pattern you don't recognise → search *"Adobe I/O Events filter pattern {pattern name}"*
- Unclear what CloudEvents fields are available for filtering → search *"Adobe I/O Events CloudEvents v1 payload fields"*

Always prefer fetching from official docs over guessing.

---

## Rules

- **Do not assume anything not explicitly described in this skill** — if a behavior, field, or API detail is unclear or not covered here, call `search_adobe_docs` to look it up in official Adobe documentation before proceeding.
- Always show name and ID together — never show a raw ID alone
- Never show `client_secret` values
- Only one Subscriber Defined Filter is allowed per registration — always call `get_subscriber_filters` before creating and redirect to update if one already exists
- Subscriber Defined Filters only work on registrations with `event_delivery_format: "cloud_events_v1"` — providers with `"adobe_io"` format or AWS EventBridge registrations are not eligible
- Never guess `event_code` or `provider_id` — always fetch from the API
- For CloudEvents sample events: `type` and `source` are read-only (enforced by Adobe) — all other fields including `data` are editable
