# Pattern catalog

The full set of code-quality patterns this skill handles — one row per pattern.
This table is the **single source of truth** for per-pattern metadata; it is not
duplicated into the expert skills (which hold the how-to).

Adding a pattern: add a row here, then build the expert skill from
[`_template.md`](_template.md). Routing of a user request to a pattern lives in
[`../SKILL.md`](../SKILL.md) (Manual Pattern Hints).

## Fields

- **pattern** — slug; matches the expert-skill directory name.
- **description** — one line.
- **severity** — `high` | `medium` | `low`. The report orders findings by this (highest first).
- **status** — `ready` (expert skill built) | `planned` (catalogued placeholder, not built yet).
- **detection** — how instances are found: `analyzer` (the deterministic local analyzer
  parses the workspace and emits findings — see [`../scripts/README.md`](../scripts/README.md))
  or `scan` (legacy LLM workspace search, used only where no analyzer detector exists yet).
  When the user names targets directly, that's the `with_findings` invocation mode
  (see [`../SKILL.md`](../SKILL.md)), not a per-pattern detection method.
- **fix** — `mechanical` (deterministic edit) | `guided` (LLM-judgment remediation).
  Set only when a pattern reaches `ready` and has a recipe to prove it; `planned` rows
  leave it `-` (the fix approach is decided when the pattern is built).

`planned` patterns are ordered by remediation value — they are the roadmap, our prioritization.

## Catalog

| pattern | description | severity | status | detection | fix |
|---|---|---|---|---|---|
| [`inject-in-sling-model`](../inject-in-sling-model/SKILL.md) | migrate `@Inject` fields in `@Model` classes to injector-specific annotations | high | ready | analyzer | mechanical |
| [`outdated-dependencies`](../outdated-dependencies/SKILL.md) | upgrade stale Maven dependency versions | medium | ready | analyzer | mechanical |
| `outbound-call-timeouts` | add connect/read timeouts to outbound HTTP / `URLConnection` calls | high | planned | scan | - |
| `unbounded-query` | bound QueryBuilder / JCR / SQL2 queries (`p.limit=-1` → limit + pagination) | high | planned | scan | - |
| `unclosed-resources` | close `ResourceResolver` / `Session` / streams via try-with-resources | high | planned | scan | - |
| `thread-lock-contention` | replace coarse `synchronized` / synchronized collections on shared state with concurrent types | high | planned | scan | - |
| `heavy-model-init` | move heavy work (I/O, queries) out of `@PostConstruct` / Sling Model init | medium | planned | scan | - |
| `in-process-image-processing` | move in-request `BufferedImage` / `ImageIO` work to renditions / async | medium | planned | scan | - |
| `unbounded-recursion` | add a depth guard to self-recursive / tree-traversal methods (incl. navigation & breadcrumb) | medium | planned | scan | - |
| `unbounded-graphql` | add pagination (`first` / `limit`) to GraphQL queries | medium | planned | scan | - |
| `logging-in-loops` | move logging out of hot loops / add level guards | low | planned | scan | - |

> Out-of-memory / leak incidents — a frequent symptom — are usually caused by
> the patterns above (unbounded queries, unclosed resources, in-process image work, heavy init).
> They are addressed indirectly by fixing those, so there is no standalone `oom` row.

**Adding a pattern:** append a row with `status: planned` and `fix: -`; when you build its expert
skill, flip to `status: ready` and set the real `fix`. Fields are defined above.
