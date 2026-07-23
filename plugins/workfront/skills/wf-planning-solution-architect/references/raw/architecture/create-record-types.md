# Create record types

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/create-record-types
Last update: Thu Jan 15 2026

## Access requirements
- Package: Any Workfront + Planning, OR any Workflow + Planning
  - Connectable: any Workfront + any Planning, OR any Workflow + Planning Prime/Ultimate
  - Global: any Workfront + Planning Plus, OR any Workflow + Planning Prime/Ultimate
- License: Standard
- Permissions: Manage on workspace

## Creation paths
- Automatically:
  - When workspace created from a template
  - When imported via CSV/Excel (records and fields can also be imported)
- Manually:
  - From scratch
  - By adding global types from another workspace

## Constraints
- Can move record types within sections and between sections of one workspace.
- Cannot move record types between workspaces.

## Default operational record type fields
- Name, Description, Start Date, End Date, Status (shown in default table view).

## Cross-workspace settings (sysadmin only)
- Set on record type via Cross-workspace settings tab.
- Two flags: connectable (others can connect to it), global (can be added to others).
- Icons display on record type card: Connectable icon, Global record icon.

## Workflow notes for SA
- New record type defaults: gray color, file icon, "Untitled record type".
- After creation, opens in table view by default.
- Add fields via + icon top-right of table.
- Drag-drop reorders cards across sections within same workspace.
