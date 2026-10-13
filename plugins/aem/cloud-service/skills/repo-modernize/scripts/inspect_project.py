# scripts/inspect_project.py
"""Module classification, project-shape detection, and appId derivation (Phase 1, read-only).

Named `inspect_project`, not `inspect`: on Python 3.14, merely importing `unittest` pulls in
the stdlib `dataclasses` module, which does `import inspect` internally. `scripts/` is first
on `sys.path` when a script under it runs, so that internal stdlib import resolved to a file
here named `inspect.py` instead of the real stdlib module — and this module in turn does
`import rm_common`, which does `from dataclasses import dataclass` while `dataclasses` was
still mid-initialization, raising `ImportError: cannot import name 'dataclass' from partially
initialized module 'dataclasses' (most likely due to a circular import)`. Confirmed by running
the test suite with the file named `inspect.py`; renamed to `inspect_project.py` to avoid the
stdlib name collision entirely. NOTE: SKILL.md's workflow step still references
`scripts/inspect.py` — needs updating to `scripts/inspect_project.py` (out of this task's file
scope; flagged for a follow-up).

Ruling 1 (controller): every fixture module pom has a <parent> block. `rm_common.pom_text`
does a descendant search and returns the PARENT's artifactId first (e.g. "aem-guides-wknd"
for `it.tests`, which carries no test marker) — using it here would misclassify test bundles
as plain bundles. `rm_common.pom_coord` reads a project's OWN top-level coordinate (direct
child of <project>, skipping <parent>) and MUST be used for artifactId in both
`classify_module` (the is_test_artifact check) and `derive_app_id` (the reactor-artifactId
fallback). `packaging` is never nested inside <parent>, so `pom_text` remains safe for it.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import rm_common as C

_TEST_MARKERS = (".it", "-it", ".test", "-test", ".launcher", "-launcher")


def is_test_artifact(artifact_id: str) -> bool:
    a = (artifact_id or "").lower()
    return any(m in a for m in _TEST_MARKERS)


def classify_module(module_dir) -> str:
    module_dir = Path(module_dir)
    pom = module_dir / "pom.xml"
    if not pom.exists():
        return "misc"
    packaging = C.pom_text(pom, "packaging") or "jar"
    # Ruling 1: own artifactId (pom_coord), NOT the parent's (pom_text would find <parent><artifactId> first).
    artifact = C.pom_coord(pom, "artifactId") or module_dir.name
    if packaging == "pom":
        return "reactor"
    if packaging in ("bundle", "jar"):
        if not (module_dir / "src").exists():
            return "wrapper"
        return "test-bundle" if is_test_artifact(artifact) else "bundle"
    if packaging == "content-package":
        return "content-package"
    return "misc"


def derive_app_id(project_root) -> str:
    root = Path(project_root)
    all_pom = root / "all" / "pom.xml"
    for tgt in (C.pom_all_text(all_pom, "target") if all_pom.exists() else []):
        m = re.search(r"/apps/([^/]+?)-packages/", tgt) or re.search(r"/apps/([^/]+)/", tgt)
        if m:
            return m.group(1)
    # Ruling 1: reactor artifactId fallback must also be the pom's OWN artifactId, not the parent's.
    root_pom = root / "pom.xml"
    if root_pom.exists():
        own = C.pom_coord(root_pom, "artifactId")
        if own:
            return own
    return root.name


def _is_reactor_dir(d) -> bool:
    """True iff directory `d` is a Maven reactor: has a `pom.xml` with
    `packaging=pom`."""
    pom = Path(d) / "pom.xml"
    return pom.exists() and (C.pom_text(pom, "packaging") == "pom")


def _is_subproject_dir(d) -> bool:
    """True iff `d` is a nested PROJECT (a reactor that declares its OWN
    `<module>`s), not merely a bare `pom`-packaged module. This is the
    distinction that keeps a config/aggregator module like `dispatcher`
    (`packaging=pom`, zero modules) from being mistaken for a sub-project — only
    a real nested multi-module project (`globex`, `globex-agriscience`, or a
    SINGLE-shaped child) counts."""
    return _is_reactor_dir(d) and len(_declared_module_dirs(d)) > 0


def _candidate_unit_names(root, has_reactor) -> list:
    """The child names to consider as potential sub-projects: for a reactor root,
    its declared `<module>`s (Maven-authoritative); for a non-reactor root (MULTI),
    every immediate child directory that has its own `pom.xml`."""
    root = Path(root)
    if has_reactor:
        return _declared_module_dirs(root)
    return [p.name for p in sorted(root.iterdir())
            if p.is_dir() and (p / "pom.xml").exists()]


def _subproject_dirs(root, has_reactor) -> list:
    """Immediate child modules/dirs that are themselves nested PROJECTS
    (`_is_subproject_dir`: a reactor with its own modules). This is what
    distinguishes NESTED/MULTI/MONOLITHIC (which HAVE sub-projects) from SINGLE
    (whose own modules are bundles/content packages, never nested reactors) — and
    a bare `pom` module like `dispatcher` is correctly NOT counted."""
    out = []
    for name in _candidate_unit_names(root, has_reactor):
        sub = Path(root) / name
        if _is_subproject_dir(sub):
            out.append(name)
    return out


def detect_shape(project_root, modules) -> str:
    """Classify the project into one of CAM's four shapes
    (`cam-repo-modernizer-analysis.md` §4):

    - **SINGLE** — reactor + its own bundle/content modules, NO sub-projects.
    - **NESTED** — reactor, NO own bundle/content, but HAS sub-projects.
    - **MONOLITHIC** — reactor + own bundle/content AND sub-projects.
    - **MULTI** — no reactor pom at the root, but HAS sub-projects (independent
      projects sitting side by side).

    A "sub-project" is a child module/dir that is itself a reactor
    (`_subproject_dirs`); "own code" is a direct bundle/content-package module."""
    root = Path(project_root)
    has_reactor = _is_reactor_dir(root)
    kinds = set(modules.values())
    has_own_code = ("bundle" in kinds) or ("content-package" in kinds)
    has_subs = len(_subproject_dirs(root, has_reactor)) > 0

    if has_reactor and has_own_code:
        return "MONOLITHIC" if has_subs else "SINGLE"
    if has_reactor:
        return "NESTED"          # reactor, no own code (sub-projects present or an empty aggregator)
    return "MULTI"               # no reactor pom at root


# Directory names a modernized Cloud Service project has that a legacy (pre-restructure)
# one does not -- their joint presence in a sub-project means it is ALREADY restructured
# and should be SKIPPED, not re-run through the pipeline.
_MODERN_MODULE_DIRS = {"all", "ui.apps.structure", "ui.config"}


def _declared_module_dirs(reactor_root) -> list:
    """The `<module>` directory names declared in `reactor_root/pom.xml` (following
    Maven's own module refs, in document order, deduped). `[]` if the pom is absent
    or declares none."""
    root = Path(reactor_root)
    pom = root / "pom.xml"
    if not pom.exists():
        return []
    seen, out = set(), []
    for m in ET.parse(str(pom)).getroot().iter():
        if _localname(m.tag) == "module" and (m.text or "").strip():
            name = m.text.strip().strip("/")
            if name not in seen:
                seen.add(name)
                out.append(name)
    return out


def subproject_status(subproject_root) -> str:
    """Classify one NESTED sub-project by what the modernizer would need to do to it:

    - `"legacy"`  — has its own code (a bundle or content package) but lacks the modern
                    Cloud module set (`all`/`ui.apps.structure`/`ui.config`): a real
                    SINGLE-shaped modernization target — run the pipeline on it.
    - `"modern"`  — already carries the modern Cloud module set: already restructured,
                    skip it (e.g. globex's `globex-agriscience` sub-project).
    - `"empty"`   — neither: a pure aggregator / non-code module, nothing to do.

    Classifies the sub-project's OWN immediate child modules (the same enumeration
    `build_config` uses), so it is robust to a sub-reactor that lists modules the
    pipeline would target."""
    root = Path(subproject_root)
    mod_dirs = {p.name for p in root.iterdir() if (p / "pom.xml").exists()}
    kinds = {classify_module(root / n) for n in mod_dirs}
    has_code = ("bundle" in kinds) or ("content-package" in kinds)
    if _MODERN_MODULE_DIRS.issubset(mod_dirs):
        return "modern"
    return "legacy" if has_code else "empty"


def discover_subprojects(project_root) -> list:
    """For a reactor root (NESTED/MONOLITHIC), enumerate each sub-project (a declared
    `<module>` that is itself a `pom`-packaged sub-reactor) with its
    `subproject_status`. Returns `[{"path", "status"}]` in the reactor's own module
    order. For a MULTI root (no reactor pom), enumerate every immediate child dir that
    is itself a project. See `discover_units` for the shape-aware modernization plan."""
    root = Path(project_root)
    has_reactor = _is_reactor_dir(root)
    out = []
    for name in _candidate_unit_names(root, has_reactor):
        sub = root / name
        if not (sub / "pom.xml").exists():
            continue
        if not _is_subproject_dir(sub):
            continue  # only nested projects (reactors with modules) are sub-projects
        out.append({"path": name, "status": subproject_status(sub)})
    return out


def discover_units(project_root) -> dict:
    """Shape-aware modernization plan: the list of directories the SINGLE pipeline
    must run on, for ANY project shape (Phase-3 orchestration input).

    Returns `{"shape", "root", "units"}` where `units` is a list of
    `{"path", "status"}` (path RELATIVE to `project_root`, `"."` for the root
    itself). A unit's `status` is `subproject_status`' verdict (`legacy` = needs
    modernization, `modern` = already restructured, `empty` = nothing to do); the
    orchestrator runs the pipeline only on `legacy` units.

    - **SINGLE** — one unit: the root (`"."`).
    - **NESTED** — the root has no own code; units are its sub-projects.
    - **MONOLITHIC** — the root itself (as a SINGLE unit) PLUS its sub-projects.
    - **MULTI** — no root reactor; units are the child projects.
    """
    root = Path(project_root)
    has_reactor = _is_reactor_dir(root)
    mods = {p.name: classify_module(p) for p in sorted(root.iterdir()) if (p / "pom.xml").exists()}
    shape = detect_shape(root, mods)

    units = []
    if shape == "SINGLE":
        units.append({"path": ".", "status": "legacy"})
    elif shape == "MONOLITHIC":
        units.append({"path": ".", "status": "legacy"})   # root's own code, treated as SINGLE
        units.extend(discover_subprojects(root))
    else:                                                  # NESTED or MULTI
        units.extend(discover_subprojects(root))
    return {"shape": shape, "root": str(root), "units": units}


# Ruling 2 (controller, SUPERSEDES the plan's ADOBE_PREFIXES + scan scope): groupIds the
# customer never has to migrate off of — AEM/Sling/Felix/OSGi/Jackrabbit platform APIs, not
# third-party libraries the customer pulled in themselves. NOTE the org.apache nuance: only
# these three org.apache.* sub-trees are provided; any OTHER org.apache.* groupId (e.g.
# org.apache.poi) is a genuine third-party dependency and must still be flagged RM-101 — this
# is the corrected CAM blind spot the ruling calls out (a blanket "org.apache" prefix would
# have hidden it).
PROVIDED_PREFIXES = (
    "com.adobe", "com.day", "org.osgi", "javax", "jakarta",
    "org.slf4j", "org.apache.felix", "org.apache.sling",
    "org.apache.jackrabbit", "biz.aQute",
)

# Known test-only library groupIds. The fixture's core/bundle2 poms declare junit,
# junit-addons, and mockito with no explicit <scope> at all — scope-sniffing alone would not
# exclude them — so Ruling 2 excludes them by groupId regardless of declared scope.
TEST_LIB_GROUPS = {"junit", "junit-addons", "org.mockito", "org.hamcrest", "org.junit", "org.testng"}


def _localname(tag: str) -> str:
    return tag.split("}", 1)[-1]


# Skill-original finding code (references/transform-rules.md §12; RM-901..RM-904 are
# already taken by convert_osgi.py / refactor_poms.py — this is the next free RM-9xx
# number). Raised by find_oak_index_filter_gaps below.
OAK_INDEX_FILTER_GAP_FINDING_CODE = "RM-905"


def find_oak_index_filter_gaps(project_root, config: dict) -> list:
    """RM-905 (references/transform-rules.md §12, manual-followups.md §7): detect a
    PRE-EXISTING customer-data inconsistency between a source content package's
    `_oak_index/.content.xml` (the on-disk `/oak:index` content, §1) and that same
    package's `filter.xml`.

    `split_filters` (split_content.py) faithfully COPIES a source package's declared
    filter roots — it does not enumerate the content that will land under them — so if
    the legacy project itself never declared a filter root for one of its own
    `oak:QueryIndexDefinition` nodes, that gap survives the mechanical restructuring
    unchanged and lands in the modernized `ui.apps`. The legacy `content-package-maven-
    plugin` never validated this; FileVault's `jackrabbit-filter` validator DOES, once
    the (correctly, immutably routed) index content reaches `ui.apps`
    (`ValidationViolation: Node '/oak:index/<name>' is not contained in any of the
    filter rules`, severity ERROR — reproduced against the real wknd fixture).

    RULING (manual-followups.md §7, authoritative): this is the customer's own
    pre-existing content/filter authoring gap, not a transform defect — the reference
    CAM tool copies filters verbatim too, so it would propagate the identical gap.
    Inventing the missing filter root would make a content-deployment decision on the
    developer's behalf, which this skill must not do. So: detect and report only, via
    this HIGH finding — never auto-add the filter root here or anywhere else in the
    pipeline.

    Read-only, namespace-agnostic (`.content.xml` mixes `jcr:`/`oak:` prefixes freely —
    ElementTree resolves an attribute NAME like `jcr:primaryType` to Clark notation
    `{ns}primaryType` when the document declares the `jcr` namespace, but leaves an
    attribute VALUE like `oak:QueryIndexDefinition` as a literal colon-separated
    string — the two need different prefix-stripping, hence the two helpers below
    instead of reusing `_localname` for both)."""

    def _value_localname(value: str) -> str:
        return value.rsplit(":", 1)[-1] if value else value

    root = Path(project_root)
    out = []
    for cpkg in config.get("contentPackages", []):
        content_xml = root / cpkg.get("jcrRoot", "") / "_oak_index" / ".content.xml"
        if not content_xml.exists():
            continue
        try:
            index_root = ET.parse(str(content_xml)).getroot()
        except ET.ParseError:
            continue

        index_nodes = []
        for child in index_root:
            if not isinstance(child.tag, str):
                continue
            is_index_def = any(
                _localname(k) == "primaryType" and _value_localname(v) == "QueryIndexDefinition"
                for k, v in child.attrib.items()
            )
            if is_index_def:
                index_nodes.append(_localname(child.tag))
        if not index_nodes:
            continue

        covered = set()
        covers_all = False
        fx = root / cpkg["filterXml"]
        if fx.exists():
            for e in ET.parse(str(fx)).iter():
                if _localname(e.tag) != "filter":
                    continue
                r = e.attrib.get("root", "")
                # A broad ancestor root of exactly "/oak:index" (or its trailing-slash
                # spelling "/oak:index/") is a FileVault filter for the whole
                # /oak:index subtree -- it covers every index node, not just one named
                # by a "/oak:index/<name>" segment below it (the specific-match branch
                # right below).
                if r.rstrip("/") == "/oak:index":
                    covers_all = True
                elif r.startswith("/oak:index/"):
                    covered.add(r[len("/oak:index/"):])

        for name in index_nodes:
            if covers_all or name in covered:
                continue
            out.append(C.Finding(
                OAK_INDEX_FILTER_GAP_FINDING_CODE, "HIGH",
                f"oak:index '{name}' is defined in content "
                f"({cpkg['jcrRoot']}/_oak_index/.content.xml) but no filter root "
                f"declares /oak:index/{name}; FileVault will reject the ui.apps package. "
                f"Add <filter root=\"/oak:index/{name}\"/> (and review AEMaaCS "
                f"custom-index naming, e.g. the -custom-N convention) before building."
            ))
    return out


def _iter_pom_dependencies(pom_path):
    """Yield (groupId, artifactId, scope) for every <dependency> element in a POM."""
    for dep in ET.parse(str(pom_path)).iter():
        if _localname(dep.tag) != "dependency":
            continue
        g = next((c.text for c in dep if _localname(c.tag) == "groupId"), None) or ""
        a = next((c.text for c in dep if _localname(c.tag) == "artifactId"), None) or ""
        s = next((c.text for c in dep if _localname(c.tag) == "scope"), None) or ""
        yield g.strip(), a.strip(), s.strip()


def _is_third_party(group_id: str, artifact_id: str, scope: str, own_group: str) -> bool:
    """Ruling 2's exact test for a genuine third-party (RM-101) dependency: NOT test/provided
    scope, NOT the customer's own groupId, NOT a PROVIDED-prefix platform groupId, NOT a known
    test-lib groupId, and not the uber-jar artifact."""
    if scope in ("test", "provided"):
        return False
    if not group_id or (own_group and group_id.startswith(own_group)):
        return False
    if any(group_id.startswith(p) for p in PROVIDED_PREFIXES):
        return False
    if group_id in TEST_LIB_GROUPS:
        return False
    if artifact_id == "uber-jar":
        return False
    return True


def build_config(project_root) -> dict:
    root = Path(project_root)
    mods = {p.name: classify_module(p) for p in sorted(root.iterdir()) if (p / "pom.xml").exists()}
    bundles = [{"path": n, "artifactIdSuffix": n, "isTest": False} for n, k in mods.items() if k == "bundle"]
    test_bundles = [{"path": n} for n, k in mods.items() if k == "test-bundle"]
    # Container exclusion (controller ruling, CAM §8): a content-package module whose
    # FileVault <packageType> is "container" is the `all` aggregator, not a source content
    # package to split — exclude it from contentPackages. On the fixture `all` is the only
    # such module (and has no jcr_root/filter.xml anyway), so this is clean-semantics today
    # and a defensive guard against any future aggregator-shaped module.
    content = [
        {"path": n, "jcrRoot": f"{n}/src/main/content/jcr_root",
         "filterXml": f"{n}/src/main/content/META-INF/vault/filter.xml"}
        for n, k in mods.items()
        if k == "content-package" and C.pom_text(root / n / "pom.xml", "packageType") != "container"
    ]
    root_pom = root / "pom.xml"
    app_id = derive_app_id(root)
    return {
        "schemaVersion": 1,
        "projectShape": detect_shape(root, mods),
        # Ruling 1: a project's own coordinates come from pom_coord (parent-safe: artifactId
        # never inherits; groupId/version fall back to <parent>), NOT pom_text — pom_text's
        # descendant search can return a <parent> child's value instead of the project's own.
        "groupId": C.pom_coord(root_pom, "groupId") or "",
        "artifactId": C.pom_coord(root_pom, "artifactId") or root.name,
        "appId": app_id,
        "appTitle": C.pom_coord(root_pom, "name") or app_id,
        "version": C.pom_coord(root_pom, "version") or "1.0.0-SNAPSHOT",
        "targetModules": {"all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
                          "uiConfig": "ui.config", "uiContent": "ui.content"},
        "bundles": bundles, "testBundles": test_bundles,
        "contentPackages": content, "runModeDecisions": {},
    }


def capture_inventory(project_root) -> dict:
    root = Path(project_root)
    captured_at = (datetime.datetime.now(datetime.timezone.utc)
                   .replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    files = [{"path": str(p.relative_to(root)), "sha256": C.sha256_file(p)} for p in C.iter_files(root)]
    return {"capturedAt": captured_at, "files": files}


def scan_findings(project_root, config) -> list:
    root = Path(project_root)
    own_group = config.get("groupId") or ""
    out = []

    # Ruling 2 scan scope: each bundle + the ui.apps content package + the SOURCE `all`
    # container module. Inspect runs pre-scaffold, so root/"all"/pom.xml is the customer's
    # existing aggregator (excluded from contentPackages above, but not from scanning — on
    # the fixture it's the one place holding a genuine third-party dependency+embed:
    # net.engio:mbassador).
    scan_mods = [b["path"] for b in config["bundles"]]
    ui_apps_mod = config["targetModules"]["uiApps"]
    scan_mods += [c["path"] for c in config["contentPackages"] if c["path"] == ui_apps_mod]
    all_mod = config.get("targetModules", {}).get("all")
    if all_mod:
        scan_mods.append(all_mod)

    for mod in scan_mods:
        pom = root / mod / "pom.xml"
        if not pom.exists():
            continue
        for g, a, scope in _iter_pom_dependencies(pom):
            if _is_third_party(g, a, scope, own_group):
                out.append(C.Finding("RM-101", "CRITICAL", f"third-party dependency {g}:{a} in {mod}"))

    # RM-107: any content package filter rooted under /libs — legacy /libs overlays are
    # unsupported content structure on Cloud Service (immutable, not author-deployable).
    for cpkg in config["contentPackages"]:
        fx = root / cpkg["filterXml"]
        if not fx.exists():
            continue
        for e in ET.parse(str(fx)).iter():
            if _localname(e.tag) == "filter" and e.attrib.get("root", "").startswith("/libs"):
                out.append(C.Finding("RM-107", "CRITICAL",
                    f"content under /libs ({e.attrib['root']}) in {cpkg['path']} — moved to ui.apps but review"))

    # RM-905: oak:index filter/content coverage gap (see find_oak_index_filter_gaps'
    # own docstring + references/manual-followups.md §7) — a pre-existing customer-data
    # inconsistency this skill detects and reports, never auto-resolves.
    out.extend(find_oak_index_filter_gaps(root, config))

    return C.dedup_findings(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="repo-modernize inspection (read-only)")
    ap.add_argument("root")
    ap.add_argument("--no-version-check", action="store_true",
                    help="skip the best-effort 'newer archetype/SDK available' notice")
    a = ap.parse_args(argv)
    root = Path(a.root)

    # Best-effort staleness notice: tell the developer up front if the skill's pinned
    # archetype/SDK is behind Maven Central's latest, so a run is never SILENTLY on a
    # stale archetype. Offline-safe (skips silently on no network / timeout) and never
    # blocks the run. Disabled by --no-version-check, the REPO_MODERNIZE_NO_VERSION_CHECK
    # env var, or when running under pytest (so the test suite stays offline/fast).
    import os as _os
    _skip_vc = (a.no_version_check
                or _os.environ.get("REPO_MODERNIZE_NO_VERSION_CHECK")
                or "PYTEST_CURRENT_TEST" in _os.environ)
    if not _skip_vc:
        try:
            import archetype as _arch
            _note = _arch.staleness_note()
            if _note:
                print(f"repo-modernize: {_note}")
        except Exception:
            pass

    # MULTI shape: a root with NO reactor pom but WITH child projects (independent
    # projects side by side). There is no root config to build -- emit the unit plan
    # so the orchestrator can run the pipeline on each child project.
    if not (root / "pom.xml").exists():
        plan = discover_units(a.root)
        if plan["units"]:
            C.save_json(C.manifest_path(a.root, "units.json"), plan)
            legacy = [u["path"] for u in plan["units"] if u["status"] == "legacy"]
            print(f"inspected {a.root}: shape={plan['shape']} "
                  f"unit(s)={len(plan['units'])} legacy={legacy or '[]'}")
            for p in legacy:
                print(f"  -> run the pipeline on unit: {a.root.rstrip('/')}/{p}")
            return 0
        print(f"error: no root pom.xml at {a.root} and no sub-projects found -- "
              "repo-modernize needs a Maven reactor (a project root pom) or a folder of "
              "AEM projects. If this is a single bare module, wrap it in a reactor first.",
              file=sys.stderr)
        return 2

    cfg = build_config(a.root)
    findings = scan_findings(a.root, cfg)
    C.save_json(C.manifest_path(a.root, "config.json"), cfg)
    C.save_json(C.manifest_path(a.root, "inventory.json"), capture_inventory(a.root))
    C.save_json(C.manifest_path(a.root, "findings.json"), {"findings": [f.__dict__ for f in findings]})
    print(f"inspected {a.root}: shape={cfg['projectShape']} appId={cfg['appId']} "
          f"bundles={len(cfg['bundles'])} content={len(cfg['contentPackages'])} findings={len(findings)}")

    # NESTED / MONOLITHIC (Phase 3): the project has sub-projects that each need their
    # own SINGLE pipeline run. Emit the unit plan (`units.json` + the legacy
    # `subprojects.json` for back-compat) so the orchestrator (or a developer) knows
    # which units are legacy modernization targets vs already-restructured. For a
    # MONOLITHIC root the root itself is ALSO a unit (its own code is modernized in
    # place, like a SINGLE project) alongside its sub-projects.
    if cfg["projectShape"] in ("NESTED", "MONOLITHIC"):
        plan = discover_units(a.root)
        C.save_json(C.manifest_path(a.root, "units.json"), plan)
        subs = discover_subprojects(a.root)
        C.save_json(C.manifest_path(a.root, "subprojects.json"), {"subprojects": subs})
        legacy = [u["path"] for u in plan["units"] if u["status"] == "legacy"]
        modern = [u["path"] for u in plan["units"] if u["status"] == "modern"]
        print(f"  {cfg['projectShape']}: {len(plan['units'])} unit(s) -- "
              f"legacy(needs modernization)={legacy or '[]'} "
              f"already-modern={modern or '[]'}")
        for path in legacy:
            shown = a.root.rstrip('/') if path == '.' else f"{a.root.rstrip('/')}/{path}"
            print(f"  -> run the pipeline on unit: {shown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
