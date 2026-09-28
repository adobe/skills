# scripts/validate.py
"""Filter-root classification + structural checks — the repo-modernize oracle (Phase 1).

`check_structural` covers the invariants that must hold on every Phase-1 output:
  - filter-root immutability (mutable-in-ui.apps / immutable-in-ui.content)
  - module-pom existence for all/ui.apps/ui.content/ui.config (missing-module)

`check_pom_shape` is deliberately SEPARATE and NOT called by `check_structural`: a source
content package whose name literally equals its target module name (the fixture's
ui.apps/ui.content, since those are already Maven modules the customer named the same as the
Cloud Service targets) is RETAINED as-is by idempotent `scaffold_modules` — it never overwrites
an existing pom.xml — so its legacy content-package-maven-plugin shape (no <packageType>, no
cloudManagerTarget) survives Phase 1 untouched. Rewriting that shape onto the customer's
existing ui.apps/ui.content poms is Phase-2 `refactor_poms` territory, not Phase 1's
inspect/scaffold/split. Gating the Phase-1 oracle on pom-shape would fail a correct Phase-1
result on a real legacy project. `check_pom_shape` is unit tested here and wired in behind an
off-by-default `--check-pom-shape` flag — this mirrors exactly how `check_all_embeds` below is
gated behind `--check-embeds`.

`check_all_embeds` is deliberately SEPARATE and NOT called by `check_structural`: Phase 1
does not refactor the customer's existing `all` pom (that's Phase 2), and `scaffold_modules`
is idempotent so it won't overwrite a pre-existing `all/pom.xml`. On a real legacy project the
pre-existing `all` predates `ui.config` and legitimately lacks that embed in Phase 1 — gating
the Phase-1 oracle on embedding would fail a correct Phase-1 result. `check_all_embeds` is unit
tested here and wired in behind an off-by-default `--check-embeds` flag.

`check_no_loss` (used by both Phase 1 and Phase 2, whenever `--inventory` is passed) has a
Phase-2 carve-out for `convert_osgi`'s legacy-OSGi-config RE-ENCODING (`.xml`/`.config`/`.cfg`
-> a freshly-written `.cfg.json`, moved out of ui.apps into ui.config) — see
`_is_reencoded_osgi_config`'s own comment block for the exact shape and why it is kept as
narrow as the pre-existing `EXEMPT_BASENAMES` (pom.xml/filter.xml) precedent.
"""
from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import List

import rm_common as C

IMMUTABLE = ("/apps", "/libs", "/oak:index")


def classify_filter_root(root: str) -> str:
    r = root.strip().rstrip("/") or "/"
    return "immutable" if any(r == p or r.startswith(p + "/") for p in IMMUTABLE) else "mutable"


@dataclass
class Violation:
    kind: str
    path: str
    message: str


def _filter_roots(filter_xml: Path) -> List[str]:
    if not filter_xml.exists():
        return []
    return [e.attrib["root"] for e in ET.parse(str(filter_xml)).iter()
            if e.tag.split("}")[-1] == "filter" and "root" in e.attrib]


def _expected_embed(config, module_key) -> str:
    """Expected embedded artifactId for a target sub-module in `all`:
    "<config.artifactId>.<module-dir-name>", e.g. "aem-guides-wknd.ui.config"."""
    return f'{config["artifactId"]}.{config["targetModules"][module_key]}'


def check_structural(project_root, config) -> List[Violation]:
    """Structural invariants only — the Phase-1 gate. Does NOT check pom-shape (packageType /
    cloudManagerTarget — see check_pom_shape) or embedding in `all` (see check_all_embeds)."""
    root = Path(project_root)
    tm = config["targetModules"]
    out: List[Violation] = []

    def filt(mod):
        return root / mod / "src/main/content/META-INF/vault/filter.xml"

    for r in _filter_roots(filt(tm["uiApps"])):
        if classify_filter_root(r) == "mutable":
            out.append(Violation("mutable-in-ui.apps", str(filt(tm["uiApps"])), f"mutable root {r} in ui.apps"))
    for r in _filter_roots(filt(tm["uiContent"])):
        if classify_filter_root(r) == "immutable":
            out.append(Violation("immutable-in-ui.content", str(filt(tm["uiContent"])), f"immutable root {r} in ui.content"))

    for mod in (tm["all"], tm["uiApps"], tm["uiContent"], tm["uiConfig"]):
        pom = root / mod / "pom.xml"
        if not pom.exists():
            out.append(Violation("missing-module", str(pom), f"{mod} pom missing"))

    return out


def check_pom_shape(project_root, config) -> List[Violation]:
    """Cloud Service POM shape — packageType-per-module + cloudManagerTarget=none.
    SEPARATE from check_structural and NOT part of the Phase-1 gate (see module docstring):
    a legacy module whose source content-package name equals its target module name is
    retained as-is by idempotent `scaffold_modules` and keeps its legacy pom shape through
    Phase 1 — rewriting it is Phase-2 `refactor_poms` work. Module-pom existence is
    check_structural's job, not this function's: a missing pom is silently skipped here
    rather than re-flagged."""
    root = Path(project_root)
    tm = config["targetModules"]
    out: List[Violation] = []

    want_pkg = {tm["all"]: "container", tm["uiApps"]: "application",
                tm["uiContent"]: "content", tm["uiConfig"]: "container"}
    for mod, pkg in want_pkg.items():
        pom = root / mod / "pom.xml"
        if not pom.exists():
            continue  # existence is check_structural's job
        if C.pom_text(pom, "packageType") != pkg:
            out.append(Violation("wrong-packageType", str(pom), f"{mod} packageType != {pkg}"))

    for mod in (tm["uiApps"], tm["uiContent"], tm["uiConfig"]):
        pom = root / mod / "pom.xml"
        if pom.exists() and "none" not in C.pom_all_text(pom, "cloudManagerTarget"):
            out.append(Violation("missing-cloudManagerTarget", str(pom), f"{mod} lacks cloudManagerTarget none"))

    return out


# COVERAGE GAP: exempting pom.xml/filter.xml by basename means no-loss cannot see
# *content* dropped inside a rewritten file of either kind (e.g. a mutable filter's
# `<include>` that split_filters silently failed to carry over) — only the file's
# existence is guarded, by check_structural, not its contents. Closing that gap
# (e.g. a filter-content diff check) is not implemented in Phase 1.
EXEMPT_SUBSTRINGS = ("uber-jar", "/target/")
EXEMPT_BASENAMES = ("pom.xml", "filter.xml")

# --- convert_osgi re-encoding carve-out (Phase 2, Task C3) -----------------
#
# Same shape of problem as EXEMPT_BASENAMES above, one stage later: `convert_osgi.
# move_and_convert` RE-ENCODES a legacy `sling:OsgiConfig` `.xml` file (and any Felix
# `.config`/`.cfg` properties file) into a freshly-written `.cfg.json` while relocating
# it from `<uiApps>/.../apps/<app>/config*/` into ui.config's `osgiconfig/` tree — see
# that module's own docstring (CAM Sec.6.2). The BYTES change (XML/properties text ->
# JSON), so the baseline sha256 captured by `inspect_project.capture_inventory` (before
# any of this ran) is never found among current files, same false "content-lost" shape
# `EXEMPT_BASENAMES` already exists to prevent for pom.xml/filter.xml.
#
# Deliberately as NARROW as that precedent — this does NOT blanket-exempt every OSGi
# config file convert_osgi touches, only the ones whose BYTES it actually rewrites:
#   - an EXISTING `.cfg.json` is moved byte-for-byte VERBATIM (`convert_file`'s own
#     "kind == cfgjson" branch) — its baseline sha IS still found post-move, so it stays
#     under no-loss's normal watch (excluded here on purpose: NOT in
#     _REENCODED_OSGI_CONFIG_EXTENSIONS).
#   - the repoinit `sling:OsgiConfig` `.xml` (PID `org.apache.sling.jcr.repoinit.
#     RepositoryInitializer...`) is also relocated VERBATIM, never converted
#     (`convert_osgi.is_repoinit_pid` / `move_and_convert`'s "kind == repoinit" branch)
#     — its baseline sha is unaffected by the move too, so it ALSO stays under no-loss's
#     watch. `_REPOINIT_PID_MARKER` duplicates the one substring `convert_osgi.py`'s own
#     `_REPOINIT_PID_MARKER`/`is_repoinit_pid` key off of, as a plain literal — this file
#     does not import convert_osgi (validate.py has no dependency on it and this
#     carve-out must not create one); the substring is small and stable enough (Sling's
#     own fixed OSGi PID name) that duplicating it here is cheaper than a cross-module
#     coupling for one string.
# Leaving the two verbatim-move cases under no-loss's normal hash check (rather than
# exempting them too) is intentional, not an oversight: it means a genuine future bug
# that DROPS a repoinit file or an already-.cfg.json file during the move would still be
# caught here. Only the actually-re-encoded files need this carve-out.
#
# Keyed off path SHAPE + extension (mirroring how EXEMPT_BASENAMES keys off basename)
# rather than re-parsing file contents — `check_no_loss` only ever asks "is this
# baseline file's hash explainable as a legitimate, already-understood rewrite", never
# "did the rewrite itself do the right thing". Proving the CONVERTED output actually
# exists and looks right (real `.cfg.json` under the right Cloud-valid runmode folder)
# is `scripts/test_integration_phase2.py`'s own job (its osgiconfig assertions), not
# this function's — exactly the same division of labor `check_structural` already has
# with `EXEMPT_BASENAMES` (existence of a rewritten pom/filter is check_structural's
# job, not check_no_loss's).
_REENCODED_OSGI_CONFIG_EXTENSIONS = (".xml", ".config", ".cfg")
_REPOINIT_PID_MARKER = "org.apache.sling.jcr.repoinit.RepositoryInitializer"


def _is_reencoded_osgi_config(path: str, config) -> bool:
    """True iff `path` (an inventory baseline path, `/`-joined relative to the project
    root) matches the shape `convert_osgi.move_and_convert` re-encodes:
    `<root>/apps/<app>/.../config*/<file>`, where `<root>` is a source content package's
    `jcr_root` (or the modernized `ui.apps` module's) and `<file>` is a `sling:OsgiConfig`
    `.xml` or Felix `.config`/`.cfg` file — EXCLUDING the repoinit `.xml` (verbatim move,
    see module comment above) and the config folder's own `.content.xml` FileVault node
    descriptor (never moved into ui.config at all — `move_and_convert` explicitly skips
    it, "never an OSGi PID file").

    The candidate `<root>`s are every source content package's `jcrRoot`
    (`config["contentPackages"]`) PLUS the modernized `ui.apps` module's own jcr_root
    (`config["targetModules"]["uiApps"]`). The SOURCE roots are what actually match a
    baseline inventory path (the inventory is captured pre-split, so an OSGi config still
    carries its ORIGINAL content-package path — e.g. `globex.ui.apps/.../apps/brand-a/
    config.test2/Foo.config.xml`, NOT the target `ui.apps` name); the target root is kept
    too, both for robustness and so a config whose source package name already equals the
    target (`ui.apps`, the wknd fixture) still matches. The file's IMMEDIATE parent must
    be the `config*` run-mode folder, but it may sit at ANY depth beneath `<app>` (e.g.
    `apps/<app>/runmodes/config.dev/<file>`, `apps/das/<site>/config.prod/<file>`) —
    `move_and_convert` recurses to find run-mode folders nested under an intermediate
    directory, so this exemption follows it. Because it keys on the BASELINE path shape,
    it holds even when Stage 5 RENAMES the run-mode folder (`config.uat` -> `config.stage`
    via the runmode-restructure delegation) or DEDUPLICATES a duplicate config across app
    subtrees (RM-906): the converted/deduped bytes are simply not the concern of a
    per-baseline-file hash check."""
    roots = []
    for cp in (config or {}).get("contentPackages", []):
        jr = cp.get("jcrRoot")
        if jr:
            roots.append(jr.rstrip("/"))
    ui_apps = (config or {}).get("targetModules", {}).get("uiApps")
    if ui_apps:
        roots.append(f"{ui_apps}/src/main/content/jcr_root")
    normalized = path.replace("\\", "/")
    for root in roots:
        prefix = f"{root}/apps/"
        if not normalized.startswith(prefix):
            continue
        parts = normalized[len(prefix):].split("/")
        if len(parts) < 2:      # need at least <config-dir>/<file>
            continue
        cfg_dir = parts[-2]     # the file's IMMEDIATE parent (the config* run-mode folder)
        filename = parts[-1]
        if not cfg_dir.startswith("config"):
            continue
        if filename == ".content.xml":
            continue
        if not filename.endswith(_REENCODED_OSGI_CONFIG_EXTENSIONS):
            continue
        if filename.endswith(".xml") and _REPOINIT_PID_MARKER in filename:
            continue
        return True
    return False


def check_no_loss(project_root, inventory, config) -> List[Violation]:
    """Every baseline file must be present *somewhere* by hash (moves are fine).

    Exemptions:
      - EXEMPT_SUBSTRINGS: intentional drops — uber-jar (replaced by aem-sdk-api) and
        build output under /target/.
      - EXEMPT_BASENAMES (pom.xml, filter.xml): `split_content` legitimately (re)writes
        a `filter.xml` in place — e.g. when a source package name equals a target module
        name (ui.apps/ui.content in the fixture) — and `scaffold`/`split` (re)write module
        poms. Those rewrites change the file's hash, so the baseline hash would never be
        found among current files, producing a false "content-lost". Existence of the
        rewritten module poms/filters is guarded elsewhere by check_structural, so no-loss
        should not police them here.
      - `_is_reencoded_osgi_config` (Phase 2): `convert_osgi` re-encodes a legacy OSGi
        config file's bytes on its way into ui.config — see that helper's own comment
        block above for the exact shape and why the two VERBATIM-move cases (repoinit
        `.xml`, pre-existing `.cfg.json`) are deliberately NOT included here.
    """
    root = Path(project_root)
    present = {C.sha256_file(p) for p in C.iter_files(root)}
    out: List[Violation] = []
    for entry in inventory.get("files", []):
        if any(s in entry["path"] for s in EXEMPT_SUBSTRINGS):
            continue
        if Path(entry["path"]).name in EXEMPT_BASENAMES:
            continue
        if _is_reencoded_osgi_config(entry["path"], config):
            continue
        if entry["sha256"] not in present:
            out.append(Violation("content-lost", entry["path"],
                                 f"baseline file {entry['path']} not found at any destination by hash"))
    return out


def check_all_embeds(project_root, config) -> List[Violation]:
    """Each of ui.apps/ui.content/ui.config must be embedded in `all`.
    SEPARATE from check_structural — not part of the Phase-1 gate (see module docstring)."""
    root = Path(project_root)
    tm = config["targetModules"]
    out: List[Violation] = []

    all_pom = root / tm["all"] / "pom.xml"
    embedded = set(C.pom_all_text(all_pom, "artifactId")) if all_pom.exists() else set()
    for key in ("uiApps", "uiContent", "uiConfig"):
        art = _expected_embed(config, key)
        if art not in embedded:
            out.append(Violation("not-embedded-in-all", str(all_pom), f"{art} not embedded in all"))

    return out


def main(argv=None) -> int:
    """CLI entry point — the Phase-1 oracle gate.

    Exit codes: 0 = clean, 1 = violations found, 2 = usage/IO error (e.g. config load
    failure — missing file (OSError) or malformed JSON (ValueError/JSONDecodeError)).

    Gate composition:
      - check_structural always runs.
      - check_no_loss runs only when --inventory is given AND --structural-only is not set.
      - check_pom_shape runs ONLY when --check-pom-shape is passed explicitly. It is OFF by
        default: a real legacy project's ui.apps/ui.content retain their pre-existing pom shape
        through Phase 1 (idempotent scaffold never overwrites them), so rewriting packageType/
        cloudManagerTarget onto them is Phase-2 `refactor_poms` work (see module docstring /
        check_pom_shape). Gating the Phase-1 oracle on pom-shape by default would fail a
        correct Phase-1 result.
      - check_all_embeds runs ONLY when --check-embeds is passed explicitly. It is OFF by
        default: Phase 1 does not refactor the customer's existing `all` pom, so a real legacy
        project's pre-existing `all` can legitimately lack a ui.config embed in Phase 1 (see
        module docstring / check_all_embeds). Gating the Phase-1 oracle on embedding by default
        would fail a correct Phase-1 result.
    """
    ap = argparse.ArgumentParser(description="repo-modernize structural + no-loss oracle")
    ap.add_argument("root")
    ap.add_argument("--config", required=True)
    ap.add_argument("--inventory")
    ap.add_argument("--json")
    ap.add_argument("--structural-only", action="store_true")
    ap.add_argument("--check-pom-shape", action="store_true",
                     help="also enforce packageType-per-module + cloudManagerTarget=none "
                          "(off by default in Phase 1 — see check_pom_shape)")
    ap.add_argument("--check-embeds", action="store_true",
                     help="also enforce ui.apps/ui.content/ui.config embedding in `all` "
                          "(off by default in Phase 1 — see check_all_embeds)")
    a = ap.parse_args(argv)

    try:
        config = C.load_json(a.config)
        inventory = C.load_json(a.inventory) if a.inventory else None
    except (OSError, ValueError) as e:
        # ValueError covers json.JSONDecodeError (a ValueError subclass): malformed
        # JSON must exit 2 (usage/IO error) like a missing/unreadable file, not
        # escape as an uncaught traceback.
        print(f"error: {e}", file=sys.stderr)
        return 2

    vs = check_structural(a.root, config)
    if not a.structural_only and inventory is not None:
        vs += check_no_loss(a.root, inventory, config)
    if a.check_pom_shape:
        vs += check_pom_shape(a.root, config)
    if a.check_embeds:
        vs += check_all_embeds(a.root, config)

    report = {"ok": not vs, "violations": [v.__dict__ for v in vs]}
    if a.json:
        C.save_json(a.json, report)

    for v in vs:
        print(f"[{v.kind}] {v.path}: {v.message}")
    print(f"{'PASS' if not vs else 'FAIL'}: {len(vs)} violation(s)")
    return 0 if not vs else 1


if __name__ == "__main__":
    raise SystemExit(main())
