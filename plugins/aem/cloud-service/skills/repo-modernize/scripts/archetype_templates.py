#!/usr/bin/env python3
"""The module templates repo-modernize scaffolds from, taken from an AEM project archetype.

repo-modernize ships no archetype. The modules a project is missing (`all`,
`ui.apps.structure`, `ui.config`, ...) are created from templates prepared at plan time,
and the FileVault configuration of the `ui.apps` / `ui.content` templates is copied into
the project's own modules. The templates come from one of:

  latest / <version> / <groupId:artifactId:version>
      `mvn archetype:generate` a throwaway project with sentinel coordinates (local Maven
      repository first, then the network), then swap the sentinels for {{placeholders}};
  <path> to a project generated from an archetype (has `archetype.properties`)
      the project's own coordinates, app id and title become {{placeholders}}, by the
      XML context each appears in (no Maven needed);
  <path> to a folder of templates (already holds {{placeholders}})
      used as they are.

Then references to modules the skill doesn't create (the sample `core` bundle,
`ui.frontend`, `dispatcher`, ...) are dropped, and `validate` checks every shape the
restructuring relies on, so templates that would break it are refused before anything
changes. Standard library only.

    python3 scripts/archetype_templates.py [latest|58|g:a:v|<path>] [--sdk-version V] [--out DIR]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape as _xml_escape

ADOBE_ARCHETYPE = ("com.adobe.aem", "aem-project-archetype")
ARCHETYPE_PLUGIN = "org.apache.maven.plugins:maven-archetype-plugin:3.3.1"
MODULES = ("all", "ui.apps", "ui.apps.structure", "ui.config", "ui.content")
POM_FILES = ("pom.xml",) + tuple(f"{m}/pom.xml" for m in MODULES)
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
_PROJECT_MODULE_REF = re.compile(r"\{\{artifactId\}\}\.([\w.-]+)")
_TAG = re.compile(r"(?P<skip><!--.*?-->|<\?.*?\?>|<!\[CDATA\[.*?\]\]>|<![^>]*>)"
                  r"|<(?P<close>/)?(?P<tag>[A-Za-z_][\w.:-]*)[^>]*?(?P<self>/)?>", re.S)
_MAVEN_BOILERPLATE = re.compile(r"^\[ERROR\]\s*$|To see the full stack trace|Re-run Maven using|"
                                r"For more information about the errors|^\[ERROR\]\s*\[Help \d+\]")
_HELP_SUFFIX = re.compile(r"\s*-> \[Help \d+\]\s*$")


class ArchetypeError(Exception):
    """Templates could not be produced, or do not fit; the message says what to do."""


class TemplatesDoNotFit(ArchetypeError):
    """The templates were produced, but lack shapes the transforms rely on."""


# --------------------------------------------------------------------------- sources

def as_path(spec: str) -> Optional[Path]:
    """`spec` as a folder path (it contains a path separator or starts with . or ~), else None."""
    s = (spec or "").strip()
    if "/" in s or "\\" in s or s.startswith((".", "~")):
        return Path(s).expanduser()
    return None


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
            raise ArchetypeError("could not find the latest AEM project archetype: Maven Central "
                                 "is unreachable and none is in the local Maven repository. Name "
                                 "a version (e.g. --archetype 58) or pass a path.")
        return (*ADOBE_ARCHETYPE, version)
    parts = spec.split(":")
    if len(parts) == 1 and re.fullmatch(r"\d+(\.\d+)*", spec):
        return (*ADOBE_ARCHETYPE, spec)
    if len(parts) == 3 and all(_TOKEN.fullmatch(p) for p in parts):
        return tuple(parts)  # type: ignore[return-value]
    raise ArchetypeError(f"unrecognized archetype {spec!r}: use 'latest', a version of Adobe's "
                         "AEM project archetype (e.g. 58), groupId:artifactId:version, or a "
                         "path such as ./my-archetype-project")


def resolve_sdk(choice: str, fallback: Optional[str] = None, why: str = "") -> Tuple[str, str]:
    """`(version, note)` for an explicit AEM SDK API version, or for 'latest' (Maven Central,
    else the local Maven repository). When the latest can't be found: `fallback` with a note
    (`why` says which version that is), or ArchetypeError when there is none."""
    if choice == "latest":
        import archetype as A
        version = A.resolve_latest_sdk_api()
        if version and _TOKEN.fullmatch(version):
            return version, ""
        if fallback and _TOKEN.fullmatch(fallback):
            return fallback, (f"the latest AEM SDK API version can't be found (Maven Central is "
                              f"unreachable and none is in the local Maven repository); using "
                              f"{fallback}, {why}. Pass --sdk-version <version> for another.")
        raise ArchetypeError("could not find the latest AEM SDK API version: Maven Central is "
                             "unreachable and none is in the local Maven repository. Pass "
                             "--sdk-version <version>.")
    if not _TOKEN.fullmatch(choice or ""):
        raise ArchetypeError(f"invalid AEM SDK version {choice!r}")
    return choice, ""


def generate(coords: Tuple[str, str, str], workdir, sdk_version: str, offline: bool = False,
             mvn: Optional[str] = None, run=subprocess.run, timeout: float = 900) -> Path:
    """Generate a throwaway project from `coords` in `workdir`; returns its directory."""
    if not _TOKEN.fullmatch(sdk_version or ""):
        raise ArchetypeError(f"invalid AEM SDK version {sdk_version!r}")
    mvn = mvn or shutil.which("mvn")
    if not mvn:
        raise ArchetypeError("Maven (mvn) and a JDK are needed to generate the AEM project "
                             "archetype. Install Maven, or pass --archetype <path> to a project "
                             "already generated from an archetype.")
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


# --------------------------------------------------------------------------- templatize

def _drop_foreign_module_refs(text: str) -> str:
    """Remove <dependency>/<embedded> blocks for project modules the skill doesn't create
    (`{{artifactId}}.core`, `.ui.frontend`, `.dispatcher...`): the project's own bundles
    are embedded instead."""
    def keep(block: str) -> bool:
        return all(m.group(1) in MODULES for m in _PROJECT_MODULE_REF.finditer(block))
    return _BLOCK.sub(lambda m: m.group(0) if keep(m.group(0)) else "", text)


_SDK_API_DEP = ("com.adobe.aem", "aem-sdk-api")   # refactor_poms manages it in the project


def _managed_versions(reactor_text: str) -> Dict[Tuple[str, str], str]:
    """groupId:artifactId -> version from the template reactor's <dependencyManagement>,
    with its own ${properties} resolved."""
    try:
        root = ET.fromstring(reactor_text.encode("utf-8"))
    except ET.ParseError:
        return {}
    props_el = _child(root, "properties")
    props = {c.tag.split("}")[-1]: (c.text or "").strip()
             for c in (props_el if props_el is not None else []) if isinstance(c.tag, str)}
    props["project.version"] = _text(root, "version") or ""
    out = {}
    deps = root.find(f"{_NS}dependencyManagement/{_NS}dependencies")
    for dep in (deps if deps is not None else []):
        g, a, v = _text(dep, "groupId"), _text(dep, "artifactId"), _text(dep, "version")
        if g and a and v:
            v = re.sub(r"\$\{([^}]+)\}", lambda m: props.get(m.group(1)) or m.group(0), v)
            if "${" not in v:
                out[(g, a)] = v
    return out


def _inline_managed_versions(text: str, managed: Dict[Tuple[str, str], str]) -> str:
    """Give each <dependency> without a <version> the version the archetype's reactor
    manages for it: the project's own reactor doesn't manage the archetype's dependencies."""
    def fix(m):
        block = m.group(0)
        if m.group(1) != "dependency" or "<version>" in block:
            return block
        g = re.search(r"<groupId>\s*([^<]+?)\s*</groupId>", block)
        a = re.search(r"([ \t]*)<artifactId>\s*([^<]+?)\s*</artifactId>[ \t]*(\r?\n)?", block)
        if not (g and a) or (g.group(1), a.group(2)) == _SDK_API_DEP:
            return block
        version = managed.get((g.group(1), a.group(2)))
        if not version:
            return block
        newline = a.group(3) or ""
        line = f"{a.group(1)}<version>{version}</version>" + (newline or "")
        return block[:a.end()] + (line if newline else " " + line.strip()) + block[a.end():]
    return _BLOCK.sub(fix, text)


def _read_files(root: Path, label: Optional[str] = None) -> Dict[str, str]:
    out = {}
    for rel in TEMPLATE_FILES:
        path = root / rel
        if not path.is_file():
            raise TemplatesDoNotFit(f"{label or root} has no {rel}")
        out[rel] = path.read_text(encoding="utf-8")
    return out


def templatize(project_dir) -> Dict[str, str]:
    """The templates (relative path -> text) from a project `generate` produced."""
    root = Path(project_dir)
    out: Dict[str, str] = {}
    for rel, text in _read_files(root, "the generated project").items():
        for _prop, sentinel, placeholder in _SENTINELS:
            if placeholder:
                text = text.replace(sentinel, placeholder)
        leftover = [l.strip() for l in text.splitlines() if "zq" in l.lower()]
        if leftover:
            raise TemplatesDoNotFit(f"{rel}: holds a value derived from the project coordinates "
                                    f"that the templates cannot express: {leftover[:3]}")
        out[rel] = text
    return _finish(out)


def _finish(templates: Dict[str, str]) -> Dict[str, str]:
    """Inline versions the archetype's reactor manages, then drop references to modules
    the skill doesn't create."""
    managed = _managed_versions(templates.get("pom.xml", ""))
    return {rel: _drop_foreign_module_refs(_inline_managed_versions(text, managed))
            if rel in MODULE_FILES else text for rel, text in templates.items()}


def _read_properties(path: Path) -> Dict[str, str]:
    """A Java .properties file (`key=value` / `key: value`, # and ! comments, \\ escapes)."""
    out: Dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return out
    for line in lines:
        s = line.strip()
        if not s or s[0] in "#!":
            continue
        m = re.match(r"((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*(.*)$", s)
        if not m:
            continue
        unescape = lambda v: re.sub(r"\\u([0-9a-fA-F]{4})|\\(.)",
                                    lambda e: chr(int(e.group(1), 16)) if e.group(1) else e.group(2), v)
        out[unescape(m.group(1))] = unescape(m.group(2))
    return out


def _own(root_el, name: str) -> Optional[str]:
    for child in root_el:
        if isinstance(child.tag, str) and child.tag.split("}")[-1] == name and (child.text or "").strip():
            return child.text.strip()
    return None


def project_values(project_dir) -> Dict[str, str]:
    """groupId / artifactId / version from the generated project's root pom; appId and
    appTitle from its `archetype.properties` (else inferred from `all` and the pom name)."""
    root = Path(project_dir)
    try:
        pom = ET.parse(str(root / "pom.xml")).getroot()
    except (OSError, ET.ParseError) as e:
        raise TemplatesDoNotFit(f"{root}/pom.xml can't be read: {e}") from e
    parent = next((c for c in pom if isinstance(c.tag, str) and c.tag.endswith("parent")), None)
    props = _read_properties(root / "archetype.properties")

    def coord(name):
        return _own(pom, name) or (parent is not None and _own(parent, name)) or props.get(name)

    app_id = props.get("appId")
    if not app_id:
        try:
            m = re.search(r"<target>\s*/apps/([^/<\s]+)-packages/", (root / "all/pom.xml").read_text("utf-8"))
            app_id = m.group(1) if m else None
        except OSError:
            app_id = None
    values = {"groupId": coord("groupId"), "artifactId": _own(pom, "artifactId"),
              "version": coord("version"), "appId": app_id,
              "appTitle": props.get("appTitle") or _own(pom, "name")}
    missing = [k for k, v in values.items() if not v]
    if missing:
        raise TemplatesDoNotFit(f"{root}: can't tell the project's {', '.join(missing)} "
                                "(expected archetype.properties next to its pom.xml)")
    return values


def _module_artifact_ids(root: Path) -> List[str]:
    ids = []
    for pom in sorted(root.glob("*/pom.xml")):
        try:
            own = _own(ET.parse(str(pom)).getroot(), "artifactId")
        except (OSError, ET.ParseError):
            continue
        if own:
            ids.append(own)
    return ids


def _sub_element_text(text: str, names: str, pattern: str, repl: str) -> str:
    """Replace `pattern` (regex, whole text) inside <names> elements, keeping whitespace."""
    rx = re.compile(rf"(<({names})>\s*){pattern}(\s*</\2>)")
    return rx.sub(lambda m: m.group(1) + repl + m.group(m.lastindex), text)


def _top_level_version(text: str, version: str) -> str:
    """Templatize the project's own <version> (a direct child of <project>)."""
    depth = 0
    for m in _TAG.finditer(text):
        if m.group("skip"):
            continue
        if m.group("close"):
            depth -= 1
            continue
        if depth == 1 and m.group("tag") == "version" and not m.group("self"):
            end = text.find("</version>", m.end())
            if end > 0 and text[m.end():end].strip() == version:
                inner = text[m.end():end]
                return text[:m.end()] + inner.replace(version, "{{version}}", 1) + text[end:]
            return text
        if not m.group("self"):
            depth += 1
    return text


def _templatize_text(text: str, v: Dict[str, str], artifacts: List[str], is_filter: bool) -> str:
    root_id = v["artifactId"]
    project_ids = sorted({root_id} | {a for a in artifacts if a.startswith(root_id + ".")},
                         key=len, reverse=True)
    for a in project_ids:
        suffix = a[len(root_id):]
        if suffix:   # FileVault package names: <name>wknd.ui.apps</name>
            text = _sub_element_text(text, "name", re.escape(a), "{{artifactId}}" + suffix)
        text = _sub_element_text(text, "artifactId", re.escape(a), "{{artifactId}}" + suffix)
    text = _sub_element_text(text, "groupId|group", re.escape(v["groupId"]), "{{groupId}}")

    version = re.escape(v["version"])
    text = re.sub(r"<parent>.*?</parent>",
                  lambda m: _sub_element_text(m.group(0), "version", version, "{{version}}"),
                  text, flags=re.S)
    text = _BLOCK.sub(lambda m: _sub_element_text(m.group(0), "version", version, "{{version}}")
                      if "{{artifactId}}" in m.group(0) else m.group(0), text)
    text = _top_level_version(text, v["version"])

    app_segment = re.compile(r"(?<=/)" + re.escape(v["appId"]) + r"(?=(?:-packages|-vendor-packages)?(?:/|$))")
    paths = (lambda m: m.group(1) + app_segment.sub("{{appId}}", m.group(2)) + m.group(3))
    text = re.sub(r"(<(?:target|root)>\s*)([^<]*?)(\s*</(?:target|root)>)", paths, text)
    if is_filter:
        text = re.sub(r'(\broot=")([^"]*)(")', paths, text)

    title = re.compile(r"(?<!\w)" + re.escape(_xml_escape(v["appTitle"])) + r"(?!\w)")
    text = re.sub(r"(<(name|description|componentGroupName)>)([^<]*)(</\2>)",
                  lambda m: m.group(1) + title.sub("{{appTitle}}", m.group(3)) + m.group(4), text)
    return text


def templatize_project(project_dir) -> Dict[str, str]:
    """The templates from a project the user generated from an archetype (their own
    coordinates, app id and title become {{placeholders}})."""
    root = Path(project_dir)
    values = project_values(root)
    artifacts = _module_artifact_ids(root)
    out: Dict[str, str] = {}
    for rel, text in _read_files(root).items():
        out[rel] = _templatize_text(text, values, artifacts, rel == ALL_FILTER)
    return _finish(out)


def load_dir(path) -> Dict[str, str]:
    """A folder that already holds templates ({{placeholders}})."""
    return _read_files(Path(path))


def with_sdk(templates: Dict[str, str], version: str) -> Dict[str, str]:
    """The templates with the reactor's `aem.sdk.api` set to `version`."""
    out = dict(templates)
    out["pom.xml"] = re.sub(r"(<aem\.sdk\.api>)[^<]*(</aem\.sdk\.api>)",
                            lambda m: m.group(1) + version + m.group(2), out["pom.xml"], count=1)
    return out


def set_sdk(templates: Dict[str, str], choice: str) -> Tuple[Dict[str, str], str]:
    """The templates with the AEM SDK API version `choice` (a version, or 'latest': when that
    can't be found, they keep their own), and a note ('' when none)."""
    own = pins(templates["pom.xml"])["aem.sdk.api"]
    version, note = resolve_sdk(choice, own, "the version the archetype templates already use")
    return with_sdk(templates, version), note


def from_path(path) -> Tuple[Dict[str, str], str]:
    """Templates from a folder: a project generated from an archetype, or templates."""
    p = Path(path).expanduser()
    if not p.is_dir():
        raise ArchetypeError(f"{p} is not a folder")
    pom = p / "pom.xml"
    if not pom.is_file():
        raise TemplatesDoNotFit(f"{p} has no pom.xml: expected a project generated from an AEM "
                                "archetype, or a folder of templates")
    if "{{artifactId}}" in pom.read_text(encoding="utf-8", errors="replace"):
        templates, kind = load_dir(p), "templates folder"
    else:
        templates, kind = templatize_project(p), "project generated from an archetype"
    problems = validate(templates)
    if problems:
        raise TemplatesDoNotFit(f"the templates from {p} don't fit what repo-modernize needs:\n  - "
                                + "\n  - ".join(problems))
    return templates, kind


# --------------------------------------------------------------------------- validate

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
        module = rel.split("/")[0]
        parent = _child(root, "parent")
        coords = (_text(parent, "groupId"), _text(parent, "artifactId"), _text(parent, "version"))
        if coords != ("{{groupId}}", "{{artifactId}}", "{{version}}"):
            problems.append(f"{rel}: <parent> should be {{{{groupId}}}}:{{{{artifactId}}}}:"
                            f"{{{{version}}}}, found {':'.join(str(c) for c in coords)}")
        if _text(root, "artifactId") != f"{{{{artifactId}}}}.{module}":
            problems.append(f"{rel}: <artifactId> should be {{{{artifactId}}}}.{module}, "
                            f"found {_text(root, 'artifactId')!r}")
        foreign = sorted({m.group(1) for m in _PROJECT_MODULE_REF.finditer(text)} - set(MODULES))
        if foreign:
            problems.append(f"{rel}: references project modules repo-modernize doesn't create: "
                            + ", ".join(f"{{{{artifactId}}}}.{f}" for f in foreign))
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
        for dep in main_build.iter(_NS + "dependency"):
            ga = (_text(dep, "groupId"), _text(dep, "artifactId"))
            if _text(dep, "version") is None and ga != _SDK_API_DEP:
                problems.append(f"{rel}: dependency {ga[0]}:{ga[1]} has no version, and the "
                                "project's reactor won't manage it")
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


# --------------------------------------------------------------------------- prepare

def write(templates: Dict[str, str], dest) -> None:
    """Write the templates under `dest`, keeping their line endings."""
    for rel, text in templates.items():
        path = Path(dest) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)


def build_from(coords: Tuple[str, str, str], workdir, sdk_version: str, mvn: Optional[str] = None,
               run=subprocess.run) -> Dict[str, str]:
    """Generate (local Maven repository first, then the network), templatize and validate."""
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
    return templates


def build(spec: str, workdir, sdk_version: str, mvn: Optional[str] = None, run=subprocess.run,
          resolve_latest=None) -> Tuple[Dict[str, str], Tuple[str, str, str]]:
    """`parse_spec` + `build_from`."""
    coords = parse_spec(spec, resolve_latest)
    return build_from(coords, workdir, sdk_version, mvn=mvn, run=run), coords


def prepare(spec: Optional[str] = None, sdk: Optional[str] = None, mvn: Optional[str] = None,
            run=subprocess.run, fallback_sdk: Optional[str] = None
            ) -> Tuple[Dict[str, str], Dict[str, str]]:
    """The checked templates for an archetype spec (default 'latest') and a description:
    `{"archetype", "source", "aemSdkApi"[, "note"][, "sdkNote"]}`. `sdk`: an AEM SDK API
    version or 'latest'; None means latest when generating, the project's own for a path.
    If the latest Adobe archetype doesn't fit, falls back to the version the skill is tested
    with (`note`). If the latest AEM SDK API version can't be found (offline, and the plan
    never downloads aem-sdk-api), generation uses `fallback_sdk` (the previous plan's), else
    `TESTED_SDK` (`sdkNote`)."""
    import archetype as A
    spec = (spec or "latest").strip()
    sdk_note = ""
    path = as_path(spec)
    if path is not None:
        templates, kind = from_path(path)
        if sdk:
            templates, sdk_note = set_sdk(templates, sdk)
        info = {"archetype": str(path.resolve()), "source": kind}
    else:
        if spec == "latest":
            version, where = A.latest(*A.ARCHETYPE)
            if not version:
                raise ArchetypeError("could not find the latest AEM project archetype: Maven "
                                     "Central is unreachable and none is in the local Maven "
                                     "repository. Name a version (--archetype 58) or pass a path.")
            coords, source = (*A.ARCHETYPE, version), f"latest, from {where}"
        else:
            coords, source = parse_spec(spec), "requested"
        if fallback_sdk and _TOKEN.fullmatch(fallback_sdk):
            fallback, why = fallback_sdk, "the version the previous plan used"
        else:
            fallback, why = A.TESTED_SDK, "the version repo-modernize is tested with"
        sdk_version, sdk_note = resolve_sdk(sdk or "latest", fallback, why)
        work = tempfile.mkdtemp(prefix="repo-modernize-archetype-")
        note = ""
        try:
            try:
                templates = build_from(coords, work, sdk_version, mvn=mvn, run=run)
            except TemplatesDoNotFit as e:
                if spec != "latest" or coords[2] == A.TESTED_ARCHETYPE:
                    raise
                reason = str(e).splitlines()[1].strip(" -") if "\n" in str(e) else str(e)
                note = (f"archetype {coords[2]} doesn't fit ({reason}); using {A.TESTED_ARCHETYPE}, "
                        "the newest version repo-modernize is tested with")
                coords, source = (*A.ARCHETYPE, A.TESTED_ARCHETYPE), "fallback"
                templates = build_from(coords, work, sdk_version, mvn=mvn, run=run)
        finally:
            shutil.rmtree(work, ignore_errors=True)
        info = {"archetype": ":".join(coords), "source": source}
        if note:
            info["note"] = note
    info["aemSdkApi"] = pins(templates["pom.xml"])["aem.sdk.api"] or ""
    if sdk_note:
        info["sdkNote"] = sdk_note
    return templates, info


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Prepare and check the module templates repo-modernize scaffolds from")
    ap.add_argument("archetype", nargs="?", default="latest",
                    help="'latest' (default), a version of Adobe's archetype (e.g. 58), "
                         "groupId:artifactId:version, or a path to a project generated from an "
                         "archetype or to a folder of templates")
    ap.add_argument("--sdk-version", default=None,
                    help="AEM SDK API version or 'latest' (default: latest when generating; a "
                         "path keeps its own)")
    ap.add_argument("--out", help="write the templates to this folder")
    a = ap.parse_args(argv)
    try:
        templates, info = prepare(a.archetype, a.sdk_version)
    except TemplatesDoNotFit as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except ArchetypeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if a.out:
        write(templates, a.out)
    print(f"archetype: {info['archetype']} ({info['source']}); AEM SDK {info['aemSdkApi']}"
          + (f" -> {a.out}" if a.out else ": templates fit"))
    for key in ("note", "sdkNote"):
        if info.get(key):
            print(f"note: {info[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
