# [1.1.0](https://github.com/adobe/skills/compare/create-site-v1.0.0...create-site-v1.1.0) (2026-04-16)


### Bug Fixes

* add missing license field to SKILL.md frontmatter ([acb3333](https://github.com/adobe/skills/commit/acb3333cfb3b3316902dc67d975b821485f4622e))
* address security and compatibility issues in replication skills ([426a4c6](https://github.com/adobe/skills/commit/426a4c6ebd93db4bf58036fef002bf5dcca017e0))
* correct Maven dependencies - focus on 6.5 LTS, not specific versions ([7351e78](https://github.com/adobe/skills/commit/7351e786a07f5b83584ed73771b90b8dacb189cf))
* harden cam-mcp.md ([e06a916](https://github.com/adobe/skills/commit/e06a9165c933641fcbc766527b27db0b17035b9a))
* update README branch references from beta to main ([1a14cbb](https://github.com/adobe/skills/commit/1a14cbb497121551b8e77f82a8cc0b4d2b10cf66))
* use string format for allowed-tools in dispatcher SKILL.md frontmatter ([b66b3ef](https://github.com/adobe/skills/commit/b66b3efb255d910e020b0e8c0cb53ff6ade5353f))


### Features

* add AEM workflow creation and debugging skills ([#22](https://github.com/adobe/skills/issues/22)) ([62f8031](https://github.com/adobe/skills/commit/62f8031e9d127d874cc47adec6e63e737e2c7a23)), closes [#23](https://github.com/adobe/skills/issues/23)
* add HTL data-sly-test lint reference to best-practices ([#44](https://github.com/adobe/skills/issues/44)) ([aebce41](https://github.com/adobe/skills/commit/aebce416037b581ae141a312cb7e135094e5e278))
* adding Agents.md creation as skill ([#24](https://github.com/adobe/skills/issues/24)) ([35f26b2](https://github.com/adobe/skills/commit/35f26b20efd15bb7a69e8fa9f8d78978485958f6))
* adding agents.MD creation for 6.5 LTS too ([cf7e9c7](https://github.com/adobe/skills/commit/cf7e9c75f7b9656b54ae39b1d9aa73bc518f76f0))
* adding dispatcher skills ([660e9e3](https://github.com/adobe/skills/commit/660e9e32347d36aa66937685452d5249bf60f93e))
* adding hot reload information in script and some tailored prompts ([b5a58aa](https://github.com/adobe/skills/commit/b5a58aa50112cc4e1779e922933f653a956f6753))
* **aem-replication:** add comprehensive replication skills for AEM 6.5 LTS ([964be7f](https://github.com/adobe/skills/commit/964be7fc3d1b93a6a06e7e145a4dcd3487575057))
* **aem:** add aem-best-practices and aem-migration skills ([#38](https://github.com/adobe/skills/issues/38)) ([de08316](https://github.com/adobe/skills/commit/de08316013a0244003726063573e8c2714652ac1))
* correct readme for skill installation on cursor ([95f84c4](https://github.com/adobe/skills/commit/95f84c4775048296389634c96e85d660fed69895))
* deleting shared references and crating self contained skills ([34013fb](https://github.com/adobe/skills/commit/34013fbc4d9f637c67186a72fc02e734c8071713))
* **dispatcher-skills:** ship polished cloud and 6.5lts dispatcher skills ([e766cec](https://github.com/adobe/skills/commit/e766cec760eb1983451f4cfe659362e6dbea655f))
* structuring skills so that we can use one command ([#23](https://github.com/adobe/skills/issues/23)) ([35c34f5](https://github.com/adobe/skills/commit/35c34f5ad2368e7a72304904004d76e195f63021))

# 1.0.0 (2026-04-16)


### Bug Fixes

* add license field to SKILL.md frontmatter ([26373eb](https://github.com/adobe/skills/commit/26373eb70f9502b6abb05a2747a058ff9cd60b4b))
* address PR review comments ([bd84255](https://github.com/adobe/skills/commit/bd84255f6227e7d9f9d443adaa8be472dfaf5b88))
* **deps:** update dependency jsdom to v29 ([40b3460](https://github.com/adobe/skills/commit/40b34607e0bc0ed9450bbc01c6f2504ca6d73eb8))
* **deps:** update dependency sharp to ^0.34.0 ([024398c](https://github.com/adobe/skills/commit/024398c27a4a9705739c4fbe528a612820b0499b))
* escape prepareCmd template syntax for semantic-release ([478737f](https://github.com/adobe/skills/commit/478737ff6c8bbc8855eff4d1acd707856078bf0b))
* exclude release files from .skill archive, resilient version matching ([33598bb](https://github.com/adobe/skills/commit/33598bb9c61c1543571e6343d004c777c0960ddf))
* load custom plugins correctly with semantic-release-monorepo ([80f9f7b](https://github.com/adobe/skills/commit/80f9f7b5ac2501366c62915d98f0a61003d3f0db))
* make docs commits trigger patch releases ([53c8b4f](https://github.com/adobe/skills/commit/53c8b4fc9116b9a5e3ea1ca95eac70cc1a724dea))
* replace semantic-release-monorepo with custom tagFormat config ([381470d](https://github.com/adobe/skills/commit/381470dfa96afc48a74cfe3b12b04271b84e1906))
* update GitHub usernames in CODEOWNERS for consistency ([8862127](https://github.com/adobe/skills/commit/88621277c24bf196147b22f6cb70d2b34529d86c))
* use aem.live instead of EDS abbreviation in architecture docs ([999b1e6](https://github.com/adobe/skills/commit/999b1e655a3719426ff48ce918a6e0bfe9dd1a45))
* wait for async eval completion with polling ([8c4eebc](https://github.com/adobe/skills/commit/8c4eebc6114e18d254ca1f20198b05e12d959482))


### Features

* add AEM Edge Delivery Services skills ([4e559d6](https://github.com/adobe/skills/commit/4e559d6ce7b3da0c7ad57c94ad4f3d60376fe450)), closes [#1014](https://github.com/adobe/skills/issues/1014)
* add external content safety instructions to skills ([6051b95](https://github.com/adobe/skills/commit/6051b95e6b28930be4c18fe277a365feb7bf1e49))
* add per-skill semantic-release workflow ([fead020](https://github.com/adobe/skills/commit/fead0207b16b7d32edfaf58cea00e4b3f0157e41))
* add tile.json manifest for adobe/aem-edge-delivery-services skill ([09f3fef](https://github.com/adobe/skills/commit/09f3fefcadf62f028b60c7fbc0257f15a305ba07))
* add Universal Editor component model skill ([336d71f](https://github.com/adobe/skills/commit/336d71f6605b15c96024b878851bc10832007797))
* AEM Project Management plugin ([0aa6744](https://github.com/adobe/skills/commit/0aa6744351b041cf027fd840b60c55961a3ed900))
* **create-site:** add create-site onboarding skill for AEM EDS ([#68](https://github.com/adobe/skills/issues/68)) ([b8cc345](https://github.com/adobe/skills/commit/b8cc345e7ddf5a3f15f00e02b829fdfd62de9906))
