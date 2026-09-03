---
name: extracting-jcr-queries
description: Use when auditing a codebase to find every JCR query it issues — XPath, SQL2, or AEM QueryBuilder predicates, including ones assembled programmatically through wrapper/helper/DAO code — before an Oak index audit, migration, performance investigation, or when asked "what queries does this app run".
license: Apache-2.0
compatibility: Any AEM/Oak codebase (Java, JSP/HTL, or config-driven) issuing JCR or AEM QueryBuilder queries.
---

# Extracting JCR Queries

## Overview

Most real queries in AEM/Oak codebases are not string literals — they're
assembled at runtime (`StringBuilder` concatenation, predicate maps built
from named constants, fluent builders) and executed through a small set of
APIs: `javax.jcr.query.QueryManager` / `Query` or `com.day.cq.search.QueryBuilder`
/ `PredicateGroup`. Grepping for the query *text* misses these entirely — a
query built as `sb.append("SELECT * FROM [").append(nodeType)...` produces
zero hits on any literal-shape pattern despite being a live query.

Two complementary techniques. Use both; neither alone is a parser — treat
matches as a candidate inventory, review by hand.

## Tooling requirement

Every command below is written for `ripgrep` (`rg`). Check it's actually there before running anything:
```
command -v rg >/dev/null && echo "rg found" || echo "rg missing — use the fallback command under each pattern"
```
**If `rg` is missing, `grep -P` is not a safe substitute.** GNU grep supports `-P`, but macOS's stock
BSD grep does not — `grep -P "..."` fails with `grep: invalid option -- P` on an unmodified Mac, the
same failure mode as a missing `rg`. Don't assume `grep -P` as a drop-in fallback; use the portable
`grep -E` command given under each pattern below instead (verified against BSD grep). One pattern (the
multi-line predicate-map form in Technique 2) has no line-based fallback at all — see its note. Prefer
installing `rg` when you can (`brew install ripgrep` / `apt install ripgrep`) — faster, recurses by
default, and the only way to run that one pattern.

## When to use

- Building an inventory of queries before checking Oak index coverage
- "What queries does this app/bundle issue?"
- Hunting for a query missing a matching index (traversal warnings, slow query logs)
- Auditing a bundle/package before migration or refactor

## Technique 1: API-surface tracing (primary)

Anchor on the API, not the query text. Every JCR/QueryBuilder query passes
through one of a handful of call shapes, no matter how the query itself was
built.

**Step 1 — find direct API entry points:**
```
rg -n -P "getQueryManager\(\)|\.createQuery\(|PredicateGroup\.create\("
rg -n -P "^\s*import\s+(javax\.jcr\.query|org\.apache\.jackrabbit\.oak\.query|com\.day\.cq\.search)"
```
No `rg`? Portable fallback (verified against BSD grep):
```
grep -rnE "getQueryManager\(\)|\.createQuery\(|PredicateGroup\.create\(" .
grep -rnE "^[[:space:]]*import[[:space:]]+(javax\.jcr\.query|org\.apache\.jackrabbit\.oak\.query|com\.day\.cq\.search)" .
```
These match the JCR API (`QueryManager`, `Query`) and the AEM QueryBuilder
API (`QueryBuilder`, `PredicateGroup`) regardless of how the query
content itself is constructed.

**Step 2 — classify each hit as a trigger or a wrapper:**
Is this call site invoked directly from a request/job entry point, or is it
inside a helper/service/DAO that other code calls into with generic
parameters (nodeType, path, a predicate map)? Class names like `*Service`,
`*Helper`, `*Dao`, `*Repository`, `*QueryUtil` and methods called from more
than one place are signals of a wrapper.

**Step 3 — pan out: trace every caller of the wrapper:**
```
rg -n "WrapperClassName\b"
rg -n "\.wrapperMethodName\("
```
No `rg`? Portable fallback (drops the `\b` word boundary — GNU extension, not POSIX; accept the small
risk of matching a longer identifier that merely contains the name as a substring):
```
grep -rnE "WrapperClassName" .
grep -rnE "\.wrapperMethodName\(" .
```
A wrapper can itself be wrapped by another layer — repeat until you reach
either a genuine external entry point (servlet, scheduled job, event
listener) with no further in-repo caller, or you've enumerated every call
site. Each distinct caller is a distinct trigger path and belongs in the
inventory as its own row, even if they all route through the same
construction site.

**Step 4 — record what's fixed vs. dynamic at each caller:**
Note which parameters (path, node type, predicate values) are hardcoded
literals at that call site vs. passed through unconstrained from further up
the chain. An unconstrained node type/path means the query's real shape
varies by caller — that matters for index coverage.

## Technique 2: literal-shape regex (supplementary)

For query text that never touches a Java API call in this repo — hardcoded
in JSP/JS/HTL, config files, or query-string URLs — anchor on the shape of
the query text itself instead. Pure `rg`/`grep`, use double-quoted shell
strings (patterns contain literal `"`/`'`). Each pattern below has a portable
`grep -E` fallback (verified against BSD grep) except the last one, which
genuinely needs `rg -U`'s multi-line matching — see its note.

**SQL2** — `SELECT ... FROM [nodetype]`:
```
rg -n -i -P "\bselect\b.{0,200}?\bfrom\b\s*\[[\w:.]+\]"
```
No `rg`? (drops the lazy `.{0,200}?` and `\b`/`\w` PCRE shorthands — may over-match a line with more
than one `select`/`from` pair, review hits by hand):
```
grep -rniE "select.{0,200}from[[:space:]]*\[[A-Za-z0-9_:.]+\]" .
```

**XPath** — `/jcr:root/...`, `//name[predicate]`, or `//element(*, NodeType)[predicate]`:
```
rg -n -P "(?:/jcr:root(?:/[^\s\"'\[\]]+)*|//(?:[\w:*]+|element\([^()]*\))(?:/(?:[\w:*]+|element\([^()]*\)))*)\[[^\[\]]*\]"
```
No `rg`? (non-capturing groups become plain groups — harmless, only matters if you'd used `-o`):
```
grep -rnE "(/jcr:root(/[^][:space:]\"'\[\]]+)*|//([A-Za-z0-9_:*]+|element\([^()]*\))(/([A-Za-z0-9_:*]+|element\([^()]*\)))*)\[[^][]*\]" .
```
The double-slash and the bracketed-predicate requirement are both deliberate: they're what stops a bare
single-`/` path fragment (e.g. `/docs/readme[1]`) or a `//` line comment followed by unrelated `array[0]`
code from matching — use `//`, not `//?`, or that false-positive comes right back. The `element(*, NodeType)` branch is
required, not optional — the plain `//[\w:*]+` name-token alternative alone cannot match through the
parens/comma inside `element(*, dam:Asset)`, so a query already using an explicit nodetype restriction
(the fix the paired `tuning-oak-query-indexes` skill recommends for its nodetype-scoping gotcha) is
otherwise invisible to this technique — live-confirmed miss before this branch was added.

**QueryBuilder, query-string form** — `path=...&type=...` (`&`-joined, e.g. a URL) or space-joined (e.g. a
stored `dam:query`/Smart Collection predicate string, which also uses numeric-prefixed nested keys like
`1_group.0_property=...` or `5_relativedaterange.property=...`):
```
rg -n -P "(?:^|[?&\"'\s])(?:\d+_)?(?:path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(?:\.(?:\d+_)?[A-Za-z]\w*)*=[^\s&\"']*(?:[&\s](?:\d+_)?(?:path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(?:\.(?:\d+_)?[A-Za-z]\w*)*=[^\s&\"']*)+"
```
No `rg`? (`\d` → `[0-9]`, `\s` → `[[:space:]]`, non-capturing groups → plain groups):
```
grep -rnE "(^|[?&\"'[:space:]])([0-9]+_)?(path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(\.([0-9]+_)?[A-Za-z][A-Za-z0-9_]*)*=[^[:space:]&\"']*([&[:space:]]([0-9]+_)?(path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(\.([0-9]+_)?[A-Za-z][A-Za-z0-9_]*)*=[^[:space:]&\"']*)+" .
```
Live-confirmed against a real stored predicate string in this repo
(`bundles/core/src/test/java/.../CollectionServletTest.java`, `1_group.0_property=...4_group.property=...`
space-separated) — the previous version of this pattern (bare `property`/`group\.\d+_group` keys, `&`-only
separator) missed it entirely; a Smart-Collection-style query is exactly the case the paired
`tuning-oak-query-indexes` skill's Section B flags as needing manual field identification, so silently
missing it here means it never even reaches that step.

**QueryBuilder, map/predicate form with literal keys** — `map.put("path", ...); map.put("type", ...)`
or `{"path": ..., "type": ...}`:
```
rg -n -U -P "\"(?:\d+_)?(?:path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(?:\.(?:\d+_)?[A-Za-z]\w*)*\"[\s\S]{0,150}?\"(?:\d+_)?(?:path|type|property|fulltext|group|nodename|orderby|relativedaterange|daterange|boolproperty|tagid|similar)(?:\.(?:\d+_)?[A-Za-z]\w*)*\""
```
Same key list as the query-string pattern above (and the same fix applies here: this used to require bare
`property(\.\d+)?`/`group\.\d+_group` keys only, which misses numeric-prefixed nested keys like
`"1_group.0_property"` if a predicate map is ever built with literal quoted keys in that shape instead of
named constants).

**No portable fallback for this one** — it needs `rg -U`'s cross-line `[\s\S]{0,150}?` matching; a
line-based `grep -E` cannot express "two keys within 150 chars, possibly across lines" at all. Without
`rg`, degrade to a two-step manual correlation instead: `grep -rn '"path"'`, `grep -rn '"type"'` (repeat
per key), then open each hit and read the surrounding `-B3 -A8` by hand to see whether the keys belong to
the same predicate map. Slower and noisier, but doesn't silently miss the construction sites.

**Scope this one by file type before running it repo-wide** — `path`/`type` are common JSON keys with no
JCR meaning at all, and combined with `-U`'s cross-line matching this pattern is the noisiest of the four.
Live-confirmed on a real ~7000-file repo: unscoped, it returned 6543 hits, almost all noise from
`package-lock.json`/`*.js`/generic `*.json` (22 hits in `package-lock.json` alone); restricting to the
languages that actually build QueryBuilder predicate maps (`rg ... -g '*.java' -g '*.jsp' -g '*.js' -g
'!**/target/**' -g '!**/node_modules/**' -g '!package-lock.json'`) cut it to 1533 (dropping to 1206 if you
narrow further to `-g '*.java'` alone, since Java is where most real predicate-map construction lives in
an AEM codebase) — still noisy enough to
need the `-B3 -A8`-and-read-by-hand step above, but tractable. Don't skip the scoping flags and conclude
the pattern is useless from an unscoped run's noise; the real signal is in there — e.g. this exact scoped
command found a genuine, otherwise-invisible-to-Technique-1 QueryBuilder call in this repo
(`tests/testing-clients/.../DAMClient.java`: `params.add("1_group.2_tagsearch.property", ...)`, a REST-style
predicate map with no `createQuery(`/`PredicateGroup.create(` anywhere in the file).

This flags a hit on the *first* two keys in a block. Pull `-B3 -A8` context
and read the whole predicate map by hand — don't trust the snippet alone.
This pattern only catches literal key strings at the call site — if keys
come from named constants (`params.put(PATH_KEY, ...)`), it will not match;
Technique 1 is what catches that case, via the `PredicateGroup.create(`
anchor.

## Workflow

1. Run Technique 1 first — it's the one that survives dynamic query
   construction. Build the wrapper/caller inventory before falling back to text search.
2. Run Technique 2 as a supplementary pass, especially over non-Java files
   (JSP, JS, HTL, config) where there's no Java API call to anchor on.
3. For each hit from either technique, open the surrounding code to confirm
   it's really a query (not a comment, test fixture, or dead code) and note
   what it queries against.
4. Merge into one inventory: file:line of the construction site, query
   type, path/nodetype/properties touched, and every caller/trigger path
   that reaches it (from Technique 1 step 3). That's the input to an
   index-coverage check.

## Common mistakes

- Relying only on the literal-shape regex and concluding "no queries found"
  when it comes back empty — an empty Technique-2 result says nothing about
  whether the codebase calls the query APIs programmatically. Always run
  Technique 1.
- Finding a wrapper's query-construction site and stopping there without
  tracing its callers (Technique 1 step 3) — the same wrapper is often
  invoked from many unrelated features, each a distinct trigger worth its
  own inventory row.
- Trusting the map-style regex's single snippet as the complete predicate
  set — it only proves two literal keys are nearby, not which keys or how many.
- Forgetting `-i` on the SQL2 pattern (`select`/`SELECT` both appear in the wild).
- Running only the XPath/SQL2 patterns and skipping QueryBuilder — in AEM
  code QueryBuilder is often the majority of queries, not raw JCR queries.
- Assuming `grep -P` is a safe substitute when `rg` isn't installed — GNU grep supports it, but macOS's
  stock BSD grep doesn't (`grep: invalid option -- P`), so it fails the same way `rg` does when missing.
  Check with `command -v rg` first and use the portable `grep -E` fallback given under each pattern.
