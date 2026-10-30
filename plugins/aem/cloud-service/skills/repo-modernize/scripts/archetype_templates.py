#!/usr/bin/env python3
"""Module POM templates from an AEM project archetype.

The skill scaffolds the Cloud Service modules a project is missing (`all`,
`ui.apps.structure`, `ui.config`, ...) from POM templates, and copies the FileVault
configuration of the `ui.apps` / `ui.content` templates into the project's existing
modules. This module produces those templates from an archetype in three steps:

  generate    `mvn archetype:generate` a throwaway project with sentinel coordinates;
  templatize  swap the sentinels for {{placeholders}} and drop the archetype's sample
              `core` bundle (the project's own bundles are embedded instead);
  validate    check the result has every shape the transforms rely on, so a template
              set that would break the restructuring is rejected before anything changes.

Used by `refresh_archetype.py` (a maintainer regenerates the bundled templates) and
by `orchestrate.py --apply --archetype ...` (the customer's own archetype, at run time).
Generating needs Maven, and network access unless the archetype is already in the local
Maven repository; templatize and validate are pure functions. Standard library only.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

ADOBE_ARCHETYPE = ("com.adobe.aem", "aem-project-archetype")
ARCHETYPE_PLUGIN = "org.apache.maven.plugins:maven-archetype-plugin:3.3.1"
POM_FILES = ("pom.xml", "all/pom.xml", "ui.apps/pom.xml", "ui.apps.structure/pom.xml",
             "ui.config/pom.xml", "ui.content/pom.xml")
MODULE_FILES = POM_FILES[1:]
# The `all` package's workspace filter (/apps/<appId>-packages, where it installs the
# embedded packages): without it the module doesn't build ("No workspace filter defined").
ALL_FILTER = "all/src/main/content/META-INF/vault/filter.xml"
TEMPLATE_FILES = POM_FILES + (ALL_FILTER,)
PLACEHOLDERS = ("groupId", "artifactId", "appId", "appTitle", "version")

# (archetype property, sentinel, placeholder), replaced in this order. Every sentinel is
# unique and never part of another, so the swap is exact.
_SENTINELS = (
    ("version", "7.7.7-ZQVERSION", "{{version}}"),
    ("artifactId", "zqartifactid", "{{artifactId}}"),
    ("groupId", "zqgroupid", "{{groupId}}"),
    ("appId", "zqappid", "{{appId}}"),
    ("appTitle", "ZqAppTitle", "{{appTitle}}"),
    ("package", "zqpackage", None),
)
_GENERATED_DIR = "zqartifactid"
# The variant the skill needs: AEM as a Cloud Service, no front-end module (ui.apps would
# depend on it), no Dispatcher module, no sample content. Other options keep their defaults.
_GENERATE_OPTIONS = (("aemVersion", "cloud"), ("frontendModule", "none"),
                     ("includeDispatcherConfig", "n"), ("includeExamples", "n"))
_SAMPLE_BUNDLE = "{{artifactId}}.core"
_FILEVAULT = "filevault-package-maven-plugin"
_NS = "{http://maven.apache.org/POM/4.0.0}"
_PACKAGE_TYPES = {"all/pom.xml": "container", "ui.apps/pom.xml": "application",
                  "ui.config/pom.xml": "container", "ui.content/pom.xml": "content"}
_EMBED_TARGETS = (("ui.apps", "application"), ("ui.config", "application"),
                  ("ui.content", "content"))
# Plugins a module template may declare without a version: refactor_poms manages these in
# the project's reactor, or Maven's defaults / the legacy reactor already do.
_UNVERSIONED_OK = {"filevault-package-maven-plugin", "content-package-maven-plugin",
                   "aemanalyser-maven-plugin", "maven-clean-plugin", "htl-maven-plugin"}
# Properties a module template may use outside <profiles>: Maven's own, and the ones
# refactor_poms seeds into the project's reactor.
_SEEDED_PROPERTIES = {"aem.sdk.api", "aemanalyser.version"}
_BUILTIN_PROPERTY = re.compile(r"(project|maven|env|settings|session)\..+|basedir")
_TOKEN = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*")
_BLOCK = re.compile(r"[ \t]*<(dependency|embedded)>(?:(?!</\1>).)*?</\1>[ \t]*(?:\r?\n)?", re.S)
_MAVEN_BOILERPLATE = re.compile(r"^\[ERROR\]\s*$|To see the full stack trace|Re-run Maven using|"
                                r"For more information about the errors|^\[ERROR\]\s*\[Help \d+\]")
_HELP_SUFFIX = re.compile(r"\s*-> \[Help \d+\]\s*$")


class ArchetypeError(Exception):
    """Templates could not be produced, or do not fit; the message says what to do."""


class TemplatesDoNotFit(ArchetypeError):
    """The archetype was generated, but its templates lack shapes the transforms rely on."""


def parse_spec(spec: str, resolve_latest: Optional[Callable[[], Optional[str]]] = None
               ) -> Tuple[str, str, str]:
    """`latest`, a version of Adobe's archetype (`58`), or `groupId:artifactId:version`."""
    spec = (spec or "").strip()
    if spec == "latest":
        if resolve_latest is None:
            import archetype as A
            resolve_latest = A.resolve_latest_archetype
        version = resolve_latest()
        if not version:
            raise ArchetypeError("could not reach Maven Central to find the latest AEM project "
                                 "archetype; name a version instead (e.g. --archetype 58)")
        return (*ADOBE_ARCHETYPE, version)
    parts = spec.split(":")
    if len(parts) == 1 and re.fullmatch(r"\d+(\.\d+)*", spec):
        return (*ADOBE_ARCHETYPE, spec)
    if len(parts) == 3 and all(_TOKEN.fullmatch(p) for p in parts):
        return tuple(parts)  # type: ignore[return-value]
    raise ArchetypeError(f"unrecognized archetype {spec!r}: use 'latest', a version of Adobe's "
                         "AEM project archetype (e.g. 58), or groupId:artifactId:version")


def generate(coords: Tuple[str, str, str], workdir, sdk_version: str, offline: bool = False,
             mvn: Optional[str] = None, run=subprocess.run, timeout: float = 900) -> Path:
    """Generate a throwaway project from `coords` in `workdir`; returns its directory."""
    if not _TOKEN.fullmatch(sdk_version or ""):
        raise ArchetypeError(f"invalid AEM SDK version {sdk_version!r}")
    mvn = mvn or shutil.which("mvn")
    if not mvn:
        raise ArchetypeError("Maven (mvn) is needed to generate templates from an archetype. "
                             "Install Maven, or use the bundled templates.")
    group, artifact, version = coords
    workdir = Path(workdir)
    out = workdir / _GENERATED_DIR
    if out.exists():
        shutil.rmtree(out)
    argv = [mvn, "-B", "-q"] + (["-o"] if offline else []) + [
        f"{ARCHETYPE_PLUGIN}:generate", f"-DarchetypeGroupId={group}",
        f"-DarchetypeArtifactId={artifact}", f"-DarchetypeVersion={version}"]
    argv += [f"-D{prop}={sentinel}" for prop, sentinel, _ in _SENTINELS]
    argv += [f"-D{k}={v}" for k, v in _GENERATE_OPTIONS] + [f"-DsdkVersion={sdk_version}"]
    try:
        proc = run(argv, cwd=str(workdir), capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ArchetypeError(f"could not run Maven to generate {':'.join(coords)}: {e}") from e
    if proc.returncode != 0 or not (out / "pom.xml").is_file():
        lines = [_HELP_SUFFIX.sub("", l) for l in ((proc.stdout or "") + (proc.stderr or "")).splitlines()
                 if l.strip() and not _MAVEN_BOILERPLATE.search(l)]
        tail = "\n".join("    " + l for l in lines[-12:])
        raise ArchetypeError(f"could not generate a project from archetype {':'.join(coords)} "
                             f"(mvn exit {proc.returncode})" + (f":\n{tail}" if tail else ""))
    return out


def _drop_sample_bundle(text: str) -> str:
    """Remove the <dependency>/<embedded> blocks for the archetype's sample `core` bundle."""
    marker = f"<artifactId>{_SAMPLE_BUNDLE}</artifactId>"
    return _BLOCK.sub(lambda m: "" if marker in m.group(0) else m.group(0), text)


def templatize(project_dir) -> Dict[str, str]:
    """The templates (relative path -> text) from a project `generate` produced."""
    root = Path(project_dir)
    out: Dict[str, str] = {}
    for rel in TEMPLATE_FILES:
        path = root / rel
        if not path.is_file():
            raise TemplatesDoNotFit(f"the archetype did not produce {rel}")
        text = path.read_text(encoding="utf-8")
        for _prop, sentinel, placeholder in _SENTINELS:
            if placeholder:
                text = text.replace(sentinel, placeholder)
        leftover = [l.strip() for l in text.splitlines() if "zq" in l.lower()]
        if leftover:
            raise TemplatesDoNotFit(f"{rel}: holds a value derived from the project coordinates "
                                    f"that the templates cannot express: {leftover[:3]}")
        out[rel] = _drop_sample_bundle(text) if rel in MODULE_FILES else text
    return out


def _child(el, name: str):
    return el.find(_NS + name) if el is not None else None


def _text(el, name: str) -> Optional[str]:
    c = _child(el, name)
    return c.text.strip() if c is not None and c.text and c.text.strip() else None


def _without_profiles(root):
    profiles = _child(root, "profiles")
    if profiles is not None:
        root.remove(profiles)
    return root


def _filevault_configuration(root):
    build = _child(root, "build")
    if build is None:
        return None
    for plugin in build.iter(_NS + "plugin"):
        if _text(plugin, "artifactId") == _FILEVAULT and _child(plugin, "configuration") is not None:
            return _child(plugin, "configuration")
    return None


def _configuration_follows_plugin(text: str) -> bool:
    """refactor_poms copies the first <configuration> after the FileVault <artifactId>;
    it must belong to that plugin."""
    anchor = text.find(f"<artifactId>{_FILEVAULT}</artifactId>")
    if anchor < 0:
        return False
    cfg, end = text.find("<configuration>", anchor), text.find("</plugin>", anchor)
    return 0 <= cfg < end


def pins(reactor_text: str) -> Dict[str, Optional[str]]:
    """The versions the reactor template pins (None when absent)."""
    root = ET.fromstring(reactor_text.encode("utf-8"))
    props = _child(root, "properties")

    def managed(artifact: str) -> Optional[str]:
        for plugin in root.iter(_NS + "plugin"):
            version = _text(plugin, "version")
            if _text(plugin, "artifactId") == artifact and version and "${" not in version:
                return version
        return None

    return {"aem.sdk.api": _text(props, "aem.sdk.api"),
            "aemanalyser.version": _text(props, "aemanalyser.version"),
            "filevault": managed(_FILEVAULT),
            "content-package": managed("content-package-maven-plugin")}


def validate(templates: Dict[str, str]) -> List[str]:
    """Everything the transforms rely on that these templates lack (empty = they fit)."""
    problems: List[str] = []
    trees = {}
    for rel in TEMPLATE_FILES:
        text = templates.get(rel)
        if text is None:
            problems.append(f"{rel}: missing")
            continue
        try:
            trees[rel] = ET.fromstring(text.encode("utf-8"))
        except ET.ParseError as e:
            problems.append(f"{rel}: not well-formed XML ({e})")
            continue
        unknown = sorted(set(re.findall(r"\{\{(\w+)\}\}", text)) - set(PLACEHOLDERS))
        if unknown:
            problems.append(f"{rel}: unknown placeholder(s) {unknown}")
        if "<artifactId>uber-jar</artifactId>" in text:
            problems.append(f"{rel}: uses uber-jar, so it is not an AEM as a Cloud Service "
                            "archetype")

    for rel in MODULE_FILES:
        root = trees.get(rel)
        if root is None:
            continue
        text = templates[rel]
        if _SAMPLE_BUNDLE in text:
            problems.append(f"{rel}: still references the archetype's sample bundle "
                            f"{_SAMPLE_BUNDLE}")
        cfg = _filevault_configuration(root)
        if cfg is None or not _configuration_follows_plugin(text):
            problems.append(f"{rel}: no {_FILEVAULT} <configuration>")
            continue
        want = _PACKAGE_TYPES.get(rel)
        if want and _text(cfg, "packageType") != want:
            problems.append(f"{rel}: packageType is {_text(cfg, 'packageType')!r}, "
                            f"expected {want!r}")
        if rel != "all/pom.xml" and _text(_child(cfg, "properties"), "cloudManagerTarget") != "none":
            problems.append(f"{rel}: FileVault <properties> lacks cloudManagerTarget=none")
        main_build = _without_profiles(ET.fromstring(text.encode("utf-8")))
        for plugin in main_build.iter(_NS + "plugin"):
            name = _text(plugin, "artifactId")
            if _text(plugin, "version") is None and name not in _UNVERSIONED_OK:
                problems.append(f"{rel}: plugin {name} has no version and repo-modernize "
                                "does not manage it")
        used = set(re.findall(r"\$\{([^}]+)\}", ET.tostring(main_build, encoding="unicode")))
        for prop in sorted(used - _SEEDED_PROPERTIES):
            if not _BUILTIN_PROPERTY.fullmatch(prop):
                problems.append(f"{rel}: uses property ${{{prop}}}, which repo-modernize does "
                                "not set in the project's reactor")

    structure = trees.get("ui.apps.structure/pom.xml")
    cfg = _filevault_configuration(structure) if structure is not None else None
    if cfg is not None and _child(cfg, "filters") is None:
        problems.append("ui.apps.structure/pom.xml: no <filters> in the FileVault configuration")

    all_pom = trees.get("all/pom.xml")
    if all_pom is not None:
        targets = {_text(e, "artifactId"): _text(e, "target") for e in all_pom.iter(_NS + "embedded")}
        for module, kind in _EMBED_TARGETS:
            want = f"/apps/{{{{appId}}}}-packages/{kind}/install"
            got = targets.get(f"{{{{artifactId}}}}.{module}")
            if got != want:
                problems.append(f"all/pom.xml: {module} should be embedded at {want}, found {got!r}")

    all_filter = trees.get(ALL_FILTER)
    if all_filter is not None:
        roots = {e.attrib.get("root") for e in all_filter.iter() if e.tag.split("}")[-1] == "filter"}
        if "/apps/{{appId}}-packages" not in roots:
            problems.append(f"{ALL_FILTER}: no filter root /apps/{{{{appId}}}}-packages for the "
                            "embedded packages")

    if trees.get("pom.xml") is not None:
        for name, value in pins(templates["pom.xml"]).items():
            if not value:
                problems.append(f"pom.xml: no pinned {name} version")
    return problems


def write(templates: Dict[str, str], dest) -> None:
    """Write the templates under `dest`, keeping their line endings."""
    for rel, text in templates.items():
        path = Path(dest) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)


def build(spec: str, workdir, sdk_version: str, mvn: Optional[str] = None, run=subprocess.run,
          resolve_latest=None) -> Tuple[Dict[str, str], Tuple[str, str, str]]:
    """Generate, templatize and validate; raises ArchetypeError when the result can't be used.
    Tries the local Maven repository first (works offline), then the network."""
    coords = parse_spec(spec, resolve_latest)
    try:
        project = generate(coords, workdir, sdk_version, offline=True, mvn=mvn, run=run)
    except ArchetypeError:
        project = generate(coords, workdir, sdk_version, offline=False, mvn=mvn, run=run)
    prefix = f"the templates from archetype {':'.join(coords)} don't fit what repo-modernize needs"
    try:
        templates = templatize(project)
    except TemplatesDoNotFit as e:
        raise TemplatesDoNotFit(f"{prefix}:\n  - {e}") from e
    problems = validate(templates)
    if problems:
        raise TemplatesDoNotFit(f"{prefix}:\n  - " + "\n  - ".join(problems))
    return templates, coords
