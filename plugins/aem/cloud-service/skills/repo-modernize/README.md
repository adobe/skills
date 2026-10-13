# AEM as a Cloud Service — Repository Modernizer

Restructures a legacy AEM (6.x / AMS / on-prem) Maven project into the AEM as a Cloud Service module layout (`ui.apps` + `ui.apps.structure` + `ui.config` + `ui.content` + `all`), splitting immutable code from mutable content/config as a reviewable git diff on a dedicated branch.

See [`SKILL.md`](./SKILL.md) for when to use it and the full workflow, and `references/config-schema.md` for the `.modernize/config.json` contract shared by all scripts.
