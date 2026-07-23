# Workspace build playbook

The canonical playbook for designing and building a Workfront Planning workspace. Synthesizes the MCP workspace-setup-guide.txt (prescriptive build instructions for agentic flows) with the architectural patterns and deviations of the Fréscopa best-practice template.

When building agentically via MCP, treat this file as system-prompt-quality instruction. Read it first, build silently and completely, narrate only at the end.

## Object hierarchy

```
Workspace > Section > Record Type > Field / View / Record
```

Each child requires its parent to exist first. Tool calls that depend on an ID from a previous call must be executed in separate turns. Never pass placeholder IDs.

## Workspace structure

### Sections
- 3 to 6 sections per workspace.
- Every section must contain at least one record type (no empty sections).
- Sections organize record types around business meaning, not view purposes. Do not create sections called "Reporting", "Dashboards", or "Governance"; those are view concerns.
- If only 1 or 2 sections make sense for a small focused workspace (e.g., an OKR-only workspace), say so deliberately. Do not pad with empty sections.
- If sections are populated mostly by cross-workspace types from a taxonomy hub, document that intent up front.

### Naming
Use creative, domain-oriented business language. Match how the team actually talks.
- Workspaces: "Global Campaign Hub" not "Campaign Workspace". Avoid numeric prefixes ("1.", "2.") unless the user explicitly asks for ordered naming.
- Sections: "Campaign Planning & Execution" not "Operational Planning". Use Title Case consistently. No mid-word capitalization ("GEos", "EVent taxonomies" are anti-patterns).
- Avoid Planning jargon (taxonomy, reference data, operational, execution).
- Purpose over type: "Launch Calendar" not "Calendar 1".
- Specific over generic: "Q1 EMEA Roadmap" not "Timeline".

### Multi-workspace architecture (the central taxonomy hub pattern)
For mid-to-large customers, default to a multi-workspace design:
- One hub workspace dedicated to shared reference data (Countries, Channels, Regions, Quarters, Personas, Products, etc.).
- Domain workspaces (Marketing, Events, Social, OKRs) consume taxonomies from the hub via cross-workspace linking.
- Set hub record types with `linkableWithAllWorkspaces: true` when truly universal, or with `linkableWithWorkspaceIds: [list]` for targeted sharing (e.g., Pillars linked only to the 5 workspaces that need it).
- Combine `linkableWithAllWorkspaces` with `isGlobal: true` only when broadcasting everywhere is the deliberate intent (e.g., KPIs).

This avoids duplicating reference data across workspaces and prevents drift.

## Record types

### When to create a record type vs a field
**Record type when the concept:**
- Has its own attributes beyond just a name.
- Is reusable across multiple parent record types.
- Needs relationship tracking.
- Is emphasized in the user's language ("we manage channels", "regions play a big role").

**Field when the concept:**
- Is a simple classification or label.
- Has fixed values with no data of its own.
- Is only used for filtering or categorization.
- Is mentioned as an attribute ("campaign priority", "tactic status").

### Two categories of record types

**Work / Activity types** (lifecycle, work happens on them):
- Keep the default fields: Name, Description, Start Date, End Date, Status.
- Add 3 to 5 workflow fields: Owner, Priority, Budget, Region, domain-specific.
- Status and Dates represent the lifecycle. Always keep them.
- Example: Campaigns, Channel Tactics, Experiences, Events, Enterprise Goals, Media Engagements.

**Reference types** (static lookup data, no lifecycle):
- Keep only: Name, Description.
- **Delete** Start Date, End Date, Status. Reference data has no lifecycle.
- Add classification fields: Type, Tier, Category, domain attributes.
- Example: Countries, Channels, Regions, Languages, Platforms, Quarters, Personas, Products.

**Defensible exceptions to the lifecycle-deletion rule:**
- Quarters can keep Start Date / End Date because the dates encode the quarter's span, not a lifecycle.
- Brands, Speakers, Event Locations can keep Status if the customer needs active vs decommissioned tracking. Make this a deliberate decision, not an accident of default fields.
- If a "reference" type has Status + Start Date + End Date, suspect it is actually a work/activity type misclassified. Pillars in the Fréscopa template is the canonical example.

### Record type defaults
- Auto-created fields on a new record type: Name, Description, Start Date, End Date, Status.
- The **primary field** must be text or number and cannot be changed after creation. Choose deliberately.
- Default fields can be renamed or customized but not deleted (Status field is undeletable, only hideable or customizable).

## Fields

### Field types available
Single-line text, Paragraph, Single-select, Multi-select, Date, Number, Percentage, Currency, Checkbox, Formula, People, plus system fields (Created by, Created date, Last modified by, Last modified date, Approved by, Approved date, Record ID).

Reference and Lookup are also field types, materialized through connections (see Connections section).

### Field rules
- Fields do not transfer between record types. Use lookups to surface data from connected records.
- Up to 500 fields per record type.
- Up to 20 paragraph fields per record type, 10,000 chars each.
- Up to 20 formula fields per record type, 50,000 chars per expression.
- Up to 30 connection fields per record type.
- Before creating or updating records via MCP, read the record type's field value schema (`schema://record-type/{recordTypeId}`) to learn the exact format for each field.

### Field value formats (MCP / API surface)
- Number, Percentage, Currency precision: 0 to 4 decimals (MCP authoritative). Public docs say up to 6; trust MCP for API behavior.
- Percentage values stored as decimals (0.75 = 75%).
- Currency codes: ISO 4217 (USD, EUR, GBP).
- Date values: ISO 8601 with mandatory Z timezone.
- People field values: `[{id: "userId"}]` arrays, not name strings. User IDs are Adobe IMS IDs, not Workfront userIds.
- Single-select and multi-select options support 20 named colors (light-blue, dark-blue, light-cyan, ..., dark-gray) or hex codes.

### Formula fields
Before creating any formula field, read `references/mcp/formula-documentation.txt`. Use exact existing field display names (case and spacing) inside `{}` in formulas. If a referenced field does not exist, create it first.

Supported function families (~50 functions total):
- Date/time: ADDDAYS, ADDWEEKDAYS, ADDMONTHS, ADDYEARS, CLEARTIME, DATE, DATEDIFF, DAYOFMONTH, DAYOFWEEK, DAYSINMONTH, DAYSINSPLITWEEK, DAYSINYEAR, DMAX, DMIN, HOUR, MINUTE, MONTH, SECOND, WEEKDAYDIFF, WORKMINUTESDIFF, YEAR, SETTIMEZONE, WEEKOFYEAR.
- Math: ABS, AVERAGE, CEIL, DIV, FLOOR, LN, LOG, MAX, MIN, NUMBER, POWER, PROD, ROUND, SORTASCNUM, SORTDESCNUM, SQRT, SUB, SUM.
- Text/Logic: ARRAY, ARRAYCONTAINS, ARRAYLENGTH, ARRAYELEMENT, CASE, CONCAT, CONTAINS, ENCODEURL, IF, IFIN, IN, ISBLANK, LEFT, LEN, LOWER, PASCAL, REMOVEACCENTS, REPLACE, REPLACEPATTERN, RIGHT, SEARCH, SORTASCSTRING, SORTDESCSTRING, STRING, SUBSTR, TRIM, UPPER.
- Planning-specific: ARRAYJOIN, ARRAYUNIQUE, ID, JSONELEMENT, SETTIMEZONE, WEEKOFYEAR.

Unsupported: ADDHOUR, SWITCH, FORMAT, SORTASCARRAY, SORTDESCARRAY.

CASE is supported despite being absent from public docs.

## Connections

Create all meaningful connections upfront. Do not ask permission for each one.

### Parent-child connections (one-to-many, bidirectional)
Examples: Campaign > Tactic, Launch > Feature, Event > Session.
- Create the reference field on the CHILD record type pointing to the parent.
- Provide `backField` with a `displayName` to create the bidirectional link.
- Example:
  ```
  referenceOptions: {
    recordTypeId: "<Campaign Rt ID>",
    multiple: false,
    backField: { displayName: "Campaign Tactics" }
  }
  ```
- This automatically creates a "Campaign Tactics" field on Campaign that links back. The back-field's `multiple` defaults to `true`.

### Work-to-reference connections (many-to-many, unidirectional)
Examples: Campaign > Region, Campaign > Audience, Launch > Product Line.
- The reference field lives on the work item, not on the reference type.
- Omit `backField`. Unidirectional links keep reference types clean.
- Many-to-many is typical and correct: many campaigns can use the same audience.

### Lookup fields on connections
**Always** create lookup fields on connections. This is the difference between a workspace that feels useful and one that requires manual cross-referencing.
- Count fields: "Number of Tactics", "Number of Sessions".
- Rollup fields: "Total Tactic Budget", "Total Session Duration".
- Key attributes from the connected record: status, owner, dates, classification.

Target ratio: roughly 1 lookup per reference. The Fréscopa Campaigns record type has 8 references and 8 lookups, which is the model.

### Connection rules
- The target record type must differ from the source (no self-references).
- Default to sensible cardinality; do not over-ask.
- External connections (Workfront, AEM, GenStudio Brand) use `isExternal: true` on `referenceOptions`. Object type codes for Workfront: PROJ, TASK, PORT, PROG, COMP, GROUP.
- Connection field cap per record type: 30.

### Sizing risk: 500-connected-records cap
Multi-select non-hierarchy connections cap at 500 records connected to one record. If a customer's projected volume per parent exceeds this, the design is wrong, not the limit. Reframe as architecture before granting any exception, even at lower projected volume. Detail: see `references/customer-conversation-framings.md`.

### Hierarchy as a connection layer
For deep parent-child structures, use hierarchies (4 record types max per hierarchy, 5 hierarchies per workspace). Inside a hierarchy, the parent-per-child cap drops from 500 to 10. If a roadmap may extend a hierarchy past 4 levels, leave headroom: build at 3 levels and use non-hierarchy connections for the next layer.

## Views

Create 2 to 3 meaningful views for each work / activity record type on first build. Reference types need only the default Table view.

### Default Table view
- Every record type comes with a default Table view.
- Customize it: rename it, add filters, grouping, sorting. Do not leave it generic.

### Table views
Best for workflow states, focused subsets, day-to-day management.
- Always configure: Filters (Status, Owner, Region), Grouping (relevant dimension), Sort (priority or date).
- Example names: "Active Campaigns - In Market Now", "High Priority - Q1 Focus", "My Upcoming Launches".

### Timeline views
Best for work over time, spotting overlaps and gaps, parent-child breakdown.
- **Requires 2 Date fields** (Start Date + End Date).
- Always configure: Grouping (Region, Market, Owner), Breakdown (child record types if applicable), Date range.
- Breakdown requires the child record type to also have date fields.
- Only one breakdown at a time.
- Up to 5 connected record types shown.
- Example names: "Q1 EMEA Campaign Roadmap", "2024 Product Launch Schedule".

### Calendar views
Best for daily / weekly scheduling, time-specific moments.
- **Requires 2 Date fields** (Start Date + End Date).
- Filters only. No grouping, no sorting.
- Example names: "Campaign Activation Calendar", "Social Content Schedule".

### Field visibility in views
- Newly created fields auto-show in all existing views.
- When adding fields after views exist, verify they appear where expected; use `update_view` to adjust column visibility.

### Views cap
100 views per record type per user.

## Sample records

Populate a new workspace with 3 to 5 records per record type using realistic values.
- Domain-appropriate names, dates, statuses, budgets, priorities.
- Start dates near the current date for versatility.
- Meaningful end dates based on expected duration.
- Fill all custom fields.
- Create connections between related sample records.
- Read the record type schema (`schema://record-type/{recordTypeId}`) before writing records to ensure correct value formats.

`bulk_record_actions` is NOT atomic. Always check `hasErrors` on the response.

## Business rules

Consider whether 1 or 2 rules would enforce useful invariants:
- "Campaign Status cannot move to Complete unless End Date is in the past."
- "Tactic Budget cannot exceed Campaign Total Budget minus other allocated Tactics."

Do not skip business rules just because they are easy to defer. Even simple rules make the workspace feel mature.

## Build order and execution discipline

A workspace is only useful when fully built. An empty workspace with just sections has zero value. Never stop after creating the shell. Never communicate interim steps mid-build. Execute end-to-end, then present.

Follow this sequence strictly:

**Step 0: Plan.** Define all planned record types first (work / activity plus reference). Assign each to one specific section. Create sections only from this mapping.

**Step 1: Create the workspace** with sections derived from Step 0.

**Step 2: Create all mapped record types** in their assigned sections.

**Step 3: For EACH record type, complete in order before moving to the next:**
- a. Fields beyond defaults.
- b. Connections to related record types. Always add lookup fields (counts, rollups, key attributes) on connections.
- c. Sample records: 3 to 5 per record type with realistic values.
- d. Views: 2 to 3 configured views for work types (default Table only for reference types).

**Step 4: Move to the next record type and repeat Step 3.**

**Step 5: Explain** what was created (only after Steps 0 to 4 are complete).
- Start with the story: how the workspace is organized and why.
- Show the structure: sections, record types, key fields, connections.
- Connect the dots: how pieces work together.
- Provide orientation for first-time users.

**Critical:** complete Steps 0 to 4 fully for ALL record types before responding. Do not stop mid-build to narrate, summarize, or preview. The user's first view of the workspace should be the finished product, not a progress report.

## Error handling

If a tool call fails, try to fix and retry once. If it fails again, explain clearly and suggest alternatives. Never treat errors as endpoints; continue building the rest and address the failed step afterward.

## Output constraints

When referencing created objects, render clickable markdown links using the display name. Never output raw URLs or technical IDs.

Link formats:
- Workspace: `[Name]({base_url}/maestro/workspaces/{workspaceId})`
- Record type: `[Name]({base_url}/maestro/{workspaceId}/{recordTypeId}/default-view/view)`
- View: `[Name]({base_url}/maestro/{workspaceId}/{recordTypeId}/{viewId}/view)`

Only workspace links use `/workspaces/` in the path.

Never include in responses:
- Technical IDs (record IDs, field IDs, internal references).
- Implementation details (API calls, tool names, system operations).
- Database terminology (cardinality, schema, entities).
- Technical prefixes ("Lookup:", "Rollup:", "Connection ID:").

Convert ALL_CAPS enum values to lowercase readable text (ADMINISTRATOR becomes Manage, FIT_CONTENT becomes fit content).

## Common pitfalls

- Timeline or Calendar without dates: both require Start Date and End Date.
- Breakdown without dates on child type: the child record type needs date fields too.
- Cannot change the primary field type after creation.
- Cannot delete the default Status field; customize or hide it instead.
- Fields cannot move between record types; use lookups instead.
- Multiple timeline breakdowns: only one at a time.
- IMS userId vs Workfront userId mixup in integrations: Planning returns IMS IDs.
- `bulk_record_actions` partial success: always check `hasErrors`.
- 500-connection cap on multi-select non-hierarchy connections: the architecture is wrong, not the limit.
- 4-level hierarchy ceiling: leave headroom if the roadmap may extend.
