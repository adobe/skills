#!/usr/bin/env python3
"""
CJA Dimension Analysis — HTML report generator (standalone).
Reads JSON output from cja_dimension_analysis.py and produces an interactive HTML dashboard.

This is a standalone alternative to the --format=html flag in cja_dimension_analysis.py.
Use this when you want to regenerate an HTML report from an existing JSON analysis file
without re-running the full analysis pipeline.

Usage:
    python3 analysis_report_gen.py <analysis_results_json> [output_dir]

Arguments:
    analysis_results_json  - Path to JSON file from cja_dimension_analysis.py
    output_dir             - (Optional) Output directory (default: same as input file)

Output:
    dimension_analysis_report_YYYY-MM-DD_HH-MM.html

Example:
    python3 analysis_report_gen.py ./output/dimension_analysis_results_2026-03-13_10-00.json ./output
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# Re-use generation logic from main script
sys.path.insert(0, str(Path(__file__).parent))
from cja_dimension_analysis import generate_html, analyze


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    json_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else json_path.parent

    if not json_path.exists():
        print(f"❌ File not found: {json_path}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"📂 Loading analysis results from {json_path}...")
    with open(json_path) as f:
        raw = json.load(f)

    meta = raw.get("analysis_metadata", {})
    data_view_name = meta.get("data_view_name", "Unknown Data View")
    data_view_id = meta.get("data_view_id", "")

    print(f"⚙️  Enriching analysis data...")
    enriched = analyze(raw)

    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    report_path = output_dir / f"dimension_analysis_report_{ts}.html"

    print(f"📝 Generating HTML report...")
    html = generate_html(enriched, data_view_name, data_view_id)

    with open(report_path, "w") as f:
        f.write(html)

    print(f"✅ Report saved: {report_path} ({report_path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
