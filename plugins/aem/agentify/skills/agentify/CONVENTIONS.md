## Appendix A: Conventions to Embed in AGENTS.md

When creating `AGENTS.md` for a repo, include the sections below that match the repo's
type. These conventions travel with the repo so every AI agent — regardless of which
global rules it has loaded — follows the same standards.

**Code Standards Scope Rule (strictly enforced for all sections below):**
Apply standards **only to new code**. Never refactor, reformat, or rename pre-existing code
to align with these standards. When adding methods to an existing file, apply standards to
the new methods only; leave everything else untouched.

---

### A.0 — General Coding Principles (All Repo Types)

Include this section in every AGENTS.md.

#### Before Writing Code

- Inspect the repository structure before editing; read any active `AGENTS.md` files.
- Search for existing logic before implementing — avoid duplicating what's already there.
- Keep changes minimal and directly related to the current request.
- **For existing classes: match the existing file's code style, import style, and naming conventions** — even when they differ from the standards below. The standards below apply to new code only.

#### Code Style

- **Comments in English only.**
- **Functional over OOP** — prefer stateless pure functions and data transformations; never mutate input parameters or global state as a side effect. Use classes only for connectors to external systems, service components, or types that enforce non-trivial invariants.
- **DRY / KISS / YAGNI** — don't repeat yourself; keep it simple; don't build for hypothetical future needs.
- **Single-purpose functions** — one function does one thing. No flag/mode parameters that switch behavior.
- **Prefer the strongest typing available** — use explicit return types, typed variables, and typed collections in statically typed languages. In dynamically typed languages, add type hints/annotations where supported. Avoid overly broad types (`any`, `Object`, raw generics).
- **Define types for complex structures** — create a named type/record/dataclass instead of passing `Map<String, Object>` or `dict`.

#### Error Handling

- Always raise/throw explicitly — never silently ignore errors.
- Use specific error types that clearly indicate what went wrong.
- Error messages must be actionable and include enough context to debug while protecting secrets/PII. Prefer logging non-sensitive identifiers (IDs, correlation IDs), status codes, and high-level summaries. If input or response data must be logged, redact/sanitize sensitive fields and avoid logging full request/response bodies by default (e.g., log truncated/hashed payloads, with explicit opt-in for full content in secure debugging environments).
- **No fallbacks unless explicitly requested.** Fix root causes, not symptoms.
- Use structured/parameterized logging — never interpolate dynamic values into the message string.

#### Documentation

- **Code is the primary documentation** — clear naming, types, and docstrings take precedence over prose files.
- Keep documentation co-located with the code it describes.
- **Never duplicate documentation across files** — one authoritative source.

#### Tooling

- Run the project's existing tests or validation commands after making changes.
- Use non-interactive command flags so nothing blocks on stdin (e.g. `--no-pager`, `-y`, `--batch`).

---

### A.1 — Git Workflow (All Repo Types)

Include this section in every AGENTS.md.

#### Commit Messages

Format: `WORK-ID : brief description`

- One line only (most commits)
- Present tense, lowercase, under 72 characters
- No `Co-Authored-By` lines

```
PROJ-123 : fix arithmetic expressions with set -e
GH-123 : add null check in content repository service
```

#### Staging Files

**Never use `git add .` or `git add -A`** — these stage untracked files and can
accidentally include secrets (`.env`), personal IDE state, or build artifacts.

```bash
# Stage specific files (preferred)
git add path/to/File.java

# Stage only tracked modified files (safe fallback)
git add -u

# WRONG — never do this
git add .
git add -A
```

Always show the user what will be staged/committed/pushed and wait for explicit approval
before running git operations.

#### Pre-Commit Checklist

Before every commit:
1. Run the project formatter (e.g. `mvn spotless:apply`, `npm run format`, `black .`)
2. Run tests (`mvn test`, `npm test`, `pytest`)
3. Check status: `git status`
4. Review staged diff: `git diff --staged`

#### Branch Creation

Always fetch before creating a branch to ensure it starts from the latest code.
Use `upstream` remote if it exists, otherwise `origin`.
Detect main branch: prefer `trunk` → `main` → `master`.

```bash
# Fetch first
git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
git fetch "$remote"

# Create from latest trunk/main/master
git checkout -b WORK-ID "$remote/trunk"     # Apache projects
git checkout -b WORK-ID "$remote/main"      # GitHub projects
git checkout -b WORK-ID "$remote/master"    # legacy repos using master

# Verify
git branch -vv
```

#### Checking Out an Existing Branch

Do not just run `git checkout X`. Always stash + checkout + rebase:

```bash
if git branch --list BRANCH-NAME | grep -q .; then
  # Exists locally
  git diff --quiet && git diff --cached --quiet || { git stash; STASHED=1; }
  git checkout BRANCH-NAME
  git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
  git fetch "$remote"
  git rebase "$remote/$BASE_BRANCH"
  [ "${STASHED:-}" = "1" ] && git stash pop
else
  # Does NOT exist locally
  git diff --quiet && git diff --cached --quiet || { git stash; STASHED=1; }
  git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
  git fetch "$remote"
  git checkout -b BRANCH-NAME "${remote}/$BASE_BRANCH"
  [ "${STASHED:-}" = "1" ] && git stash pop
fi
```

#### Syncing / Rebasing the Current Branch

```bash
git diff --quiet && git diff --cached --quiet || { git stash; STASHED=1; }
git remote | grep -q "^upstream$" && remote="upstream" || remote="origin"
git fetch "$remote"
git rebase "$remote/$BASE_BRANCH"
[ "${STASHED:-}" = "1" ] && git stash pop
```

#### Pull Requests

Before creating a PR, verify `gh` is configured for the repo's host. Do this **early**
(before writing any files) so a missing account is caught before all work is done.

```bash
git remote get-url origin      # identify the host
gh auth status                 # list configured accounts — stop if no account matches the host
```

If no account is configured for the host, tell the user and stop:
> "`gh` has no account configured for `<host>`. Run `gh auth login` first, then restart."

Follow the **Pre-PR Verification Gate** in `PLAN.md` before creating any PR.

Then create the PR:

```bash
# 1. Switch to the gh account that corresponds to this repo's host
gh auth switch --user YOUR_ACCOUNT_FOR_THIS_HOST

# 2. Check if a PR already exists — only create if it does not
gh pr view 2>/dev/null && echo "PR exists, skipping" || gh pr create \
  --title "WORK-ID : brief description" \
  --base "$BASE_BRANCH" \
  --assignee @me \
  --body "$(cat <<'EOF'
## Summary

<what changed and why>

## Changes

<key files / methods changed>

## Test Plan

- [ ] New tests added and passing
- [ ] Existing tests still pass
EOF
)"
```

- Always add yourself as assignee: `--assignee @me`
- **Only for repos on github.com with Copilot Enterprise/Business**: add `--reviewer @Copilot`
  to `gh pr create`. If it fails, add Copilot via the API after PR creation:
  ```bash
  PR_NUMBER=$(gh pr view --json number --jq '.number')
  gh api repos/OWNER/REPO/pulls/$PR_NUMBER/requested_reviewers \
    -X POST -f 'reviewers[]=github-copilot'
  ```
- **Do not write cross-platform caveats into AGENTS.md.** The distinction above is a
  skill-level instruction only — AGENTS.md written into a repo must contain only the rules
  that apply to that repo, with no mention of other hosting platforms or repo types.

#### Merging

Always squash-merge and delete the branch:

```bash
gh pr merge --squash --delete-branch --repo OWNER/REPO
```

Never use regular merge or rebase merge unless the user explicitly requests it.

#### Force Push

Never force push unless a normal `git push origin BRANCH-NAME` fails first. Only use
`--force` as a last resort (e.g. after an unavoidable amend on an already-pushed commit).

---

### A.2 — Java Code Style (Source repos with Java)

Include this section in AGENTS.md for any repo with `.java` source files.

#### Imports (new code only)

- **No static imports** — call static methods via the class name: `Assert.assertEquals()`, `Mockito.when()`
- **No wildcard imports** — explicit only: `import java.util.List;` not `import java.util.*;`
- **No inline fully-qualified package names** — always import and use the simple type name
- **Exception: existing files** — match the file's existing import style exactly. Never add new static imports to an existing file just to satisfy this rule.

#### Naming Conventions

```java
public class MyClass { }               // Classes: PascalCase
public interface MyInterface { }       // Interfaces: PascalCase
public void doSomething() { }          // Methods: camelCase
private String myVariable;             // Variables: camelCase
public static final String CONSTANT;   // Constants: UPPER_SNAKE_CASE
```

#### Javadoc (Mandatory for All New Public Methods)

Every new public method requires Javadoc covering: what it does, each parameter, return
value, and exceptions thrown.

```java
/**
 * Validates and processes a migration state transition.
 *
 * @param currentState the current migration state (must not be null)
 * @param targetState  the desired target state (must not be null)
 * @return the updated migration state after successful transition
 * @throws IllegalArgumentException if either state is null
 * @throws IllegalStateException    if the transition is not allowed
 */
public MigrationState processTransition(MigrationState currentState, MigrationState targetState) { }
```

Private methods: Javadoc optional for obvious methods; required for complex logic.

#### Parameter Validation (Mandatory for All New Public Methods)

```java
public void execute(String id, int timeout) {
    if (id == null || id.isEmpty()) {
        throw new IllegalArgumentException("id cannot be null or empty");
    }
    if (timeout <= 0) {
        throw new IllegalArgumentException("timeout must be greater than 0");
    }
}
```

#### Logging

```java
private static final Logger log = LoggerFactory.getLogger(MyClass.class);
log.info("Processing item: {}", itemId);   // parameterised — never string concatenation
log.error("Operation failed", exception);
```

#### Inline Comments

Use only for non-obvious logic. Do not comment self-explanatory code.

```java
// Sort descending so highest-priority items are processed first (PROJ-1234)
items.sort(Comparator.comparing(Item::getPriority).reversed());
```

#### Class Structure Order

1. Static constants
2. Static fields
3. Instance fields
4. Constructors
5. Public methods
6. Package-private methods
7. Private methods
8. Inner classes

#### Design Principles

- OSGi components and domain types that enforce invariants are valid class use-cases alongside external-system connectors.
- No flag parameters that switch method behavior:

```java
// ✅ prefer — two clear methods
public NodeState loadNode(String path) { ... }
public NodeState loadNodeWithCache(String path) { ... }

// ❌ avoid — flag parameter changes what the function does
public NodeState loadNode(String path, boolean useCache) { ... }
```

#### Error Handling (Java-specific)

See §A.0 for the general error handling principles. Additionally for Java:

- Prefer `IllegalArgumentException`, `IllegalStateException`, or a domain-specific exception over generic `RuntimeException`
- Catch-all `catch (Exception e)` is only acceptable if you re-throw or wrap with context

```java
// ✅ specific type, context in message
throw new IllegalArgumentException(
        "Cache weight must be positive, got: " + weight + " for key: " + key);

// ❌ generic, no context
throw new RuntimeException("invalid weight");

// ❌ silent swallow
try { ... } catch (Exception e) { log.warn("failed"); }
```

#### Java 17 Features (Prefer Over Older Patterns)

Use modern language features for **new code only**. Do not rewrite existing code.

**Records** — use for immutable data carriers:
```java
// ✅ prefer
public record CacheEntry(String key, long weight, Instant createdAt) { }
```

**Sealed classes** — when the set of subtypes is fixed:
```java
public sealed interface CacheEvent permits HitEvent, MissEvent, EvictionEvent { }
public record HitEvent(String key) implements CacheEvent { }
```

**Pattern matching** — eliminate redundant casts:
```java
if (value instanceof String s && !s.isEmpty()) { ... }
```

**Text blocks** — for multi-line strings (SQL, JSON, log templates):
```java
String query = """
        SELECT id, name
        FROM nodes
        WHERE path = ?
        """;
```

**Switch expressions** — when switching to produce a value:
```java
String label = switch (cause) {
    case EXPLICIT -> "invalidated";
    case SIZE     -> "evicted";
    case EXPIRED  -> "expired";
    default       -> "removed";
};
```

**`var`** — for local variables where the type is obvious from context:
```java
var stats = cache.stats();  // ✅ type clear from right-hand side
var x = compute();          // ❌ type not obvious — use explicit type
```

---

### A.3 — Java Testing (Source repos with Java + Has-tests)

Include this section in AGENTS.md for any Java repo with tests (or where tests will be added).

#### Framework

- **Use the repo's existing test framework.** If tests already exist, match their framework version — do not introduce a new one without explicit user sign-off.
- **Default for new Java repos with no existing tests:** JUnit 4. If the repo is already on JUnit 5/Jupiter, use JUnit 5.
- Test class names: `MyClassTest` suffix
- Test method names: camelCase — never snake_case
- Test location: mirror source path under `src/test/java/`

#### Existing Test Files Rule

Read the file's imports first and match its style exactly — never add new static imports to comply with the no-static-imports standard.

#### New Test Classes

No static imports. No wildcard imports. Fully qualified names only.

```java
import org.junit.Before;
import org.junit.Test;
import org.junit.Assert;
import org.mockito.Mockito;

public class MyClassTest {

    private MyClass instance;

    @Before
    public void setUp() {
        instance = new MyClass();
    }

    @Test
    public void methodNameWhenConditionExpectsResult() {
        String result = instance.doSomething("input");
        Assert.assertEquals("expected", result);
    }

    @Test(expected = IllegalArgumentException.class)
    public void methodNameThrowsOnNullInput() {
        instance.doSomething(null);
    }
}
```

#### Mockito Patterns (new test classes)

```java
MyDependency dep = Mockito.mock(MyDependency.class);
Mockito.when(dep.getValue()).thenReturn("value");
Mockito.when(dep.getValue()).thenThrow(new RuntimeException());

Mockito.verify(dep).getValue();
Mockito.verify(dep, Mockito.times(2)).getValue();
Mockito.verify(dep, Mockito.never()).getValue();

Mockito.when(dep.method(Mockito.anyString())).thenReturn("result");
```

#### Policy

- Always create unit tests when adding new methods
- **Prefer real objects over mocks** — use Mockito only for external dependencies (file
  system, network, databases)
- Cover: success case, exception cases, edge cases, every branch
- **Minimum 90% line/branch coverage** for all new code — Sonar will fail the build below this
- Test method names must encode: what is tested, under what condition, expected outcome
  - Good: `transferWhenInsufficientFundsThrowsOverdraftException`
  - Bad: `testTransfer`, `test2`

#### Running Tests

```bash
mvn test                               # all tests
mvn test -Dtest=MyClassTest            # specific class
mvn test -Dtest=MyClassTest#testName   # specific method
```

---

### A.4 — Bash Style (Infra repos and Source repos with shell scripts)

Include this section in AGENTS.md for any repo containing `.sh` scripts or shell-heavy
Makefiles / CI scripts.

#### Function Naming (Strictly Enforced)

Functions must use **lowercase with underscores**. Never leading underscore, camelCase, or
PascalCase.

```bash
function validate_migration_state { }   # ✅ correct
function _validate_migration_state { }  # ❌ leading underscore
function validateMigrationState { }     # ❌ camelCase
```

Start with action verbs: `execute_`, `verify_`, `validate_`, `assert_`, `check_`.

#### Arithmetic with `set -e` (Critical)

`((var++))` exits the script when `var` is 0, killing the process silently.
Always use assignment form instead:

```bash
retry=$((retry + 1))    # ✅ safe with set -e
((retry++))             # ❌ exits when retry=0
```

Safe exceptions: `if ((count % 10 == 0))`, `local x=$((var++))`, `((VAR++)) || true`

#### Function Definition Format

```bash
#
# Brief description of what the function does.
# Parameters: $1 - description of first argument
# Returns: exit code or description of output
#
function my_function_name {
    local param1="$1"
    # implementation
    return 0
}
```

#### Variable Naming

```bash
local migration_state="$1"           # local variables: lowercase_underscores
local MAX_RETRY="${MAX_RETRY:-3}"     # constants / env vars: UPPER_UNDERSCORES
```

#### Best Practices

```bash
# Always quote variables
if [ "$variable" == "value" ]; then
    echo "Value: ${variable}"
fi

# Capture exit codes safely around commands that may fail
set +e; some_command; local rc=$?; set -e
[ "$rc" != "0" ] && { echo "ERROR: command failed: $rc"; exit "$rc"; }
```

---
