# 1.0.0 (2026-10-21)


### Bug Fixes

* **browser-probe:** detect Akamai via akamai-grn header ([e9d6dbe](https://github.com/adobe/skills/commit/e9d6dbeafef86bd149105563e2073f7e290d753f))
* **browser-probe:** give each probe run its own playwright-cli sessions ([b3aa00e](https://github.com/adobe/skills/commit/b3aa00ec25f523a9bbd330907cbcf93f8bf40b69))
* **browser-probe:** read headers via response-headers, not removed network cmd ([dbd07e1](https://github.com/adobe/skills/commit/dbd07e1372ab2bce8f33e7bd50dac49fbdfda091))
* **browser-probe:** read redirect chain headers, surface header errors ([4bcf545](https://github.com/adobe/skills/commit/4bcf545128502703ee75a1e4365d834c4aee6011))
* **browser-probe:** resolve symlinks in isMain check, fallback for missing import.meta.url ([3687651](https://github.com/adobe/skills/commit/3687651d4a466299fe10e8b404828714ab7247da))
* **browser-probe:** use skill-relative paths, complete recipe template ([6543ca2](https://github.com/adobe/skills/commit/6543ca28a3ea16e624789b46820f07af23276c0a))
* **release:** point skill release configs at the repo root ([0d0f53a](https://github.com/adobe/skills/commit/0d0f53af4ac156978990d165bfbe66eabf3febef))
* **web:** fix eval assertions and stripEnvelope bug ([9440ec0](https://github.com/adobe/skills/commit/9440ec088107f3945c964790bd1aea794652f083))
* **web:** fix MEDIUM review findings ([c6f0a5a](https://github.com/adobe/skills/commit/c6f0a5a9b86e7874f2cb15ee704e4761ccf22a72))


### Features

* **web-cli:** add playwright-cli driver and blocked-page detection ([4e09a85](https://github.com/adobe/skills/commit/4e09a850a319a2791bb627be2e3526f02b265ad0))
* **web-cli:** add probe command, remove browser-probe scripts ([e3b9a9c](https://github.com/adobe/skills/commit/e3b9a9c36e34e470428dc639dd2f8b549f1a2c06))
* **web-cli:** add recipe file with probe and overlays entries, --save-recipe ([709759e](https://github.com/adobe/skills/commit/709759ef3fb94d3e261c21540eb7f4ba442eed9d))
* **web-cli:** record the probed url in the recipe ([8610fca](https://github.com/adobe/skills/commit/8610fca1dbf556849d8ad438628e87368c9941e0))
* **web-cli:** write artifacts under <session>-<command>/ with stable file names ([9517861](https://github.com/adobe/skills/commit/95178618a7939cc09a2c5e1e03a76a91a41bdd16))
* **web:** add web plugin with browser automation and page analysis skills ([b21396a](https://github.com/adobe/skills/commit/b21396af11d141ad9e13d786438e5716a4cf4e67))


### BREAKING CHANGES

* **web-cli:** the recipe format changes from `{ url, cliConfig, persistent }`
to `{ probe: [...], overlays: [...] }`. Recipes in the old format are rejected
with a USAGE error; produce a new one with `web probe <url> --save-recipe`.
