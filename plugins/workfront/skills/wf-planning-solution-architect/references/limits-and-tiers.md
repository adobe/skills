# Limits and tiers reference

Practitioner reference for Workfront Planning object limits, organized by tier. Use this when a customer asks about capacity, when sizing a new deployment, or when an escalation hits a limit and a "raise it" request comes in.

Source of truth: the Planning "Limitations overview" page on Adobe Experience League (find it with `node scripts/search.js limitations overview`, then fetch the `.md` URL). This file restates the limits in SA-conversation-ready form and adds tier context, framing language, and known sizing risks. Re-verify against the live page before quoting numbers in a customer commitment.

## Tier overview

Workfront Planning ships in three license tiers. Tier affects total record volume, not the per-object limits listed further down.

| Tier | Records per workspace | Total records per WFP instance |
|---|---|---|
| Select | 25,000 | 500,000 |
| Prime | 500,000 | 2,000,000 |
| Ultimate | 1,000,000 | Unlimited |

The two limits in the table above are the only ones that vary by tier. Confirm the customer's tier before quoting either of them, or when sizing a deployment; every other limit below is the same on all three tiers and can be answered directly. Customers and AMs sometimes do not know which tier is provisioned. The provisioning system or account team record is authoritative.

## Object limits (apply to all tiers unless noted)

### Workspace-level
- Workspaces per Workfront instance: unlimited (Adobe recommends against fragmentation).
- Sections per workspace: 50.
- Record types per workspace: 100 (includes record types from all sections and template-created ones).
- Records per record type: 25,000. **This is the hard ceiling for any single record type, regardless of tier.**
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
- If the risk was raised during design and not acted on, say so plainly; it is the strongest argument for redesigning now rather than raising the cap again.

### When a customer asks for performance numbers
Workfront Planning does not publish a public P95 / SLA contract. Where performance figures are available to you, present them as observed behavior, subject to whatever approval your organization requires:
- Commonly used Planning APIs run in the low hundreds of milliseconds P95, server-side.
- Read endpoints (record type and breadcrumb fetches) are the fastest; record fetch, workspace fetch, and record search are slower, with search the most variable.
- Confirm current figures with Adobe before quoting anything specific. Do not quote numbers from this file or from memory.

These are backend server-side response times, not browser-perceived page loads, and they are not contractual. Frame as observed behavior, not SLA.

### When a customer asks about tier upgrade triggers
Common triggers for moving from Select to Prime:
- Approaching 25,000 records per workspace (the Select cap).
- Heavy multi-workspace use with shared taxonomies (the central-hub pattern works better with Prime headroom).
- Anticipated growth above 500,000 total records per instance.

Common triggers for moving from Prime to Ultimate:
- Total records per instance approaching 2M.
- Enterprise rollouts with many concurrent business units.

The 25,000-per-record-type and 500-per-connection caps apply at all tiers. Tier upgrade does not solve those.

## Limits customers commonly hit

Adobe documents these limits as subject to change, and does not publish targets for raising them. Do not speculate about future values; check the current published limits page for what applies today.

- **25,000 records per record type:** the hard ceiling for a single record type. Treat it as a sizing input when modelling, not as something to plan around raising.
- **500 connections per record (multi-select, non-hierarchy):** architecturally significant. Treat exception requests as design problems.
- **200 RPM API rate:** defensible for the product category; separate service accounts are the answer for bulk traffic.

## Common scaling problems

- **500-connection cap reached at go-live:** hitting a documented cap on day one signals a modelling problem, not a capacity problem. A genuine capacity limit is reached after growth, not before real data exists. Useful framing: "If it were just a matter of asking to increase them, why would we have them in the first place?"
- **Customer requests for P95 data ahead of meetings:** lead with the published limits page, and present any performance figures as observed behavior rather than a contractual SLA.
- **Enterprise customers in ongoing scale conversations:** apply the standard limit-vs-design reframe. Common in regulated industries (healthcare, financial services) where customers may be at the edge of one or more caps.
