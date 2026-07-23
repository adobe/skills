# Create a Canvas Dashboard and add reports

Source: https://experienceleague.adobe.com/en/docs/workfront/using/reporting/canvas-dashboards/create-dashboards/create-dashboards
Last update: April 1, 2026

Also covers the parallel KPI and Chart report types (cross-referenced from `build-table-report.md`).

## Access requirements
- Workfront package: any.
- Workfront license: Standard (new) or Plan (legacy).
- Access level: Edit access to Reports, Dashboards, and Calendars.

## Prerequisite layout-template gate
**Canvas Dashboards must be enabled on the layout template's Dashboards left-nav item.** If users don't see "Canvas Dashboards" in the left panel under Dashboards, the admin needs to enable it on their assigned layout template. This is the #1 "I don't see it" troubleshoot.

## Dashboard creation fields
- **Name**: UTF-8 characters recommended (non-UTF-8 may have compatibility issues).
- **Description** (optional).
- **Currency**: default for the dashboard. Viewers can toggle between currencies via dashboard filter (multi-currency support is built-in).

## Three report-build types
- **KPI**: a single number (count, sum, average, distinct count, etc.).
- **Chart**: bar, column, line, or pie.
- **Table**: rows + columns (see `build-table-report.md` for the canonical pattern).

All three share the same field-selector and filter mechanics — the base entity (Workfront Object vs Planning Record Type) and the Sections drop-down behave identically across report types.

## Adding an existing legacy Workfront report
Canvas Dashboards can host imports of legacy Workfront reports. These come over with their original filters and grouping. Useful for incremental migration from legacy dashboards to Canvas.

## SA notes
- **The layout-template gate is the most common silent blocker for customers.** A user has the right license, right access level, and is enrolled in the beta — but the layout template doesn't include Canvas Dashboards in the Dashboards page navigation. Result: they don't see the option. Always check layout template assignment when troubleshooting "I can't find Canvas Dashboards."
- **Currency toggle at dashboard level** is uniquely valuable for global customers. Customers running operations across multiple currencies who today export-to-Excel-and-convert can do this natively.
- **Existing-report imports** are a strategic migration path: customers don't need to rebuild every legacy report from scratch. Sell this as the "we don't have to throw away two years of report-building work" angle.
- **KPI reports for Planning** are the unsung hero. Counting "campaigns by status" or "products by brand" gives leaders the executive-level "are we on track?" view that legacy Workfront has historically required custom forms + reports + math fields to produce.
- **Chart drilldown configuration** (per the overview) means a chart slice can deep-link to the underlying records list. Combine with a Planning record type as base entity → click a bar in the chart → see the underlying records. This was previously impossible in Workfront without a third-party BI tool.
- For multi-tenant agencies or service providers running multiple brand workspaces, Canvas Dashboards are NOT a great fit (yet) — there's no cross-tenant aggregation, and viewer permissions filter per-record. Each tenant needs its own dashboard. Surface this if asked.
