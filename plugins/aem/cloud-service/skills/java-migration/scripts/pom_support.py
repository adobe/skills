"""Lossless, scoped POM edits using XML parser byte offsets (Python 3.10+)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from xml.parsers import expat
from xml.sax.saxutils import escape

SKILL = Path(__file__).resolve().parents[1]
COMPILER_PROPERTIES = {
    "maven.compiler.source", "maven.compiler.target", "maven.compiler.release",
    "maven.compiler.testSource", "maven.compiler.testTarget", "maven.compiler.testRelease",
    "java.version", "java.source", "java.target",
}


class MigrationError(Exception):
    """An unsafe or unsupported migration input."""


@dataclass
class Element:
    name: str
    start: int
    open_end: int
    empty: bool
    parent: Element | None = None
    close_start: int = 0
    end: int = 0
    data: str = ""
    children: list[Element] = field(default_factory=list)

    def child(self, name):
        return next((child for child in self.children if child.name == name), None)

    def value(self, name):
        child = self.child(name)
        return child.data.strip() if child else ""

    def walk(self, name):
        for child in self.children:
            if child.name == name:
                yield child
            yield from child.walk(name)


class Pom:
    def __init__(self, path):
        self.path = Path(path)
        self.original = self.path.read_bytes()
        self.edits = {}
        self.root = None
        stack = []
        parser = expat.ParserCreate(namespace_separator="|")

        def start(name, attrs):
            offset = parser.CurrentByteIndex
            match = re.match(rb"""<(?:"[^"]*"|'[^']*'|[^'">])*>""", self.original[offset:])
            if not match:
                raise MigrationError(f"Cannot locate XML tag in {self.path}")
            opening = match.group()
            node = Element(name.split("|")[-1], offset, offset + len(opening),
                           opening.endswith(b"/>"), stack[-1] if stack else None)
            if stack:
                stack[-1].children.append(node)
            else:
                self.root = node
            stack.append(node)

        def end(name):
            node = stack.pop()
            node.close_start = node.open_end if node.empty else parser.CurrentByteIndex
            node.end = node.open_end if node.empty else self.original.index(b">", node.close_start) + 1

        def data(value):
            if stack:
                stack[-1].data += value

        def reject(*args):
            raise MigrationError(f"DTD/entity declarations are not supported: {self.path}")

        parser.StartElementHandler = start
        parser.EndElementHandler = end
        parser.CharacterDataHandler = data
        parser.StartDoctypeDeclHandler = reject
        parser.EntityDeclHandler = reject
        try:
            parser.Parse(self.original, True)
        except expat.ExpatError as exc:
            raise MigrationError(f"Invalid XML in {self.path}: {exc}") from exc
        if self.root is None or self.root.name != "project":
            raise MigrationError(f"Not a Maven POM: {self.path}")

    def replace(self, start, end, value):
        key = (start, end)
        if key in self.edits and self.edits[key] != value:
            raise MigrationError(f"Conflicting XML changes in {self.path}")
        if self.original[start:end] != value:
            self.edits[key] = value

    def set_text(self, node, value):
        value = str(value)
        if node.data.strip() == value and not node.empty:
            return
        raw = self.original[node.open_end:node.close_start]
        text = (f"<![CDATA[{value}]]>" if raw.strip().startswith(b"<![CDATA[")
                and "]]>" not in value else escape(value)).encode()
        if node.empty:
            opening = self.original[node.start:node.open_end]
            tag = re.match(rb"<([^\s/>]+)", opening).group(1)
            self.replace(node.start, node.end, opening[:-2] + b">" + text + b"</" + tag + b">")
        else:
            self.replace(node.open_end, node.close_start, text)

    def append(self, node, name, value):
        tag = re.match(rb"<([^\s/>]+)", self.original[node.start:node.open_end]).group(1)
        prefix = tag.rsplit(b":", 1)[0] + b":" if b":" in tag else b""
        child_tag = prefix + name.encode()
        content = b"\n" + b"<" + child_tag + b">" + escape(str(value)).encode() + b"</" + child_tag + b">\n"
        if node.empty:
            opening = self.original[node.start:node.open_end]
            self.replace(node.start, node.end, opening[:-2] + b">" + content + b"</" + tag + b">")
        else:
            key = (node.close_start, node.close_start)
            self.edits[key] = self.edits.get(key, b"") + content

    def set_child(self, node, name, value):
        child = node.child(name)
        if child:
            self.set_text(child, value)
        else:
            self.append(node, name, value)

    def render(self):
        result = self.original
        boundary = len(result) + 1
        for (start, end), value in sorted(self.edits.items(), reverse=True):
            if end > boundary:
                raise MigrationError(f"Overlapping XML changes in {self.path}")
            result = result[:start] + value + result[end:]
            boundary = start
        return result


def load_config(name):
    try:
        return json.loads((SKILL / "configs" / name).read_text())
    except (OSError, ValueError) as exc:
        raise MigrationError(f"Cannot load config {name}: {exc}") from exc


def target_config(target):
    config = load_config("targets.json").get(str(target))
    if not config or not config["enabled"]:
        raise MigrationError(f"Unsupported or disabled Java target: {target}")
    return config


def reactor(root):
    """Follow declared modules, not every unrelated POM in a workspace."""
    root = Path(root).resolve()
    poms = {}

    def visit(path):
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or path.is_symlink():
            raise MigrationError(f"Module escapes project boundary: {path}")
        if resolved in poms:
            return
        pom = Pom(resolved)
        poms[resolved] = pom
        # Include profile modules as well, even if not active on this machine.
        for modules in pom.root.walk("modules"):
            for module in modules.children:
                if module.name == "module":
                    value = module.data.strip()
                    if not value or "${" in value:
                        raise MigrationError(f"Unresolved module path in {path}: {value}")
                    module_path = resolved.parent / value
                    visit(module_path if module_path.name == "pom.xml" else module_path / "pom.xml")

    visit(root / "pom.xml")
    return poms


def ancestors(pom, poms):
    seen = set()
    while pom.path not in seen:
        seen.add(pom.path)
        yield pom
        parent = pom.root.child("parent")
        if parent is None:
            break
        relative = parent.child("relativePath")
        value = relative.data.strip() if relative else "../pom.xml"
        if not value:
            break
        path = (pom.path.parent / value).resolve()
        if path.is_dir():
            path /= "pom.xml"
        pom = poms.get(path)
        if pom is None:
            break


def resolve(pom, value, poms, seen=None, context=None):
    seen = set() if seen is None else seen
    match = re.fullmatch(r"\$\{([^}]+)}", value)
    if not match:
        if "${" in value:
            raise MigrationError(f"Compound property is unsupported in {pom.path}: {value}")
        return value
    key = match[1]
    if key in seen:
        raise MigrationError(f"Cyclic Maven property in {pom.path}: {key}")
    seen.add(key)
    enclosing = context
    while enclosing:
        if enclosing.name == "profile":
            props = enclosing.child("properties")
            prop = props.child(key) if props else None
            if prop:
                return resolve(pom, prop.data.strip(), poms, seen, context)
        enclosing = enclosing.parent
    for owner in ancestors(pom, poms):
        props = owner.root.child("properties")
        prop = props.child(key) if props else None
        if prop:
            return resolve(pom, prop.data.strip(), poms, seen, context)
    raise MigrationError(f"Unresolved Maven property in {pom.path}: {key}")


def coordinate(node, default_group=""):
    return f"{node.value('groupId') or default_group}:{node.value('artifactId')}"


def plugins(pom):
    for node in pom.root.walk("plugin"):
        if node.parent.name == "plugins" and node.parent.parent.name in {"build", "pluginManagement"}:
            yield node


def inherited_plugin_version(pom, plugin, poms):
    key = coordinate(plugin, "org.apache.maven.plugins")
    for owner in ancestors(pom, poms):
        for candidate in plugins(owner):
            if candidate is plugin:
                continue
            if owner is pom and candidate.parent.parent.name != "pluginManagement":
                continue
            if coordinate(candidate, "org.apache.maven.plugins") == key:
                version = candidate.child("version")
                if version:
                    return resolve(pom, version.data.strip(), poms, context=version)
    return None


def compiler_nodes(pom):
    props = pom.root.child("properties")
    if props:
        yield from (node for node in props.children if node.name in COMPILER_PROPERTIES)
    for plugin in plugins(pom):
        if coordinate(plugin, "org.apache.maven.plugins") == "org.apache.maven.plugins:maven-compiler-plugin":
            configurations = []
            config = plugin.child("configuration")
            if config:
                configurations.append(config)
            executions = plugin.child("executions")
            if executions:
                configurations.extend(config for execution in executions.children
                                      if execution.name == "execution"
                                      for config in execution.children if config.name == "configuration")
            for config in configurations:
                for node in config.children:
                    if node.name in {"source", "target", "release", "testSource", "testTarget", "testRelease"}:
                        yield node
    for profile in pom.root.walk("profile"):
        props = profile.child("properties")
        if props:
            yield from (node for node in props.children if node.name in COMPILER_PROPERTIES)


def compiler_versions(poms):
    versions = []
    for pom in poms.values():
        for node in compiler_nodes(pom):
            value = resolve(pom, node.data.strip(), poms, context=node)
            if not re.fullmatch(r"(?:1\.)?\d+", value):
                raise MigrationError(f"Unrecognized compiler version in {pom.path}: {value}")
            versions.append(int(value.removeprefix("1.")))
    if not versions:
        raise MigrationError("No explicit compiler source/target/release; inspect the effective POM first.")
    return sorted(set(versions))


def source_version(poms):
    return min(compiler_versions(poms))


def update_setting(pom, node, value, poms):
    """Localize the value instead of changing a property shared by unrelated consumers."""
    resolve(pom, node.data.strip(), poms, context=node)
    pom.set_text(node, value)


def minimum_version(pom, node, minimum, poms):
    current = resolve(pom, node.data.strip(), poms, context=node)
    if not re.fullmatch(r"\d+(?:\.\d+)*", current):
        raise MigrationError(f"Review non-release version {current} in {pom.path}")
    old = tuple(map(int, current.split(".")))
    new = tuple(map(int, minimum.split(".")))
    if old < new:
        update_setting(pom, node, minimum, poms)


def write_changes(poms):
    rendered = {path: pom.render() for path, pom in poms.items()}
    # Parse every candidate before writing any file; malformed input cannot partially rewrite a reactor.
    for content in rendered.values():
        parser = expat.ParserCreate()
        parser.Parse(content, True)
    for path, pom in poms.items():
        if path.read_bytes() != pom.original:
            raise MigrationError(f"File changed during planning: {path}")
    changed = []
    for path, content in rendered.items():
        if content != poms[path].original:
            path.write_bytes(content)
            changed.append(str(path))
    return changed
