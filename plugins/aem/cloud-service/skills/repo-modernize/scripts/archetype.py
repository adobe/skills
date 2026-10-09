#!/usr/bin/env python3
"""Archetype / AEM SDK version resolution (Maven Central) + the skill's pins.

The skill scaffolds from a BUNDLED, PINNED copy of the AEM project archetype
templates (`assets/archetype-pom-templates/`, currently archetype-56) and bakes a
PINNED AEM SDK API version into the reactor. Pinning keeps every run deterministic
and offline — a re-runnable, reviewable git diff — and mirrors how the CAM tool
itself works (it bakes `template_archetype_56` into its jar).

This module adds the "always be on the latest" capability the pinning otherwise
lacks, in two safe tiers:

  1. **SDK API version** — a single version string in the reactor's
     `<dependencyManagement>` / `<aem.sdk.api>` property. Bumping it to the newest
     Cloud SDK is low-risk (no structural change), so `refactor_poms` can opt into
     the latest via `--sdk-version latest` (default stays pinned for determinism).

  2. **Archetype template STRUCTURE** — the module poms/plugins the skill's
     deterministic string-surgery is calibrated against. A newer archetype can
     rename properties / reshape plugins, which could silently break the transform,
     so the structure is NOT swapped at runtime. `refresh_archetype.py` regenerates
     it under a test gate instead (the CAM `archetype-auto-update` model).

Every network call here is best-effort and offline-safe: on timeout / no network /
any error it returns `None`, never raises — callers fall back to the pin.
"""
from __future__ import annotations

import re
import urllib.request
from typing import Optional

# --- The skill's current pins (single source of truth; imported elsewhere) ------
PINNED_ARCHETYPE = "56"
PINNED_SDK_API = "2026.4.25520.20260417T163942Z-260300"
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
    return ("newer available -> " + "; ".join(parts)
            + ".  Use --sdk-version latest for the SDK now, or run "
            "scripts/refresh_archetype.py to update the pins.")
