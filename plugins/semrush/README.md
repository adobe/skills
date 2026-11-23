# Semrush

Competitive SEO data for any domain, your own or a competitor's: keyword volume and difficulty, the keywords and pages a domain ranks for, organic competitors and keyword gaps, backlink profiles, traffic estimates, and project-backed site audits. Requires a Semrush account. The skill uses the hosted Semrush MCP server (`https://mcp.semrush.com/v2/mcp`, OAuth sign-in), which you register with your agent once; reports spend the account's API units.

```bash
/plugin install semrush@adobe-skills
```

| Skill | Description |
| ----- | ----------- |
| `semrush` | The three-step call protocol of the Semrush MCP server, the parameters of each report, what each call costs, and how to read the numbers<br>• `What keywords does example.com rank for in the US?`<br>• `Who competes with us in organic search, and where are the keyword gaps?`<br>• `Compare the backlink profiles of these three domains` |

The folders under [`skills/`](skills/) are the complete list of skills.
