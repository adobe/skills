# Testing Locally

The web plugin's skills contain no scripts: every skill calls the `web` CLI in
`plugins/web/cli`. Testing a change means running the CLI from the worktree and
reading the SKILL.md it belongs to.

## Run the CLI from a worktree

```bash
# From the worktree root
node plugins/web/cli/dist/web.mjs --help
node plugins/web/cli/dist/web.mjs page tree https://example.com --format text
```

`dist/web.mjs` is the committed bundle. To run the sources instead, use
`node plugins/web/cli/bin/web.mjs …` (no rebuild needed).

Requires Node 22+ and `playwright-cli` >= 0.1.20 on PATH
(`npm install -g @playwright/cli@latest`).

## Tests and build

```bash
cd plugins/web/cli
npm test              # unit tests (node --test, fake driver)
npm run test:smoke    # real browser; skipped when playwright-cli is absent
npm run build         # rebuild dist/web.mjs and dist/lib.mjs
npm run check:dist    # fails when a dist file is stale (also run in CI)
```

Commit `dist/` with any change under `cli/src/`.

## Testing SKILL.md changes

Skills resolve the CLI as `web` on PATH, then `<skill-dir>/../../cli/dist/web.mjs`
(plugin layout). To try an edited skill in a Claude Code session, copy it into the
worktree's project-scope `.claude/skills/`; the plugin-relative CLI path no longer
resolves there, so set `WEB='node plugins/web/cli/dist/web.mjs'` when following it.

```bash
mkdir -p .claude/skills
cp -r plugins/web/skills/page-tree .claude/skills/page-tree
```

Project-scope skills do not override a globally installed skill of the same name;
edit the global copy or follow the project-local `SKILL.md` by hand. Changes to
`.claude/skills/` are picked up on the next session. The directory is untracked:
edit `plugins/web/skills/` and re-copy, so there is nothing to sync back.

Validate frontmatter before opening a PR: `npm run validate` at the repo root.
