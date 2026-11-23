## [1.8.2](https://github.com/adobe/skills/compare/replica-v1.8.1...replica-v1.8.2) (2026-11-23)


### Bug Fixes

* **stardust:** the all-pages gate runs a page's probes beside its captures, inside one browser budget per job ([#792](https://github.com/adobe/skills/issues/792)) ([fede929](https://github.com/adobe/skills/commit/fede92993e633b33b86213f767385274b4d4ef6f))

## [1.8.1](https://github.com/adobe/skills/compare/replica-v1.8.0...replica-v1.8.1) (2026-11-23)


### Bug Fixes

* **stardust:** the roster gate judges offsets with the height tolerance, so pages inside the pixel bar stop failing on small shifts ([#790](https://github.com/adobe/skills/issues/790)) ([50de2af](https://github.com/adobe/skills/commit/50de2afe042861b295af64cc4c68e86255caed54))

# [1.8.0](https://github.com/adobe/skills/compare/replica-v1.7.0...replica-v1.8.0) (2026-11-21)


### Features

* **stardust:** the replica gates hold autoplay timers by default ([#785](https://github.com/adobe/skills/issues/785)) ([9fa3322](https://github.com/adobe/skills/commit/9fa332238e7849efbe3f0cb2e5f05cce8e5e2799))

# [1.7.0](https://github.com/adobe/skills/compare/replica-v1.6.1...replica-v1.7.0) (2026-11-21)


### Features

* **stardust:** the header contract gets a round cap, a class for each open error, and a first comparison at the prototype stage ([#783](https://github.com/adobe/skills/issues/783)) ([586c76b](https://github.com/adobe/skills/commit/586c76b6395b6a04ef8efe143d08170463627e5d))

## [1.6.1](https://github.com/adobe/skills/compare/replica-v1.6.0...replica-v1.6.1) (2026-11-21)


### Bug Fixes

* **stardust:** the replica gate says when a page had no unit family and the repeated-unit check did not run ([#781](https://github.com/adobe/skills/issues/781)) ([5456c48](https://github.com/adobe/skills/commit/5456c48a8a903f3a91767538cc102f5862003895))

# [1.6.0](https://github.com/adobe/skills/compare/replica-v1.5.2...replica-v1.6.0) (2026-11-21)


### Bug Fixes

* **stardust:** the unit check treats an element clipped on both sides as parity, counts a pushed row once, and names a selector error ([#766](https://github.com/adobe/skills/issues/766)) ([267c9dc](https://github.com/adobe/skills/commit/267c9dc360f1d0b11e30bbbed15782c11b8c4c99))


### Features

* **stardust:** a capture can hold autoplay timers, and the reference says when a page changes on its own ([#780](https://github.com/adobe/skills/issues/780)) ([d15a206](https://github.com/adobe/skills/commit/d15a206ba45ef7303fcd398375d794e85d619b91))

## [1.5.2](https://github.com/adobe/skills/compare/replica-v1.5.1...replica-v1.5.2) (2026-11-20)


### Bug Fixes

* **stardust:** source-spec sees what holds its place while scrolling and how images are cut ([#757](https://github.com/adobe/skills/issues/757)) ([0fbd108](https://github.com/adobe/skills/commit/0fbd108db57259d2c8da0cbb81763f26739c92a8))

## [1.5.1](https://github.com/adobe/skills/compare/replica-v1.5.0...replica-v1.5.1) (2026-11-20)

# [1.5.0](https://github.com/adobe/skills/compare/replica-v1.4.1...replica-v1.5.0) (2026-11-20)


### Features

* **stardust:** rollout is not done until the DA block library is published (stale/wrong-site aware); one shared DA token resolver ([#739](https://github.com/adobe/skills/issues/739)) ([8b2f8c8](https://github.com/adobe/skills/commit/8b2f8c8d6247952c488fe33d72f312a6fe78048e))

## [1.4.1](https://github.com/adobe/skills/compare/replica-v1.4.0...replica-v1.4.1) (2026-11-20)

# [1.4.0](https://github.com/adobe/skills/compare/replica-v1.3.0...replica-v1.4.0) (2026-11-19)


### Features

* **stardust:** replica measures the source before authoring and checks header and footer by landmark ([#701](https://github.com/adobe/skills/issues/701)) ([0df3597](https://github.com/adobe/skills/commit/0df3597c097a425a8192249fc239c9369f3e48f8))

# [1.3.0](https://github.com/adobe/skills/compare/replica-v1.2.0...replica-v1.3.0) (2026-11-18)


### Features

* **stardust:** the replica gate compares against a frozen reference and counts after aligning ([#700](https://github.com/adobe/skills/issues/700)) ([a8f69e3](https://github.com/adobe/skills/commit/a8f69e3086a20b949f7c8352d3bd6bd7505c4968))

# [1.2.0](https://github.com/adobe/skills/compare/replica-v1.1.2...replica-v1.2.0) (2026-11-18)


### Features

* **stardust:** the replica gate measures the page, width and stage it was asked for, and stops at three rounds ([#699](https://github.com/adobe/skills/issues/699)) ([84eb7c1](https://github.com/adobe/skills/commit/84eb7c1d1e1f791853ac1ec93ef2fc9664c08abc))

## [1.1.2](https://github.com/adobe/skills/compare/replica-v1.1.1...replica-v1.1.2) (2026-11-16)


### Bug Fixes

* **stardust:** a gate override waives only the criteria it names, and the unit cache knows its width ([#704](https://github.com/adobe/skills/issues/704)) ([aac23ef](https://github.com/adobe/skills/commit/aac23ef68e050294d8fa035c7b3c4a444af2cb19))
* **stardust:** measure the page before a screenshot; a layout overflow is a WARN, not a crash ([#687](https://github.com/adobe/skills/issues/687)) ([75e1d21](https://github.com/adobe/skills/commit/75e1d21458839d10312cec1370b54c1e48f99428))
* **stardust:** mobile-first checks take a project's own breakpoint steps ([#682](https://github.com/adobe/skills/issues/682)) ([b761eee](https://github.com/adobe/skills/commit/b761eee55d938ae54610296359ec32f4a0cd356d))

## [1.1.1](https://github.com/adobe/skills/compare/replica-v1.1.0...replica-v1.1.1) (2026-11-15)


### Bug Fixes

* **stardust:** breakpoint-lint fails a missing --dirs file and negated desktop-first queries ([#677](https://github.com/adobe/skills/issues/677)) ([8dda267](https://github.com/adobe/skills/commit/8dda26746899a082dad4cfa3acf1736335064a8c))

# [1.1.0](https://github.com/adobe/skills/compare/replica-v1.0.0...replica-v1.1.0) (2026-11-15)


### Features

* **stardust:** delivered CSS is mobile-first (rule 162) ([#603](https://github.com/adobe/skills/issues/603)) ([54478bd](https://github.com/adobe/skills/commit/54478bd999cbbd86fdd578e9d2e73c56251484ea))
* **stardust:** one copy of the shared script rules behind contracts.mjs (shared-contracts refactor, PR 1) ([#607](https://github.com/adobe/skills/issues/607)) ([16af842](https://github.com/adobe/skills/commit/16af842689ce75e9c7f24a0dab37470c4a1c5a87))
