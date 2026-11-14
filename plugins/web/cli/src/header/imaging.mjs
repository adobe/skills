import { CliError } from '#src/errors.mjs';

/**
 * The header checks' image libraries: `sharp` (crops, stitches, resizes), `pngjs` and `pixelmatch`
 * (pixel counts). Optional dependencies, loaded when a `header` command starts (loadImaging), so
 * the other commands and the bundled `dist/web.mjs` run without them. The checks import the
 * stand-ins below, which forward to the loaded modules.
 */
const loaded = {};

export const IMAGING_HINT =
  'install the CLI as a package so its optional dependencies come with it: ' +
  'npx -y pnpm add --dir <dir> "github:adobe/skills#<ref>&path:/plugins/web/cli" ' +
  '(or npm install in plugins/web/cli)';

/**
 * Imports the libraries once; a missing one is UNSUPPORTED (exit 2) before any browser starts.
 * `load` imports a module by name (tests pass their own).
 * @param {(name: string) => Promise<object>} [load]
 */
export async function loadImaging(load) {
  if (loaded.sharp && !load) return;
  // literal specifiers: the bundle keeps them as runtime imports of the installed packages
  const importers = {
    sharp: () => (load ? load('sharp') : import('sharp')),
    pngjs: () => (load ? load('pngjs') : import('pngjs')),
    pixelmatch: () => (load ? load('pixelmatch') : import('pixelmatch')),
  };
  const mods = {};
  for (const [name, importer] of Object.entries(importers)) {
    try {
      mods[name] = await importer();
    } catch (e) {
      throw new CliError('UNSUPPORTED', `the header commands need ${name}: ${e?.message ?? e}`, {
        hint: IMAGING_HINT,
      });
    }
  }
  loaded.sharp = mods.sharp.default ?? mods.sharp;
  loaded.PNG = mods.pngjs.PNG ?? mods.pngjs.default?.PNG;
  loaded.pixelmatch = mods.pixelmatch.default ?? mods.pixelmatch;
}

const need = (name) => {
  if (!loaded[name]) throw new Error(`${name} is not loaded: call loadImaging() first`);
  return loaded[name];
};

/** sharp(...): see https://sharp.pixelplumbing.com */
export const sharp = (...args) => need('sharp')(...args);

/** pixelmatch(a, b, out, width, height, options) */
export const pixelmatch = (...args) => need('pixelmatch')(...args);

/** pngjs' PNG: `new PNG({ width, height })`, `PNG.sync.read(buffer)`, `PNG.bitblt(...)`. */
export const PNG = new Proxy(function PNG() {}, {
  construct: (_target, args) => new (need('PNG'))(...args),
  get: (_target, key) => need('PNG')[key],
});
