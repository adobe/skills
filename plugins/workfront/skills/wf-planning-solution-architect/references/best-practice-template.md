# Best-practice multi-workspace template: Fréscopa reference

This reference summarizes the Fréscopa multi-workspace template that the WF Planning team treats as an internal best-practice exemplar. A trimmed sample export is preserved as `best-practice-template.json` in this folder — it keeps the full structure (all 6 workspaces, 37 record types, and their fields/views/hierarchies) but caps sample data at ~5 records per record type. This .md file is the digest the skill should read first; consult the JSON only when a question requires field-level or record-level detail.

**Use this file in two distinct ways:**
1. **Pattern source** for "what should a real multi-workspace build look like" questions.
2. **Anti-pattern source** for the deviations section below. The skill must NOT replicate the listed gaps when generating workspace builds or recommendations, even though they exist in this otherwise-strong template.

## What it is

A 6-workspace template for a fictional consumer-brand company (Fréscopa) covering marketing planning end-to-end.

| # | Workspace | Sections | Native record types | Purpose |
|---|---|---|---|---|
| 1 | Global Classifications & Taxonomies | 6 | 20 | Central reference-data hub, cross-workspace linked |
| 2 | Fréscopa Global Marketing | 2 | 4 | Core operational marketing (Campaigns, Channel Tactics, Experiences, Events) |
| 3 | Fréscopa Social Marketing | 3 | 1 | Channel-specific (Influencers) |
| 4 | Fréscopa Media & PR | 3 | 3 | Channel-specific (Reporters, Media Outlets, Media Engagements) |
| 5 | Fréscopa Global Events | 3 | 5 | Events-specific (Event Types, Workstream Types, Speakers, Event Locations, Event Audience Type) |
| 6 | Fréscopa Executive Company Leadership | 1 | 4 | OKR cascade (Enterprise Goals, Department Objectives, Team Objectives, Key Results) |

Totals: 37 native record types, ~1,311 sample records, 7 hierarchies, 9 external record-type connections (5x Workfront Project, 2x AEM Assets, 2x GenStudio Brand), 13 configured views, 0 business rules.

## STRONG PATTERNS: emulate these

### Central taxonomy hub via cross-workspace flag
WS1 is the canonical taxonomy hub. 18 of its 20 record types have `linkableWithAllWorkspaces: True`. Domain workspaces (WS2 through WS6) consume taxonomies from WS1 rather than duplicating them. This is the right way to avoid "Countries" existing five times in five workspaces.

### Selective cross-workspace linking
Not every shared record type should be linkable everywhere. The template demonstrates this:
- Pillars uses `linkableWithWorkspaceIds: 5` (targeted to 5 specific workspaces), not `linkableWithAllWorkspaces`.
- Key Performance Indicators is both cross-workspace AND global, deliberately broadcasting to everywhere.
- Channel Tactics (a work type in WS2) is also global with selective workspace linking.

Selective linking is the right default for anything where over-exposure would clutter unrelated workspaces.

### Lookup-rich work record types (Campaigns case study)
Campaigns has 31 fields broken down as:
- 8 REFERENCE fields (to taxonomies in WS1 plus Channel Tactics)
- 8 LOOKUP fields pulling rolled-up or related data from connected records
- 5 FORMULA fields (Campaign ID, Budget Allocation Remaining, Project Completion %, Days Until Launch, etc.)
- 3 LONG_TEXT, 2 TEXT, 2 DATE, 1 SINGLE_SELECT (Status), 1 CURRENCY, 1 MULTI_SELECT

The 8:8 reference-to-lookup ratio is the playbook "always create lookup fields on connections" rule applied properly. Lookups surface Regions and Languages from Countries, Brands and Product Categories from Products, Quarter Start and Quarter End from Quarters, and so on. This is what a mature work record type looks like.

### Bidirectional vs unidirectional connection choices
Campaigns has exactly one bidirectional connection (Channel Tactics, with `backField` configured). All other references (Countries, Channels, Messaging, Quarters, Target Audiences, Products, Journey Stages) are unidirectional. This matches the playbook: parent-child gets bidirectional, work-to-reference stays unidirectional to keep reference types clean.

### Hierarchy design
7 hierarchies modeled across workspaces:

WS1 (Taxonomies):
- Product Categories > Products (2 levels)
- Years > Quarters (2 levels)
- Regions > Countries > States, Provinces, or Prefectures (3 levels)
- Channels > Platforms (2 levels)

WS2 (Marketing):
- Campaigns > Channel Tactics > Experiences > [4th type] (4 levels, AT THE CAP)

WS6 (Executive):
- Enterprise Goals > Department Objectives > Team Objectives (3 levels)
- Department Objectives > Key Results (2 levels)

WS6 shows a useful pattern: Department Objectives appears in two hierarchies (as child of Enterprise Goals, and as parent of Key Results). This encodes the OKR cascade without forcing it into one tree.

### Multi-system external integration
9 external record-type instances spanning all three external systems: Workfront (Project, 5 instances), AEM (Experience Manager Assets, 2 instances), GenStudio (Brand, 2 instances). The template shows that external connections can be scoped per workspace (`linkableWithWorkspaceIds: 2` on one of the Project externals) rather than always being global.

### Sample data scale
1,311 records across 37 types is enough for realistic demos and testing. Heavy types (States/Provinces: 310, Experiences: 258, Media Outlets: 92, Channel Tactics: 65) exercise the platform; light types (Vision and Mission: 3, Pillars: 4, Event Types: 4) keep the noise low. All counts are well below the 25,000-per-record-type ceiling.

## KNOWN DEVIATIONS: do NOT replicate

These are real gaps in the template. When the skill uses this template as a pattern source, it must not carry these forward. When customers ask "is this template good?" the skill should celebrate the strong patterns above AND surface these gaps so the customer can decide consciously.

### 1. Reference types with lingering lifecycle fields

The playbook says: reference types should have Start Date, End Date, and Status deleted because reference data has no lifecycle. The template keeps these on:
- **Pillars**: Status, Start Date, End Date (this one may actually be a work/activity type misclassified as reference, given the strategic time horizon)
- **Brands**: Status (defensible: brands can be active or sunsetted, but should be a deliberate choice)
- **Vision and Mission**: Status (questionable)
- **Messaging Strategies**: Status (questionable)
- **Speakers**: Status (defensible: active or inactive speakers)
- **Event Locations**: Status (defensible: active or decommissioned venues)
- **Quarters**: Start Date, End Date (defensible exception, since the dates encode the quarter's span rather than a lifecycle)

**Skill behavior:** when designing reference types, always delete Status, Start Date, End Date unless the user explicitly justifies keeping them. Do not justify them by saying "the Fréscopa template does this." That is the exact mistake to avoid.

### 2. Views coverage gap

Only 5 of 37 record types have custom views configured. Work record types with ZERO custom views (just the default Table):
- WS6: Enterprise Goals, Department Objectives, Team Objectives, Key Results
- WS3: Influencers
- WS4: Reporters, Media Outlets, Media Engagements
- WS5: Speakers, Event Locations, Event Types, Workstream Types, Event Audience Type

The playbook target is 2 to 3 configured views per work record type, only default Table for pure reference types.

**Skill behavior:** when building a work record type, always create 2 to 3 configured views (Table with filters/grouping/sorting, plus Timeline or Calendar where dates exist). Never leave a work record type on bare default Table.

### 3. Section count outliers

- WS6 (Executive Leadership) has 1 section ("goals & objectives") for 4 record types. Below the playbook's 3 to 6 minimum.
- WS3 (Social Marketing) has 3 sections but only 1 native record type. Two sections rely entirely on cross-workspace types from WS1 to feel populated, which works mechanically but is a smell.

**Skill behavior:** target 3 to 6 sections per workspace. If fewer makes sense (small, focused workspace), say so deliberately. If sections will be populated mostly by cross-workspace types, document that intent up front.

### 4. Section and workspace naming inconsistencies

Workspace names use numeric prefixes ("1.", "2.", "3."), which the playbook explicitly discourages in favor of creative business language. Section names have typos and inconsistent capitalization:
- "GEos" (should be "Geos")
- "people" (lowercase outlier)
- "STRATEGIC Alignment" (mid-word caps)
- "EVent taxonomies" (mid-word caps)
- "Marketing goals & objectives" (lowercase outlier)
- "Global Planning WORK" (mixed caps)

**Skill behavior:** when generating workspace or section names, use consistent Title Case, no mid-word capitalization, no typos, and avoid numeric prefixes unless the user explicitly asks for ordered naming.

### 5. Hierarchy at the ceiling

The Campaigns hierarchy uses the full 4-level depth (Campaigns > Channel Tactics > Experiences > [4th type]). Any future extension (Tasks under Experiences, sub-tactics, content blocks under Experiences) will not fit, since 4 record types per hierarchy is the hard cap.

**Skill behavior:** when designing a hierarchy that approaches 4 levels, flag the ceiling to the user. If the customer has a roadmap that includes more depth, recommend keeping headroom (3 levels max) and using non-hierarchy connections for the next layer instead.

### 6. No business rules configured

`businessRules: list[0]`. For a template marketed as best-practice exemplar, the absence of any rules is a teaching gap.

**Skill behavior:** when building a workspace, consider whether business rules would enforce useful invariants (e.g., "Campaign Status cannot move to Complete unless End Date is in the past"). Recommend 1 to 2 rules where they earn their keep. Do not skip them just because this template did.

### 7. 500-connected-records sizing ceiling on Channel Tactics

Channel Tactics references Campaigns with `multiple: true`. If a customer instantiating this template runs a campaign with more than 500 tactics, they hit the multi-select non-hierarchy connection cap. This is the same architectural ceiling that has surfaced in past customer escalations.

**Skill behavior:** when this template (or any similar parent-child pattern with a high-volume child) is being instantiated for a high-volume marketing org, surface the 500-connection ceiling up front as a sizing-fit conversation. Do not wait for the customer to discover it after rollout. If the projected volume exceeds the cap, recommend a hierarchy-based connection (which has its own different cap of 10 parents per child) or a redesign that batches tactics by campaign segment.

## How the skill should use this reference

1. **For "build me a workspace" requests** (Category B and C in SKILL.md routing): load this file alongside `workspace-build-playbook.md`. Use the Strong Patterns section as concrete examples. Use the Deviations section as a checklist of things to NOT do.

2. **For "is this template good for our org" customer conversations**: lead with the strong patterns (architecture quality, cross-workspace strategy, lookup richness, hierarchy design, external integration coverage), then surface the deviations as adoption considerations the customer should decide consciously.

3. **For sizing conversations on high-volume marketing customers**: always pull deviation #7 forward proactively.

4. **For naming conventions**: never cite this template's section names as examples of good naming. Cite the playbook and standard Title Case instead.

5. **For "show me what mature looks like" questions**: this template is the answer at the architectural level, with the seven deviations called out as work-in-progress items even on a mature build.

## Source

- File: `references/best-practice-template.json` (trimmed sample export, ~2.7 MB, identifiers scrubbed; full structure with ~5 records per record type)
- Date of analysis: May 11, 2026
