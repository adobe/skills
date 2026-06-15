# [2.0.0](https://github.com/adobe/skills/compare/auth-v1.0.0...auth-v2.0.0) (2026-06-15)


* feat(auth)!: migrate to Adobe IMS OAuth tokens ([f92426f](https://github.com/adobe/skills/commit/f92426f7ece1a1bd6433f5da05abe928f952741b))


### Bug Fixes

* **auth:** simplify login to only require org name, support URL parsing ([2fa82be](https://github.com/adobe/skills/commit/2fa82be9120ec75d128d6caaa3ecfdcee0af79f9))
* **project-management:** ensure AUTH_TOKEN is set before API calls in all skills ([0044c27](https://github.com/adobe/skills/commit/0044c27e89fec4f3120b4901f8a7a5b54fccc530))
* **project-management:** keep tokens in ~/.aem/, project-config for handover context only ([dd3e821](https://github.com/adobe/skills/commit/dd3e821dd6ce32609fe520b2322144083b4c0b56))


### BREAKING CHANGES

* storage schema changed (authToken → imsToken +
imsTokenExpiry) and header format changed (x-auth-token →
Authorization: Bearer). Consumers must re-authenticate on first use.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# 1.0.0 (2026-04-16)
