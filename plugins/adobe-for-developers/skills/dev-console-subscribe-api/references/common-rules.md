# Common Skill Rules

Read and apply these rules before following any skill workflow. Skill-specific steps define which response fields are needed and how to use them.

- **Show only what the user needs** — present only the information the skill explicitly tells you to show. Tool responses may contain extra fields (internal IDs, metadata, timestamps, status codes, raw payloads, or anything else not described in the skill). Do not display, summarize, or interpret those extra fields, and do not draw conclusions or take actions based on them. Errors are the exception: report them as described in the skill. For documentation search, use only passages relevant to the question, plus the title and source URL for each passage used; do not interpret or display scores, IDs, or collection metadata.
- **Schema-compliant values** - all defaulted, suggested, derived, or auto-filled tool inputs must conform to the target tool's input schema, including supported arguments, required fields, types, allowed values, formats, and character or length constraints. Consult the tool schema as the source of truth; this shared requirement applies to every tool call without restating schema constraints in individual skill steps.

## Options and Selections

- **Validate options before prompting** - before presenting any choices, including hardcoded menus, reuse relevant context and current tool results or call the necessary read-only list, detail, or capability APIs to determine which options are actually applicable to the selected organization, project, workspace, and requested operation. Follow pagination when needed to establish availability. Remove unavailable, unsupported, irrelevant, and duplicate choices.
- **Reuse resolved choices** - if the user has already specified an applicable choice, or the workflow defines an automatic default, continue without asking again. Validate against available API metadata and tool schemas; do not infer availability from an example menu.
- **Auto-select single options** — when exactly one applicable option remains (for example, one organization, project, workspace, credential, API, product profile, or collection), do not ask the user to choose. Select it automatically and briefly explain why. For example: "Using workspace **Production** - it's the only workspace in this project." Ask for a selection only when multiple meaningful choices remain unresolved.
- **Do not offer empty paths** - if a successful check confirms there are no applicable options, do not show an empty picker or offer an unavailable path. Follow an already-authorized prerequisite setup flow when needed to fulfill a provisioning request: for example, if subscribing to an API requires a project and `get_projects` confirms none exist, continue with `dev-console-create-project` without asking "existing or new?". Do not create resources for information-only requests, requests to manage existing resources, or an explicitly requested existing target that could not be found; explain the situation instead.
- **Check safely and surface uncertainty** - API failures are not empty results. Report lookup errors rather than treating them as proof that no resources exist. If availability cannot be established from the available read-only APIs, tool schemas, or official documentation, explain the limitation and clarify only what is needed; do not invent capability fields or promise unverified options. Never create, update, delete, or send a test event just to probe whether an option is supported.

Automatic option selection does not replace required free-text input, terms acceptance, or approval of changes and deletions. Missing user-supplied configuration, such as a webhook URL or AWS account, is not by itself proof that a supported setup option is unavailable; collect it when that option is selected.

## Names, Titles, and Descriptions

- **Use context, then generate, then default** - for new resources, first reuse valid names, titles, and descriptions already supplied by the user for that resource in the conversation. Generate missing fields from the user's stated intent and known context, such as the project, API, credential type, event provider, delivery type, or validated filter expression. If a meaningful name cannot be generated, use the default below. Use the resolved name directly; do not ask the user to supply or suggest a name, choose from suggestions, or confirm the naming choice.
- **Follow the resource's conventions** - follow any resource-specific naming pattern in the skill. Keep display names and titles friendly and descriptive, for example "Analytics Integration", "Illustrator Webhook Events", or "Completed Orders Filter". Distinguish machine names from readable titles: a project can use `name: "AnalyticsIntegration"` and `title: "Analytics Integration"`. If only a title is supplied, derive a valid machine name; if only a valid machine name is supplied, derive a readable title. Briefly show the chosen display name or title when creating the resource or reporting success; do not add a naming-confirmation step.
- **Keep descriptions factual** - generate a short description of the known purpose or configuration, without inventing requirements or behavior. If an optional description cannot be grounded in the available context, omit it. If a description is required and cannot be derived accurately, ask only for the missing information.
- **Use default names without confirmation** - if a meaningful name cannot be generated, use a resource-appropriate default such as "My Project", "My Credential", "My Event Registration", or "My Filter", formatted to satisfy the tool's constraints. For a project, use `name: "MyProject"` and `title: "My Project"`. Proceed with the default without a naming prompt. Do not invent a placeholder description.
- **Handle invalid supplied metadata explicitly** - if an explicitly supplied value violates the tool's constraints, explain the constraint rather than silently changing, truncating, or substituting that value.
- **Preserve metadata on updates** - keep existing names, titles, and descriptions unless the user requests changes to those fields. Updating an API subscription, event selection, delivery setting, or filter expression is not permission to rename the resource or rewrite its description. Do not ask whether to keep unchanged metadata.

Automatic naming does not replace required choices, connection details, terms acceptance, or approval of changes and deletions. Never invent callback URLs, domains, webhook destinations, account details, or filter conditions to avoid asking the user.

## Console and Event Workflows

- **Do not assume undocumented behavior** — if a behavior, field, or API detail needed by the workflow is unclear or not covered in the skill, call `search_adobe_docs` to look it up in official Adobe documentation before proceeding.
- Never ask for information you can fetch automatically.
- When a skill requires displaying IDs, always pair each ID with its name; never show a raw ID alone. If the skill calls for names only, keep IDs internal.
- Whenever `get_credentials` is called, immediately call `get_credential_services` for each returned credential before presenting credentials or subscriptions. Use only credentials returned for the selected workspace; do not include org-level credentials.
- If a tool response includes `console_url`, display it as a clickable link: `🔗 View in Adobe Developer Console: {console_url}`.

## I/O Events Workflows

- Never show `client_secret` values.
- Never guess `event_code` or `provider_id`; always fetch them from the API.
