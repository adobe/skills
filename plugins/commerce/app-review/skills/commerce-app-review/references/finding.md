# Finding format

Each enriched finding uses this structure:

```
MUST-1: <reworded finding title>

<paragraph 1 — context: explain the issue clearly>

<paragraph 2 — remediation: specific steps or best practices, grounded in docs agent results or App Builder knowledge>

<paragraph 3 — generic code pattern, if applicable>

**Proposed fix** ([relative/path/to/file.js](file:///absolute/FILE_PATH) line <LINE_NUMBER>):
<before/after snippet drawn from the actual file>

<paragraph 4 — references as a bulleted list, if available; mask URLs under link text>

<!-- category: security -->
```

Omit the "Proposed fix" section when `FILE_PATH` is empty (a general issue with no specific file).

Merge two or more closely related findings into a single enriched entry before assigning a code.
