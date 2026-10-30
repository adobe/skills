# CAM validation — what we tested & results

The `repo-modernize` skill is validated head-to-head against the CAM Repository
Modernizer's own output. This is the evidence a reviewer needs; the transform rules
themselves are in `transform-rules.md`. Project identities are anonymized; each row is
a distinct real customer AEM codebase.

## Codebases tested (4 real customer projects, anonymized)

| Project | Shape | Scale / notable |
|---|---|---|
| Project A | SINGLE | AMS/6.5; 1 bundle, 2 content pkgs, 14 OSGi configs |
| Project B | NESTED | 4 bundles, ~750 OSGi configs, multi-brand app-trees |
| Project C | MONOLITHIC | root + one sub-project; partly Cloud-restructured |
| Project D | SINGLE | large, partly Cloud-restructured; ~3000 files, 26 config folders |

Method: run the skill, diff its output against the same project's actual CAM
`refactoring-job` output (report + refactored code). Automated suite: **416 tests**, run
against an in-repo copy of the public `aem-guides-wknd-legacy` sample
(`plugins/aem/cloud-service/test/repo-modernize/run-tests.sh`).

## Structural output vs CAM

| Project | OSGi `.cfg.json` | ui.apps filters | `all` embeds | packageType | Gate |
|---|---|---|---|---|---|
| Project A | 14 = 14 | 1 = 1 | 4 = 4 | match | PASS |
| Project B | 747 = 747 | match | match | match | PASS |
| Project C (sub-project) | 1 = 1 | 2 = 2 | — | match | PASS |
| Project D | 17 = 17 | 4 = 4 | 4 = 4 | match | PASS |

→ **Structural parity with CAM on all four** (byte-identical where it matters:
filters, embeds, packageType; same OSGi configs). OSGi *values* now keep their source
types where CAM writes strings — see the differences below.

## OSGi values vs CAM (re-validated with typed conversion)

Same four projects, the skill's `.cfg.json` compared value by value with CAM's. Every difference is
either a value the skill now types, or a CAM defect where the skill's value is what AEM 6.x actually loaded:

| Project | Files | Identical | Typed (`true` vs `"true"`) | Other differences (all CAM defects unless noted) |
|---|---|---|---|---|
| Project A | 14 = 14 | 36 | 9 | 15 `{Decimal}` values: AEM's JCR installer ignored that type, so the skill leaves them out and reports each (`RM-907` NORMAL); CAM writes them as strings |
| Project B | 747 = 747 (legacy unit) | 6,515 | 437 | 764 namespaced JCR properties (e.g. `cq:lastReplicated`, `jcr:mixinTypes`) that AEM's installer skips but CAM copies into configs; 418 values where CAM deletes non-ASCII characters (`Inovação` → `Inovao`); 9 regexes where CAM strips backslashes (`\.` → `.`); 2 empty arrays CAM writes as `[""]` |
| Project C | 66 = 66 | 240 | 56 | 5 empty arrays CAM writes as `[""]`; 1 regex where CAM keeps DocView escapes |
| Project D | 17 = 17 | byte-identical (already `.cfg.json`) | — | — |

No source config was rejected as unreadable (`RM-907` HIGH) on any of the four projects.

## Findings — more accurate than CAM (every project)

CAM's 3rd-party detection (RM-101) uses a 4-prefix allow-list that both over-flags
and under-flags. The skill corrects both, verified per project:

| Project | CAM false-positives skill EXEMPTS | CAM blind-spots skill CATCHES |
|---|---|---|
| Project A | 6 (bndlib, findbugs, javax×2, mail, slf4j) | 4 (poi×2, commons-lang3, commons-collections) |
| Project B | 6 (bndlib, aem-mock, javax×2, annotation, junit) | 4 (poi×2, commons-csv, commons-email) |
| Project C | 5 (javax×2, annotation, junit-platform, slf4j) | 0 |
| Project D | 5 (jsr305, javax×2, mail, slf4j) | 4 (commons-io/lang/email/lang3) |

- **RM-108 (run modes):** exact match on every processed unit.
- **RM-104 (Project D):** N/A — the skill keeps the test bundle in the reactor in-place;
  nothing to warn about (CAM removed it, then flagged it).

## Also corrects CAM's documented bugs
OSGi value-formatter truncation; destructive template-module deletion; dropped
LOW-priority findings; `org.apache.*` 3rd-party blind spot; vendored local-`repository/`.

## Known behavioral differences (by design, not defects)
- **In-place git diff** vs CAM's copy-to-`modernized/` tree (reviewable/committable).
- **Partly-modernized projects** (Project C root, Project D): the skill modernizes what
  it safely can and the **verify gate flags the rest for human review** rather than
  blindly re-modernizing. On Project C the real legacy sub-project matches CAM; the
  hand-rolled root `all` (which never had `packageType=container`) is flagged.
- **appId naming** can differ (skill proposes the reactor artifactId; CAM derives it from
  the embed targets). The plan review step is where the user confirms it.
- **Typed OSGi values.** `{Boolean}true` becomes `true` and `{Long}5` becomes `5`, as AEM
  read them; CAM writes the strings `"true"` and `"5"`. `.cfg` values stay strings in both
  (that format only has strings).
- **Java level and plugin versions.** A legacy compiler level below 11 is raised to 11
  (`RM-908`), and the FileVault, content-package and analyser plugins get managed versions;
  CAM gets both from the archetype reactor it regenerates.
- **Archetype version.** The skill's templates are generated from AEM Project Archetype 58
  (CAM's are archetype 56, reformatted by CAM), so the module POMs differ in formatting,
  `${project.version}` references and archetype 58's Oak index settings. Filters, embeds and
  packageType (the parity columns above) are unchanged; re-checked on the public WKND sample.

## Why not wrap Adobe's public npm Repository Modernizer?
The `migration` skill wraps Adobe's npm Dispatcher converter, so the same was tried here:
`@adobe/aem-cs-source-migration-repository-modernizer` 1.2.3 (latest) on the same public
`aem-guides-wknd-legacy` sample. Its content split, filters and `.cfg.json` files matched
this skill's, but its output does not build:

- `all/pom.xml` embeds `core` without a version, so Maven rejects the project before building
  (`'dependencies.dependency.version' for ...core:jar is missing`).
- `ui.apps.structure` is not listed in the reactor, and the `it.tests`, `it.launcher` and
  `dispatcher` modules are dropped.
- Templates are archetype-24-era (FileVault plugin 1.1.4, analyser 0.0.12, Core Components
  2.8.0); the Felix SCR plugins and Java 1.8 are kept.
- If its Maven Central lookup fails (e.g. behind a proxy), it stops after the content split —
  the POM and OSGi steps never run — and still exits 0.

Wrapping it would mean repairing its output afterwards, which is more code than producing
the output directly, and would not match CAM's current behavior.

## Readiness
Beta: ready as a **human-reviewed** modernization pre-step for SINGLE / NESTED / MULTI /
MONOLITHIC projects. Recommended before broad rollout: additional real repos across
shapes (each new project so far has hardened 1–2 edge cases).
