import { fail, graded, ok, readJson, readText } from '../../lib/outputs.mjs';

// The node map may map IDs to {selector, ...} objects (the skill's format) or straight to selector strings.
const selectorOf = (node) => (typeof node === 'string' ? node : node?.selector);
const problems = (checks) => Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

const lineCount = (tree) => tree.split('\n').filter(Boolean).length;
const treeIds = (tree) => tree.split('\n').map((l) => l.trim().split(' ')[0]).filter(Boolean);
const idsInMap = (tree, map) => treeIds(tree).every((id) => id in map);

const CHECKS = {
  'tree-live-long': (tree, map) => ({
    'root line': /^r @0,0 \d+x\d+/m.test(tree),
    'at least 60 lines': lineCount(tree) >= 60,
    'multi-column grid marker': /\[\d+x\d+\]/.test(tree),
    'every tree id in node map': idsInMap(tree, map),
  }),
  'tree-live-image': (tree, map) => ({
    'root line': /^r @0,0 \d+x\d+/m.test(tree),
    'at least 25 lines': lineCount(tree) >= 25,
    'multi-column grid marker': /\[\d+x\d+\]/.test(tree),
    'image background marked': /\[bg:image\]/.test(tree),
    'every tree id in node map': idsInMap(tree, map),
  }),
  'layout-default': (tree, map) => ({
    'root line': /^r @0,0 \d+x\d+/m.test(tree),
    'three-column grid': /\[3x1\]/.test(tree),
    'gradient background': /\[bg:gradient\]/.test(tree),
    'image background': /\[bg:image\]/.test(tree),
    'fixed banner promoted with dialog role': /\[dialog\]/.test(tree),
    'banner selector in node map': Object.values(map).some((n) => selectorOf(n) === '#cookie-banner'),
    'cards selector in node map': Object.values(map).some((n) => /section\.cards/.test(selectorOf(n))),
  }),
  'layout-narrow': (tree, map) => ({
    'root line': /^r @0,0 \d+x\d+/m.test(tree),
    'individual cards captured': /^\s+rc\d+c\d+ .*"?(First|Second|Third) card/m.test(tree) || Object.values(map).some((n) => /\.card/.test(selectorOf(n))),
    'three-column grid': /\[3x1\]/.test(tree),
  }),
  'tree-valid': (tree, map) => ({
    'root line': /^r @0,0 \d+x\d+/m.test(tree),
    'several nodes': tree.split('\n').length >= 5,
    'node map has body root': selectorOf(map.r) === 'body',
    'node map covers tree ids': Object.keys(map).length >= 3,
  }),
};

export const treeMatches = graded((_output, { vars, providerResponse }) => {
  const tree = readText(providerResponse, 'tree.txt');
  const map = readJson(providerResponse, 'nodemap.json');
  if (!tree) return fail('tree.txt missing');
  if (!map) return fail('nodemap.json missing or invalid');
  const failed = problems(CHECKS[vars.check](tree, map));
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
