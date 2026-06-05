# Deterministic helper specification

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference describes the deterministic helper the skill uses for
every operation that must be byte-exact (`O_NOFOLLOW`, SHA-256, atomic
`rename(2)`, exhaustive Unicode strip, sorted-key JSON re-serialization,
bounded file walk, advisory file lock). The helper is the single
authoritative dependency the skill carries — every contract in
`SKILL.md` that depends on platform syscalls or byte-exact operations
is upheld through this helper, not through the LLM agent's tools.

This skill targets **AEM as a Cloud Service only**; the helper does
not ship on-prem or 6.5-LTS-specific paths.

## 1. Availability and version pinning

- The helper ships inside the published skill bundle as
  `bin/aem-agentkit-helper` and on `PATH` for installations that
  globally install the skill.
- The skill resolves the helper in this order: `${AEM_AGENTKIT_HELPER}`
  environment variable → `bin/aem-agentkit-helper` under the published
  skill root → `aem-agentkit-helper` on `PATH`.
- The helper exposes `--version`. The skill compares the helper's
  reported version against the skill's `metadata.version` (currently
  `1.0.0-beta`). A mismatch aborts the run with a single diagnostic naming
  the expected and observed versions; the customer must align the two
  before retrying. The helper version follows the same `MAJOR.MINOR.PATCH`
  scheme as the skill.
- The helper is content-addressable. The skill verifies the helper's
  SHA-256 against the value pinned in
  [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 1 before
  the first invocation. A mismatch aborts the run.
- If the helper is not available the skill exits `1` with the
  diagnostic `aem-agentkit: deterministic helper not found (expected
  aem-agentkit-helper v<expected> at $AEM_AGENTKIT_HELPER, the published
  skill bundle, or PATH).`. No fallback path exists; the contracts in
  SKILL.md depend on the helper.

## 2. Operations

Every helper invocation is JSON-line: stdin carries one JSON request,
stdout carries one JSON response. Errors are reported as
`{"ok": false, "error": "<workspace-relative-message>"}` with a
non-zero exit code. The skill never interpolates customer input into a
shell string; the helper's stdin / argv are the only interface.

### 2.1 `realpath` — resolve and validate a path

Request:
```json
{"op": "realpath", "workspace": "<absolute-path>", "path": "<path-to-check>"}
```

Response (success):
```json
{"ok": true, "realpath": "<absolute-realpath>", "workspaceRelative": "<workspace-relative-posix-path>", "isSymlink": <boolean>, "isDir": <boolean>}
```

Behavior:
1. Resolve `workspace` to its canonical realpath once and cache the
   result for the lifetime of the helper process.
2. Resolve `path` to its canonical realpath. If resolution fails for
   any reason (broken symlink, EACCES, ENOENT on an intermediate
   component), respond `{"ok": false, "error": "..."}` with exit `1`
   (fail-closed: the skill treats this as if the path matched the
   deny-list).
3. Reject if the resolved path is not a descendant of the resolved
   workspace root.
4. Reject if any path segment (after casefold per § 3) matches any
   pattern in [`privacy-and-sanitization.md`](./privacy-and-sanitization.md)
   § 1.
5. Reject if the resolved path traverses `/proc`, `/sys`, `/dev`,
   `/var/run`, `/run`, a Windows device path (`\\?\`), or a UNC root
   (`\\server\share`) — even when the workspace itself is rooted inside
   one of these prefixes.
6. Reject if the path contains a `..` component after resolution.

### 2.2 `open` — open a file with `O_NOFOLLOW` and TOCTOU re-check

Request:
```json
{"op": "open", "workspace": "<absolute-path>", "path": "<path-to-open>", "maxBytes": <int>}
```

Response (success):
```json
{"ok": true, "bytes": "<base64-encoded-content>", "sha256": "<lowercase-hex>"}
```

Behavior:
1. Run § 2.1 on `path`.
2. Open the file with `O_NOFOLLOW` on Linux, `O_NOFOLLOW_ANY` on macOS
   11+ (falling back to `openat2` with `RESOLVE_NO_SYMLINKS` on Linux
   5.6+ for the multi-component guarantee), and
   `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS` on
   Windows.
3. Re-resolve the opened descriptor's canonical path. Reject if it
   differs from the path resolved in step 1 (closes the TOCTOU
   window between resolve and open).
4. Read at most `maxBytes` (helper enforces a hard ceiling of
   16 MiB; the skill passes `maxBytes: 256` for
   `.cloudmanager/java-version` and analogous tight caps elsewhere).
5. Compute SHA-256 over the read bytes.

### 2.3 `walk` — bounded workspace walk

Request:
```json
{"op": "walk", "workspace": "<absolute-path>", "roots": ["<path>", ...], "maxFiles": 100000, "maxDepth": 32, "maxFilesPerSubtree": 10000, "globs": ["<allow-glob>", ...]}
```

Response:
```json
{"ok": true, "files": ["<workspace-relative-posix-path>", ...], "truncated": <boolean>, "truncatedSubtrees": ["<workspace-relative-posix-path>", ...], "warnings": ["<message>", ...]}
```

Behavior:
1. Start from each entry in `roots`. Each root passes through § 2.1
   first.
2. Walk depth-first. At every directory descent, casefold-match the
   segment against the deny-list patterns; matching directories are
   pruned (the entire subtree is skipped) and added to `warnings` as
   `"deny-list segment match: <workspace-relative-path>"`. The full
   pruned list (`target/`, `node_modules/`, `dist/`, `build/`, `out/`,
   `.git/`, `crx-quickstart/`, `.idea/`, `.vscode/` excluding
   `extensions.json`, plus any pattern from the privacy deny-list) is
   enforced at every layer of the walk regardless of which root is
   being walked.
3. Each file passes through § 2.1.
4. Files are returned in `sort()` order on the workspace-relative
   POSIX path.
5. Caps:
   - `maxFiles` (default 100,000): global walk cap. On overflow,
     `truncated: true` and the walk halts. The subtree where the cap
     was reached is added to `truncatedSubtrees`.
   - `maxDepth` (default 32): directory depth from the workspace root.
   - `maxFilesPerSubtree` (default 10,000): per-immediate-child-of-root
     cap so one malicious or generated subtree cannot starve the
     global budget. On overflow, the subtree is partially returned and
     added to `truncatedSubtrees`.

### 2.4 `sha256-canonical` — compute the marker checksum

Request (Markdown / `.mdc`):
```json
{"op": "sha256-canonical", "kind": "markdown", "bytes": "<base64-encoded-content>"}
```

Request (JSON):
```json
{"op": "sha256-canonical", "kind": "json", "bytes": "<base64-encoded-content>"}
```

Response:
```json
{"ok": true, "sha256": "<lowercase-hex>"}
```

Behavior:
- **Markdown / `.mdc`:** Reject if the bytes start with a UTF-8 BOM.
  Locate the first `\n`. Take the byte slice from the index after that
  `\n` to the end of the input. SHA-256 over the slice. No NFC
  normalization, no whitespace trimming.
- **JSON:** Reject if the bytes contain a UTF-8 BOM. Compute the
  canonical re-serialization: parse the bytes as RFC 8259 strict
  (top-level object required, no comments, no trailing commas), remove
  the keys `_generatedBy`, `_skillVersion`, `schemaVersion`,
  `_markerChecksum`, `generatedAt`, `_static`, re-emit with sorted keys
  at every level, 2-space indent, LF newlines, no trailing whitespace,
  one final newline, UTF-8 no BOM. SHA-256 over the re-emitted bytes.
  This makes the checksum stable across human edits that change only
  whitespace, but every other content edit invalidates the marker.

### 2.5 `write-atomic` — write a file via `.tmp` + `rename(2)`

Request:
```json
{"op": "write-atomic", "workspace": "<absolute-path>", "path": "<workspace-relative-path>", "bytes": "<base64-encoded-content>"}
```

Response:
```json
{"ok": true, "sha256": "<lowercase-hex>"}
```

Behavior:
1. Resolve the **parent directory** via § 2.1 (the file itself does
   not exist yet on first write).
2. Reject if `path` is not in the SKILL.md § "Hard guarantee"
   allow-list.
3. Write to `<path>.tmp` using `O_CREAT | O_EXCL | O_WRONLY` with
   permissions `0644`. If `<path>.tmp` exists, reject with
   `EEXIST`; the caller is responsible for prior cleanup.
4. `fsync(3)` the written file.
5. `rename(2)` `<path>.tmp` over `<path>`.
6. `fsync(3)` the parent directory on POSIX (no-op on Windows).
7. Return SHA-256 over the written bytes.

### 2.6 `cleanup-tmp` — startup cleanup of orphan `.tmp` files

Request:
```json
{"op": "cleanup-tmp", "workspace": "<absolute-path>"}
```

Response:
```json
{"ok": true, "deleted": ["<workspace-relative-path>", ...]}
```

Behavior: walk the allow-list paths only; for each `<path>.tmp`,
delete only when `<path>` exists and is a marker-bearing file with a
verifiable marker checksum. Never touches a `.tmp` not adjacent to a
marker-bearing target.

### 2.7 `sanitize-string` — sanitize an extracted string

Request:
```json
{"op": "sanitize-string", "value": "<utf8-string>"}
```

Response:
```json
{"ok": true, "value": "<sanitized-string-or-empty>", "dropped": <boolean>, "reason": "<one-of: empty|length|stripped|control>"}
```

Behavior:
1. NFC-normalize the input.
2. Reject (drop) if the input contains any code point in
   [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 2.1
   (control characters, line/paragraph separators, zero-width,
   bidirectional overrides). The skill emits a TODO marker for dropped
   values; partial sanitization is never returned.
3. Truncate to 80 characters with a `…` suffix when over the cap.
4. Inline-code wrap with backticks; if the value itself contains
   backticks, use the next-longer fence (` `` ` etc.).
5. Self-validate: re-scan the returned bytes for any strip-list code
   point. If any survives (which would indicate a bug), drop the value.

### 2.8 `lock` / `unlock` — workspace advisory lock

Request:
```json
{"op": "lock", "workspace": "<absolute-path>", "path": ".aem/context/.agentkit.lock"}
```

Response:
```json
{"ok": true, "acquired": true}
```
or
```json
{"ok": false, "acquired": false, "error": "another invocation is already running"}
```

Behavior: `flock(LOCK_EX | LOCK_NB)` on POSIX,
`LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY)` on
Windows. The lock is released when the helper process exits or on an
explicit `unlock` op.

### 2.9 `match-deny` — test a path against the privacy deny-list

Request:
```json
{"op": "match-deny", "workspace": "<absolute-path>", "path": "<path-to-test>"}
```

Response:
```json
{"ok": true, "denied": <boolean>, "matchedPattern": "<glob-or-null>", "matchedSegment": "<segment-or-null>"}
```

Behavior: applies the case-folded segment-by-segment match described
in [`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 1.1.

## 3. Casefold algorithm

ASCII lowercase only. Bytes `0x41-0x5A` are lowercased to `0x61-0x7A`;
every other byte is preserved verbatim. Non-ASCII filename bytes are
compared as-is. This is pinned (not Unicode full casefold) to avoid
JVM/Python casefold differences on Turkish `İ`, German `ß`, etc., which
would otherwise produce non-deterministic match results between
platforms.

## 4. Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Hard error (path rejected, missing helper, IO failure, version mismatch). |
| `2` | Soft warning (degraded but completed; e.g. walk caps tripped). |

The skill maps helper exit codes onto its own (SKILL.md § Generation
order): a single helper `1` aborts the current step; the multi-step run
resumes idempotently on the next invocation. A helper `2` propagates a
`warningStubs` entry but does not abort.

## 5. Reference implementation

A reference implementation in Python 3.10+ (no third-party
dependencies) ships in the skill bundle at
[`bin/aem-agentkit-helper`](../bin/aem-agentkit-helper). The
implementation is ~500 lines (POSIX only: Linux + macOS; Windows is
rejected at startup until a separate release adds the Win32 syscall
surface).

The bundle's `tests/` directory holds the helper's golden-output unit
tests covering: byte-exact SHA-256 across the canonical-body shapes
(Markdown body excludes the marker line; JSON re-serialization strips
the six marker fields and re-emits with sorted keys), sanitization on
every strip-list code-point category (control / line-paragraph
separator / zero-width / bidi override / format), realpath / deny-list
/ workspace-escape / special-filesystem rejection, deny-list directory
pruning at every depth, walk caps with `truncatedSubtrees`, atomic
`write-atomic` (no `.tmp` leftovers), and lock acquisition with
stale-lock recovery via PID liveness check.

Run the tests from the skill root:

```bash
tests/run-tests.sh
```

CI runs the same script through `npm test`.

## 6. What the helper never does

- Read or write any path outside the workspace root.
- Read any file matching the privacy deny-list.
- Modify any pre-existing file lacking the skill's marker.
- Execute customer-supplied code (it never `exec`s anything from the
  workspace; the only subprocesses it spawns are platform
  syscalls).
- Emit absolute filesystem paths in error messages.
