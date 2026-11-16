/**
 * skills/deploy/scripts/eds-path.mjs — the delivered-path contract for EDS, now owned by the shared library
 * (skills/stardust/scripts/lib/paths.mjs, reached through the master skill's contracts.mjs). This file stays as a
 * re-export for one release so in-flight project copies and the deploy scripts that import it (localize-links,
 * davids-model-lint) keep working. Library, no CLI; pure, nothing runs on import besides finding the library.
 *   deliveredUrl(sourcePath) — the URL a source page is served at: segments sanitised, `.html` dropped, `/index` → `/a/`
 *   daPath(url)              — the DA document behind a delivered URL: `/a/` → `/a/index`, `/` → `/index`
 *   pathKey(path)            — the lookup key for matching links to pages (no query, `.html`, `/index` or trailing slash)
 */
import { existsSync } from 'node:fs';

// The shared rules live beside browser.mjs in the master skill's scripts dir: the plugin tree or the Setup step 7 copy.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) throw Object.assign(new Error('deploy/eds-path.mjs: contracts.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'), { code: 'FRONT_DOOR_MISSING' });
export const { deliveredUrl, daPath, pathKey } = await import(CONTRACTS.href);
