# aem-design

Design-phase skills for websites built with Adobe Experience Manager Edge Delivery Services (AEM EDS). Turns a brand source and a page brief into grey wireframes and branded HTML prototypes.

**EDS-independent.** The plugin produces static files — no AEM instance, no dev server, no `aem.live` URL required. Artifacts open directly in a browser.

## Skills

| Skill | Owns | Invocation |
|---|---|---|
| `aem-design` | Navigator — assesses `aem-design/` state and recommends the next step | `/aem-design` |
| `brand` | `aem-design/brand-profile.json`, `aem-design/brand-board.html`, `.impeccable.md` | `/aem-design:brand` |
| `briefings` | `aem-design/briefings/**/*.md` | `/aem-design:briefings` |
| `wireframes` | `aem-design/wireframes/**/*.html` | `/aem-design:wireframes` |
| `prototype` | `aem-design/prototypes/**/*.html` | `/aem-design:prototype` |

Most of the time you don't need to remember slash commands — the skills activate from natural-language requests that reference `aem-design/` paths.

## Install

```
/plugin install aem-design@adobe-skills
```

## Soft dependencies

`aem-design` works standalone. Two peer plugins enhance it when installed:

- **superpowers** — adds `/brainstorm`, `/write-plan`, `/execute-plan`. When present, the `briefings` and `prototype` skills delegate discovery and iteration planning to it. When absent, they fall back to inline interview patterns.
- **impeccable** — adds `/impeccable critique`, `/shape`, `/teach`. When present, the `brand`, `wireframes`, and `prototype` skills delegate critique and section planning to it. When absent, they fall back to inline rubrics.

Both fallbacks are viable — the peer plugins are nice-to-haves, not requirements.

## AGENTS.md snippet

To reinforce activation on agents with weaker description matching, paste this into your project's `AGENTS.md`:

```markdown
## aem-design

Files under `aem-design/` are owned by the `aem-design` skills. When asked to modify, create, or review any artifact in that folder, invoke the matching skill (`brand`, `briefings`, `wireframes`, `prototype`) instead of editing files directly.
```

## What `aem-design` does NOT ship

- No EDS block implementation. `aem-design` stops at approved static prototypes. Converting those prototypes into EDS CSS, blocks, and generated pages is a separate effort.

## License

Apache-2.0.
