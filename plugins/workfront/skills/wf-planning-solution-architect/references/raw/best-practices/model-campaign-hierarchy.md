# Architect your success: modeling your campaign hierarchy

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-best-practices/model-campaign-hierarchy
Last update: April 1, 2026

Requires Planning Prime or higher. Aimed at admins and power users.

## Core 3-tier model (recommended starting point)

### Level 1 — Campaigns (WFP)
- Long-term strategic pillars and annual initiatives.
- Example: "FY26 Global Brand Awareness".
- Personas: CMO, VP Marketing, strategic leads.

### Level 2 — Channel Tactics (WFP)
- Operational briefs defining "what" for specific channels.
- Final layer of strategic intent before work begins.
- Example: "Q1 Social Media Blitz".
- Personas: Marketing Ops leader, channel leaders, campaign managers.

### Level 3 — Projects (Planning ↔ Workfront)
- Execute the actual experiences/activities.
- Implementation: Tactics in Planning link to Projects in Workfront.
- Deliverables managed as tasks/issues in Workfront.
- Personas: creatives, individual contributors.

## Strategic expansion (optional layers)

### Channel Plans
- Layer between Campaigns and Tactics.
- Groups cross-functional strategies (e.g., "Digital Strategy").

### Activities
- Track individual experiences in Planning BEFORE they become Workfront projects.
- ONLY for low-volume environments (≤ 5,000 deliverables/year).

### IMPORTANT volume threshold
- **>5,000 activities/year → move individual deliverable tracking to Workfront, NOT Planning.**
- Use Planning for "why" and "what"; Workfront for high-volume "how".

## Hub-and-spoke architecture

Enterprise WFP = multiple workspaces with "centers of gravity":

### Taxonomy hub
- Single centralized workspace for global classifications.
- Record types: Brands, Regions, Products, Personas.
- Primary location = source of truth for these types.
- Benefit: "Region: EMEA" means the same thing org-wide.

### Strategic Planning workspace (executive center)
- Where high-level Campaigns (and any Channel Plans) live.
- Noise-free environment for strategic decisions.
- Leadership manages portfolio of campaigns away from tactical noise.

### Functional spokes
- Each functional unit (Social, Creative, Email) has its own workspace for Tactics.
- Teams consume global campaigns and classifications from hubs.
- Maintain their own local records.

## Noun-based governance

- **Use nouns, not verbs**: name types "Campaign", "Tactic" — not "Campaigning", "Planning".
- **Standardize nomenclature**: same names across all workspaces enables enterprise rollup.

## Handling existing Portfolios and Programs

### Recommendation
- In mature orgs, Portfolios = Brands/Business Units; Programs = strategic themes.
- WFP best models these as **record types** in the taxonomy hub.
- Treating Brand as a record type allows linking to Campaign or Tactic enterprise-wide — far more flexible than static Portfolio→Program.

### Reporting bridge strategy
Because WFP Canvas Dashboard reporting is still maturing:
- **Don't delete** existing Workfront Portfolios and Programs.
- Use Planning automations to create a bridge: when a Tactic or Campaign is created in WFP, automation generates corresponding Portfolio or Program in Workfront.
- This preserves legacy reporting while gaining WFP visualization (timelines, calendars).

## Dos
- Stick to the core path-first approach. Establish Campaign→Tactic→Project before complicating.
- Designate primary workspaces — every record type has one home (its center of gravity) acting as aggregator for reporting.
- Prioritize request forms for intake when groups have low WFP maturity. Ensures metadata integrity.

## Cautions
- Power users may want table-view direct entry, but bulk changes there can create data issues for others.

## Don'ts
- Don't use generalizations ("core environment" → say "Workfront, the Project object").
- Don't over-complicate. Every hierarchy level adds management tax. Only add levels answering questions you can't currently answer.
- Don't create silos. Share record types across workspaces so teams don't retype data.

## SA notes
- The 5,000-activities-per-year threshold is the explicit Adobe-stated line for "use WFP" vs "use Workfront" deliverable tracking. Get a customer's deliverable count before designing.
- The "bridge" pattern (WFP automation → Workfront Portfolio/Program) is Adobe's official answer for "we have huge Workfront reporting investments and can't break them" — important for migration projects.
- Hub-and-spoke depends on global + connectable cross-workspace machinery, which means Planning Prime/Ultimate (Plus at minimum for global). Without those packages, you're stuck in a single-workspace pattern.
