# web CLI

`web` drives a browser and analyzes pages for the web plugin's skills: session
plumbing, bot-protection probing, page analysis (tree, reduce, collect, langs,
overlays), site URL discovery (`site scan`), a caching proxy (`cache serve`),
Chrome extension piloting and domain masking. It is the only consumer
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
option, output shape and exit code; `web doc` lists the long-form topics.

## Extending with your own commands

The package also exports a library (`dist/lib.mjs`, the package's `exports`): another program
can build the stock `web` program, add its own subcommands with `runCli(argv, { extend })` and
ship the result as its own binary, with the output, session and exit-code contract intact. The
guide, the exported surface and the rules live in `web doc extending`
(source: `src/docs/extending.md`); `src/lib.test.mjs` is a runnable example.

## Long-form docs inside the binary

`web doc` lists the topics and `web doc <topic>` prints Markdown to stdout, like `--help`.
Topics are the `.md` files in `src/docs/`, inlined into both dist files by the build, so an
agent with only the binary can read them.

## Development

```bash
npm test              # unit tests (node --test, fake driver)
npm run test:smoke    # real browser; skipped without playwright-cli
npm run build         # rebuild dist/web.mjs and dist/lib.mjs
npm run check:dist    # fails when either dist file is stale
```

Commit `dist/` with any change under `src/`.
