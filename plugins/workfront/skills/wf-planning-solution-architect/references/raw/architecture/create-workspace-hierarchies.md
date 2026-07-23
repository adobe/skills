# Create workspace hierarchies

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/create-workspace-hierarchies
Last update: April 1, 2026

## Workflow
1. Open Workspace → Settings → Hierarchies section.
2. Click New hierarchy.
3. Add objects (up to 4):
   - First object must be a Planning record type.
   - Workfront projects can only be the LAST object.
   - Each subsequent object becomes the child of the previous.
4. For each pair, select an existing connection field OR create a new one.
5. New connection options inline:
   - Cardinality: many-to-many, one-to-many, many-to-one, one-to-one
   - Record appearance: name+image, name, image
6. Save. Save button is dimmed until all required connection fields exist.

## Required precondition
- The connection field MUST have "Create corresponding field on linked record type" enabled.
- If it's not, the system errors out and you have to:
  1. Cancel the hierarchy create.
  2. Open the parent record type's table view.
  3. Edit the connection field column header → enable "Create corresponding field on linked record type".
  4. Return to Settings → Hierarchies → New hierarchy and rebuild.

## Notes
- Connection field is NOT deleted when hierarchy is deleted.
- One record from a child type can connect to up to 10 records from a parent type.
- Edit options: Edit (modify), Delete (permanent).
- After hierarchy is built, breadcrumbs appear on record details pages of all participating types.

## SA notes
- Mass build hierarchies: easier to first set up all the connection fields with corresponding fields enabled, then chain them quickly in hierarchies.
- Plan field budget: enabling corresponding fields for hierarchy participation eats into the 500-field limit on the target type.
