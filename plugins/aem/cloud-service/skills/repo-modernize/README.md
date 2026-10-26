# AEM as a Cloud Service — Repository Modernizer (beta)

Restructures a legacy AEM (6.x / AMS / on-prem) Maven project into the AEM as a Cloud Service package layout (`ui.apps` + `ui.apps.structure` + `ui.config` + `ui.content` + `all`), separating immutable code from mutable content, as a reviewable change on a git branch.

See [`SKILL.md`](./SKILL.md) for when to use it and the workflow (plan → review → apply → verify), and [`references/`](./references) for the transformation rules and follow-ups.

**Requirements:** git, Python 3.9+ with `lxml` (`pip install -r requirements.txt`), and Maven with JDK 11+ (to generate the AEM project archetype, and for the optional build check).

**Archetype:** none is shipped. Each plan generates the module templates from the latest AEM Project Archetype with Maven (or the archetype version, your own archetype, or a project you already generated from one, via `--archetype`) and checks they fit before anything changes. See `scripts/archetype_templates.py`.

**Tests:** `plugins/aem/cloud-service/test/repo-modernize/run-tests.sh` (against an in-repo copy of the public `aem-guides-wknd-legacy` sample and templates of archetype 58; with Maven on the PATH it also checks those templates are exactly what the archetype generates).
