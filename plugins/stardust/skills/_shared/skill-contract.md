# Skill Contract

Every stardust skill declares three things in a `## Contract` section:

- **Needs** — upstream artifacts the skill reads *if present*. Never required.
- **Produces** — the single artifact (or folder) the user will edit directly after.
- **If missing** — what the skill synthesizes when a Need is absent, plus where provenance is recorded.

## Provenance

When a skill synthesizes any input, it stamps a provenance block at the top of
the produced artifact. No separate log file.

### HTML artifacts

```html
<!-- stardust:provenance
  generated_by: design
  date: 2026-04-13
  synthesized_inputs:
    - brand-profile.json (missing — neutral defaults used)
    - briefings/home.md #Copy (missing — copy generated on-brand)
  note: these values are placeholders. Edit the artifact or re-run the upstream skill to replace them.
-->
```

Place as the first child of `<head>`.

### Markdown artifacts

```markdown
<!-- stardust:provenance
  generated_by: briefings
  date: 2026-04-13
  synthesized_inputs:
    - user prompt: "landing page for the product launch"
  note: structured from a one-line prompt. Edit freely.
-->
```

Place as the first line of the file, above frontmatter.

### JSON artifacts

A `"_provenance"` key at the top of the object:

```json
{
  "_provenance": {
    "generated_by": "brand",
    "date": "2026-04-13",
    "synthesized_inputs": ["user conversation (no URL or PDF supplied)"],
    "note": "neutral defaults used. Replace by re-running /stardust:brand with a URL or PDF."
  },
  "name": "Untitled"
}
```

## Writeback

Skills never automatically write to upstream artifacts. If the user asks
("also save this headline to the briefing"), the skill performs a single,
targeted writeback and reports what it changed. That is the only
cross-artifact write allowed.

## One artifact per skill

A new skill is justified only if its artifact earns its own iteration loop.
If an output is edited jointly with another artifact or never edited on its
own, fold it into an existing skill instead of creating a new one.
