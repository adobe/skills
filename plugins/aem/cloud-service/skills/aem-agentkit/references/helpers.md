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
- The helper exposes `--version` (skill release version, e.g. `1.0.0-beta`)
  and `--protocol-version` (JSON-line wire protocol version, currently
  `2`). The skill compares **skill version** against `metadata.version`
  and **protocol version** against its pinned protocol version. A
  mismatch on either aborts the run with a single diagnostic naming the
  expected and observed values.
- Protocol version is decoupled from skill version so the helper can
  evolve template content (skill release bump) without breaking driver
  contracts (protocol bump). The protocol bumps when an op is added,
  removed, or its response shape changes; skill version bumps on every
  release including template-only changes. Both fields appear in the
  `protocol-version` op response.
- The helper is content-addressable. The release-time CI pipeline
  computes the helper's SHA-256 and publishes it in
  [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 1.1's
  "Helper SHA-256 pin" table for each shipped version. The skill
  verifies the on-disk helper's SHA-256 against the value pinned for
  its own skill version before the first invocation; a mismatch aborts.
  Before that table is populated, the pin is "advisory" and the run
  proceeds with a single warning entry in the summary block.
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
1. Run § 2.1 on `path`. The realpath gauntlet resolves and validates
   every intermediate directory component (intermediate-directory
   symlinks are deliberately followed so pnpm/yarn/dispatcher
   submodule layouts that rely on symlinked directories work correctly).
2. Open the fully-resolved leaf target with `os.O_RDONLY | os.O_NOFOLLOW`
   (the flag applies to the leaf only; intermediate components were
   already validated by the realpath gauntlet in step 1). Reject
   if the open fails because the leaf is itself a symlink (`ELOOP` /
   `errno.ELOOP`). Fail-closed on any open error.
3. Re-resolve the opened descriptor's canonical path using
   `/proc/self/fd/<N>` on Linux or `fcntl(F_GETPATH)` on macOS.
   Reject if it differs from the realpath resolved in step 1 — this
   closes the TOCTOU window between resolve and open.
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
{"ok": true, "files": ["<workspace-relative-posix-path>", ...], "truncated": <boolean>, "truncatedSubtrees": ["<workspace-relative-posix-path>", ...], "globalCapReached": <boolean>, "warnings": ["<message>", ...]}
```

**Glob dialect.** `globs` uses Python `fnmatch.fnmatchcase` against the
workspace-relative POSIX path. `*` matches any character INCLUDING `/`,
so `*.java` matches both `core/A.java` and `core/sub/B.java`. Git-style
recursive `**` is NOT a special token — it's two consecutive `*`s
(semantically the same as one `*`). To restrict a walk to a single
sub-tree, pass it as a root; do not rely on the glob for path-segment
scoping.

Behavior:
1. Start from each entry in `roots`. Each root passes through § 2.1
   first.
2. Walk depth-first. At every directory descent, every entry passes
   through the same realpath gauntlet as § 2.1, including a re-check
   of the resolved realpath segments against the deny-list. This
   defeats an in-workspace symlink (e.g. `<ws>/safe -> <ws>/.git`)
   that would otherwise pass the entry-name check but resolve into a
   deny-listed subtree. Pruned entries are added to `warnings` with
   the form `deny-list rejected: <workspace-relative-path>: ...`.
   The full pruned list (`target/`, `node_modules/`, `dist/`,
   `build/`, `out/`, `.git/`, `crx-quickstart/`, `.idea/`, `.vscode/`
   excluding `extensions.json`, plus any pattern from the privacy
   deny-list) is enforced at every layer of the walk.
3. Files are returned in `sort()` order on the workspace-relative
   POSIX path.
4. Caps:
   - `maxFiles` (default 100,000): global walk cap. On overflow,
     `truncated: true` and `globalCapReached: true`. The walk halts
     for all subsequent roots. The current subtree is NOT added to
     `truncatedSubtrees` (the global cap is a workspace-wide event;
     the current subtree may have been complete).
   - `maxDepth` (default 32): directory depth from the workspace root.
   - `maxFilesPerSubtree` (default 10,000): per-root cap so one
     malicious or generated subtree cannot starve the global budget.
     On overflow, the subtree is partially returned and added to
     `truncatedSubtrees`; the walk continues with the NEXT root.

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
  Skip any leading blank lines (a stray newline from an IDE
  auto-prettier must not reclassify the file as human-curated), then
  locate the first `\n`. Take the byte slice from the index after that
  `\n` to the end of the input. SHA-256 over the slice. No NFC
  normalization on the body bytes, no whitespace trimming.
- **JSON:** Reject if the bytes contain a UTF-8 BOM. Compute the
  canonical re-serialization: parse the bytes as RFC 8259 strict
  (top-level object required, no comments, no trailing commas), remove
  the keys `_generatedBy`, `_skillVersion`, `schemaVersion`,
  `_markerChecksum`, `generatedAt`, `_static` **at the top level only**
  (nested same-named keys are legitimate body content and are
  preserved), recursively NFC-normalize every string leaf (so HFS+
  NFD-on-disk and ext4/APFS NFC hash identically), then re-emit with
  sorted keys at every level, 2-space indent, LF newlines, no trailing
  whitespace, one final newline, UTF-8 no BOM. SHA-256 over the
  re-emitted bytes. This makes the checksum stable across human edits
  that change only whitespace or `generatedAt`/marker fields, but
  every other content edit invalidates the marker.

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
1. Reject if `path` is absolute or contains `..` components.
2. Run a per-segment deny-list check on `path` (the same casefold + NFC
   normalize + segment match used everywhere). Reject on any match.
3. Reject if `path` is not in the SKILL.md § "Hard guarantee"
   allow-list (helper-enforced, NOT advisory). Sidecars (`<path>.tmp`,
   `<path>.agentkit-new`) inherit their target's allow-list status.
   A test-only opt-out `enforceAllowlist: false` exists for fixture
   construction; production callers must leave it at the default.
4. Walk up to the nearest existing ancestor and realpath-check it
   stays inside the workspace BEFORE any `mkdir` side effect. The
   prior code ran `mkdir -p` first, which would create directories
   under an attacker-controlled symlink before the realpath check
   rejected. Reject if any intermediate directory between the
   ancestor and the parent is a symlink.
5. `os.makedirs(parent, exist_ok=True)`.
6. Detect case-insensitive filesystem collisions: if the target's
   basename differs from any pre-existing case-insensitive equivalent
   (e.g. `AGENTS.md` requested but `agents.md` already on disk),
   reject. Caller may opt in with `allowCaseCollision: true` to
   accept the silent rename, but the default is the safe one.
7. Write to `<path>.tmp` using `O_CREAT | O_EXCL | O_WRONLY` with
   permissions `0644`. If `<path>.tmp` exists, reject with `EEXIST`;
   the caller is responsible for prior cleanup (see § 2.6).
8. `fsync(3)` the written file.
9. `rename(2)` `<path>.tmp` over `<path>`.
10. `fsync(3)` the parent directory on POSIX.
11. Return SHA-256 over the written bytes, the matched allow-list
    glob, and a `caseCollision` flag for visibility.

### 2.6 `cleanup-tmp` — startup cleanup of orphan `.tmp` files

Request:
```json
{"op": "cleanup-tmp", "workspace": "<absolute-path>"}
```

Response:
```json
{"ok": true, "deleted": ["<workspace-relative-path>", ...], "orphansRecovered": ["<workspace-relative-path>", ...]}
```

Behavior: bounded walk over the workspace (same realpath gauntlet
as § 2.3). For each `<path>.tmp`:

- If `<path>` exists and carries the aem-agentkit marker prefix
  (Markdown `<!-- aem-agentkit: generated v` or JSON
  `"_generatedBy": "aem-agentkit"`), delete the `.tmp` (regular
  cleanup). Added to `deleted`.
- If `<path>` does NOT exist AND the `.tmp` sits at an allow-listed
  path (sidecar inherits allow-list status from its target), this is
  a crash artifact from a prior write-atomic call that died between
  `O_EXCL` create and `rename(2)`. Delete the `.tmp` so a future
  write-atomic to the same path can proceed. Added to `orphansRecovered`.
- Otherwise the `.tmp` is unrelated customer state; leave it alone.

The marker prefix is intentionally version-agnostic (no `1.0.0-beta`
literal in the substring match) so cross-version cleanup is the
default: a `.tmp` written by v0.9 is cleaned by v1.0 if its target
was authored by either version.

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

### 2.10 `read-for-context` — safe file ingestion into LLM context

Request:
```json
{"op": "read-for-context", "workspace": "<absolute-path>", "path": "<absolute-or-workspace-relative-path>", "maxBytes": <optional-int>}
```

Response (success):
```json
{"ok": true, "text": "<NFC-normalized UTF-8 with dangerous code points removed; LF/CR preserved>", "sha256": "<lowercase-hex of original raw bytes>", "stripped": <int — count of code points removed>, "toctouVerified": true}
```

Response (error): same shape and error strings as `open` (TOCTOU
mismatch, deny-list rejection, `maxBytes` exceeded).

Behavior:
1. Run the same safe-open path as § 2.2 (`open`): realpath gauntlet →
   `os.O_RDONLY | os.O_NOFOLLOW` on the fully-resolved leaf → TOCTOU
   re-check via `/proc/self/fd/<N>` (Linux) or `fcntl F_GETPATH`
   (macOS) → size cap enforcement.
2. Compute SHA-256 over the **original raw bytes** before any
   transformation. This is the `sha256` field; it lets the caller
   verify they received an unmodified read.
3. Decode the bytes as UTF-8 (replacement-character on invalid byte
   sequences).
4. NFC-normalize the decoded string.
5. Remove every code point in
   [`privacy-and-sanitization.md`](./privacy-and-sanitization.md)
   § 2.1 **except** LF (U+000A) and CR (U+000D) — line structure
   is preserved while bidi overrides, zero-width marks, BOM
   (U+FEFF), and C0/C1 controls are neutralized. Count the removed
   code points in `stripped`.
6. Return the cleaned text in `text`.

**Honesty caveat (important):** `read-for-context` neutralizes
dangerous *Unicode* code points only. It does **not** defend against
natural-language prompt injection — literal text such as
`ignore previous instructions` passes through unchanged. The
orchestrator **must** treat the returned `text` as untrusted customer
input (e.g. wrap in a fenced code block before placing in agent
context).

`read-for-context` is the **required** path for reading any customer
source file into LLM context. Raw `open` (§ 2.2) is for checksums and
binary-exact operations only; it skips Unicode normalization and the
code-point strip, so unfiltered bidi overrides and zero-width marks
can reach agent context when used directly.

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
`write-atomic` (no `.tmp` leftovers), and lock acquisition and
crash-safe release via `fcntl.flock`.

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
