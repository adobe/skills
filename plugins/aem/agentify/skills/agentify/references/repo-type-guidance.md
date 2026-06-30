# Agentify Repo-Type Guidance

Reference guidance to apply based on the repo type labels from Phase 0.

## Packaging Repos (no source code)

- `AGENTS.md` must explain the build tool's DSL thoroughly — especially if proprietary.
  Include a section documenting every DSL keyword, type prefix, and section marker.
- Skip Phase 3 steps 3.1–3.5 (no source code to refactor).
- OSGi config properties and packaging directives should be commented inline in the
  build descriptor file.
- For Maven packaging repos: document what each configuration section produces,
  what the artifact naming convention is, and which version properties drive the build.

## Multi-Module Repos (e.g. Maven/Gradle reactor builds)

- `AGENTS.md` must include a **Module Topology** section:

  | Module | Role | Public API? | Safe to change alone? |
  |--------|------|-------------|----------------------|
  | `module-a` | Core implementation | Yes | No — others depend on it |
  | `module-b` | Tests | No | Yes |

- `wiki/architecture.md` must include the same Module Topology section.
- `docs/testing.md` must include module-aware test commands (e.g. `mvn test -pl module-a`).
- `docs/release-process.md` must clarify: whole-reactor release vs selected-module release.
- Create per-module `CLAUDE.md` only for unusually complex modules (not for every module).
- Phase 3 step 3.6 (directory structure) is **critical priority** for Multi-module repos.

## Maven Repos with Even/Odd Versioning

The current SNAPSHOT version in `pom.xml` encodes the next release:

| Current pom.xml version | Meaning | Next release | Next SNAPSHOT after release |
|-------------------------|---------|-------------|----------------------------|
| `1.60.7-SNAPSHOT` | In development | `1.60.8` | `1.60.9-SNAPSHOT` |
| `1.60.9-SNAPSHOT` | In development | `1.60.10` | `1.60.11-SNAPSHOT` |

Rules:
- **Odd patch** = SNAPSHOT in development
- **Even patch** = released artifact

Always document this strategy in `AGENTS.md` (Versioning Strategy section) and
`docs/release-process.md`. Use `mvn release:prepare` + `mvn release:perform` — never
hardcode version numbers.

## LLM-App Repos

- `prompts/` and `evals/` are **high priority** — in Phase 1, only capture the intended
  prompt and eval layout and responsibilities in `AGENTS.md`; create or update the actual
  `prompts/` and `evals/` directories in Phase 2.
- Keep repo-helper prompts under `prompts/repo/`. Store runtime application prompts separately
  under `prompts/system/`, `prompts/tasks/`, and `prompts/templates/`.
- `wiki/architecture.md` must name which model(s) are used and where model selection happens.
- `AGENTS.md` must state where prompts live, how evals are run, and what the expected
  eval pass rate is.
- Document prompt versioning strategy (are prompts versioned? in git? in a database?).
