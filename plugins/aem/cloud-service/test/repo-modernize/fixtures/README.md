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

`archetype-templates/` holds the module templates generated from AEM Project Archetype 58 (the
skill's `TESTED_ARCHETYPE`), so the tests run offline and give the same result every time. The skill
itself ships no templates: it prepares them at plan time. With Maven on the PATH, a test checks this
folder is exactly what `scripts/archetype_templates.py` produces for that version. To move the tests to a
newer archetype, regenerate it (`python3 scripts/archetype_templates.py <version> --sdk-version <version>
--out <this folder>`), update `TESTED_ARCHETYPE` and `TESTED_SDK` in `scripts/archetype.py`, and run the suite.

Run the suite with `../run-tests.sh`.
