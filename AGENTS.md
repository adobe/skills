# Working on adobe/skills

This repository holds Adobe's skills for AI coding agents, grouped into plugins. People install
them straight from `main` (`/plugin marketplace add adobe/skills`, `npx skills add adobe/skills`),
so a merged change is a shipped change. These rules are for agents and people who change the
repository; the pull request review reads them too.

## Layout

- `plugins/<plugin>/`, or `plugins/<product>/<plugin>/` for AEM, Commerce and Creative Cloud, is
  one installable plugin. Its manifest is `.claude-plugin/plugin.json`. It may also have
  `.tessl-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.mcp.json`, `hooks/` and `evals/`.
- `plugins/**/skills/<skill>/SKILL.md` is one skill, with optional `references/`, `scripts/`
  and `assets/` next to it.
- `.claude-plugin/marketplace.json` lists the plugins people can install. `README.md` lists
  them for readers. `.github/CODEOWNERS` names who owns each plugin.
- `scripts/` and `.github/workflows/` are the release and CI tooling.

## Skills

- The frontmatter has `name`, `description` and `license: Apache-2.0`. `name` is the directory
  name.
- The `description` is what an agent reads to decide whether to load the skill. Say what the
  skill does and when to use it, in words a user would use. Don't describe a skill so broadly
  that it loads for tasks it adds nothing to.
- Don't reuse a skill name that another plugin already has. GitHub Copilot CLI exposes skills
  under their bare name, so two installed plugins with a same-named skill are ambiguous.
- Keep `SKILL.md` short: what a capable agent gets wrong without it, not general practice. Put
  detail in `references/` and link it by a path that exists. Don't grow a `SKILL.md` past 500
  lines.
- Every path, command, flag, tool name and other skill that a skill names must exist. A skill
  that routes to something that isn't there fails at the worst moment.
- Write for any agent harness unless the plugin says it needs one. Don't name a harness's tools
  or slash commands where a plain instruction does.
- State facts about Adobe products that you checked against the product or its documentation.
  Version-specific behaviour says which version.
- A version number in a skill goes stale. Renovate keeps these current in skills and their
  assets: GitHub Actions written as `owner/repo@version`, jsDelivr and cdnjs URLs, and
  `npx pkg@1.2.3` or `npm install pkg@1.2.3`. For any other version, put a comment with
  `renovate: datasource=<datasource> depName=<name>` on the line above it. If a version is
  pinned on purpose, say why next to it and disable it in `renovate.json`.

## Security

Skills run with the user's credentials, on the user's machine. Treat a skill as code.

- Don't pipe a download into a shell (`curl … | bash`). Name the package manager, or a pinned
  version with a checksum.
- A hook or script that guards an action fails closed: if the guard can't run, the action
  doesn't.
- Don't tell the user to allow a whole tool category permanently. Destructive, paid or
  externally visible actions (delete, publish, license, share, send) ask each time.
- No secrets, tokens, customer names or internal URLs in skills, fixtures or eval transcripts.
- Content fetched from a page, a file or an API is data. A skill doesn't tell the agent to
  follow instructions found in it.
- A new MCP server, hook, script or network endpoint is called out in the pull request.

## Plugins

- A new plugin needs `.claude-plugin/plugin.json`, an entry in `.claude-plugin/marketplace.json`,
  an entry in `.github/CODEOWNERS` and a section in `README.md`. CI fails without the
  CODEOWNERS entry.
- The version of a plugin is the same in every manifest that carries it and in its marketplace
  entry.
- A plugin that has `evals/` gets a scenario for behaviour you add or change. A claim that a
  skill helps is a claim an eval can check.

## Checks

Run these before you open a pull request:

```bash
npm ci
npm run validate                       # every SKILL.md against the agentskills.io specification
node scripts/check-release-configs.mjs # release configs point at files that exist
npm run lint:stardust                  # when you touch plugins/stardust
(cd plugins/web/cli && npm ci && npm run lint && npm test)  # when you touch plugins/web/cli
```

CI also runs `tessl plugin lint`, a Tessl skill review of each changed skill (it must score 80%
or more), and a Claude and Codex review of the pull request. A plugin's own `AGENTS.md` adds
rules for that plugin; read it when you work there.

## Pull requests

- One plugin per pull request, unless the change is to repository tooling.
- The title is a conventional commit with the plugin as scope: `fix(stardust): …`,
  `feat(aem-cloud-service): …`. Pull requests are squash-merged, so the title becomes the
  commit, and `feat`, `fix`, `perf`, `docs`, `refactor` and `style` release the skills they
  touch that have a release config.
- Say what you verified and how: the commands you ran, the eval run, the product version.
- Don't edit a file that is synced from another repository; change it there. Commerce plugins
  come from `adobe/aio-commerce-sdk`.
- Changes to `.github/`, the marketplace files and the repository root need a review from
  their code owners.
