# [2.0.0](https://github.com/adobe/skills/compare/site-scan-v1.1.0...site-scan-v2.0.0) (2026-11-24)


### Features

* **web:** group site scan language variants ([#811](https://github.com/adobe/skills/issues/811)) ([8bf4b35](https://github.com/adobe/skills/commit/8bf4b3543f4f0882f901648ed0266cc612b10e79))


### BREAKING CHANGES

* **web:** `web site scan` JSON output changes from
`urls: [{ url, lang }]` to `urls: [{ url, variants: [{ lang: [...], url }] }]`.
`urls[].url` now names a group (its x-default, or its first sitemap URL), and
`lang` is an array on each variant. Read pages from `urls[].variants[]`, or use
`web --format text site scan` for the plain list of selected URLs.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>

# [1.1.0](https://github.com/adobe/skills/compare/site-scan-v1.0.0...site-scan-v1.1.0) (2026-11-23)


### Features

* **web:** send site scan through an HTTP(S) proxy ([#806](https://github.com/adobe/skills/issues/806)) ([1945805](https://github.com/adobe/skills/commit/1945805ec70241192e3f3c2f9b13c6244b19ca1e))
