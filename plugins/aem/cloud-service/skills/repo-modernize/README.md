# AEM as a Cloud Service — Repository Modernizer (beta)

Restructures a legacy AEM (6.x / AMS / on-prem) Maven project into the AEM as a Cloud Service package layout (`ui.apps` + `ui.apps.structure` + `ui.config` + `ui.content` + `all`), separating immutable code from mutable content, as a reviewable change on a git branch.

See [`SKILL.md`](./SKILL.md) for when to use it and the workflow (plan → review → apply → verify), and [`references/`](./references) for the transformation rules and follow-ups.

**Requirements:** git, Python 3.9+ with `lxml` (`pip install -r requirements.txt`); Maven and JDK 11+ for the optional build check and for `--archetype`.

**Archetype templates:** generated from Adobe's AEM Project Archetype. To move to a newer release, a maintainer runs `scripts/refresh_archetype.py --update` (it generates, checks and re-pins the templates) and the tests, then opens a pull request. Users can generate them from their own archetype at apply time with `--archetype`.

**Tests:** `plugins/aem/cloud-service/test/repo-modernize/run-tests.sh` (against an in-repo copy of the public `aem-guides-wknd-legacy` sample; with Maven on the PATH it also checks the bundled templates are exactly what the pinned archetype generates).
