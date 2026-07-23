# AI Assistant in Workfront (parent product)

Source: https://experienceleague.adobe.com/en/docs/workfront/using/basics/ai-assistant/ai-assistant-overview
Last update: March 4, 2026

This is the broader Workfront AI Assistant (not Planning-specific). Same icon, different scope per page context. Documented here because the SA conversation often spans both.

## Capabilities
- Summarize projects, tasks, issues, documents.
- Pull instructions and reference info from Experience League docs.
- Locate items in Workfront.
- Generate/refine formulas for calculated custom fields. **Prime or Ultimate only.**
- Catch-up summaries in Priorities (24h / 3d / 7d windows).

## Access requirements
- Workfront package: Select or higher.
- Workfront license: Standard.

## Org-level prerequisites (ALL must apply)
- Migrated to Adobe IMS.
- Adobe Unified Experience enabled.
- Workfront plan: Select, Prime, or Ultimate.
- Signed Adobe Gen AI agreement on file with Adobe.

## Gen AI agreement workflow
1. Admin clicks AI Assistant icon and starts typing.
2. If unsigned, the "Review agreement" prompt appears.
3. Admin enters name + email of organization signer.
4. Adobe sends agreement → signer signs and returns → Adobe reviews and enables (1-3 business days after return).

## Object types accessible
Portfolios, Programs, Projects, Tasks, Issues, Custom forms, Users, Workfront Planning records.

## Sub-features and their separate docs
- Summarize: `/basics/ai-assistant/summarize-this`
- Get help (docs lookup): `/basics/ai-assistant/use-ai-to-retrieve-instructions`
- Work with projects/tasks/issues: `/basics/ai-assistant/work-with-pti-through-ai-assisant`
- Formula assistance: `/basics/ai-assistant/use-ai-assistant-to-check-formulas` (Prime/Ultimate)
- Catch up in Priorities: `/basics/priorities/catch-me-up`

## Keyword routing
- `using workfront` — core Workfront context.
- `using planning` — Planning context (only available FROM Planning pages).
- `using help` — Experience League docs.
- `using formula` — formula generation. Planning + Setup + Custom form builder only.
- `using health` — Project Health Advisor.
- `using summarize` — summarization.

## Constraints
- English only.
- AI Assistant is enabled per access level by the Workfront admin. Not on by default for all users even after org-level enable.

## SA notes
- **The Gen AI agreement is the single hardest gate.** Many enterprise customers (especially regulated industries: pharma, finance, gov) have not signed it and may never sign it. Confirm signed status before any AI conversation with these customers — otherwise the entire "AI-native" pitch is hypothetical for them.
- **Plan-tier gating on formula generation** is one of the more frequent "feature missing" complaints. Select customers ask why their AI Assistant won't write formulas. Answer: it's a plan-tier limitation, not a bug.
- **"AI Assistant in Workfront" vs "AI Assistant in Workfront Planning"** are different feature sets sharing one UI surface. Be precise about which one a customer is asking about. The keyword routing (`using workfront` vs `using planning`) is how the system disambiguates internally.
- **Priorities catch-up summaries** are underused by customers. Worth highlighting in EBR conversations — they map directly to the "I missed a week" pain that motivates manual digests today.
