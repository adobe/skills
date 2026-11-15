# the mobile-first checks take a project's own steps (#644)

- **`breakpoint-lint.mjs` with a target (#162):** a desktop-first row now prints its rewrite on the
  nearest target step (`max-width: 767px` with `600,900` → `(width >= 900px)`, not 768px) and is no
  longer listed again as off-target, so the summary counts it once.
- **prototype `mobile-nav-collapse.md` order check:** matches the `min-width` / `width >=` `@media`
  that holds the `.ds-nav-burger` rule, at any step, instead of only `(width >= 641px)`; a project on
  its `DESIGN.json` target steps (deploy Step 3) no longer fails it.
