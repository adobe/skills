# Upgrading `web-src` from React Spectrum (v3) to Spectrum 2 (S2)

Applies to any Admin UI `web-src` iframe frontend (view mass actions, order view buttons, menu) that still uses classic React Spectrum (v3) instead of `@react-spectrum/s2`.

**This is guidance only.** Detect the situation, tell the user what to do next, and offer to help run the migration — do not run the codemod, install packages, or rewrite components yourself unless the user says to go ahead.

## Detecting classic React Spectrum

Check the app's root `package.json` for:

- `@adobe/react-spectrum`, or
- `@react-spectrum/<component>` packages **without** an `s2` in the name (e.g. `@react-spectrum/button`, `@react-spectrum/provider`)

If ONLY `@react-spectrum/s2` dependencies are present, no action is needed, but the user might also be using a mix of the two, in which case you should offer to migrate the remaining ones.

To be sure, check also the `import` statements in the source code; some users might have the dependencies but not actually use them.

## Why recommend upgrading

The two are functionally compatible — they can even be mounted together in the same tree (S2's `Provider` must be the inner-most provider if nested). Classic React Spectrum (v3) is still maintained, but S2 is the version Adobe recommends moving to: smaller bundles via atomic/macro-based CSS, ongoing feature work, and the version this scaffold generates all new `web-src` code against. Recommend the upgrade so the extension's UI stays on one consistent system instead of drifting to two.

## Next steps to give the user

Point the user at the official migration guide rather than relying on a list of breaking changes here — it drifts out of date as S2 evolves, while the source stays current: **https://react-spectrum.adobe.com/migrating.md**

That guide documents both ways to migrate:

1. **AI-assisted migration** — install the Agent Skill so an AI tool can drive the migration:

   ```sh
   npx skills add https://react-spectrum.adobe.com --skill migrate-react-spectrum-v3-to-s2 --skill react-spectrum-s2
   ```

2. **Automated codemod** — works standalone, without an AI tool:

   ```sh
   npx @react-spectrum/codemods s1-to-s2
   ```

Either way, the guide is the source of truth for scope, options (e.g. `--components`, `--dry`, `--agent`), and the component-by-component breaking changes — fetch it (or have the installed skill/codemod surface it) rather than guessing from memory. Offer to run either route for the user, but it's their choice whether to do it now, later, or themselves. After migrating (if done), test the extension's iframe pages for visual and behavioral regressions.
