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
