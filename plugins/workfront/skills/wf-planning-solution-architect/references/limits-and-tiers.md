# Limits and tiers reference

SA-ready reference for Workfront Planning object limits, organized by tier. Use this when a customer asks about capacity, when sizing a new deployment, or when an escalation hits a limit and a "raise it" request comes in.

Source of truth: `references/raw/general/limitations-overview.md` (Adobe Experience League, Last update: April 2026). This file restates the limits in SA-conversation-ready form and adds tier context, framing language, and known sizing risks.

## Tier overview

Workfront Planning ships in three license tiers. The tier shapes every capacity question.

| Tier | Records per workspace | Total records per WFP instance |
|---|---|---|
| Select | 25,000 | 500,000 |
| Prime | 500,000 | 2,000,000 |
| Ultimate | 1,000,000 | Unlimited |

Always confirm the customer's tier before quoting numbers. Customers and AMs sometimes do not know which tier is provisioned. The provisioning system or account team record is authoritative.

## Object limits (apply to all tiers unless noted)

### Workspace-level
- Workspaces per Workfront instance: unlimited (Adobe recommends against fragmentation).
- Sections per workspace: 50.
- Record types per workspace: 100 (includes record types from all sections and template-created ones).
- Records per record type: 25,000. **This is the hard ceiling for any single record type, regardless of tier.** The roadmap target is 50,000 initially, not unlimited.
- Hierarchies per workspace: 5.

### Record-type-level
- Fields per record type or taxonomy: 500.
- Paragraph fields per record type: 20.
- Formula fields per record type: 20.
- Connection fields per record type: 30.
- Views per record type per user: 100.

### Field-level
- Single-line text: 1,000 characters.
- Paragraph: 10,000 characters.
- Formula field expression: 50,000 characters.

### Connection-level
- Records connected to one record in a multi-select connection (no hierarchy): **500**. Past customer escalations have hit this limit. See `customer-conversation-framings.md` for the recommended reframe.
- Parent records connected to one child record inside a hierarchy: 10.
- Record types per hierarchy: 4.

### Sharing-level
- Sharing entities per WFP object: 100.

### API-level
- API request rate: 200 requests per minute per user.
- For interactive planning SaaS use this is defensible. For bulk integrations layered on top of interactive use it is tight. The right answer is separate service accounts for bulk traffic, not raising the limit.

### Import-level
- File size for table import: 1 MB.
- File size for table import via API: 1.5 MB.
- CSV/Excel size for record type creation: 5 MB.
- Rows in import CSV/Excel: 25,000.
- Columns in import CSV/Excel: 500.

## How to use this in SA conversations

### When a customer asks "what are the limits?"
Share the published Adobe Experience League page (`adobe-workfront-planning-general-information/limitations-overview`) directly. It is the customer-facing source of truth. Anchor any verbal answer to the tier they are on.

### When a customer requests an exception
Default response: the architecture is wrong, not the limit. See `customer-conversation-framings.md` for the full reframe. Key points:
- Granting exceptions creates technical debt across the platform.
- It delays the redesign that the customer needs.
- Even a higher cap will be exhausted in 1 to 2 quarters at their projected growth rate.
- Reference the documented prior conversations to establish accountability if there is escalation history.

### When a customer asks for performance numbers
Workfront Planning does not publish a public P95 / SLA contract. Internal production telemetry from the maestro backend is available and can be shared with leadership audiences as "observed production telemetry":
- P95 server-side request latency: ~233 ms (across roughly 1.94M requests per day, 14-day window observed).
- P99: ~402 ms.
- Endpoint range: sub-100 ms P95 (record type and breadcrumb fetches) up to low-300 ms P95 (record fetch, workspace fetch, record search). Search is the most variable (153 to 530 ms).

These are backend server-side response times, not browser-perceived page loads, and they are not contractual. Frame as telemetry, not SLA.

### When a customer asks about tier upgrade triggers
Common triggers for moving from Select to Prime:
- Approaching 25,000 records per workspace (the Select cap).
- Heavy multi-workspace use with shared taxonomies (the central-hub pattern works better with Prime headroom).
- Anticipated growth above 500,000 total records per instance.

Common triggers for moving from Prime to Ultimate:
- Total records per instance approaching 2M.
- Enterprise rollouts with many concurrent business units.

The 25,000-per-record-type and 500-per-connection caps apply at all tiers. Tier upgrade does not solve those.

## Roadmap-sensitive limits

These are limits that customers commonly hit and that have known roadmap motion. Confirm current state with the engineering team before quoting:

- **25,000 records per record type:** roadmap target is 50,000. Frame to customers as "we are working on raising this; the realistic path is double the current cap, not unlimited."
- **500 connections per record (multi-select, non-hierarchy):** no roadmap motion to raise this is committed; it is architecturally significant. Treat exception requests as design problems.
- **200 RPM API rate:** no public roadmap motion; defensible for the product category.

## Known escalation patterns

- **500-connection cap on day-one go-live:** customers whose implementation partner built a solution that hits the 500-connection cap on day one of go-live, despite the limit being documented and the risk being known. Solution-architecture issue, not a limit issue. Reference framing: "If it were just a matter of asking to increase them, why would we have them in the first place?"
- **Customer requests for P95 data ahead of meetings:** standard prep is to share the published limits page plus internal telemetry framed as observed production behavior, not as a contractual SLA.
- **Enterprise customers in ongoing scale conversations:** apply the standard limit-vs-design reframe. Common in regulated industries (healthcare, financial services) where customers may be at the edge of one or more caps.
