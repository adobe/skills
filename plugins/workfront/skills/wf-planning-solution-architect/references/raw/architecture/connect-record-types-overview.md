# Connected record types overview

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-architecture/connect-record-types-overview
Last update: May 8, 2026

## Key limits
- Up to 30 connected fields per record type.

## What you can connect

Record types can connect to:
- **Other WFP record types** (default: same workspace; cross-workspace requires Planning Prime/Ultimate)
- **Workfront objects**: Projects, Portfolios, Programs, Companies, Group, Original request
  - Original request field shows the request name that created the record after submission via a request form
- **Adobe Experience Manager**: Assets (Images, Folders), Content Fragments — requires AEM license
- **Adobe GenStudio for Performance Marketing**: Brands — requires GenStudio license

## Ways connections get created

1. **Manually** — add New Connection field to a record type.
2. **Automatically** — via automations or request forms.
   - Automations create connected records (and the connection at the same time).
   - Request forms: when a submitted request creates a record, the connection is established. Subject of the request appears in the Original request connection field.

## Connection semantics

### Two WFP record types
- A linked record field is created on the source record type.
- A corresponding field is created on the target record type ONLY IF "Create corresponding field on linked record type" is enabled.

### Record type ↔ object from another app
- A linked record field is created on the WFP side only.
- Planning fields NOT accessible from Workfront object pages.
- Planning records visible in the Workfront object's Planning section.
- Custom forms in Workfront can include a Planning connection custom field.
- AEM Assets can access Planning record fields IF admin configures asset metadata mapping (via Workfront-AEM Assets integration).
- GenStudio Brands cannot access WFP record fields.

## Lookup fields
- Beyond the linked record field, you can pull specific fields from the connected record/object.
- Lookup fields are **read-only**, auto-populate from connected record.
- Can be used in formulas, filters, and groupings.
- Example: Campaign → Workfront Project lookup of `Planned Completion Date` creates `Planned Completion Date (from Project)` on Campaign.
- **Permissions caveat**: anyone with View on the workspace sees lookup field data, REGARDLESS of their permissions in the source system (Workfront, AEM, GenStudio) or another workspace. This is a data-leak risk to model carefully.
- Workfront date fields display in 24h format inside WFP lookup fields (3:00 PM in WF → 15:00 in WFP).

## Hierarchies require connections
- Hierarchies need connections between record types.
- If a connection doesn't exist, it's auto-created when you set up the hierarchy.

## Connection cardinality types

Two regimes depending on whether "Create corresponding field on linked record type" is enabled.

### When corresponding field DISABLED
Available types:
- **Multi-select**: pick multiple connected records from source side only. No corresponding field on target.
- **Single-select**: pick one connected record from source side only. No corresponding field on target.

### When corresponding field ENABLED
Available types:
- **Many to many**: both sides can pick multiple.
- **One to many**: source picks many, target picks one (auto-set to many-to-one on target side).
- **Many to one**: source picks one, target picks many.
- **One to one**: both sides pick one.

## Important: NOT available when connecting
The cardinality choices above are NOT available when connecting:
- Records from different workspaces
- A record type and an AEM object
- A record type and a GenStudio Brand

## Cardinality migration rules (after save)
- **Multi-select** cannot change to: single-select, one-to-many, many-to-one, one-to-one. (Effectively locked in.)
- **Single-select** cannot change to: one-to-many, one-to-one.
- **Many-to-many** cannot change to anything else (locked in).
- **One-to-many** can later only change to many-to-many.
- **Many-to-one** can later only change to many-to-many.
- **One-to-one** can later change to any type.

## SA notes
- Pick cardinality carefully — most types are nearly irreversible.
- One-to-one is the most flexible to revise later.
- Connection ceiling (30 per record type) is a hard architectural constraint. Plan model to stay under, especially with taxonomies that connect to many operational types.
- Lookup fields are powerful but introduce read-side data leakage across permission boundaries — explicitly evaluate before exposing sensitive Workfront fields to a wider WFP audience.
