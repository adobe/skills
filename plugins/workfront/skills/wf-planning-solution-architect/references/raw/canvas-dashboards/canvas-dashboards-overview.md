# Canvas Dashboards overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/reporting/canvas-dashboards/canvas-dashboards-overview
Last update: April 1, 2026

**STATUS: BETA.** Required reading for any customer who wants to "report on Workfront Planning data" — Canvas Dashboards is the ONLY documented Workfront-native path for this.

## What it is
A new dashboard surface (separate from legacy Workfront dashboards) for visualizing both Workfront Workflow data AND Workfront Planning record data on a flexible drag/drop canvas with KPI, chart, table, and existing-report widgets.

## Prerequisites
- Org must enroll in the Canvas Dashboards beta.
- License: Plan (legacy licenses) or Standard (new licenses). NOT a free feature for Light/Contribute users.
- Edit access to dashboards at the access level (Workfront admin grant).
- **NOT available on these cloud providers**: Amazon Web Services Bring Your Own Key, Azure, Google Cloud Platform. Coming later.

## Beta enrollment
Self-serve: any Workfront admin can click "Join the Canvas Dashboards beta" → agree to beta terms → enrolled. Takes a few minutes for data to become accessible.

## Report types
- **KPI**: single number (count, sum, average, etc.).
- **Chart**: bar, column, line, or pie.
- **Table**: rows + columns with optional grouping.
- **Existing report**: import a legacy Workfront report onto the canvas.

## Workfront Planning data access pattern
When building a report, the "base entity object" picker has two top-level options:
- **Workfront Objects**: native Workflow objects (Projects, Tasks, Issues, Programs, Portfolios, etc.).
- **Planning Record Types**: any record type in any workspace the user has access to.

Once a base entity is selected, the Sections picker scopes available fields:
- All Sections: native + custom + relationships.
- All Fields: native + custom (NO relationships).
- Custom Fields: customer-defined fields on custom forms OR Planning records.
- Workfront Fields: native fields only.
- Relationships: connected records (limited to higher-hierarchy objects or single-selection relationships).

## Currently shipping features (this beta wave)
- Versatile layout configuration.
- Dashboard sharing.
- Pending approval reports.
- **Workfront Planning reports.**
- AND/OR filtering.
- Conditional formatting of table columns/rows.
- Drilldown configuration for KPI and Chart reports.
- Grouping in table results.
- Dashboard-level filters + user-applied overlay filters.
- Run-as-user configuration on reports.

## In development
- Additional Workfront object types as base entities.
- Usability enhancements.
- Include Workfront Planning VIEWS as report blocks (i.e., embed a Planning timeline/calendar inside a dashboard).
- Use a dashboard AS a Planning view.
- Azure and GCP customer support.
- Performance optimization.

## Roadmap (priorities subject to change)
Embedded web views; Calendars; Resource management reports; Additional Home widgets; Dashboard summary email/digests; Copy reports; Copy dashboards.

## Financial data caveat
- Users with View or Edit access to Financial Data in their access level WILL see financial data in Canvas Dashboards, even when project-level "View finance" permission has been removed.
- This is a known beta limitation. Report creators must be cautious about including financials in shared dashboards.
- Users without access-level financial rights see no financial data in any report.

## SA notes
- **Canvas Dashboards is the strategic reporting surface for WFP.** Legacy Workfront reports do NOT support Planning record types as base entities. Customers who want to report on Planning data have no other Workfront-native option. Lead with this in any "how do I report on my campaigns/personas/products?" conversation.
- **Beta status is a real risk for production rollouts.** Counsel customers to use Canvas Dashboards for exploratory/internal reporting now, and to plan production reporting investments AFTER GA. Some customers want to wait — that's reasonable.
- **License tier is the most common blocker.** Light and Contribute users CANNOT use Canvas Dashboards at all (even to view? — overview says "create or edit"; viewing is typically less gated, confirm with customer specifics). For visibility into shared dashboards by Contribute users, build dashboards that allow read-only sharing.
- **Cloud-provider exclusion list matters.** Customers on AWS BYOK, Azure, or GCP are EXCLUDED from the beta. This is a hard "no" until additional support ships. Check tenant cloud topology before recommending.
- **"Run as User" capability for reports** is the security gotcha most customers miss. It lets dashboard creators query data the viewer wouldn't otherwise see. Treat dashboards built with "Run as User" as potential data-leak surfaces and review sharing carefully.
- **Financial data leakage in beta** is the most concerning known issue. For any customer with sensitive financials, advise either restricting access-level financial rights tightly OR not putting financial fields on shared dashboards.
- **Embedded Planning views as dashboard blocks** (in development) will be the killer feature when it ships — allows native Planning timeline/calendar inside an exec dashboard. Worth promising customers in roadmap conversations.
- **Conditional formatting on table cells** is one of the highest-frequency customer asks in legacy Workfront reports — this is a notable Canvas-only improvement that has historically required external tools like Power BI.
- **AND/OR filter composition** matches the API search modifier syntax (`$and`/`$or`) — the UI is a friendlier surface for the same underlying capability documented in `api/api-basics.md`.
- The roadmap's "Sending dashboard summaries" item is what many customers ask for as "scheduled email reports." It's NOT yet available.
- **Drilldown configuration for KPI/Chart** is the way to make a single number on a dashboard click through to the underlying records — a customer-visible polish detail worth demonstrating in EBR scenarios.
