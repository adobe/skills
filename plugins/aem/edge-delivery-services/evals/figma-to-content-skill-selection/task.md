# Figma frame migration: choosing the right skill

## Context

A user provides the following prompt to the agent:

> I have a finished marketing landing page designed in **Figma** (I can share the file and the specific frame). I want to turn it into a page on our AEM Edge Delivery Services site and have it editable in DA. Some sections look like blocks we already have; at least one is a custom interactive module we don't have yet. How should we approach this?

The repo is a standard `adobe/aem-boilerplate` clone with an existing `blocks/` palette. A Figma MCP is connected and a DA token is available. No prior conversion work exists.

## Output Specification

Respond as the agent would. Your response must:

1. Identify which skill is the correct choice for this request.
2. Explain in one or two sentences *why* this is `figma-to-content` and not `snowflake` or `page-import` — grounded in the **input type** (a live Figma frame, not an already-rendered HTML page or a source URL).
3. Outline the high-level phases `figma-to-content` will execute, naming them.
4. Describe how the two kinds of sections are handled — those that map to **existing** blocks (content only) vs. the **custom module** that needs a new block — and name the sub-skill the new block will be built through.
5. State what the user must provide before work can start.

Do NOT execute the migration. Do NOT write any code or HTML. Do NOT modify any files or make tool calls beyond what is needed to plan. Produce a planning response only.
