from __future__ import annotations
import sys
if sys.version_info < (3, 9):
    sys.exit("repo-modernize needs Python 3.9 or newer (found %d.%d)" % sys.version_info[:2])
import hashlib, json
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional

MANIFEST_DIR = ".modernize"
DEFAULT_IGNORE = {".git", ".modernize", "target", "node_modules", ".idea"}
SKILL_DIR = Path(__file__).resolve().parent.parent
SKILLS_LOCK = "skills-lock.json"

@dataclass(frozen=True)
class Finding:
    code: str
    priority: str   # CRITICAL | HIGH | NORMAL | LOW
    detail: str

def manifest_path(project_root, name: str) -> Path:
    return Path(project_root) / MANIFEST_DIR / name

def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

def save_json(path, data) -> None:
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True); fh.write("\n")

def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def agent_tooling_paths(root) -> List[Path]:
    """What an agent's skill installer adds to a project that is not project content: the
    folder holding this skill when it is installed inside `root` (a project-scope
    `npx skills add` uses e.g. `.agents/skills/`, so sibling skills there count too) and the
    installer's `skills-lock.json`. Absolute paths; the checks and the inventory skip them."""
    root = Path(root).resolve()
    holder = SKILL_DIR.parent if SKILL_DIR.parent.name == "skills" else SKILL_DIR
    paths = [root / SKILLS_LOCK]
    if root in holder.parents:
        paths.append(holder)
    return paths

def iter_files(root, ignore=DEFAULT_IGNORE, exclude=()) -> Iterator[Path]:
    """Files under `root`, skipping any path part named in `ignore` and anything at or
    under a path in `exclude`."""
    root = Path(root)
    base = root.resolve()
    skip = []
    for e in exclude:
        try:
            parts = Path(e).resolve().relative_to(base).parts
        except ValueError:
            continue
        if parts:
            skip.append(parts)
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).parts
        if (p.is_file() and not any(part in ignore for part in rel)
                and not any(rel[:len(s)] == s for s in skip)):
            yield p

def _local(tag: str) -> str:
    return tag.split("}", 1)[-1]

def pom_text(pom_path, localname: str) -> Optional[str]:
    for e in ET.parse(str(pom_path)).iter():
        if _local(e.tag) == localname and e.text and e.text.strip():
            return e.text.strip()
    return None

def pom_all_text(pom_path, localname: str) -> List[str]:
    return [e.text.strip() for e in ET.parse(str(pom_path)).iter()
            if _local(e.tag) == localname and e.text and e.text.strip()]

def pom_coord(pom_path, localname: str) -> Optional[str]:
    """Read a project's OWN top-level Maven coordinate (groupId/artifactId/version),
    NOT the value inherited from its <parent>. artifactId never inherits; groupId and
    version fall back to <parent> (Maven inheritance) when the project omits its own."""
    root = ET.parse(str(pom_path)).getroot()
    for child in root:  # direct children of <project> only — skips <parent>, <build>, <dependencies>
        if _local(child.tag) == localname and (child.text or "").strip():
            return child.text.strip()
    if localname in ("groupId", "version"):
        for child in root:
            if _local(child.tag) == "parent":
                for gc in child:
                    if _local(gc.tag) == localname and (gc.text or "").strip():
                        return gc.text.strip()
    return None

def dedup_findings(findings: List[Finding]) -> List[Finding]:
    seen, out = set(), []
    for f in findings:
        if f not in seen:
            seen.add(f); out.append(f)
    return out
