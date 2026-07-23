# Build the bridge: connecting strategic intent to projects

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-best-practices/the-bridge-connect-strategy-with-projects
Last update: April 1, 2026

Requires Planning Prime or higher.

## Core thesis
A connection field is the "technical handshake" between WFP record types and Workfront objects. Establish these connections BEFORE work is created.

## Two layers
- **WFP (strategic layer)**: Campaigns, Tactics, Budget. High-level, noise-free, executive-ready.
- **Workfront (execution layer)**: Individual experiences as projects, tasks, issues. Ownership, approvals, granular work.

## Activating the bridge (table-led path)

### Manual activation
- From the connection field in WFP, or from the optional Connections page on a record's detail view.
- Creates a blank project — NO custom forms applied.
- Reference: connect-records article.

### Native WFP automation
- Buttons appear in the actions bar when a row is selected in a table.
- Allows human oversight or placeholder creation.
- Reference: create-wf-objects-using-planning-automations.

## Activating the bridge (automated path)

Requires **Adobe Workfront Fusion license**.

### Submission triggers
- Request form submission triggers a Fusion scenario.
- Scenario generates the linked Workfront project automatically.

### Field-value triggers
- Monitor specific fields.
- E.g., a "Ready for execution" checkbox flip triggers the bridge.

## Lookup fields for visibility
- Pull any system or custom field from the linked Workfront project into the WFP record.
- Example: Actual Completion Date, Creative Lead.
- Captured data can roll up through hierarchy levels (e.g., up to Campaign).
- Reduces context switching — strategists stay in Planning, see execution status live.

## Strategic questions WFP can answer post-bridge
- Is the FY26 Brand Awareness campaign actively delivering?
- Where do tactics need more creative support to stay on schedule?
- Are resources aligned to top strategic pillars?

## Dos
- "Strategic thread" metaphor — every project is a bead on a string.
- Automate the handoff — trigger project creation for governance and speed.
- Link, don't duplicate. Use lookup fields for execution data.

## Don'ts
- Don't treat Planning records as task lists.
- Don't over-sync project-level detail back to Planning.
- Don't bypass the bridge — work created in Workfront without a Planning link becomes "shadow plan" invisible to leadership.

## SA notes
- Three escalating activation patterns: manual → native automation → Fusion automation. Pick based on volume and governance needs.
- Native automation creates blank Workfront projects (no custom forms). For form-attached projects with proper governance, you need Fusion.
- Lookup fields rolling up through hierarchy is the killer feature for executive reporting. Don't skimp on configuring lookups — but watch the 500-field-per-record-type limit when rolling up many fields.
