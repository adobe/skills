# [1.2.0](https://github.com/adobe/skills/compare/web-cli-v1.1.0...web-cli-v1.2.0) (2026-10-20)


### Bug Fixes

* **web-cli:** collision-free cache keys, timeout validation, quieter scan errors ([d0ed643](https://github.com/adobe/skills/commit/d0ed643f325a937c095a1c61e64a62424974a10e))
* **web-cli:** confine cache paths, store full responses, route CDN assets, fix http crawl ([02598a5](https://github.com/adobe/skills/commit/02598a5335b11bcc149853ef40ad2ff7d88aaa6b))


### Features

* **web-cli:** add site scan and cache serve, with site-scan and page-cache skills ([b79b1b4](https://github.com/adobe/skills/commit/b79b1b455cb79e77a140feeb8a3afcb928ed78e4))

# [1.1.0](https://github.com/adobe/skills/compare/web-cli-v1.0.2...web-cli-v1.1.0) (2026-10-20)


### Bug Fixes

* **web-cli:** page bands keeps stacked siblings and splits text rows ([92e09ca](https://github.com/adobe/skills/commit/92e09ca831a149d4e04c28d22c0b34aebdef4537))


### Features

* **web-cli:** page bands slices a page into bands ([03a0758](https://github.com/adobe/skills/commit/03a0758ddb3711660364215ea1f17629a9da43d2))

## [1.0.2](https://github.com/adobe/skills/compare/web-cli-v1.0.1...web-cli-v1.0.2) (2026-10-20)


### Bug Fixes

* **web-cli:** page tree clips along each containing-block chain ([a511708](https://github.com/adobe/skills/commit/a51170857c6ddc8e5dcc5ed50ef1ec8a397cf0ba))
* **web-cli:** page tree collapse keeps escaping and wrapped content ([284a252](https://github.com/adobe/skills/commit/284a252643e5c956168f374234ddd428bf6223e6))
* **web-cli:** page tree drops elements wholly above or left of the page ([4e00f12](https://github.com/adobe/skills/commit/4e00f12b209a3db284a5be7ca2c841b40e4bfcc7))
* **web-cli:** page tree drops only off-page leaves, not their wrappers ([867d86c](https://github.com/adobe/skills/commit/867d86c1f956e2d6445fe131274dec24d68b14c2))
* **web-cli:** page tree hides elements a clip-path clips to nothing ([f76ae30](https://github.com/adobe/skills/commit/f76ae303f6c4f1b208783add63932e5e75176f91))
* **web-cli:** page tree keeps a row that overhangs its container ([8dee5c3](https://github.com/adobe/skills/commit/8dee5c354c9cc3fe66a8eada8163f25b2b588857))
* **web-cli:** page tree keeps fixed elements as their own root node ([28418a3](https://github.com/adobe/skills/commit/28418a384d9588b2699d8aae0e20308524d354e4))
* **web-cli:** page tree reads inset() corner radii as radii, not offsets ([b9800f5](https://github.com/adobe/skills/commit/b9800f591b7a3457e42e87f4d4db92529067dabd))
* **web-cli:** page tree records every class of a node, not the first ([9695189](https://github.com/adobe/skills/commit/969518923fc22e9f6e27cb2ee47c9b32225f0d9c))
* **web-cli:** page tree treats content clipped by overflow as contained ([dea0e27](https://github.com/adobe/skills/commit/dea0e2739e4fd2bc876d1a43be362459444368f1))
* **web-cli:** page tree walks subtrees it moves during promotion ([d1c213e](https://github.com/adobe/skills/commit/d1c213eca227d09e4e28c7018ed64f4ef926dce4))
* **web-cli:** page tree walks through display: contents elements ([eaf0193](https://github.com/adobe/skills/commit/eaf019351e9bd3b5d848d9d933ef7adae753b156))

## [1.0.1](https://github.com/adobe/skills/compare/web-cli-v1.0.0...web-cli-v1.0.1) (2026-10-19)


### Bug Fixes

* **web-cli:** clamp overlay coverage to viewport and harden residual ([7b9956c](https://github.com/adobe/skills/commit/7b9956c7aa32ef7f148d8d401e29665c8a8671de))
* **web-cli:** detect full-viewport low-z overlays and skip hidden ones ([2f98f56](https://github.com/adobe/skills/commit/2f98f56436ac0d018e3fb607d471b022f5afab93))

# 1.0.0 (2026-10-19)


### Bug Fixes

* **web-cli:** address Task 1 review findings ([a62e167](https://github.com/adobe/skills/commit/a62e167c7c1f4279091051433f124e7e589b8938))
* **web-cli:** address Task 2 review findings ([d54b04d](https://github.com/adobe/skills/commit/d54b04d50a5b1a5b78ffa5b7d9e02fe3e82b7be1))
* **web-cli:** address Task 3 review findings ([0feb0b4](https://github.com/adobe/skills/commit/0feb0b4f2206b62c69b47fd83b5fa145f167b4d0))
* **web-cli:** built-in overlay selectors for Shopify's privacy banner ([1b65386](https://github.com/adobe/skills/commit/1b65386f508096bb13486c68e02d0bebb8db326f))
* **web-cli:** close ephemeral sessions when acquisition fails, share lifecycle with probe ([f02ce55](https://github.com/adobe/skills/commit/f02ce553e031c24453098df1111d109b1f83983a))
* **web-cli:** collect writes a resolved sprite once, under its element's name ([59ce89c](https://github.com/adobe/skills/commit/59ce89cd96a29677fd1dc6752633e0e4ace40184))
* **web-cli:** default overlays --mode to thorough per spec ([7c414c1](https://github.com/adobe/skills/commit/7c414c19dcc72bc289bbdcb969858bd1a7332e19))
* **web-cli:** detect eval expressions by compiling, drop double --json ([02b429d](https://github.com/adobe/skills/commit/02b429d06b1478f375f8e50716de27b61c6fd4a8))
* **web-cli:** discover extension id from its path, not a service worker ([198c7bb](https://github.com/adobe/skills/commit/198c7bb0848c94efd5b7b274d484b51da02458a8))
* **web-cli:** gate page commands on hard block signals only ([82b9c35](https://github.com/adobe/skills/commit/82b9c358bdd30de4bb24a939b7a1717f7f1cbfad))
* **web-cli:** harden smoke test helper and cleanup ([f93c423](https://github.com/adobe/skills/commit/f93c423ecbcdc772710364015602146359d35e30))
* **web-cli:** hide overlays by selector when the database has no rule, verify the result ([85f18c8](https://github.com/adobe/skills/commit/85f18c8ee7ec2e99b4931fc6ce965b0b68ab7413))
* **web-cli:** keep the original error when closing a session fails ([e21ea52](https://github.com/adobe/skills/commit/e21ea5222890e0933f11795a0c73ee2934c62e1f))
* **web-cli:** pass absolute init-script paths to playwright-cli ([c617407](https://github.com/adobe/skills/commit/c617407b073dd4f10c4850f8b99ab3b6c90b8ae6))
* **web-cli:** point the package bin at the bundled dist ([2a48161](https://github.com/adobe/skills/commit/2a4816127b61c2f1a3121a602f9f55dbffcb6652))
* **web-cli:** polish from final review ([9249020](https://github.com/adobe/skills/commit/9249020a5c30818ded6096f124416480ec65480b))
* **web-cli:** port side panel gesture path and harden ext session handling ([f1772d4](https://github.com/adobe/skills/commit/f1772d41f7e41cd8b854648cd4bc36887e579164))
* **web-cli:** print absolute artifact paths ([0566263](https://github.com/adobe/skills/commit/05662638ebff96e6eff54403ed6a1ac65071d889))
* **web-cli:** print the error document for usage errors ([6445a8e](https://github.com/adobe/skills/commit/6445a8e74761901f05e2203f195510bf3afaffa7))
* **web-cli:** probe caps each playwright-cli call at 30 s ([b7b01ff](https://github.com/adobe/skills/commit/b7b01ffbe3afd520cd1435e3c06b0a3450050be7))
* **web-cli:** probe ignores an env-derived session, rejects only --session ([8c042e6](https://github.com/adobe/skills/commit/8c042e6e6d65b1e970fe0440172fa399b2c56a08))
* **web-cli:** probe rejects --session/--recipe and honours --headed ([a7ea58c](https://github.com/adobe/skills/commit/a7ea58c6df4a53fbfaf0c75bf7101f6d3907058c))
* **web-cli:** reject non-integer values for numeric flags ([458d3c7](https://github.com/adobe/skills/commit/458d3c764e0fa2b45d6dd47a8031715a23aa5ab5))
* **web-cli:** report consent dismiss failures and hide what was not dismissed ([b9e1011](https://github.com/adobe/skills/commit/b9e101192cec7a500f682748bd1f1043fc66351e))
* **web-cli:** restrict --format to json|text ([bb8e6a8](https://github.com/adobe/skills/commit/bb8e6a863282f9fec058a59cf5d1a68af1012960))
* **web-cli:** route every commander error through the usage document ([56faf69](https://github.com/adobe/skills/commit/56faf69f807988d1dca312a9b002791e24862c0c))
* **web-cli:** run residual overlay check via page.evaluate ([dce8dba](https://github.com/adobe/skills/commit/dce8dba4ba01206b3cbd2c2adf330fd696c2fed5))
* **web-cli:** wrap long line in errors.mjs ([009182e](https://github.com/adobe/skills/commit/009182ed0b86acfb80d6b4fe394adb7f957ecee3))


### Features

* **web-cli:** add ext group, remove cdp-ext-pilot and cdp-connect scripts ([1e94c45](https://github.com/adobe/skills/commit/1e94c45fe9014a70ce344f1d91512def479b84ac))
* **web-cli:** add mask command, remove domain-mask script ([5568304](https://github.com/adobe/skills/commit/5568304e8bb36358beaee6d3cafc82187666ceb3))
* **web-cli:** add page collect, remove page-collect scripts ([3887675](https://github.com/adobe/skills/commit/3887675001d89f47fb164d39e28413734c6075a6))
* **web-cli:** add page langs, remove page-langs scripts ([cdebffc](https://github.com/adobe/skills/commit/cdebffc8165196e746ac811656e7e00147db3842))
* **web-cli:** add page overlays, remove page-prep scripts ([1fbcc3e](https://github.com/adobe/skills/commit/1fbcc3e349c1f4b52e834f9d9c6b54e40fc91a83))
* **web-cli:** add page reduce ([5c30b12](https://github.com/adobe/skills/commit/5c30b12b06be5801ac26d341812ebe0d5d185612))
* **web-cli:** add page tree with shared page preparation ([844cbfc](https://github.com/adobe/skills/commit/844cbfc9c7045d9e01ef6c7cda7b56a13981e93e))
* **web-cli:** add playwright-cli driver and blocked-page detection ([4e09a85](https://github.com/adobe/skills/commit/4e09a850a319a2791bb627be2e3526f02b265ad0))
* **web-cli:** add probe command, remove browser-probe scripts ([e3b9a9c](https://github.com/adobe/skills/commit/e3b9a9c36e34e470428dc639dd2f8b549f1a2c06))
* **web-cli:** add session helpers and browser group ([32c5013](https://github.com/adobe/skills/commit/32c501325f2a97e8ede000fc18f6f231c3b51f67))
* **web-cli:** export a library entry for programs adding their own commands ([991a21d](https://github.com/adobe/skills/commit/991a21dc485bf3f5a20f104198e1dc0b9abe4b64))
* **web-cli:** fall back to PLAYWRIGHT_CLI_SESSION for --session ([a4d5144](https://github.com/adobe/skills/commit/a4d5144321d7e1350110bc2cea2f95ac9667c607))
* **web-cli:** launch extensions headless by default ([9a56d8f](https://github.com/adobe/skills/commit/9a56d8f440fa632502295637b796bfc2833eb647))
* **web-cli:** open a named session on demand when a url is given ([4a37d05](https://github.com/adobe/skills/commit/4a37d05246f34667d21138997db8dee4ca4542e3))
* **web-cli:** record the probed url in the recipe ([8610fca](https://github.com/adobe/skills/commit/8610fca1dbf556849d8ad438628e87368c9941e0))
* **web-cli:** scaffold package, root program and output contract ([af96fd4](https://github.com/adobe/skills/commit/af96fd4a38f87b29270d33555062841f4bf3a53a))
* **web-cli:** web doc prints long-form docs shipped in the binary ([1afa266](https://github.com/adobe/skills/commit/1afa2662829135341cfe2044299704f28b3fc89b))
* **web-cli:** write artifacts under <session>-<command>/ with stable file names ([9517861](https://github.com/adobe/skills/commit/95178618a7939cc09a2c5e1e03a76a91a41bdd16))

# Changelog
