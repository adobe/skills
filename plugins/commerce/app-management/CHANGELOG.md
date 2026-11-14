# @adobe/aio-commerce-plugin-app-management

## 1.6.0

### Minor Changes

- [#732](https://github.com/adobe/aio-commerce-sdk/pull/732) [`f124cf4`](https://github.com/adobe/aio-commerce-sdk/commit/f124cf49208d930ca0f151e948a7597317365697) Thanks [@asalloum5](https://github.com/asalloum5)! - Add Admin UI skill guidance for configuring invoice detail-page view and worker buttons and wiring their runtime actions and iframe pages.

- [#776](https://github.com/adobe/aio-commerce-sdk/pull/776) [`32988bb`](https://github.com/adobe/aio-commerce-sdk/commit/32988bbda397d9a34f788aee721f4dca9abc362a) Thanks [@aminakhyat](https://github.com/aminakhyat)! - Document credit memo view buttons in the `commerce-app-admin-ui` skill.

- [#802](https://github.com/adobe/aio-commerce-sdk/pull/802) [`a03c546`](https://github.com/adobe/aio-commerce-sdk/commit/a03c546f8b6a54c8c1aa1352d89b6a0efef00d9e) Thanks [@aminakhyat](https://github.com/aminakhyat)! - Document return (RMA) view buttons in the `commerce-app-admin-ui` skill.

- [#746](https://github.com/adobe/aio-commerce-sdk/pull/746) [`ca065be`](https://github.com/adobe/aio-commerce-sdk/commit/ca065bec387cf90ce21309420851bef408ca194e) Thanks [@asalloum5](https://github.com/asalloum5)! - Add Admin UI skill guidance for replacing the native order creation form with an app page, including configuration, page scaffolding, and shared-context hook usage.

- [#770](https://github.com/adobe/aio-commerce-sdk/pull/770) [`9b6e61c`](https://github.com/adobe/aio-commerce-sdk/commit/9b6e61ceed9c45ae415c37b401272f09d4c75759) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Use Node.js 26 by default in action examples and migrations.

### Patch Changes

- [#776](https://github.com/adobe/aio-commerce-sdk/pull/776) [`32988bb`](https://github.com/adobe/aio-commerce-sdk/commit/32988bbda397d9a34f788aee721f4dca9abc362a) Thanks [@aminakhyat](https://github.com/aminakhyat)! - Describe the request Commerce sends to order view button workers (`buttonId` and the `X-Request-ID` header) in the `commerce-app-admin-ui` skill.

- [#801](https://github.com/adobe/aio-commerce-sdk/pull/801) [`26287d7`](https://github.com/adobe/aio-commerce-sdk/commit/26287d7a0cc3dbd154e52acb94e2ad123c74ef4b) Thanks [@pablomoreno61](https://github.com/pablomoreno61)! - Document the `return.create` target in the Admin UI skill's native form replacement guidance.

## 1.5.0

### Minor Changes

- [#767](https://github.com/adobe/aio-commerce-sdk/pull/767) [`6296f6e`](https://github.com/adobe/aio-commerce-sdk/commit/6296f6e1e85b8770a7c59912a32eadf184680757) Thanks [@rojoangel](https://github.com/rojoangel)! - Use available database declarations in storage actions and custom installation steps, with targeted temporary import suppressions for installations without types and no forced dependency upgrade.

- [#692](https://github.com/adobe/aio-commerce-sdk/pull/692) [`264539a`](https://github.com/adobe/aio-commerce-sdk/commit/264539a13371b11b637eb01fd1c0aa185f4349cc) Thanks [@asalloum5](https://github.com/asalloum5)! - Document `invoice`, `creditMemo`, and `shipment` support for Admin UI grid column extensions.

- [#699](https://github.com/adobe/aio-commerce-sdk/pull/699) [`53f1f8b`](https://github.com/adobe/aio-commerce-sdk/commit/53f1f8be4428862015294f1edc2816972e501a9e) Thanks [@mariam21arauj](https://github.com/mariam21arauj)! - Document `newsletter` support for Admin UI grid column extensions.

- [#781](https://github.com/adobe/aio-commerce-sdk/pull/781) [`94c5732`](https://github.com/adobe/aio-commerce-sdk/commit/94c5732ae7638e8dbcf793992112f1ae776ea756) Thanks [@rojoangel](https://github.com/rojoangel)! - Add guidance for safe database projections.

### Patch Changes

- [#755](https://github.com/adobe/aio-commerce-sdk/pull/755) [`da7bb5c`](https://github.com/adobe/aio-commerce-sdk/commit/da7bb5cda2c79fb0d7d4f4c35cf84c43cdef8b0b) Thanks [@rojoangel](https://github.com/rojoangel)! - Fix the `commerce-app-business-config` skill to pass the `encryptionKey` option when reading or writing `password` fields, and to declare the encryption key input on every action that uses it.

- [#689](https://github.com/adobe/aio-commerce-sdk/pull/689) [`194db8d`](https://github.com/adobe/aio-commerce-sdk/commit/194db8d382edf49f7976ea9aeffad54acb8e3da1) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Updated commerce-app-storage guidance to use `include-ims-credentials` and mark manually wired OAuth Server-to-Server credentials as deprecated.

## 1.4.0

### Minor Changes

- [#671](https://github.com/adobe/aio-commerce-sdk/pull/671) [`866a879`](https://github.com/adobe/aio-commerce-sdk/commit/866a8792b2ec36091f30d94dbd347031265ec2ee) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Add `commerce-app-api-mesh` skill for scaffolding and updating an API Mesh configuration in front of a Commerce app, covering sources, type extension, resolvers, and deployment verification.

- [#653](https://github.com/adobe/aio-commerce-sdk/pull/653) [`c04983d`](https://github.com/adobe/aio-commerce-sdk/commit/c04983dfe04926094ab810c070598d5609004a61) Thanks [@oshmyheliuk](https://github.com/oshmyheliuk)! - Document declaring custom, standalone ACL resources (`adminUi.acl`) in the Admin UI skill, including a new reference covering the config shape, the User Roles tree placement, and checking them at runtime with `getCustomAclResourceId`.

- [#664](https://github.com/adobe/aio-commerce-sdk/pull/664) [`d6c0d74`](https://github.com/adobe/aio-commerce-sdk/commit/d6c0d7478222918ed8817d43f518a57bdbafb6d7) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Document using `getCommerceClient` from `@adobe/aio-commerce-lib-app` to call the Commerce REST API from an event handler in the eventing skill, and reference the Adobe Commerce events reference for determining event payload field paths.

- [#662](https://github.com/adobe/aio-commerce-sdk/pull/662) [`e1d88cb`](https://github.com/adobe/aio-commerce-sdk/commit/e1d88cb7efafd39fa280043af56bceada975848c) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Document how a menu or view page in the `commerce-app-admin-ui` skill can call its own action directly via the auto-generated `web-src/src/config.json` and `getActionUrl` pattern.

### Patch Changes

- [#642](https://github.com/adobe/aio-commerce-sdk/pull/642) [`79dcda0`](https://github.com/adobe/aio-commerce-sdk/commit/79dcda035d322d47d2e19566ae4a20fd6124682b) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Document the optional `metadata.upgradeMode` field (`auto`/`manual`) in the app config template.

- [#680](https://github.com/adobe/aio-commerce-sdk/pull/680) [`1612b38`](https://github.com/adobe/aio-commerce-sdk/commit/1612b38516e734155c50f545b8f41120f55d5351) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Document required Admin UI web source support files and their environment-aware Babel behavior.

- [#649](https://github.com/adobe/aio-commerce-sdk/pull/649) [`2580eaf`](https://github.com/adobe/aio-commerce-sdk/commit/2580eafd23c123a469206d9d2ada0f87679b347c) Thanks [@oshmyheliuk](https://github.com/oshmyheliuk)! - Corrected how the eventing and storage skills document reading an action's incoming payload, so generated handlers read the right fields:

  - Event handlers now read the event data from `params.data.value` (previously the skills pointed at `params.data`, which also holds delivery metadata and would leave every field undefined).
  - Webhook handlers are now documented separately from events, since their payloads differ: the Commerce operation data arrives directly on `params` (for example `params.order`), and responses use the helpers from `@adobe/aio-commerce-lib-webhooks/responses`.

- [#642](https://github.com/adobe/aio-commerce-sdk/pull/642) [`79dcda0`](https://github.com/adobe/aio-commerce-sdk/commit/79dcda035d322d47d2e19566ae4a20fd6124682b) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Document that TypeScript setup installs Node.js type definitions.

- [#663](https://github.com/adobe/aio-commerce-sdk/pull/663) [`d446ecd`](https://github.com/adobe/aio-commerce-sdk/commit/d446ecd2223e64953e30813d4f7c3eb49cce8f8b) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Document in the `commerce-app-storage` skill that `findOne` throws a `DbError` on a no-match miss instead of resolving to `null`, and add guidance for distinguishing that case from a genuine failure.

- [#681](https://github.com/adobe/aio-commerce-sdk/pull/681) [`88b2eaa`](https://github.com/adobe/aio-commerce-sdk/commit/88b2eaab89734c4a4ea3ac38642a62d1e993d6d0) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Document re-running `npx @adobe/aio-commerce-lib-app init` after adding the first install-requiring domain in `commerce-app-webhooks`, `commerce-app-eventing`, and `commerce-app-storage`, or the `installation` action never gets generated.

- [#627](https://github.com/adobe/aio-commerce-sdk/pull/627) [`e5cbdf1`](https://github.com/adobe/aio-commerce-sdk/commit/e5cbdf14f5bda56430eeeaf495889b8a1a514fe3) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Document the allowed values for Commerce webhook types and HTTP methods.

- [#682](https://github.com/adobe/aio-commerce-sdk/pull/682) [`24e02dd`](https://github.com/adobe/aio-commerce-sdk/commit/24e02ddb7de2d281754ff0edd552b4d2b5c73c0b) Thanks [@jcuerdo](https://github.com/jcuerdo)! - Document validating/coercing numeric event fields in `commerce-app-eventing`, since Commerce can serialize them as strings.

## 1.3.2

### Patch Changes

- [#635](https://github.com/adobe/aio-commerce-sdk/pull/635) [`71bf666`](https://github.com/adobe/aio-commerce-sdk/commit/71bf66656ef1fc6dd272a0821e8b00aab5dc197e) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Update the Admin UI skill guidance so it reflects that StrictMode runs only in development builds and is stripped from production.

## 1.3.1

### Patch Changes

- [#602](https://github.com/adobe/aio-commerce-sdk/pull/602) [`1dc6031`](https://github.com/adobe/aio-commerce-sdk/commit/1dc6031bcf4aadbbdeb65d01910b34ad7567e9b8) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Publish this plugin's changelog history alongside its skills.

- [#606](https://github.com/adobe/aio-commerce-sdk/pull/606) [`a18a250`](https://github.com/adobe/aio-commerce-sdk/commit/a18a2506b9d6fafb0b96ca8b7960208e51546dc3) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Document TypeScript project scaffolding and Admin UI type-checking workflows.

- [#606](https://github.com/adobe/aio-commerce-sdk/pull/606) [`a18a250`](https://github.com/adobe/aio-commerce-sdk/commit/a18a2506b9d6fafb0b96ca8b7960208e51546dc3) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - Update the `commerce-app-init`, `commerce-app-admin-ui`, `commerce-app-eventing`, `commerce-app-webhooks`, and `commerce-app-storage` skills to document that actions and custom installation step scripts can be authored directly in TypeScript once the project is configured for it, without a separate compile step.

## 1.3.0

### Minor Changes

- [#593](https://github.com/adobe/aio-commerce-sdk/pull/593) [`554bc21`](https://github.com/adobe/aio-commerce-sdk/commit/554bc21fdaf745447ce0685bb7735da974f06904) Thanks [@iivvaannxx](https://github.com/iivvaannxx)! - commerce-app-admin-ui now detects existing `web-src` frontends still on classic React Spectrum (v3) and suggests upgrading to Spectrum 2.

## 1.2.0

### Minor Changes

- [#540](https://github.com/adobe/aio-commerce-sdk/pull/540) [`6382582`](https://github.com/adobe/aio-commerce-sdk/commit/638258247f806f39c83f1f7156d4f65f94023009) Thanks [@obarcelonap](https://github.com/obarcelonap)! - Promote Commerce plugins through the stable skills release process.
