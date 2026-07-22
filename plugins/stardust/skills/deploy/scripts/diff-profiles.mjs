/**
 * skills/deploy/scripts/diff-profiles.mjs
 *
 * Stack profiles for the prototype↔build reconcile probes (content-diff.mjs +
 * visual-diff.mjs). The probe ENGINES are framework-agnostic — they compare two
 * rendered URLs by computed style + DOM. Everything stack-specific lives HERE:
 *   - source/target LABELS used in messages ("proto" → "EDS")
 *   - per-flag REMEDIATION hints (how to fix in this stack)
 *   - a few tunable thresholds + the default content root selector
 *
 * Pick one with `--profile <name>`. `eds` carries the Edge Delivery / DA
 * remediation language + skill finding numbers; `generic` is neutral and works
 * for any prototype↔build comparison (a Figma export vs a React build, a legacy
 * page vs a rebuild). Add a profile by copying `generic` and editing the hints.
 *
 * A flag message is composed as: `${KIND}: ${observation} ${hints[KIND]}` — the
 * engine builds the observation (with real text/dims), the profile supplies the
 * trailing how-to-fix. An empty hint is fine.
 */

export const profiles = {
  // ── Edge Delivery Services / Document Authoring ──────────────────────────────
  eds: {
    name: 'eds',
    source: 'proto',
    target: 'EDS',
    mainDefault: 'main',
    fontDelta: 0.10, // matched-line width delta above which a face counts as forked
    eyebrow: { maxFontPx: 18, maxLen: 48 }, // small-uppercase-label classifier
    hints: {
      // content-diff
      MISSING_CTA: 'A dropped call-to-action — author the CTA row + render it in the owning block.',
      MISSING_HEADING: 'A dropped/renamed section title.',
      MISSING_EYEBROW: 'Often a segmentation drop (#76) — the eyebrow precedes its heading and got dropped, or the block never authored it.',
      MISSING_BODY: 'Often fine (a prototype placeholder rewritten to real copy) — confirm it is not dropped prose.',
      ROLE_SWAP: 'Mis-classified slot (the #76 class: body painted as eyebrow, eyebrow folded into a teaser). Fix the block node segmentation.',
      EXTRA_BODY: 'Invented / placeholder-filled copy; confirm it is intended.',
      EXTRA: 'Unexpected node with no proto source.',
      FONT_FORK: 'A "→sys" on the proto side means it named a font it never loaded and fell back — EDS self-hosting the intended fallback is then CORRECT (#77); confirm the fork is intended, else ship the missing @font-face.',
      // visual-diff
      BLANK_RENDER: 'The runtime never booted — the harness did not load scripts/scripts.js (so body.appear was never added) or it threw before decorating. Fix the harness/boot; never remove the stock body{display:none}/body.appear gate. Fix before trusting any other result.',
      IMAGERY_GAP: 'Likely image-less content using CSS fallbacks (#2) — EYEBALL the screenshots to confirm the fallbacks render intentionally (not a missing-asset regression). Not a defect by itself.',
      CONTENT_GAP: 'The EDS likely DROPPED or duplicated authored content (a missing section, a dropped CTA) — eyeball the section pair; metrics-only checks (stretch/flush/blank) cannot see this.',
      SURFACE_GROUND: 'A band likely rendered on the wrong ground (dark vs light). Check the owning block section background (#58/#59).',
      FONT_MISMATCH: 'A missing @font-face silently falling back to serif/sans (#65). Ship an @font-face for every named --display/--body family, self-hosted + root-relative.',
      IMAGE_NO_LOAD: 'In the local harness, rewrite absolute aem.page image URLs to root-relative /img/... so the asset loads and the stretch check has real dimensions (#43).',
      STRETCHED: "Add 'height: auto' to the img reset / block CSS (#36) — unless justified (#45: object-fit:cover full-bleed, or the proto shares the same stretch).",
      FLUSH_LEFT: 'Likely a dropped max-width .wrap (max-width: var(--maxw); margin: 0 auto; padding: 0 24px) on the owning block (#37).',
    },
  },

  // ── Generic prototype↔build (any stack) ──────────────────────────────────────
  generic: {
    name: 'generic',
    source: 'source',
    target: 'build',
    mainDefault: 'main',
    fontDelta: 0.10,
    eyebrow: { maxFontPx: 18, maxLen: 48 },
    hints: {
      MISSING_CTA: 'A link present in the source is absent in the build — confirm it was intentionally removed.',
      MISSING_HEADING: 'A source heading has no build equivalent — a dropped or renamed section.',
      MISSING_EYEBROW: 'A small label present in the source is absent in the build — often a component that classifies its nodes by position rather than content.',
      MISSING_BODY: 'Source body copy not found in the build — confirm a rewrite vs a drop.',
      ROLE_SWAP: 'Same text rendered under a different role (e.g. label vs body) — check the component field mapping.',
      EXTRA_BODY: 'Build copy with no source — invented/placeholder; confirm intended.',
      EXTRA: 'Unexpected node with no source.',
      FONT_FORK: 'A matched line renders a different typeface. A "→sys" on the source side means it named a font it never loaded; confirm the substitution is intended, else load the missing face.',
      BLANK_RENDER: 'The build render is hidden/empty — a load failure or an unsatisfied visibility gate. Fix before trusting any other result.',
      IMAGERY_GAP: 'The build renders far fewer images than the source — confirm intended (CSS backgrounds) vs missing assets.',
      CONTENT_GAP: 'Heading/box/height shortfall vs the source — likely dropped or duplicated content.',
      SURFACE_GROUND: 'A matched heading renders on a different ground (dark vs light) — check the section background.',
      FONT_MISMATCH: 'A named face loaded in the source but not the build — load the missing face.',
      IMAGE_NO_LOAD: 'Rendered a box but natural 0×0 — the image URL failed to load; fix the src.',
      STRETCHED: 'Image aspect ratio differs from its natural ratio — constrain one dimension (e.g. height:auto), unless an intentional cover crop.',
      FLUSH_LEFT: 'Left-anchored text at the viewport edge — likely a dropped max-width / centering container.',
    },
  },
};

export function resolveProfile(name) {
  const p = profiles[name || 'eds'];
  if (!p) {
    const known = Object.keys(profiles).join(', ');
    throw new Error(`unknown --profile "${name}" (known: ${known})`);
  }
  return p;
}
