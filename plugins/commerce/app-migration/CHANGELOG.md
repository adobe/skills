# @adobe/aio-commerce-plugin-app-migration

## 1.4.0

### Minor Changes

- [#770](https://github.com/adobe/aio-commerce-sdk/pull/770) [`9b6e61c`](https://github.com/adobe/aio-commerce-sdk/commit/9b6e61ceed9c45ae415c37b401272f09d4c75759) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Use Node.js 26 by default in action examples and migrations.

- [#809](https://github.com/adobe/aio-commerce-sdk/pull/809) [`8513cc2`](https://github.com/adobe/aio-commerce-sdk/commit/8513cc255552e330434cb10f3eee8fcfd34a8009) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Suggest moving environment variables that runtime actions still read to Business Configurations during migration, and rewrite the action code to read them from the app configuration.

### Patch Changes

- [#809](https://github.com/adobe/aio-commerce-sdk/pull/809) [`8513cc2`](https://github.com/adobe/aio-commerce-sdk/commit/8513cc255552e330434cb10f3eee8fcfd34a8009) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Stop treating the Commerce base URL environment variables as required after migration, and explain that the base URL now comes from associating the app in App Management.

- [#732](https://github.com/adobe/aio-commerce-sdk/pull/732) [`f124cf4`](https://github.com/adobe/aio-commerce-sdk/commit/f124cf49208d930ca0f151e948a7597317365697) Thanks [@asalloum5](https://github.com/asalloum5)! - Clarify in the Admin UI migration guidance that invoice view buttons are new V2 registrations and must not be inferred from legacy order buttons.

- [#776](https://github.com/adobe/aio-commerce-sdk/pull/776) [`32988bb`](https://github.com/adobe/aio-commerce-sdk/commit/32988bbda397d9a34f788aee721f4dca9abc362a) Thanks [@aminakhyat](https://github.com/aminakhyat)! - Note that credit memo view buttons are new v2-only registrations in the Admin UI SDK migration agent.

- [#802](https://github.com/adobe/aio-commerce-sdk/pull/802) [`a03c546`](https://github.com/adobe/aio-commerce-sdk/commit/a03c546f8b6a54c8c1aa1352d89b6a0efef00d9e) Thanks [@aminakhyat](https://github.com/aminakhyat)! - Note that return (RMA) view buttons are new v2-only registrations in the Admin UI SDK migration agent.

## 1.3.3

### Patch Changes

- [#744](https://github.com/adobe/aio-commerce-sdk/pull/744) [`8f28544`](https://github.com/adobe/aio-commerce-sdk/commit/8f2854444cba44b3a41e6572b2f388487f2872c5) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Install, upgrade and uninstall now plan the operation and validate the plan before anything changes. Uninstalling removes what the app installed and what it can prove it owns, even without an installation record, and runs the uninstall of every custom installation step that ran and is still configured. Every lifecycle operation uses the Commerce instance stored at association.

- [#712](https://github.com/adobe/aio-commerce-sdk/pull/712) [`d78221e`](https://github.com/adobe/aio-commerce-sdk/commit/d78221e01894d2209b7864aca6a5fbfab93c7192) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Guide migrated projects to use the `include-ims-credentials` annotation and `resolveImsAuthParams` instead of manually wired IMS credential inputs.

## 1.3.2

### Patch Changes

- [#627](https://github.com/adobe/aio-commerce-sdk/pull/627) [`e5cbdf1`](https://github.com/adobe/aio-commerce-sdk/commit/e5cbdf14f5bda56430eeeaf495889b8a1a514fe3) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Document the allowed values for Commerce webhook types and HTTP methods.

- [#642](https://github.com/adobe/aio-commerce-sdk/pull/642) [`79dcda0`](https://github.com/adobe/aio-commerce-sdk/commit/79dcda035d322d47d2e19566ae4a20fd6124682b) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Document automatic and manual desired-state upgrades in migrated app configuration and deployment guidance.

## 1.3.1

### Patch Changes

- [#602](https://github.com/adobe/aio-commerce-sdk/pull/602) [`1dc6031`](https://github.com/adobe/aio-commerce-sdk/commit/1dc6031bcf4aadbbdeb65d01910b34ad7567e9b8) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Publish this plugin's changelog history alongside its skills.

- [#606](https://github.com/adobe/aio-commerce-sdk/pull/606) [`a18a250`](https://github.com/adobe/aio-commerce-sdk/commit/a18a2506b9d6fafb0b96ca8b7960208e51546dc3) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Remove obsolete pnpm esbuild build approval steps from Commerce app migrations.

## 1.3.0

### Minor Changes

- [#593](https://github.com/adobe/aio-commerce-sdk/pull/593) [`554bc21`](https://github.com/adobe/aio-commerce-sdk/commit/554bc21fdaf745447ce0685bb7735da974f06904) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - `commerce-app-migrate` gains a `spectrum-s2-upgrade` reference so the migration executor can detect classic React Spectrum (v3) in a project's Admin UI `web-src` and offer to run the S1-to-S2 migration for the user.

- [#594](https://github.com/adobe/aio-commerce-sdk/pull/594) [`a947231`](https://github.com/adobe/aio-commerce-sdk/commit/a9472317626df39adcef9258a8bcaa2885b64826) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Improved the `commerce-app-migrate` skill:

  - `init` runs with the scoped package name (`npx --yes @adobe/aio-commerce-lib-app@latest init`) so first runs work without the library installed.
  - pnpm projects get esbuild's build script approved (`onlyBuiltDependencies`) before init, with recovery guidance for `ERR_PNPM_IGNORED_BUILDS`.
  - Descriptions over 255 characters are rewritten into a coherent shorter summary instead of truncated mid-sentence.
  - The original `package.json` description is restored if `init` writes back the shortened config value.
  - The migration summary opens with a one-line TL;DR.

## 1.2.0

### Minor Changes

- [#540](https://github.com/adobe/aio-commerce-sdk/pull/540) [`6382582`](https://github.com/adobe/aio-commerce-sdk/commit/638258247f806f39c83f1f7156d4f65f94023009) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Promote Commerce plugins through the stable skills release process.
