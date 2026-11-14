# Adobe for Developers

Search the [developer.adobe.com](https://developer.adobe.com/) docs. Manage [Adobe Developer Console](https://developer.adobe.com/console) projects, workspaces, APIs, and credentials. Create and test I/O Events registrations and subscriber defined filters.

The plugin connects to the hosted Adobe for Developers MCP server at `https://adp-connector.adobe.io/mcp`. On first use, your client opens an Adobe IMS sign-in.

## Install

### Claude Code

```bash
/plugin marketplace add adobe/skills
/plugin install adobe-for-developers@adobe-skills
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add adobe/skills
copilot plugin install adobe-for-developers@adobe-skills
```

## What it includes

| Component | Path | Purpose |
| --------- | ---- | ------- |
| MCP server | [`.mcp.json`](.mcp.json) | Registers the hosted `adobe-for-developers` MCP server |
| Skills | [`skills/`](skills/) | Guided Developer Console, I/O Events, and documentation flows |
| Approval hook | [`hooks/`](hooks/) | Asks before destructive Developer Console tools run (Claude Code, Copilot CLI) |

| Skill | Use it to |
| ----- | --------- |
| `dev-console-context` | Browse orgs, projects, workspaces, and credentials, and keep track of the current context |
| `dev-console-create-project` | Create a Developer Console project, either a default one or an App Builder template project |
| `dev-console-subscribe-api` | Find an API, create a credential, choose a product profile, and subscribe the API |
| `dev-console-unsubscribe-api` | Remove an API from a credential |
| `io-events-registration` | Create, update, enable or disable, delete, trace, and debug event registrations |
| `io-events-filtering` | Manage subscriber-defined filters and send or inspect sample events |
| `search-adobe-developer-docs` | Answer questions from Adobe developer documentation |

## Destructive-tool approvals

Tools that delete a project, workspace, credential, event registration, or subscriber filter, or that remove an API from a credential, ask for your approval before they run. These actions cannot be undone.
In Claude Code and GitHub Copilot CLI, the plugin's `PreToolUse` hook asks even when a tool is on an allow list.
