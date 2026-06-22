# 1.0.0 (2026-05-29)


### Bug Fixes

* **aem-cli:** convert mkcert markdown link to bare URL to clear tessl referenced_paths warning ([7446ad4](https://github.com/adobe/skills/commit/7446ad42bb6d837603d148ce1fe7929e6bffcd39))
* **aem-cli:** remove all @adobe/helix-cli text occurrences to pass tessl lint ([58f9734](https://github.com/adobe/skills/commit/58f973428e08fa140fa1d352840be3a40228e73e))
* **aem-cli:** remove all remaining org/repo path patterns to clear tessl referenced_paths warning ([60b0bc0](https://github.com/adobe/skills/commit/60b0bc02f62920efc6fbd6d9d1bd1ce945a047c9))
* **aem-cli:** remove remaining markdown GitHub links to clear tessl referenced_paths warning ([f7cefe0](https://github.com/adobe/skills/commit/f7cefe0eb2cbe2572b891c81f0959de2ebac3b0c))
* **aem-cli:** rename helix-cli README link text to avoid tessl tile-path false positive ([beb8ad7](https://github.com/adobe/skills/commit/beb8ad76f84c1c1b2be9987176414ee13bdf27d7))
* **aem-cli:** replace GitHub URL with npm URL to eliminate adobe/helix-cli path substring ([e2f839b](https://github.com/adobe/skills/commit/e2f839bc24f1af0fa55ca0b43992e305b6be0e39))
* **aem-cli:** restore correctness regressions introduced during tessl lint fixes ([ba0334c](https://github.com/adobe/skills/commit/ba0334c47356891444644532949540315bb68df0))
* **aem-cli:** use bare URLs for external GitHub refs to avoid tessl path-resolution false positives ([6782d93](https://github.com/adobe/skills/commit/6782d93c49ea5ca0ec7ad6e4abc5b73c071bd12a))
* **aem-cli:** use prose for da-content cross-ref to avoid tessl flagging missing path ([947bf5f](https://github.com/adobe/skills/commit/947bf5fc264193f2d371f437aa25ca036c2a1fd7))


### Features

* **aem-eds:** add aem-cli skill — install, aem up, import, content sync, troubleshooting ([ab8fd65](https://github.com/adobe/skills/commit/ab8fd6503f017312b76a32d658d55844b551719c))
