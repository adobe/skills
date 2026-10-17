import {
  readdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { build } from 'esbuild';

const BUNDLES_DIR = new URL('./src/bundles/', import.meta.url);
const OUT = new URL('./dist/web.mjs', import.meta.url);

function inlineBundles() {
  const files = readdirSync(BUNDLES_DIR)
    .filter((f) => f !== 'index.mjs')
    .sort();
  const table = Object.fromEntries(
    files.map((f) => [f, readFileSync(new URL(f, BUNDLES_DIR), 'utf-8')]),
  );
  return `const T = ${JSON.stringify(table)};
export function loadBundle(name) {
  if (!(name in T)) throw new Error(\`unknown bundle: \${name}\`);
  return T[name];
}
`;
}

const inlinePlugin = {
  name: 'inline-bundles',
  setup(b) {
    b.onResolve({ filter: /^#src\/bundles\/index\.mjs$/ }, () => ({
      path: 'inline-bundles',
      namespace: 'inline',
    }));
    b.onLoad({ filter: /.*/, namespace: 'inline' }, () => ({
      contents: inlineBundles(),
      loader: 'js',
    }));
  },
};

const result = await build({
  entryPoints: ['bin/web.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/web.mjs',
  external: ['cld3-asm'],
  legalComments: 'none',
  write: false,
  plugins: [inlinePlugin],
  absWorkingDir: new URL('./', import.meta.url).pathname,
});
const text = result.outputFiles[0].text;

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf-8') !== text) {
    console.error('dist/web.mjs is stale — run: npm run build');
    process.exit(1);
  }
} else {
  mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
  writeFileSync(OUT, text);
  chmodSync(OUT, 0o755);
}
