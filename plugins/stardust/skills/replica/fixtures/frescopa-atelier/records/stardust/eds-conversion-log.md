# EDS conversion log

- 2026-11-21T06:52:24Z Publish decision (operator, pre-made): publish. The delivered page, redirects sheet and chrome documents (nav, footer) go live on the aem.live origin.
- 2026-11-21T07:04:49Z Published (deploy-batch, publish=true): /index (serves /), /nav, /footer on {{BRANCH}}--{{SITE}}--{{ORG}}.aem.live; no redirects sheet needed (source root serves the page).
- 2026-11-21 Delivery (replica handoff): blocks hero, intro, flavour-dna, calendar, feed, sustain, voices, cafe, cta (decode tier: template-slotted; feed cards + radar profiles + calendar days reconstructive by content) + header/footer chrome from /nav and /footer. Foundation: styles/styles.css tokens from the prototype :root, fonts self-hosted (9 OFL TTFs, styles/fonts.css). All sections are blocks (D1 advisories for hero/cta accepted: bespoke compositions). EW gate 88/88 editable.
- Published: /index (served at /), /nav, /footer on {{BRANCH}}--{{SITE}}--{{ORG}}.aem.live; no redirects sheet (source root serves the page).
- Gate @1440 (published origin): pub1 0.78% Δh0, pub2 0.69% Δh0, pub3 0.77% Δh0 (content clean), gate-all 0.11% Δh0 PASS after hero art-direction fix (best). Crop header 0.00%, footer 0.00%.
- Site-specific: CTA arrows are aria-hidden spans added by block JS (idempotent); hero art direction re-applies via ResizeObserver because sections are display:none at decorate time.
