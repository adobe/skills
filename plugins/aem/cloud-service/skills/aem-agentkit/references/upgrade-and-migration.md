# Upgrade path and schema migration

> **Beta Skill:** Outputs must be reviewed before applying to production.

## 1. Marker shape

| File type | Marker |
|---|---|
| Markdown / `.mdc` (first content line) | `<!-- aem-agentkit: generated v1.0.0-beta; safe to delete or edit. checksum: <sha256> -->` |
| JSON (top-level fields) | `"_generatedBy": "aem-agentkit"`, `"_skillVersion": "1.0.0-beta"`, `"schemaVersion": "1"`, `"_markerChecksum": "<sha256>"`; static-reference JSON files also carry `"_static": true`. |

`<sha256>` is the SHA-256 of the canonical body bytes (lowercase hex,
no separators, 64 characters). Canonicalization is pinned to remove
ambiguity and is performed by the deterministic helper's
`sha256-canonical` operation (see [`helpers.md`](./helpers.md) § 2.4):

- **Markdown / `.mdc`:** the marker is the first non-blank line. The
  checksummed body is the raw bytes of everything after the first `\n`
  that terminates the marker line, up to and including the final
  newline of the file. Line endings are LF only (the output stability
  rule enforces LF on write). No NFC normalization, no whitespace
  trimming: byte-exact over the post-marker content.
- **JSON:** the checksummed body is the canonical re-serialization of
  the parsed object **with the marker fields removed**: `_generatedBy`,
  `_skillVersion`, `schemaVersion`, `_markerChecksum`, `generatedAt`,
  and `_static`. Canonical re-serialization: sorted keys at every
  level, 2-space indent, LF line endings, UTF-8 no BOM, no trailing
  whitespace, final newline. Two consequences:
  - `generatedAt` is **not** part of the checksum, so two runs that
    change only the timestamp produce identical marker checksums and
    leave the file untouched on disk.
  - A customer hand-edit to the JSON body (changing any value, adding
    or removing keys, even reordering keys) changes the post-canonical
    byte sequence and invalidates the marker, so the file is correctly
    classified as human-curated on the next run.
- **Encoding:** UTF-8 without BOM throughout. A file with a BOM at the
  start fails the marker check.

The helper version is pinned by content-addressable SHA-256 in this
section. The skill compares its own `metadata.version` (`1.0.0-beta`)
against the helper's `--version` output before any operation; mismatch
aborts the run. The helper's SHA-256 is part of the published skill
bundle's release notes and is verified before the first invocation.

A marker with a `<sha256>` that does not recompute under this rule is
treated as **human-curated** per
[`collision-rules.md`](./collision-rules.md) § Marker check.

## 2. Skill version bump

When a new aem-agentkit version ships:

1. On run, the skill compares the marker's `_skillVersion` (JSON) /
   `vX.Y.Z[-PRE]` (Markdown) against its own version.
2. If equal → idempotency rules in [`collision-rules.md`](./collision-rules.md).
3. If older → re-render from the new templates. Write to `.agentkit-new`
   when checksum differs, **except** for files carrying `_static: true`
   (see § Static-reference handling).
4. The skill never auto-replaces marker-bearing files across version
   bumps for non-static files.

### Static-reference handling

Static-reference files (`.aem/context/aem-api-namespaces.md` and
`.aem/context/README.md`) are project-agnostic — their byte content is
the same across every customer's repo, so a skill version bump that
changes their template should not produce a `.agentkit-new` sidecar
for every customer. The marker for these files carries `_static: true`
(Markdown: in a second-line metadata comment immediately after the
marker line; JSON: as a top-level field). On a version bump that
changes the template:

1. Skill detects the existing file is marker-bearing, checksum is valid,
   and `_static: true` is present.
2. Skill renders the new content from the current template.
3. If the new content differs, the skill **overwrites in place**
   (helper `write-atomic`) rather than producing a `.agentkit-new`.
4. The manifest records `kind: "static-reference"` for every such file
   so `/agents-md-check` understands the exception.
5. This is the **only** code path in which the skill overwrites a
   marker-bearing file without customer review. A customer who wants to
   prevent the overwrite removes the `_static: true` marker field; the
   file then follows the normal idempotency rules and goes to
   `.agentkit-new` on the next bump.

## 3. Schema migration

JSON files include `schemaVersion`. When the existing value is older than
the skill's current schema:

1. Apply migration rules below in order from old → new.
2. Bump `schemaVersion` to the current value.
3. Drop deprecated fields, preserving their previous values in the
   `warningStubs` array for one version before final removal.
4. Add new fields with safe defaults.
5. Write migrated content to `<file>.agentkit-new`; never destructive.

### Migration rules

| From → To | Component | Change |
|---|---|---|

(no real migrations yet — the table is reserved for future schema
changes.)

### Worked example (schemaVersion 1 → 2)

Suppose `components.json` schemaVersion 2 adds a required
`htlPrecompiled` boolean field and renames `dialogFieldNames` to
`dialog.fieldNames` (nested under a new `dialog` object).

The migration step renders the new file as follows:
1. Read the existing file. Validate `schemaVersion: "1"`.
2. For each `components[]` entry, copy every field. Move
   `dialogFieldNames` → `dialog.fieldNames` and `dialogPath` →
   `dialog.path`. Set `htlPrecompiled` to `false` (safe default).
3. Move the old `dialogFieldNames` and `dialogPath` values into
   `warningStubs` as a single migration-trace entry so a customer can
   diff what was rewritten.
4. Bump `schemaVersion` to `"2"`.
5. Recompute the marker checksum over the migrated body using the
   helper.
6. Write to `<file>.agentkit-new` only. Do not overwrite the v1 file.

The customer reviews `diff components.json components.json.agentkit-new`
and either accepts (`mv`) or rejects (`rm`).

The skill ships golden-output tests against this exact 1→2 migration on
a fixtures workspace as part of the helper's test suite — the migration
code path has been exercised end-to-end before any real customer
depends on it.

## 4. Reversibility

To remove every artifact produced by this skill, the customer:

1. Deletes every file carrying an `aem-agentkit` marker.
2. Removes `.aem/context/` if it has no other contents.
3. No system changes are made; nothing is installed outside the workspace
   root.

A grep helper:

```bash
# List every file generated by aem-agentkit
grep -rlF "aem-agentkit: generated" . 2>/dev/null
grep -rlF '"_generatedBy": "aem-agentkit"' . 2>/dev/null
```

The run manifest at `.aem/context/.agentkit-manifest.json` lists every
generated file by path; `jq -r '.files[].path' .aem/context/.agentkit-manifest.json`
is the authoritative removal list once a run has produced a manifest.

## 5. Forward compatibility

- New top-level JSON keys are permitted; the skill ignores unknown keys
  when reading marker files.
- New required fields for a schemaVersion go behind the migration step
  above so older repos do not break.
- Removing a field requires a deprecation cycle of at least one minor
  version with the field still emitted alongside a `warningStubs`
  deprecation notice, plus 90 days from the release notes' deprecation
  announcement.
