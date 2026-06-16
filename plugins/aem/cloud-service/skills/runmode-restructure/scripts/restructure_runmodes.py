#!/usr/bin/env python3
"""
Deterministic detector/planner/applier for AEM as a Cloud Service unsupported
OSGi run-mode config folders (BPA finding code URC, subtype ``unsupported.runmode``).

Background
----------
On AEM 6.x / AMS / on-prem you could invent any run mode and scope OSGi config
to it via a folder named ``config.<runmode>``. AEM as a Cloud Service honors only
a *closed* set of run-mode tokens, in a *fixed* order:

    service tokens      : author, publish
    environment tokens  : dev, stage, prod

A valid config folder is ``config`` optionally followed by at most one service
token and/or at most one environment token, **service before environment**, e.g.

    config            config.author        config.dev
    config.publish    config.author.prod   config.publish.stage

Anything else is silently ignored at runtime on the Cloud. This script classifies
every config folder, then mechanically restructures the fixable ones:

  * REORDER       valid tokens in the wrong order  ->  auto-fixable (e.g.
                  ``config.prod.author`` -> ``config.author.prod``)
  * UNSUPPORTED   contains a custom token (qa, uat, local, preview, ams, ...)
                  -> fixable only with an explicit token mapping (qa=stage, ...)
  * INVALID_COMBO two services or two environments (e.g. ``config.author.publish``)
                  -> needs a human decision; never auto-fixed
  * VALID         already Cloud-compatible -> left untouched

PID-level safety
----------------
Cloud Service resolves OSGi config at the PID level: the folder with the most
matching run modes wins, and a single PID cannot be split across folders. So when
a fix merges a source folder into an existing valid target, any ``.cfg.json`` /
``.cfg`` / ``.config`` / ``.xml`` file that exists in *both* is a real collision
and is reported as a conflict instead of being silently overwritten.

Subcommands
-----------
    scan     classify folders, print a human report (read-only)
    plan     write a machine-readable plan (JSON) of proposed moves (read-only)
    apply    execute the plan (mutates the working tree; use --git for ``git mv``)
    verify   re-scan and exit non-zero if any unsupported/reorder folders remain

This is pure standard library (no third-party deps) so it runs under any Python
>= 3.8 the customer happens to have.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SERVICES: Tuple[str, ...] = ("author", "publish")
ENVIRONMENTS: Tuple[str, ...] = ("dev", "stage", "prod")
VALID_TOKENS = set(SERVICES) | set(ENVIRONMENTS)

# A config folder name: "config" then zero or more ".<token>" segments.
CONFIG_DIR_RE = re.compile(r"^config(?:\.[A-Za-z0-9_-]+)*$")
# OSGi config payload files whose basename is the PID (collision unit).
CONFIG_FILE_SUFFIXES = (".cfg.json", ".cfg", ".config", ".xml")
# Folder metadata (sling:Folder marker), NOT a PID — must never count as a collision.
FOLDER_MARKER = ".content.xml"

# Classification labels.
VALID = "valid"
REORDER = "reorder"
UNSUPPORTED = "unsupported"
INVALID_COMBO = "invalid_combo"


@dataclass
class FolderFinding:
    path: str               # absolute path to the config folder
    name: str               # folder basename, e.g. "config.prod.author"
    status: str             # VALID | REORDER | UNSUPPORTED | INVALID_COMBO
    target_name: Optional[str] = None     # resolved Cloud-safe folder name
    reason: str = ""        # human explanation
    unknown_tokens: List[str] = field(default_factory=list)

    @property
    def actionable(self) -> bool:
        return self.status in (REORDER, UNSUPPORTED) and self.target_name is not None

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "name": self.name,
            "status": self.status,
            "target_name": self.target_name,
            "reason": self.reason,
            "unknown_tokens": self.unknown_tokens,
        }


def split_tokens(name: str) -> List[str]:
    """Return the run-mode tokens after the leading 'config'."""
    parts = name.split(".")
    return parts[1:]  # drop "config"


def canonical_name(services: List[str], envs: List[str]) -> str:
    """Build the canonical Cloud folder name: config[.service][.env]."""
    out = "config"
    if services:
        out += "." + services[0]
    if envs:
        out += "." + envs[0]
    return out


def classify(name: str, token_map: Optional[Dict[str, str]] = None) -> FolderFinding:
    """Classify a single config folder name.

    ``token_map`` maps a custom token (e.g. "qa") to an allowed token
    ("stage") or to "" / "drop" to remove it entirely. It is consulted only
    for UNSUPPORTED folders to compute a target name.
    """
    token_map = token_map or {}
    finding = FolderFinding(path="", name=name, status=VALID)

    tokens = split_tokens(name)
    if not tokens:
        finding.status = VALID
        finding.target_name = "config"
        finding.reason = "Bare config folder; applies to all run modes."
        return finding

    unknown = [t for t in tokens if t not in VALID_TOKENS]
    if unknown:
        finding.status = UNSUPPORTED
        finding.unknown_tokens = unknown
        # Try to resolve every unknown token via the provided mapping.
        mapped: List[str] = []
        unresolved: List[str] = []
        for t in tokens:
            if t in VALID_TOKENS:
                mapped.append(t)
                continue
            repl = token_map.get(t)
            if repl is None:
                unresolved.append(t)
            elif repl in ("", "drop"):
                continue  # drop this token
            elif repl in VALID_TOKENS:
                mapped.append(repl)
            else:
                unresolved.append(t)  # mapping points at another invalid token
        if unresolved:
            finding.reason = (
                "Custom run mode(s) "
                + ", ".join(sorted(set(unresolved)))
                + " not valid on Cloud Service; supply a mapping "
                "(e.g. " + unresolved[0] + "=stage) or drop."
            )
            return finding
        # Re-validate the mapped token set as if it were a fresh folder.
        resolved = classify("config" + ("." + ".".join(mapped) if mapped else ""))
        if resolved.status in (VALID, REORDER):
            finding.target_name = resolved.target_name
            finding.reason = (
                "Maps custom run mode(s) "
                + ", ".join(sorted(set(unknown)))
                + " -> " + finding.target_name + "."
            )
        else:
            finding.reason = (
                "Mapping produces an invalid combination ("
                + resolved.status + "); needs human review."
            )
        return finding

    services = [t for t in tokens if t in SERVICES]
    envs = [t for t in tokens if t in ENVIRONMENTS]
    if len(services) > 1 or len(envs) > 1 or len(tokens) > 2:
        finding.status = INVALID_COMBO
        finding.reason = (
            "More than one service or environment token; Cloud Service allows at "
            "most one of each. Needs a human decision on intent."
        )
        return finding

    canonical = canonical_name(services, envs)
    if name == canonical:
        finding.status = VALID
        finding.target_name = canonical
        finding.reason = "Already a valid Cloud Service run-mode folder."
    else:
        finding.status = REORDER
        finding.target_name = canonical
        finding.reason = (
            "Valid tokens in wrong order; Cloud requires service before "
            "environment (-> " + canonical + ")."
        )
    return finding


def _looks_like_osgi_config_folder(folder: Path) -> bool:
    """True if the folder holds AEM OSGi config artifacts (a .content.xml marker or
    at least one .cfg.json/.cfg/.config/.xml payload). Guards against acting on
    unrelated directories that merely happen to be named ``config.<x>`` (e.g. a
    build tool's ``config.prod`` folder)."""
    try:
        for p in folder.iterdir():
            if p.name == FOLDER_MARKER:
                return True
            if p.is_file() and p.name.lower().endswith(CONFIG_FILE_SUFFIXES):
                return True
    except OSError:
        return False
    return False


def find_config_dirs(root: Path) -> List[Path]:
    """Return every directory under root that looks like an AEM OSGi config folder."""
    out: List[Path] = []
    for dirpath, dirnames, _files in os.walk(root):
        # Skip VCS / build noise for speed and safety.
        dirnames[:] = [d for d in dirnames if d not in (".git", "target", "node_modules", ".idea")]
        for d in dirnames:
            if CONFIG_DIR_RE.match(d) and ("." in d or d == "config"):
                cand = Path(dirpath) / d
                if _looks_like_osgi_config_folder(cand):
                    out.append(cand)
    return sorted(out)


def scan(root: Path, token_map: Optional[Dict[str, str]] = None) -> List[FolderFinding]:
    findings: List[FolderFinding] = []
    for d in find_config_dirs(root):
        f = classify(d.name, token_map)
        f.path = str(d)
        findings.append(f)
    return findings


def config_files(folder: Path) -> List[Path]:
    """OSGi config payload files (PID-bearing) directly in this folder.

    Excludes ``.content.xml`` — that is the folder's sling:Folder marker, shared
    by every config folder, and must not be treated as a PID for collisions.
    """
    out: List[Path] = []
    if not folder.is_dir():
        return out
    for p in sorted(folder.iterdir()):
        if p.name == FOLDER_MARKER:
            continue
        if p.is_file() and p.name.lower().endswith(CONFIG_FILE_SUFFIXES):
            out.append(p)
    return out


@dataclass
class MoveAction:
    source: str
    target: str
    kind: str                       # "rename" | "merge"
    conflicts: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"source": self.source, "target": self.target, "kind": self.kind,
                "conflicts": self.conflicts}


def build_plan(findings: List[FolderFinding]) -> List[MoveAction]:
    """Turn actionable findings into concrete move actions, detecting PID collisions.

    Tracks the set of PID files that will *land* in each target so that conflicts
    are detected not only against a pre-existing target folder but also between two
    sources that resolve to the same (possibly not-yet-existing) target — e.g.
    ``config.qa`` and ``config.uat`` both mapping to ``config.stage``.
    """
    actions: List[MoveAction] = []
    landing: Dict[str, set] = {}   # target path -> PID file names that will be there
    claimed: set = set()           # targets an earlier action already moves into
    for f in findings:
        if not f.actionable:
            continue
        src = Path(f.path)
        dst = src.parent / f.target_name  # type: ignore[arg-type]
        if src == dst:
            continue
        dst_str = str(dst)
        if dst_str not in landing:
            landing[dst_str] = {p.name for p in config_files(dst)} if dst.exists() else set()
        existing = landing[dst_str]
        src_files = [p.name for p in config_files(src)]
        conflicts = sorted(n for n in src_files if n in existing)
        # First mover into a brand-new target renames; anyone after merges into it.
        kind = "merge" if (dst.exists() or dst_str in claimed) else "rename"
        actions.append(MoveAction(str(src), dst_str, kind, conflicts))
        landing[dst_str].update(src_files)
        claimed.add(dst_str)
    return actions


def _move_file(src: Path, dst: Path, use_git: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if use_git:
        subprocess.run(["git", "mv", str(src), str(dst)], check=True,
                       cwd=str(_git_root(src)))
    else:
        os.replace(str(src), str(dst))


def _remove_file(p: Path, use_git: bool) -> None:
    """Delete a file, staging the deletion when operating under git so the working
    tree stays consistent with the git mv moves."""
    if use_git:
        r = subprocess.run(["git", "rm", "-f", "-q", str(p)], cwd=str(_git_root(p)),
                           capture_output=True)
        if r.returncode == 0:
            return
        # not tracked (or other git issue) — fall back to a plain delete
    os.remove(str(p))


def _git_root(path: Path) -> Path:
    p = path if path.is_dir() else path.parent
    while p != p.parent:
        if (p / ".git").exists():
            return p
        p = p.parent
    return path.parent


def apply_plan(actions: List[MoveAction], use_git: bool = False) -> Tuple[int, List[str]]:
    """Execute move actions. Returns (folders_changed, error_messages)."""
    changed = 0
    errors: List[str] = []
    for a in actions:
        src, dst = Path(a.source), Path(a.target)
        if not src.exists():
            errors.append(f"source folder missing (already moved?): {src}")
            continue
        # Defense in depth: if a planned rename's target now exists (e.g. an earlier
        # action created it), degrade to a safe merge with fresh collision detection.
        if a.kind == "rename" and dst.exists():
            existing = {p.name for p in config_files(dst)}
            a = MoveAction(a.source, a.target, "merge",
                           sorted(n for n in (p.name for p in config_files(src)) if n in existing))
        if a.kind == "rename":
            try:
                if use_git:
                    _move_file(src, dst, use_git=True)
                else:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    os.rename(str(src), str(dst))
                changed += 1
            except OSError as e:
                errors.append(f"rename {src} -> {dst}: {e}")
            continue

        # merge: move every non-colliding file; skip (never clobber) colliders.
        # The all-or-nothing refusal for collisions lives in the CLI (cmd_apply);
        # by the time we get here either there are no conflicts, or the caller has
        # opted in (--allow-conflicts) to move everything except the colliding PIDs.
        conflict_set = set(a.conflicts)
        moved_any = False
        try:
            for p in sorted(src.iterdir()):
                if p.is_dir():
                    errors.append(f"merge {src} -> {dst}: unexpected subfolder "
                                  f"'{p.name}' left in place (move manually)")
                    continue
                dest = dst / p.name
                if dest.exists():
                    # The folder marker is shared metadata: keep target's, drop source's.
                    if p.name == FOLDER_MARKER:
                        _remove_file(p, use_git=use_git)
                        continue
                    # Same PID in both folders cannot be merged — leave both in place.
                    why = ("PID collision (cannot split a PID across folders)"
                           if p.name in conflict_set else "already exists in target")
                    errors.append(f"merge {src} -> {dst}: '{p.name}' {why}; "
                                  "skipped, resolve manually")
                    continue
                _move_file(p, dest, use_git=use_git)
                moved_any = True
            # remove the source dir only if it is now empty
            if not any(src.iterdir()):
                src.rmdir()
                changed += 1
            elif moved_any:
                changed += 1
        except OSError as e:
            errors.append(f"merge {src} -> {dst}: {e}")
    return changed, errors


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def parse_map(spec: Optional[str]) -> Dict[str, str]:
    """Parse 'qa=stage,uat=stage,preview=publish,local=drop' into a dict."""
    out: Dict[str, str] = {}
    if not spec:
        return out
    for pair in spec.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            raise ValueError(f"bad --map entry '{pair}' (expected token=replacement)")
        k, v = pair.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _print_report(findings: List[FolderFinding]) -> None:
    order = {UNSUPPORTED: 0, INVALID_COMBO: 1, REORDER: 2, VALID: 3}
    findings = sorted(findings, key=lambda f: (order.get(f.status, 9), f.name))
    counts: Dict[str, int] = {}
    for f in findings:
        counts[f.status] = counts.get(f.status, 0) + 1
    print(f"Scanned {len(findings)} config folder(s): " +
          ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print("-" * 78)
    for f in findings:
        arrow = f"  ->  {f.target_name}" if f.target_name and f.target_name != f.name else ""
        print(f"[{f.status:<13}] {f.name}{arrow}")
        if f.reason:
            print(f"               {f.reason}")
        print(f"               {f.path}")


def cmd_scan(args: argparse.Namespace) -> int:
    findings = scan(Path(args.root).resolve(), parse_map(args.map))
    _print_report(findings)
    bad = [f for f in findings if f.status in (UNSUPPORTED, INVALID_COMBO, REORDER)]
    return 1 if (args.strict and bad) else 0


def cmd_plan(args: argparse.Namespace) -> int:
    findings = scan(Path(args.root).resolve(), parse_map(args.map))
    actions = build_plan(findings)
    needs_review = [f.to_dict() for f in findings
                    if f.status == INVALID_COMBO
                    or (f.status == UNSUPPORTED and not f.actionable)]
    plan = {
        "root": str(Path(args.root).resolve()),
        "summary": {
            "folders": len(findings),
            "actions": len(actions),
            "conflicts": sum(1 for a in actions if a.conflicts),
            "needs_user_review": len(needs_review),
        },
        "actions": [a.to_dict() for a in actions],
        "needs_user_review": needs_review,
    }
    text = json.dumps(plan, indent=2)
    if args.out:
        Path(args.out).write_text(text)
        print(f"wrote plan to {args.out}")
    else:
        print(text)
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    findings = scan(Path(args.root).resolve(), parse_map(args.map))
    actions = build_plan(findings)
    conflicts = [a for a in actions if a.conflicts]
    if conflicts and not args.allow_conflicts:
        print("Refusing to apply: PID collisions detected (resolve manually or pass "
              "--allow-conflicts to skip just the colliding files):", file=sys.stderr)
        for a in conflicts:
            print(f"  {a.source} -> {a.target}: {', '.join(a.conflicts)}", file=sys.stderr)
        return 2
    changed, errors = apply_plan(actions, use_git=args.git)
    print(f"applied: {changed} folder(s) changed")
    for e in errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    return 1 if errors and not args.allow_conflicts else 0


def cmd_verify(args: argparse.Namespace) -> int:
    findings = scan(Path(args.root).resolve(), parse_map(args.map))
    bad = [f for f in findings if f.status in (UNSUPPORTED, INVALID_COMBO, REORDER)]
    if bad:
        print(f"FAIL: {len(bad)} non-Cloud-compatible config folder(s) remain:")
        for f in bad:
            print(f"  [{f.status}] {f.path}")
        return 1
    print(f"OK: all {len(findings)} config folder(s) are Cloud Service compatible.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="restructure_runmodes.py",
        description="Detect and fix unsupported AEM CS OSGi run-mode config folders (BPA URC).",
    )
    sub = p.add_subparsers(dest="command", required=True)

    def add_common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("root", help="project root to scan (e.g. ui.config or repo root)")
        sp.add_argument("--map", default="",
                        help="custom token mapping, e.g. 'qa=stage,uat=stage,preview=publish,local=drop'")

    sp = sub.add_parser("scan", help="classify config folders (read-only)")
    add_common(sp)
    sp.add_argument("--strict", action="store_true",
                    help="exit 1 if any fixable/unsupported folder is found")
    sp.set_defaults(func=cmd_scan)

    sp = sub.add_parser("plan", help="emit a JSON plan of moves (read-only)")
    add_common(sp)
    sp.add_argument("--out", help="write plan JSON to this file instead of stdout")
    sp.set_defaults(func=cmd_plan)

    sp = sub.add_parser("apply", help="execute the restructuring (mutates files)")
    add_common(sp)
    sp.add_argument("--git", action="store_true", help="use 'git mv' to preserve history")
    sp.add_argument("--allow-conflicts", action="store_true",
                    help="proceed even when PID collisions exist (colliding files are skipped)")
    sp.set_defaults(func=cmd_apply)

    sp = sub.add_parser("verify", help="exit non-zero if any non-compatible folder remains")
    add_common(sp)
    sp.set_defaults(func=cmd_verify)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
