#!/usr/bin/env python3
"""Which AEM project archetype and AEM SDK version a run uses.

repo-modernize ships no archetype. The plan step generates the module templates from an
archetype (`archetype_templates.py`): by default the newest Adobe AEM Project Archetype,
otherwise the one the user names. "latest" (archetype or AEM SDK API) is resolved as:

  1. Maven Central's `maven-metadata.xml` (best effort, short timeout);
  2. otherwise the newest version already in the local Maven repository (offline use,
     or a network that only reaches Maven through a company mirror);
  3. otherwise None: for the archetype, the caller asks for an explicit version; for the
     AEM SDK API, the plan uses the previous plan's version, else `TESTED_SDK`, and says so
     (generating the archetype only writes the version into a POM, so the plan never
     downloads aem-sdk-api: it may be missing from the local repository).

`TESTED_ARCHETYPE` / `TESTED_SDK` are the archetype and AEM SDK API versions the test suite
covers (`plugins/aem/cloud-service/test/repo-modernize/fixtures/archetype-templates`). If the
latest archetype's templates don't fit the restructuring, the plan falls back to it.
Every network call is best effort and never raises.
"""
from __future__ import annotations

import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional, Tuple

TESTED_ARCHETYPE = "58"
TESTED_SDK = "2026.10.29023.20261017T134015Z-260900"
ARCHETYPE = ("com.adobe.aem", "aem-project-archetype")
SDK_API = ("com.adobe.aem", "aem-sdk-api")

_MAVEN_CENTRAL = "https://repo1.maven.org/maven2"


def _fetch(url: str, timeout: float) -> Optional[str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 (fixed https host)
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def _latest_tag(xml: Optional[str]) -> Optional[str]:
    """The `<release>` (or `<latest>`) value from a Maven `maven-metadata.xml`."""
    if not xml:
        return None
    m = re.search(r"<release>([^<]+)</release>", xml) or re.search(r"<latest>([^<]+)</latest>", xml)
    return m.group(1).strip() if m else None


def central_latest(group: str, artifact: str, timeout: float = 6.0) -> Optional[str]:
    """The newest release of group:artifact on Maven Central, or None when unreachable."""
    path = "/".join(group.split(".") + [artifact])
    return _latest_tag(_fetch(f"{_MAVEN_CENTRAL}/{path}/maven-metadata.xml", timeout))


def local_repository() -> Path:
    """The local Maven repository: `REPO_MODERNIZE_M2_REPO`, else `<localRepository>` in
    `~/.m2/settings.xml`, else `~/.m2/repository`."""
    env = os.environ.get("REPO_MODERNIZE_M2_REPO")
    if env:
        return Path(env).expanduser()
    try:
        for e in ET.parse(str(Path.home() / ".m2" / "settings.xml")).iter():
            if e.tag.split("}")[-1] == "localRepository" and (e.text or "").strip():
                value = e.text.strip().replace("${user.home}", str(Path.home()))
                return Path(os.path.expandvars(value)).expanduser()
    except (OSError, ET.ParseError):
        pass
    return Path.home() / ".m2" / "repository"


def version_key(version: str):
    """Order Maven release versions by their numeric parts (58 < 59;
    2026.4.25520.20260417T163942Z-260300 < 2026.10.29023.20261017T134015Z-260900)."""
    return [int(n) for n in re.findall(r"\d+", version)]


def newest_local(group: str, artifact: str) -> Optional[str]:
    """The newest release of group:artifact in the local Maven repository, or None."""
    d = local_repository().joinpath(*group.split("."), artifact)
    try:
        versions = [p.name for p in d.iterdir()
                    if p.is_dir() and "SNAPSHOT" not in p.name and re.match(r"\d", p.name)
                    and any(f.suffix in (".pom", ".jar") for f in p.iterdir())]
    except OSError:
        return None
    return max(versions, key=version_key) if versions else None


def latest(group: str, artifact: str, timeout: float = 6.0) -> Tuple[Optional[str], str]:
    """`(version, where)`: Maven Central's newest release, else the local repository's
    newest; `(None, "")` when neither is available."""
    version = central_latest(group, artifact, timeout)
    if version:
        return version, "Maven Central"
    version = newest_local(group, artifact)
    if version:
        return version, "local Maven repository"
    return None, ""


def resolve_latest_archetype(timeout: float = 6.0) -> Optional[str]:
    return latest(*ARCHETYPE, timeout=timeout)[0]


def resolve_latest_sdk_api(timeout: float = 6.0) -> Optional[str]:
    return latest(*SDK_API, timeout=timeout)[0]
