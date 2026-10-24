# Adobe for Developers

Helps developers complete common Adobe developer workflows from Claude, including Documentation Search, Developer Console project, API management and Adobe I/O Events setup.

The plugin connects to the hosted ADP Connector MCP server at `https://adp-connector.adobe.io/mcp`. On first use, your client opens an Adobe IMS sign-in.

## Install

### Claude Code

```bash
/plugin marketplace add adobe/skills
/plugin install adp-connector@adobe-skills
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add adobe/skills
copilot plugin install adp-connector@adobe-skills
```

## What it includes

| Component | Path | Purpose |
| --------- | ---- | ------- |
| MCP server | [`.mcp.json`](.mcp.json) | Registers the hosted `adp-connector` server |
| Skills | [`skills/`](skills/) | Guided Developer Console, I/O Events, and documentation flows |
| Approval hook | [`hooks/`](hooks/) | Asks before destructive Developer Console tools run (Claude Code, Copilot CLI) |

| Skill | Use it to |
| ----- | --------- |
| `dev-console-context` | Browse orgs, projects, workspaces, and credentials, and keep track of the current context |
| `dev-console-subscribe-api` | Find an API, create a credential, choose a product profile, and subscribe the API |
| `io-events-registration` | Create, update, enable or disable, delete, trace, and debug event registrations |
| `io-events-filtering` | Manage subscriber-defined filters and send or inspect sample events |
| `search-adobe-developer-docs` | Answer questions from Adobe developer documentation |

## Destructive-tool approvals

These tools permanently delete or remove Developer Console resources:

- `delete_credential`
- `delete_event_registration`
- `delete_project`
- `delete_subscriber_filter`
- `delete_workspace`
- `unsubscribe_credential_from_service`

The server marks them as destructive. In Claude Code and GitHub Copilot CLI the plugin's `PreToolUse` hook also asks for approval, even when a tool is on an allow list.
