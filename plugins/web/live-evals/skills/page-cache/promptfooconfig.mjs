import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-cache',
  suiteDir,
  prompt: `{{task}}
Save everything the work produces in ./out/ (relative to your working directory),
stop every server you start, then summarize what you did in a few sentences.`,
  contract: `Output format, all under ./out/: the cache directory ./out/cache; online.html (the page as served while the cache was being filled); offline.html (the page as served from the cache with no fetching); status-offline.json (the cache proxy's /__status JSON from the offline run, read before stopping it); offline-asset.svg (only when asked: the image exactly as the offline replay answers a request for it, fetched through the proxy); miss.txt (only when asked: the HTTP status code of the request that was not cached, a bare number).`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'cacheMatches' }],
});
