/**
 * skills/stardust/scripts/contracts.mjs — the rules more than one skill's scripts apply, behind one import: EDS paths,
 * names and the widget contract, kinds, the dynamics taxonomy (lib/*.mjs, lib/README.md has the map) and the
 * sibling-script resolver (lib/resolve.mjs). Library, no CLI; pure, nothing runs on import.
 *
 * It ships and resolves the way browser.mjs does: Setup step 7 (skills/stardust/SKILL.md) copies this scripts dir, lib/
 * included, to stardust/scripts/stardust/, and a consumer looks in both layouts:
 *
 *   const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
 *     .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
 *   const { pathKey, widgetStem } = await import(CONTRACTS.href);
 *
 * A skill with its own lib.mjs (dynamics, qa, rollout, spec) resolves it there once and re-exports what its scripts use.
 */
export * from './lib/paths.mjs';
export * from './lib/names.mjs';
export * from './lib/kinds.mjs';
export * from './lib/taxonomy.mjs';
export * from './lib/resolve.mjs';
