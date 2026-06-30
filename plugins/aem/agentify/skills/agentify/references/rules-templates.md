# Agentify Rules Templates

Use this reference when Phase 1 creates tool-local quick-reference rule files (§1.11 for
`.claude/rules/`, §1.7 for `.cursor/rules/`, and `.github/rules/` when Copilot is selected).

## Goal

Create a set of tool-local quick-reference rule files that project the target repo's conventions
from `AGENTS.md` into the format each tool expects. These files must stay **minimal projections**:
they summarize selected rules for when `AGENTS.md` is not in context — they never become a
second source of truth.

## Core Rule (Strictly Enforced)

Every generated rule file must stay short and link back to `AGENTS.md` rather than restating full
convention blocks. The projection file template below implements the required header — follow it
exactly. Never mirror full convention blocks from `AGENTS.md` into rule files.

## When To Create Each Rule File

Create only the rule files that match the repo's actual content. Skip files whose subject does
not apply to the target repo.

| Rule file | Create when |
|-----------|------------|
| `general-coding` | All repos with source code |
| `git-practices` | All repos |
| `java-style` | Repo has Java source |
| `java-testing` | Repo has Java tests |
| `bash-style` | Repo has shell scripts |
| `skill-authoring` | Repo is a skill/agent library or contains `skills/` |

## File Locations Per Tool

| Tool | Location | Extension | Notes |
|------|----------|-----------|-------|
| Claude Code | `.claude/rules/` | `.md` | — |
| Cursor | `.cursor/rules/` | `.mdc` | See Cursor front matter section below |
| Copilot | `.github/rules/` | `.md` | Skip a file if `.github/copilot-instructions.md` already covers that topic |

Create the directory if it does not exist. Do not create all three sets unless all three tools
are selected. Create only the set for the selected tool(s).

---

## Projection File Template

All rule files follow the same shape regardless of tool or content topic:

```markdown
# <Topic Name>

**Projection only: never edit this file directly; update `AGENTS.md` first.**

Canonical source: [AGENTS.md](../../AGENTS.md#<anchor>)
Projected from `AGENTS.md` as of `<commit>` (`<date>`).
When repo guidance changes, update `AGENTS.md` first and sync this projection in the same change.

<5-8 bullet points summarizing the most critical rules for this topic.
Use the repo's real vocabulary. Do not copy full blocks from AGENTS.md.>
```

The anchor in the canonical source link should point to the matching `AGENTS.md` section, e.g.:
- `#general-coding-principles`
- `#git-workflow`
- `#java-style`
- `#java-testing`
- `#bash-style`
- `#adding-or-editing-skills`

---

## Per-Rule Content Guidance

Summarize 5–8 bullets per rule file. Key topics by file:

| Rule file | Topics to summarize |
|-----------|-------------------|
| `general-coding` | Scope: apply standards to new code only — match existing file style for pre-existing code; functional over OOP (stateless pure functions, no input mutation); DRY/KISS/YAGNI; single-purpose functions — no flag/mode parameters that switch behavior; no fallbacks unless explicitly requested — fix root causes; error handling: explicit throws, specific types, actionable messages with context; strict typing everywhere; comments in English only |
| `git-practices` | Commit format: `WORK-ID : brief description` (lowercase, present tense, one line); PR body: always add `Co-Authored-By: <agent-identity>` at the end — Claude → `Co-Authored-By: Claude <noreply@anthropic.com>`, Copilot → `Co-Authored-By: GitHub Copilot <copilot@github.com>`, Cursor → `Co-Authored-By: Cursor <noreply@cursor.com>`, Codex → `Co-Authored-By: OpenAI Codex <noreply@openai.com>`; never `git add .` or `git add -A` — use specific files or `git add -u`; always show what will be staged/committed/pushed and wait for user approval before any git write operation; non-interactive diff: `git --no-pager diff`; use `--force-with-lease` instead of `--force`; before pushing review fixes, verify PR is still OPEN (`gh pr view --json state --jq '.state'`) |
| `java-style` | No static imports, no wildcard imports, no inline package-qualified names in new code; for existing files, match the file's existing import style exactly — never add static imports to satisfy the rule; Javadoc on all new public methods; parameter validation in all new public methods; logging: parameterized `{}` — never string concatenation; no flag parameters that switch method behavior; prefer Java 17 features: records for immutable data, sealed classes, pattern-matching instanceof, text blocks, switch expressions, var |
| `java-testing` | JUnit 4 preferred for AEM Mocks-based tests (JUnit 5 also supported on AEM 6.5.6+ and AEMaaCS); test class name: `MyClassTest` suffix; method names camelCase only — never snake_case; no static imports in new test classes — fully qualified `Assert.assertEquals()`, `Mockito.when()`; add class-level Javadoc linking to the class under test; match existing file's assertion/mocking style for new methods added to existing test files; prefer real objects over mocks; 90%+ line/branch coverage; external storage tests: clean in `@Before` AND `@After`, use unique test-scoped paths/keys |
| `bash-style` | Function names: `lowercase_underscores`, start with action verbs (`execute_`, `verify_`, `get_`), never camelCase or leading underscore; local variables: `lowercase_underscores`; constants/env vars: `UPPER_UNDERSCORES`; arithmetic under `set -e`: use `var=$((var + 1))` not `((var++))`; always quote variables; error capture: `set +e; cmd; rc=$?; set -e`; non-interactive flags on all commands |
| `skill-authoring` | Canonical location: `skills/<name>/` only — never edit tool-local mirror folders; SKILL.md under 500 lines; required frontmatter: `name`, `description`; use `$ARGUMENTS` for user input; explicitly link all supporting files so Claude knows they exist; keep skills generic — no hardcoded repo paths, ticket IDs, or usernames; scripts go under `scripts/`, reference with `${CLAUDE_SKILL_DIR}/scripts/`; use `context: fork` + `agent:` for isolated task execution; register in marketplace and README; add a final step to run `/simplify` on all generated files |

---

## Cursor `.mdc` Front Matter

Cursor rule files (`.cursor/rules/*.mdc`) should include Cursor-specific front matter:

```yaml
---
description: <one-line summary of what this rule covers>
globs: <file globs this rule applies to, e.g. "**/*.java" or "**/*.sh"; omit for repo-wide>
alwaysApply: false
---
```

Use `alwaysApply: true` only for repo-wide rules like `git-practices` and `general-coding`.
Use `alwaysApply: false` with a specific glob for language-specific rules like `java-style`.

---

## Verification And Alignment

Rule files are projections, not registered artifacts. No marketplace or catalog entry needed.

After writing rule files:
1. Verify every generated rule file has the projection header and audit line.
2. Confirm the canonical source link resolves to a real `AGENTS.md` section.
3. Refresh `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md` if they reference
   these rule files by name — ensure the references are accurate.
4. Do not add rule file content to `AGENTS.md`. The rules flow only from `AGENTS.md` outward.
