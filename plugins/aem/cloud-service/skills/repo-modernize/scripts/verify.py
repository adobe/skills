# scripts/verify.py
"""Phase-2 verification gate — the structural oracle turned all the way on, plus an
informational `mvn`/aemanalyser runner.

Composition:
  - `structural_gate` invokes Phase-1's `validate.main` with BOTH `--check-pom-shape` and
    `--check-embeds` turned on (they are off by default in Phase 1 — see validate.py's module
    docstring for why). This is the actual Phase-2 structural gate: filter-immutability +
    no-loss (when an inventory is supplied) + pom-shape + embeds, all in one oracle call.
  - `maven_gate` runs `mvn` (with an injectable `run`, defaulting to `subprocess.run`, so unit
    tests never need a live Maven) and parses the captured log text for `aemanalyser` ERROR-
    level findings and a Java compile failure attributable to a specific module.
  - `main` orchestrates both and prints a verdict that distinguishes a full Phase-2 success
    from a legacy-core Java compile break, which is a `code-assessment` hand-off rather than a
    Phase-2 failure (see the plan's wknd-success-bar ruling), from a genuine aemanalyser ERROR,
    which IS a real Cloud-validity failure (spec Sec 3: no-content-loss and analyser must BOTH
    stay green -- anti-gaming). The ruling's compile-break carve-out is narrow: it covers ONLY a
    legacy-`core` Java compile failure with no analyser errors. `main`'s exit-code contract is
    therefore three-way:
      0   = structural PASS, and either (a) `--mvn` wasn't run, (b) `--mvn` ran and analyser is
            clean (full Phase-2 success), or (c) `--mvn` ran and the ONLY problem is a
            legacy-core compile break (`compile_failed_module` set AND `analyser_errors` empty)
            -- the code-assessment hand-off case.
      1/2 = structural gate failed (its own exit code, e.g. 1 violations / 2 usage-IO error) --
            `main` returns before ever invoking mvn.
      3   = structural PASS, but `maven_gate` reported non-empty `analyser_errors` (whether or
            not a compile break also occurred) -- a real Phase-2 failure, NOT a hand-off. A
            CI/automation caller checking `$?` must see this as failure, not success.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from typing import Dict, List, Optional, Sequence

import rm_common as C
import validate as V

# Matches "analyser" and "analyzer" (British/American spelling), which also matches
# "aemanalyser" as a substring -- one regex covers every spelling the brief calls out.
_ANALYSER_RE = re.compile(r"analy[sz]er", re.IGNORECASE)

# The most direct signal Maven itself gives for which reactor module a compile failure
# belongs to: "Failed to execute goal ... on project <artifactId>: Compilation failure".
_ON_PROJECT_RE = re.compile(r"on project ([\w.\-]+)\s*:")
# Maven's own "resume the build" hint: "mvn <args> -rf :<artifactId>".
_RESUME_RE = re.compile(r"-rf\s*:([\w.\-]+)")
# The reactor summary line for a failed module: "core ..................... FAILURE [n s]".
_REACTOR_FAILURE_RE = re.compile(r"^\[INFO\]\s+(\S+)\s+\.{2,}\s*FAILURE", re.MULTILINE)
# A "[INFO] Building <module> <version> [n/m]" line, used only as a last-resort fallback:
# the module name preceding the failure, per the brief.
_BUILDING_RE = re.compile(r"^\[INFO\]\s+Building\s+(\S+)", re.MULTILINE)


def structural_gate(root: str, config_path: str, inventory_path: Optional[str] = None) -> int:
    """The Phase-2 structural gate: Phase-1's oracle with pom-shape + embeds turned ON.

    Delegates entirely to `validate.main` (never reimplements a check here) with
    `--check-pom-shape` and `--check-embeds` always passed, plus `--inventory` when one is
    given (enabling the no-loss check too). Returns `validate.main`'s exit code verbatim:
    0 clean, 1 violations found, 2 usage/IO error (e.g. a missing/malformed config file).
    """
    argv = [root, "--config", config_path, "--check-pom-shape", "--check-embeds"]
    if inventory_path:
        argv += ["--inventory", inventory_path]
    return V.main(argv)


def _analyser_error_lines(text: str) -> List[str]:
    return [line.strip() for line in text.splitlines()
            if "[ERROR]" in line and _ANALYSER_RE.search(line)]


def _compile_failed_module(text: str) -> Optional[str]:
    """Best-effort extraction of the reactor module a Java compile failure belongs to.

    Gated on `COMPILATION ERROR` appearing in the log at all: a `BUILD FAILURE` on its own
    can mean anything (a failed test, a missing dependency, ...), and only a compile failure
    is the legacy-core hand-off case `main` needs to distinguish from a real Phase-2 failure.
    Tries, in order of directness: the module Maven names in "on project X: Compilation
    failure"; the module in its own "-rf :X" resume hint; the module marked FAILURE in the
    reactor summary; and finally the last "Building X" line seen before the failure block --
    the fallback the brief explicitly calls out.
    """
    if "COMPILATION ERROR" not in text:
        return None
    for pattern in (_ON_PROJECT_RE, _RESUME_RE, _REACTOR_FAILURE_RE):
        m = pattern.search(text)
        if m:
            return m.group(1)
    idx = text.index("COMPILATION ERROR")
    building = _BUILDING_RE.findall(text[:idx])
    return building[-1] if building else None


# Maven "project building" (POM-model) errors that mean a module's pom is malformed --
# distinct from a Java COMPILATION ERROR. In a MODERNIZED content module these mean the
# restructuring itself produced a pom Maven can't even read (e.g. `Unknown packaging:
# content-package` from a missing FileVault extensions binding, a `Non-resolvable parent
# POM` from a stale parent version, or a missing dependency `<version>`): a real Phase-2
# failure, NOT a code-assessment hand-off. `main` acts on these ONLY for the
# content-modules build (which never includes legacy `core`), so a legacy-core POM problem
# stays a hand-off.
_POM_MODEL_ERROR_MARKERS = (
    "Unknown packaging",
    "Non-resolvable parent POM",
    "'dependencies.dependency.version'",
    "The build could not read",
    "ProjectBuildingException",
)


def _pom_model_error_lines(text: str) -> List[str]:
    return [line.strip() for line in text.splitlines()
            if "[ERROR]" in line and any(m in line for m in _POM_MODEL_ERROR_MARKERS)]


def maven_gate(root: str, goals: Sequence[str], modules: Optional[Sequence[str]] = None,
                run=subprocess.run) -> Dict:
    """Run `mvn` (via the injectable `run`, so tests never need a live Maven) and parse the
    captured log text into `{ok, analyser_errors, compile_failed_module, returncode}`.

    `ok` is True only when the process exited 0 AND no aemanalyser ERROR-level line was
    found -- a clean returncode with an analyser ERROR buried in the log (Maven sometimes
    still exits non-zero for those, but not always, depending on plugin binding) is NOT ok.
    """
    argv = ["mvn"] + list(goals) + (["-pl", ",".join(modules)] if modules else [])
    proc = run(argv, cwd=root, capture_output=True, text=True)
    stdout = getattr(proc, "stdout", "") or ""
    stderr = getattr(proc, "stderr", "") or ""
    text = stdout + "\n" + stderr

    analyser_errors = _analyser_error_lines(text)
    compile_failed_module = _compile_failed_module(text)
    returncode = proc.returncode

    return {
        "ok": returncode == 0 and not analyser_errors,
        "analyser_errors": analyser_errors,
        "compile_failed_module": compile_failed_module,
        "pom_model_errors": _pom_model_error_lines(text),
        "returncode": returncode,
    }


def main(argv=None, run=subprocess.run) -> int:
    """CLI entry point — the Phase-2 verification gate.

    `<root> --config <path> [--inventory <path>] [--mvn]`. `structural_gate` always runs and
    a structural failure returns its own exit code (mvn is never invoked in that case).

    With `--mvn`, the exit code is three-way (see the module docstring):
      0 = full success (analyser clean) OR structural PASS with the ONLY mvn problem being a
          legacy-core compile break (`compile_failed_module` set AND no `analyser_errors`) --
          the code-assessment hand-off; the restructuring itself is correct.
      3 = structural PASS but `analyser_errors` is non-empty -- a genuine Cloud-validity
          failure (spec Sec 3 anti-gaming: analyser must stay green), NOT a hand-off, even if a
          compile break also occurred.
    `run` is accepted purely so tests can inject a fake Maven process; real CLI invocations
    never need to pass it.
    """
    ap = argparse.ArgumentParser(description="repo-modernize Phase-2 verification gate")
    ap.add_argument("root")
    ap.add_argument("--config", required=True)
    ap.add_argument("--inventory")
    ap.add_argument("--mvn", action="store_true",
                     help="also run mvn (content-packages build + full install) and report "
                          "the aemanalyser/compile result -- DOES affect the exit code: a "
                          "genuine aemanalyser ERROR-level finding makes main() return 3 "
                          "(a real Phase-2 failure), while 0 covers both full success and a "
                          "structural-PASS-with-legacy-core-compile-break-only hand-off to "
                          "code-assessment")
    a = ap.parse_args(argv)

    rc = structural_gate(a.root, a.config, a.inventory)
    if rc != 0:
        print("VERDICT: structural FAIL -- Phase-2 restructuring is incorrect "
              "(filter-immutability / no-loss / pom-shape / embeds); fix before proceeding.")
        return rc

    print("structural PASS: filter-immutability + no-loss + pom-shape + embeds all clean.")

    if not a.mvn:
        print("VERDICT: structural PASS (pass --mvn to also run the informational "
              "content-packages build + full install).")
        return 0

    try:
        config = C.load_json(a.config)
    except (OSError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    tm = config["targetModules"]
    content_modules = [tm["uiAppsStructure"], tm["uiConfig"], tm["uiContent"], tm["uiApps"]]
    content_result = maven_gate(a.root, ["package", "-am"], modules=content_modules, run=run)
    full_result = maven_gate(a.root, ["install"], run=run)

    analyser_errors = content_result["analyser_errors"] + full_result["analyser_errors"]
    compile_failed_module = (content_result["compile_failed_module"]
                              or full_result["compile_failed_module"])

    if content_result["ok"] and full_result["ok"]:
        print("VERDICT: structural PASS + analyser clean -- full Phase-2 success.")
        return 0

    if analyser_errors:
        print("VERDICT: structural PASS, but aemanalyser reported ERROR-level findings -- "
              "this IS a Phase-2 FAILURE (spec Sec 3: analyser must stay green; this is NOT "
              "a code-assessment hand-off, even if a compile break also occurred):")
        for line in analyser_errors:
            print(f"  {line}")
        return 3

    if content_result["pom_model_errors"]:
        print("VERDICT: structural PASS, but a MODERNIZED content module's POM is malformed "
              "-- Maven cannot even read it (the content-modules build covers only "
              "modernized/reactor modules, never legacy core). This IS a Phase-2 FAILURE "
              "(the restructuring produced an unbuildable module), NOT a code-assessment "
              "hand-off -- fix before proceeding:")
        for line in content_result["pom_model_errors"]:
            print(f"  {line}")
        return 4

    if compile_failed_module:
        print(f"VERDICT: structural PASS, but the core Java compile failed in module "
              f"'{compile_failed_module}' -- the restructuring itself is correct; hand this "
              "compile break off to the code-assessment skill (this is NOT a Phase-2 "
              "failure).")
        return 0

    print("VERDICT: structural PASS; mvn did not succeed for a reason this gate could "
          "not classify (e.g. a legacy-core dependency it can't resolve in this "
          "environment) -- informational only, inspect the mvn output above.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
