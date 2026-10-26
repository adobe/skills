#!/usr/bin/env python3
"""repo-modernize orchestrator: one entry point for any project shape, in two steps.

    python3 scripts/orchestrate.py <root> --plan
        Inspect every code-bearing unit and write its proposed plan to
        `<unit>/.modernize/config.json` (+ inventory/findings). Writes nothing else.
        Review/edit each config.json with the user before applying.

    python3 scripts/orchestrate.py <root> --apply [--git] [--verify] [--mvn] [--sdk-version V]
        Restructure every legacy unit IN PLACE using its reviewed config.json -- never
        re-inspected, so plan edits are kept. Units are processed in CAM's order
        (sub-projects first, then the main project); already-restructured (`modern`) and
        code-less (`empty`) units are skipped.

Running without --plan/--apply only plans: nothing is restructured before review.

`--apply` checks its prerequisites first (lxml for POM editing; with --git, a git
work tree with no uncommitted changes outside `.modernize/` and an in-project install of
this skill) and exits 2 with instructions if one is missing. Exit code: 0 when every legacy
unit succeeded (and, with --verify, passed its structural gate); otherwise the first
non-zero code. `<root>/.modernize/orchestration.json` records the plan/result per unit.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

import rm_common as C
import inspect_project as I

_REQUIREMENTS = Path(__file__).resolve().parent.parent / "requirements.txt"


def _ordered_units(root: str) -> dict:
    """Discover units (read-only) and order them sub-projects first, then main."""
    plan = I.discover_units(root)
    units = list(plan["units"])
    if plan["shape"] == "MONOLITHIC":
        units = [u for u in units if u["path"] != "."] + [u for u in units if u["path"] == "."]
    return {"shape": plan["shape"], "units": units}


def _unit_dir(root: str, rel: str) -> str:
    return root if rel == "." else str(Path(root) / rel)


# --------------------------------------------------------------------------- preflight

def lxml_problem() -> Optional[str]:
    """None if lxml is importable; otherwise how to install it."""
    try:
        import lxml  # noqa: F401
    except ImportError:
        venv = C.SKILL_DIR / ".venv"
        return ("lxml is not installed (needed to edit POMs). Install it into a virtual "
                "environment in the skill's folder (outside your project's git status) and "
                "run the scripts with its python:\n"
                f"  python3 -m venv {venv} && {venv}/bin/pip install -r {_REQUIREMENTS}\n"
                f"  {venv}/bin/python {Path(__file__).resolve()} <project-root> --apply ...\n"
                "or, if this Python allows installing packages:\n"
                f"  {sys.executable} -m pip install -r {_REQUIREMENTS}")
    return None


def git_problem(root: str) -> Optional[str]:
    """None if `root` is in a git work tree with no uncommitted changes outside the
    skill's own `.modernize/` folders and agent tooling (`C.agent_tooling_paths`: an
    in-project install of this skill, `skills-lock.json`); otherwise what is wrong."""
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=root,
                             capture_output=True, text=True)
    except FileNotFoundError:
        return "git is not installed (needed for --git)."
    if top.returncode != 0:
        return f"{root} is not inside a git repository (needed for --git)."
    top_dir = Path(top.stdout.strip()).resolve()
    tooling = C.agent_tooling_paths(root)
    status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "--", "."],
                            cwd=root, capture_output=True, text=True, check=True).stdout
    dirty = []
    for line in status.splitlines():
        path = line[3:]
        if not line or ".modernize/" in path or path.endswith(".modernize"):
            continue
        full = top_dir / path
        # a multi-agent install links e.g. .claude/skills/<skill> to the copy in .agents/skills
        if any(t == p or t in p.parents for t in tooling for p in (full, full.resolve())):
            continue
        dirty.append(path)
    if dirty:
        shown = "\n  ".join(dirty[:10]) + ("\n  ..." if len(dirty) > 10 else "")
        return ("the working tree has uncommitted changes; commit or stash them first so the "
                f"restructuring is a reviewable diff on its own branch:\n  {shown}")
    return None


# --------------------------------------------------------------------------- plan

def _plan_unit(unit_dir: str) -> dict:
    """Stage 1 (inspect) on one unit: writes only `<unit>/.modernize/`."""
    try:
        rc = I.main([unit_dir])
    except Exception as e:  # one unit must never abort the whole run
        return {"ok": False, "error": str(e)}
    return {"ok": rc == 0, "error": None if rc == 0 else f"exit {rc}",
            "config": str(Path(unit_dir) / ".modernize" / "config.json")}


# --------------------------------------------------------------------------- apply

def _run_unit_pipeline(unit_dir: str, use_git: bool, sdk_version: str = "pinned") -> dict:
    """Stages 3-6 on ONE planned unit, in place, from its reviewed config.json.
    Returns `{"ok", "failed_stage", "findings"}`; stops at the first failing stage."""
    import convert_osgi as OSGI   # imported here: refactor_poms needs lxml, checked by preflight
    import refactor_poms as RP
    import scaffold_modules as SC
    import split_content as SP

    cfg = str(Path(unit_dir) / ".modernize" / "config.json")
    if not Path(cfg).is_file():
        return {"ok": False, "failed_stage": "plan", "findings": 0,
                "error": f"no reviewed plan at {cfg} -- run with --plan first"}
    git = ["--git"] if use_git else []
    sdk = ["--sdk-version", sdk_version] if sdk_version and sdk_version != "pinned" else []
    stages = [
        ("scaffold",      lambda: SC.main([unit_dir, "--config", cfg])),
        ("split",         lambda: SP.main([unit_dir, "--config", cfg] + git)),
        ("convert_osgi",  lambda: OSGI.main([unit_dir, "--config", cfg] + git)),
        ("refactor_poms", lambda: RP.main([unit_dir, "--config", cfg] + sdk)),
    ]
    for name, fn in stages:
        try:
            rc = fn()
        except Exception as e:
            return {"ok": False, "failed_stage": name, "error": str(e), "findings": 0}
        if rc != 0:
            return {"ok": False, "failed_stage": name, "error": f"exit {rc}", "findings": 0}
    try:
        n = len(C.load_json(C.manifest_path(unit_dir, "findings.json")).get("findings", []))
    except (OSError, ValueError):
        n = 0
    return {"ok": True, "failed_stage": None, "findings": n}


def _verify_unit(unit_dir: str, use_mvn: bool) -> int:
    """Stage 7 structural gate on a unit (plus the informational build with `use_mvn`)."""
    import verify as VF
    cfg = str(Path(unit_dir) / ".modernize" / "config.json")
    inv = str(Path(unit_dir) / ".modernize" / "inventory.json")
    argv = [unit_dir, "--config", cfg] + (["--inventory", inv] if Path(inv).exists() else [])
    return VF.main(argv + (["--mvn"] if use_mvn else []))


def orchestrate(root: str, mode: str = "plan", use_git: bool = True, do_verify: bool = False,
                use_mvn: bool = False, sdk_version: str = "pinned") -> dict:
    """Plan or apply every legacy unit of `root`. Returns the result dict (also written to
    `<root>/.modernize/orchestration.json`)."""
    if mode not in ("plan", "apply"):
        raise ValueError(f"mode must be 'plan' or 'apply', not {mode!r}")
    discovered = _ordered_units(root)
    shape, results, overall_rc = discovered["shape"], [], 0

    for u in discovered["units"]:
        rel, status = u["path"], u["status"]
        unit_dir = _unit_dir(root, rel)
        if status != "legacy":
            results.append({"path": rel, "status": status, "action": "skipped"})
            print(f"[skip] {rel} ({status}) -- already restructured / no code")
            continue
        if mode == "plan":
            r = _plan_unit(unit_dir)
            results.append({"path": rel, "status": status, "action": "planned", **r})
            if r["ok"]:
                print(f"[plan] {rel}: review {r['config']}")
            else:
                overall_rc = overall_rc or 1
                print(f"[FAIL] {rel}: inspect -- {r['error']}")
            continue
        print(f"[unit] modernizing {rel} ...")
        r = _run_unit_pipeline(unit_dir, use_git, sdk_version=sdk_version)
        entry = {"path": rel, "status": status, "action": "modernized", **r}
        if r["ok"] and do_verify:
            entry["verify_rc"] = _verify_unit(unit_dir, use_mvn)
            if entry["verify_rc"] != 0:
                overall_rc = overall_rc or entry["verify_rc"]
        if not r["ok"]:
            overall_rc = overall_rc or (2 if r["failed_stage"] == "plan" else 1)
            print(f"[FAIL] {rel}: stage '{r['failed_stage']}' -- {r.get('error')}")
        else:
            print(f"[ok]   {rel}: {r['findings']} finding(s)"
                  + (f", verify rc={entry['verify_rc']}" if do_verify else ""))
        results.append(entry)

    out = {"mode": mode, "shape": shape, "root": str(Path(root)), "units": results, "rc": overall_rc}
    try:
        C.save_json(C.manifest_path(root, "orchestration.json"), out)
    except OSError:
        pass
    _print_summary(mode, shape, results, do_verify)
    return out


def _print_summary(mode: str, shape: str, results: List[dict], do_verify: bool) -> None:
    if mode == "plan":
        planned = [r for r in results if r.get("action") == "planned" and r.get("ok")]
        print(f"\norchestrate --plan: shape={shape}; {len(planned)} unit(s) planned. Review each "
              ".modernize/config.json (appId, module mapping, ambiguous content), then re-run "
              "with --apply.")
        return
    legacy = [r for r in results if r.get("action") == "modernized"]
    ok = [r for r in legacy if r.get("ok")]
    verify_failed = [r for r in legacy if r.get("verify_rc", 0) != 0]
    summary = (f"\norchestrate --apply: shape={shape}; {len(legacy)} unit(s) modernized, "
               f"{len(ok)} pipeline-ok, {len(legacy) - len(ok)} pipeline-failed")
    if do_verify:
        summary += f", {len(verify_failed)} verify-failed"
    print(summary + f"; {sum(r.get('findings', 0) for r in legacy)} total finding(s).")
    if verify_failed:
        print("  verify-failed unit(s) need review (e.g. an already-partly-modernized project "
              "should not be blindly re-modernized): " + ", ".join(r["path"] for r in verify_failed))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="repo-modernize orchestrator (any project shape)")
    ap.add_argument("root", help="project root (SINGLE/NESTED/MULTI/MONOLITHIC)")
    step = ap.add_mutually_exclusive_group()
    step.add_argument("--plan", action="store_true",
                      help="inspect and write each unit's proposed .modernize/config.json (default)")
    step.add_argument("--apply", action="store_true",
                      help="restructure each unit from its reviewed config.json")
    ap.add_argument("--git", action="store_true",
                    help="use `git mv` to preserve history (requires a clean work tree)")
    ap.add_argument("--verify", action="store_true",
                    help="with --apply, also run the structural gate per unit")
    ap.add_argument("--mvn", action="store_true",
                    help="with --verify, also run the informational mvn/analyser build")
    ap.add_argument("--sdk-version", default="pinned",
                    help="AEM SDK API version: 'pinned' (default), 'latest' (newest from "
                         "Maven Central, offline-safe fallback), or an explicit version.")
    a = ap.parse_args(argv)
    if not a.apply:
        return orchestrate(a.root, mode="plan")["rc"]
    problems = [p for p in (lxml_problem(), git_problem(a.root) if a.git else None) if p]
    if problems:
        print("repo-modernize: cannot apply yet --\n" + "\n".join(problems), file=sys.stderr)
        return 2
    return orchestrate(a.root, mode="apply", use_git=a.git, do_verify=a.verify, use_mvn=a.mvn,
                       sdk_version=a.sdk_version)["rc"]


if __name__ == "__main__":
    raise SystemExit(main())
