# scripts/ — deterministic detection analyzer

`analyze.sh` is the compile-cache wrapper for the code-assessment **detection engine**: it compiles
the `analyzer/` Java package to a hashed temp cache on first run, reuses the cache on subsequent
runs, and emits findings as JSON. Requires a **JDK** (`javac` + `java`, Java 11+) — a JRE alone
cannot run it.

## Run

```
bash analyze.sh <workspace-root> [--pattern <slug>] [--files a.java,b.java] [--all]
```

- `<workspace-root>` — directory to scan (skips `target/`, `build/`, `dist/`, `node_modules/`, `.git/`, `.autofix/`).
- `--pattern <slug>` — run only one detector (a single expert-skill run). Omitted → all detectors (orchestrator run).
- `--files <list>` — restrict the corpus to an explicit comma-separated file list (the `with_findings` invocation).
- `--all` — disable detector allowlists; list every versioned dependency rather than only the curated set. By default `outdated-dependencies` is scoped to an allowlist (`aem-sdk-api`, `org.mockito:*`); `--all` surfaces all versioned deps for a full audit.

On first run, `analyze.sh` compiles `analyzer/` to a temp cache (`$TMPDIR/aem-code-assessment/<hash>/`). Subsequent runs reuse the cache when no source files have changed. Nothing is written to the project tree — the compile cache lives in system temp.

## Output

```json
{
  "findings": [
    { "pattern": "inject-in-sling-model", "file": "core/.../HeroModel.java", "line": 14, "snippet": "@Inject private String title;" }
  ],
  "warnings": [ "parse-skip: core/.../Broken.java — syntax error" ]
}
```

`pattern`, `file` (workspace-relative), `line` (1-indexed), `snippet` are the findings shape the
runbook consumes (see [`../references/runbook.md`](../references/runbook.md)). The analyzer does
**detection only** — remediation stays recipe-driven and reads the live file at apply time.

Findings JSON is printed to **stdout** and also written to `<root>/.autofix/analyzer-output.json`.
On first write, the analyzer creates `<root>/.autofix/.gitignore` containing `*` so the dump
self-ignores and never enters the developer's commits. The analyzer skips its own `.autofix/` dir
when scanning. The compile cache lives in system temp. The only project-area write is the
self-ignored `.autofix/` dump — nothing git-tracked is touched.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Ran; findings printed as JSON |
| 2 | Usage error (no args) |
| 3 | No JDK (system Java compiler not found) |
| 4 | Unknown `--pattern` slug |
| 5 | Analyzer failed to compile |

## How it works

1. **Acquire once:** sources live in `analyzer/` (package `analyzer`), compiled once by `analyze.sh`
   into a hashed temp cache. Each `*.java` is parsed into a `JavaUnit`, each `pom.xml` into a
   `PomUnit`, and together they form a shared `Corpus`.
2. **Match many:** each registered `Detector` walks the shared `Corpus` for its own signature.
   Matching is **import-aware** — a written `@Model` is confirmed against the file's imports so a
   same-named annotation from another package is not mis-flagged. No classpath, no symbol
   resolution, no network.
3. A file that fails to parse is skipped with a `parse-skip` warning; the run continues.

## Adding a detector

The detector is **Step 2** of the end-to-end pattern procedure — see
[`../references/adding-a-pattern.md`](../references/adding-a-pattern.md) for the full flow (detector
→ fixtures/tests → catalog + routing → expert skill → verify).

In short: add a file under `analyzer/detectors/` implementing `Detector` (`pattern()` + `detect(Corpus, ...)`)
and register it in `Registry.all()`. Reuse `TreePathScanner` and the shared `hasAnnotation` /
`JavaUnit` helpers; keep match logic inside the class; stay parse-level (no classpath/network). If
a query recurs across detectors, promote it to a shared static helper rather than duplicating it.

## Tests

The dev-only test harness lives under the plugin at `plugins/aem/cloud-service/test/code-assessment`
(outside the skill dir, so it is not installed on customer systems). Run it from the repo root:

```
bash plugins/aem/cloud-service/test/code-assessment/run-tests.sh
```

Dependency-free (JDK + bash + `grep`): runs the analyzer against fixtures and asserts on the
emitted JSON. Exits non-zero on any failure.
