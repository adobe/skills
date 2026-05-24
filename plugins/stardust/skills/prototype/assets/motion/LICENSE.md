# Bundled motion assets

This directory ships the runtime assets that cinematic prototypes
load. They are bundled rather than fetched at render time so the
prototype-to-render contract has no network dependency and produces
self-contained output.

## `lenis.min.js` + `lenis.min.css`
Smooth-scroll engine by Studio Freight / Darkroom Engineering.

- Upstream: <https://github.com/darkroomengineering/lenis>
- License: MIT
- Version: pinned to the build copied into this directory; re-bundle
  by replacing both files together.

These two files are the only external dependency cinematic prototypes
carry. Everything else (entrance keyframes, the rAF loop, the
IntersectionObserver triggers, the reduced-motion fallback) is inline
in each prototype per `reference/motion-runtime.md`.

## Versioning
Lenis is intentionally pinned. Re-bundling requires:
1. Replace `lenis.min.js` and `lenis.min.css`.
2. Re-run validation on a known-good prototype to confirm
   `lenis.scroll` API stability.
3. Note the version in the plugin CHANGELOG.

The prototype skill embeds the runtime script inline per
`reference/motion-runtime.md`; only Lenis is loaded from this directory.
