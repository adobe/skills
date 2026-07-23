# Get started with the Adobe Workfront Planning Designer

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-ai-designer
Last update: April 1, 2026

Currently Closed Beta. Enrollment by email to sargism@adobe.com.

## What it does
AI-powered tool that configures workspaces and data structures via natural language prompts. Can create/update/delete workspaces, record types, fields, formulas, records, views, lookups, and read history.

## Prerequisites
- AI Assistant must be enabled at org level (requires Adobe Gen AI Agreement signed by admin).
- Admin must turn on AI Assistant for users.
- Workfront Planning Standard license + Manage on workspace.

## Designer vs AI Assistant
- Both perform the same Planning operations.
- ONLY Planning Designer supports: creating records by importing a document (e.g., org chart image).
- XLSX import via Designer is NOT for large-scale record import — use the manual table import path for that.

## How it works
- All actions in context of user's WFP permissions and access level.
- All changes tracked in record's history panel.
- Designer asks for confirmation only for IRREVERSIBLE actions (deleting a record type or workspace). Deleting a record alone is NOT confirmed.
- When creating workspaces/record types, views and fields are auto-created.

## Functionality available via prompt
- Create and configure workspaces.
- Create record types (including global types, adding global to workspaces).
- Design fields and formula fields.
- Create/delete/duplicate/restore records.
- Edit/update/append a field in a record.
- Link records to other records.
- Access record change history.
- Build custom views.
- Create records by importing a document (Designer only — not AI Assistant).

## Prompt examples (from docs)
- "Create and configure a workspace with five record types to manage campaigns"
- "Create marketing campaigns for every month of the current year"
- "Add a campaign field for Status for the Marketing Design workspace"
- "Delete all records in a Status of Stale"
- "Update all Planning campaigns to a status of Active"
- "Connect Campaigns to Personas in the Marketing Design workspace"
- "Display the change history for the 'Valentine's Day' campaign"
- "Build a timeline view for campaigns in the Marketing Design workspace"

## Entry points
- Planning page → "Create with AI" button
- Or Create workspace → use prompt at top
- For existing workspaces → "Edit with AI"

## Disabling Planning Designer org-wide
- Sysadmin → Setup → System → AI preferences → turn off "Planning Onboarding" → Save.

## SA notes
- Beta status — not a production-ready dependency. Consider for prototyping/exploration, not customer-facing rollouts yet.
- The "create from imported document" capability (e.g., upload an org chart image) is unique and powerful for discovery-phase architecture conversations.
- Confirmation only on workspace/type deletion is a footgun — bulk record edits via prompt (e.g., "delete all records in Status of Stale") happen without confirmation. Educate workspace managers.
- All AI actions still respect WFP permission boundaries — so no permission escalation risk.
