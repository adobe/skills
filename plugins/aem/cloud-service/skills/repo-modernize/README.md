# AEM as a Cloud Service — Repository Modernizer (beta)

Restructures a legacy AEM (6.x / AMS / on-prem) Maven project into the AEM as a Cloud Service package layout (`ui.apps` + `ui.apps.structure` + `ui.config` + `ui.content` + `all`), separating immutable code from mutable content, as a reviewable change on a git branch.

See [`SKILL.md`](./SKILL.md) for when to use it and the workflow (plan → review → apply → verify), and [`references/`](./references) for the transformation rules and follow-ups.

**Requirements:** git, Python 3.9+ with `lxml` (`pip install -r requirements.txt`); Maven and JDK 11+ for the optional build check.

**Tests:** `plugins/aem/cloud-service/test/repo-modernize/run-tests.sh` (353 tests, against an in-repo copy of the public `aem-guides-wknd-legacy` sample).
