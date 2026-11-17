// skills/reskin/scripts/test/fixtures/figma-gate/setup.mjs — a project dir for the figma-gate tests.
// makeProject(tmp) writes, through M1's cache helpers, a capture of the synthetic kit (file key KITKEY,
// version 100: nodes.json, manifest.json, empty images.json, latest.json, current.json) under
// <tmp>/stardust/.work/reskin/figma/, copies figma-kit/curation-rules.json to <tmp>/stardust/reskin/,
// and places the fixtures of this directory that exist (each task adds its own):
//   page.html (named by the page option), figma-frame.html → <tmp>/
//   mapping.md, donor-tokens.json → <tmp>/stardust/reskin/
//   content-model.json → <tmp>/stardust/reskin/content-model/home/
//   checks.json → <tmp>/stardust/reskin/figma-checks/home.json
// It returns { root: tmp, dir: <tmp>/stardust, page: <tmp>/<page>, slug: 'home' }.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheFor, writeCurrent } from '../../../figma/cache.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'figma-kit');
export const KEY = 'KITKEY';
export const VERSION = '100';

const place = (from, to) => {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};

export function makeProject(tmp, { page = 'page.html' } = {}) {
  const dir = join(tmp, 'stardust');
  const cache = cacheFor(dir, KEY);
  const v = cache.version(VERSION);
  const nodes = JSON.parse(readFileSync(join(KIT, 'nodes.json'), 'utf8'));
  v.write('nodes.json', nodes);
  v.write('images.json', {});
  v.write('manifest.json', { version: VERSION, fileKey: KEY, capturedAt: '2026-01-01T00:00:00Z', frames: Object.keys(nodes.nodes) });
  cache.setLatest(VERSION);
  writeCurrent(dir, KEY, VERSION);

  mkdirSync(join(dir, 'canon-source'), { recursive: true });
  writeFileSync(join(dir, 'canon-source', '_crawl-log.json'), `${JSON.stringify({ discovery: { fileKey: KEY, version: VERSION, selected: Object.keys(nodes.nodes) } }, null, 2)}\n`);
  place(join(KIT, 'curation-rules.json'), join(dir, 'reskin', 'curation-rules.json'));

  place(join(HERE, 'page.html'), join(tmp, page));
  place(join(HERE, 'figma-frame.html'), join(tmp, 'figma-frame.html'));
  place(join(HERE, 'mapping.md'), join(dir, 'reskin', 'mapping.md'));
  place(join(HERE, 'donor-tokens.json'), join(dir, 'reskin', 'donor-tokens.json'));
  place(join(HERE, 'content-model.json'), join(dir, 'reskin', 'content-model', 'home', 'content-model.json'));
  place(join(HERE, 'checks.json'), join(dir, 'reskin', 'figma-checks', 'home.json'));
  return { root: tmp, dir, page: join(tmp, page), slug: 'home' };
}
