# Workfront Planning + GenStudio for Performance Marketing integration overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/planning-and-genstudio-integration/get-started-with-workfront-planning-and-genstudio-integration
Last update: March 10, 2026

## What it is
A native bidirectional integration that exposes a "GenStudio workspace" inside Workfront Planning. GenStudio's marketing-domain objects (Campaigns, Products, Activations, Personas, Channels, Regions, Brands) become record types in Planning, fully editable on either side with real-time sync.

The integration's purpose: GenStudio's native object schema is shallow. Planning customers want richer, more bespoke campaign/persona/product attribute schemas. The integration lets them extend the GenStudio data model via Planning, without forking the data.

## Requirements (ALL must apply)
- Workfront AND GenStudio for Performance Marketing both licensed AND enabled to the same IMS organization.
- Workfront instance is on Adobe Unified Experience + IMS.
- Users active in both products must belong to a SINGLE Workfront instance within the IMS org.
- Workfront-only users (no GenStudio license) CAN view the GenStudio workspace in Planning.

## Access requirements
- Workfront/Planning or Workflow/Planning package.
- Workfront license: Standard (to edit).
- GenStudio role: Any role for Campaigns/Products/Personas. **System Manager** required for Activations.
- Planning workspace permissions:
  - Manage on GenStudio workspace → add fields/record types/views, edit GenStudio fields, share.
  - Contribute → add/update/delete records only.
- **You cannot remove GenStudio for Performance Marketing record types or fields from the GenStudio workspace.** Hard guardrail. (Strengthened in Q1 2026 release.)

## Permission defaults
- All GenStudio users with Workfront access automatically get Contribute on the GenStudio workspace.
- Workfront admins can grant Manage to anyone.
- **GenStudio user permissions on the GenStudio workspace cannot be removed.** Customers wanting to scope GenStudio user visibility tighter must do it on the GenStudio side.

## Multi-instance behavior
- Single Workfront instance: GenStudio workspace lives there.
- Multiple Workfront instances AT TIME OF GENSTUDIO PURCHASE: visible from all instances.
- Multiple Workfront instances ADDED LATER: visible only from the original integrated instance. Adding more requires account-team intervention.

## Standard GenStudio record types in the workspace
- Campaigns, Products, Personas, Activations, Channels, Regions, Brands.
- Each carries a "GenStudio" indicator badge.
- Channel and Region records show "System" as Created by (auto-created during workspace setup).
- New GenStudio records show the IMS user who created them, even if they're not a Workfront user.

## What you CAN do from Planning
- View all GenStudio records in real time.
- Edit any field on any GenStudio record. Changes sync to GenStudio.
- Add records (manually, CSV/Excel import, or via request form) → they appear in GenStudio.
- Delete records → removed from GenStudio. Land in Planning's Recently Deleted bin for 30 days.
- Restore deleted records from the bin → recreated in BOTH systems.
- Add Planning custom fields to GenStudio record types. Visible in Planning views AND in GenStudio record detail page (NOT in GenStudio list views).
- Hide fields in Planning table views (Contribute users too).
- Create new views (Contribute users included; sharing requires Manage).
- Create new (non-GenStudio) record types in the workspace — they exist only in Planning.
- Add request forms to GenStudio record types (+ approval gating).
- Configure automations on GenStudio record types.
- Connect GenStudio record types to: other GenStudio record types, Planning record types (same or cross-workspace), Workfront objects (projects/portfolios/programs/companies/groups), AEM Assets, GenStudio Brands.

## What you CAN'T do from Planning
- Create or delete Activation records (must be done in GenStudio).
- Delete GenStudio-native fields.
- Delete the default imported table view from GenStudio.
- Create multiple views in GenStudio itself (only in Planning).
- Remove GenStudio users from the GenStudio workspace or its record types.
- Share views from the GenStudio workspace (Contribute users; Manage users can share).

## Brand connections (special)
- Brand connection field added to Products and Personas record types by default (Q1 2026).
- Brand connections can be added manually to any other GenStudio record type OR any record type in any Planning workspace.

## Created by / Approved by
- Both fields can be added explicitly to GenStudio record types from Planning.
- Approved by populates when a request form with approval rule creates a record.
- Both display in GenStudio record details, NOT in GenStudio list view.

## Preview environment behavior
- GenStudio workspace appears in the Workfront Preview environment.
- Edits in Preview do NOT sync to GenStudio.
- GenStudio has no Preview environment of its own — only Production-to-Production sync is live.

## SA notes
- **The integration is the strongest argument for the Planning + GenStudio bundle.** Customers buying both should be told explicitly that without it, they'd be duplicating campaign/persona metadata across two systems.
- **"GenStudio users cannot be removed from the GenStudio workspace" is a one-way trust assumption.** Planning admins lose the ability to govern who sees what in this workspace. For customers with strict data segregation needs (e.g., agency arrangements where multiple brands share one IMS org), this can be a blocker. Q1 2026 strengthened the guardrails specifically because earlier behavior allowed accidental removal.
- **Adobe Gen AI agreement is NOT a prereq for this integration** (unlike AI Assistant). The two are independent.
- **Brand connection field default on Products/Personas changed in Q1 2026.** Customers who built their workspace before Q1 may not have it. Manually add if missing.
- **Activations are read-from-Planning only.** Any workflow that wants to programmatically create Activations must do so via GenStudio's own API, NOT Planning.
- **Multi-instance gotcha:** Once a customer is integrated, adding a new Workfront instance leaves it ISOLATED from the GenStudio workspace. This often surprises customers consolidating instances. Plan instance topology BEFORE turning on the GenStudio integration if possible.
- **Custom Planning fields on GenStudio record types don't show in GenStudio list views.** Customers extending the schema in Planning for the express purpose of richer GenStudio reports will be disappointed — they show only in GenStudio's record detail. Set this expectation up front.
- **"View" tier on GenStudio workspace is the read-only path for non-GenStudio Workfront users.** Excellent for surfacing campaign metadata to ops teams without buying GenStudio seats — highlight this in value conversations.
- **Preview environment changes don't sync.** Customers training new users in Preview will see "real-looking" changes that vanish on the GenStudio side. Make this explicit during onboarding.
- The integration relies on a shared IMS org and Unified Experience. Customers still on legacy Workfront with separate identity systems can NOT use this — flag this as part of any GenStudio sales conversation.
