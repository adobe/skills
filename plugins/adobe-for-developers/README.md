# Adobe for Developers

Search the [developer.adobe.com](https://developer.adobe.com/) docs. Manage [Adobe Developer Console](https://developer.adobe.com/console) projects, workspaces, APIs, and credentials. Create and test I/O Events registrations and subscriber-defined filters. Set up, build, deploy, and troubleshoot App Builder apps.

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
| Skills | [`skills/`](skills/) | Guided Developer Console, I/O Events, App Builder, and documentation flows |
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
| `app-builder-setup` | Check and set up the local Adobe I/O CLI, authentication, and Developer Terms |
| `app-builder-create-app` | Create and run an App Builder app or extension |
| `app-builder-deploy` | Check and deploy an App Builder app to Stage or Production |
| `app-builder-troubleshoot` | Investigate action runs and report redacted, evidence-based findings |

## Approval-required tools

The server marks the following tools as requiring approval. Deletions cannot be undone, and configuration changes have no automatic undo:

- `accept_developer_terms`
- `delete_credential`
- `delete_event_registration`
- `delete_project`
- `delete_subscriber_filter`
- `delete_workspace`
- `edit_project`
- `patch_event_registration`
- `subscribe_admin_enterprise_credential_to_services`
- `subscribe_credential_to_services`
- `unsubscribe_admin_enterprise_credential_from_service`
- `unsubscribe_credential_from_service`
- `update_admin_enterprise_credential`
- `update_event_registration`
- `update_subscriber_filter`

In Claude Code and GitHub Copilot CLI, the plugin's `PreToolUse` hook asks even when a tool is on an allow list.
