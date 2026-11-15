# Adobe Skills for AI Coding Agents

Skills that teach AI coding agents to work with Adobe products. A skill is a folder with a `SKILL.md` that an agent loads when a task calls for it ([agentskills.io](https://agentskills.io)). The skills are grouped into plugins, one per product or job, and are installed straight from the `main` branch of this repository.

## Install

Pick plugins from the [table below](#plugins). The first column is the name to install.

### Claude Code

```bash
/plugin marketplace add adobe/skills
/plugin install aem-edge-delivery-services@adobe-skills
```

### GitHub Copilot CLI

Copilot reads the plugin manifests in this repository, so the same marketplace works there (verified 2026-09-17 with Copilot CLI 1.0.85 and the `stardust` plugin). Copilot in VS Code and the cloud agent pick the plugins up too.

```bash
copilot plugin marketplace add adobe/skills
copilot plugin install aem-edge-delivery-services@adobe-skills
```

Copilot CLI exposes a skill under its bare name, without the plugin as a prefix, so two installed plugins with a same-named skill are ambiguous there. `aem-cloud-service` and `aem-6-5-lts` share skill names: install the one that matches your runtime. Copilot CLI does not resolve plugin dependencies; install them yourself.

### Google Antigravity

Antigravity installs a plugin from the URL of its directory (verified 2026-11-15 with Antigravity CLI 1.5.9). A plugin's directory is the one its link in the [table below](#plugins) leads into: `plugins/aem/edge-delivery-services` for `aem-edge-delivery-services`.

```bash
agy plugin install https://github.com/adobe/skills/tree/main/plugins/aem/edge-delivery-services
agy plugin list
```

`agy plugin install https://github.com/adobe/skills` installs the plugins that lie directly under `plugins/` in one go. The AEM, Commerce and Creative Cloud plugins lie deeper and need their own URL.

What you get this way is the skills:

- Antigravity does not register a plugin's MCP server and does not run its hooks. See [what each plugin needs](#plugins).
- It does not install the plugins a plugin depends on.
- It loads the first 24,000 bytes of a `SKILL.md`, which cuts the longest skills short ([#665](https://github.com/adobe/skills/issues/665)).

`agy plugin import claude` copies the plugins you have installed in Claude Code. That does bring their MCP servers, but not every hook. For `adobe-for-developers` it brings the tools that delete Developer Console resources without the hook that asks before they run ([#666](https://github.com/adobe/skills/issues/666)).

### Any agent that reads skills

```bash
npx skills add adobe/skills --list           # list the skills
npx skills add adobe/skills --skill aem-cli  # install one
npx skills add adobe/skills --all            # install all
```

```bash
gh extension install ai-ecoverse/gh-upskill
gh upskill adobe/skills --all
```

These copy skills, not plugins: an MCP server, a hook or a dependency that a plugin brings does not come with them. See [what each plugin needs](#plugins).

### Cursor (preview)

`app-builder` has a Cursor manifest as the pilot for Cursor distribution. Its [README](plugins/app-builder/README.md#cursor-preview) has the steps.

## Plugins

| Plugin | What it is for | What it needs |
| --- | --- | --- |
| [`adobe-analytics`](plugins/adobe-analytics/README.md) | KPI monitoring, funnels, segment comparison and readouts in Adobe Analytics | [MCP server](#mcp-servers-and-the-clients-they-work-with) |
| [`adobe-cja`](plugins/adobe-cja/README.md) | The same for Customer Journey Analytics, plus dimension analysis | [MCP server](#mcp-servers-and-the-clients-they-work-with) |
| [`adobe-for-developers`](plugins/adobe-for-developers/README.md) | Search developer.adobe.com; manage Developer Console projects, credentials and I/O Events | [MCP server](#mcp-servers-and-the-clients-they-work-with) |
| [`aem-edge-delivery-services`](plugins/aem/edge-delivery-services/README.md) | Build sites on Edge Delivery Services: blocks, content models, local development, page import | Node.js. Some skills use a Figma or DA MCP server if one is connected |
| [`aem-eds-content-ops`](plugins/aem/edge-delivery-services-content-ops/skills) | Content operations on Edge Delivery Services: audits, SEO, accessibility, metadata, sitemaps | |
| [`aem-forms-edge-delivery-services`](plugins/aem/forms/edge-delivery-services/README.md) | Custom components for the Form block on Edge Delivery Services | Node.js |
| [`aem-project-management`](plugins/aem/project-management/README.md) | Handover documentation and PDF guides for Edge Delivery Services projects | Plugin hooks, which not every client runs |
| [`aem-cloud-service`](plugins/aem/cloud-service/README.md) | AEM as a Cloud Service: components, Dispatcher, workflows, migration from AEM 6.x | [MCP servers](#mcp-servers-and-the-clients-they-work-with) for Dispatcher and migration findings |
| [`aem-6-5-lts`](plugins/aem/6.5-lts/README.md) | AEM 6.5 LTS and AMS: Dispatcher, workflows, replication | [MCP server](#mcp-servers-and-the-clients-they-work-with) for Dispatcher |
| [`app-builder`](plugins/app-builder/README.md) | App Builder projects: actions, UI, tests, CI/CD, Workfront UI extensions | `aio` CLI, Node.js |
| [`commerce-app-management`](plugins/commerce/app-management/README.md) | Scaffold and configure Adobe Commerce apps with the `aio-commerce-sdk` | `aio` CLI, Node.js 22 |
| [`commerce-app-migration`](plugins/commerce/app-migration/README.md) | Move a Commerce starter-kit project to App Management | |
| [`commerce-app-review`](plugins/commerce/app-review/README.md) | Review a Commerce app before submitting it to Adobe Exchange | |
| [`run-workflow`](plugins/creative-cloud/run-workflow/skills) | Run and compose Adobe Firefly workflows | [MCP server](#mcp-servers-and-the-clients-they-work-with); enterprise account with a Firefly entitlement |
| [`semrush`](plugins/semrush/README.md) | Competitive SEO data for any domain from Semrush | [MCP server](#mcp-servers-and-the-clients-they-work-with); Semrush account |
| [`stardust`](plugins/stardust/README.md) | Modernise an existing website, with or without a redesign, and ship it | The `impeccable` plugin from its own marketplace; Node.js 22, Playwright |
| [`web`](plugins/web/skills) | Browser automation and page analysis for arbitrary sites | Node.js 22, `playwright-cli` |
| [`workfront`](plugins/workfront/README.md) | Workfront Planning solution architecture; Fusion scenario review | |

A plugin's skills are the folders under its `skills/` directory, and each `SKILL.md` starts with what the skill is for. This file does not list them, so that it does not go stale: the plugin's own README does where there is one, and `npx skills add adobe/skills --list` prints them all.

One more plugin is in this repository but not in its marketplace: [`adobe-for-creativity`](plugins/creative-cloud/adobe-for-creativity/skills), Adobe Creative Cloud tools for images, design and video. It is installed from the plugin directory of the Claude desktop app; see the next section for why.

## MCP servers and the clients they work with

Some plugins are skills on top of an MCP server. Whether such a plugin works depends on the server and on the agent you use, the MCP client, and not every pairing works today.

| Plugin | MCP server | What the client has to do | Known limits |
| --- | --- | --- | --- |
| `adobe-for-creativity` | `https://adobe-creativity.adobe.io/mcp`, registered by the plugin | Be the Claude desktop app or Claude Cowork | Every other client, Claude Code CLI included, gets a bare `403`, also for the OAuth discovery documents, so sign-in cannot start. There are no plans to support the CLI ([#184](https://github.com/adobe/skills/issues/184), [#225](https://github.com/adobe/skills/issues/225), [#391](https://github.com/adobe/skills/issues/391)) |
| `run-workflow` | `https://run-workflow.adobe.io/mcp`, registered by the plugin | Standard OAuth: discovery and the `401` challenge work | Sign-in succeeds only for an enterprise account with a Firefly Services or Firefly Creative Production entitlement. A personal Adobe account signs in and is then refused ([#365](https://github.com/adobe/skills/issues/365)) |
| `adobe-analytics`, `adobe-cja` | `https://aa-mcp.adobe.io/mcp`, `https://cja-mcp.adobe.io/mcp` | Send Adobe IMS headers with every request: `Authorization`, `x-gw-ims-org-id`, `x-gw-ims-user-id` | The plugin's `.mcp.json` is a template without those headers. Use a client that can add headers to an MCP server, or an OAuth proxy that injects them |
| `adobe-for-developers` | `https://adp-connector.adobe.io/mcp`, registered by the plugin | Open the Adobe IMS sign-in on first use | The destructive Developer Console tools ask for approval before they run. The hook that asks even when a tool is on an allow list runs in Claude Code and Copilot CLI only. It does not run in Antigravity, also not after `agy plugin import claude` has brought the server there ([#666](https://github.com/adobe/skills/issues/666)) |
| `semrush` | `https://mcp.semrush.com/v2/mcp`, which you add to your agent yourself | OAuth with a redirect URI that Semrush allows. `http://localhost:<port>` and Claude's own callback were accepted | A client whose OAuth callback is on its vendor's domain is refused at registration. The `401` carries no `WWW-Authenticate` header, so the client has to find the metadata at the well-known paths ([details](plugins/semrush/skills/semrush/references/protocol.md)) |
| `aem-cloud-service` | [Dispatcher MCP](https://github.com/AdobeDocs/aem-dispatcher-mcp), run locally with `AEM_DEPLOYMENT_MODE=cloud`; the AEM MCP Server for migration findings from Cloud Acceleration Manager | Run a local MCP server; connect the AEM MCP Server | Migration works without the AEM MCP Server, from a Best Practices Analyzer CSV |
| `aem-6-5-lts` | Dispatcher MCP with `AEM_DEPLOYMENT_MODE=ams` | Run a local MCP server | [#519](https://github.com/adobe/skills/issues/519) reports that no Dispatcher MCP for AMS is available today. Without it the Dispatcher skills can advise but not verify |
| `aem-edge-delivery-services`, `workfront` | None of their own | Nothing | `figma-to-content` needs a Figma MCP server from your client. A DA or Workfront Planning MCP server is used when one is connected |

The other plugins use no MCP server.

Two things hold for every plugin with an MCP server:

- A plugin registers its server only in a client that installs plugins: Claude Code, Copilot CLI, the Claude desktop app. With `npx skills` or `gh upskill` you get the skills and have to add the server to your agent yourself. The same goes for `agy plugin install` in Antigravity.
- These servers sign you in with Adobe IMS or the vendor's OAuth. A client without a browser at hand, such as a headless or cloud agent, cannot complete that sign-in.

## What each client loads

CI installs every plugin a pull request changes into four clients, each with an empty home directory, and reports what the client then lists (the `Plugin Test Drive` check). With all plugins on 2026-11-15:

| Client | Skills | MCP servers | Hooks |
| --- | --- | --- | --- |
| Claude Code 2.1.322 | All | Registered | Loaded |
| Codex CLI 0.169.0 | All | Registered | Not checked: Codex has no command that lists them |
| Grok CLI 1.0.77 | All. For `aem-cloud-service` and `aem-6-5-lts` also the skills in deeper folders, which the other clients reach only through the skill above them | Registered | Loaded |
| Antigravity CLI 1.5.9 | All | Not registered | Not loaded |

Listed is not the same as working: no client was signed in, and no hook or MCP server was called. `adobe-for-creativity` is not in the marketplace, so only Grok and Antigravity, which install from a directory, were given it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add or change a skill, and [AGENTS.md](AGENTS.md) for the rules the review checks. Join [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Adobe Slack for questions.

## Resources

- [agentskills.io specification](https://agentskills.io)
- [Claude Code plugins](https://code.claude.com/docs/en/discover-plugins)
- [Google Antigravity plugins](https://antigravity.google/docs/plugins)
- [Vercel skills CLI](https://github.com/vercel-labs/skills)
- [upskill GitHub extension](https://github.com/ai-ecoverse/gh-upskill)

## License

Apache 2.0. See [LICENSE](LICENSE).
