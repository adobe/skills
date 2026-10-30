#!/usr/bin/env python3
"""Archetype / AEM SDK version resolution (Maven Central) + the skill's pins.

The skill scaffolds from BUNDLED module templates (`assets/archetype-pom-templates/`),
generated from Adobe's AEM project archetype by `refresh_archetype.py` (which also
rewrites the pins below; a maintainer runs it when a new archetype ships), and bakes
a PINNED AEM SDK API version into the reactor. Pinning keeps every run deterministic and
offline -- a re-runnable, reviewable git diff.

Two ways to be newer than the pins, both opt-in at apply time:

  1. **SDK API version** -- `--sdk-version latest` writes the newest `aem-sdk-api` into
     the reactor (a version string; no structural change).
  2. **Archetype** -- `--archetype latest|<version>|<g:a:v>` generates the templates
     from that archetype with Maven (`archetype_templates.py`) and checks they fit the
     transforms before anything changes.

Every network call here is best-effort and offline-safe: on timeout / no network /
any error it returns `None`, never raises — callers fall back to the pin.
"""
from __future__ import annotations

import re
import urllib.request
from typing import Optional

# --- The skill's current pins (single source of truth; imported elsewhere) ------
PINNED_ARCHETYPE = "58"
PINNED_SDK_API = "2026.10.29023.20261017T134015Z-260900"
PINNED_AEMANALYSER = "1.6.6"

_MC = "https://repo1.maven.org/maven2"
_SDK_META = f"{_MC}/com/adobe/aem/aem-sdk-api/maven-metadata.xml"
_ARCHETYPE_META = f"{_MC}/com/adobe/aem/aem-project-archetype/maven-metadata.xml"


def _fetch(url: str, timeout: float) -> Optional[str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 (fixed https host)
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def _latest_tag(xml: Optional[str]) -> Optional[str]:
    """The `<latest>` (or `<release>`) value from a Maven `maven-metadata.xml`."""
    if not xml:
        return None
    m = re.search(r"<latest>([^<]+)</latest>", xml) or re.search(r"<release>([^<]+)</release>", xml)
    return m.group(1).strip() if m else None


def resolve_latest_sdk_api(timeout: float = 6.0) -> Optional[str]:
    """The newest published `com.adobe.aem:aem-sdk-api` version, or `None` offline."""
    return _latest_tag(_fetch(_SDK_META, timeout))


def resolve_latest_archetype(timeout: float = 6.0) -> Optional[str]:
    """The newest published `com.adobe.aem:aem-project-archetype` version (e.g. "58"),
    or `None` offline."""
    return _latest_tag(_fetch(_ARCHETYPE_META, timeout))


def sdk_api_version(prefer_latest: bool = False, timeout: float = 6.0):
    """The SDK API version to bake into output.

    `prefer_latest=False` (default) → the pin (deterministic, offline).
    `prefer_latest=True` → the latest from Maven Central, falling back to the pin
    when offline. Returns `(version, is_latest, note)` where `note` is a
    human-readable one-liner for the CLI (empty when nothing noteworthy)."""
    if not prefer_latest:
        return PINNED_SDK_API, False, ""
    latest = resolve_latest_sdk_api(timeout)
    if latest is None:
        return PINNED_SDK_API, False, ("could not reach Maven Central; using pinned "
                                       f"AEM SDK {PINNED_SDK_API}")
    if latest == PINNED_SDK_API:
        return latest, True, ""
    return latest, True, f"using latest AEM SDK {latest} (pinned was {PINNED_SDK_API})"


def staleness_note(timeout: float = 4.0) -> Optional[str]:
    """A one-line notice when the pins are behind Maven Central's latest, so a run
    is never SILENTLY on a stale archetype/SDK. `None` when offline or up to date."""
    latest_arch = resolve_latest_archetype(timeout)
    latest_sdk = resolve_latest_sdk_api(timeout)
    parts = []
    if latest_arch and latest_arch != PINNED_ARCHETYPE:
        parts.append(f"archetype-{latest_arch} (pinned: {PINNED_ARCHETYPE})")
    if latest_sdk and latest_sdk != PINNED_SDK_API:
        parts.append(f"AEM SDK {latest_sdk} (pinned: {PINNED_SDK_API})")
    if not parts:
        return None
    advice = []
    if latest_sdk and latest_sdk != PINNED_SDK_API:
        advice.append("add --sdk-version latest to --apply to build against the newest SDK")
    if latest_arch and latest_arch != PINNED_ARCHETYPE:
        advice.append(f"add --archetype latest to --apply to use archetype-{latest_arch} now "
                      "(needs Maven); the bundled templates follow in a skill update")
    text = "; ".join(advice)
    return "newer available -> " + "; ".join(parts) + ".  " + text[:1].upper() + text[1:] + "."
