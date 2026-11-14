# Recipe — Outdated Maven dependencies

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Input contract

The recipe expects the following fields, per outdated-dependency finding, regardless of how they were obtained:

| Field | Example | Source |
|---|---|---|
| `file` | `core/pom.xml` | Repo-relative path to the pom.xml |
| `groupId` / `artifactId` | `org.mockito` / `mockito-core` | Maven coordinates of the dependency |
| `currentVersion` | `4.4.0` | Value present in the developer's file |
| `targetVersion` | `5.14.0` | Value to upgrade to — **user-supplied** |
| `shape` | `literal` or `property` | Detected locally by reading the pom (see Pattern A vs B below) |
| `propertyName` | `mockito.version` | Detected locally; only meaningful when `shape=property` |

These fields come from the user's request plus local inspection:

1. **User-named** — the user names the dependency and target in their prompt (e.g. *"upgrade mockito-core to 5.14.0 in core/pom.xml"*); the skill reads the local pom to confirm the current shape.
2. **Discover** — a repo scan surfaced the candidate; the user supplies the target version. The skill reads the local pom for `shape` / `propertyName`.

The `targetVersion` is always user-supplied — the skill never invents a version.

## Pattern A: literal version

### When to use

Finding has `"shape": "literal"`.

### Locator

Inside the file at `findings[].file`, find the `<dependency>` element matching:

```xml
<dependency>
  <groupId>{groupId}</groupId>
  <artifactId>{artifactId}</artifactId>
  <version>{currentVersion}</version>
  ...
</dependency>
```

Where `{groupId}`, `{artifactId}`, and `{currentVersion}` match the finding exactly. Any order of inner elements is acceptable — match by element names, not position.

### Edit

Replace the text inside `<version>` from `{currentVersion}` to `{targetVersion}`. Do not touch whitespace or attributes.

### Unlocatable

If no `<dependency>` block matches all three of `groupId`, `artifactId`, `currentVersion`, the edit is unlocatable. Record `skipped` with reason `literal-not-found: <groupId>:<artifactId>@<currentVersion> not present in <file>`. Continue with remaining findings.

### Example

Before:
```xml
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <version>4.4.0</version>
  <scope>test</scope>
</dependency>
```

After:
```xml
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <version>5.14.0</version>
  <scope>test</scope>
</dependency>
```

## Pattern B: property-based version (same pom)

### When to use

Finding has `"shape": "property"` with `"propertyName": "<key>"`.

### Locator

Inside the file at `findings[].file`, find the `<properties>` block and the element named `<{propertyName}>`:

```xml
<properties>
  ...
  <{propertyName}>{currentVersion}</{propertyName}>
  ...
</properties>
```

Validate:
1. The element exists under `<properties>`.
2. Its text content equals `currentVersion` exactly.
3. There is at least one `<dependency>` in the same file whose `<version>` is `${propertyName}` and whose `groupId`/`artifactId` match the finding. (Sanity check — prevents editing an unrelated property that happens to match the name.)

### Edit

Replace the text inside `<{propertyName}>` from `{currentVersion}` to `{targetVersion}`.

### Unlocatable

If any of the three validation conditions fails, the edit is unlocatable. Record `skipped` with reason:
- `property-missing: <propertyName> not in <file>` if condition 1 fails
- `property-value-mismatch: <propertyName> is <actual>, expected <currentVersion>` if condition 2 fails
- `property-not-referenced: no <dependency> using ${{propertyName}} for <groupId>:<artifactId>` if condition 3 fails

Continue with remaining findings.

### Example

Before:
```xml
<properties>
  <mockito.version>4.4.0</mockito.version>
</properties>
...
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <version>${mockito.version}</version>
</dependency>
```

After:
```xml
<properties>
  <mockito.version>5.14.0</mockito.version>
</properties>
...
<dependency>
  <groupId>org.mockito</groupId>
  <artifactId>mockito-core</artifactId>
  <version>${mockito.version}</version>
</dependency>
```

## Multi-module caveat

Some AEM projects reference the same property in multiple child poms via parent inheritance. This skill only handles properties defined in the **same pom** as the dependency. Parent-pom inheritance is not currently supported — leave those for a manual fix.

## Editing strategy

Use a text-level surgical replace, not a generic XML re-serializer, to preserve the developer's exact formatting (indentation, comments, attribute order). Anchor the replace on the full locator match so unrelated identical values (e.g. a comment containing `4.4.0`) are not touched.

Concretely:
1. Read the file.
2. Find the smallest substring that uniquely matches the locator (including element tags around the version text).
3. Replace only the `{currentVersion}` text within that match.
4. Write the file back.

If the locator match is not unique (e.g. the same `<groupId>`/`<artifactId>`/`<version>` triple appears twice in one file), record `skipped` with reason `ambiguous-locator: multiple matches for <groupId>:<artifactId>@<currentVersion> in <file>`.
