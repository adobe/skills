import { existsSync } from 'node:fs';
import { fail, findFile, graded, ok, readJson, readText } from '../../lib/outputs.mjs';

const cached = (r, name, hostPrefix) => {
  const path = findFile(r, name);
  return Boolean(path && path.includes(`/cache/${hostPrefix}_`) && existsSync(`${path}{meta}.json`));
};
const replayed = (r) => {
  const status = readJson(r, 'status-offline.json');
  return status?.offline === true && status.misses === 0 && status.hits >= 1;
};

const CHECKS = {
  'replay-fixture': (r) => ({
    'page and sidecar in the cache': cached(r, 'layout.html', 'localhost'),
    'offline run served from the cache, no miss': replayed(r),
    'offline.html is the page': /Layout fixture/.test(readText(r, 'offline.html') ?? ''),
  }),
  'also-fixture': (r) => ({
    'page cached': cached(r, 'cache-also.html', 'localhost'),
    'image cached under its own origin': cached(r, 'also-logo.svg', '127.0.0.1'),
    'offline run served from the cache, no miss': replayed(r),
    'the offline replay answered the image itself': /<circle/.test(readText(r, 'offline-asset.svg') ?? ''),
    'offline.html points the image through the proxy': /also-logo\.svg\?_origin=/.test(readText(r, 'offline.html') ?? ''),
  }),
  'miss-fixture': (r) => ({
    'page cached and replayed': cached(r, 'layout.html', 'localhost') && /Layout fixture/.test(readText(r, 'offline.html') ?? ''),
    'miss answered 504': (readText(r, 'miss.txt') ?? '').trim() === '504',
  }),
};

export const cacheMatches = graded((_output, { vars, providerResponse }) => {
  const check = CHECKS[vars.check];
  if (!check) return fail(`unknown check ${vars.check}`);
  const failed = Object.entries(check(providerResponse)).filter(([, passed]) => !passed).map(([name]) => name);
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
