# Workfront Planning automations — Deep dive and decision tree

Synthesis doc (NOT a single Adobe page). Reconciles native record-type automations + Fusion scenarios + AI Assistant + Planning API + request-form approvals into one decision framework. References the primary Adobe docs for each surface.

Last update: May 11, 2026 (compiled)

## The five automation surfaces in Workfront Planning

| Surface | Triggered by | Authored by | Editable after save | Audit | Latency |
|---|---|---|---|---|---|
| Native automation (button click) | User click on selected records | Workspace Manager+ | Yes (except Action) | Record history | Synchronous, near-instant |
| Native automation (field value change) | Field condition match | Sysadmin only | NO | Record history | Async, seconds |
| Fusion scenario (Watch Events trigger) | Record/type/workspace create/update/delete | Fusion developer | Yes (except webhook filters) | Fusion execution history + record history | Async, typically <1 minute |
| AI Assistant prompt | User natural-language prompt | Anyone with permission | N/A (one-shot) | Record history | Synchronous |
| Request form approval | Submission to gated form | Workspace Manager+ | Yes | Request status + record fields | Human-driven |

## Decision tree: when to use which

### Use NATIVE BUTTON-CLICK automation when:
- The trigger is "a user explicitly decides to do this thing now."
- The action is one of: create project(s), portfolio, program, group, or another Planning record.
- Permissions are stable (workspace manager + select users authorized).
- The "Action" field will never change. (You cannot edit Action post-save.)

### Use NATIVE FIELD-VALUE-CHANGE automation when:
- The trigger is a Planning-internal state transition (e.g., Status → "Approved").
- The same 5-condition limit and 6-action set apply.
- You have a sysadmin available to author it.
- You're OK with NO post-save edits. Treat as a production deploy.

### Use FUSION when:
- The trigger is anything OUTSIDE Planning (Workfront task created, external app event, scheduled time).
- The action is anything Planning's native automations don't support (multi-step orchestration, conditional branching, cross-system updates, file generation, notifications to non-Workfront channels).
- You need observability and replay (Fusion has execution history; native automations have minimal logging).
- High-volume creates/updates where you need throttling control.

### Use AI ASSISTANT when:
- Ad-hoc, user-driven, one-time-ish work.
- Bulk operations that fit a natural-language description but don't justify building a permanent automation.
- The user can verify the confirmation gate before execution.
- NOT for repeating or scheduled work. AI Assistant is not a cron.

### Use PLANNING API directly when:
- You're building a custom application (App Builder or external).
- Fusion's modules don't expose the operation you need (Search records with complex `$and`/`$or` composition, batch read of 5K+ records with paginated `offset`).
- You need an External lookup field in a legacy Workfront custom form to display live Planning data.

### Use REQUEST-FORM APPROVAL when:
- A gate is needed BETWEEN user submission and record creation.
- Approvers may be outside Planning (license: Any).
- The workflow is: submit → approve/reject → record (or no record).

## Composability patterns

### Pattern 1: Approval-gated record + auto-create child project
Request form with approval → on approval, record is created → native field-value-change automation on the new record creates downstream project. Approval applies to creation; downstream cascade is automatic. **Sysadmin must own the field-value-change step.**

### Pattern 2: External system event → Planning record
Fusion Watch Events on the external system (e.g., Salesforce, Adobe Experience Manager, GenStudio) → Fusion Create a record. Webhook filters are immutable once saved; design carefully.

### Pattern 3: Planning record change → external notification
Fusion Watch Events on Planning records (state: new) → HTTP / Slack / Email module. Set "Exclude updates made by this connection" to avoid loops.

### Pattern 4: AI Assistant + native automation
User creates records via AI Assistant prompt → record's status field triggers a field-value-change automation → projects get created. The AI Assistant + automation chain is fully audited in the record's history.

### Pattern 5: API-driven bulk seed + automations OFF
For large initial loads (migration from another tool):
1. Disable all field-value-change automations BEFORE the load.
2. Run Planning API POST /v1/records, paginated.
3. Re-enable automations.
This avoids cascading automation fires during seed (which would create thousands of unwanted child projects).

## Governance rules of thumb

- **Document automations like code.** Name, description, owner, last-modified date in a tracking spreadsheet (or, ironically, a Planning record type called "Automations").
- **Field-value-change automations are one-way doors.** If you might want to change the Action, build it as button-click instead. Or accept that you'll delete and recreate.
- **Webhook filters are also one-way doors** in Fusion. Same discipline applies.
- **AI Assistant respects per-user permissions, but actions are visible to other users immediately.** If a user with broad Manage permission asks AI Assistant to "delete all records older than 90 days," the deletion is real and visible to everyone using the workspace. There's no "AI Assistant sandbox."
- **The 200 rpm per-user rate limit is shared** across all surfaces. A user driving Fusion + AI Assistant + a custom app at the same time can collectively burn through it.
- **For destructive actions, prefer human-in-the-loop.** Native automations cannot delete records (the action menu only creates). AI Assistant CAN delete but requires confirmation. Fusion CAN delete silently — gate it with manual review (e.g., write proposed-deletion records to a "to-delete" record type and have a human approve before running the actual delete).

## Common anti-patterns

### Anti-pattern: Webhook fan-out without "Exclude updates made by this connection"
Scenario writes back to Planning → its own webhook fires → infinite loop. Always check the exclude toggle.

### Anti-pattern: Field-value-change automation on a "Status" field with many transitions
Customer adds an automation for every status. Result: cascading project creates as records move through statuses. Either restrict to one terminal status (e.g., only "Approved") or use button-click for the rest.

### Anti-pattern: Using AI Assistant for repeating work
"Every Monday, AI Assistant, create next week's campaign records." This doesn't work — AI Assistant isn't scheduled. Use Fusion with a Scheduler trigger.

### Anti-pattern: Treating the request-form approval as a workflow engine
Customers expect: submit → approver1 reviews → approver2 reviews → revise → resubmit. This engine can't do sequential or iterative loops. For real workflow needs, use Fusion + status fields, or wait for broader Workfront workflow features.

### Anti-pattern: Letting Anyone-with-the-link request forms persist
The form URL leaks. External submissions land. Audit and unpublish stale forms or restrict sharing to workspace members.

## Cross-references in this corpus
- Native automations: `raw/records/configure-automations-to-create-records.md`, `raw/records/create-wf-objects-using-planning-automations.md`
- Fusion: `raw/fusion/workfront-planning-modules.md`
- AI Assistant: `raw/ai-assistant/planning-ai-assistant-overview.md`
- API: `raw/api/api-basics.md`
- Approvals: `raw/requests/add-approval-to-request-form.md`, `raw/requests/approve-request.md`
- MCP filter operators: `mcp-references/filter-operators.json`
