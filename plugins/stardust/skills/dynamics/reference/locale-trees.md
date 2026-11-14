# Locale trees (class I18N)

Locale is a **tree**, not a feature: every other class recurs inside it with locale-specific data.

- **Detect.** `hreflang` alternates on captured pages are the primary signal; the locale root's
  sitemap is not (twins sat in an unrelated sitemap; two live twins were unlisted and carried no
  hreflang). Record per page: `lang`, alternates, whether the twin is live.
- **Classify.** Inside the tree: modal titles (several variants per target → majority, log the
  variance, never translate), video ids (differ per locale — re-run the media probe on the twins),
  form strings and option lists, chrome (own megamenu/footer, vendor-injected entries may differ),
  search (own results page + `lang` index property).
- **Plan.** One manifest for all trees (`stardust/trees.json`): per tree the chrome documents,
  results page, contact page, twin root. Runtime: `<html lang>` from a `lang` metadata row,
  `<link rel=alternate hreflang>` from `alternate-<lang>` rows, the switcher to the twin, a
  `lang`-keyed string table whose every entry is **lifted from the live pages or marked OWNER** —
  "still English on live" is a valid lift, a translation is not. Strings server-rendered after a
  real submission (form confirmations) have no lift path → OWNER.
- **Implement.** Re-run the class probes on the twins (hover chrome, selects, player ids, modal
  titles); reuse the archetypes when the classifier types the twins identically.
- **Verify.** Per tree on the origin with auth scoped to the host: modal heading in the tree's
  language, a video plays with the tree's id, results only from that tree, switcher round-trips,
  `<html lang>` and alternates right. Anchors resolve through the twin's heading index; ids keep
  accents on pipeline headings and drop them in block-generated ids; deep-link fragments arrive
  percent-encoded and must be decoded.
- **qa on a locale tree** needs language awareness: placeholder-copy word lists per `lang`,
  synthetic `#modal` fragments allow-listed, twin-aware duplicate-title checks.
- **Owner items that recur per locale:** form endpoint, confirmation strings, tag vendors, indexing.
