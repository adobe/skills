import {
  readdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { build } from 'esbuild';

const DIST = new URL('./dist/', import.meta.url);
const ENTRIES = [
  ['bin/web.mjs', 'web.mjs'],
  ['src/lib.mjs', 'lib.mjs'],
];
// `src/<dir>/files.mjs` reads sibling assets at runtime; the bundle replaces it with a table.
const ASSET_DIRS = ['bundles', 'docs'];

function inlineFiles(dir) {
  const base = new URL(`./src/${dir}/`, import.meta.url);
  const names = readdirSync(base)
    .filter((f) => !f.endsWith('.mjs'))
    .sort();
  const table = Object.fromEntries(names.map((f) => [f, readFileSync(new URL(f, base), 'utf-8')]));
  return `export const FILES = ${JSON.stringify(table)};\n`;
}

const inlinePlugin = {
  name: 'inline-files',
  setup(b) {
    const filter = new RegExp(`^#src/(${ASSET_DIRS.join('|')})/files\\.mjs$`);
    b.onResolve({ filter }, (args) => ({ path: args.path.split('/')[1], namespace: 'inline' }));
    b.onLoad({ filter: /.*/, namespace: 'inline' }, (args) => ({
      contents: inlineFiles(args.path),
      loader: 'js',
    }));
  },
};

async function bundle(entry, name) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: `dist/${name}`,
    external: ['cld3-asm'],
    legalComments: 'none',
    write: false,
    plugins: [inlinePlugin],
    absWorkingDir: new URL('./', import.meta.url).pathname,
  });
  return result.outputFiles[0].text;
}

const check = process.argv.includes('--check');
mkdirSync(DIST, { recursive: true });
for (const [entry, name] of ENTRIES) {
  const out = new URL(name, DIST);
  const text = await bundle(entry, name);
  if (!check) {
    writeFileSync(out, text);
    if (name === 'web.mjs') chmodSync(out, 0o755);
  } else if (!existsSync(out) || readFileSync(out, 'utf-8') !== text) {
    console.error(`dist/${name} is stale — run: npm run build`);
    process.exit(1);
  }
}
