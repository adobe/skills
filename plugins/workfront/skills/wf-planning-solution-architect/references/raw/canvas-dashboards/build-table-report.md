# Build a table report in a Canvas Dashboard

Source: https://experienceleague.adobe.com/en/docs/workfront/using/reporting/canvas-dashboards/add-reports/build-table-report
Last update: December 19, 2025

The Canvas Dashboard report type most relevant to Planning customers. Table reports are the closest equivalent to a legacy Workfront report and are the primary way to surface Planning records in a cross-Workfront context.

## Access requirements
- Workfront package: any.
- Workfront license: Standard (new) or Plan (legacy).
- Access level: Edit access to Reports, Dashboards, and Calendars.

## Report build structure
A table report has four configuration sections:

### 1. Details
Name + Description. Description shows as a tooltip on the dashboard widget.

### 2. Build table (columns)
- "Add column" repeatedly to add fields.
- Field picker is hierarchical: walk down the object graph (e.g., Document Approval > Approval Stage > Approval Stage Participants > Requester > Name).
- For Planning customers: base entity = "Planning Record Types" → select a record type → add its fields as columns.

### 3. Filter
- Conditions: field + operator + value.
- Multiple filter groups composable with AND/OR (operator between groups defaults to AND, toggleable).
- Same boolean semantics as the Planning API `$and`/`$or`.

### 4. Drilldown Group Settings
- "Add grouping" → select a field → row groups appear in the preview.
- Used for table grouping.

## Sections drop-down (field-selector scoping)
After picking a base entity, narrow available fields/relationships:
- **All Sections**: native + custom + relationships.
- **All Fields**: native + custom (NO relationships).
- **Custom Fields**: customer-defined fields on custom forms OR Planning records.
- **Workfront Fields**: native fields only.
- **Relationships**: connected records.

## Children-object reporting rules
Generally relationships are limited to parents-or-higher OR single-selection children. Documented exceptions where parent-to-child IS supported:
- Project → Tasks
- Document Approval → Document Approval Stages
- Document Approval Stages → Document Approval Stage Participants

When using parent-to-child, the table fans out: one row per child record connected to the parent.

## Notable lookups
- Document approval stage participants is truncated as "Approval Stage Pa…" in the picker — be precise when guiding customers through deep paths.
- Connected Planning records appear under the "Relationships" section once a Planning record type is the base entity.

## SA notes
- **The "base entity" choice is the single most important architectural decision in a Canvas report.** Once you pick Planning Record Type "Campaign," the report is "scoped to" Campaigns and fans out only at supported parent-to-child relationships. To report ACROSS multiple Planning record types side-by-side, you typically need multiple reports on the same dashboard, OR use Planning's own connection fields as the join.
- **Planning Record Types in the field selector is the magic feature.** This is what makes Canvas Dashboards the answer to "I want to report on my campaigns/personas/products." Lead with this when demoing.
- **The children-relationship limit (only parent → up, with three documented exceptions)** is the most surprising constraint when customers try to build "show me all tasks for each campaign in this workspace" style reports. The path is Project → Tasks for tasks, but joining Tasks to Planning records requires the inverse direction, which the report builder doesn't support natively. Workaround: filter by the Planning record connection at the project level.
- **Filter groups with AND/OR composition** is the closest Workfront UI to the Planning API filter syntax. For customers comfortable in one, the other is reachable.
- **Drilldown groupings** create visual hierarchy in the table; they don't pre-aggregate. The table still fans out per row. To aggregate (count/sum/avg), use KPI or Chart report types instead.
- **Financial data exposure** — same caveat as the overview. Be careful with any column path that exposes budget or cost fields if the dashboard will be widely shared.
- The example doc walks through a Document Approvals report. This is incidentally useful — it shows the deep child-object navigation pattern that Planning customers will also need for connected-record reporting.
