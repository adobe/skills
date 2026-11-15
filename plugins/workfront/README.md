# Workfront

Solution-architecture guidance for Adobe Workfront Planning (WFP, also called Maestro). No MCP server required; public Adobe documentation is searched and fetched live from Experience League at answer time.

```bash
/plugin install workfront@adobe-skills
```

| Skill | Description |
| ----- | ----------- |
| `workfront-planning-advisory` | Workspace and record-type design, connections and hierarchies, formula fields, tier limits, and API behavior for Workfront Planning<br>• `Design a Planning workspace for our marketing team`<br>• `A customer wants us to raise the 500 connected records limit`<br>• `Is the CASE function supported in Planning formulas?` |
| `wf-planning-fusion-optimizer` | Read-only review of an exported Fusion scenario blueprint using the Workfront Planning connector: flags what's hurting run time, operations, and API call volume<br>• `Why is this Planning Fusion scenario so slow?`<br>• `Review this blueprint for rate-limit issues`<br>• `Reduce operations on our replication scenario` |

See the [`workfront-planning-advisory`](skills/workfront-planning-advisory/README.md) and [`wf-planning-fusion-optimizer`](skills/wf-planning-fusion-optimizer/README.md) docs for the routing model, reference layout, and scripts.

The folders under [`skills/`](skills/) are the complete list of skills.
