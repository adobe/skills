# Connect record types

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/connect-record-types
Last update: Thu Feb 26 2026

## Access requirements
- Same workspace: Any Workfront + any Planning, OR any Workflow + any Planning
- Different workspaces: Any Workfront + any Planning, OR any Workflow + Planning Prime/Ultimate
- AEM Assets connection: needs AEM Assets license AND AEM-Workfront integration
- GenStudio Brand connection: needs GenStudio for Performance Marketing license
- License: Standard
- Permissions: Manage on workspace

## Connection setup options

When you create a New connection from a record type, the picker options are:

### From the same workspace
- A record type from the current workspace

### From other workspaces
- Only if target record type has "Allow connecting to this record type in other workspaces" enabled (Cross-workspace settings tab)

### Workfront Object Types section
- Project, Portfolio, Program, Company, Group
- Original request (only if request forms exist)

### Adobe Applications section
- Experience Manager Assets
- GenStudio Brand

## Connection field properties

**Name**: shown as the column / field name. Default = name of target record/object. Multiple connections to the same target get numeric suffixes.

**Description**: appears on hover over the column.

**Allow multiple records**: shown when connecting cross-workspace, AEM assets, or GenStudio Brand. Default = enabled.

**Cardinality** (same-workspace OR record-to-Workfront):
- Without "Create corresponding field on linked record type" → Multi-select / Single-select
- With it enabled → Many-to-many / One-to-many / Many-to-one / One-to-one

## "Create corresponding field on linked record type"
- Disabled by default.
- When disabled, no field is created on the target.
- When enabled, a corresponding field is auto-named after the source record type.
- **Pre-requisite for hierarchies.**
- **Caveat**: 500-field limit per record type still applies. The doc explicitly warns to keep this OFF for taxonomy record types to avoid eating field budget.

## Workfront object connection filter
Custom form filter: "Link only objects that match these criteria" — only objects with selected custom forms attached can be linked.

## AEM Assets connection
- Required field: choose a repository.
- Only repositories the user has access to display.
- Admins can map WFP fields ↔ AEM Assets fields via Metadata mapping in Workfront.

## Record appearance options
For: WFP-to-WFP, AEM Assets, GenStudio Brand connections.
- Name and image (default)
- Name only
- Image only
- Records without thumbnail show the record type icon.
- NOT available for Workfront object types.
- Selection is global — applies in all views and record pages.

## Lookup fields

**Default**: "Select lookup fields" is enabled.

**Field type restrictions in Production**:
- Cannot add Workfront user fields as lookup (Project Owner, Project Sponsor, etc.) — available in Preview only
- Cannot add People fields as lookup — available in Preview only
- Date fields display in 24h format in WFP regardless of Workfront display setting

**Naming**: `<Field name on linked record> (from <Linked field name>)`. E.g., Campaign → Program lookup of Budget = `Budget (from Program information)`.

**Lookup field aggregators** (when multiple records linked):
- None: comma-separated list (default)
- MAX, MIN, SUM, AVG, UNIQUE
- NOT available for Paragraph, Checkbox aggregators in general
- UNIQUE not available for: Paragraph, Checkbox, People
- Aggregators NOT available for AEM Assets or GenStudio Brand connections
- **MUST select an aggregator on date lookup fields** to use them as Start/End in timeline/calendar views

### Aggregator example
Campaign → Products lookup of Budget. Linked: Product1=$100K, Product2=$110K, Product3=$100K.
- None: $100,000, $110,000, $100,000
- MAX: $110,000
- MIN: $100,000
- SUM: $310,000
- AVG: $103,333.33
- UNIQUE: $100,000, $110,000

## SA notes / warnings

- **Hard limit**: 30 connection fields per record type, 500 total fields per record type.
- Each "Create corresponding field on linked record type" uses a field on the target side too — burn through the 500 limit fast if you connect many sources to a taxonomy.
- Recommendation from docs: do NOT enable corresponding-field for taxonomy targets unless required for hierarchy.
- **Permission leakage**: View permission on workspace = view of all linked lookup data, irrespective of Workfront/AEM/GenStudio source-system permissions or other workspace permissions.
- Multi-value lookup fields with no aggregator: sorting uses first value; grouping uses unique combinations; timeline uses first date value.
- One-to-many and one-to-one connections: re-linking a record already linked elsewhere will REMOVE it from prior link (warning displayed).
- Cardinality is mostly irreversible (only one-to-one is freely reversible) — choose carefully.

## Editing post-creation
- Edit field (rename, change description)
- Edit lookup fields (add/remove)
- Delete linked record field also deletes all associated lookup fields
- Cannot add lookup fields from your record type to a target that is from another application (e.g., can't push Campaign Status as a lookup onto a Workfront project)
