# Lists what a page requested before its LCP element was ready, from a Lighthouse JSON report.
#   jq -r -f bytes-before-lcp.jq lh.json
# Output, tab-separated: a line with the LCP element, one line per request (transfer bytes,
# type, "SECOND ORIGIN" or empty, URL), largest first, and a last line with the total.
# Written for Lighthouse 13 (checked with 13.6.0). Lighthouse 12 and older have no
# lcp-breakdown-insight audit: the cut-off is then the LCP paint, which also counts requests
# of the lazy phase that start between the image download and the paint.
(.finalDisplayedUrl | capture("^(?<origin>https?://[^/]+)").origin) as $origin
| .audits.metrics.details.items[0].observedLargestContentfulPaint as $lcp
| if $lcp == null then error("this report has no LCP") else . end
| [.audits["lcp-breakdown-insight"].details.items[]?] as $breakdown
| [$breakdown[] | select(.type == "table") | .items[]] as $parts
# An image is ready when its download ends. Text is ready when it is painted.
| (if any($parts[]; .subpart == "resourceLoadDuration")
   then ($parts | map(select(.subpart != "elementRenderDelay") | .duration) | add)
   else $lcp end) as $ready
| [.audits["network-requests"].details.items[] | select(.networkRequestTime < $ready)] as $requests
| ([$breakdown[] | select(.type == "node") | .selector] | first // "unknown") as $element
| "# LCP element: \($element)",
  ($requests | sort_by(-.transferSize)[]
    | [.transferSize, .resourceType // "", (if (.url | startswith($origin)) then "" else "SECOND ORIGIN" end), .url]
    | @tsv),
  "\($requests | map(.transferSize) | add)\tTOTAL bytes requested before the LCP element was ready (\($ready | floor) ms)"
