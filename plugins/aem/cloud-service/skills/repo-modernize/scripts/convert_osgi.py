# scripts/convert_osgi.py
"""Relocate legacy OSGi configs into ui.config and convert them to `.cfg.json`.

The value conversion itself lives in `osgi_formats`, which reads each legacy format
exactly as AEM 6.x loaded it (FileVault DocView + Sling's JCR installer for
`sling:OsgiConfig`, Felix `ConfigurationHandler` for `.config`, `java.util.Properties`
for `.cfg`), so the converted file gives Configuration Admin the same typed values:
`{Boolean}true` -> `true`, `{Long}5` -> `5`, Felix `I"5"` -> `"key:Integer": 5`,
`.cfg` values stay strings. This module owns the file mechanics: where each config
goes, git history, de-duplication across app subtrees, and findings.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional
from xml.sax.saxutils import quoteattr

import osgi_formats as F
import rm_common as C

# The PID (factory PID prefix) Sling's repoinit OSGi service is registered
# under. Matched as a substring so factory-config suffixes (e.g. the trailing
# "-x" sling adds for a specific factory instance) don't break the check.
_REPOINIT_PID_MARKER = "org.apache.sling.jcr.repoinit.RepositoryInitializer"


def convert_value(raw: str):
    """Convert one sling:OsgiConfig attribute value to its `.cfg.json` value (typed per
    `osgi_formats.docview_to_json`). Returns None for a value AEM never applied."""
    _key, value, _notes = F.docview_to_json("value", raw)
    return value


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
    is left in place rather than crashing `_plan_file`."""
    return name != ".content.xml" and name.endswith(_CFG_FILE_SUFFIXES)


def xml_to_cfgjson(xml_path) -> dict:
    """The `.cfg.json` properties of a `sling:OsgiConfig` `.xml` file (see
    `osgi_formats.read_osgiconfig_xml`)."""
    return F.read_osgiconfig_xml(xml_path)[0]


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


class _Plan:
    """What happens to one source config file. `props` is set when it converts to
    `.cfg.json`; otherwise the file is relocated byte-for-byte under its own name."""

    def __init__(self, dest_name: str, kind: str, props=None, notes=None, error: Optional[str] = None):
        self.dest_name, self.kind = dest_name, kind
        self.props, self.notes, self.error = props, notes or [], error

    @property
    def converts(self) -> bool:
        return self.props is not None


def _plan_file(src: Path) -> _Plan:
    """Decide (and, for a convertible file, compute) the outcome for `src`, reading it
    but never writing anything -- so the git path can `git mv` straight to the right
    final name while the file still holds its original bytes.

    kinds: `cfgjson` (already target format, verbatim), `repoinit` (verbatim in any
    format -- CAM leaves repoinit configs unconverted), `legacy` (converted, or verbatim
    with `error` set when it cannot be read the way AEM read it)."""
    name = src.name
    if name.endswith(".cfg.json"):
        return _Plan(name, "cfgjson")
    if not name.endswith((".xml", ".config", ".cfg")):
        raise ValueError(f"unrecognized OSGi config file extension: {name!r}")
    if is_repoinit_pid(pid_of(name)):
        return _Plan(name, "repoinit")
    try:
        props, notes = F.read_legacy_config(src)
    except F.ConversionError as e:
        return _Plan(name, "legacy", error=str(e))
    return _Plan(pid_of(name) + ".cfg.json", "legacy", props=props, notes=notes)


def convert_file(src_path, dest_dir) -> tuple:
    """Write one legacy OSGi config's counterpart into `dest_dir`; the source is never
    touched. Returns `(dest_filename, converted)`: a readable `.xml`/`.config`/`.cfg`
    becomes `<pid>.cfg.json` (`converted=True`); an existing `.cfg.json`, a repoinit
    config, or a file that cannot be read is copied byte-for-byte (`converted=False`)."""
    src, dest = Path(src_path), Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    plan = _plan_file(src)
    if plan.converts:
        C.save_json(dest / plan.dest_name, plan.props)
        return plan.dest_name, True
    shutil.copy2(src, dest / plan.dest_name)
    return plan.dest_name, False


# ---------------------------------------------------------------------------
# Orchestration: move OSGi configs from the (already split) ui.apps module into
# ui.config, converting as they go; ensure ui.config's single fixed filter root.
# ---------------------------------------------------------------------------

# Skill-original finding codes, kept outside CAM's RM-1xx ranges (CAM's findings table
# and its separate error-code enum both use RM-1xx with different meanings).
_REPOINIT_NOTE_CODE = "RM-901"   # repoinit config relocated, deliberately unconverted
_OSGI_DEDUP_CODE = "RM-906"      # same PID+run-mode from several app subtrees
_OSGI_VALUE_CODE = "RM-907"      # value-level conversion note / file left unconverted


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


def _plan_matches_existing(src: Path, plan: _Plan, dest_path: Path) -> bool:
    """True iff `src` produces exactly what is already at `dest_path` -- a duplicate of a
    config relocated from a DIFFERENT app subtree (multi-brand projects copy the same
    PID under each brand), safe to dedup rather than a conflicting redefinition.
    Converted files compare as parsed properties, verbatim ones byte-for-byte."""
    if plan.converts:
        try:
            return plan.props == C.load_json(dest_path)
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
      - everything else is planned via `_plan_file` (parsed first, read-only), then
        relocated: with `use_git` by `git mv` straight to its final name and, if it
        converts, overwritten with its `.cfg.json` content and re-staged; without git
        by writing the result and deleting the source. (`git log --follow` tracks files
        moved verbatim; a converted file's content is rewritten, so git records it as
        a new file -- its source path is in the RM-907/diff, not in rename detection.)
      - a repoinit config is relocated but deliberately left unconverted (CAM parity;
        RM-901 NORMAL); a file that cannot be read the way AEM read it is relocated
        unconverted under its own name (RM-907 HIGH); value-level notes (a type AEM
        ignored, a non-canonical boolean, ...) become one RM-907 finding per file.
    Every config folder this empties is removed (`_remove_if_empty`); an
    app folder that had NOTHING but config subfolders is removed too -- one
    that still holds other content (components, i18n, ...) is left in
    place.

    `ensure_filter_root` runs unconditionally at the end (even if zero files
    were found to move) -- ui.config's only reason to exist is to hold this
    tree, so its filter root is a fixed postcondition of running this step,
    per CAM Sec.6.2 ("only one filter root ... is added"), not something
    conditioned on finding actual files today.

    Returns the findings collected along the way (RM-901 / RM-906 / RM-907).
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
                    plan = _plan_file(f)
                    dest_path = dest_dir / plan.dest_name
                    rel = f.relative_to(root)
                    if dest_path.exists():
                        # Same PID + run-mode folder already relocated from a DIFFERENT app
                        # subtree (multi-brand projects share PIDs). Identical -> dedup;
                        # different -> keep the first, leave this one in place, flag HIGH.
                        if _plan_matches_existing(f, plan, dest_path):
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
                        if plan.converts:
                            C.save_json(dest_path, plan.props)
                            _git_add(dest_path, root)
                    else:
                        dest_dir.mkdir(parents=True, exist_ok=True)
                        if plan.converts:
                            C.save_json(dest_path, plan.props)
                        else:
                            shutil.copy2(f, dest_path)
                        f.unlink()
                    moved = f"{rel} -> {dest_path.relative_to(root)}"
                    if plan.kind == "repoinit":
                        findings.append(C.Finding(
                            _REPOINIT_NOTE_CODE, "NORMAL",
                            f"repoinit OSGi config relocated but deliberately left unconverted: {moved}"))
                    if plan.error:
                        findings.append(C.Finding(
                            _OSGI_VALUE_CODE, "HIGH",
                            f"OSGi config could not be converted ({plan.error}); relocated "
                            f"unconverted: {moved} -- fix the source and convert it to .cfg.json"))
                    if plan.notes:
                        worst = "HIGH" if any(p == "HIGH" for p, _ in plan.notes) else "NORMAL"
                        findings.append(C.Finding(
                            _OSGI_VALUE_CODE, worst,
                            f"{dest_path.relative_to(root)}: " + "; ".join(t for _, t in plan.notes)))
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
# (RM-108). This skill matches that exactly:
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

# CAM's own finding code for a run-mode folder that is not Cloud Service compatible
# (RM-108 UNSUPPORTED_RUN_MODE, HIGH) -- reused verbatim, not skill-original.
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
