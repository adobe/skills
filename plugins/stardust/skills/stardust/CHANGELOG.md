# [1.7.0](https://github.com/adobe/skills/compare/stardust-v1.6.2...stardust-v1.7.0) (2026-11-27)


### Features

* **stardust:** a delivery unit closes only when every page it shipped has a gate row ([#788](https://github.com/adobe/skills/issues/788)) ([d53aadc](https://github.com/adobe/skills/commit/d53aadc8ffe463a642d8312320b6693a16604f6c)), closes [#792](https://github.com/adobe/skills/issues/792) [#793](https://github.com/adobe/skills/issues/793) [#790](https://github.com/adobe/skills/issues/790) [#792](https://github.com/adobe/skills/issues/792) [#793](https://github.com/adobe/skills/issues/793) [#793](https://github.com/adobe/skills/issues/793) [#793](https://github.com/adobe/skills/issues/793)

## [1.6.2](https://github.com/adobe/skills/compare/stardust-v1.6.1...stardust-v1.6.2) (2026-11-27)


### Bug Fixes

* **stardust:** replica refuses an alternate rendering as the gate reference unless it is recorded ([#820](https://github.com/adobe/skills/issues/820)) ([7bd746c](https://github.com/adobe/skills/commit/7bd746cd2ddf59a6213c3ad81a5e497f968a00b4)), closes [#408](https://github.com/adobe/skills/issues/408)

## [1.6.1](https://github.com/adobe/skills/compare/stardust-v1.6.0...stardust-v1.6.1) (2026-11-22)


### Bug Fixes

* **stardust:** end real Chrome with SIGTERM instead of its 10 s teardown hang ([#794](https://github.com/adobe/skills/issues/794)) ([fc14908](https://github.com/adobe/skills/commit/fc149088457c8ce7ed88e7a7c9bba8e1e0c44d05))

# [1.6.0](https://github.com/adobe/skills/compare/stardust-v1.5.0...stardust-v1.6.0) (2026-11-21)


### Features

* **stardust:** the header contract gets a round cap, a class for each open error, and a first comparison at the prototype stage ([#783](https://github.com/adobe/skills/issues/783)) ([586c76b](https://github.com/adobe/skills/commit/586c76b6395b6a04ef8efe143d08170463627e5d))

# [1.5.0](https://github.com/adobe/skills/compare/stardust-v1.4.0...stardust-v1.5.0) (2026-11-20)


### Features

* **stardust:** rollout is not done until the DA block library is published (stale/wrong-site aware); one shared DA token resolver ([#739](https://github.com/adobe/skills/issues/739)) ([8b2f8c8](https://github.com/adobe/skills/commit/8b2f8c8d6247952c488fe33d72f312a6fe78048e))

# [1.4.0](https://github.com/adobe/skills/compare/stardust-v1.3.0...stardust-v1.4.0) (2026-11-19)


### Features

* **stardust:** replica measures the source before authoring and checks header and footer by landmark ([#701](https://github.com/adobe/skills/issues/701)) ([0df3597](https://github.com/adobe/skills/commit/0df3597c097a425a8192249fc239c9369f3e48f8))

# [1.3.0](https://github.com/adobe/skills/compare/stardust-v1.2.0...stardust-v1.3.0) (2026-11-18)


### Features

* **stardust:** the replica gate compares against a frozen reference and counts after aligning ([#700](https://github.com/adobe/skills/issues/700)) ([a8f69e3](https://github.com/adobe/skills/commit/a8f69e3086a20b949f7c8352d3bd6bd7505c4968))

# [1.2.0](https://github.com/adobe/skills/compare/stardust-v1.1.2...stardust-v1.2.0) (2026-11-18)


### Features

* **stardust:** the replica gate measures the page, width and stage it was asked for, and stops at three rounds ([#699](https://github.com/adobe/skills/issues/699)) ([84eb7c1](https://github.com/adobe/skills/commit/84eb7c1d1e1f791853ac1ec93ef2fc9664c08abc))

## [1.1.2](https://github.com/adobe/skills/compare/stardust-v1.1.1...stardust-v1.1.2) (2026-11-15)


### Bug Fixes

* **stardust:** ledger.mjs names the readers for a guessed verb such as summary ([#681](https://github.com/adobe/skills/issues/681)) ([facbc0b](https://github.com/adobe/skills/commit/facbc0b30c63229a252e9d7878896ccec7b647b8))
* **stardust:** measure the page before a screenshot; a layout overflow is a WARN, not a crash ([#687](https://github.com/adobe/skills/issues/687)) ([75e1d21](https://github.com/adobe/skills/commit/75e1d21458839d10312cec1370b54c1e48f99428))

## [1.1.1](https://github.com/adobe/skills/compare/stardust-v1.1.0...stardust-v1.1.1) (2026-11-15)

# [1.1.0](https://github.com/adobe/skills/compare/stardust-v1.0.0...stardust-v1.1.0) (2026-11-15)


### Features

* **stardust:** delivered CSS is mobile-first (rule 162) ([#603](https://github.com/adobe/skills/issues/603)) ([54478bd](https://github.com/adobe/skills/commit/54478bd999cbbd86fdd578e9d2e73c56251484ea))
* **stardust:** one copy of the shared script rules behind contracts.mjs (shared-contracts refactor, PR 1) ([#607](https://github.com/adobe/skills/issues/607)) ([16af842](https://github.com/adobe/skills/commit/16af842689ce75e9c7f24a0dab37470c4a1c5a87))
