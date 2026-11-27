# Changelog

# [2.1.0](https://github.com/adobe/skills/compare/plugin/web/v2.0.0...plugin/web/v2.1.0) (2026-11-27)


### Features

* **web:** mark path-only site scan language tags ([#832](https://github.com/adobe/skills/issues/832)) ([309709f](https://github.com/adobe/skills/commit/309709f6ae75ab861c83ab491e82b2d953aa5a5c))

# [2.0.0](https://github.com/adobe/skills/compare/plugin/web/v1.1.0...plugin/web/v2.0.0) (2026-11-24)


### Features

* **web:** group site scan language variants ([#811](https://github.com/adobe/skills/issues/811)) ([8bf4b35](https://github.com/adobe/skills/commit/8bf4b3543f4f0882f901648ed0266cc612b10e79))


### BREAKING CHANGES

* **web:** `web site scan` JSON output changes from
`urls: [{ url, lang }]` to `urls: [{ url, variants: [{ lang: [...], url }] }]`.
`urls[].url` now names a group (its x-default, or its first sitemap URL), and
`lang` is an array on each variant. Read pages from `urls[].variants[]`, or use
`web --format text site scan` for the plain list of selected URLs.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>

# [1.1.0](https://github.com/adobe/skills/compare/plugin/web/v1.0.3...plugin/web/v1.1.0) (2026-11-23)


### Features

* **web:** send site scan through an HTTP(S) proxy ([#806](https://github.com/adobe/skills/issues/806)) ([1945805](https://github.com/adobe/skills/commit/1945805ec70241192e3f3c2f9b13c6244b19ca1e))

## [1.0.3](https://github.com/adobe/skills/compare/plugin/web/v1.0.2...plugin/web/v1.0.3) (2026-11-20)


### Bug Fixes

* **web:** tighten page-reduce Phase 2 rules (NAV count, empty sections, classes, size) ([#764](https://github.com/adobe/skills/issues/764)) ([b4fb575](https://github.com/adobe/skills/commit/b4fb5756528031b2bf971e979c92b06799f72010)), closes [#762](https://github.com/adobe/skills/issues/762) [#762](https://github.com/adobe/skills/issues/762)

## [1.0.2](https://github.com/adobe/skills/compare/plugin/web/v1.0.1...plugin/web/v1.0.2) (2026-11-20)


### Bug Fixes

* **web:** page reduce drops sections without content and falls back to main or body ([#763](https://github.com/adobe/skills/issues/763)) ([bd82e7f](https://github.com/adobe/skills/commit/bd82e7fb99ec2c4e38c3f3f506b0077e088a6e98)), closes [#761](https://github.com/adobe/skills/issues/761) [#764](https://github.com/adobe/skills/issues/764) [#761](https://github.com/adobe/skills/issues/761)

## [1.0.1](https://github.com/adobe/skills/compare/plugin/web/v1.0.0...plugin/web/v1.0.1) (2026-11-20)


### Bug Fixes

* **web:** header check menus waits for a panel that closes with a transition ([#770](https://github.com/adobe/skills/issues/770)) ([20766bc](https://github.com/adobe/skills/commit/20766bce7f223417ec007f7017844de4b0027ad7))
