# AEM as a Cloud Service Plugin

Skills for developing, assessing, migrating, and operating AEM as a Cloud Service projects — component development, Dispatcher configuration, workflows, code assessment, content distribution, migration from legacy AEM, and Rapid Development Environments.

---

## Installation

**Claude Code:**

```bash
/plugin marketplace add adobe/skills
/plugin install aem-cloud-service@adobe-skills
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
  <th colspan="3" align="left">Bootstrap &amp; scaffolding</th>
</tr>
<tr>
  <td><a href="skills/ensure-agents-md/SKILL.md">ensure-agents-md</a></td>
  <td>Auto-generates <code>AGENTS.md</code> and <code>CLAUDE.md</code> from <code>pom.xml</code> when missing — tailored to the project's modules and add-ons (CIF, Forms, SPA, precompiled scripts). Runs first, before any other work.</td>
  <td><ul><li><code>Set up my AEM project for AI agents</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/create-component/SKILL.md">create-component</a></td>
  <td>Create complete AEM components following Adobe best practices: component definition, dialog XML, HTL template, Sling Model, unit tests, clientlibs (component and dialog), and optional Sling Servlet for dynamic content.</td>
  <td>
<ul>
<li><code>Create a hero banner component with title, description, and CTA</code></li>
<li><code>Create a multifield FAQ component</code></li>
</ul>
</td>
</tr>
<tr>
  <th colspan="3" align="left">Dispatcher — <em>Config authoring, advisory, performance, security, and incident response. Requires <a href="https://github.com/AdobeDocs/aem-dispatcher-mcp">Dispatcher MCP</a> (<code>AEM_DEPLOYMENT_MODE=cloud</code>).</em></th>
</tr>
<tr>
  <td><a href="skills/dispatcher/config-authoring/SKILL.md">config-authoring</a></td>
  <td>Create, modify, review, and harden Dispatcher config files (<code>.any</code>, vhost, rewrite, cache, filter)</td>
  <td><ul><li><code>Add a new vhost for my site</code></li><li><code>Review my cache rules</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/technical-advisory/SKILL.md">technical-advisory</a></td>
  <td>Conceptual guidance on <code>statfileslevel</code>, filter rules, URL decomposition, cache invalidation, rewrite behavior, and security headers — with public-doc citations</td>
  <td><ul><li><code>Explain statfileslevel for my site</code></li><li><code>How does cache invalidation work?</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/incident-response/SKILL.md">incident-response</a></td>
  <td>Investigate runtime incidents, failures, probe regressions, and cache anomalies using Dispatcher MCP evidence</td>
  <td><ul><li><code>Why are my pages returning 403?</code></li><li><code>Cache hit ratio dropped — investigate</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/performance-tuning/SKILL.md">performance-tuning</a></td>
  <td>Optimize Dispatcher cache efficiency, latency, and throughput with cloud-specific baselines</td>
  <td><ul><li><code>Tune my dispatcher cache for better hit ratios</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/security-hardening/SKILL.md">security-hardening</a></td>
  <td>Security audits, threat models, exposure control, and header hardening</td>
  <td><ul><li><code>Harden my dispatcher security headers</code></li><li><code>Audit my filter rules for exposure</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/dispatcher/workflow-orchestrator/SKILL.md">workflow-orchestrator</a></td>
  <td>Orchestrate complete Dispatcher lifecycle from design through validation, release readiness, and incident troubleshooting</td>
  <td><ul><li><code>Walk me through setting up dispatcher for a new site end-to-end</code></li></ul></td>
</tr>
<tr>
  <th colspan="3" align="left">Workflow — <em>Granite Workflow Engine lifecycle: design, develop, deploy, debug.</em></th>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-model-design/SKILL.md">workflow-model-design</a></td>
  <td>Design workflow models — step types, variables, OR/AND splits, deployment through Cloud Manager pipeline</td>
  <td><ul><li><code>Design an approval workflow with OR split</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-development/SKILL.md">workflow-development</a></td>
  <td>Implement custom WorkflowProcess steps, ParticipantStepChooser, OSGi DS R6 registration</td>
  <td><ul><li><code>Create a custom workflow process step</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-triggering/SKILL.md">workflow-triggering</a></td>
  <td>Start workflows via Timeline UI, WorkflowSession API, HTTP API, or Manage Publication</td>
  <td><ul><li><code>How do I trigger a workflow programmatically?</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-launchers/SKILL.md">workflow-launchers</a></td>
  <td>Configure Workflow Launchers that auto-start workflows on JCR content changes</td>
  <td><ul><li><code>Set up a launcher for asset uploads</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-debugging/SKILL.md">workflow-debugging</a></td>
  <td>Debug stuck workflows, failed steps, missing Inbox tasks, thread pool exhaustion, queue backlogs, purge failures</td>
  <td><ul><li><code>My workflow is stuck — help debug</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-triaging/SKILL.md">workflow-triaging</a></td>
  <td>Classify workflow incidents, determine required logs, and map to Splunk queries</td>
  <td><ul><li><code>Triage this workflow failure from Cloud Manager logs</code></li></ul></td>
</tr>
<tr>
  <td><a href="skills/aem-workflow/workflow-orchestrator/SKILL.md">workflow-orchestrator</a></td>
  <td>End-to-end workflow lifecycle orchestration across all sub-skills</td>
  <td><ul><li><code>Build a complete content approval workflow</code></li></ul></td>
</tr>
<tr>
  <th colspan="3" align="left">Code quality &amp; migration</th>
</tr>
<tr>
  <td><a href="skills/code-assessment/SKILL.md">code-assessment</a></td>
  <td>Detect and fix AEM CS code-quality issues locally — Sling Model patterns (<code>@Inject</code> → injector-specific), deprecated APIs, scheduler, replication, resource listeners, unbounded queries, outbound call timeouts, event migration, asset manager API, outdated Maven dependencies. Verifies with <code>mvn compile</code>.</td>
  <td>
<ul>
<li><code>Check my Sling Models are implemented correctly</code></li>
<li><code>Scan this AEM project for code issues</code></li>
<li><code>Are my Maven dependencies up to date?</code></li>
</ul>
</td>
</tr>
<tr>
  <td><a href="skills/migration/SKILL.md">migration</a></td>
  <td>Migrate legacy AEM (6.x, AMS, on-prem) to AEM CS using BPA CSV/cache or CAM/MCP discovery. Covers scheduler, ResourceChangeListener, replication, EventListener, OSGi EventHandler, DAM AssetManager, HTL lint, Classic UI dialog migration, Custom Design Widgets, static→editable template modernization, and OSGi config → Cloud Manager. One pattern per session; delegates refactors to <code>code-assessment</code>.</td>
  <td>
<ul>
<li><code>Review my code for AEMaaCS migration</code></li>
<li><code>Fix scheduler findings using my BPA CSV</code></li>
<li><code>Migrate my static templates to editable templates</code></li>
</ul>
</td>
</tr>
<tr>
  <th colspan="3" align="left">Content distribution</th>
</tr>
<tr>
  <td><a href="skills/content-distribution/SKILL.md">content-distribution</a></td>
  <td>Programmatic content publishing via the Replication API (single-path, bulk, preview-tier, async) and distribution event monitoring via Sling Distribution events</td>
  <td>
<ul>
<li><code>Publish content programmatically</code></li>
<li><code>Monitor distribution events in my workflow</code></li>
</ul>
</td>
</tr>
<tr>
  <th colspan="3" align="left">Rapid Development Environment</th>
</tr>
<tr>
  <td><a href="skills/aem-rde/SKILL.md">aem-rde</a> <em>(beta)</em></td>
  <td>Expert assistance for <code>aio aem rde</code> — deploy bundles/configs/content/frontend, inspect artifacts, tail logs, create/restore snapshots, and troubleshoot RDE issues. Activates only on explicit RDE references.</td>
  <td>
<ul>
<li><code>Deploy my bundle to the RDE</code></li>
<li><code>Create a snapshot of my RDE environment</code></li>
<li><code>Why is my RDE deploy failing?</code></li>
</ul>
</td>
</tr>
</tbody>
</table>
