# Turn your first win into sustainable momentum: a playbook for managed scaling

Source: https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-planning/adobe-workfront-planning-best-practices/playbook-how-to-scale
Last update: April 1, 2026

Requires Planning Prime or higher.

## The success trap
After first POC success, two damaging responses:
- **Over governance**: locked down system → teams revert to spreadsheets.
- **Zero governance**: every team makes their own fields/types → metadata sprawl.

## Core philosophy: WFP as reconciliation engine
- Don't try to stop teams from being different. Make differences visible in WFP so they can be reconciled.
- Allocate small portion to ongoing cleanup; large portion to solving pressing business needs.
- Cross-team visibility (unified calendar, consolidated roadmap) is the transformative value.

### Key insights
- "Transitioning to WFP doesn't create a mess; it shines a light on the one that already exists."
- A team asking for their own fields is **adoption**, not sprawl.
- "Manage debt, don't hide it" — strict standards too early push teams back to spreadsheets where debt is invisible.

## Guided autonomy governance model

### Global lanes
- Controlled objects: enterprise reporting requires them. E.g., `Strategic Pillar`, `Region`, `Fiscal Quarter`.
- Managed by: Center of Excellence or Marketing Operations Admin.
- Rule: shared and mandatory.

### Local playgrounds (spokes)
- Experimental objects: tactical to a team. E.g., `Influencer Handle`, `URL Slug`.
- Managed by: Team Lead with light guidance.
- Rule: teams innovate freely. If a local field is adopted by **>3 teams**, promote to global.

## Two-way street model
- **Teams need relevance**: governance must support known operational needs.
- **Enterprise needs visibility**: teams must provide minimum viable metadata for portfolio visibility.
- Goal: standardize enough for visibility, not so much that team execution stalls.

## Persona priorities
- **Admin/Product Owner** values unified taxonomies (clean data architecture).
- **Stakeholder/Leader** values visualization (global calendar, portfolio timeline).
- Strategy: use stakeholder's need for visualization as the incentive for compliance with admin's data standards. Get unified taxonomy by delivering the calendar leadership demands.

## Service-led observation phase
1. Prioritize operation over standardization.
2. Identify the 3-5 "visibility minimum" fields enforced for enterprise reporting (e.g., `Strategic Alignment`, `Start Date`, `Budget`).
3. Focus enforcement on those minimums only.

## Governance as a service
- Observe successful patterns teams have built.
- Bring team champions together for "collaborative handshake" → refine into shared enterprise standard.
- Deploy as a service, not as restriction.
- **Governance is a response to operational success, NOT a prerequisite for it.**

## Field maturity path
- **Level 1**: Local experiment in Team A's workspace.
- **Level 2**: Pattern recognition — admin notices Teams B and C asking for similar.
- **Level 3**: Enterprise standardization — admin creates a single global record type, syndicates.

## Retiring fields (soft retirement)
WFP has no native field archive feature. Process:
1. **Data migration**: bulk-copy via table view or Fusion from shadow field to new global field. Validate/clean during move.
2. **Rename for deprecation**: prefix `[DEPRECATED]` or `z_` (e.g., `z_Language (Old)`). Pushes to bottom of pickers.
3. **Remove from all record forms**: prevents new data entry. Old data still visible in legacy table views.
4. **Sunset period**: 30-60 days. After reconciliation, delete from workspace.

## Avoiding WFP drift
- Every field in Planning should answer a strategic question.
- Tactical-only ("Was this proof approved?") fields belong in Workfront.
- Before creating a new metadata field, invite team leads to check Global Taxonomy via read-only access first.

## Read-only access visibility model
- Problem: teams in spokes feel isolated, see only their own records.
- Fix: grant read-only access to Primary workspaces (taxonomy hubs).
- Result: teams see broader context for inspiration, but local space stays clean.

## Workshop ideas

### "Necessary mess" discovery
- Audience: Regional Marketing leads, Ops champions.
- Goal: document current siloed reality.
- Message: "We're here to understand how your fields link to global strategy, not delete them."
- Outcome: draft mapping of local → global.

### "Strategic visibility" alignment
- Audience: High-level marketing stakeholders.
- Goal: reframe simplify-first anxiety.
- Message: "We don't need a perfect taxonomy to start. WFP is the environment to build it."
- Outcome: approval to use WFP as reconciliation engine while Workfront stays as is.

### "Spoke-to-global" showcase
- Audience: New teams exploring WFP.
- Goal: reduce siloed feeling.
- Outcome: opt-in from new departments.

### "Ongoing support" office hours
- Audience: all WFP users.
- Goal: recurring low-stakes environment for troubleshooting.

## Roles & responsibilities

### Enterprise Architect (CoE / Marketing Ops)
- Manages Global Taxonomy Workspace.
- Facilitates field maturity path.
- Maintains Primary Workspace views for exec reporting.
- Leads monthly semantic audit across workspaces.

### Spoke Champion (Team Process Owner)
- Single point of contact for the team.
- Owns local workspace structure and custom field experiments.
- Ensures team uses Governed Gateway Forms for data entry.
- Participates in collaborative handshake during harmonization.

### Executive Sponsor (Marketing Leadership)
- Defines enterprise marketing OKRs in Global Taxonomy.
- Champions "Visibility Step 1" value to other leaders.
- Reinforces 80/20 resource split (value over cleanup).

### Enablement Lead (Change Management)
- Hosts Office Hours and Discovery Workshops.
- Maintains internal success-story showcase.
- Identifies friction points for Architect to resolve.

## Onboarding-new-team checklist
1. Identify the Champion (Process Owner) for the new team.
2. Define the local delta: 2-3 fields the team needs that global doesn't provide.
3. Map to global lanes: which existing global fields satisfy 80% of needs?
4. Grant global visibility: read-only on relevant Primary workspaces and Global Taxonomy on Day 1.
5. Establish the handoff: how does this team's work feed into Primary workspaces? (Global record type? Specific lookup field?)

## SA notes
- The ">3 teams = promote to global" rule is a useful governance heuristic when designing Adobe-internal Workfront Planning adoption.
- The 80/20 cleanup-vs-delivery rule is Adobe's own stated guidance — useful when arguing against "let's clean up first" bias.
- WFP has no field archive feature — confirmed pain point. Engineering workarounds: rename + remove from forms + sunset window.
- The persona-priority insight (visualization is the carrot for governance compliance) is gold for customer conversations.
