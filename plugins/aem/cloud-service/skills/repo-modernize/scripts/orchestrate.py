#!/usr/bin/env python3
"""repo-modernize orchestrator — the shape-aware, single entry point (Phase 3).

Runs the whole modernization for a project of ANY CAM shape (SINGLE / NESTED /
MULTI / MONOLITHIC) by discovering its "modernization units" (the code-bearing
project directories) and running the deterministic SINGLE pipeline on each, in
place, in CAM's own order (sub-projects first, then the main project).

CAM's Repository Modernizer runs the same 12-handler pipeline per project,
"sub-projects first, then main" (`cam-repo-modernizer-analysis.md` §6). This skill
reproduces that: for each `legacy` unit it runs
`inspect_project -> scaffold_modules -> split_content -> convert_osgi ->
refactor_poms` (the Stage 1-6 SINGLE pipeline), then optionally the Stage-7
structural/build verify. Units already restructured (`modern`) or with no code
(`empty`) are skipped, exactly as CAM skips already-modern sub-projects.

Unlike CAM (which copies into a fresh `modernized/` tree), this skill edits IN
PLACE per unit -- so the umbrella/root reactor of a NESTED/MULTI project keeps its
own `<modules>` wiring and simply aggregates the modernized sub-projects. Each unit
is independently reviewable as its own git diff.

Usage:
    python3 scripts/orchestrate.py <root> [--git] [--mvn] [--verify]

Exit code: 0 if every legacy unit's pipeline (and, with --verify, its structural
gate) succeeded; the first non-zero unit exit code otherwise. A per-unit and
aggregate summary is printed, and `<root>/.modernize/orchestration.json` records
the plan + per-unit result.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import rm_common as C
import inspect_project as I
import scaffold_modules as SC
import split_content as SP
import convert_osgi as OSGI
import refactor_poms as RP
import verify as VF


# The Stage 1-6 SINGLE pipeline, as (stage-name, callable(unit_dir, cfg_path,
# use_git) -> int) entries. Kept declarative so the per-unit runner is a plain loop
# and a stage insertion/removal is a one-line change.
def _run_unit_pipeline(unit_dir: str, use_git: bool, sdk_version: str = "pinned") -> dict:
    """Run the deterministic SINGLE pipeline on ONE unit directory, in place.
    Returns `{"ok", "failed_stage", "findings"}`. Stops at the first failing stage
    (a later stage's preconditions depend on the earlier ones)."""
    cfg = str(Path(unit_dir) / ".modernize" / "config.json")
    git = ["--git"] if use_git else []
    sdk = ["--sdk-version", sdk_version] if sdk_version and sdk_version != "pinned" else []

    stages = [
        ("inspect",       lambda: I.main([unit_dir])),
        ("scaffold",      lambda: SC.main([unit_dir, "--config", cfg])),
        ("split",         lambda: SP.main([unit_dir, "--config", cfg] + git)),
        ("convert_osgi",  lambda: OSGI.main([unit_dir, "--config", cfg] + git)),
        ("refactor_poms", lambda: RP.main([unit_dir, "--config", cfg] + sdk)),
    ]
    for name, fn in stages:
        try:
            rc = fn()
        except Exception as e:                       # never let one unit abort the whole run
            return {"ok": False, "failed_stage": name, "error": str(e), "findings": 0}
        if rc != 0:
            return {"ok": False, "failed_stage": name, "error": f"exit {rc}", "findings": 0}

    findings_path = C.manifest_path(unit_dir, "findings.json")
    try:
        n = len(C.load_json(findings_path).get("findings", []))
    except (OSError, ValueError):
        n = 0
    return {"ok": True, "failed_stage": None, "findings": n}


def _verify_unit(unit_dir: str, use_mvn: bool) -> int:
    """Run the Stage-7 verify gate on a unit. Structural-only unless `use_mvn`."""
    cfg = str(Path(unit_dir) / ".modernize" / "config.json")
    inv = str(Path(unit_dir) / ".modernize" / "inventory.json")
    argv = [unit_dir, "--config", cfg]
    if Path(inv).exists():
        argv += ["--inventory", inv]
    if use_mvn:
        argv += ["--mvn"]
    return VF.main(argv)


def orchestrate(root: str, use_git: bool = True, do_verify: bool = False,
                use_mvn: bool = False, sdk_version: str = "pinned") -> dict:
    """Discover the units for `root` (any shape) and run the pipeline on each legacy
    unit, in CAM's "sub-projects first, then main" order. Returns the full result
    dict (also written to `<root>/.modernize/orchestration.json`)."""
    plan = I.discover_units(root)
    shape = plan["shape"]
    # CAM order: sub-projects first, then the main project. `discover_units` lists a
    # MONOLITHIC root ('.') first for readability; reverse so sub-projects run first.
    units = list(plan["units"])
    if shape == "MONOLITHIC":
        units = [u for u in units if u["path"] != "."] + [u for u in units if u["path"] == "."]

    results = []
    overall_rc = 0
    for u in units:
        rel, status = u["path"], u["status"]
        unit_dir = root if rel == "." else str(Path(root) / rel)
        if status != "legacy":
            results.append({"path": rel, "status": status, "action": "skipped"})
            print(f"[skip] {rel} ({status}) -- already restructured / no code")
            continue

        print(f"[unit] modernizing {rel} ...")
        r = _run_unit_pipeline(unit_dir, use_git, sdk_version=sdk_version)
        entry = {"path": rel, "status": status, "action": "modernized", **r}
        if r["ok"] and do_verify:
            vrc = _verify_unit(unit_dir, use_mvn)
            entry["verify_rc"] = vrc
            if vrc not in (0,):            # 0 = pass / code-assessment hand-off
                overall_rc = overall_rc or vrc
        if not r["ok"]:
            overall_rc = overall_rc or 1
            print(f"[FAIL] {rel}: stage '{r['failed_stage']}' -- {r.get('error')}")
        else:
            print(f"[ok]   {rel}: {r['findings']} finding(s)"
                  + (f", verify rc={entry.get('verify_rc')}" if do_verify else ""))
        results.append(entry)

    out = {"shape": shape, "root": str(Path(root)), "units": results, "rc": overall_rc}
    # Best-effort: persist the orchestration record next to the root (a MULTI root
    # may have no pom, but `.modernize/` is still a fine place for the record).
    try:
        C.save_json(C.manifest_path(root, "orchestration.json"), out)
    except OSError:
        pass

    legacy = [r for r in results if r.get("action") == "modernized"]
    ok = [r for r in legacy if r.get("ok")]
    verify_failed = [r for r in legacy if r.get("verify_rc", 0) not in (0,)]
    summary = (f"\norchestrate: shape={shape}; {len(legacy)} unit(s) modernized, "
               f"{len(ok)} pipeline-ok, {len(legacy) - len(ok)} pipeline-failed")
    if do_verify:
        summary += f", {len(verify_failed)} verify-failed"
    summary += f"; {sum(r.get('findings', 0) for r in legacy)} total finding(s)."
    print(summary)
    if verify_failed:
        print("  verify-failed unit(s) need review (e.g. an already-partly-modernized "
              "project should not be blindly re-modernized): "
              + ", ".join(r["path"] for r in verify_failed))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="repo-modernize orchestrator (any project shape)")
    ap.add_argument("root", help="project root (SINGLE/NESTED/MULTI/MONOLITHIC)")
    ap.add_argument("--git", action="store_true",
                    help="use `git mv` in split/convert to preserve history")
    ap.add_argument("--verify", action="store_true",
                    help="also run the Stage-7 structural gate per unit")
    ap.add_argument("--mvn", action="store_true",
                    help="with --verify, also run the informational mvn/analyser build")
    ap.add_argument("--sdk-version", default="pinned",
                    help="AEM SDK API version: 'pinned' (default), 'latest' (newest from "
                         "Maven Central, offline-safe fallback), or an explicit version.")
    a = ap.parse_args(argv)
    return orchestrate(a.root, use_git=a.git, do_verify=a.verify, use_mvn=a.mvn,
                       sdk_version=a.sdk_version)["rc"]


if __name__ == "__main__":
    raise SystemExit(main())
