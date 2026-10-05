# Updating the page-reduce bundle

The bundle at `skills/page-reduce/scripts/page-reduce-bundle.js` is built from the
site-transfer-blueprint-detector project (internal Adobe AEM Foundation repository).
To update:

```bash
cd <detector-repo>
npm run build        # builds dist/detect.js
npm run build:skill  # builds dist/reduce-for-skill.js
cat dist/detect.js dist/reduce-for-skill.js > <skills-repo>/plugins/web/skills/page-reduce/scripts/page-reduce-bundle.js
```
