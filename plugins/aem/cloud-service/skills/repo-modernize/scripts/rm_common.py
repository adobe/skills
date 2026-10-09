from __future__ import annotations
import hashlib, json
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional

MANIFEST_DIR = ".modernize"
DEFAULT_IGNORE = {".git", ".modernize", "target", "node_modules", ".idea"}

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

def iter_files(root, ignore=DEFAULT_IGNORE) -> Iterator[Path]:
    root = Path(root)
    for p in sorted(root.rglob("*")):
        if p.is_file() and not any(part in ignore for part in p.relative_to(root).parts):
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
