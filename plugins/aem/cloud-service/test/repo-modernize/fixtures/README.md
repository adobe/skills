# repo-modernize test fixtures

`wknd-legacy/` is the public sample [adobe/aem-guides-wknd-legacy](https://github.com/adobe/aem-guides-wknd-legacy)
at commit `f0e270c` (Apache-2.0), a legacy (pre-Cloud Service) AEM project. Two changes from the original:

- Binary renditions (images, thumbnails, favicon) are replaced with short text placeholders; the tests only use their paths.
- A small synthetic overlay adds the cases the tests need:
  - `bundle2/` — a second Felix SCR bundle
  - an `uber-jar` dependency
  - `all/` — a hand-made container package with a third-party embed
  - `docx4j11-dependencies/`, `repository-structure/`, `scripts/` — directories that are not reactor modules
  - a repoinit config and a `config.prod.author` run-mode folder
  - `apps/testconfig/` — a second app tree with existing `.cfg.json` files
  - filter include patterns
  - an ACL on `/content/dam/wknd`

Run the suite with `../run-tests.sh`.
