# stardust:prototype: the delegation mechanic

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Delegation mechanic

`prototype` does **not** author `<slug>-proposed.html` directly. The
heavy creative lift is delegated to `$impeccable craft`, and (when
needed) the structural plan to `$impeccable shape`. Spelling out the
mechanic matters because the carve-out documented in
`skills/stardust/reference/artifact-map.md` (where stardust authors
`PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, `current/PRODUCT.md`,
`current/DESIGN.md` directly, treating impeccable's references as
*format specs*, not runtime commands) is **load-bearing for those
five files only**. It does NOT extend to:

- `stardust/prototypes/<slug>-proposed.html` — must be authored by
  `$impeccable craft`, not by stardust direct authoring.
- Iteration on the proposed file — must be driven through a
  chat-driven invocation of an explicit impeccable command (per
  the iteration paths section).
- Structural planning when a page is complex enough to need it —
  `$impeccable shape`.

The proximate cause of past content fabrication was the agent
over-generalizing the direct-authoring carve-out to the proposed
HTML. Don't.

### Invoking impeccable

Impeccable is a skill, not a CLI. Invoke it through the harness's
skill-invocation tool, passing the sub-command and its args as the
skill's argument string, mirroring the slash-command form. In Claude
Code the plugin namespaces it as `impeccable:impeccable`:

```
Skill {
  skill: "impeccable:impeccable",
  args: "craft <feature-description>"
}
```

In GitHub Copilot and other harnesses that flatten plugin skills the
skill is named `impeccable` and takes the same argument string
(`craft <feature-description>`). Every Claude Code `Skill { ... }`
example in this skill translates the same way.

Sub-commands referenced from this skill are all routed through the
same skill: `craft`, `shape`, plus the iteration commands
(`bolder`, `quieter`, `distill`, `polish`, `colorize`, `typeset`,
`layout`, `adapt`, `animate`, `delight`, `overdrive`, `impeccable`).

When impeccable is **not** available (CLI-only environments,
plugin uninstalled, sandbox without skill access), stop and tell
the user impeccable is required for prototype rendering. Recommend
installing the impeccable plugin. Do not fall back to direct
authoring of `<slug>-proposed.html` — the validation contract
craft enforces (anti-toolbox audit, divergence rules, type ratios,
content sourcing hierarchy) is not reproducible by direct
authoring, and falling back silently ships unverified output.

Stardust's job inside Phase 2 is therefore:

- Compose the inputs craft needs (page content from
  `current/pages/<slug>.json`, target spec from `DESIGN.md` /
  `DESIGN.json`, hard constraints from `direction.md`, content
  sourcing rules from `reference/proposed-file-shell.md` § Content
  sourcing hierarchy).
- Invoke craft through the skill-invocation tool.
- Validate the result against the contract (`:root` block, data
  attributes, divergence audit, impeccable hard rules, content
  sourcing). If validation fails, refuse to write — never paper over
  craft output the agent thinks is "close enough."

The proposed file is whatever craft writes plus the validation
report; it is not stardust's authored artifact.
