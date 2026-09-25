# Working on the stardust plugin source

Checks: `npm run lint:stardust` from the repo root (CI runs the same), plus the test file of every
script you touch — playwright scripts from a project copy, the plugin tree ships no `node_modules`.

- **Skill prose dilutes attention.** When you add to `skills/**/*.md`, fold something elsewhere —
  duplicated rationale, a twice-told anecdote, a superseded rule — and quote
  `evals/lint/prose-delta.mjs` in the PR. Scripts are the relaxed budget; one shared instrument
  beats three copies.
- **No site names anywhere**, evidence included: role names ("a commerce home page") and
  placeholders (`<site>`, `main > div.<cms-list>`). `evals/lint/site-names.mjs` fails otherwise;
  extend its allowlist only with a reason on the line.
- **Every CLI script** answers `--help` before any I/O, has one `scripts-index.md` row and a
  `scripts/test/<name>.test.mjs` whose pure part needs no browser; resolve sibling-skill imports
  in both layouts (plugin tree, `stardust/scripts/<skill>/` copy).
- **Harness-neutral text**, and docs name only paths that exist (the existing lints).
- **Field learnings** = one anonymised CHANGELOG entry + the rule in the skill doc, with the next
  deploy-improvement number and the numbers it touches.
- **Releases** bump `plugins/stardust/.claude-plugin/plugin.json`, the stardust entry in the root
  `.claude-plugin/marketplace.json` and the CHANGELOG heading together — patch for follow-ups,
  minor for a new skill or a changed contract.
