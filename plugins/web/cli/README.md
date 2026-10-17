# web CLI

`web` drives a browser and analyzes pages for the web plugin's skills: session
plumbing, bot-protection probing, page analysis (tree, reduce, collect, langs,
overlays), Chrome extension piloting and domain masking. It is the only consumer
of `playwright-cli` in the plugin (`src/driver/playwright-cli.mjs`).

## Requirements

- Node 22.12+
- `playwright-cli` >= 0.1.20 on PATH: `npm install -g @playwright/cli@latest`
  (`playwright-cli --version`)
- `page langs` needs `cld3-asm` (optional dependency; `npm install` in this directory)
- `mask` needs `mkcert` and sudo (macOS)

## Install / run

Locate `web` once:

```bash
# <skill-dir> is a skill directory under <plugin-dir>/skills/
WEB=$(command -v web || echo "node <skill-dir>/../../cli/dist/web.mjs")
```

then run `$WEB …`; it prints exactly one JSON document on stdout,
so `$WEB … > file.json` is safe.
Fallback when published: `npx -y @adobe/web-cli …`.

`web --help`, `web <group> --help` and `web <group> <command> --help` list every
option, output shape and exit code.

## Development

```bash
npm test              # unit tests (node --test, fake driver)
npm run test:smoke    # real browser; skipped without playwright-cli
npm run build         # rebuild dist/web.mjs
npm run check:dist    # fails when dist/web.mjs is stale
```

Commit `dist/web.mjs` with any change under `src/`. Design:
`docs/superpowers/specs/2026-10-16-web-cli-design.md` (repository root).
