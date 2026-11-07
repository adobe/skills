# Updating the page-reduce bundle

The bundle at `cli/src/bundles/page-reduce.js` is build output. Its source lives in the
site-transfer-blueprint-detector project (internal Adobe AEM Foundation repository), on
branch `fix/reduce-live-measure`. The current bundle comes from commit `167050c4`, built
with esbuild 0.25.9.

Never edit `page-reduce.js` by hand. The next rebuild overwrites it. Fix the source,
then rebuild:

```bash
cd <detector-repo>
npm ci
npm test             # browser unit tests, including reduceForSkill on a detached clone
npm run build        # builds dist/detect.js
npm run build:skill  # builds dist/reduce-for-skill.js
cat dist/detect.js dist/reduce-for-skill.js > <skills-repo>/plugins/web/cli/src/bundles/page-reduce.js
```

Then, in `plugins/web/cli`:

```bash
npm run build                                    # dist/web.mjs inlines the bundle
node --test test/page-reduce-fixtures.test.mjs   # web page reduce on a real render
npm run check:dist                               # fails when dist/ and the bundle differ
```

Commit `dist/web.mjs` and `dist/lib.mjs` together with the bundle. Update the commit
above to the one you built from.
