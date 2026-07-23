# Adobe Workfront Planning AI Assistant overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-ai-assistant-overview
Last update: January 23, 2026

## What it is
A natural-language interface to Workfront Planning. Read, create, update, delete records via prompts. Page-context-aware. Distinct from Workfront AI Assistant (broader Workfront product) but accessed from the same icon.

## Access requirements
- Workfront package: any Workfront/Planning or Workflow/Planning package.
- Workfront license: Standard.
- Object permissions: Manage on the workspace. Sysadmins have implicit Manage on all workspaces.
- Org prereqs: signed Adobe Gen AI agreement, Adobe IMS migration complete, Adobe Unified Experience enabled. Workfront plan must be Select, Prime, or Ultimate.
- Sysadmin must turn on AI Assistant for individual users via access levels.

## Available pages
- Workspace page
- Record type page
- Record page (Details / preview)

NOT available on: Planning home, settings, requests builder, view configuration screens.

## Available actions
- Search records (any field).
- Create records (returns ID + link).
- Create records from uploaded document (supported formats: PPTX, PDF, DOCX, XLSX, PPT, DOC, TXT, most image formats).
- Update fields on records visible on screen.
- Delete records.
- Restore records just deleted (single-step undo for delete only).

## Behavioral rules
- All actions execute under the user's WFP permissions + Workfront access level. No permission escalation possible.
- Changes are tracked in the record's history panel.
- AI Assistant DISPLAYS the intended actions and asks for confirmation before executing create/update/delete.
- Many actions are PERMANENT and IRREVERSIBLE (e.g., deleting a field — though field deletion is not in the action list above, it is mentioned as an irreversible example, suggesting some structural changes are reachable in adjacent flows).

## Entry points
- Main nav bar, upper-right.
- Record preview panel or record Details page, upper-right.

## Prompt-keyword discipline (system-wide AI Assistant)
Per the parent AI Assistant doc, prefix prompts with `using (keyword)`:
- `workfront` — interacts with Workfront core (projects, tasks, issues).
- `planning` — interacts with Workfront Planning. ONLY available from Planning pages.
- `help` — pulls from Experience League documentation.
- `formula` — formula generation. ONLY available in Planning, Setup, and Custom form builder. Requires Prime or Ultimate plan.
- `health` — Project Health Advisor.
- `summarize` — file/project/document summarization.

## Object types accessible to AI Assistant (org-wide)
Portfolios, Programs, Projects, Tasks, Issues, Custom forms, Users, **Workfront Planning records**. Always subject to per-user permissions.

## SA notes
- **Planning AI Assistant vs Planning Designer (beta) — two different surfaces.** AI Assistant operates in the context of an open page (workspace/record type/record) and is generally available. Planning Designer is the dedicated structural-design surface (still beta as of April 2026 per the Designer doc) and is the ONLY one that supports creating records from an imported document like an org chart image. See `general/planning-ai-designer.md` for Designer specifics.
- **AI Assistant for Planning was temporarily pulled in late 2024 and re-enabled later** (per release notes). Customers asking "why was it gone" should be told this directly — it was a quality pause, not a strategy reversal.
- **Confirmation gate is on create/update/delete, NOT on search.** Search is fully autonomous.
- **Single-step delete-restore.** If the user deletes records then runs any other prompt, the restore window closes. Educate users.
- **AI Assistant respects permissions, but does NOT respect record-level filtering on top of workspace-level permissions in views.** If a user has Manage on a workspace but a shared view scopes their visible records, AI Assistant can still touch the broader set. RLP changes this calculus — once Record-Level Permissions ships, this boundary tightens.
- **Document upload as a record source is powerful for onboarding but error-prone for live ops.** A 50-slide PPTX uploaded to seed records will create 50 records with field values inferred from each slide. Customers who don't want that should be steered toward template-based imports.
- **The "Adobe Gen AI agreement" is a hard org-level gate.** If a customer's legal team has not signed it, no version of AI Assistant works. Confirm gate status before troubleshooting "it doesn't work."
- **`formula` keyword requires Prime or Ultimate.** Select customers cannot use AI-assisted formula generation. Highlight this if a customer on Select asks "why doesn't formula generation work for me."
- **English only.** Non-English instances cannot use AI Assistant productively. Confirm with multilingual customers.
- For Planning customers piloting AI workflows, the right rollout sequence is: (1) confirm Gen AI agreement signed, (2) enable Sysadmin access, (3) enable Sysadmin → Standard users with workspace-Manage permission in pilot workspaces, (4) train on confirmation behavior and the delete-restore window, (5) broader rollout. Skipping step 4 produces support tickets.
