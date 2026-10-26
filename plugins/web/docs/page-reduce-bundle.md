# Updating the page-reduce bundle

The bundle at `cli/src/bundles/page-reduce.js` is built from the
site-transfer-blueprint-detector project (internal Adobe AEM Foundation repository).
To update:

```bash
cd <detector-repo>
npm run build        # builds dist/detect.js
npm run build:skill  # builds dist/reduce-for-skill.js
cat dist/detect.js dist/reduce-for-skill.js > <skills-repo>/plugins/web/cli/src/bundles/page-reduce.js
```

Then run `cd plugins/web/cli && npm run build` and commit `dist/web.mjs` together
with the bundle (`npm run check:dist` fails when they differ).
