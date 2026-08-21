# Q&A Format Reference: Migration Agents

This file documents how domain agents format unresolved questions and how the
main orchestrator presents them to the developer.

---

## UnresolvedQuestion Format

Each domain agent includes `unresolvedQuestions` in its DomainResult:

```json
{
  "id": "events.provider.label",
  "prompt": "What label should the Commerce event provider have?",
  "default": "Commerce Provider"
}
```

- **id**: dot-notation path matching the config field it resolves, e.g.
  `events.provider.label` → `eventing.commerce[0].provider.label`
- **prompt**: shown verbatim to the developer
- **default**: if present, shown as `(suggested: X)` and accepted on Enter

---

## Orchestrator Presentation Format

The orchestrator groups questions by domain and presents them in a single session:

```
I need a few details I couldn't determine automatically.

── Events ────────────────────────────────────────────────
1. What label should the Commerce event provider have?
   (suggested: Commerce Provider)

── Webhooks ──────────────────────────────────────────────
2. The script "scripts/onboarding/setup.js" handles both webhooks and
   event subscriptions. Should I split it into two customInstallationSteps,
   or keep it as one?
   Options: [split / keep-as-one]

Press Enter to accept suggested values, or type your answer.
```

---

## Rules for Domain Agents

When populating `unresolvedQuestions`:

1. Only add a question if the value **cannot be inferred** from existing project files.
   If a default is highly likely (>90% confidence), include it as `default` and
   the orchestrator will show it as a confirmation, not a question.

2. Use the most specific `id` possible. The orchestrator uses this to place the
   answer into the assembled config.

3. Keep prompts short and factual. No hedging language.

4. Provide `default` whenever there is a sensible fallback. This minimises
   the number of answers the developer needs to type.

5. For binary choices, phrase the prompt with explicit options inline:
   `"Options: [split / keep-as-one]"` at the end of the prompt.

---

## Common IDs

| id                                     | Config location                                       |
| -------------------------------------- | ----------------------------------------------------- |
| `events.commerce.provider.label`       | `eventing.commerce[N].provider.label`                 |
| `events.commerce.provider.description` | `eventing.commerce[N].provider.description`           |
| `events.commerce.provider.key`         | `eventing.commerce[N].provider.key`                   |
| `events.external.provider.label`       | `eventing.external[N].provider.label`                 |
| `webhooks.step.N.name`                 | `installation.customInstallationSteps[N].name`        |
| `webhooks.step.N.description`          | `installation.customInstallationSteps[N].description` |
| `adminUiSdk.menuItem.N.title`          | `adminUiSdk.registration.menuItems[N].title`          |
| `businessConfig.field.N.label`         | `businessConfig.schema[N].label`                      |
| `businessConfig.field.N.type`          | `businessConfig.schema[N].type`                       |
