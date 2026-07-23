# Test prompts for the wf-planning-solution-architect skill

Test prompts organized by routing category and behavior under test. Use these for skill development, regression testing after edits, and as eval inputs.

Each prompt has:
- **Prompt:** what the user would say.
- **Expected category:** which routing path in SKILL.md should activate.
- **Files expected to load:** what references the skill should pull.
- **Pass criteria:** what makes the response correct.
- **Anti-pattern to flag:** what failure mode to watch for.

## Category A: limits, performance, capacity

### A1. Plain limit question
**Prompt:** "What's the max number of records per record type in Planning?"
**Expected category:** A.
**Files expected:** `limits-and-tiers.md`.
**Pass criteria:** answers 25,000, mentions that the roadmap target is 50,000 initially, notes this is the same across all tiers.
**Anti-pattern:** quoting "unlimited" or any number from training data instead of the reference.

### A2. Customer asking for an exception
**Prompt:** "A large enterprise customer is asking us to raise the 500 connected records limit to 2,500. They've hit it on day one of go-live. What should I tell them?"
**Expected category:** A.
**Files expected:** `limits-and-tiers.md`, `customer-conversation-framings.md`.
**Pass criteria:** reframes as architecture problem, not limit problem. References the documented prior conversation pattern. Notes that even at 2,500 the customer's projected volume hits the new cap within two quarters. Mentions the "if it were just a matter of asking to increase them, why would we have them in the first place?" sentence.
**Anti-pattern:** negotiating a middle number (e.g., "we can do 1,500"). Conceding that the limit is negotiable.

### A3. Customer asking for P95 data
**Prompt:** "A customer is meeting with us tomorrow and wants P95 performance numbers for Planning. What can we share?"
**Expected category:** A.
**Files expected:** `customer-conversation-framings.md`, `limits-and-tiers.md`.
**Pass criteria:** explains that Adobe does not publish a public P95/SLA. Offers internal telemetry framed explicitly as "observed production telemetry": ~233 ms P95 server-side, ~402 ms P99. Anchors the words "observed", "production telemetry", "server-side", "not contractual".
**Anti-pattern:** quoting numbers as commitments. Suggesting the numbers can go in a contract.

### A4. RPM industry comparison
**Prompt:** "Customer is comparing our 200 RPM to other SaaS APIs and saying it's low. How do I defend it?"
**Expected category:** A.
**Files expected:** `customer-conversation-framings.md`, `limits-and-tiers.md`.
**Pass criteria:** explains that 200 RPM is defensible for interactive planning. Notes the trap is bulk integrations sharing user accounts with interactive use. Recommends separate service accounts for bulk traffic as the right architectural answer.
**Anti-pattern:** benchmarking against high-frequency data APIs (Zendesk, etc.) as a defense. Different category.

## Category B: workspace design

### B1. Design from scratch for a marketing org
**Prompt:** "Help me design a workspace for a global marketing team that runs campaigns across 30 countries with multiple channels and brands."
**Expected category:** B.
**Files expected:** `workspace-build-playbook.md`, `best-practice-template.md`, possibly `raw/best-practices/`.
**Pass criteria:** proposes a multi-workspace design with a central taxonomy hub. Identifies which record types are work types (Campaigns, Tactics, Experiences) vs reference types (Countries, Channels, Brands, Audiences). Recommends 2 to 3 views per work type. Does NOT replicate Fréscopa deviations: no lifecycle fields on pure reference types, no single-section workspaces, no mid-word capitalization in names.
**Anti-pattern:** dumping the Fréscopa template wholesale. Suggesting a single mega-workspace for all 30 countries.

### B2. Should this be a record type or a field
**Prompt:** "We have 'Priority' and 'Campaign Sponsor' as concepts. Should they be record types or fields on Campaign?"
**Expected category:** B.
**Files expected:** `workspace-build-playbook.md`.
**Pass criteria:** explains the heuristic. Priority is likely a field (single-select, fixed values, no data of its own). Campaign Sponsor depends on whether sponsors have attributes worth tracking (if yes, record type; if just a name, a People field or text field).
**Anti-pattern:** treating both as record types reflexively.

### B3. Pillars classification question
**Prompt:** "In our reference template, we have a 'Pillars' record type with Status, Start Date, End Date. Is that right?"
**Expected category:** B.
**Files expected:** `best-practice-template.md`, `workspace-build-playbook.md`.
**Pass criteria:** flags that Pillars may be misclassified as a reference type when it actually carries lifecycle attributes. Recommends moving it to work / activity type or removing the lifecycle fields. Cites the Fréscopa deviation explicitly.
**Anti-pattern:** approving the existing structure just because the reference template has it.

## Category C: agentic workspace build via MCP

### C1. Build a campaign workspace via MCP
**Prompt:** "Build me a Q1 campaign workspace via MCP. Marketing team running 4 product lines, 5 regions, 3 audience segments."
**Expected category:** C.
**Files expected:** `workspace-build-playbook.md`, `best-practice-template.md`, `mcp/field-types.json`, `mcp/field-formats.json`, `mcp/filter-operators.json`.
**Pass criteria:** follows build order strictly (Plan, Workspace, Sections, Record Types, Fields, Connections, Sample Records, Views). Completes each record type fully before moving to the next. Does NOT narrate intermediate steps; explains once at the end. Renders output as markdown links using display names. Creates 2 to 3 views per work record type.
**Anti-pattern:** stopping after creating the shell. Narrating each step. Outputting raw IDs.

## Category D: formula fields

### D1. CASE function availability
**Prompt:** "Is the CASE function supported in Planning formula fields?"
**Expected category:** D.
**Files expected:** `mcp/formula-documentation.txt`, `public-vs-mcp-discrepancies.md`.
**Pass criteria:** answers yes, CASE is supported. Notes that public docs omit it. Cites the MCP formula documentation as canonical.
**Anti-pattern:** saying "I don't see it in the docs, so probably not."

### D2. Budget variance formula
**Prompt:** "Write me a formula for budget variance percentage between Total Budget and Actual Spend."
**Expected category:** D.
**Files expected:** `mcp/formula-documentation.txt`.
**Pass criteria:** produces something like `({Actual Spend} - {Total Budget}) / {Total Budget}`. Uses curly-brace field references with exact display names. Notes that result is stored as decimal (0.15 = 15%).
**Anti-pattern:** using unsupported functions like SWITCH or FORMAT. Misusing curly braces.

## Category E: filtering and search via API/MCP

### E1. Compound filter
**Prompt:** "How do I search for active campaigns in EMEA launched after Jan 1 via the API?"
**Expected category:** E.
**Files expected:** `raw/api/api-basics.md`, `mcp/filter-operators.json`.
**Pass criteria:** uses `$-prefixed` operators. Filters as a JSON array. Uses `$and` to combine. ISO 8601 dates with Z timezone. Maps Region field to `$hasAnyOf` since it's a reference field.
**Anti-pattern:** using UI labels ("Contains") instead of API tokens (`$contains`). Filters as an object instead of an array.

## Category F: connections and hierarchy

### F1. Hierarchy depth question
**Prompt:** "Customer wants Campaign > Tactic > Experience > Asset > Component. Five levels. Can we do that?"
**Expected category:** F.
**Files expected:** `workspace-build-playbook.md`, `raw/architecture/hierarchy-and-breadcrumb-overview.md`.
**Pass criteria:** explains the 4-level hierarchy cap. Recommends building at 3 levels with headroom and using non-hierarchy connections for the next layer. Mentions that the Fréscopa template Campaigns hierarchy is at the 4-level ceiling, with no room to extend.
**Anti-pattern:** saying "yes, just configure it" or proposing 5 levels.

### F2. Bidirectional vs unidirectional
**Prompt:** "Should the connection from Tactic to Campaign be bidirectional?"
**Expected category:** F.
**Files expected:** `workspace-build-playbook.md`.
**Pass criteria:** yes, parent-child connections are bidirectional. Reference field on the child (Tactic) pointing to parent (Campaign), with `backField` to surface the children on the parent.
**Anti-pattern:** recommending unidirectional for a parent-child relationship.

## Category G: automation surface selection

### G1. Pick the right surface
**Prompt:** "When a Campaign moves to Status=Approved, I want to auto-create a Workfront Project. Which automation surface should I use?"
**Expected category:** G.
**Files expected:** `raw/automations/automations-deep-dive.md`.
**Pass criteria:** native field-value-change automation. Sysadmin-authored. Action is one of the 6 supported (create project). Notes the no-post-save-edit constraint and the sysadmin-only requirement.
**Anti-pattern:** recommending Fusion when native automation handles it.

### G2. External trigger
**Prompt:** "I want to auto-update a Planning record when a row changes in our external CRM. Which surface?"
**Expected category:** G.
**Files expected:** `raw/automations/automations-deep-dive.md`.
**Pass criteria:** Fusion. External trigger is outside Planning; native automations can't do this. Mentions Fusion has observability via execution history.
**Anti-pattern:** recommending native automation.

## Category H: AI Assistant

### H1. AI Assistant scope
**Prompt:** "What's the difference between Planning AI Assistant and Workfront AI Assistant?"
**Expected category:** H.
**Files expected:** `raw/ai-assistant/planning-ai-assistant-overview.md`, `raw/ai-assistant/workfront-ai-assistant-overview.md`.
**Pass criteria:** distinguishes the Planning-scoped surface from the Workfront-wide one. Mentions that the AI Designer (beta) is separate again.
**Anti-pattern:** conflating the three.

## Category I: GenStudio integration

### I1. GenStudio Brand connection
**Prompt:** "How do I connect a Planning workspace to a GenStudio Brand?"
**Expected category:** I.
**Files expected:** `raw/genstudio/genstudio-integration-overview.md`, `mcp/connections.json`.
**Pass criteria:** explains the connection. Notes that in MCP the connection key is `Brand`; in the UI picker it appears under "Adobe Applications". Notes Activations are read-only from Planning's side.
**Anti-pattern:** confusing the MCP `Brand` key with the customer-facing "GenStudio" terminology.

## Category J: reporting

### J1. Planning reporting in legacy Workfront
**Prompt:** "Can we build a report in Workfront that lists all Planning Campaigns by region?"
**Expected category:** J.
**Files expected:** `raw/canvas-dashboards/canvas-dashboards-overview.md`, `customer-conversation-framings.md`.
**Pass criteria:** explains that Canvas Dashboard is the only Workfront-native surface that treats Planning record types as base entities. Legacy Workfront reports cannot. Sets expectation around Canvas's current state (beta, prerequisites, cloud-provider exclusions).
**Anti-pattern:** suggesting it works in legacy Workfront reports.

## Category K: access, sharing, license

### K1. Sharing cap
**Prompt:** "Can I share a record type with 200 users individually?"
**Expected category:** K.
**Files expected:** `raw/access/sharing-permissions-overview.md`, `limits-and-tiers.md`.
**Pass criteria:** notes the 100 sharing entities per WFP object cap. Recommends sharing with groups or teams to scale beyond 100 individual entities.
**Anti-pattern:** quoting "unlimited" or 100 without explaining the workaround.

## Category L: Fusion

### L1. Fusion modules available
**Prompt:** "What Fusion modules are available for Planning?"
**Expected category:** L.
**Files expected:** `raw/fusion/workfront-planning-modules.md`.
**Pass criteria:** lists the Watch Events trigger and the CRUD / search modules. Notes when to use Fusion vs native automations.

## Category M: views

### M1. Calendar view limitations
**Prompt:** "Can I group records by Owner in a Calendar view?"
**Expected category:** M.
**Files expected:** `raw/views/manage-the-calendar-view.md`, `mcp/view-types.json`.
**Pass criteria:** answers no. Calendar supports filters only; no grouping or sorting. Recommends Table or Timeline view if grouping is needed.
**Anti-pattern:** saying yes or being uncertain.

## Category N: requests and approvals

### N1. Request form approval flow
**Prompt:** "How do I gate request submissions with an approval before a record is created?"
**Expected category:** N.
**Files expected:** `raw/requests/add-approval-to-request-form.md`, `raw/requests/approve-request.md`.
**Pass criteria:** explains the approval mechanism on request forms. Notes default vs custom rules, first-match resolution, team-as-approver semantics.

## Cross-category and integration prompts

### X1. Workspace adoption review
**Prompt:** "Customer wants to instantiate the Fréscopa template for their marketing org. Anything I should flag?"
**Expected category:** B + customer-conversation-framings.
**Files expected:** `best-practice-template.md`, `customer-conversation-framings.md`.
**Pass criteria:** leads with strong patterns (central taxonomy hub, lookup-rich Campaigns, hierarchy design). Surfaces the 7 deviations: reference types with lifecycle fields, views coverage gap, single-section workspaces, naming typos, 4-level hierarchy at the ceiling, missing business rules, 500-connection sizing risk. Recommends customer decide consciously, not adopt blindly.
**Anti-pattern:** presenting the template as turnkey. Skipping the deviations.

### X2. Precision discrepancy
**Prompt:** "Public docs say currency fields support 6 decimal places, but my API call only accepts 4. What's going on?"
**Expected category:** D + public-vs-mcp-discrepancies.
**Files expected:** `public-vs-mcp-discrepancies.md`.
**Pass criteria:** explains the discrepancy. MCP is authoritative for API behavior; 4 decimals is the actual storage limit. Public docs may be outdated.
**Anti-pattern:** insisting public docs are correct and the API is broken.

### X3. Internal-vs-external framing
**Prompt:** "I'm presenting Planning performance numbers to internal leadership. What should I say?"
**Expected category:** A + customer-conversation-framings.
**Files expected:** `limits-and-tiers.md`, `customer-conversation-framings.md`.
**Pass criteria:** internal telemetry is fair game for leadership context. Anchor the framing words (observed, production, server-side). Note that the same numbers should NOT be repackaged into customer SLA commitments.

## Negative tests (skill should NOT activate)

### Neg1. Generic Workfront question
**Prompt:** "How do I create a Project in Workfront?"
**Expected:** skill should NOT activate. This is legacy Workfront, not Planning.

### Neg2. Adobe Creative Cloud question
**Prompt:** "How do I use Photoshop's content-aware fill?"
**Expected:** skill should NOT activate. Unrelated to WFP.

### Neg3. Fusion in general
**Prompt:** "What's a Fusion scenario?"
**Expected:** skill should NOT activate, OR activate only if context establishes Planning relevance. Generic Fusion is not in scope; Planning Fusion modules are.

## How to run these as a sanity check

Pick 3 to 5 prompts spanning categories. Send them to a fresh Claude session with the skill installed. For each, verify:
1. The skill activated (or correctly did not activate for negative tests).
2. The expected files were referenced (visible if the response cites them).
3. The pass criteria are met in the response.
4. The anti-pattern is not present.

Track failures over time; they signal where the skill or references need refinement.
