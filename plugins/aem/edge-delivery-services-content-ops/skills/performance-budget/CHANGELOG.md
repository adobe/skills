# 1.0.0 (2026-11-15)


### Features

* **aem-eds-content-ops:** add performance-budget skill ([#659](https://github.com/adobe/skills/issues/659)) ([a352edc](https://github.com/adobe/skills/commit/a352edc0bb226d64851888d2fc26ec1f589ff62d))

# Changelog

## 1.0.0 (2026-05-14)

- Initial release
- Measures the bytes a page requests before its LCP element is ready, from a Lighthouse run
- Names requests that are in the wrong loading phase (eager, lazy, delayed)
- GitHub Actions workflow that fails a pull request over the 100 KB budget
