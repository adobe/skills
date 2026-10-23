# 1.0.0 (2026-10-21)


### Bug Fixes

* **page-prep:** correct playwright-cli screenshot syntax in Step 9b ([7202e67](https://github.com/adobe/skills/commit/7202e6723bdf1c3a1fefa93653ed86270d0fdb0f))
* **page-prep:** drop open-only dismiss recipes, JSON-encode hide CSS ([b8056df](https://github.com/adobe/skills/commit/b8056dfc810e891a87cb998cfe15bb766c130b62))
* **page-prep:** exclude off-screen elements from DOM residual check ([d4aa441](https://github.com/adobe/skills/commit/d4aa441ffe6278cd7636b17f81c417ff8b04f0b4))
* **page-prep:** read Consent-O-Matic methods so CMP matches get recipes ([8b05d3a](https://github.com/adobe/skills/commit/8b05d3ae5b04b6658851ef72ed2d9cac8a042797))
* **page-prep:** use skill-relative paths, simplify workflow ([2e8f2f8](https://github.com/adobe/skills/commit/2e8f2f8550c32373a8ccb28265e58cf7639545dc))
* **release:** point skill release configs at the repo root ([0d0f53a](https://github.com/adobe/skills/commit/0d0f53af4ac156978990d165bfbe66eabf3febef))
* **web-cli:** detect full-viewport low-z overlays and skip hidden ones ([2f98f56](https://github.com/adobe/skills/commit/2f98f56436ac0d018e3fb607d471b022f5afab93))
* **web-cli:** validate recipes, record with probe entries, keep extension chrome APIs ([1654d50](https://github.com/adobe/skills/commit/1654d50c272795f604d843d1ec2413f5b3fa82e0))
* **web:** fix eval assertions and stripEnvelope bug ([9440ec0](https://github.com/adobe/skills/commit/9440ec088107f3945c964790bd1aea794652f083))
* **web:** fix four HIGH review findings ([7b0ec67](https://github.com/adobe/skills/commit/7b0ec67c3a3b6d24921be5bd7a70e8243f8baf3d))
* **web:** fix MEDIUM review findings ([c6f0a5a](https://github.com/adobe/skills/commit/c6f0a5a9b86e7874f2cb15ee704e4761ccf22a72))


### Features

* **web-cli:** add page overlays, remove page-prep scripts ([1fbcc3e](https://github.com/adobe/skills/commit/1fbcc3e349c1f4b52e834f9d9c6b54e40fc91a83))
* **web-cli:** add recipe file with probe and overlays entries, --save-recipe ([709759e](https://github.com/adobe/skills/commit/709759ef3fb94d3e261c21540eb7f4ba442eed9d))
* **web:** add web plugin with browser automation and page analysis skills ([b21396a](https://github.com/adobe/skills/commit/b21396af11d141ad9e13d786438e5716a4cf4e67))


### BREAKING CHANGES

* **web-cli:** the recipe format changes from `{ url, cliConfig, persistent }`
to `{ probe: [...], overlays: [...] }`. Recipes in the old format are rejected
with a USAGE error; produce a new one with `web probe <url> --save-recipe`.
