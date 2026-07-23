# Hierarchy and breadcrumb overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/hierarchy-and-breadcrumb-overview
Last update: April 1, 2026

Hierarchies are structured parent-child relationships between connected record types (and optionally a Workfront project at the leaf).

## Hard limits
- Max 5 hierarchies per workspace
- Max 4 record/object types per hierarchy
- Max 10 records of parent type connected to one record of a child type (inside a hierarchy)

## What can participate
- Record types in the workspace where the hierarchy is built
- Workfront projects — must be LAST in the hierarchy (cannot be a parent of another type)
- Global record types — ONLY if they're already added to the current workspace

## What CANNOT participate
- Record types from another workspace (even if connectable or global, unless first added to the current workspace)
- Workfront objects other than projects (no portfolios, programs, etc. as direct hierarchy members)
- AEM Assets / Content Fragments

## Pre-conditions
- Connection between the types must exist OR will be created when building the hierarchy.
- "Create corresponding field on linked record type" MUST be ON for participating connection fields.
- A record type that's part of a hierarchy CANNOT be deleted (must remove from hierarchy first).
- A connection field that's referenced in a hierarchy CANNOT be deleted (remove from hierarchy first).
- Lookup fields can still be deleted independently.

## Topology rules
- A record type has only **one parent** in a workspace (one Tactic can't have both Campaign AND Goal as parent in same workspace).
- A record type can be a parent in MULTIPLE hierarchies in the same workspace.
- A record can connect to multiple parents of the same type if cardinality permits (Tactic A can be in Campaign X and Campaign Y if one-to-many or many-to-many).
- A record type can have **only one child** per hierarchy (Campaign → Tactic, Tactic → Program, Program → Project — chain, not branch).
- A type cannot be parent in one hierarchy and child in another in the same workspace.
- Global types can appear in hierarchies in multiple workspaces independently.

## Breadcrumbs
- Generated automatically from hierarchies.
- Display in record preview area and on the record details page.
- If a record type is in multiple hierarchies, breadcrumbs can be switched.
- Breadcrumbs span Workfront ↔ Planning (e.g., on a Workfront project view, you can navigate up to connected Planning campaigns/tactics AND up to Workfront portfolios/programs).
- Edits to a record reflect in all workspaces/hierarchies it appears in.

## SA notes
- 5 hierarchies × 4 levels is the planning ceiling. Mature enterprises often need 6–8 levels of conceptual hierarchy — must collapse or use chained workspaces.
- "Create corresponding field" + hierarchy + 500 field limit → if you have a heavy taxonomy with many connections, your 500-field budget is at risk on the central record type.
- Workfront projects always terminate hierarchies. This is your "Planning ends, Workfront starts" demarcation.
- Don't accidentally make a child the parent in another hierarchy — that's blocked, and trying it gets confusing without clear messaging.
