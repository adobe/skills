#!/usr/bin/env python3
"""Export Spacecat opportunities to CSV with site base URLs.

Usage:
    python export-opportunities.py [--env dev|prod] [--filters KEY=VALUE ...]
                                   [--output FILE]

Examples:
    python export-opportunities.py
    python export-opportunities.py --env dev --filters type=eq.broken-backlinks status=eq.NEW
    python export-opportunities.py --filters 'created_at=gte.2025-11-01' --output /tmp/opps.csv
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

DEFAULT_OPP_FIELDS = "id,site_id,title,type,status,tags,origin,created_at"


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp)


def fetch_opportunities(base, fields, filters, limit=1000):
    url = f"{base}/opportunities?select={fields}"
    for f in filters:
        url += f"&{f}"
    url += f"&order=created_at.desc&limit={limit}"
    return fetch_json(url)


def fetch_sites(base, site_ids):
    sites = {}
    for i in range(0, len(site_ids), 30):
        batch = ",".join(site_ids[i : i + 30])
        url = f"{base}/sites?select=id,base_url&id=in.({batch})"
        for s in fetch_json(url):
            sites[s["id"]] = s["base_url"]
    return sites


def main():
    parser = argparse.ArgumentParser(description="Export Spacecat opportunities to CSV")
    parser.add_argument("--env", choices=["dev", "prod"], default="prod")
    parser.add_argument("--filters", nargs="*", default=[], help="PostgREST filters (e.g. type=eq.broken-backlinks)")
    parser.add_argument("--output", default="/tmp/opportunities.csv")
    parser.add_argument("--limit", type=int, default=1000)
    args = parser.parse_args()

    base = ENDPOINTS[args.env]

    opps = fetch_opportunities(base, DEFAULT_OPP_FIELDS, args.filters, args.limit)
    if not opps:
        print("No opportunities found.", file=sys.stderr)
        sys.exit(0)

    site_ids = list(set(o["site_id"] for o in opps))
    sites = fetch_sites(base, site_ids)

    with open(args.output, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["opportunity_id", "site_id", "site_base_url", "title",
                     "type", "status", "origin", "tags", "created_at"])
        for o in opps:
            w.writerow([
                o["id"], o["site_id"], sites.get(o["site_id"], ""),
                o["title"], o["type"], o["status"], o["origin"],
                "; ".join(o["tags"]) if o["tags"] else "",
                o["created_at"],
            ])

    print(f"Exported {len(opps)} opportunities across {len(sites)} sites to {args.output}")


if __name__ == "__main__":
    main()
