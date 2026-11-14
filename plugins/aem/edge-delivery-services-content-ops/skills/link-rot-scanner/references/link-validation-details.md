# Link Validation Reference

## HTTP Status Classification

When validating links, classify responses as follows:

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Valid | No action needed |
| 301/302 | Redirect | Record final destination; update link to point directly there |
| 404 | Broken | Flag for fix or removal |
| 403 | Forbidden | May be bot detection (external) or access-restricted (internal) |
| 5xx | Server error | May be transient; flag for manual recheck |
| Timeout | No response | Use 10s for internal, 15s for external |

For redirect chains, follow all hops to the final destination. A 301 that resolves to a 404 is still a broken link.

## EDS-Specific Link Handling

- Check both `/path` and `/path/` (EDS may serve content at either).
- Fragment links (`#section-name`): verify the target exists by checking for a matching `id` attribute in `.plain.html`.
- Links injected by JavaScript blocks at runtime will not appear in `.plain.html`. Note this limitation in the report and suggest checking the published page for JS-rendered links.

## External Link Validation Rules

- **Timeout:** 15 seconds (some external sites are slow).
- **Rate limiting:** Wait 500ms between requests to the same external domain.
- **User-Agent:** Use a descriptive header (e.g., `EDS-LinkCheck/1.0`).
- **Bot detection:** Some sites block automated HEAD/GET requests or return false 403s. Flag these as "unable to verify" rather than "broken."

## Priority Levels

| Priority | Category | Rationale |
|----------|----------|-----------|
| P0 | Broken internal links (404) | Fully within site owner's control; harms UX and SEO |
| P1 | Broken external links (404) | External site changed or removed |
| P2 | Redirecting links (301/302) | Works but wastes a round-trip; loses link equity |
| P3 | Insecure links (HTTP not HTTPS) | Security and trust signal |
| P4 | Unable to verify (403/5xx/timeout) | May or may not be broken; needs manual check |
| Info | Anchor issues | Fragment target `id` not found on page |

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Query index returns 404 | Site may not have a query index configured | Fall back to sitemap.xml; if that also fails, ask for a manual page list |
| Query index is paginated | Large site with many pages | Follow pagination (offset/limit parameters) until all pages are retrieved |
| External links return 403 but work in a browser | Bot detection or IP-based blocking | Mark as "unable to verify" and note that manual checking is required |
| Timeout on external links | Slow external server or network issues | Use 15-second timeout; report timeouts separately from confirmed broken links |
| `.plain.html` missing links that appear on the published page | Links may be injected by JavaScript blocks at runtime | Note the limitation; suggest checking the published page for JS-rendered links |
| Too many links to check in one session | Very large site with thousands of links | Process in batches; prioritize internal links first, then external links for high-traffic pages |

## Implementation Instructions for Authors

1. Open each source document in Google Docs or Word via da.live or SharePoint.
2. Use find (Ctrl/Cmd+F) to locate the broken link's anchor text.
3. Update the link URL to the suggested fix, or remove the link if no fix is available.
4. For redirecting links, update the URL to the final destination.
5. Preview changes on the `.page` or `.live` domain.
6. Publish the updated pages.
7. Re-run this skill to verify all fixes.
