# Adobe for Developers

Search the [developer.adobe.com](https://developer.adobe.com/) docs. Manage [Adobe Developer Console](https://developer.adobe.com/console) projects, workspaces, APIs, and credentials. Create and test I/O Events registrations and subscriber defined filters. Set up, create, deploy, and troubleshoot App Builder apps with the Adobe I/O CLI.

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
| Skills | [`skills/`](skills/) | Guided App Builder, Developer Console, I/O Events, and documentation flows |
| Approval hook | [`hooks/`](hooks/) | Asks before destructive tools or Developer Terms acceptance run (Claude Code, Copilot CLI) |

| Skill | Use it to |
| ----- | --------- |
| `app-builder-setup` | Check and prepare local tooling, CLI sign-in, organization, and Developer Terms |
| `app-builder-create-app` | Scaffold an App Builder app or UI extension, build it, and run it locally |
| `app-builder-deploy` | Deploy to Stage or Production with target checks, approval, and action verification |
| `app-builder-troubleshoot` | Diagnose local failures and deployed action runs using redacted logs |
| `dev-console-context` | Browse orgs, projects, workspaces, and credentials, and keep track of the current context |
| `dev-console-create-project` | Create a Developer Console project, either a default one or an App Builder template project |
| `dev-console-subscribe-api` | Find an API, create a credential, choose a product profile, and subscribe the API |
| `dev-console-unsubscribe-api` | Remove an API from a credential |
| `io-events-registration` | Create, update, enable or disable, delete, trace, and debug event registrations |
| `io-events-filtering` | Manage subscriber-defined filters and send or inspect sample events |
| `search-adobe-developer-docs` | Answer questions from Adobe developer documentation |

## Destructive-tool approvals

Tools that delete resources, edit projects, update credentials or event configuration, or change API subscriptions ask for your approval before they run. Deletions cannot be undone; configuration changes have no automatic undo. Accepting the Adobe Developer Terms also requires explicit agreement.
In Claude Code and GitHub Copilot CLI, the plugin's `PreToolUse` hook asks even when a tool is on an allow list.

## App Builder requirements

The four App Builder skills run local helper scripts and the Adobe I/O CLI on the machine holding the app code. They require Node.js 20 or newer and Adobe I/O CLI 11.1.0 or newer; `app-builder-setup` checks these before offering fixes. The CLI sign-in is separate from the connector's sign-in. These workflows need local command execution, not just access to the hosted MCP server.
