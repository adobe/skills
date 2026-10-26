#!/usr/bin/env python3
"""
Workfront Planning + Fusion scenario optimizer (review-only).

Reads one or more exported Fusion scenario blueprints (.json) that use the
Workfront Planning (workfront-maestro) connector and reports the patterns that hurt
performance: run time, operations consumed, and API call volume (which drives
rate-limit 429s). Read-only. Output is a Markdown self-review.

Scope guard: this reviewer is specific to the Workfront Planning connector. If a
blueprint does not use workfront-maestro modules, it says so and stops, rather than
pretending to review an arbitrary Fusion scenario.

Usage:
    python analyze_blueprint.py scenario.json [scenario2.json ...]
    python analyze_blueprint.py scenario.json --callmix calls.csv
    python analyze_blueprint.py scenario.json --json
"""
import json, re, sys, argparse, collections, os

MAESTRO = "workfront-maestro:"

# ---------- walking ----------

def load(path):
    with open(path) as f:
        return json.load(f)

def walk(flow, feed, out):
    """Flat-flow model: a BasicFeeder makes every later module in its array iterate
    (+1). Iteration depth is what multiplies both call volume and operations, so it
    is the main driver of run time and cost."""
    cur = feed
    for m in flow:
        if not isinstance(m, dict) or "module" not in m:
            continue
        out.append({"feed": cur, "m": m})
        if m.get("module") == "builtin:BasicFeeder":
            cur += 1
        for r in (m.get("routes") or []):
            walk(r.get("flow", []), cur, out)
        if isinstance(m.get("onerror"), list):
            walk(m["onerror"], cur, out)

def url_of(m):  return str((m.get("mapper") or {}).get("url") or (m.get("mapper") or {}).get("path") or "")
def method_of(m): return (m.get("mapper") or {}).get("method", "")
def conn_of(m): return (m.get("parameters") or {}).get("__IMTCONN__")

def extract_ids(path):
    """List the record-type and field ids the blueprint references, so they can be
    resolved to names/topology via a connected Workfront Planning MCP. Read-only."""
    txt = json.dumps(load(path))
    rts = sorted(set(re.findall(r"\bRt[0-9a-f]{16,}\b", txt)))
    fields = sorted(set(re.findall(r"\bF[0-9a-f]{20,}\b", txt)))
    ws = sorted(set(re.findall(r"\bWs[0-9a-f]{16,}\b", txt)))
    return {"file": os.path.basename(path), "workspace_ids": ws,
            "record_type_ids": rts, "field_ids": fields,
            "counts": {"record_types": len(rts), "fields": len(fields)}}

# ---------- analysis ----------

def analyze(path):
    d = load(path)
    entries = []
    walk(d.get("flow", []), 0, entries)
    all_mods = [e["m"] for e in entries]
    txt = json.dumps(d)

    # namespaces present (helps the not-applicable message be useful)
    namespaces = collections.Counter(str(m.get("module", "")).split(":")[0] for m in all_mods)
    api = [e for e in entries if str(e["m"].get("module", "")).startswith(MAESTRO)]

    if not api:
        return {"file": os.path.basename(path), "scenario": d.get("name"),
                "applicable": False, "module_count": len(all_mods),
                "namespaces": dict(namespaces)}

    max_depth = max((e["feed"] for e in entries), default=0)
    findings = []

    def add(code, title, severity, impact, detail, rec, count=None):
        findings.append({"code": code, "title": title, "severity": severity,
                         "impact": impact, "count": count, "detail": detail,
                         "recommendation": rec})

    # ---- READ PATH (biggest driver of calls, operations, and time) ----

    schema_inloop = [e for e in api if e["m"].get("module") == "workfront-maestro:custom"
                     and "record-types" in url_of(e["m"]) and method_of(e["m"]) == "GET"
                     and e["feed"] > 0]
    if schema_inloop:
        add("F1", "Record-type / field schema fetched inside a loop", "high",
            "calls + operations + run time",
            f"{len(schema_inloop)} schema GET(s) run at iteration depth > 0. Definitions "
            "are static per run, so this re-fetches identical data every iteration, adding "
            "calls, operations, and wall-clock time for nothing.",
            "Fetch each definition once before the loop, cache it in a variable or the data "
            "store, and reference it inside the loop.", len(schema_inloop))

    perrec = [e for e in api if (e["m"].get("module") == "workfront-maestro:getRecord"
              or (e["m"].get("module") == "workfront-maestro:custom" and method_of(e["m"]) == "GET"
                  and re.search(r"records/", url_of(e["m"])))) and e["feed"] > 0]
    if perrec:
        ds = sorted({e["feed"] for e in perrec})
        add("F2", "Per-record reads (GET by id) inside nested loops", "high",
            "calls + operations + run time",
            f"{len(perrec)} single-record read(s) run inside loops (depth {min(ds)}-{max(ds)}). "
            "One call per record scales linearly with record count and multiplies with "
            "nesting. There is no bulk-read endpoint, so this is fixed by reading wider, not "
            "by raising a limit or going faster.",
            "Collapse per-record reads into one filtered, projected search per level. Filter "
            "the child record type by its parent reference and project the fields you need "
            "with attributes so the data comes back in the search result.", len(perrec))

    getrec = [e for e in api if e["m"].get("module") == "workfront-maestro:getRecord"]
    walk_then_get = [e for e in getrec if re.search(
        r"\[\]\.id|\.data\.|\bsearch", str((e["m"].get("mapper") or {}).get("recordID", "")))]
    if walk_then_get:
        add("F3", "Read a set, then GET each record again by id", "high",
            "calls + operations + run time",
            f"{len(walk_then_get)} read(s) take their id from a prior search result or a "
            "reference array and re-fetch the same record. The fields are usually already in "
            "the first result, so the follow-up GET is redundant and, being nested, "
            "multiplies most.",
            "Project the needed fields into the first read and delete the follow-up GET.",
            len(walk_then_get))

    searches_inloop = [e for e in api if e["m"].get("module") == "workfront-maestro:searchRecords2"
                       and e["feed"] > 0]
    if searches_inloop:
        add("P2", "Search runs inside a loop (repeated every iteration)", "medium",
            "calls + operations + run time",
            f"{len(searches_inloop)} search(es) execute inside a loop. If the result is the "
            "same each iteration, the search is being repeated needlessly; if it varies only "
            "by a parent id, it can often be replaced by one wider search before the loop.",
            "Move the search above the loop and reuse the result, or widen the filter so one "
            "search covers all iterations (search by parent id hasAnyOf the set).",
            len(searches_inloop))

    # ---- WRITE PATH ----

    bulk = len(re.findall(r"/v2/records(?![/{])", txt))
    single_writes = [e for e in api if e["m"].get("module") in (
        "workfront-maestro:createRecord", "workfront-maestro:updateRecord",
        "workfront-maestro:deleteRecord") or (e["m"].get("module") == "workfront-maestro:custom"
        and method_of(e["m"]) in ("POST", "PUT", "PATCH", "DELETE"))]
    if single_writes and bulk == 0:
        add("F4", "All writes are single-record; no bulk endpoints", "medium",
            "calls + operations + run time",
            f"{len(single_writes)} write(s) go one record per call; no bulk endpoint "
            "(/v2/records, 100 per request) appears. Bulk cuts write calls, operations, and "
            "time together.",
            "Aggregate writes and send via the v2 bulk endpoints at 100 per request. Bulk is "
            "not atomic: read the per-item error array and retry only failures. Batch level "
            "by level, since a child needs its parent's id first.", len(single_writes))

    seq = [e["m"] for e in entries]
    pairs = sum(1 for i in range(len(seq) - 1)
                if seq[i].get("module") in ("workfront-maestro:createRecord", "workfront-maestro:updateRecord")
                and ((seq[i + 1].get("module") == "workfront-maestro:custom" and method_of(seq[i + 1]) == "PATCH")
                     or (seq[i + 1].get("module") == "workfront-maestro:updateRecord"
                         and seq[i].get("module") == "workfront-maestro:createRecord")))
    if pairs:
        add("F5", "Write-then-PATCH double write", "medium", "calls + operations",
            f"~{pairs} create/update step(s) are immediately followed by a second write to "
            "the same record, so every logical write costs two calls and two operations.",
            "Confirm which field(s) force the second write. If a connector limitation, raise "
            "it; otherwise merge into a single create/update.", pairs)

    # ---- THROUGHPUT / RESILIENCE / RESOURCE ----

    sleeps = [e for e in entries if any(k in str(e["m"].get("module", "")).lower()
              for k in ("sleep", "delay", "wait")) or "tools:sleep" in str(e["m"].get("module", ""))]
    if sleeps:
        add("P1", "Sleep / delay modules (throttle workaround)", "high",
            "run time + timeout risk",
            f"{len(sleeps)} sleep/delay module(s) present. Sleeps trade rate-limit failures "
            "for longer runs and timeout risk, and they hide the real problem. They also "
            "consume run time without doing work.",
            "Treat sleeps as a temporary bridge. Fix the underlying call volume first (read "
            "path), then remove or re-place the sleeps. Removing them before cutting volume "
            "just concentrates the same calls into a shorter window and can make bursts "
            "worse, so sequence the change.", len(sleeps))

    conns = collections.Counter(conn_of(e["m"]) for e in api if conn_of(e["m"]) is not None)
    reads = [e for e in api if e["m"].get("module") in ("workfront-maestro:getRecord",
             "workfront-maestro:searchRecords2") or (e["m"].get("module") == "workfront-maestro:custom"
             and method_of(e["m"]) == "GET")]
    if len(conns) == 1 and single_writes and reads:
        add("P3", "Reads and writes share one connection (one rate bucket)", "medium",
            "throughput / concurrency",
            "Every Planning call uses a single connection, so reads and writes share one "
            "per-user rate budget and cannot run against separate budgets. Under concurrency "
            "this serializes throughput and makes the limit easier to hit.",
            "Split read and write traffic across separate integration accounts so each gets "
            "its own per-user budget. This is headroom, applied after the call reductions.")

    risky = [e for e in getrec if "[].id" in str((e["m"].get("mapper") or {}).get("recordID", ""))
             and not e["m"].get("filter")]
    if risky:
        add("F6", "Reads that can fire with an empty id (wasted calls / 404s)", "medium",
            "calls + wasted operations",
            f"{len(risky)} read(s) build their id from an array dereference with no guard. An "
            "empty array fires a request with no id, returning 404 and wasting budget. "
            "Returning an empty string from an if() does not stop the call.",
            "Add a module-level filter so the read runs only when the source array is "
            "non-empty.", len(risky))

    ignores = txt.count('"builtin:Ignore"')
    if ignores:
        add("F7", "Errors silently ignored (no retry, no visibility)", "medium",
            "reliability + hidden cost",
            f"{ignores} Ignore handler(s). Swallowing 429/5xx hides the true failure rate and "
            "gives up retries that would recover the work.",
            "On calls that draw 429/5xx, replace suppression with retry plus backoff, then "
            "surface real errors. Keep suppression only on genuinely optional calls, and be "
            "explicit about which.", ignores)

    triggers = [e["m"] for e in api if e["m"].get("module") == "workfront-maestro:watchEvents"]
    for t in triggers:
        if not any(k in (t.get("mapper") or {}) for k in ("limit", "maxResults", "filter", "filters")):
            add("F8", "Change trigger may be unbounded / unfiltered", "low",
                "run frequency + total load",
                "The watchEvents trigger has no visible limit or filter, so it can fire the "
                "whole scenario per delivered change and multiply load in busy windows.",
                "Filter the trigger to only records that need processing and set a sane batch "
                "size.")

    v1, v2 = len(re.findall(r"\bv1/", txt)), len(re.findall(r"\bv2/", txt))
    if v1 and v2:
        add("F9", "Mixed v1 / v2 API usage", "low", "maintainability + unlocks bulk",
            f"Both v1 ({v1}) and v2 ({v2}) paths are used. Standardizing on v2 (search, bulk "
            "writes, Fields API) simplifies the integration and is what unlocks bulk.",
            "Move reads to v2 search/get, definitions to the v2 Fields API, writes to the v2 "
            "single and bulk endpoints.")

    return {"file": os.path.basename(path), "scenario": d.get("name"), "applicable": True,
            "module_count": len(all_mods), "api_call_modules": len(api),
            "max_iteration_depth": max_depth, "distinct_connections": len(conns),
            "findings": findings}

# ---------- optional call mix ----------

def callmix(path):
    import csv
    rows = list(csv.DictReader(open(path)))
    if not rows:
        return None
    def col(r, *names):
        for n in names:
            for k in r:
                if k.lower().strip() == n:
                    return r[k]
        return ""
    total = len(rows)
    status = collections.Counter(col(r, "status code", "status", "http.status_code") for r in rows)
    reads = sum(1 for r in rows if col(r, "method").upper() == "GET")
    schema = sum(1 for r in rows if "record-types" in col(r, "resource").lower())
    # average duration if present
    durs = []
    for r in rows:
        v = col(r, "duration")
        m = re.search(r"([\d.]+)", v)
        if m: durs.append(float(m.group(1)))
    return {"total": total, "status": dict(status),
            "read_share": round(100 * reads / total, 1),
            "schema_share": round(100 * schema / total, 1),
            "avg_duration": round(sum(durs) / len(durs), 1) if durs else None}

# ---------- rendering ----------

SEV = {"high": 0, "medium": 1, "low": 2}
LBL = {"high": "HIGH", "medium": "MEDIUM", "low": "LOW"}

def render(results, mix=None):
    L = ["# Workfront Planning + Fusion scenario optimization review\n"]
    L.append("Read-only review of the exported scenario(s). It flags the patterns that hurt "
             "performance, run time, operations consumed, and API call volume (which drives "
             "rate-limit 429s), ordered by impact. Every Fusion module execution is an "
             "operation, and iteration depth multiplies operations, so the same fix usually "
             "improves speed, cost, and rate-limit headroom together. No blueprint was "
             "modified.\n")
    if mix:
        L.append("## Measured call mix (from the provided export)\n")
        L.append(f"- Total sampled requests: {mix['total']}")
        L.append(f"- Reads (GET) share: ~{mix['read_share']}%  |  schema-fetch share: ~{mix['schema_share']}%")
        if mix.get("avg_duration") is not None:
            L.append(f"- Avg request duration: ~{mix['avg_duration']} (units per export)")
        L.append(f"- Status codes: {mix['status']}\n")

    for r in results:
        L.append(f"## {r['file']}")
        if not r.get("applicable"):
            ns = ", ".join(f"{k} ({v})" for k, v in sorted(r["namespaces"].items(), key=lambda x: -x[1]))
            L.append("**Not applicable.** This scenario does not use the Workfront Planning "
                     "(`workfront-maestro`) connector, so this reviewer does not apply to it. "
                     "It reviews Workfront Planning scenarios specifically, not Fusion "
                     "scenarios in general.\n")
            L.append(f"*Modules: {r['module_count']}. Connectors detected: {ns or 'none'}.*\n")
            continue
        if r["scenario"]:
            L.append(f"*Scenario:* {r['scenario']}")
        L.append(f"*Modules (operations proxy):* {r['module_count']} | *Planning API modules:* "
                 f"{r['api_call_modules']} | *Deepest loop nesting:* {r['max_iteration_depth']} | "
                 f"*Distinct connections:* {r['distinct_connections']}\n")
        fs = sorted(r["findings"], key=lambda x: SEV[x["severity"]])
        if not fs:
            L.append("No optimization findings detected.\n")
            continue
        c = collections.Counter(f["severity"] for f in fs)
        L.append("**" + str(len(fs)) + " finding(s):** "
                 + ", ".join(f"{c[s]} {LBL[s].lower()}" for s in ["high", "medium", "low"] if c[s]) + "\n")
        for f in fs:
            cnt = f" (x{f['count']})" if f.get("count") else ""
            L.append(f"### [{LBL[f['severity']]}] {f['code']}: {f['title']}{cnt}")
            L.append(f"*Improves:* {f['impact']}\n")
            L.append(f"{f['detail']}\n")
            L.append(f"*Recommendation:* {f['recommendation']}\n")
    L.append("---")
    L.append("*Heuristic structural review. Confirm field/record-type ids and eligibility "
             "filters against your live workspace, measure a representative run before and "
             "after, and validate in a sandbox before promoting. Reference ids differ per "
             "instance.*")
    return "\n".join(L)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--callmix")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--ids", action="store_true",
                    help="Emit the record-type/field ids referenced, to resolve via a Planning MCP")
    a = ap.parse_args()
    if a.ids:
        print(json.dumps({"ids": [extract_ids(p) for p in a.files]}, indent=2))
        return
    results = [analyze(p) for p in a.files]
    mix = callmix(a.callmix) if a.callmix else None
    if a.json:
        print(json.dumps({"results": results, "callmix": mix}, indent=2))
    else:
        print(render(results, mix))

if __name__ == "__main__":
    main()
