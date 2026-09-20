# Inconsistency register — Larkspur Mutual replica

One entry. Everything not listed here is frozen; any other design delta
found by the gate is a defect, not an improvement.

## R-01 — Footer link contrast below the site's own body-text floor

- **Evidence:** footer links measured `#7f8894` on `#ffffff` = 3.1:1
  (computed style, 1440 and 360); every other text colour on the site
  clears 4.5:1. Measured 2026-09-08 during Phase 3 CSS lifting.
- **Finding:** the footer is the only text zone under the site's own
  contrast floor — an internal inconsistency, not a taste preference.
- **Minimal change:** lift footer link colour to `#4a5563` (4.6:1); no
  other footer change.
- **Status:** applied
- **Where:** footer band, all page types.
