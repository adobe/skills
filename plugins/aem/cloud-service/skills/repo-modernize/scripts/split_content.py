# scripts/split_content.py
"""Top-level content routing + history-preserving move (Phase 1, split step).

`route_top_level_dir` implements the one routing rule this whole skill exists to
mechanize: immutable JCR content (`/apps`, `/libs`, `/oak:index`) belongs in
`ui.apps`; everything else (`/content`, `/etc`, `/conf`, `/home`, ...) belongs in
`ui.content`. On disk, the `/oak:index` root is the directory named `_oak_index`
(`:` is not a legal filesystem character) — it MUST route to `ui.apps` alongside
`apps`/`libs`.

`move_content` walks every configured content package's `jcr_root`, routes each
top-level directory, and relocates it under the target module's
`src/main/content/jcr_root/` — using `git mv` (history-preserving) by default, or
`shutil.move` when `use_git=False` (e.g. the project isn't a git repo yet).

Self-move guard (load-bearing): a source content package's name can legitimately
equal a target module's directory name — e.g. a project that already has `ui.apps`/
`ui.content` maven modules, but whose `jcr_root` still mixes immutable and mutable
content that was never split. In that case routing `apps/` (under source `ui.apps`)
resolves to a destination identical to its current location — moving it would be a
no-op at best and a self-clobbering `git mv` error at worst. `move_content` detects
this by comparing resolved destination and source paths and skips the move,
leaving the directory exactly where it is. Content that genuinely belongs
elsewhere (e.g. `etc/` sitting under that same source `ui.apps`) is unaffected by
the guard and still moves normally.

Merging into a pre-existing destination directory (e.g. `ui.content` already has a
`content/` of its own before another package's `content/` is routed there) is
handled file-by-file and never clobbers a file already present at the
destination. This is defensive: the Task B10/B12 fixtures don't exercise it.

Filter.xml root rewriting (`split_filters`) and `ui.apps.structure` root
derivation/write-back (`derive_structure_roots` / `write_structure_roots`) are
implemented below (Task B11) — see references/transform-rules.md §4 for the
ancestor-path algorithm and the exact `ui.apps.structure` FileVault config shape
`write_structure_roots` edits (cloudManagerTarget nested in `<properties>`,
`<filters />` shipped empty by the scaffolded template).
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional, Tuple
from xml.sax.saxutils import escape, quoteattr

import rm_common as C
import validate as V

_IMMUTABLE_DIRS = {"apps", "libs", "_oak_index"}


def route_top_level_dir(name: str) -> str:
    """Route a jcr_root top-level directory name to its target module key.

    Returns "ui.apps" for immutable content (`apps`, `libs`, `_oak_index` — the
    on-disk name for `/oak:index`); "ui.content" for everything else (mutable
    content such as `content`, `etc`, `conf`, `home`, ...).
    """
    return "ui.apps" if name in _IMMUTABLE_DIRS else "ui.content"


def _mv(src: Path, dst: Path, use_git: bool, repo: Path) -> None:
    """Relocate a single file or directory tree from src to dst.

    Ensures dst's parent exists first (required for `git mv` to accept a nested
    destination path). Uses `git mv` (paths relative to `repo`, cwd=repo) when
    `use_git`, so history follows the move (`git log --follow`); otherwise a plain
    `shutil.move`.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    if use_git:
        subprocess.run(
            ["git", "mv", str(src.relative_to(repo)), str(dst.relative_to(repo))],
            cwd=repo, check=True,
        )
    else:
        shutil.move(str(src), str(dst))


def move_content(project_root, config: dict, use_git: bool = True) -> List[str]:
    """Route and relocate every content package's top-level jcr_root dirs.

    For each entry in `config["contentPackages"]` whose `jcrRoot` exists on disk,
    every top-level directory is routed via `route_top_level_dir` and moved under
    the corresponding target module's `src/main/content/jcr_root/`:
      - Self-move guard: if the destination is the same path as the source (the
        content package's own name already equals the target module dir), the
        directory is left in place and not reported as moved.
      - If the destination doesn't exist yet, the whole directory is moved in one
        `git mv` (or `shutil.move`) — this is what makes `git log --follow`
        continue to show history after the split.
      - If the destination already exists (merge case), files are relocated one
        at a time and an existing destination file is never overwritten.

    A configured content package whose `jcrRoot` doesn't exist on disk (nothing to
    split yet) is skipped rather than raising.

    Returns the list of "<sourcePkgPath>/<dirName> -> <targetModuleDir>" entries
    that were actually relocated (self-moves are not included).
    """
    root = Path(project_root)
    tm = config["targetModules"]
    moved: List[str] = []
    for cpkg in config["contentPackages"]:
        src_jcr = root / cpkg["jcrRoot"]
        if not src_jcr.exists():
            continue
        for top in sorted(p for p in src_jcr.iterdir() if p.is_dir()):
            target_key = "uiApps" if route_top_level_dir(top.name) == "ui.apps" else "uiContent"
            dst = root / tm[target_key] / "src/main/content/jcr_root" / top.name
            if dst.resolve() == top.resolve():
                continue  # self-move guard: source package IS the target module already
            if dst.exists():
                for f in [x for x in top.rglob("*") if x.is_file()]:
                    target = dst / f.relative_to(top)
                    if not target.exists():
                        _mv(f, target, use_git, root)
            else:
                _mv(top, dst, use_git, root)
            moved.append(f"{cpkg['path']}/{top.name} -> {tm[target_key]}")
    return moved


def _read_source_filter_roots(root: Path, config: dict) -> List[str]:
    """Every `<filter root="...">` attribute across all configured source content
    packages' `filter.xml` (namespace-agnostic tag match, same as validate.py's
    own `_filter_roots`). A content package whose `filterXml` doesn't exist yet
    on disk contributes nothing — skipped, not raised."""
    roots: List[str] = []
    for cpkg in config["contentPackages"]:
        fx = root / cpkg["filterXml"]
        if not fx.exists():
            continue
        for e in ET.parse(str(fx)).iter():
            if e.tag.split('}')[-1] == "filter" and "root" in e.attrib:
                roots.append(e.attrib["root"])
    return roots


def _read_source_filter_elements(root: Path, config: dict) -> List[ET.Element]:
    """Every `<filter root="...">` ELEMENT (not just its root attribute) across
    all configured source content packages' `filter.xml` (same namespace-agnostic
    tag match as `_read_source_filter_roots`). Unlike that function, this keeps
    each element's `<include>`/`<exclude>` children reachable, so `split_filters`
    can decide -- per root, per references/transform-rules.md §2 -- whether to
    preserve or strip them. A content package whose `filterXml` doesn't exist yet
    on disk contributes nothing -- skipped, not raised."""
    elements: List[ET.Element] = []
    for cpkg in config["contentPackages"]:
        fx = root / cpkg["filterXml"]
        if not fx.exists():
            continue
        for e in ET.parse(str(fx)).iter():
            if e.tag.split('}')[-1] == "filter" and "root" in e.attrib:
                elements.append(e)
    return elements


def _child_xml(filter_elem: ET.Element) -> List[str]:
    """Serialize a source `<filter>` element's `<include>`/`<exclude>` children
    (in document order) as indented, self-closing XML lines, reproducing every
    attribute verbatim (e.g. `pattern`, `mode`). Namespace-agnostic tag match,
    same as the rest of this module. Returns `[]` when the element has no
    children -- the caller then writes a bare `<filter root="R"/>`.

    Attribute values are XML-escaped via `quoteattr` (which supplies its own
    surrounding quotes) so a JCR name/pattern containing `&`, `<`, `>`, or `"`
    still produces well-formed XML."""
    out: List[str] = []
    for child in filter_elem:
        tag = child.tag.split("}")[-1]  # include | exclude
        attrs = "".join(f' {k}={quoteattr(v)}' for k, v in child.attrib.items())
        out.append(f'        <{tag}{attrs}/>')
    return out


def _write_filter(path: Path, entries: List[Tuple[str, Optional[str], List[str]]]) -> None:
    """Write a brand-new `workspaceFilter` XML document, one `<filter>` per
    entry. Each entry is a `(root, mode, child_lines)` triple, where `mode` is
    the source `<filter>`'s own `mode` attribute (`update`/`merge`) to reproduce
    -- or `None` to omit it -- and `child_lines` is the (possibly empty) list of
    pre-serialized `<include>`/`<exclude>` lines from `_child_xml`.

    `child_lines == []` writes a self-closing `<filter .. root="R"/>` — this is
    how EVERY `ui.apps` (immutable) filter is written (always `mode=None`, since
    immutable filters keep only their root), and how a `ui.content` (mutable)
    filter with no source include/exclude is written too. Non-empty
    `child_lines` writes `<filter .. root="R">` + those lines + `</filter>` —
    only ever for a `ui.content` (mutable) filter that had include/exclude.

    When `mode` is given it is emitted BEFORE `root` (e.g.
    `<filter mode="update" root="R"/>`), matching the CAM tool's own output
    order. The `mode` and `root` attribute values are XML-escaped via
    `quoteattr` (which supplies its own surrounding quotes) so a value
    containing `&`, `<`, `>`, or `"` still produces well-formed XML."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<workspaceFilter version="1.0">']
    for r, mode, child_lines in entries:
        mode_attr = f' mode={quoteattr(mode)}' if mode else ''
        if child_lines:
            lines.append(f'    <filter{mode_attr} root={quoteattr(r)}>')
            lines.extend(child_lines)
            lines.append('    </filter>')
        else:
            lines.append(f'    <filter{mode_attr} root={quoteattr(r)}/>')
    lines += ['</workspaceFilter>', '']
    path.write_text("\n".join(lines))


def _jcr_root_rel(filter_root: str) -> str:
    """Filesystem-relative path (under a module's `jcr_root/`) for a filter root:
    strip the leading `/`, and FileVault-escape any namespaced segment
    (`ns:name` -> `_ns_name`), matching FileVault's own docview naming --
    `/oak:index/x` -> `_oak_index/x`, `/content/cq:tags` -> `content/_cq_tags`,
    `.../rep:policy` -> `.../_rep_policy`. A plain segment is left as-is."""
    rel = filter_root.lstrip("/")
    out = []
    for seg in rel.split("/"):
        if ":" in seg:
            seg = "_" + seg.replace(":", "_")
        out.append(seg)
    return "/".join(out)


def _content_xml_has_child(content_xml: Path, child_name: str) -> bool:
    """True iff the FileVault docview `.content.xml` at `content_xml` declares a
    direct child element named `child_name` (namespace-agnostic local-name match).
    Handles the very common AEM case where a node is serialized INLINE inside its
    parent's `.content.xml` rather than as its own directory/file (e.g. the wknd
    fixture's `/oak:index/damAssetLucene` and `/oak:index/wkndId`, both inline in
    `_oak_index/.content.xml`)."""
    if not content_xml.exists():
        return False
    try:
        root_el = ET.parse(str(content_xml)).getroot()
    except ET.ParseError:
        return True  # unparseable -> assume content present (never false-prune)
    want = child_name.split(":")[-1]
    for c in root_el:
        if c.tag.split("}")[-1] == want:
            return True
    return False


def _filter_root_resolves_to_content(root: Path, tm: dict, filter_root: str, immutable: bool) -> bool:
    """True iff `filter_root` resolves to actual content on disk in the module it
    was routed into (ui.apps for immutable, ui.content for mutable) — the path
    exists as a directory, OR the leaf node is serialized as a sibling
    `<leaf>.xml` / `_<leaf>.xml` docview file, OR the leaf is declared INLINE as a
    child element inside the parent directory's own `.content.xml`.

    Mirrors CAM's own filter segregation, which SKIPS a filter path that "could
    not be resolved to valid content" (verified in its activity log: e.g.
    acme-portal's `/apps/settings/wcm/designs/digital`, which the legacy filter
    declares but no `digital` node backs). Content is checked at the TARGET module
    (content was already relocated by `move_content` before `split_filters` runs).

    Conservative BY DESIGN: it returns False ONLY when nothing on disk backs the
    root — filesystem path, docview file, AND inline child node in the parent's
    `.content.xml` are all checked, and an unparseable `.content.xml` is treated
    as "content present" — so pruning such a root removes coverage of nothing and
    can never drop real content (including inline-serialized nodes)."""
    module = tm["uiApps"] if immutable else tm["uiContent"]
    jcr_root = root / module / "src/main/content/jcr_root"
    rel = _jcr_root_rel(filter_root)
    target = jcr_root / rel
    if target.exists():                      # directory (or a file exactly at the path)
        return True
    parent, leaf = target.parent, target.name
    if not parent.is_dir():
        return False
    # leaf node serialized as a docview file: `<leaf>.xml` or the namespaced/
    # escaped `_<leaf>.xml` (e.g. `cq:dialog` -> `_cq_dialog.xml`).
    if (parent / f"{leaf}.xml").exists():
        return True
    if (parent / ("_" + leaf.replace(":", "_") + ".xml")).exists():
        return True
    # leaf declared INLINE as a child element in the parent's own `.content.xml`
    # (e.g. oak:index nodes inline in `_oak_index/.content.xml`).
    if _content_xml_has_child(parent / ".content.xml", leaf):
        return True
    return False


def split_filters(project_root, config: dict) -> None:
    """Route every source content package's filter roots into a NEW ui.apps or
    ui.content `filter.xml`, via `validate.classify_filter_root`
    (references/transform-rules.md §2):

    - "immutable" roots (`/apps`, `/libs`, `/oak:index`, ...) go to `ui.apps`,
      ALWAYS written bare (`<filter root="R"/>`) — any `<include>`/`<exclude>`
      the source had is stripped, because application packages install before
      content and a root-level filter is sufficient.
    - Everything else ("mutable") goes to `ui.content` and PRESERVES the source
      `<filter>` element's `<include>`/`<exclude>` children verbatim (via
      `_child_xml`) — a mutable filter with none is written bare too, but one
      that had include/exclude keeps it, so the modernized `ui.content` package
      is never broader than the legacy filter it replaces."""
    root = Path(project_root)
    tm = config["targetModules"]
    apps_entries: List[Tuple[str, Optional[str], List[str]]] = []
    content_entries: List[Tuple[str, Optional[str], List[str]]] = []
    pruned: List[str] = []
    for e in _read_source_filter_elements(root, config):
        r = e.attrib["root"]
        immutable = V.classify_filter_root(r) == "immutable"
        # CAM parity: skip a filter root that resolves to no content on disk
        # ("could not be resolved to valid content"). Safe -- prunes coverage of
        # nothing (see `_filter_root_resolves_to_content`). Only bare roots (no
        # include/exclude) are eligible: a root carrying include/exclude is a
        # deliberate narrowing the customer authored, kept as-is.
        if not _child_xml(e) and not _filter_root_resolves_to_content(root, tm, r, immutable):
            pruned.append(r)
            continue
        if immutable:
            # immutable → ui.apps: keep ONLY the root (strip include/exclude AND
            # any mode= attribute), per references/transform-rules.md §2.
            apps_entries.append((r, None, []))
        else:
            # mutable → ui.content: preserve include/exclude AND the source
            # filter's own mode= (update/merge). Dropping mode defaults the root
            # to `replace` on install, which can clobber existing author content
            # (/content, /conf) on deploy -- so it is carried through verbatim.
            content_entries.append((r, e.attrib.get("mode"), _child_xml(e)))
    _write_filter(root / tm["uiApps"] / "src/main/content/META-INF/vault/filter.xml", apps_entries)
    _write_filter(root / tm["uiContent"] / "src/main/content/META-INF/vault/filter.xml", content_entries)
    return pruned


def derive_structure_roots(filter_roots, app_id: str) -> List[str]:
    """Compute the `ui.apps.structure` FileVault filter roots (references/
    transform-rules.md §4): always seed `/apps` and `/apps/<app_id>`; for every
    filter root given, add every ANCESTOR of it with the LEAF segment dropped
    (e.g. `/libs/cq/core/content/nav/wknd` contributes `/libs`, `/libs/cq`,
    `/libs/cq/core`, `/libs/cq/core/content`, `/libs/cq/core/content/nav` — NOT
    the leaf `.../nav/wknd` itself; `/oak:index/damAssetLucene` contributes only
    `/oak:index`). Returns the union, sorted."""
    roots = {"/apps", f"/apps/{app_id}"}
    for fr in filter_roots:
        segs = [s for s in fr.strip("/").split("/") if s]
        cur = ""
        for seg in segs[:-1]:      # drop leaf
            cur += "/" + seg
            roots.add(cur)
    return sorted(roots)


def write_structure_roots(project_root, config: dict, roots: List[str]) -> None:
    """Populate `ui.apps.structure/pom.xml`'s FileVault plugin config with `roots`.

    The scaffolded template (`assets/archetype-pom-templates/ui.apps.structure/
    pom.xml`, rendered verbatim by `scaffold_modules.scaffold`) ships this exact
    shape:

        <configuration>
          <properties>
            <cloudManagerTarget>none</cloudManagerTarget>
          </properties>
          <filters />
        </configuration>

    i.e. `cloudManagerTarget` lives INSIDE a `<properties>` wrapper, and
    `<filters>` is an EMPTY self-closing element — it is NOT a bare anchor
    sitting next to `cloudManagerTarget`. This function replaces that empty
    `<filters />` (or `<filters/>`, no space) with a populated block, one
    `<filter><root>R</root></filter>` per root — never nests inside
    `<properties>` (reserved for FileVault packaging properties) and never
    leaves a duplicate empty `<filters />` behind.

    When any root starts with `/oak:index`, this also inserts
    `<allowIndexDefinitions>true</allowIndexDefinitions>` as a SIBLING of
    `<properties>`/`<filters>` — immediately after the `</properties>` close —
    which is the valid place for it in the FileVault plugin's config schema.
    Only inserted when an oak root is present.

    Deterministic string surgery, safe here because this is OUR OWN scaffolded
    template (Task B3/B9), not a customer POM (that rewrite is the Phase-2
    engine's job) — see the module docstring.

    Each root is XML-escaped via `escape` before being embedded as `<root>` element
    text (not an attribute, so `quoteattr` doesn't apply here) — a JCR name
    containing `&`, `<`, or `>` would otherwise produce a malformed pom.xml."""
    root = Path(project_root)
    tm = config["targetModules"]
    pom = root / tm["uiAppsStructure"] / "pom.xml"
    text = pom.read_text()

    filter_lines = "\n".join(f"            <filter><root>{escape(r)}</root></filter>" for r in roots)
    filters_block = f"<filters>\n{filter_lines}\n          </filters>"
    # lambda replacement (not a raw string) so a root containing e.g. a literal
    # backslash-digit sequence can never be misread as a regex backreference.
    # First try the empty archetype placeholder `<filters />` (the normal case: a
    # freshly-scaffolded ui.apps.structure). If that isn't present, the module was
    # NOT freshly scaffolded from our template -- e.g. a partly-modernized project
    # (umbrella) that already ships its own populated `ui.apps.structure/pom.xml` -- so
    # replace the existing populated `<filters>...</filters>` block instead, whose
    # roots we recompute from the modernized filters anyway.
    text, n = re.subn(r"<filters\s*/>", lambda _m: filters_block, text, count=1)
    if n == 0:
        text, n = re.subn(r"<filters>.*?</filters>", lambda _m: filters_block,
                          text, count=1, flags=re.DOTALL)
    if n == 0:
        raise ValueError(
            f"expected a <filters /> placeholder or a <filters>...</filters> block in "
            f"{pom}, none found")

    if any(r.startswith("/oak:index") for r in roots):
        marker = "</properties>"
        idx = text.index(marker)  # raises ValueError if the template shape is unexpected
        insert_at = idx + len(marker)
        text = (text[:insert_at]
                + "\n          <allowIndexDefinitions>true</allowIndexDefinitions>"
                + text[insert_at:])

    pom.write_text(text)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="repo-modernize content + filter split")
    ap.add_argument("root", help="target project root")
    ap.add_argument("--config", required=True, help="path to .modernize/config.json")
    ap.add_argument("--git", action="store_true",
                     help="use `git mv` to preserve file history (default: shutil.move)")
    a = ap.parse_args(argv)
    config = C.load_json(a.config)

    moved = move_content(a.root, config, use_git=a.git)

    src_roots = _read_source_filter_roots(Path(a.root), config)
    pruned = split_filters(a.root, config)
    # ui.apps.structure ancestors derive from the KEPT immutable roots only (a
    # pruned content-less root contributes no structure ancestors either).
    apps_roots = [r for r in src_roots
                  if V.classify_filter_root(r) == "immutable" and r not in pruned]
    structure_roots = derive_structure_roots(apps_roots, config["appId"])
    write_structure_roots(a.root, config, structure_roots)

    print(f"split: moved {len(moved)} top-level dir(s); "
          f"{len(apps_roots)} immutable / "
          f"{len([r for r in src_roots if V.classify_filter_root(r) != 'immutable' and r not in pruned])} mutable filter root(s); "
          f"{len(structure_roots)} ui.apps.structure root(s)"
          + (f"; {len(pruned)} content-less root(s) pruned (CAM parity)" if pruned else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
