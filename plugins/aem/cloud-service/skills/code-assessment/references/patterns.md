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
  parses the workspace and emits findings — see [`../scripts/README.md`](../scripts/README.md)).
  Every `ready` pattern uses `analyzer`; there is no LLM-scan code path in this version.
  `planned` rows leave it `-` — the detector is built (and this set to `analyzer`) when the
  pattern reaches `ready`. When the user names targets directly, that's the `with_findings`
  invocation mode (see [`../SKILL.md`](../SKILL.md)), not a per-pattern detection method.
- **fix** — `mechanical` (deterministic edit) | `guided` (LLM-judgment remediation).
  Set only when a pattern reaches `ready` and has a recipe to prove it; `planned` rows
  leave it `-` (the fix approach is decided when the pattern is built).

`planned` patterns are ordered by remediation value — they are the roadmap, our prioritization.

## Catalog

| pattern | description | severity | status | detection | fix |
|---|---|---|---|---|---|
| [`inject-in-sling-model`](../inject-in-sling-model/SKILL.md) | migrate `@Inject` fields in `@Model` classes to injector-specific annotations | high | ready | analyzer | mechanical |
| [`outdated-dependencies`](../outdated-dependencies/SKILL.md) | upgrade stale Maven dependency versions | medium | ready | analyzer | mechanical |
| [`scheduler`](../scheduler/SKILL.md) | migrate `org.apache.sling.commons.scheduler.Scheduler` / `implements Job` to Cloud Service-compatible OSGi properties or Sling Jobs via `JobManager` | high | ready | analyzer | guided |
| [`resource-change-listener`](../resource-change-listener/SKILL.md) | migrate JCR `EventListener` / resource-topic `EventHandler` to lightweight `ResourceChangeListener` + `JobConsumer` | high | ready | analyzer | guided |
| [`replication`](../replication/SKILL.md) | migrate CQ `Replicator` / Sling Replication Agent to the Sling Distribution API (`Distributor` + `SimpleDistributionRequest`) | high | ready | analyzer | guided |
| [`event-migration`](../event-migration/SKILL.md) | migrate OSGi `EventHandler` with inline business logic (replication / workflow / custom topics) to lightweight `EventHandler` + `JobConsumer` split, with `TopologyEventListener` for leader-only execution | high | ready | analyzer | guided |
| [`asset-manager`](../asset-manager/SKILL.md) | migrate DAM `AssetManager` create/upload via Direct Binary Access (`@adobe/aem-upload`) and delete via in-JVM `resolver.delete()` + `commit()` or HTTP Assets API; removes `createAssetForBinary` / `getAssetForBinary` / `removeAssetForBinary` (not available on CS) | high | ready | analyzer | guided |
| [`outbound-call-timeouts`](../outbound-call-timeouts/SKILL.md) | add connect/read/socket timeouts to outbound HTTP client construction (Apache HttpClient, OkHttp, JDK HttpClient) | high | ready | analyzer | mechanical |
| [`unbounded-query`](../unbounded-query/SKILL.md) | bound or escalate an explicitly-unbounded query (`p.limit=-1` predicate / `setLimit(-1)`) — safe-cap where provable, else flag for pagination | high | ready | analyzer | guided |
| `unclosed-resources` | close `ResourceResolver` / `Session` / streams via try-with-resources | high | planned | - | - |
| `thread-lock-contention` | replace coarse `synchronized` / synchronized collections on shared state with concurrent types | high | planned | - | - |
| `heavy-model-init` | move heavy work (I/O, queries) out of `@PostConstruct` / Sling Model init | medium | planned | - | - |
| `in-process-image-processing` | move in-request `BufferedImage` / `ImageIO` work to renditions / async | medium | planned | - | - |
| `unbounded-recursion` | add a depth guard to self-recursive / tree-traversal methods (incl. navigation & breadcrumb) | medium | planned | - | - |
| `unbounded-graphql` | add pagination (`first` / `limit`) to GraphQL queries | medium | planned | - | - |
| `logging-in-loops` | move logging out of hot loops / add level guards | low | planned | - | - |
| [`remove-deprecated-api`](../remove-deprecated-api/SKILL.md) | migrate deprecated and removed Java imports, Maven dependencies, and unmodifiable OSGi configs to comply with AEM as a Cloud Service enforcement policies; uses direct AI edits + AI-assisted build-error fixes | high | ready | analyzer | mechanical |

> Out-of-memory / leak incidents — a frequent symptom — are usually caused by
> the patterns above (unbounded queries, unclosed resources, in-process image work, heavy init).
> They are addressed indirectly by fixing those, so there is no standalone `oom` row.

**Adding a pattern:** append a row with `status: planned` and `fix: -`; when you build its expert
skill, flip to `status: ready` and set the real `fix`. Fields are defined above.
