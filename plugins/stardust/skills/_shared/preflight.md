# Pre-Flight

Every stardust skill starts by running this procedure. The goal is:
**nothing blocks, but nothing happens silently.**

## Procedure

1. **Scan disk** — check for the upstream artifacts listed in this skill's `## Contract` → **Needs**.
2. **Report state** — print a one-line summary to the user:

   ```
   stardust state:
     brand       ✓ extracted 2026-04-12
     briefings   ✓ 1 page (landing.md — intent only, no #Copy)
     wireframes  ✗ not yet
     prototypes  ✗ not yet
   ```

3. **Flag consequences of gaps** — one line per missing input, naming what will be synthesized:

   ```
   gaps for /stardust:prototype:
     - no wireframe → structure will be shaped from the briefing
     - briefing has no #Copy → copy will be generated on-brand
   ```

4. **Offer one escape hatch** — a single prompt with a sensible default:

   ```
   Proceed with the prototype, or jump upstream first (brand / briefings / wireframes)?
   [default: proceed]
   ```

   - Empty response, "proceed", "go", "yes" → run the skill.
   - Any upstream name → stop and tell the user to invoke `/stardust:<name>`. Do not auto-chain.

## Rules

- Do not ask more than one question in pre-flight. If the user wants a wizard, they can run `/stardust`.
- Never block. If a gap exists and the user chooses "proceed", the skill synthesizes a stand-in and stamps provenance (see `skill-contract.md`).
- Report state before doing any other work — including before asking anything else.
