# scripts/convert_osgi.py
"""sling:OsgiConfig attribute value -> .cfg.json value conversion (CAM §6.3 rules).

Reproduces the value-encoding CAM's Repository Modernizer uses when it turns a
legacy sling:OsgiConfig node's typed attributes into Cloud Manager's flat
.cfg.json format -- minus CAM's own formatter bug of blindly stripping leading
and trailing characters off the whole string. Every strip/unescape here is
targeted (a leading "{Type}" hint, an escape sequence) rather than positional.

Encoding recap:
- "[...]"      -> a multi/array value. The interior is split on commas that are
                  NOT escaped (a backslash-comma "\\," is a literal comma inside
                  one element, not a separator).
- "[]"         -> an explicitly empty array.
- anything else -> a scalar. Scalars stay JSON strings even when they carry a
                  type hint like "{Boolean}true" or "{Long}5" -- only the hint
                  is stripped, the value itself is not coerced to bool/int.

Each element/scalar may carry a leading "{Type}" hint (e.g. "{Boolean}",
"{Long}", "{String}") that gets dropped, and may contain the escapes
"\\{" -> "{" / "\\}" -> "}" (braces are escaped because unescaped "{...}" at
the start of a value looks like a type hint). Array elements additionally
unescape "\\," -> "," (comma escaping only matters inside an array, so it is
only undone there).
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List
from xml.sax.saxutils import quoteattr

import rm_common as C

# A type hint is one leading {Word} at position 0 -- e.g. {Boolean}, {Long}.
# Anchored with ^ so it can only ever strip a *leading* hint, never a
# coincidental "{Word}" substring elsewhere in the value.
_TYPE_HINT = re.compile(r"^\{[A-Za-z]+\}")

# The PID (factory PID prefix) Sling's repoinit OSGi service is registered
# under. Matched as a substring so factory-config suffixes (e.g. the trailing
# "-x" sling adds for a specific factory instance) don't break the check.
_REPOINIT_PID_MARKER = "org.apache.sling.jcr.repoinit.RepositoryInitializer"


def _unescape_braces(s: str) -> str:
    """Undo the "\\{" / "\\}" escaping used so a literal "{" doesn't get
    mistaken for the start of a {Type} hint."""
    return s.replace(r"\{", "{").replace(r"\}", "}")


def _strip_type_hint(s: str) -> str:
    """Drop one leading "{Type}" hint, if present. No-op otherwise."""
    return _TYPE_HINT.sub("", s)


def _decode_scalar(s: str) -> str:
    """Decode a plain value or a single array element that has already been
    comma-unescaped: strip a leading {Type} hint, then unescape braces."""
    return _unescape_braces(_strip_type_hint(s))


def _split_unescaped_commas(inner: str) -> list:
    """Split `inner` on commas not preceded by a backslash.

    A single left-to-right scan tracking whether the current char is escaped;
    an escaped comma is kept (still escaped, as "\\,") in the current element
    so the caller can unescape it once, consistently with brace-unescaping.
    """
    parts, buf, escaped = [], [], False
    for ch in inner:
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
            buf.append(ch)
        elif ch == ",":
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def convert_value(raw: str):
    """Convert one sling:OsgiConfig attribute value into its JSON equivalent.

    See module docstring for the encoding rules. Returns a `list` for an
    array value (`[]` for an explicitly empty one) or a `str` for a scalar.
    """
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        if inner.strip() == "":
            return []
        elements = []
        for part in _split_unescaped_commas(inner):
            elements.append(_decode_scalar(part.replace(r"\,", ",")).strip())
        return elements
    return _decode_scalar(raw)


def is_repoinit_pid(pid: str) -> bool:
    """True iff `pid` names (a factory instance of) Sling's repoinit
    RepositoryInitializer service."""
    return _REPOINIT_PID_MARKER in pid


# ---------------------------------------------------------------------------
# File handlers (Task A2): xml/.config/.cfg -> .cfg.json, repoinit + existing
# .cfg.json left verbatim. Reuses convert_value/is_repoinit_pid above.
# ---------------------------------------------------------------------------

# Suffixes a legacy OSGi config filename may carry, longest/most-specific
# first. `.cfg.json` MUST be checked before the plain `.cfg` -- and neither
# can be found via a generic "last dot" split (`os.path.splitext`): an OSGi
# PID is itself dot-separated (e.g. "com.x.Foo"), so stripping anything other
# than one of these four exact literal strings would mangle it.
_CFG_FILE_SUFFIXES = (".cfg.json", ".xml", ".config", ".cfg")


def _is_osgi_config_file(name: str) -> bool:
    """True iff `name` is a relocatable OSGi config file: it carries one of the
    recognized suffixes (`.cfg.json`/`.xml`/`.config`/`.cfg`) and is NOT the
    FileVault node descriptor `.content.xml` (which ends in `.xml` but is the
    folder's own node, never an OSGi PID file).

    This is the gate that keeps the recursive `config*` scan from mistaking a
    NON-OSGi folder merely named `config` for a run-mode folder — e.g. a
    frontend clientlib's `.../styles/config/` holding only `_constants.scss`
    (real: the globex project), or any other `config` folder whose contents
    aren't OSGi configs. `.scss`/`.js`/`.less`/… match no suffix → the folder
    is skipped, and any stray non-config file inside a genuine run-mode folder
    is left in place rather than crashing `_plan_move`."""
    return name != ".content.xml" and name.endswith(_CFG_FILE_SUFFIXES)


def _local_name(tag: str) -> str:
    """The local (unprefixed) part of an ElementTree tag/attribute key --
    `{http://www.jcp.org/jcr/1.0}primaryType` -> `primaryType`; a key with no
    namespace is returned unchanged."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _is_namespaced(attr_key: str) -> bool:
    """True for an ElementTree attribute key that carries a namespace --
    Clark-notation `{uri}local` (e.g. `jcr:primaryType` parses to
    `{http://www.jcp.org/jcr/1.0}primaryType`) -- or, defensively, a literal
    `xmlns`/`xmlns:*` declaration. `ET`'s default (expat) parser never
    actually surfaces namespace declarations as attributes -- they're
    consumed to build the Clark-notation keys -- but checking costs nothing
    and matches the brief's wording ("drop ... any namespace ... attr")
    literally."""
    return attr_key.startswith("{") or attr_key.startswith("xmlns")


def xml_to_cfgjson(xml_path) -> dict:
    """Parse a `sling:OsgiConfig` `jcr:root` element's attributes into a
    `.cfg.json`-shaped dict.

    Namespace-agnostic via local-name matching: every attribute is read by
    its LOCAL name, not a hardcoded namespace URI, so this doesn't care which
    prefix the source document happens to bind to the jcr/sling namespaces.
    Two kinds of attributes are dropped rather than carried into the result:
      - any NAMESPACED attribute at all (`jcr:primaryType`, or hypothetically
        any other `jcr:`/`sling:`-prefixed structural attribute) -- these
        describe the JCR node itself, never an OSGi config property;
      - a bare (unnamespaced) attribute literally named `primaryType`, for
        the same reason, in case it is ever present unprefixed.
    Every remaining attribute is a genuine OSGi config property; its value is
    run through `convert_value` (the `{Type}`-hint / `[...]`-array rules).
    """
    root = ET.parse(str(xml_path)).getroot()
    cfg = {}
    for key, value in root.attrib.items():
        if _is_namespaced(key):
            continue
        local = _local_name(key)
        if local == "primaryType":
            continue
        cfg[local] = convert_value(value)
    return cfg


def pid_of(filename: str) -> str:
    """Strip one trailing OSGi-config-file suffix, leaving the bare PID.

    Checked in order `.cfg.json`, `.xml`, `.config`, `.cfg` (see
    `_CFG_FILE_SUFFIXES`) via plain literal-string `endswith`/slice -- never
    a generic extension split, which would misread the dots inside a
    dot-separated PID as extension separators.
    """
    for suffix in _CFG_FILE_SUFFIXES:
        if filename.endswith(suffix):
            return filename[: -len(suffix)]
    return filename


def _felix_props_to_cfgjson(path) -> dict:
    """Parse a Felix `.config`/`.cfg` properties file -- one `key=value` pair
    per line, blank lines and `#`/`!`-comment lines ignored -- into a
    `.cfg.json`-shaped dict. Each value is run through `convert_value`, the
    same `{Type}`-hint / `[...]`-array encoding a sling:OsgiConfig XML
    attribute value uses, so a Felix-side `[a,b]` or `{Boolean}true` decodes
    identically whether it arrived via XML or via this format. A line with no
    `=` is ignored rather than raised on (defensive; not expected in a
    well-formed export)."""
    cfg = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("!"):
                continue
            key, sep, value = stripped.partition("=")
            if not sep:
                continue
            cfg[key.strip()] = convert_value(value.strip())
    return cfg


def convert_file(src_path, dest_dir) -> tuple:
    """Handle one legacy OSGi config file: produce its `.cfg.json`-shaped (or
    verbatim) counterpart inside `dest_dir`. Returns `(dest_filename,
    converted)`:

      - `sling:OsgiConfig` `.xml`, non-repoinit PID: parsed via
        `xml_to_cfgjson` and written as `<pid>.cfg.json` (`rm_common.
        save_json`, sorted keys) -- `converted=True`.
      - `sling:OsgiConfig` `.xml`, REPOINIT PID (`is_repoinit_pid`): copied
        byte-for-byte into `dest_dir` under its ORIGINAL filename (still
        `.xml`) -- `converted=False`. Repoinit factory configs are never
        rewritten -- CAM's own conversion leaves them alone too -- and in
        every real project this PID ships as `sling:OsgiConfig` XML, never as
        a bare Felix `.config`/`.cfg` file, so the repoinit check only
        applies on the `.xml` branch.
      - Felix `.config`/`.cfg` (`key=value` lines): parsed via
        `_felix_props_to_cfgjson` and written as `<pid>.cfg.json` -- same
        `rm_common.save_json`, sorted keys -- `converted=True`.
      - an EXISTING `.cfg.json`: already in the target shape, copied
        byte-for-byte under its original filename -- `converted=False`.

    This never reads or writes anything at `src_path` other than the copy
    itself -- the source file is left exactly where it is, untouched, never
    deleted. Relocating/removing the now-superseded source (`git mv` when
    history must be preserved, or dropping an emptied source folder) is the
    ORCHESTRATION layer's job (Task A3's `move_and_convert`), not this
    per-file primitive's.
    """
    src = Path(src_path)
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    name = src.name

    if name.endswith(".cfg.json"):
        shutil.copy2(src, dest / name)
        return name, False

    if name.endswith(".xml"):
        pid = pid_of(name)
        if is_repoinit_pid(pid):
            shutil.copy2(src, dest / name)
            return name, False
        dest_name = pid + ".cfg.json"
        C.save_json(dest / dest_name, xml_to_cfgjson(src))
        return dest_name, True

    if name.endswith(".config") or name.endswith(".cfg"):
        dest_name = pid_of(name) + ".cfg.json"
        C.save_json(dest / dest_name, _felix_props_to_cfgjson(src))
        return dest_name, True

    raise ValueError(f"convert_file: unrecognized OSGi config file extension: {src_path!r}")


# ---------------------------------------------------------------------------
# Orchestration (Task A3): move OSGi configs from the (Phase-1-split) ui.apps
# module into ui.config, converting as they go; ensure ui.config's single
# fixed filter root; CLI. Reuses convert_value/is_repoinit_pid/pid_of/
# xml_to_cfgjson/convert_file (Tasks A1/A2) for every actual conversion
# decision -- this section only adds the FILE-RELOCATION mechanics (git
# history, emptied-folder cleanup, filter-root bookkeeping) around them.
# ---------------------------------------------------------------------------

# A skill-original finding code for the repoinit-left-unconverted note below.
# Deliberately NOT one of CAM's own RM-1xx numbers: CAM's FindingsReporter
# table only runs up to RM-108 (UNSUPPORTED_RUN_MODE -- reserved for Task A4 /
# the runmode-restructure skill's own finding), and CAM's SEPARATE ErrorCode
# (exception) enum independently reuses RM-100..122 for unrelated meanings
# (cam-repo-modernizer-analysis.md notes the two enums "share the RM-1xx
# numbers with different meanings"). A number well outside either range
# avoids ever colliding with a real CAM code.
_REPOINIT_NOTE_CODE = "RM-901"

# Skill-original finding for the multi-app OSGi-config dedup/conflict case (see
# `move_and_convert`): the next free RM-9xx after RM-905. Multi-brand projects
# (e.g. globex: apps/brand-a/config + apps/globex/config) file the SAME PID
# under several app subtrees; flattening them into one `apps/<appId>/osgiconfig/
# <runmode>/` collides. Identical copies are deduplicated (NORMAL); a genuine
# conflicting redefinition of the same PID+run-mode is surfaced (HIGH) rather
# than silently overwritten (which is what CAM's own copy-based move does).
_OSGI_DEDUP_CODE = "RM-906"


def _plan_move(name: str):
    """Decide a source OSGi config file's destination filename and, when
    content conversion is needed, which raw format to re-parse it as.

    Mirrors `convert_file`'s own 4-way suffix dispatch (deliberately kept in
    sync with it -- see that function's docstring) but returns the decision
    only, without reading or writing anything. `move_and_convert`'s
    git-history-preserving path needs this decision BEFORE the file is
    relocated -- so it can `git mv` straight to the final name/path while
    the file still holds its ORIGINAL bytes (see that function's docstring)
    -- `convert_file` can't serve that purpose itself, since it always
    freshly writes into a given dest dir and never touches its source. The
    non-git fallback path still calls `convert_file` directly for the actual
    write, so this small duplication never becomes a second source of truth
    for the conversion itself -- only for which of the 4 filename cases
    applies, which is a handful of `endswith` checks.

    Returns `(dest_name, kind)`:
      - `kind == "xml"`      -- sling:OsgiConfig xml, needs `xml_to_cfgjson`.
      - `kind == "felix"`    -- Felix `.config`/`.cfg`, needs
                                `_felix_props_to_cfgjson`.
      - `kind == "repoinit"` -- repoinit xml, verbatim, worth a finding.
      - `kind == "cfgjson"`  -- already `.cfg.json`, verbatim, no finding.
    """
    if name.endswith(".cfg.json"):
        return name, "cfgjson"
    if name.endswith(".xml"):
        pid = pid_of(name)
        if is_repoinit_pid(pid):
            return name, "repoinit"
        return pid + ".cfg.json", "xml"
    if name.endswith(".config") or name.endswith(".cfg"):
        return pid_of(name) + ".cfg.json", "felix"
    raise ValueError(f"move_and_convert: unrecognized OSGi config file extension: {name!r}")


def _git_mv(src: Path, dst: Path, repo: Path) -> None:
    """Relocate one file via `git mv` (paths relative to `repo`, cwd=repo) --
    history-preserving, so `git log --follow` keeps working across the
    rename. Ensures `dst`'s parent exists first (required for `git mv` to
    accept a nested destination path). Mirrors `split_content.py`'s own
    `_mv` helper."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "mv", str(src.relative_to(repo)), str(dst.relative_to(repo))],
                    cwd=repo, check=True)


def _git_add(path: Path, repo: Path) -> None:
    """Stage `path` (relative to `repo`, cwd=repo) -- used after overwriting
    a just-`git mv`'d file with its converted content, so the staged blob
    reflects the final `.cfg.json`, not the momentarily-parked original."""
    subprocess.run(["git", "add", str(path.relative_to(repo))], cwd=repo, check=True)


def _remove_source(f: Path, repo: Path, use_git: bool) -> None:
    """Remove a source OSGi config file that is a duplicate of one already
    relocated (see the dedup path in `move_and_convert`). `git rm` when
    `use_git` (staged, history-aware), else a plain unlink."""
    if use_git:
        subprocess.run(["git", "rm", "-q", "-f", str(f.relative_to(repo))],
                        cwd=repo, check=True)
    else:
        f.unlink()


def _converted_matches_existing(src: Path, kind: str, dest_path: Path) -> bool:
    """True iff converting `src` (per `kind`) yields content structurally
    identical to the already-present `dest_path` -- i.e. `src` is a duplicate of
    a config already relocated from a DIFFERENT source app subtree (multi-app/multi-brand
    projects routinely copy-paste the same PID under each brand), safe to dedup
    rather than a genuine conflicting redefinition of the same PID+run-mode.

    For converted kinds (`xml`/`felix`) the comparison is on the parsed
    `.cfg.json` value (a dict), so cosmetic source differences that convert to
    the same config count as duplicates; for verbatim kinds
    (`repoinit`/`cfgjson`) it is a raw byte compare."""
    if kind in ("xml", "felix"):
        produced = xml_to_cfgjson(src) if kind == "xml" else _felix_props_to_cfgjson(src)
        try:
            return produced == C.load_json(dest_path)
        except (OSError, ValueError):
            return False
    try:
        return src.read_bytes() == dest_path.read_bytes()
    except OSError:
        return False


def _remove_if_empty(d: Path) -> None:
    """Remove directory `d` if it exists and now has no remaining files or
    subfolders -- used to drop emptied `config*` source folders and (when it
    held nothing but those) the `apps/<x>` app folder above them. A folder
    that still holds other content (or a leftover entry this step doesn't
    recognize) is left in place, untouched."""
    if d.is_dir() and not any(d.iterdir()):
        d.rmdir()


def _prune_empty_upward(start: Path, stop: Path) -> None:
    """Remove `start` if empty, then walk UP removing each now-empty ancestor
    until (but not including) `stop`.

    Used after a run-mode `config*` folder is emptied: with nested layouts
    (`apps/<app>/runmodes/config*`) the intermediate grouping folder
    (`runmodes/`) is left empty once all its `config*` children are relocated,
    and should be cleaned up too -- not just the leaf `config*` folder the flat
    scan used to handle. `stop` (the app dir) is never removed here; the caller
    handles it separately. A folder still holding other content (e.g. its own
    `.content.xml`) is not empty, so the walk stops there, untouched."""
    cur = start
    while cur != stop and cur.is_dir() and not any(cur.iterdir()):
        parent = cur.parent
        cur.rmdir()
        cur = parent


def _read_filter_roots(filter_xml: Path) -> List[str]:
    """Every `<filter root="...">` attribute in `filter_xml`, namespace-
    agnostic (same tag match as `split_content.py`/`validate.py`). `[]` if
    the file doesn't exist yet."""
    if not filter_xml.exists():
        return []
    return [e.attrib["root"] for e in ET.parse(str(filter_xml)).iter()
            if e.tag.split("}")[-1] == "filter" and "root" in e.attrib]


def ensure_filter_root(filter_xml, root: str) -> bool:
    """Ensure `filter_xml`'s workspaceFilter declares `root` as a bare
    `<filter root="..."/>`, creating the file fresh if it doesn't exist yet.

    Mirrors `split_content.py`'s `_write_filter` bare-entry XML shape (same
    prolog, same 4-space indent, same `quoteattr` escaping) -- kept as a
    small LOCAL helper rather than reaching into that module's own private
    function, since ui.config's filter has a much simpler job here (append
    one fixed root if it's missing) than a full source-filter-driven
    rewrite.

    Idempotent / non-duplicating: if `root` is already declared, this is a
    no-op (returns False) -- re-running `move_and_convert` never appends a
    second copy. Any OTHER pre-existing `<filter>` entries are preserved
    (as bare roots) ahead of the new one. Returns True iff the file was
    created or modified.
    """
    path = Path(filter_xml)
    existing = _read_filter_roots(path)
    if root in existing:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<workspaceFilter version="1.0">']
    for r in existing:
        lines.append(f'    <filter root={quoteattr(r)}/>')
    lines.append(f'    <filter root={quoteattr(root)}/>')
    lines += ['</workspaceFilter>', '']
    path.write_text("\n".join(lines))
    return True


def move_and_convert(project_root, config: dict, use_git: bool = True) -> List[C.Finding]:
    """CAM Sec.6.2 OSGi config segregation: relocate + convert every OSGi
    config file out of the (already Phase-1-split) `ui.apps` module's
    `apps/<*>/config*` folders into `ui.config`, as `apps/<appId>/
    osgiconfig/<runmodeFolder>/<destName>`; delete the folders this empties;
    ensure `ui.config`'s filter.xml declares the single `/apps/<appId>/
    osgiconfig` root.

    Reads from the MODERNIZED `ui.apps` module (`config["targetModules"]
    ["uiApps"]`) -- i.e. depends on Phase-1's `split_content.move_content`
    having already relocated content there -- NOT from the legacy
    `config["contentPackages"]` list, which by Phase 2 describes pre-split
    SOURCE packages, not where content currently lives on disk.

    The move rule (CAM Sec.6.2) is a literal `name.startswith("config")` on
    the immediate parent folder's OWN name -- matches `config`,
    `config.author`, `config.author.prod`, `config.qa`, and (per CAM's own
    documented behavior) even `configuration`. This is deliberately a loose
    prefix match, not a runmode-name allowlist -- validating/normalizing the
    runmode name itself is Task A4 / the runmode-restructure skill's job,
    not this one's; the run-mode folder name is preserved verbatim as the
    destination subfolder.

    For every file directly inside a matched config folder:
      - a bare `.content.xml` (the config FOLDER's own FileVault node
        descriptor -- e.g. an explicit `sling:Folder` primaryType -- never
        an OSGi PID file) is skipped/left in place; it doesn't belong in
        ui.config at all.
      - everything else is planned via `_plan_move` (mirrors `convert_file`'s
        own dispatch) and then, per `use_git`:
          - `use_git=True` (default): `git mv` straight to the final
            destination name/path -- history-preserving even across an
            `.xml`/`.config`/`.cfg` -> `.cfg.json` rename, because at the
            moment of the `git mv` the file still holds its ORIGINAL bytes;
            a file needing conversion (`kind in ("xml", "felix")`) is then
            re-parsed FROM that new location and overwritten in place with
            its `.cfg.json` content (`rm_common.save_json`, reusing
            `xml_to_cfgjson` / `_felix_props_to_cfgjson` from Task A2) and
            re-staged (`git add`); a verbatim file (`kind in ("repoinit",
            "cfgjson")`) needs no further write -- the moved bytes are
            already the exact right content.
          - `use_git=False`: copy-then-remove -- `convert_file` (Task A2)
            writes the final content straight into the destination
            directory, then the source file is deleted.
      - a REPOINIT `.xml` (`kind == "repoinit"`) is relocated but
        deliberately left UNCONVERTED (CAM Sec.6.2) -- recorded as a NORMAL
        `Finding` (see `_REPOINIT_NOTE_CODE`) rather than silently dropped,
        so a developer reviewing the diff knows it was a deliberate skip,
        not a missed file.
    Every config folder this empties is removed (`_remove_if_empty`); an
    app folder that had NOTHING but config subfolders is removed too -- one
    that still holds other content (components, i18n, ...) is left in
    place.

    `ensure_filter_root` runs unconditionally at the end (even if zero files
    were found to move) -- ui.config's only reason to exist is to hold this
    tree, so its filter root is a fixed postcondition of running this step,
    per CAM Sec.6.2 ("only one filter root ... is added"), not something
    conditioned on finding actual files today.

    Returns the findings collected along the way (currently just the
    repoinit-left-unconverted notes).
    """
    root = Path(project_root)
    tm = config["targetModules"]
    app_id = config["appId"]
    apps_dir = root / tm["uiApps"] / "src/main/content/jcr_root/apps"
    osgiconfig_base = (root / tm["uiConfig"] / "src/main/content/jcr_root"
                        / "apps" / app_id / "osgiconfig")

    findings: List[C.Finding] = []
    if apps_dir.is_dir():
        for app_dir in sorted(p for p in apps_dir.iterdir() if p.is_dir()):
            # Find every run-mode OSGi config folder (name starts "config") at
            # ANY depth beneath the app dir -- some projects nest them under an
            # intermediate grouping folder (e.g. `apps/<app>/runmodes/config*`,
            # as acme-portal does) or under a per-site subtree (e.g.
            # `apps/das/<site>/config.prod`, as globex does), which a
            # direct-children-only scan silently misses. A folder qualifies ONLY
            # if it holds at least one recognized OSGi config file
            # (`_is_osgi_config_file`) -- so a folder merely NAMED `config` whose
            # contents aren't OSGi configs (a frontend clientlib's
            # `.../styles/config/_constants.scss`; a structural JCR node with just
            # a `.content.xml`) is never mistaken for a run-mode folder.
            cfg_dirs = sorted(
                (p for p in app_dir.rglob("*")
                 if p.is_dir() and p.name.startswith("config")
                 and any(c.is_file() and _is_osgi_config_file(c.name)
                         for c in p.iterdir())),
                key=lambda p: str(p))
            for cfg_dir in cfg_dirs:
                dest_dir = osgiconfig_base / cfg_dir.name
                for f in sorted(p for p in cfg_dir.iterdir() if p.is_file()):
                    # Skip the folder's own node descriptor AND any stray
                    # non-OSGi file (leaving it in place) -- only recognized
                    # config files are relocated/converted.
                    if not _is_osgi_config_file(f.name):
                        continue
                    dest_name, kind = _plan_move(f.name)
                    dest_path = dest_dir / dest_name
                    if dest_path.exists():
                        # A config with this PID + run-mode-folder-name was
                        # already relocated from a DIFFERENT source app subtree
                        # (multi-app/multi-brand projects share PIDs). Never
                        # crash on the collision, never silently overwrite:
                        #  - identical converted content -> dedup (drop the
                        #    duplicate source; the first copy already carries it).
                        #  - different content -> a genuine conflicting
                        #    redefinition of one PID+run-mode: keep the first,
                        #    leave this source in place, and surface it HIGH so a
                        #    human resolves which value wins.
                        rel = f.relative_to(root)
                        if _converted_matches_existing(f, kind, dest_path):
                            findings.append(C.Finding(
                                _OSGI_DEDUP_CODE, "NORMAL",
                                f"duplicate OSGi config deduplicated: {rel} is identical to "
                                f"an already-relocated config at {dest_path.relative_to(root)}"))
                            _remove_source(f, root, use_git)
                        else:
                            findings.append(C.Finding(
                                _OSGI_DEDUP_CODE, "HIGH",
                                f"conflicting OSGi config for the same PID+run-mode: {rel} "
                                f"differs from the already-relocated {dest_path.relative_to(root)}; "
                                "left in place -- resolve which value applies"))
                        continue
                    if use_git:
                        _git_mv(f, dest_path, root)
                        if kind == "xml":
                            C.save_json(dest_path, xml_to_cfgjson(dest_path))
                            _git_add(dest_path, root)
                        elif kind == "felix":
                            C.save_json(dest_path, _felix_props_to_cfgjson(dest_path))
                            _git_add(dest_path, root)
                    else:
                        convert_file(f, dest_dir)
                        f.unlink()
                    if kind == "repoinit":
                        findings.append(C.Finding(
                            _REPOINIT_NOTE_CODE, "NORMAL",
                            "repoinit OSGi config relocated but deliberately left "
                            f"unconverted: {f.relative_to(root)} -> {dest_path.relative_to(root)}"))
                # Prune the emptied `config*` folder AND any now-empty
                # intermediate grouping folder (e.g. `runmodes/`) up to the app
                # dir -- not just the leaf folder the flat scan used to handle.
                _prune_empty_upward(cfg_dir, app_dir)
            _remove_if_empty(app_dir)

    filter_xml = root / tm["uiConfig"] / "src/main/content/META-INF/vault/filter.xml"
    if ensure_filter_root(filter_xml, f"/apps/{app_id}/osgiconfig") and use_git:
        _git_add(filter_xml, root)

    return findings


# ---------------------------------------------------------------------------
# Orchestration (Task A4): flag non-Cloud run-mode folders (CAM parity).
#
# CAM's Repository Modernizer is DETECT-ONLY for run modes: it relocates the OSGi
# config folders verbatim (preserving their original names) and raises an RM-108
# (UNSUPPORTED_RUN_MODE) finding for any folder whose name is not a valid AEM as a
# Cloud Service run mode -- it never renames or merges them
# (cam-repo-modernizer-analysis.md Sec.11: "Run-mode handling is detect-only
# (RM-108) -- no user-directed rename/merge"). This skill matches that exactly:
# `move_and_convert` (Task A3) already preserves each run-mode folder name
# verbatim, and `flag_noncloud_runmodes` below only INSPECTS the relocated tree
# and reports. Crucially this means NO customer config is ever lost by collapsing
# two conflicting run modes (e.g. `config.test` + `config.preprod`, which
# legitimately hold DIFFERENT values) into one Cloud run mode -- a real data-loss
# hazard of actually renaming/merging. Renaming/merging run modes is a separate,
# human-directed concern (the standalone `runmode-restructure` skill exists for
# exactly that) and is deliberately OUT OF SCOPE here: repo-modernize reproduces
# the CAM tool's outcome, no more.
# ---------------------------------------------------------------------------

# CAM's own FindingsReporter code for a run-mode folder that is not Cloud Service
# compatible (cam-repo-modernizer-analysis.md: "RM-108 UNSUPPORTED_RUN_MODE =
# HIGH") -- reused verbatim, not skill-original.
_RUNMODE_FINDING_CODE = "RM-108"

# The run-mode tokens AEM as a Cloud Service actually honors: the two service run
# modes (author/publish) and the three environment run modes (dev/stage/prod). A
# valid OSGi config folder is one of: `config`; `config.<service>` or
# `config.<environment>` (one token); or `config.<service>.<environment>` (service
# FIRST, then environment). ORDER matters: `config.author.prod` is valid but
# `config.prod.author` is NOT (environment-before-service) -- CAM flags the latter
# RM-108. Anything else -- `config.test`, `config.qa`, `config.local`,
# `config.dev.publish`, three-plus tokens, ... -- is flagged RM-108, exactly as
# CAM does.
_SERVICE_RUNMODES = frozenset({"author", "publish"})
_ENV_RUNMODES = frozenset({"dev", "stage", "prod"})


def _is_cloud_runmode_folder(name: str) -> bool:
    """True iff `name` is a valid AEM as a Cloud Service OSGi config folder name,
    matching CAM's own run-mode validation (which checks token VALIDITY *and*
    ORDER):

    - `config` (default) -- valid.
    - one token: `config.<t>` where `t` is a service (author/publish) OR an
      environment (dev/stage/prod).
    - two tokens: `config.<service>.<environment>` -- service FIRST, then
      environment (e.g. `config.author.prod`). The reverse (`config.prod.author`)
      is INVALID, as are two services / two environments.
    - three or more tokens -- invalid.
    """
    if not name.startswith("config"):
        return False
    rest = name[len("config"):]
    if rest == "":
        return True
    if not rest.startswith("."):
        return False
    tokens = rest[1:].split(".")
    if len(tokens) == 1:
        return tokens[0] in _SERVICE_RUNMODES or tokens[0] in _ENV_RUNMODES
    if len(tokens) == 2:
        return tokens[0] in _SERVICE_RUNMODES and tokens[1] in _ENV_RUNMODES
    return False


def flag_noncloud_runmodes(project_root, config: dict) -> List[C.Finding]:
    """Detect-and-flag (CAM parity): raise an RM-108 finding for every relocated
    run-mode folder under ui.config's `osgiconfig` tree whose name is not a valid
    AEMaaCS run mode -- WITHOUT renaming or merging anything (see this section's
    header for why merging is deliberately out of scope and a data-loss hazard).
    One finding per DISTINCT non-compliant folder name (deduped -- unlike CAM's
    own no-dedup reporter, which emits one per source instance). Returns `[]` when
    the osgiconfig dir doesn't exist yet (no OSGi configs were relocated) or every
    folder is already Cloud-compatible."""
    root = Path(project_root)
    tm = config["targetModules"]
    app_id = config["appId"]
    osgiconfig_dir = (root / tm["uiConfig"] / "src/main/content/jcr_root"
                       / "apps" / app_id / "osgiconfig")
    if not osgiconfig_dir.is_dir():
        return []
    bad = sorted({p.name for p in osgiconfig_dir.iterdir()
                  if p.is_dir() and not _is_cloud_runmode_folder(p.name)})
    return [C.Finding(
        _RUNMODE_FINDING_CODE, "HIGH",
        f"run-mode folder '{name}' is not an AEM as a Cloud Service run mode "
        "(honored: author/publish/dev/stage/prod); relocated as-is -- renaming/"
        "merging run modes is a manual follow-up, not done here") for name in bad]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="repo-modernize OSGi config segregation + conversion")
    ap.add_argument("root", help="target project root")
    ap.add_argument("--config", required=True, help="path to .modernize/config.json")
    ap.add_argument("--git", action="store_true",
                     help="use `git mv` to preserve file history (default: copy-then-remove)")
    a = ap.parse_args(argv)
    config = C.load_json(a.config)

    findings = move_and_convert(a.root, config, use_git=a.git)
    findings.extend(flag_noncloud_runmodes(a.root, config))

    # Persist into the shared .modernize/findings.json (merged + deduped with the
    # Phase-1 findings inspect_project wrote, and later merged again by
    # refactor_poms) so convert_osgi's RM-108/RM-901/RM-906 appear in the final
    # findings report -- matching CAM, whose report includes the run-mode findings.
    findings_path = C.manifest_path(a.root, "findings.json")
    prior = []
    if findings_path.exists():
        try:
            prior = [C.Finding(**d) for d in C.load_json(findings_path).get("findings", [])]
        except (OSError, ValueError, TypeError):
            prior = []
    merged = C.dedup_findings(prior + findings)
    C.save_json(findings_path, {"findings": [f.__dict__ for f in merged]})

    print(f"convert_osgi: OSGi config segregation done; {len(findings)} finding(s)")
    for f in findings:
        print(f"  [{f.priority}] {f.code}: {f.detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
