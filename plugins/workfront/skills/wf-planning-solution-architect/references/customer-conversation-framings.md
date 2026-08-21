# Customer conversation framings

Stock framings for the recurring customer conversations the WF Planning SA team handles. Each section gives the situation, the recommended framing, the key sentences to anchor on, and the trap to avoid.

These are not scripts. Adapt to context. The goal is consistency across the team in how we frame architectural problems vs limit problems vs performance questions.

## 1. Customer is hitting a limit and asking for an exception

### Situation
Customer (often via account team or the implementation partner) escalates that they have hit a published platform limit (records per record type, connected records cap, fields per record type, etc.) and asks for the limit to be raised for them.

### Recommended framing
The architecture is wrong, not the limit. Granting incremental exceptions does three damaging things:
1. Creates technical debt across the platform that affects all customers.
2. Delays the redesign that this customer actually needs.
3. Buys 1 to 2 quarters at most before they hit the new cap.

If the customer has previously been granted an exception and is now back asking for more, name that pattern explicitly. Documented prior conversations are accountability anchors.

### Key sentences to anchor on
- "The limit exists because the underlying architecture requires it. Raising it for one customer means absorbing that complexity across the platform."
- "Even at the requested cap, your own projection of [X] records puts you back at the ceiling within two quarters. That tells us this is a design problem, not a sizing problem."
- "If it were just a matter of asking to increase them, why would we have them in the first place?"
- "We can prioritize the redesign work. We are not going to absorb another exception."

### Trap to avoid
Do not negotiate the number ("we can do 1500 not 2500"). Once you negotiate the number, you have conceded that the limit is negotiable, which it is not. Hold the architectural line.

### Reference case
A multi-quarter escalation pattern observed in production: an implementation-partner-built solution hits the 500-connection cap on day one of go-live, despite the solution architect flagging the risk months earlier. An initial exception is granted, then a second exception request follows. The customer's own projection puts them back at the new cap within two quarters, confirming this is design-driven rather than sizing-driven. The accountability anchor in these conversations is the documented prior risk acknowledgment from the implementation team.

## 2. Customer asks for performance numbers (P95, SLA)

### Situation
Customer wants performance guarantees, P95 numbers, or SLA documentation. Often surfaces in pre-sale, contract renewal, or "is this product mature enough?" conversations.

### Recommended framing
Workfront Planning does not publish a public P95 / SLA contract. We do have internal production telemetry that can be shared as observed behavior, NOT as a commitment.

Frame as: "Internal production monitoring shows commonly used Planning APIs running at low-hundreds-of-milliseconds P95 server-side latency in production." Anchor the words **observed**, **production telemetry**, **server-side**.

### Key sentences to anchor on
- "We do not publish a contractual P95 / SLA for Planning today."
- "What I can share is observed production telemetry: P95 around 233 ms across roughly 1.94M requests per day in the most recent 14-day window. P99 around 402 ms."
- "These are backend server-side response times, not browser-perceived page loads."
- "I want to set expectations: this is what we observe, not what we commit to."

### Trap to avoid
Do not let telemetry numbers harden into commitments. If a customer asks you to put the numbers in a contract or signed document, route through legal and product. Internal telemetry is for verbal context and slide-level talking points, not for SLA commitments.

### Reference case
A regulated-industry customer asks for limits documentation and P95 data ahead of a customer meeting. Internal prep for leadership uses the same telemetry framed explicitly as observed production behavior, never as contractual SLA. The customer ultimately receives the published limits page and verbal positioning of the latency numbers without those numbers entering any signed document.

## 3. Customer asks how API rate limits compare to industry

### Situation
Customer (often technical buyer or integration architect) compares 200 RPM per user against other SaaS APIs and questions whether it is sufficient.

### Recommended framing
For an interactive planning SaaS, 200 RPM per user is defensible. The problem only surfaces when bulk integrations are layered on top of regular interactive use. The right architectural answer is separate service accounts for bulk traffic, not raising the user-level limit.

### Key sentences to anchor on
- "For an interactive planning product, 200 RPM per user is defensible. It is calibrated to what one user actually generates."
- "The pattern that hits the limit is bulk integrations sharing a user account with interactive use. That is the architecture to fix."
- "Separate service accounts for bulk traffic is the standard answer. It lets us isolate the workload pattern from interactive use, which protects both."

### Trap to avoid
Do not benchmark Planning against high-frequency data APIs (Zendesk at 2,000 RPM, etc.). Different product category, different access pattern. The defensible comparison is against other planning / collaboration tools.

## 4. Customer wants Planning reporting in legacy Workfront reports

### Situation
Customer expects to build standard Workfront reports against Planning record types and is frustrated that this does not work.

### Recommended framing
Canvas Dashboard is the only Workfront-native reporting surface that treats Planning record types as base entities. Legacy Workfront reports cannot. Set this expectation explicitly so the customer plans around it, not against it.

### Key sentences to anchor on
- "Planning is a distinct data model from legacy Workfront. Reports on Planning records build in Canvas Dashboard, not in the classic report builder."
- "Canvas Dashboard is currently in beta with some cloud-provider exclusions. We can walk through the prerequisites and the report types it supports today."
- "If you have downstream reporting needs (Power BI, Tableau), the path is via the Planning API; Canvas is the in-product path."

### Trap to avoid
Do not promise that legacy Workfront reports will eventually support Planning record types as base entities. That is a roadmap question that has not been committed.

## 5. Customer wants a workspace built end-to-end

### Situation
Customer (or internal AM) asks for help designing or building out a workspace, often vaguely ("help me set up Planning for our marketing org").

### Recommended framing
Ground the design in their actual operating model, not a generic template. Apply the workspace build playbook:
- Multi-workspace with a central taxonomy hub for mid-to-large customers.
- Work types keep lifecycle fields; reference types remove them.
- Always bidirectional for parent-child, unidirectional for work-to-reference.
- Lookup fields on every connection.
- 2 to 3 views per work record type.

For sizing, ask about projected volumes early: records per record type, connections per parent record, total record count. Flag the 25,000 per record type ceiling and the 500-connection cap if their projections approach either.

### Key sentences to anchor on
- "Before we design, walk me through how you actually run a campaign end-to-end. I want to model from your operating language, not from a template."
- "We will use a hub-and-spoke pattern: one workspace for shared classifications (regions, channels, audiences, products), domain workspaces for the actual work."
- "For each work record type, expect 2 to 3 views: a Table for day-to-day, a Timeline for roadmap, and a Calendar if scheduling matters."
- "Your projected volume of [X] tactics per campaign approaches the 500-connection ceiling. Let's design with headroom in mind rather than retrofitting later."

### Trap to avoid
Do not start from the Fréscopa template or any other reference template wholesale. Use them for pattern guidance; build the customer's structure from their language and operating model. See `references/best-practice-template.md` for which patterns to emulate and which deviations to skip.

## 6. Customer asks about Planning vs legacy Workfront ("when do I use which?")

### Situation
Customer is on Workfront, has Planning available, and asks where the line is between the two products.

### Recommended framing
Workfront (legacy) handles **delivery and execution** of work: projects, tasks, portfolios, programs. Predefined types, structured workflow.

Planning handles **strategy and planning** of work: campaigns, OKRs, audiences, channels, anything before a project exists. Custom types, flexible model.

The bridge is the connection from a Planning record (e.g., Campaign) to a Workfront object (e.g., Project), which is what `the bridge` and the Planning > Workfront workflow are designed for.

### Key sentences to anchor on
- "Workfront delivers the work. Planning plans the work that becomes Workfront projects."
- "The handoff point is the connection from a Planning Campaign to one or more Workfront Projects. Planning stays the system of record for the strategic context; Workfront stays the system of record for the execution."
- "If a customer is doing all their planning in Workfront Custom Forms today, the migration story is to lift the planning concepts into Planning and keep the execution in Workfront."

### Trap to avoid
Do not suggest that Planning replaces Workfront, or that Workfront should be deprecated in favor of Planning. They are designed to work together. Customers on Planning Prime or Ultimate are licensed for both.

## 7. AM or customer asks "is this a roadmap item?"

### Situation
Customer or AM asks whether a feature gap will be addressed in a future release.

### Recommended framing
Be honest about what is committed vs what is being explored. Do not over-promise. Three tiers of language:
- **Committed:** "This is on the roadmap for [quarter]."
- **Being explored:** "This is in discovery. We have not committed to a delivery quarter."
- **Not on the roadmap:** "This is not on the roadmap today. If the use case is important, I can route it to product for consideration."

### Key sentences to anchor on
- "I want to be precise here: this is in discovery, which means we are validating the approach but not yet committed to delivery. The structure is intentional: discover in one quarter, deliver in the next, only if discovery validates the path."
- "Nothing in this roadmap locks us into delivering something we have not yet validated."

### Trap to avoid
Do not say "yes, that is coming" without a specific commitment behind it. Customers remember these answers verbatim and bring them back. Anchor in discovery vs delivery phasing if uncertain.

## 8. Customer instantiates a reference template and asks "is this good for us?"

### Situation
Customer adopts the Fréscopa template (or similar reference) and asks whether it is the right starting point.

### Recommended framing
The template has strong architectural patterns to emulate and known deviations that the customer should decide on consciously. Lead with the strong patterns; surface the deviations as adoption considerations, not as defects.

### Key sentences to anchor on
- "The architecture is solid: central taxonomy hub, lookup-rich work records, selective cross-workspace linking. That part you can keep as-is."
- "A few things are worth deciding consciously before you go live: should reference types like Brands or Speakers keep their Status fields, or remove them? Pillars in particular is classified as reference but has lifecycle fields, which suggests it may belong as a work type."
- "Views are configured on only 5 of 37 record types in the template. You will want to add Table, Timeline, and Calendar views for the work types that matter to you."
- "If you project more than 500 tactics per campaign, surface that early. The 500-connection cap is structural."

### Trap to avoid
Do not present the template as fully turnkey. Adopters who blindly copy will inherit the gaps. Frame the template as a strong starting point that needs the customer's voice on the deviations.
