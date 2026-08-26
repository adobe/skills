# Reuse gate: a block that fits structurally but not visually

## Context

While resolving a Figma frame with `figma-to-content`, the agent reaches a section that is clearly a "cards" layout: three cards, each with an image, a title, body copy, and a link. The project already has a `cards` block whose authoring model (rows of image + text) matches this structure **exactly**.

But in the design, this section sits on a **dark full-bleed background**, and the card titles, body copy, and links are all **light-colored** for contrast. The project's existing `cards` block renders dark text on a light card and defines **no** dark variant. The project's global design tokens have already been retargeted to the design system's palette.

## Output Specification

Respond as the agent would when deciding how to handle this section. Your response must:

1. State whether this section can reuse the existing `cards` block **as-is**, and why or why not.
2. State what the agent must **NOT** do to make `cards` match the design.
3. State the correct resolution.
4. Describe the **legibility** check that must pass before this section's page can be published — specifically which text elements it must cover.

Do NOT execute anything. Do NOT write code or HTML. Do NOT modify files. Produce the decision and its rationale only.
