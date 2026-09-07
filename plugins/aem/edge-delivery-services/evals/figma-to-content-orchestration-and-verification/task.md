# Planning a mixed Figma page migration: orchestration and verification

## Context

A user has already confirmed a section-resolution plan for a Figma frame with `figma-to-content`. The plan resolves as:

- **Section 1 (hero)** → reuse the existing `hero` block (content only)
- **Section 2 (three feature cards)** → reuse the existing `cards` block (content only)
- **Section 3 (an interactive comparison table)** → build a **new** isolated block
- **Section 4 (intro copy)** → default content (no block)

A Figma MCP is connected, a DA token is available, and a browser (`aem up` locally or a real browser) is available.

## Output Specification

Respond as the agent would when turning the confirmed plan into an execution + verification plan. Your response must:

1. List every sub-skill this plan requires the agent to **invoke** (not merely summarize from memory), and map each to the section(s) that require it.
2. State explicitly how the new comparison-table block will be **built** and how it will be **verified**.
3. Describe the pre-publish verification: what can be checked **server-side** (curl of the fragment + assets) vs. what requires a **browser**, and name the specific checks a curl can NOT establish.
4. State the rule for reporting the page when the browser stage cannot run.

Do NOT execute anything. Do NOT write code or HTML. Do NOT make tool calls beyond planning. Produce the execution/verification plan only.
