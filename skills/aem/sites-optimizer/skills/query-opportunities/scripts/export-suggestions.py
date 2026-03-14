#!/usr/bin/env python3
"""Export Spacecat suggestions (with parent opportunity context) to CSV.

Usage:
    python export-suggestions.py [--env dev|prod] [--opp-filters KEY=VALUE ...]
                                  [--sug-filters KEY=VALUE ...] [--output FILE]

Examples:
    python export-suggestions.py
    python export-suggestions.py --opp-filters type=eq.broken-backlinks status=eq.NEW
    python export-suggestions.py --sug-filters type=eq.CODE_CHANGE status=eq.NEW
    python export-suggestions.py --env dev --output /tmp/suggestions.csv
"""

import argparse
import csv
import json
import sys
import urllib.request

ENDPOINTS = {
    "dev": "https://dql63ofcyt4dr.cloudfront.net",
    "prod": "https://d1xldhzwm6wv00.cloudfront.net",
}

DEFAULT_OPP_FIELDS = "id,site_id,title,type,status,tags"
DEFAULT_SUG_FIELDS = "id,opportunity_id,type,rank,status,data,created_at"


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp)


def fetch_opportunities(base, fields, filters, limit=1000):
    url = f"{base}/opportunities?select={fields}"
    for f in filters:
        url += f"&{f}"
    url += f"&order=created_at.desc&limit={limit}"
    return fetch_json(url)


def fetch_suggestions(base, fields, opp_ids, filters):
    suggestions = []
    for i in range(0, len(opp_ids), 30):
        batch = ",".join(opp_ids[i : i + 30])
        url = f"{base}/suggestions?select={fields}&opportunity_id=in.({batch})"
        for f in filters:
            url += f"&{f}"
        url += "&order=rank.asc"
        suggestions.extend(fetch_json(url))
    return suggestions


def main():
    parser = argparse.ArgumentParser(description="Export Spacecat suggestions to CSV")
    parser.add_argument("--env", choices=["dev", "prod"], default="prod")
    parser.add_argument("--opp-filters", nargs="*", default=[], help="PostgREST filters for opportunities")
    parser.add_argument("--sug-filters", nargs="*", default=[], help="PostgREST filters for suggestions")
    parser.add_argument("--output", default="/tmp/opportunities_with_suggestions.csv")
    parser.add_argument("--limit", type=int, default=1000)
    args = parser.parse_args()

    base = ENDPOINTS[args.env]

    opps = fetch_opportunities(base, DEFAULT_OPP_FIELDS, args.opp_filters, args.limit)
    if not opps:
        print("No opportunities found.", file=sys.stderr)
        sys.exit(0)

    opp_ids = [o["id"] for o in opps]
    opp_map = {o["id"]: o for o in opps}

    suggestions = fetch_suggestions(base, DEFAULT_SUG_FIELDS, opp_ids, args.sug_filters)
    if not suggestions:
        print("No suggestions found for the matched opportunities.", file=sys.stderr)
        sys.exit(0)

    with open(args.output, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["opportunity_id", "opp_title", "opp_type", "opp_status",
                     "suggestion_id", "suggestion_type", "suggestion_rank",
                     "suggestion_status", "suggestion_created_at"])
        for s in suggestions:
            opp = opp_map.get(s["opportunity_id"], {})
            w.writerow([
                s["opportunity_id"], opp.get("title", ""), opp.get("type", ""),
                opp.get("status", ""), s["id"], s["type"], s["rank"],
                s["status"], s["created_at"],
            ])

    print(f"Exported {len(suggestions)} suggestions across {len(opp_ids)} opportunities to {args.output}")


if __name__ == "__main__":
    main()
