# Adding a pattern (end-to-end)

The single, authoritative procedure for adding a new code-assessment pattern (a new expert skill).
Follow it top to bottom; every step is concrete. The parent [`../SKILL.md`](../SKILL.md) and
[`../scripts/README.md`](../scripts/README.md) point here — this file is the source of truth.

## What a "pattern" is

A detectable code issue with a deterministic detector and a remediation recipe. Each pattern is
bound together by **one kebab-case slug** used identically in four places:

1. the detector's `pattern()` return value (registered in `scripts/analyzer/Registry.all()`)
2. the expert-skill directory name (`<slug>/`)
3. its row in [`patterns.md`](patterns.md)
4. its row in **Manual Pattern Hints** (`../SKILL.md`)

The harness `[wiring]` test fails if these drift apart — so keep the slug identical everywhere.

## Step 1 — research + define the detection signal

- Identify the antipattern and its **parse-level** markers: annotations, type/call names *as
  written*, language keywords, or structure. The analyzer is parse-level only — **no type
  resolution, no classpath, no network** (see "Limits").
- Choose the fix type:
  - **`mechanical`** — a deterministic single edit (e.g. swap an annotation, bump a version literal).
  - **`guided`** — judgment or multiple variants (e.g. the correct API differs by library).

## Step 2 — add the detector (`scripts/analyzer/detectors/`)

Create a new file `scripts/analyzer/detectors/YourDetector.java` implementing the `Detector` interface:

```java
package analyzer.detectors;

import analyzer.Corpus;
import analyzer.Detector;
import analyzer.Finding;
import analyzer.JavaUnit;

public final class YourDetector implements Detector {
    public String pattern() { return "<slug>"; }

    // Override needsJava()/needsPoms() (both default true) to declare which corpus
    // types this detector consumes — a single-pattern run then parses only what it needs.
    // e.g.: public boolean needsPoms() { return false; }  // Java-only detector

    public void detect(Corpus c, List<Finding> out, List<String> warnings) {
        for (JavaUnit u : c.java) {
            new TreePathScanner<Void, Void>() {
                // override the visit* methods for the node types you care about
                // (visitClass, visitMethod, visitVariable, visitMethodInvocation, visitNewClass,
                //  visitForLoop, visitTry, visitSynchronized, ...)
            }.scan(u.cu, null);
        }
    }
}
```

- **Corpus-type declaration:** override `needsJava()` and/or `needsPoms()` (both default `true`)
  to declare which corpus types this detector consumes. A single-pattern run parses only what
  the enabled detectors need — a Java-only detector should return `false` from `needsPoms()`,
  and a pom-only detector should return `false` from `needsJava()`.
- **Reuse shared helpers:** `hasAnnotation(mods, simple, fqn, u)` (import-aware),
  `JavaUnit.lineOf(tree)`, `JavaUnit.snippetOf(tree)`, `simpleName(fqn)`. Need to inspect the
  enclosing method/class (scope checks)? Add a small shared helper that walks `getCurrentPath()`
  up to the enclosing `MethodTree`/`ClassTree` — promote it once, reuse across detectors.
- **Pom-based patterns:** consume `c.poms` — each entry is a `PomUnit` (parsed `Document` + `lines`).
  See `OutdatedDependencies` for the pattern (`getElementsByTagName`, `childText`, `underAny`, line
  lookup). Reuse `analyzer.util.Poms` (`childText`/`underAny`/`findLine`/`isReactorVersion`);
  do **not** re-parse the pom.
- **Emit** `out.add(new Finding(pattern(), u.rel, line, snippet))`. The shape `{pattern, file, line,
  snippet}` is fixed — do not change it.
- **Dedup** per finding site if a node chain matches more than once (track seen lines in a `Set<Long>`).
- **Grow the helper layer, don't duplicate:** if a traversal/query is used by more than one detector,
  add it once as a shared static helper rather than copying it.
- **Register** it: add `new YourDetector()` to `Registry.all()` in `scripts/analyzer/Registry.java`.

Verify in isolation (from repo root): `bash plugins/aem/cloud-service/skills/code-assessment/scripts/analyze.sh plugins/aem/cloud-service/test/code-assessment/fixtures/<slug> --pattern <slug>`.

## Step 3 — fixtures + tests (`plugins/aem/cloud-service/test/code-assessment/`)

- Create `fixtures/<slug>/` with at least: one **antipattern** file (must be flagged) and one
  **clean / negative** file (must NOT be flagged). Add edge cases (import-aware collisions, scope
  suppression, etc.) as needed.
- Add a block to `plugins/aem/cloud-service/test/code-assessment/run-tests.sh` immediately before the `echo "----"` summary:

```bash
echo "[<slug>] <what it checks>"
OUT="$(run "$FIX/<slug>")"
assert_contains "antipattern flagged"      "$OUT" '"pattern":"<slug>"'
assert_contains "expected file present"    "$OUT" 'Antipattern.java'
assert_absent  "clean file not flagged"    "$OUT" 'Clean.java'
```

- Run red → green (from repo root): `bash plugins/aem/cloud-service/test/code-assessment/run-tests.sh`.

## Step 4 — catalog + routing

- **`references/patterns.md`:** flip the `planned` row (or add a new one) to:

  ```
  | [`<slug>`](../<slug>/SKILL.md) | <one-line description> | high|medium|low | ready | analyzer | mechanical|guided |
  ```

- **`../SKILL.md` Manual Pattern Hints:** add a row mapping user phrasings → `<slug>/SKILL.md`.
- **Description:** leave the parent `description` alone **unless** the pattern introduces a domain
  keyword it does not already cover (see the note in `../SKILL.md` "Adding a new pattern"). Triggering
  scales via Hints + catalog rows, not description edits.

## Step 5 — expert skill (`<slug>/SKILL.md` + `recipe.md`)

Author from [`_template.md`](_template.md):

- **`<slug>/SKILL.md`** — Overview; Classification (confirm it applies); Discovery (state the analyzer
  command + the detector's match criteria); Resolution contract (`self-evident` | `user-supplied` |
  `guided`); Review checklist; Recipe pointer; Handoff (runbook reference).
- **`<slug>/recipe.md`** — locator from the finding; the edit(s); `mechanical` = one deterministic
  edit, `guided` = per-variant remediation; **Unlocatable / skip** reasons (exact strings the runbook
  records); before/after example; editing strategy (surgical, preserve formatting).

## Step 6 — verify

```bash
bash plugins/aem/cloud-service/test/code-assessment/run-tests.sh   # your block + [wiring] green
npm run validate                         # exit 0
```

`[wiring]` confirms detector ↔ expert dir ↔ `ready`+`analyzer` catalog row are all in sync.

## The wiring invariant

```
detector.pattern()  ==  <slug>/ directory  ==  patterns.md ready+analyzer row  ==  Manual Pattern Hints row
```

If any of these is missing or misnamed, `[wiring]` fails the test suite. That is the guardrail that
keeps a growing catalog consistent.

## Limits to respect

- **Parse-level only** — no symbol/type resolution (`JavacTask.analyze()`), no classpath, no network.
  Match on written names, annotations, calls, keywords, structure. Patterns needing deep semantic
  analysis are out of scope by design.
- **New file type** (not `*.java` / `pom.xml`) — also extend `collect()` and the detector signature;
  see [`../scripts/README.md`](../scripts/README.md). For Java/pom patterns no engine change is needed.
- **One file per detector** — add one file under `analyzer/detectors/`; register it in
  `Registry.all()`. `analyze.sh` recompiles the package automatically on source change (the
  compile cache is keyed on a hash of all `analyzer/` sources). No manual build step.
