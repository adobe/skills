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
`refactoring-job` output (report + refactored code). Reference fixture: the public
`aem-guides-wknd` sample in its legacy pre-Cloud shape. Automated suite: **298 tests**.

## Structural output vs CAM

| Project | OSGi `.cfg.json` | ui.apps filters | `all` embeds | packageType | Gate |
|---|---|---|---|---|---|
| Project A | 14 = 14 | 1 = 1 | 4 = 4 | match | PASS |
| Project B | 747 = 747 | match | match | match | PASS |
| Project C (sub-project) | 1 = 1 | 2 = 2 | — | match | PASS |
| Project D | 17 = 17 | 4 = 4 | 4 = 4 | match | PASS |

→ **Structural parity with CAM on all four** (byte-identical where it matters:
filters, embeds, packageType; OSGi count + values match).

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
- **appId naming** can differ (skill uses reactor artifactId; CAM derives from embeds).

## Readiness
Ready as a **human-reviewed** modernization pre-step for SINGLE / NESTED / MULTI /
MONOLITHIC projects. Recommended before broad rollout: additional real repos across
shapes (each new project so far has hardened 1–2 edge cases).
