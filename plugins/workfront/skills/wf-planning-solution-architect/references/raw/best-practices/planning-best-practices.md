# Adobe Workfront Planning implementation recommendations (FAQ-style best practices)

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-general-information/planning-best-practices
Last update: Fri Feb 20 2026

This is the FAQ-style best practices reference (separate from the formal best-practices section).

## Workspaces

### How to start
- Follow in-app onboarding first.
- Explore predefined templates.
- Identify the main use case (e.g., "Campaign Calendar"): WHO asks, WHAT do they call it, WHAT questions do they want to answer?
- Consider non-Workfront planners (Excel, Word, PowerPoint users) — how will they access information?
- Replace WF Portfolios and Programs use for strategic representation with custom record types in WFP.

### When to create new vs modify existing
- ✅ Design for the lowest volume of org-level workspaces.
- ✅ Single workspace for all of Marketing is the recommended target.
- ✅ New workspace OK when operational structure is completely different (e.g., Product Development vs Marketing).
- ⛔ Don't create unique workspaces per team or per process within an org.
- ⛔ Don't duplicate workspaces for teams with similar processes (e.g., EMEA Marketing vs APAC Marketing).

### How to use Workspace sections
- Create and label to reflect operational lifecycle (e.g., "Core records" section for Campaigns/Tactics/Deliverables).
- Group like record types (e.g., "Geographies" section for Region/Country/City).

## Record types

### Defining record types
- ✅ Time spent identifying what to track and how it connects pays off.
- ⛔ Don't duplicate record types per time period (e.g., "Campaigns 2024" + "Campaigns 2025"). One record type per kind of work, segment with filters.

### Single/multi-select field vs linked record type
- ✅ Make it a record type if the object connects to multiple other record types.
- ✅ Make it a record type if you need to store additional metadata for lookups.
- ⛔ Don't make it a record type if the data is only relevant to one single record type. Use a field.

### Labeling
- ✅ Record types = nouns/single construct (e.g., "Campaigns").
- ⛔ Don't make a record type that's actually a view (e.g., "Calendar" is a view, not a record type).

## Fields

### Primary field
- ✅ Use unique primary field values — when connecting, users search by primary field. Non-unique → can't tell records apart.

### Formulas
- ✅ Reduce manual input. Auto-calculate based on data already in table view.

### URLs
- ✅ Use Single-line text for URLs.

### Hide vs delete
- ✅ HIDE a column instead of deleting if the info is relevant to someone else. Deleting in one view deletes everywhere.

## Views

### Filters and groupings
- Use filters and groupings to create snapshots.
- Example: Campaign timeline grouped by Target Audiences, filtered by current year.

### Timeline view requires 2 date fields
- Some records won't display if Start or End are empty, or Start > End.

### Timeline settings (bar style, color)
- Bar style: thumbnails, additional fields (Owner, Status).
- Color by field value OR by grouping. Default: record type color.
- Only record type colors OR fields with color-coded options can drive bar colors.

## Permissions

### Workspaces
- New workspace is creator-only by default.
- Manage = full admin access (edit/delete/share workspace + record types, create/edit/delete records). Requires Standard license.
- Contribute = create/edit/delete records, no structure changes. Requires Standard license.
- View = read only.
- ✅ Restrict Manage to a small trusted group — they can delete record types and create unnecessary structure.

### Record types
- Workspace Manage perm cannot be lowered on record types — it's always inherited as Manage.
- To give View on a record type while contributing to others: give workspace Contribute, then View on the specific record type.
- Removing record type perms preserves workspace View access.

### Views
- Manage on view = edit/delete/share/change filters/groupings. Changes affect the view for everyone using it. Requires Standard license.
- View on view = apply view, but changes are temporary, reset on refresh.
- "Everyone in the workspace can view" = saves manual share.
- Unshared view link → user sees Default Table View. Standard users can build their own view if nothing was shared.

### How license types interact
- Light/Contributor: workspace View only.
- Standard: needed for any Contribute/Manage on workspace or view.
- Standard required to CREATE views.

### Workspace ownership
- WFP sets creator as owner; functionally same as any Manage user.
- Owner deactivation: workspace continues without disruption.
- Sysadmins can add a new Manage user if the owner was the only one.

## Request forms

### When to create
- ✅ Build forms AFTER record type structure is finalized — easier than redoing.

### Who can create
- Any user with Manage on workspace.

### Who can submit (internal options)
- Anyone with view or higher access to the workspace
- Anyone with contribute or higher access to the workspace
- Only invited people can access (specify users/teams/roles/groups/companies)

### Public form sharing
- Create a public link, copy and share with anyone.
- Set expiration date for security.

### Form management best practices
- Plan ahead: define required information before creating.
- Use clear labels.
- Test via the form link before rollout.
- Periodic review.

## SA notes
- "Single workspace for all of Marketing" is Adobe's stated ideal — runs counter to instinct for federated organizations. Important framing for customer conversations about workspace count.
- Color-on-record-type is the only auto-coloring mechanism — for status-color displays, build a single-select field with color options.
- Owner deactivation handling is gentler than expected — confirm with customer admin teams to remove fear about "what happens if our creator leaves."
