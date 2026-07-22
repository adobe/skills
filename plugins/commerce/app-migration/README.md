# Commerce App Migration Skills

Agent skills for migrating Adobe Commerce App Builder projects to the App Management approach, following the [agentskills.io](https://agentskills.io) open standard. Compatible with Claude Code, Cursor, VS Code Copilot, Gemini CLI, and other supported agents.

## Available skills

| Skill                                                  | Description                                                                               | Status    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------- |
| [commerce-app-migrate](./skills/commerce-app-migrate/) | Orchestrate the full migration from Integration or Checkout Starter Kit to App Management | Available |

### `commerce-app-migrate`

Orchestrates the full migration workflow: project detection → domain analysis → Q&A → config assembly → execution. Run from the root of the App Builder project to be migrated.

```
/commerce-app-migrate
/commerce-app-migrate --auto          # skip confirmation prompts (CI or batch use)
/commerce-app-migrate --doc-scan-only # scan README.md and env.dist on an already-migrated project, no files modified
```

**What it does:**

1. **Preflight** — verifies the directory contains a valid App Builder project (`app.config.yaml`, `package.json`, and an actions or source directory)
2. **Analyze** — detects starter kit type, auth mode, action packages, eventing, webhooks, Admin UI SDK usage, and business config
3. **Domain agents** — runs specialized agents in parallel for each detected domain (events, webhooks, Admin UI SDK, business config)
4. **Q&A** — asks targeted questions for anything that cannot be inferred automatically
5. **Config assembly** — generates `app.commerce.config.ts` with `defineConfig(...)` from `@adobe/aio-commerce-lib-app/config`
6. **Execute** — writes the config file, installs dependencies, generates extension scaffolding, and updates `app.config.yaml` and `install.yaml`
7. **Documentation recommendations** — scans `README.md` and `env.dist` for content that is no longer needed after migration and explains why each item is obsolete; this analysis runs before `npm install` so recommendations are always produced even if the install step fails or is blocked

**Already-migrated projects:** If the project already contains `app.commerce.config.ts`, the skill skips the migration and runs a **documentation scan only** — scanning `README.md` and `env.dist` against the existing config and printing recommendations without modifying any files.

**Documentation recommendations cover:**

- README sections referencing obsolete onboarding scripts (`npm run onboard`, `aio commerce:event:subscribe`, Adobe I/O Console setup steps), manual credential configuration, or webhook registration steps that are now handled declaratively
- `env.dist` entries for credentials and configuration now managed by the App Management platform: IMS/SaaS auth (`OAUTH_*`), PaaS OAuth1 (`COMMERCE_CONSUMER_*`, `COMMERCE_ACCESS_TOKEN*`), Adobe I/O workspace vars (`AIO_RUNTIME_NAMESPACE`, `AIO_RUNTIME_AUTH`, `IO_MANAGEMENT_API_KEY`, `IO_*`), event config vars (`AIO_EVENTS_*`, `COMMERCE_ADOBE_IO_EVENTS_*`), and webhook vars (`COMMERCE_WEBHOOKS_PUBLIC_KEY`)
- Duplicate `env.dist` keys flagged explicitly (e.g. a key that appears twice in the file)
- An annotated README removal guide (inline `<!-- ✂ REMOVE -->` comments) for projects with 5 or more flagged sections

**Supported source projects:** Integration Starter Kit, Checkout Starter Kit, Admin UI SDK extensions.

**Output:** A ready-to-deploy `app.commerce.config.ts` in the project root, with all detected domains mapped to the App Management configuration schema, plus a documentation cleanup report printed in the terminal.

## Installation

**Claude Code plugin:**

```sh
/plugin marketplace add adobe/skills
/plugin install commerce-app-migration@adobe-skills
```

**Tessl CLI:**

```sh
tessl install github:adobe/skills --skills commerce-app-migrate
```

**npx skills:**

```sh
npx skills add adobe/skills --skill commerce-app-migrate
```
