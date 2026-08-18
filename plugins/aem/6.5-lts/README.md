# AEM 6.5 LTS Plugin

Skills for developing and operating AEM 6.5 LTS and Adobe Managed Services (AMS) projects — Dispatcher configuration, workflows, replication, and project bootstrap.

---

## Installation

**Claude Code:**

```bash
/plugin marketplace add adobe/skills
/plugin install aem-6-5-lts@adobe-skills
```

---

## Skills

<table>
<thead>
<tr>
  <th>Skill</th>
  <th>Description</th>
  <th>Try it</th>
</tr>
</thead>
<tbody>
<tr>
  <th colspan="3" align="left">Bootstrap</th>
</tr>
<tr>
  <td><a href="skills/ensure-agents-md/SKILL.md">ensure-agents-md</a></td>
  <td>Auto-generates <code>AGENTS.md</code> and <code>CLAUDE.md</code> for AEM 6.5 LTS projects when missing — tailored to discovered modules, add-ons, and Dispatcher layout. Runs first, before any other work.</td>
  <td><ul><li><code>Set up my AEM 6.5 project for AI agents</code></li></ul></td>
</tr>
<tr>
  <th colspan="3" align="left">Dispatcher — <em>Config authoring, advisory, performance, security, and incident response. Requires <a href="https://github.com/AdobeDocs/aem-dispatcher-mcp">Dispatcher MCP</a> (<code>AEM_DEPLOYMENT_MODE=ams</code>).</em></th>
</tr>
<tr>
  <td><a href="skills/dispatcher/config-authoring/SKILL.md">config-authoring</a></td>
  <td>Create, modify, review, and harden Dispatcher config files (<code>.any</code>, vhost, rewrite, cache, filter) for AEM 6.5 LTS and AMS</td>
  <td><ul><li><code>Add a new vhost for my AMS site</code></li><li><code>Review my dispatcher cache rules</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/technical-advisory/SKILL.md">technical-advisory</a></td>
  <td>Conceptual guidance on <code>statfileslevel</code>, filter rules, URL decomposition, cache invalidation, rewrite behavior, and security headers</td>
  <td><ul><li><code>Explain statfileslevel for my AMS setup</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/incident-response/SKILL.md">incident-response</a></td>
  <td>Investigate runtime incidents, failures, and cache anomalies on AMS Dispatcher</td>
  <td><ul><li><code>My pages are returning 403 on the AMS dispatcher</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/performance-tuning/SKILL.md">performance-tuning</a></td>
  <td>Optimize Dispatcher cache efficiency, latency, and throughput for AMS environments</td>
  <td><ul><li><code>Tune my AMS dispatcher cache</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/security-hardening/SKILL.md">security-hardening</a></td>
  <td>Security audits, threat models, exposure control, and header hardening for AMS Dispatcher</td>
  <td><ul><li><code>Harden my AMS dispatcher security headers</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/workflow-orchestrator/SKILL.md">workflow-orchestrator</a></td>
  <td>Orchestrate complete Dispatcher lifecycle from design through validation and incident troubleshooting</td>
  <td><ul><li><code>Walk me through AMS dispatcher setup end-to-end</code></li></ul></td>
</tr>
<tr>
  <th colspan="3" align="left">Workflow — <em>Granite Workflow Engine lifecycle with JMX, Felix Console, and direct log access.</em></th>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-model-design/SKILL.md">workflow-model-design</a></td>
  <td>Design workflow models — step types, variables, OR/AND splits</td>
  <td><ul><li><code>Design an approval workflow with OR split</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-development/SKILL.md">workflow-development</a></td>
  <td>Implement custom WorkflowProcess steps, ParticipantStepChooser, OSGi service registration</td>
  <td><ul><li><code>Create a custom workflow process step</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-triggering/SKILL.md">workflow-triggering</a></td>
  <td>Start workflows via Timeline UI, WorkflowSession API, HTTP API, Manage Publication, or replication triggers</td>
  <td><ul><li><code>How do I trigger a workflow on content activation?</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-launchers/SKILL.md">workflow-launchers</a></td>
  <td>Configure Workflow Launchers that auto-start workflows on JCR content changes</td>
  <td><ul><li><code>Set up a launcher for asset uploads</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-debugging/SKILL.md">workflow-debugging</a></td>
  <td>Debug stuck workflows, failed steps, missing Inbox tasks, thread pool exhaustion, queue backlogs — with JMX and direct log access</td>
  <td><ul><li><code>My workflow is stuck — help debug</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-triaging/SKILL.md">workflow-triaging</a></td>
  <td>Classify workflow incidents, gather JMX/Splunk data, and map to runbooks</td>
  <td><ul><li><code>Triage this workflow failure</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-orchestrator/SKILL.md">workflow-orchestrator</a></td>
  <td>End-to-end workflow lifecycle orchestration across all sub-skills</td>
  <td><ul><li><code>Build a complete content approval workflow</code></li></ul></td>
</tr>
<tr>
  <th colspan="3" align="left">Replication — <em>Content distribution lifecycle from agent configuration to troubleshooting.</em></th>
</tr>
<tr>
  <td><a href="skills/aem-replication/configure-replication-agent/SKILL.md">configure-replication-agent</a></td>
  <td>Configure replication agents for publishing, dispatcher flush, and reverse replication</td>
  <td><ul><li><code>Set up a dispatcher flush agent</code></li><li><code>Configure reverse replication</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-replication/replicate-content/SKILL.md">replicate-content</a></td>
  <td>Activate and deactivate content using UI, workflows, and package manager</td>
  <td><ul><li><code>How do I activate a page tree?</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-replication/replication-api/SKILL.md">replication-api</a></td>
  <td>Use the Replication API programmatically in custom code — 57 Java examples for OSGi services, servlets, and workflow steps</td>
  <td><ul><li><code>Publish content programmatically from a servlet</code></li><li><code>Show me bulk replication examples</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-replication/troubleshoot-replication/SKILL.md">troubleshoot-replication</a></td>
  <td>Diagnose and fix blocked queues, connectivity failures, and distribution problems — 12+ troubleshooting scenarios</td>
  <td><ul><li><code>My replication queue is blocked</code></li><li><code>Content is not appearing on publish</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-replication/replication-orchestrator/SKILL.md">replication-orchestrator</a></td>
  <td>End-to-end replication lifecycle orchestration across all sub-skills — new environment setup, production incidents, performance optimization, and migration preparation</td>
  <td><ul><li><code>Set up replication for a new AEM 6.5 environment end-to-end</code></li></ul></td>
</tr>
</tbody>
</table>
