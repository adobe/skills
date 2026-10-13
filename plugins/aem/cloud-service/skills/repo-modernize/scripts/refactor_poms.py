# scripts/refactor_poms.py
"""Bundle/content/all/reactor POM refactor via `pom_engine` (Phase-2 Task B2
started this module; Task B3 adds the CONTENT-PACKAGE refactor; Task B4 adds
the `all`-pom refactor; Task B5 adds the reactor/parent pom refactor; Task B6
adds the `main()` CLI that orchestrates all four in the right order and
merges the findings they raise into Phase-1's own `.modernize/findings.json`
-- see `main` at the bottom of this file.

`refactor_bundle_pom` applies CAM's `uber-jar` -> `aem-sdk-api` rule
(`references/transform-rules.md` Sec.6) at the BUNDLE level: `aem-sdk-api`
itself is pre-seeded on the archetype template at the reactor/parent level
(Task B5), so this function only ever DROPS `com.adobe.aem:uber-jar` here --
it never adds a replacement dependency.

It also detects the legacy Felix `maven-scr-plugin` / `maven-bundle-plugin`
pair (`references/manual-followups.md` Sec.1) and raises a HIGH finding
instead of touching them: the modern archetype's bundle module builds with
`bnd-maven-plugin`, but porting a Felix `<instructions>` block
(Import-Package, Sling-Model-Packages, ...) into a `bnd-maven-plugin` `<bnd>`
block is a semantic rewrite, not a mechanical one -- so it is flagged for a
human / the `code-assessment` skill, and the Felix plugins are LEFT IN PLACE
(removing them without porting their instructions would silently break the
bundle manifest). Bundle modernization itself is out of scope for
repo-modernize.

`refactor_content_pom` applies the content-package -> filevault conversion
(`references/transform-rules.md` Sec.5, `manual-followups.md`) to a `ui.apps`
or `ui.content` module pom, producing the archetype's own TWO-PLUGIN shape
(verified byte-for-byte against `assets/archetype-pom-templates/
{ui.apps,ui.content}/pom.xml`, both of which keep both plugins):

1. The legacy `com.day.jcr.vault:content-package-maven-plugin` plugin is
   RESHAPED in place (same slot in `<plugins>`) down to just
   `<extensions>true</extensions>` -- its legacy `<configuration>`
   (`<filterSource>`, `<group>`, and the `<embeddeds>` that embeds e.g.
   `core` at `/apps/<appId>/install` -- Cloud Service embeds bundles in
   `all`, not `ui.apps`) is stripped, which is what drops the legacy embed.
   It is NOT removed and NOT renamed: `<packaging>content-package</packaging>`
   (a non-standard Maven packaging value) has no lifecycle mapping without
   SOME plugin declaring `<extensions>true</extensions>`, and the archetype
   keeps this plugin around, bare, purely for that binding -- `mvn package`
   cannot build the module otherwise. (An earlier version of this function
   renamed the legacy plugin's identity onto the filevault one instead of
   keeping both, which silently dropped this binding; see the "Fix round 1"
   section of the task report.)
2. `org.apache.jackrabbit:filevault-package-maven-plugin` is ADDED as a
   separate plugin, whose `<configuration>` is sourced verbatim from this
   module's own archetype template with only `{{groupId}}`/`{{artifactId}}`/
   `{{version}}` substituted for the customer's real coordinates -- never
   hand-built, so it carries the template's own indentation (see the
   module-level docstring note below on why that matters) and its
   packageType/cloudManagerTarget/repositoryStructurePackages shape matches
   the real Cloud Service archetype exactly.

Legacy `autoInstallPackage`/`autoInstallPackagePublish` `<profile>`s that
reference the legacy plugin are removed outright: each exists solely to
invoke that plugin's `install` goal against a legacy AEM instance's CRX
package manager URL (with `failOnMissingEmbed=true`, referencing the
embed that's now gone) -- a Cloud Service deployment mechanism the archetype
template has no equivalent of at all (neither template has a `<profiles>`
section). If the package's own content contains ACL authoring (a
`_rep_policy.xml` sidecar or an inline `<rep:policy>`/`rep:ACL` node -- the
real WKND fixture's `ui.content` has exactly this under `content/dam/wknd`),
`<accessControlHandling>merge_preserve</accessControlHandling>` is added and
a NORMAL finding is raised so a human notices ACL authoring survived the
conversion.

**Fix round 1** (caught by actually running `mvn` against the reshaped wknd
fixture, not by static inspection): steps 1-4 above reshape the *plugin*
XML correctly, but say nothing about the module's own `<dependencies>` --
which left two ways for the reshaped package to be structurally-plausible
but genuinely unbuildable. `refactor_content_pom` now also:

5. **Declares** a `type=zip` `<dependency>` matching the package its own
   injected filevault `<configuration>` references
   (`_ensure_content_module_dependency` -- `uiApps` -> `<parentArtifactId>.
   ui.apps.structure`; `uiContent` -> `<parentArtifactId>.ui.apps`).
   Without this, the config is referencing a package the module never
   declared as a Maven dependency at all, and
   `filevault-package-maven-plugin:validate-files` fails outright: *"...
   ui.apps.structure was not found among the Maven dependencies of this
   project"* (verified against the real fixture before this fix existed).
   Coordinates come from the SAME `config["groupId"]`/`config["artifactId"]`/
   `config["version"]` substitution `_template_plugin_configuration_xml`
   itself uses, so the two references can never drift apart.
6. **Drops** any top-level `<dependency>` on one of the project's OWN
   reactor bundle modules (`_drop_project_bundle_dependencies` --
   `config["bundles"]`, the same source/naming `refactor_all_pom` uses to
   EMBED those same bundles into `all`). Neither archetype content template
   declares any such dependency -- Cloud Service embeds a bundle into `all`
   only -- and a lingering one is worse than merely wrong-shaped: it drags
   the bundle into ANY `-am` reactor build of this content module, which is
   what made `mvn -pl <content modules> -am clean package` fail trying to
   compile the legacy `core` bundle on a modern JDK, a module that build
   should never have needed to touch at all.

Both functions use only `pom_engine`'s named primitives (`load`, `save`,
`find_first`, `drop_dependency`, `merge_dependencies`, `pretty_insert`,
`set_child_text`, `ensure_plugin`) for every tree mutation -- this module
never imports `lxml` itself and never
hand-rolls serialization. `ensure_plugin`'s own pretty-printing only reshapes
~1 level deep (the plugin's immediate groupId/artifactId/configuration
children) -- anything nested INSIDE a hand-built `<configuration>` would
otherwise collapse to a dense one-liner, which is exactly why
`refactor_content_pom` never builds `<configuration>` by hand: the template
text it extracts already contains real newlines/indentation for every
nested element, so the parsed tree is multi-line from the moment
`etree.fromstring` (called inside `pom_engine.ensure_plugin`, not here)
builds it -- pretty-printing the OUTER plugin placement is the only thing
left for `pom_engine` to do.

Read-only inspection below (Felix-plugin detection, bundle-identity
comparison, legacy-plugin/profile detection) walks the plain Element objects
`pom_engine.load` hands back with a small local namespace-agnostic helper,
mirroring the pattern `pom_engine`'s own test suite already uses on those
same objects. The handful of plain-Element mutations this file does perform
directly (`<profiles>`/`<profile>` removal via `.remove()`, one small tail
whitespace fix-up) use only that same already-parsed-Element API -- nothing
here ever calls into the `lxml` package directly; every actual serialization
primitive (`etree.Element`/`etree.SubElement`/`etree.fromstring`/
`etree.tostring`) stays inside `pom_engine`.
"""
from __future__ import annotations

import argparse
import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List, Optional

import pom_engine as E
import rm_common as C

_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "archetype-pom-templates"

# A skill-original finding code (same pattern/rationale as convert_osgi.py's
# `_REPOINIT_NOTE_CODE`): deliberately NOT `RM-108`, even though an earlier
# shorthand for this task suggested it. `RM-108` is already a REAL CAM
# FindingsReporter code -- UNSUPPORTED_RUN_MODE, HIGH
# (cam-repo-modernizer-analysis.md's FindingsReporter table, RM-101..RM-108)
# -- reused verbatim by convert_osgi.py's `_RUNMODE_FINDING_CODE`. CAM's own
# FindingsReporter never had a code for Felix-SCR/bundle-plugin -> BND
# (`references/manual-followups.md` Sec.1 documents it as a skill-original
# manual follow-up, not a ported CAM finding) -- so reusing `RM-108` here
# would give ONE code two unrelated meanings inside this skill's own
# findings.json, exactly the confusion `_REPOINIT_NOTE_CODE`'s own comment
# was written to avoid. `RM-902` continues that skill-original numbering
# (`RM-901` is the only other one so far), safely outside both of CAM's real
# RM-1xx ranges (FindingsReporter AND the separate ErrorCode enum, both
# RM-100..122).
FELIX_TO_BND_FINDING_CODE = "RM-902"

# The legacy Felix bundle-build tandem (references/manual-followups.md
# Sec.1). Checked by artifactId alone: both names are Felix's own canonical
# artifacts (there is no other well-known groupId shipping a plugin
# literally named `maven-scr-plugin` or `maven-bundle-plugin`), and the
# brief's own phrasing treats them as a pair regardless of groupId.
_FELIX_PLUGIN_ARTIFACTS = ("maven-scr-plugin", "maven-bundle-plugin")


def _local(tag) -> str:
    """Strip a `{namespace}` prefix off an lxml tag, e.g.
    `{http://maven.apache.org/POM/4.0.0}plugin` -> `plugin`. Namespace-agnostic
    matching mirrors `pom_engine`'s own internal helper of the same name --
    duplicated here (rather than imported) so this module's only dependency
    on `pom_engine` is its named public primitives."""
    return tag.split("}", 1)[1] if isinstance(tag, str) and tag.startswith("{") else tag


def _direct_child(el, localname: str):
    """First DIRECT child of `el` matching `localname` (namespace-agnostic),
    or None. Unlike `pom_engine.find_first` (which searches `el` AND all its
    descendants in document order), this only looks one level down -- which
    is what distinguishes e.g. a bundle pom's own `<artifactId>` from the
    `<parent>` block's nested `<artifactId>` that precedes it in document
    order."""
    if el is None:
        return None
    for child in el:
        if isinstance(child.tag, str) and _local(child.tag) == localname:
            return child
    return None


def _direct_child_text(el, localname: str) -> Optional[str]:
    child = _direct_child(el, localname)
    return child.text if child is not None else None


def _has_felix_plugin(root) -> bool:
    """True if any `<plugin>` anywhere under `root` (a bundle module's own
    `<build>`, or a `<profile>`'s) is the legacy Felix `maven-scr-plugin` or
    `maven-bundle-plugin`. Walks every `<plugin>` in the document (not just
    the first) since a pom can declare several and the Felix one is not
    guaranteed to be first."""
    for el in root.iter():
        if isinstance(el.tag, str) and _local(el.tag) == "plugin":
            if _direct_child_text(el, "artifactId") in _FELIX_PLUGIN_ARTIFACTS:
                return True
    return False


def _expected_bundle_artifact_id(pom_path, root, config: dict) -> Optional[str]:
    """The `<parentArtifactId>.<moduleDir>` identity a bundle pom's own
    `<artifactId>` should hold (ports the Phase-0 prototype's
    `set_bundle_identity` naming convention, minus the caller having to
    already know the right answer).

    `<parentArtifactId>` is read from the pom's own `<parent>` block --
    self-contained, always present on a real bundle pom -- falling back to
    `config["artifactId"]` only if that block is somehow missing.
    `<moduleDir>` is the pom's own containing directory name: this is what
    `inspect_project.py` already uses 1:1 as a bundle's `artifactIdSuffix`
    (see `references/config-schema.md`'s `bundles[]` example and
    `inspect_project.py`'s `_[{"path": n, "artifactIdSuffix": n, ...}]`
    comprehension -- no bundle anywhere in this skill's fixtures has a
    suffix that differs from its directory name).

    Returns None when neither source yields a parent artifactId, so the
    caller treats "can't determine the expected identity" as a no-op rather
    than guessing.
    """
    parent_artifact_id = _direct_child_text(_direct_child(root, "parent"), "artifactId")
    if not parent_artifact_id:
        parent_artifact_id = (config or {}).get("artifactId")
    if not parent_artifact_id:
        return None
    module_dir = Path(pom_path).parent.name
    return f"{parent_artifact_id}.{module_dir}"


def _fix_bundle_identity_if_mismatched(pom_path, root, config: dict) -> None:
    """No-op unless the bundle's own `<artifactId>` actually disagrees with
    `_expected_bundle_artifact_id` -- e.g. the WKND fixture's `core` and
    `bundle2` are already correct, so this never touches them (binding
    constraint: don't gratuitously rewrite identity that is already right).

    Only `<artifactId>` is checked/rewritten; `<name>` has no formula to
    validate against -- it is free-form display text (e.g. "wknd - Core")
    -- so it is deliberately left alone."""
    expected = _expected_bundle_artifact_id(pom_path, root, config)
    if not expected:
        return
    current = _direct_child_text(root, "artifactId")
    if current != expected:
        E.set_child_text(root, "artifactId", expected)


def _ensure_module_version_matches_reactor(root, version: str) -> None:
    """Normalize a refactored module pom's `<parent><version>` (and its own
    top-level `<version>`, if it declares one) to the reactor's version.

    A legacy module that had been excluded from the reactor build (e.g. a
    commented-out `<module>ui.content</module>`) can carry a STALE parent
    version: the acme-portal real project's ui.content references parent
    `acme-portal:0.0.1` while the reactor is `:3.2.69-SNAPSHOT`. Once the module
    is wired back into the reactor (`_ensure_required_modules`), that mismatch
    makes Maven treat the parent as an external, unresolvable artifact
    ("Non-resolvable parent POM ... :0.0.1") and the whole build fails. Aligning
    it to `config["version"]` -- which the reactor and every scaffolded module
    already use -- fixes it while PRESERVING the customer's real version line
    (unlike CAM, which resets the entire project to the archetype's
    1.0.0-SNAPSHOT). Idempotent: a module already on the reactor version (e.g.
    the fixture's, and this project's own ui.apps) is rewritten to the identical
    value. `<parent>`/`<version>` absent -> that part is skipped. `version` may
    be `None` (a config without a `version` key) -> the whole alignment is a
    no-op, so callers can safely pass `config.get("version")`."""
    if version is None:
        return
    parent_el = _direct_child(root, "parent")
    if parent_el is not None:
        pv = _direct_child(parent_el, "version")
        if pv is not None:
            pv.text = version
    own_v = _direct_child(root, "version")
    if own_v is not None:
        own_v.text = version


def _ensure_bundle_sdk_api_dependency(root) -> None:
    """Declare a bare `com.adobe.aem:aem-sdk-api` `<dependency>` (no version/
    scope -- inherited from the reactor `<dependencyManagement>`, which the
    reactor refactor swaps `uber-jar` -> `aem-sdk-api` in) on a PRE-EXISTING
    bundle module after its `uber-jar` was dropped.

    The archetype pre-seeds `aem-sdk-api` on the bundle template -- but this
    skill edits a customer's OWN pre-existing bundle in place (it does NOT
    overwrite it from the template), so nothing pre-seeds it and the bundle
    would otherwise be left with NO AEM API surface at all (it had only
    `uber-jar`). CAM's own bundle handler adds the same replacement. Idempotent
    via `merge_dependencies`' (groupId, artifactId) key: a bundle that already
    declares `aem-sdk-api` is a no-op. Routed through the `<dependencies>`
    ELEMENT itself (`_ensure_dependencies_element`) for the same "target the
    specific container, not the whole tree" reason `_ensure_content_module_
    dependency` documents."""
    deps_el = _ensure_dependencies_element(root)
    dep_frag = _parse_fragment(
        "  <dependency>\n"
        f"    <groupId>{_AEM_SDK_API[0]}</groupId>\n"
        f"    <artifactId>{_AEM_SDK_API[1]}</artifactId>\n"
        "  </dependency>"
    )
    E.merge_dependencies(deps_el, dep_frag)


def refactor_bundle_pom(pom_path, config: dict) -> List[C.Finding]:
    """Refactor one bundle module's pom (CAM Sec.6-7,
    `references/transform-rules.md` Sec.6):

    1. Drop `com.adobe.aem:uber-jar` (the replacement, `aem-sdk-api`, is
       pre-seeded at the reactor/parent level by Task B5, not added here).
    2. If the legacy Felix `maven-scr-plugin`/`maven-bundle-plugin` pair is
       present, emit a HIGH finding (`FELIX_TO_BND_FINDING_CODE`) and
       otherwise leave it untouched -- porting its `<instructions>` into
       `bnd-maven-plugin` is a semantic rewrite
       (`references/manual-followups.md` Sec.1), out of scope for this
       skill's automatic transforms.
    3. Bundle identity (`artifactId`) is corrected ONLY if it is actually
       mismatched against `<parentArtifactId>.<moduleDir>` -- a no-op on
       every fixture pom seen so far.

    Returns the findings collected along the way (currently just the
    Felix->BND note: 0 or 1 entries)."""
    findings: List[C.Finding] = []
    tree, original = E.load(pom_path)
    root = tree.getroot()

    E.drop_dependency(tree, "com.adobe.aem", "uber-jar")
    # A PRE-EXISTING bundle (edited in place, not scaffolded from the archetype
    # template that pre-seeds aem-sdk-api) would be left with NO AEM API surface
    # once uber-jar is dropped -- declare the bare replacement so it can still
    # compile against the AEM APIs (CAM does the same swap in-bundle).
    _ensure_bundle_sdk_api_dependency(root)
    _ensure_module_version_matches_reactor(root, config.get("version"))

    if _has_felix_plugin(root):
        findings.append(C.Finding(
            FELIX_TO_BND_FINDING_CODE, "HIGH",
            "Felix maven-scr-plugin/maven-bundle-plugin -> migrate to BND "
            "(bnd-maven-plugin); manual / code-assessment hand-off: "
            f"{pom_path}"))

    _fix_bundle_identity_if_mismatched(pom_path, root, config)

    E.save(tree, pom_path, original)
    return findings


# ---------------------------------------------------------------------------
# Task B3: content-package -> filevault
# ---------------------------------------------------------------------------

# See FELIX_TO_BND_FINDING_CODE's own comment above for why this is a
# skill-original `RM-9xx` code rather than a real CAM `FindingsReporter`
# code: CAM has no code for "ACL authoring survived a filevault conversion"
# either (`references/manual-followups.md` documents it as a skill-original
# manual follow-up). `RM-901` is convert_osgi.py's repoinit note, `RM-902` is
# this file's own Felix->BND note (above) -- `RM-903` continues that same
# numbering.
ACL_HANDLING_FINDING_CODE = "RM-903"

_LEGACY_CONTENT_PLUGIN = ("com.day.jcr.vault", "content-package-maven-plugin")
_FILEVAULT_PLUGIN = ("org.apache.jackrabbit", "filevault-package-maven-plugin")

# module_key (the brief's `refactor_content_pom` parameter, matching
# config-schema.md's `targetModules` keys) -> the archetype-pom-templates
# subdirectory this skill ships that module's real Cloud Service `<plugin>`
# shape in. Deliberately just these two: `refactor_content_pom` is typed
# `module_key in {"uiApps","uiContent"}` per the brief -- `all`/`ui.config`
# have their own, differently-shaped conversions (Task B4, not this
# function).
_CONTENT_MODULE_TEMPLATE_DIR = {"uiApps": "ui.apps", "uiContent": "ui.content"}

# module_key -> the artifactId SUFFIX the module's OWN injected filevault
# <configuration> (`_template_plugin_configuration_xml`) references as a
# package dependency (Fix round 1 -- see `_ensure_content_module_dependency`
# below): `uiApps`' own `<repositoryStructurePackages>` entry points at
# `<parentArtifactId>.ui.apps.structure`; `uiContent`'s own inner
# `<dependencies><dependency>` points at `<parentArtifactId>.ui.apps` --
# both literal suffixes already live in the template text itself (see
# `_template_plugin_configuration_xml`'s own docstring), not a placeholder.
# Declaring the module's OWN top-level Maven `<dependency>` with this exact
# same suffix is what makes the two references agree BY CONSTRUCTION rather
# than by two independently-hand-kept-in-sync literals.
_CONTENT_MODULE_DEPENDENCY_SUFFIX = {"uiApps": "ui.apps.structure", "uiContent": "ui.apps"}


def _extract_element_block(text: str, tag: str, start: int = 0) -> str:
    """Return the substring `<tag ...>...</tag>` for the first `<tag`
    occurrence at or after `start` in `text`, depth-aware so a same-named
    tag that happens to nest inside itself still resolves to ITS OWN closing
    tag rather than the nearest `</tag>` (not exercised by either archetype
    template today -- `<configuration>` never nests inside itself in either
    -- but cheap to get right rather than assume). Plain string search only:
    this is read-only *template* text slicing, done before any XML parsing
    happens at all -- the actual parse of the extracted+substituted string
    happens later, inside `pom_engine.ensure_plugin` (via its own
    `_coerce_config_children`), not here."""
    open_marker = f"<{tag}"
    close_marker = f"</{tag}>"
    open_start = text.index(open_marker, start)
    pos = text.index(">", open_start) + 1
    depth = 1
    while depth > 0:
        next_open = text.find(open_marker, pos)
        next_close = text.find(close_marker, pos)
        if next_close == -1:
            raise ValueError(f"pom_engine template: unterminated <{tag}> at offset {open_start}")
        if next_open != -1 and next_open < next_close:
            depth += 1
            pos = text.index(">", next_open) + 1
        else:
            depth -= 1
            pos = next_close + len(close_marker)
    return text[open_start:pos]


def _template_plugin_configuration_xml(module_key: str, config: dict) -> str:
    """The filevault plugin's `<configuration>` for `module_key`, sourced
    VERBATIM from this skill's own `assets/archetype-pom-templates/<module>/
    pom.xml` -- never hand-built -- with only the `{{groupId}}`/
    `{{artifactId}}`/`{{version}}` placeholders substituted for the
    customer's real coordinates (`config["groupId"]`/`config["artifactId"]`/
    `config["version"]` -- the same three of `scaffold_modules.render`'s
    five recognized placeholder names that actually occur inside a filevault
    plugin's own `<configuration>` block in either template today: verified
    by grep, not assumed -- `ui.content`'s inner
    `<dependencies><dependency>` on `ui.apps` carries its OWN `{{version}}`,
    which is easy to miss since it's not one of the two the brief's own
    example calls out. The `.ui.apps`/`.ui.apps.structure`/`.ui.content`
    module-name suffixes are NOT placeholders -- they're already correct
    literal text in each module-specific template file, so picking the
    right template file by `module_key` is what makes them correct here,
    not a second round of substitution).

    A tiny local `.replace()` chain rather than importing
    `scaffold_modules.render`: that function's `config[key]` lookup is
    unconditional for any of its five recognized names that literally
    appear in the text, so reusing it here would newly require
    `config["appTitle"]` too (a key neither this function nor its callers
    otherwise need) even though `{{appTitle}}` never appears inside a
    filevault `<configuration>` block -- keeping this file's own
    `pom_engine`+`rm_common`-only dependency surface (see the module
    docstring) means only asking `config` for the three keys this
    conversion actually uses.

    Sourcing it this way (rather than composing `<packageType>`/
    `<cloudManagerTarget>`/etc. as individually-built elements) is what
    keeps the result multi-line: the extracted string already contains the
    template's own real newlines/indentation for every nested element, so
    the tree `pom_engine.ensure_plugin` parses it into is already
    pretty-printed from the moment it's parsed -- see this module's own
    docstring, "Avoid the dense one-liner trap"."""
    module_dir = _CONTENT_MODULE_TEMPLATE_DIR[module_key]
    template_path = _ASSETS_DIR / module_dir / "pom.xml"
    text = template_path.read_text(encoding="utf-8")
    anchor = text.index(f"<artifactId>{_FILEVAULT_PLUGIN[1]}</artifactId>")
    config_xml = _extract_element_block(text, "configuration", start=anchor)
    return (
        config_xml
        .replace("{{groupId}}", config["groupId"])
        .replace("{{artifactId}}", config["artifactId"])
        .replace("{{version}}", config["version"])
    )


def _inject_access_control_handling(config_xml: str) -> str:
    """Insert `<accessControlHandling>merge_preserve</accessControlHandling>`
    as the last child of the already-extracted, already-indented
    `<configuration>...</configuration>` string, matching its existing
    children's own indentation (derived from the closing tag's own line,
    rather than a hardcoded column count, so this works unchanged for both
    the `ui.apps` and `ui.content` templates) -- so it reads as one more
    pretty-printed sibling, not a bolted-on one-liner."""
    close_tag = "</configuration>"
    idx = config_xml.rfind(close_tag)
    if idx == -1:
        return config_xml  # defensive; config_xml always came from
                            # _extract_element_block("configuration"), which
                            # never returns a string lacking its own closer
    head = config_xml[:idx]
    line_start = head.rfind("\n") + 1
    closing_indent = head[line_start:]
    child_indent = closing_indent + "  "
    insertion = f"{child_indent}<accessControlHandling>merge_preserve</accessControlHandling>\n{closing_indent}"
    return head[:line_start] + insertion + config_xml[idx:]


def _has_acl_nodes(pom_path) -> bool:
    """True if this content package's own `jcr_root` contains ACL authoring:
    a filesystem-escaped `_rep_policy.xml` sidecar (Vault's escaping of a
    `rep:policy` child node -- a real node name can't contain `:` on disk)
    anywhere under it, or an XML file whose text mentions `rep:ACL` (the
    sidecar's own `jcr:primaryType`) or `rep:policy` (an inline reference to
    one, e.g. `<rep:policy/>` on the node it protects). Not full XML
    parsing -- plain substring search on already-small vault XML files is
    enough to answer "is there ACL authoring here at all", and this is a
    read-only detector, not a mutation.

    `pom_path`'s own containing directory is the module root
    (config-schema.md's `contentPackages[].jcrRoot` convention:
    `"<module>/src/main/content/jcr_root"`) -- self-contained, no `config`
    lookup needed. Missing directory (a crafted test pom with no content
    tree at all) is simply "no ACLs", not an error."""
    jcr_root = Path(pom_path).parent / "src" / "main" / "content" / "jcr_root"
    if not jcr_root.is_dir():
        return False
    for p in jcr_root.rglob("*"):
        if not p.is_file():
            continue
        if p.name == "_rep_policy.xml":
            return True
        if p.suffix == ".xml":
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if "rep:ACL" in text or "rep:policy" in text:
                return True
    return False


def _profile_references_legacy_plugin(profile_el) -> bool:
    """True if `profile_el` (a `<profile>` under the top-level `<profiles>`)
    declares, anywhere inside its own `<build>`, a `<plugin>` matching
    `_LEGACY_CONTENT_PLUGIN` -- the WKND fixture's `autoInstallPackage`/
    `autoInstallPackagePublish` shape, each of which exists solely to invoke
    that plugin's `install` goal against a legacy AEM instance's CRX package
    manager URL. Walks every `<plugin>` in the profile's subtree (mirrors
    `_has_felix_plugin`'s whole-subtree walk), not just a direct child,
    since a profile's plugin lives under `<build>/<plugins>/<plugin>`, two
    levels down."""
    for el in profile_el.iter():
        if not isinstance(el.tag, str) or _local(el.tag) != "plugin":
            continue
        if (_direct_child_text(el, "groupId") == _LEGACY_CONTENT_PLUGIN[0]
                and _direct_child_text(el, "artifactId") == _LEGACY_CONTENT_PLUGIN[1]):
            return True
    return False


def _drop_legacy_install_profiles(root) -> int:
    """Remove every `<profile>` under the top-level `<profiles>` whose own
    `<build>` references the legacy `com.day.jcr.vault:
    content-package-maven-plugin` (`autoInstallPackage`/
    `autoInstallPackagePublish` in the fixture). This is not just tidiness:
    each such profile exists solely to invoke that plugin's `install` goal
    directly against a legacy AEM instance's CRX package manager URL
    (`failOnMissingEmbed=true`, referencing the embed the main build
    conversion above just dropped) -- a legacy on-prem/AMS deployment
    mechanism Cloud Service has no equivalent of at all: neither archetype
    template (`assets/archetype-pom-templates/{ui.apps,ui.content}/pom.xml`)
    has a `<profiles>` section, even though BOTH keep the (bare)
    `content-package-maven-plugin` itself for its `<extensions>true</
    extensions>` lifecycle binding (see `refactor_content_pom`'s own
    docstring) -- so a profile surviving here would be dead weight
    regardless of whether the plugin it targets still exists in the main
    build.

    Only ever removes `<profile>` elements (via their own parent's
    `.remove()` -- a plain Element method, not an `lxml` import) and fixes
    up ONE tail so `</profiles>`'s own indentation survives if every profile
    was removed; `<profiles>` itself is deliberately left in place (even
    empty) rather than also spliced out of `<project>` -- that would mean
    touching `<project>`'s OWN children/comment siblings, exactly the wider
    "profile surgery" the brief calls out as fiddly and not worth the risk
    for a cosmetic-only win. Returns the count removed."""
    profiles_el = _direct_child(root, "profiles")
    if profiles_el is None:
        return 0
    children = list(profiles_el)
    if not children:
        return 0
    closing_tail = children[-1].tail
    removed = 0
    for profile_el in children:
        if not isinstance(profile_el.tag, str) or _local(profile_el.tag) != "profile":
            continue
        if _profile_references_legacy_plugin(profile_el):
            profiles_el.remove(profile_el)
            removed += 1
    if removed:
        remaining = list(profiles_el)
        if remaining:
            remaining[-1].tail = closing_tail
        else:
            profiles_el.text = closing_tail
    return removed


def _ensure_build_element(root):
    """The module pom's own top-level `<build>` element (creating an empty
    `<build><plugins></plugins></build>` and placing it as a new child of `root`
    if the pom lacks one). Both real content-package fixtures already declare a
    `<build>`, but a hand-minimal or unusual legacy content pom might not -- and
    `refactor_content_pom`'s `ensure_plugin` calls need a real `<build>` element
    to upsert into, so this guarantees one (same "fabricate the missing structural
    parent via _parse_fragment + pretty_insert" approach as
    `_ensure_dependencies_element`)."""
    build_el = _direct_child(root, "build")
    if build_el is not None:
        return build_el
    frag = _parse_fragment("  <build>\n    <plugins>\n    </plugins>\n  </build>")
    new_build = E.find_first(frag, "build")
    E.pretty_insert(root, new_build)
    return new_build


def _ensure_dependencies_element(root):
    """The module pom's own top-level (direct child of `<project>`)
    `<dependencies>` element, creating an empty one and placing it as a new
    child of `root` first if the pom doesn't have one at all. Not exercised
    by either real fixture pom (`ui.apps`/`ui.content` both already declare
    one), but IS exercised by this file's own crafted tests (a minimal
    hand-built pom with only `<build>`) -- so, like every other "no
    `pom_engine` primitive fabricates a missing structural parent" helper in
    this file (`_ensure_aem_sdk_api_dependency`, `_ensure_property`,
    `_ensure_required_modules`), this builds the correct EMPTY shape via
    `_parse_fragment` and places it with `pom_engine.pretty_insert` rather
    than reaching past `pom_engine`'s primitives for a hand-rolled
    `etree.SubElement` call."""
    deps_el = _direct_child(root, "dependencies")
    if deps_el is not None:
        return deps_el
    frag = _parse_fragment("  <dependencies>\n  </dependencies>")
    new_deps = E.find_first(frag, "dependencies")
    E.pretty_insert(root, new_deps)
    return new_deps


def _ensure_content_module_dependency(root, module_key: str, config: dict) -> None:
    """Fix round 1, Fix 1 (Critical): declare the module's OWN top-level
    `type=zip` Maven `<dependency>` on the package its just-injected
    filevault `<configuration>` references
    (`_CONTENT_MODULE_DEPENDENCY_SUFFIX`) -- WITHOUT this, the injected
    config references a package the module never declares as a Maven
    dependency at all, and `filevault-package-maven-plugin:validate-files`
    fails outright: *"...ui.apps.structure was not found among the Maven
    dependencies of this project"* for `uiApps`, the identical failure class
    for `uiContent`'s own reference to `...ui.apps`. Verified by actually
    running `mvn` against the real wknd fixture before this fix existed --
    see the task report's own captured log tail.

    Coordinates are taken from the SAME three `config` keys
    (`groupId`/`artifactId`/`version`) that `_template_plugin_configuration_
    xml` itself substitutes into that same filevault `<configuration>` --
    never re-derived from the pom's own `<parent>` block (unlike
    `_expected_bundle_artifact_id`'s approach for a BUNDLE's identity) --
    specifically so the declared dependency and the config reference it
    satisfies can never drift apart from two independently-computed answers.

    Routed through `pom_engine.merge_dependencies` with `dst` set to the
    `<dependencies>` ELEMENT ITSELF (`_ensure_dependencies_element`), not the
    whole tree/root: `merge_dependencies` finds its merge target via
    `find_first(dst_root, "dependencies")`, a whole-subtree, document-order
    walk -- and on the REAL fixture pom, the module's own top-level
    `<dependencies>` sits AFTER `<build>` in document order, while `<build>`
    now ALSO contains the filevault plugin's own freshly-injected
    `<configuration><dependencies>` (an unrelated, package-relationship
    block -- for `uiContent` it even holds a same-shaped `<dependency>` on
    `...ui.apps`). Passing `root` (or the tree) as `dst` would therefore let
    `find_first` match THAT inner block first and silently corrupt it
    instead of ever reaching the real top-level dependency list. An
    Element's own `.iter()` always yields itself first, so handing
    `merge_dependencies` the `<dependencies>` element directly makes
    `find_first` resolve to exactly that element regardless of where it
    falls in document order -- the same "target the specific container, not
    the whole tree" defense `_ensure_aem_sdk_api_dependency` already uses
    for `<dependencyManagement>` (see that function's own docstring), here
    applied one level closer to the element actually being merged into.

    Idempotent by construction: `merge_dependencies` only ever appends a
    dependency whose (groupId, artifactId) key isn't already present in the
    destination `<dependencies>` block, so a second call is a no-op."""
    suffix = _CONTENT_MODULE_DEPENDENCY_SUFFIX[module_key]
    deps_el = _ensure_dependencies_element(root)
    dep_frag = _parse_fragment(
        "  <dependency>\n"
        f'    <groupId>{config["groupId"]}</groupId>\n'
        f'    <artifactId>{config["artifactId"]}.{suffix}</artifactId>\n'
        f'    <version>{config["version"]}</version>\n'
        "    <type>zip</type>\n"
        "  </dependency>"
    )
    E.merge_dependencies(deps_el, dep_frag)


def _drop_project_bundle_dependencies(tree, config: dict) -> None:
    """Fix round 1, Fix 2: drop this content module's own top-level
    `<dependency>` on any of the project's reactor BUNDLE modules
    (`config["bundles"]`) -- the exact same source, and the exact same
    `<parentArtifactId>.<bundle-dir>` naming (`_bundle_module_dir`), that
    `refactor_all_pom` already uses to EMBED these same bundles into `all`.

    Neither archetype content template (`assets/archetype-pom-templates/
    {ui.apps,ui.content}/pom.xml`) declares any such dependency: Cloud
    Service embeds a project's own bundle(s) into `all` ONLY (Task B4), not
    into a content package, and this same file's `refactor_content_pom`
    already drops the LEGACY `<embeddeds>` that used to express this exact
    relationship (see that function's own docstring, step 1). A lingering
    top-level Maven `<dependency>` on the bundle is vestigial baggage from
    before that split -- and worse than merely wrong-shaped: it drags the
    bundle (and, via any `-am` reactor build, everything else not-yet-
    modernized about it -- e.g. `refactor_bundle_pom`'s own Felix->BND
    hand-off) into ANY `-am` build of this content module, which is exactly
    what made the content-package build milestone unreachable before this
    fix (confirmed by actually running `mvn -pl <content modules> -am clean
    package` against the real wknd fixture pre-fix: it failed trying to
    compile `core` on a modern JDK, a module this build should never have
    needed to touch at all -- see the task report's own captured log tail).

    Uses `pom_engine.drop_dependency` (idempotent by construction: a second
    call finds nothing left matching to remove) directly on `tree`, exactly
    as `refactor_bundle_pom` already does for `com.adobe.aem:uber-jar` --
    `drop_dependency`'s own contract is a whole-document sweep of every
    `<dependencies>` block, which is safe here because a bundle's own
    artifactId (e.g. `aem-guides-wknd.core`) never coincides with anything
    the filevault plugin's own injected `<configuration><dependencies>`
    block references (that one only ever names `...ui.apps`, never a
    bundle). External provided dependencies (`aem-api`, `jcr`, `servlet-
    api`, `cq-wcm-taglib`, ...) are untouched by construction: none of them
    is ever one of `config["bundles"]`'s own computed artifactIds."""
    group_id = config["groupId"]
    artifact_id = config["artifactId"]
    for bundle in config.get("bundles", []):
        bundle_dir = _bundle_module_dir(bundle)
        if not bundle_dir:
            continue
        E.drop_dependency(tree, group_id, f"{artifact_id}.{bundle_dir}")


def refactor_content_pom(pom_path, config: dict, module_key: str) -> List[C.Finding]:
    """Refactor one `ui.apps`/`ui.content` module's pom (CAM's
    content-package rules, `references/transform-rules.md` Sec.5,
    `manual-followups.md`):

    1. **Reshape** the legacy `com.day.jcr.vault:content-package-maven-plugin`
       plugin down to JUST `<extensions>true</extensions>` (adding it if
       even that was missing) -- stripping its legacy `<configuration>`
       (`<filterSource>`, `<group>`, and the `<embeddeds>` that embeds e.g.
       `core` at `/apps/<appId>/install`) is what drops the legacy embed.
       This plugin is NOT removed and NOT renamed: both archetype templates
       (`assets/archetype-pom-templates/{ui.apps,ui.content}/pom.xml`) keep
       it around, bare, purely so `<extensions>true</extensions>` is bound
       to SOME plugin -- without that, `<packaging>content-package</packaging>`
       (a non-standard Maven packaging value) has no lifecycle mapping and
       `mvn package` cannot build the module at all. An earlier version of
       this function renamed the legacy plugin's identity to the filevault
       one instead of adding a second plugin, which silently dropped
       `<extensions>true</extensions>` in the process -- a real, caught-late
       regression; see the "Fix round 1" section of this task's report.
    2. **Add** `org.apache.jackrabbit:filevault-package-maven-plugin` as a
       SEPARATE plugin (matching the archetype template's own two-plugin
       structure exactly), whose `<configuration>` is the module's own
       archetype template, verbatim, `{{groupId}}`/`{{artifactId}}`/
       `{{version}}`-substituted (`_template_plugin_configuration_xml`).
    3. If this package's own content has ACL authoring
       (`_has_acl_nodes` -- a `_rep_policy.xml` sidecar or inline
       `<rep:policy>`/`rep:ACL`; the real fixture's `ui.content` has exactly
       this under `content/dam/wknd`), add
       `<accessControlHandling>merge_preserve</accessControlHandling>` and
       raise a NORMAL finding.
    4. Remove `autoInstallPackage`/`autoInstallPackagePublish`-shaped
       `<profile>`s that reference the legacy plugin's now-gone
       configuration-bearing role (`_drop_legacy_install_profiles`) -- see
       that function's own docstring for why this isn't optional tidiness.
    5. **Declare** the module's own top-level `type=zip` `<dependency>` on
       the package step 2's injected filevault `<configuration>` references
       (`_ensure_content_module_dependency`, Fix round 1's Fix 1 -- a
       Critical defect caught only once someone actually ran `mvn` against
       the reshaped module: `filevault-package-maven-plugin:validate-files`
       fails outright without it, since the config references a package the
       module never declared as a Maven dependency at all).
    6. **Drop** any top-level `<dependency>` this module has on one of the
       project's OWN reactor bundle modules (`_drop_project_bundle_
       dependencies`, Fix round 1's Fix 2 -- vestigial: neither archetype
       content template has any such dependency, Cloud Service embeds a
       bundle into `all` only, and a lingering one drags the bundle -- and
       anything not-yet-modernized about it -- into any `-am` build of this
       content module).

    Returns the findings collected along the way (currently just the ACL
    note: 0 or 1 entries)."""
    if module_key not in _CONTENT_MODULE_TEMPLATE_DIR:
        raise ValueError(
            f"refactor_content_pom: module_key must be one of "
            f"{sorted(_CONTENT_MODULE_TEMPLATE_DIR)}, got {module_key!r}")

    findings: List[C.Finding] = []
    tree, original = E.load(pom_path)
    root = tree.getroot()

    # Drop a legacy `com.adobe.aem:uber-jar` this content package may declare
    # (the acme-portal real project's ui.apps/ui.content both do). After the
    # reactor refactor swaps uber-jar -> aem-sdk-api in <dependencyManagement>,
    # a lingering uber-jar <dependency> here has no managed version and fails
    # POM processing outright ("'dependencies.dependency.version' for
    # com.adobe.aem:uber-jar:jar is missing"). Same (groupId, artifactId)
    # matcher as refactor_bundle_pom; a content package needs no API jar of its
    # own, so nothing is added back (CAM adds aem-sdk-api here, but a content
    # package compiles no Java -- dropping it clean is correct).
    E.drop_dependency(tree, *_UBER_JAR)
    # A legacy content module excluded from the reactor may carry a stale parent
    # version -- align it to the reactor's so Maven resolves the parent in-reactor.
    _ensure_module_version_matches_reactor(root, config.get("version"))

    config_xml = _template_plugin_configuration_xml(module_key, config)

    if _has_acl_nodes(pom_path):
        config_xml = _inject_access_control_handling(config_xml)
        findings.append(C.Finding(
            ACL_HANDLING_FINDING_CODE, "NORMAL",
            "ACL authoring (rep:policy) detected; accessControlHandling="
            f"merge_preserve added to filevault-package-maven-plugin: {pom_path}"))

    build_el = _ensure_build_element(root)

    # (1) Reshape (or create) the legacy plugin down to its bare
    # <extensions>true</extensions> lifecycle binding. `ensure_plugin` is an
    # idempotent upsert keyed by (groupId, artifactId): on the fixture, this
    # MATCHES the existing plugin in place (same slot in <plugins>) and
    # replaces every non-identity child (the old <configuration> AND any
    # pre-existing <extensions>) with just the one new <extensions>true
    # child -- never both "the old one" and "the new one". If no such
    # plugin existed at all, this INSERTS one, so a pom that (unusually)
    # lacks the legacy plugin entirely still ends up with the
    # extensions-true binding it needs.
    E.ensure_plugin(build_el, *_LEGACY_CONTENT_PLUGIN, "<extensions>true</extensions>")

    # (2) Add filevault-package-maven-plugin as its OWN plugin entry (not a
    # rename target) -- no existing plugin has this identity yet, so
    # `ensure_plugin` appends it as a new <plugin>, matching the archetype
    # template's two-plugin shape.
    E.ensure_plugin(build_el, *_FILEVAULT_PLUGIN, config_xml)

    _drop_legacy_install_profiles(root)

    # (5) Fix round 1, Fix 1: declare the dependency the filevault config
    # injected above actually references -- without this, the config is
    # structurally present but semantically dangling (`validate-files`
    # fails). Must run AFTER the filevault plugin above is in place, even
    # though it doesn't read the plugin's own XML back out (coordinates come
    # straight from `config`, not from re-parsing `config_xml`) -- ordering
    # here just mirrors the brief's own step order.
    _ensure_content_module_dependency(root, module_key, config)

    # (6) Fix round 1, Fix 2: drop vestigial dependencies on the project's
    # own bundle modules -- see that function's own docstring for why this
    # is required for buildability, not just tidiness.
    _drop_project_bundle_dependencies(tree, config)

    E.save(tree, pom_path, original)
    return findings


# ---------------------------------------------------------------------------
# Task B4: all pom -- packageType=container + embed bundles + ui.config
# ---------------------------------------------------------------------------

# Continues this file's own skill-original RM-9xx numbering (RM-902 is the
# Felix->BND note above, RM-903 the ACL note) for the same reason those two
# use it instead of a real CAM FindingsReporter code: CAM has none for "a
# pre-existing 3rd-party <embedded> in `all` survived this refactor
# unchanged" either -- see FELIX_TO_BND_FINDING_CODE's own comment.
THIRD_PARTY_EMBED_FINDING_CODE = "RM-904"

_PACKAGE_TYPE_CONTAINER = "container"


def _find_plugin_by_identity(root, group: str, artifact: str):
    """First `<plugin>` anywhere under `root` whose own (groupId, artifactId)
    matches (group, artifact) exactly, or None. Mirrors `_has_felix_plugin`'s
    whole-subtree `.iter()` walk (so plugin ORDER under `<plugins>` never
    matters), but keyed on groupId+artifactId together rather than
    artifactId alone -- unlike the Felix pair, `_FILEVAULT_PLUGIN`'s own
    artifactId is not assumed unique enough on its own to identify it."""
    for el in root.iter():
        if not isinstance(el.tag, str) or _local(el.tag) != "plugin":
            continue
        if (_direct_child_text(el, "groupId") == group
                and _direct_child_text(el, "artifactId") == artifact):
            return el
    return None


def _ensure_package_type_container(root) -> None:
    """Force the `all` module's filevault plugin's own `<packageType>` to
    read `container` -- a no-op when it already does (the fixture's own
    shape, and every real Cloud Service `all` pom that already embeds
    bundles, this task's own precondition per the brief).

    If the filevault plugin, its `<configuration>`, or the `<packageType>`
    child itself doesn't exist, this is a no-op rather than fabricating a
    brand-new element: `pom_engine.set_child_text` only ever sets text on an
    EXISTING child (the same contract `_fix_bundle_identity_if_mismatched`
    above already relies on for the same reason), and no `pom_engine`
    primitive builds a bare scalar element outside `add_embedded`'s own
    fixed 4-child `<embedded>` shape -- so, like `_expected_bundle_
    artifact_id` returning `None` when it can't determine an answer, this
    treats "can't safely add it without a new primitive" as "leave it
    alone" rather than reaching for a hand-rolled lxml call, which this
    module's own lxml-stays-in-`pom_engine` contract (module docstring) and
    the task's own "do not modify pom_engine" constraint both rule out.
    Not exercised by any fixture this task ships with -- see the task
    report's "concerns" section."""
    plugin_el = _find_plugin_by_identity(root, *_FILEVAULT_PLUGIN)
    config_el = _direct_child(plugin_el, "configuration")
    if config_el is None:
        return
    E.set_child_text(config_el, "packageType", _PACKAGE_TYPE_CONTAINER)


def _embedded_identity_keys(embeddeds_el) -> set:
    """`{(groupId, artifactId), ...}` for every direct `<embedded>` child of
    `embeddeds_el` (or the empty set if it's None, e.g. an `all` pom with no
    `<embeddeds>` block at all) -- the de-dup index `_add_embedded_if_missing`
    checks before ever calling `pom_engine.add_embedded`, which itself always
    appends unconditionally (see that primitive's own docstring)."""
    keys = set()
    if embeddeds_el is None:
        return keys
    for child in embeddeds_el:
        if not isinstance(child.tag, str) or _local(child.tag) != "embedded":
            continue
        keys.add((_direct_child_text(child, "groupId"), _direct_child_text(child, "artifactId")))
    return keys


def _add_embedded_if_missing(tree, existing_keys: set, group: str, artifact: str,
                              target: str, type_: str) -> bool:
    """`pom_engine.add_embedded`, guarded by the (groupId, artifactId)
    de-dup check the brief requires: never add a duplicate `<embedded>` for
    an artifact that's already embedded, whether it got there from THIS
    project (a target module or bundle) or was already on the customer's own
    pom before this ever ran (a 3rd-party embed like `net.engio:mbassador`).
    `existing_keys` is mutated in place -- the newly-added key goes in
    immediately -- so two `config.bundles[]` entries that happened to
    resolve to the same artifactId can't duplicate each other either, not
    just duplicate something already on disk. Returns whether an `<embedded>`
    was actually added."""
    key = (group, artifact)
    if key in existing_keys:
        return False
    E.add_embedded(tree, group, artifact, target, type_)
    existing_keys.add(key)
    return True


def _bundle_module_dir(bundle: dict) -> Optional[str]:
    """The directory-name suffix a `config.bundles[]` entry embeds under --
    `config-schema.md`'s own example, and `inspect_project.py`'s own
    comprehension, always set `artifactIdSuffix` equal to `path` (no bundle
    in this skill's fixtures has ever had them differ), so this prefers the
    explicit suffix and falls back to `path` only for a hand-edited config
    that dropped one of the two."""
    return bundle.get("artifactIdSuffix") or bundle.get("path")


def refactor_all_pom(pom_path, config: dict) -> List[C.Finding]:
    """Refactor the `all` module's pom (Task B4): make it embed every
    project bundle and `ui.config`, on top of whatever it already embeds.

    Unlike `refactor_content_pom` (which REBUILDS a plugin's whole
    `<configuration>` from the archetype template), this is purely
    ADDITIVE: a real customer `all` pom (the WKND fixture's own shape) is
    already `filevault-package-maven-plugin`-based with a real
    `<packageType>`/`<embeddeds>` of its own -- Cloud Service's `all`
    package doesn't go through the legacy-`content-package-maven-plugin`
    conversion B3 handles for `ui.apps`/`ui.content` -- so this function
    only ever ADDS to or corrects small pieces of what's already there,
    never replaces the whole thing:

    1. **Ensure** the filevault plugin's `<packageType>` reads `container`
       (`_ensure_package_type_container` -- a no-op on the fixture, which
       already has it).
    2. **Add** an `<embedded>` for `ui.config` -- groupId `config.groupId`,
       artifactId `<config.artifactId>.<targetModules.uiConfig>` (computed
       the same way `validate._expected_embed` does -- NOT a hardcoded
       `".ui.config"` literal -- so a confirm-gate rename of the target
       module directory still satisfies that downstream oracle check),
       target `/apps/<appId>-packages/application/install`, type `zip`.
    3. **Ensure** an `<embedded>` for every `config.bundles[]` entry --
       artifactId `<config.artifactId>.<bundle-dir>`, same target, type
       `jar` -- ADDED when not already embedded, a no-op when it already is
       (the fixture's own `core`/`bundle2` are already there).
    4. Every add in (2)/(3) goes through `_add_embedded_if_missing`, keyed
       on (groupId, artifactId) against what was ALREADY embedded when this
       function was called -- so re-running this function is idempotent,
       and nothing pre-existing (first-party OR 3rd-party, e.g.
       `net.engio:mbassador`) is ever duplicated. Nothing is ever REMOVED
       here either, so every pre-existing `<embedded>` and its own
       top-level `<dependency>` (mbassador has both) survive untouched by
       construction, not because this function specifically special-cases
       them.
    5. Each embed that was ALREADY present when this function was called,
       whose own groupId isn't `config.groupId` (i.e. a genuine 3rd-party
       artifact -- not one of this project's own target-module/bundle
       embeds, which always use `config.groupId`), gets a NORMAL finding
       noting it survived unchanged -- purely informational, in the same
       spirit as `refactor_content_pom`'s ACL note: surface a fact a human
       should know, don't act on it.

    Returns the findings collected along the way (0 or more 3rd-party-embed
    notes; never a HIGH/CRITICAL finding -- there's nothing here that needs
    a manual follow-up the way Felix->BND or ACL authoring do)."""
    findings: List[C.Finding] = []
    tree, original = E.load(pom_path)
    root = tree.getroot()

    _ensure_package_type_container(root)

    embeddeds_el = E.find_first(tree, "embeddeds")
    existing_keys = _embedded_identity_keys(embeddeds_el)
    preexisting_keys = frozenset(existing_keys)

    group_id = config["groupId"]
    artifact_id = config["artifactId"]
    install_target = f'/apps/{config["appId"]}-packages/application/install'

    ui_config_dir = config["targetModules"]["uiConfig"]
    ui_config_artifact = f"{artifact_id}.{ui_config_dir}"
    _add_embedded_if_missing(tree, existing_keys, group_id, ui_config_artifact,
                              install_target, "zip")

    for bundle in config.get("bundles", []):
        bundle_dir = _bundle_module_dir(bundle)
        if not bundle_dir:
            continue
        bundle_artifact = f"{artifact_id}.{bundle_dir}"
        _add_embedded_if_missing(tree, existing_keys, group_id, bundle_artifact,
                                  install_target, "jar")

    for g, a in sorted(preexisting_keys):
        if g != group_id:
            findings.append(C.Finding(
                THIRD_PARTY_EMBED_FINDING_CODE, "NORMAL",
                f"pre-existing 3rd-party embed {g}:{a} in all/pom.xml carried "
                f"over unchanged: {pom_path}"))

    E.save(tree, pom_path, original)
    return findings


# ---------------------------------------------------------------------------
# Task B5: reactor/parent pom -- uber-jar->SDK, modules, analyser, index
# ---------------------------------------------------------------------------

# Sourced from assets/archetype-pom-templates/pom.xml's own <properties>
# (see refactor_content_pom's own docstring pattern: pull the exact template
# value rather than hand-guessing a plausible one). Hardcoded rather than
# read from the template file at call time -- unlike
# `_template_plugin_configuration_xml` (B3), which extracts a whole
# `<configuration>` block VERBATIM because that block is too large/nested to
# safely retype by hand, these are two single scalar strings the brief
# itself already pins verbatim ("Template values" section) -- reading the
# template file just to re-derive the same two literals it already hands us
# would be indirection without benefit, and would make this function's
# output depend on the template file's continued presence/shape for values
# that never vary per customer project.
_AEM_SDK_API_VERSION = "2026.4.25520.20260417T163942Z-260300"
_AEMANALYSER_VERSION = "1.6.6"

# The SDK API version the reactor step bakes in. Defaults to the pin above
# (deterministic, offline); `main`'s `--sdk-version latest|<version>` sets this to
# the latest resolved from Maven Central (or an explicit value). Kept as a module
# global so `refactor_reactor_pom` picks it up without a signature change (its
# many unit tests call it directly and rely on the pinned default).
_sdk_api_version_override = None


def _effective_sdk_api_version() -> str:
    return _sdk_api_version_override or _AEM_SDK_API_VERSION

_UBER_JAR = ("com.adobe.aem", "uber-jar")
_AEM_SDK_API = ("com.adobe.aem", "aem-sdk-api")
_AEMANALYSER_PLUGIN = ("com.adobe.aem", "aemanalyser-maven-plugin")

# The archetype-56's own filevault-package-maven-plugin version (verified in
# assets/archetype-pom-templates/pom.xml's <pluginManagement>). Used only when
# the customer's legacy reactor has NO filevault entry to add extensions to --
# an existing entry keeps its own version (see
# `_ensure_filevault_extensions_binding`).
_ARCHETYPE_FILEVAULT_VERSION = "1.3.6"

# The default logical-key -> on-disk-dir map for the five Cloud Service target
# modules (config-schema.md's `targetModules`). Used as a fallback when a config
# omits `targetModules` (e.g. a crafted unit-test config, or any caller that
# doesn't need to rename modules) so the reactor helpers never KeyError on it --
# the real inspect_project.build_config always writes the full map.
_DEFAULT_TARGET_MODULES = {
    "all": "all", "uiApps": "ui.apps", "uiAppsStructure": "ui.apps.structure",
    "uiConfig": "ui.config", "uiContent": "ui.content",
}


def _target_modules(config: dict) -> dict:
    """`config["targetModules"]`, defaulting to `_DEFAULT_TARGET_MODULES` when
    absent -- so the reactor helpers are robust to a partial config."""
    return config.get("targetModules") or _DEFAULT_TARGET_MODULES

# The same Maven POM namespace every fixture/template pom in this skill
# declares on its own <project> root (verified: the WKND fixture's reactor
# pom, and every assets/archetype-pom-templates/*/pom.xml). `_parse_fragment`
# below always builds its throwaway wrapper with this exact namespace, so an
# Element pulled out of it already matches what `pretty_insert` expects to
# graft into a REAL pom's tree without any re-namespacing step (unlike
# `merge_dependencies`, `pretty_insert` does not re-namespace what it
# grafts -- see pom_engine.py's own docstring for `merge_dependencies` vs
# `pretty_insert`). A target pom that declared NO namespace at all (bare,
# unqualified element names) is not exercised by any fixture this task ships
# with; see the task report's "concerns" section.
_POM_NS = "http://maven.apache.org/POM/4.0.0"


def _parse_fragment(inner_xml: str):
    """Parse `inner_xml` (one or more sibling elements, as a literal XML
    string) into a throwaway `ElementTree` via `pom_engine.load` -- the only
    way this module ever manufactures a brand-new Element that didn't come
    from `E.load`-ing a real pom, since every actual `lxml` construction
    primitive (`etree.Element`/`etree.fromstring`/...) must stay inside
    `pom_engine` (this module's own docstring; a binding constraint of this
    task). `pom_engine.load` only accepts a file PATH, not a string, and the
    only public primitive that parses a raw string is `ensure_plugin` (via
    its own private `_coerce_config_children`, keyed to the `<plugin>`
    shape) -- so a real (if throwaway) temp file is the one way to reuse
    `load` itself for an arbitrary fragment. The file is deleted again
    immediately after parsing; the returned tree is a fully in-memory lxml
    object at that point and does not depend on the file surviving."""
    fd, path = tempfile.mkstemp(suffix=".xml")
    os.close(fd)
    try:
        Path(path).write_text(
            f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<project xmlns="{_POM_NS}">\n{inner_xml}\n</project>\n',
            encoding="utf-8",
        )
        tree, _original = E.load(path)
        return tree
    finally:
        os.unlink(path)


def _ensure_aem_sdk_api_dependency(root) -> None:
    """Add `com.adobe.aem:aem-sdk-api` (version `${aem.sdk.api}`, scope
    `provided`) to the reactor's own `<dependencyManagement>` -- a no-op if
    that block doesn't exist at all (mirrors `_ensure_package_type_
    container`'s "can't safely add it without a new primitive" stance: there
    is no pom_engine primitive that fabricates a `<dependencyManagement>`
    from nothing, and this task's own constraints forbid reaching past
    pom_engine's public primitives to build one by hand).

    Routed through `pom_engine.merge_dependencies` with `dst` set to the
    `<dependencyManagement>` ELEMENT itself (not the whole tree/root): that
    function's own dst handling (`dst_root = dst.getroot() if hasattr(dst,
    "getroot") else dst`) then scopes `find_first(dst_root, "dependencies")`
    to search ONLY inside `<dependencyManagement>`'s own subtree -- so this
    can never misfire onto a top-level `<dependencies>` block even on a
    pom that (unlike the WKND fixture, which has no top-level
    `<dependencies>` at all) happens to declare one BEFORE
    `<dependencyManagement>` in document order."""
    dm_el = _direct_child(root, "dependencyManagement")
    if dm_el is None:
        return
    frag = _parse_fragment(
        "  <dependency>\n"
        f"    <groupId>{_AEM_SDK_API[0]}</groupId>\n"
        f"    <artifactId>{_AEM_SDK_API[1]}</artifactId>\n"
        "    <version>${aem.sdk.api}</version>\n"
        "    <scope>provided</scope>\n"
        "  </dependency>"
    )
    E.merge_dependencies(dm_el, frag)


def _ensure_property(root, name: str, value: str) -> None:
    """Add `<name>value</name>` as a new child of the reactor's own
    `<properties>`, unless a property of that name is already there (in
    which case its existing value is left alone -- this never overwrites a
    customer's own pinned value) or `<properties>` itself doesn't exist at
    all (a no-op, for the same "no primitive fabricates the missing parent"
    reason `_ensure_aem_sdk_api_dependency` above documents).

    Built via `_parse_fragment` + `pom_engine.pretty_insert` rather than
    `merge_dependencies` (which is hardcoded to the `<dependency>` shape) --
    `pretty_insert` is the one public pom_engine primitive general enough to
    append ANY already-built Element as a new last child, whatever its own
    tag is."""
    properties_el = _direct_child(root, "properties")
    if properties_el is None:
        return
    if _direct_child(properties_el, name) is not None:
        return
    frag = _parse_fragment(f"  <{name}>{value}</{name}>")
    prop_el = E.find_first(frag, name)
    E.pretty_insert(properties_el, prop_el)


def _remove_superseded_content_modules(root, config: dict) -> None:
    """Remove from the reactor's `<modules>` any LEGACY source content-package
    module whose directory name is NOT one of the modernized target module names.

    A source content package (`config["contentPackages"][*]["path"]`) whose name
    differs from the target `ui.apps`/`ui.content` (e.g. globex's legacy
    `globex.ui.apps`) has had ALL its content split OUT into the new modules by
    Stage 4 -- it is now a hollow shell that still declares
    `<packaging>content-package</packaging>` with the SAME `artifactId` the
    scaffolded `ui.apps` now also uses (`<parentArtifactId>.ui.apps`), so leaving
    it in `<modules>` produces a fatal `Project '...:X' is duplicated in the
    reactor`. CAM avoids this by writing the modernized package OVER the source
    module dir (a rename); this skill scaffolds a fresh `ui.apps` alongside, so it
    must drop the superseded source module from the reactor instead. The on-disk
    dir is left in place (its history is preserved; nothing references it), and a
    dangling `<module>` comment is not synthesized.

    A source package whose name already EQUALS a target module (the SINGLE
    acme-portal / wknd case: source `ui.apps`/`ui.content` == target) is NOT
    removed -- it IS the target. No-op if `<modules>` is absent."""
    modules_el = _direct_child(root, "modules")
    if modules_el is None:
        return
    tm = _target_modules(config)
    target_names = set(tm.values())
    superseded = {cp["path"] for cp in config.get("contentPackages", [])
                  if cp.get("path") and cp["path"] not in target_names}
    if not superseded:
        return
    for child in list(modules_el):
        if (isinstance(child.tag, str) and _local(child.tag) == "module"
                and child.text in superseded):
            modules_el.remove(child)


def _ensure_required_modules(root, config: dict) -> None:
    """Ensure the reactor's own `<modules>` lists EVERY target module the
    modernized project needs built -- appending whichever isn't already listed,
    preserving every existing `<module>` untouched and never adding a duplicate.

    Crucially this is NOT just the three modules the skill scaffolds (`all`,
    `ui.config`, `ui.apps.structure`) but the content modules (`ui.apps`,
    `ui.content`) too: a legacy reactor may list `ui.apps` yet leave
    `ui.content` COMMENTED OUT (the acme-portal real project does exactly this)
    -- which, left alone, orphans the entire mutable-content package from the
    build and deploy. A commented-out `<module>` is an XML comment node, not an
    element, so it never appears in `existing` and is correctly (re-)added as a
    live `<module>`. Module DIR names come from `config["targetModules"]` (not
    a hardcoded list), so a confirm-gate rename is honoured. A no-op if
    `<modules>` doesn't exist at all (see `_ensure_aem_sdk_api_dependency`'s
    docstring for why every helper here treats a missing structural parent as
    "leave it alone" rather than fabricating one)."""
    modules_el = _direct_child(root, "modules")
    if modules_el is None:
        return
    existing = {
        c.text for c in modules_el
        if isinstance(c.tag, str) and _local(c.tag) == "module"
    }
    tm = _target_modules(config)
    for name in (tm["all"], tm["uiAppsStructure"], tm["uiApps"],
                 tm["uiConfig"], tm["uiContent"]):
        if name in existing:
            continue
        frag = _parse_fragment(f"  <module>{name}</module>")
        mod_el = E.find_first(frag, "module")
        E.pretty_insert(modules_el, mod_el)
        existing.add(name)


def _ensure_analyser_plugin_in_all_pom(reactor_pom_path) -> bool:
    """Add `com.adobe.aem:aemanalyser-maven-plugin` to the sibling
    `all/pom.xml`'s own `<build>/<plugins>` -- ONLY if that identity isn't
    already declared there (matched by groupId+artifactId ALONE, the same
    de-dup key `cam-repo-modernizer-analysis.md`'s own POM-merge model uses
    -- see `_find_plugin_by_identity`; the WKND fixture's own `all/pom.xml`
    already has this plugin with no `<version>` of its own at all, and that
    still counts as "already present": this is a presence check, not a
    content/shape check). Returns whether the plugin was actually added, so
    the caller knows whether `aemanalyser.version` needs seeding too.

    A no-op (returns False) if `all/pom.xml` doesn't exist as a sibling of
    the reactor pom at all, or if it exists but has no `<build>` to add a
    plugin under -- both "can't safely act" cases, not errors, mirroring
    every other helper in this file's stance on a missing structural
    parent."""
    all_pom_path = Path(reactor_pom_path).parent / "all" / "pom.xml"
    if not all_pom_path.is_file():
        return False

    tree, original = E.load(all_pom_path)
    root = tree.getroot()

    if _find_plugin_by_identity(root, *_AEMANALYSER_PLUGIN) is not None:
        return False

    build_el = _direct_child(root, "build")
    if build_el is None:
        return False

    config_xml = (
        "<version>${aemanalyser.version}</version>\n"
        "        <extensions>true</extensions>\n"
        "        <executions>\n"
        "          <execution>\n"
        "            <id>aem-analyser</id>\n"
        "            <goals>\n"
        "              <goal>project-analyse</goal>\n"
        "            </goals>\n"
        "          </execution>\n"
        "        </executions>"
    )
    E.ensure_plugin(build_el, *_AEMANALYSER_PLUGIN, config_xml)
    E.save(tree, all_pom_path, original)
    return True


def _ensure_filevault_extensions_binding(root) -> None:
    """Ensure the reactor's `<build>/<pluginManagement>` filevault-package-
    maven-plugin entry declares `<extensions>true</extensions>`.

    The archetype-scaffolded `ui.config` / `ui.apps.structure` modules declare
    `filevault-package-maven-plugin` WITHOUT their own `<extensions>` (exactly
    as the archetype's own child poms do), relying on the reactor's inherited
    pluginManagement entry to supply it -- and `<extensions>true</extensions>`
    is what binds the non-standard `content-package` `<packaging>` lifecycle.
    A legacy (pre-archetype) reactor's filevault pluginManagement entry (e.g.
    filevault 1.0.3 carrying only a `<filterSource>`, as the acme-portal real
    project has) has no `extensions=true`, so those scaffolded modules
    otherwise fail hard at POM processing with `Unknown packaging:
    content-package`. CAM avoids this by regenerating the whole reactor from
    the archetype (whose pluginManagement filevault entry already carries
    `extensions=true`); this skill, editing in place, must add it.

    Surgical and idempotent: an EXISTING filevault entry keeps its own version
    and configuration -- only its `<extensions>` child is ensured `true`; if no
    filevault entry exists at all, a minimal one (archetype version +
    `extensions=true`) is installed. Runs unconditionally in
    `refactor_reactor_pom`, BEFORE the `has_oak_index` index-settings step --
    which, when it fires, fully re-specifies this same plugin entry via
    `ensure_plugin` (its config already carries `extensions=true`), so an
    oak-index project's final reactor entry is byte-identical to before this
    fix. A no-op if `<build>/<pluginManagement>/<plugins>` doesn't exist (see
    `_ensure_aem_sdk_api_dependency`'s docstring)."""
    build_el = _direct_child(root, "build")
    pm_el = _direct_child(build_el, "pluginManagement") if build_el is not None else None
    plugins_el = _direct_child(pm_el, "plugins") if pm_el is not None else None
    if plugins_el is None:
        return
    fv = None
    for p in plugins_el:
        if (isinstance(p.tag, str) and _local(p.tag) == "plugin"
                and _direct_child_text(p, "groupId") == _FILEVAULT_PLUGIN[0]
                and _direct_child_text(p, "artifactId") == _FILEVAULT_PLUGIN[1]):
            fv = p
            break
    if fv is None:
        E.ensure_plugin(
            pm_el, *_FILEVAULT_PLUGIN,
            f"<version>{_ARCHETYPE_FILEVAULT_VERSION}</version>\n"
            "        <extensions>true</extensions>")
        return
    ext = _direct_child(fv, "extensions")
    if ext is not None:
        ext.text = "true"
    else:
        frag = _parse_fragment("  <extensions>true</extensions>")
        E.pretty_insert(fv, E.find_first(frag, "extensions"))


def _ensure_index_definition_settings(root) -> None:
    """When called (only when `has_oak_index` is true -- see
    `refactor_reactor_pom`), ensure the reactor's own `<build>/
    <pluginManagement>` carries `org.apache.jackrabbit:
    filevault-package-maven-plugin` with `<allowIndexDefinitions>true</
    allowIndexDefinitions>` and the `jackrabbit-packagetype` validator's
    `immutableRootNodeNames=apps,libs,oak:index` +
    `allowComplexFilterRulesInApplicationPackages=true` options
    (`cam-repo-modernizer-analysis.md` Sec.7.1's `ReactorPomHandler` row;
    Sec.7.4's own field table ties these specifically to "FileVault plugin
    config"). Placed in `<pluginManagement>` (not the reactor's own bare
    `<plugins>`) because the reactor pom is `packaging=pom` -- it never
    builds a FileVault package itself; `<pluginManagement>` is what a real
    Cloud Service archetype root pom uses to hand every CHILD module
    (`all`, `ui.apps`, ...) a shared, inherited FileVault config, and this
    skill's own root archetype template already seeds a
    `filevault-package-maven-plugin` `<pluginManagement>` entry the exact
    same way (`assets/archetype-pom-templates/pom.xml`, its own
    `<validatorsSettings><jackrabbit-nodetypes>`).

    A no-op if `<build>/<pluginManagement>` doesn't already exist (every
    real reactor pom this skill's fixtures/templates ship with does; see
    the task report's "concerns" section for the one thing this doesn't
    handle: an EXISTING filevault-package-maven-plugin pluginManagement
    entry -- e.g. one merged in from elsewhere -- would have its OTHER
    settings replaced by `ensure_plugin`'s own upsert-by-identity contract,
    same as every other `ensure_plugin` call in this file)."""
    build_el = _direct_child(root, "build")
    pluginmgmt_el = _direct_child(build_el, "pluginManagement") if build_el is not None else None
    if pluginmgmt_el is None:
        return

    config_xml = (
        "<extensions>true</extensions>\n"
        "        <configuration>\n"
        "          <allowIndexDefinitions>true</allowIndexDefinitions>\n"
        "          <validatorsSettings>\n"
        "            <jackrabbit-packagetype>\n"
        "              <options>\n"
        "                <immutableRootNodeNames>apps,libs,oak:index</immutableRootNodeNames>\n"
        "                <allowComplexFilterRulesInApplicationPackages>true"
        "</allowComplexFilterRulesInApplicationPackages>\n"
        "              </options>\n"
        "            </jackrabbit-packagetype>\n"
        "          </validatorsSettings>\n"
        "        </configuration>"
    )
    E.ensure_plugin(pluginmgmt_el, *_FILEVAULT_PLUGIN, config_xml)


def refactor_reactor_pom(pom_path, config: dict, has_oak_index: bool) -> List[C.Finding]:
    """Refactor the reactor/parent pom (Task B5, CAM's `ReactorPomHandler`,
    `cam-repo-modernizer-analysis.md` Sec.7.1):

    1. **uber-jar -> aem-sdk-api**: drop `com.adobe.aem:uber-jar` from
       `<dependencyManagement>` and add `com.adobe.aem:aem-sdk-api` (version
       `${aem.sdk.api}`, scope `provided`) in its place
       (`_ensure_aem_sdk_api_dependency`); add the `aem.sdk.api` property
       (the archetype template's own pinned value) if it isn't already
       there (`_ensure_property`).
    2. **modules**: ensure `<modules>` contains `all`, `ui.config`, and
       `ui.apps.structure` -- adding whichever of the three the pom doesn't
       already list, never touching or duplicating what's already there
       (`_ensure_required_modules`).
    3. **analyser**: ensure the sibling `all/pom.xml` has the
       `aemanalyser-maven-plugin` -- added only if that plugin identity is
       missing entirely (`_ensure_analyser_plugin_in_all_pom`); if it WAS
       just added, also seed the `aemanalyser.version` property (its
       archetype-pinned value) on the reactor, if absent.
    4. **index settings**: when `has_oak_index` is true, ensure the
       reactor's FileVault `<pluginManagement>` entry carries
       `allowIndexDefinitions` + the `jackrabbit-packagetype` validator
       options that let the aem-analyser accept index definitions inside an
       application package (`_ensure_index_definition_settings`); when
       false, this step is skipped entirely, so none of those strings
       appear at all.

    `config` is accepted (matching the brief's own signature, and every
    sibling refactor_*_pom function's shape) but not actually read by this
    function's body: unlike `refactor_content_pom`/`refactor_all_pom`
    (which need `config["groupId"]`/`config["artifactId"]`/... to compute
    customer-specific identities), every value this function adds --
    `com.adobe.aem:aem-sdk-api`, the three fixed module names, `com.adobe.
    aem:aemanalyser-maven-plugin`, the index-validator options -- is a
    fixed, customer-independent constant, either the artifact's own real
    Maven coordinates or a literal pinned in the archetype template/CAM's
    own analysis. Kept as a parameter anyway for call-site symmetry with
    `refactor_bundle_pom`/`refactor_content_pom`/`refactor_all_pom`, and in
    case a future revision needs it.

    Returns the findings collected along the way -- currently always empty:
    unlike `refactor_bundle_pom`/`refactor_content_pom`/`refactor_all_pom`,
    nothing in this brief calls for a Finding to be raised for any of the
    four steps above."""
    findings: List[C.Finding] = []
    tree, original = E.load(pom_path)
    root = tree.getroot()

    E.drop_dependency(tree, *_UBER_JAR)
    _ensure_aem_sdk_api_dependency(root)
    _ensure_property(root, "aem.sdk.api", _effective_sdk_api_version())

    _ensure_required_modules(root, config)
    # Drop any legacy source content-package module the split superseded (its
    # coordinates now collide with the scaffolded ui.apps/ui.content) -- must run
    # after the add step so target modules are present before the source is removed.
    _remove_superseded_content_modules(root, config)

    # Bind `content-package` packaging for the archetype-scaffolded modules,
    # which rely on an inherited filevault-package-maven-plugin extensions=true
    # a legacy reactor doesn't provide. Unconditional, and BEFORE the oak-index
    # step (which fully re-specifies the same entry when it fires).
    _ensure_filevault_extensions_binding(root)

    _ensure_analyser_plugin_in_all_pom(pom_path)
    # Always ensure the `aemanalyser.version` property exists (idempotent -- a
    # project that already defines it keeps its own value). The property is
    # needed whenever the `all` build references the analyser plugin's version
    # via `${aemanalyser.version}`, whether THIS run added the plugin, the
    # archetype template already carried it, or -- as in a NESTED project like
    # globex -- an ANCESTOR reactor declares it with `${aemanalyser.version}`
    # but never defines the property (a pre-existing customer defect the
    # scaffolded `all` inherits and otherwise chokes on: "Unresolveable build
    # extension ... aemanalyser-maven-plugin:${aemanalyser.version}", which
    # cascades to a spurious "Unknown packaging: content-package"). Seeding it
    # on this reactor puts it in the scaffolded modules' effective model, so the
    # ancestor's reference resolves.
    _ensure_property(root, "aemanalyser.version", _AEMANALYSER_VERSION)

    if has_oak_index:
        _ensure_index_definition_settings(root)

    E.save(tree, pom_path, original)
    return findings


# ---------------------------------------------------------------------------
# Task B6: CLI orchestration + findings merge
# ---------------------------------------------------------------------------

def _ui_apps_has_oak_index(root, config: dict) -> bool:
    """`has_oak_index` for `refactor_reactor_pom` (Task B5's own parameter):
    true if the ui.apps module's OWN `filter.xml` -- `<root>/
    <targetModules.uiApps>/src/main/content/META-INF/vault/filter.xml` --
    declares any `<filter root="...">` starting with `/oak:index`.

    Read from ui.apps specifically, not a separate `oak-indexes` module:
    Phase-1's own `split_content.py` classifies `/oak:index` as immutable
    content (`_IMMUTABLE_DIRS`) and merges it into ui.apps' own jcr_root/
    filter.xml before Phase-2 ever runs (verified against the real
    wknd-legacy fixture -- its ui.apps filter.xml carries `/oak:index/
    damAssetLucene` and `/oak:index/wkndId` post-Phase-1, even though those
    roots started out on a separate `oak-indexes` module pre-Phase-1) -- so
    by the time `refactor_poms.main` runs, ui.apps' own filter.xml is the
    one true source for "does this project have index definitions to carry
    through the aem-analyser gate", matching the brief's own instruction.

    Namespace-agnostic (`e.tag.split("}")[-1]`, mirroring `validate.py`'s
    own `_filter_roots`) plain `xml.etree.ElementTree` read -- this is
    read-only inspection of a *filter*, not a pom, so it doesn't go through
    `pom_engine` (whose primitives are for POM mutation) any more than
    `rm_common.pom_text`/`validate._filter_roots` do. Missing filter.xml
    (a crafted config with no ui.apps content tree at all) is simply "no
    oak index", not an error."""
    filter_xml = (Path(root) / config["targetModules"]["uiApps"] /
                  "src" / "main" / "content" / "META-INF" / "vault" / "filter.xml")
    if not filter_xml.exists():
        return False
    for e in ET.parse(str(filter_xml)).iter():
        if e.tag.split("}")[-1] == "filter" and e.attrib.get("root", "").startswith("/oak:index"):
            return True
    return False


def _load_existing_findings(findings_path: Path) -> List[C.Finding]:
    """The Phase-1 findings already sitting in `.modernize/findings.json`
    (`inspect_project.main`'s own RM-101/RM-107, `{"findings": [...]}`
    shaped, each entry a plain `{"code", "priority", "detail"}` dict --
    exactly `Finding.__dict__`'s own shape, so `C.Finding(**d)` round-trips
    it losslessly). An absent file (this orchestrator invoked standalone,
    with no Phase-1 run first) is simply "no prior findings", not an
    error -- `main` still has its OWN findings to write either way."""
    if not findings_path.exists():
        return []
    data = C.load_json(findings_path)
    return [C.Finding(**d) for d in data.get("findings", [])]


def main(argv=None) -> int:
    """CLI orchestration (Task B6): run every `refactor_*_pom` function in
    this module, in the one order that satisfies their own preconditions,
    against a project already restructured by the Phase-1 pipeline
    (`inspect_project` -> `scaffold_modules` -> `split_content`):

    1. **Bundles** -- `refactor_bundle_pom` on `<root>/<bundle.path>/pom.xml`
       for every `config["bundles"]` entry (`bundle["path"]`, the same key
       `inspect_project.scan_findings` itself reads off `config["bundles"]`)
       -- drops `com.adobe.aem:uber-jar`, flags Felix maven-scr-plugin/
       maven-bundle-plugin for a BND hand-off.
    2. **ui.apps / ui.content** -- `refactor_content_pom` on
       `<root>/<targetModules.uiApps|uiContent>/pom.xml`, `module_key`
       `"uiApps"`/`"uiContent"` -- content-package -> filevault conversion.
       Run BEFORE the `all`-pom step below only because the brief lists
       bundles/content/all/reactor in that order; `refactor_all_pom` doesn't
       actually read anything either of these two mutate, so this ordering
       isn't load-bearing between those two steps specifically.
    3. **all** -- `refactor_all_pom` on `<root>/<targetModules.all>/pom.xml`
       -- embeds every bundle + `ui.config`, on top of whatever's already
       embedded.
    4. **Reactor** -- `refactor_reactor_pom` on `<root>/pom.xml`, with
       `has_oak_index` derived by `_ui_apps_has_oak_index` from ui.apps' OWN
       filter.xml (see that function's docstring for why ui.apps, not a
       separate oak-index module, is the right place to read this from) --
       uber-jar -> aem-sdk-api, required `<modules>`, aem-analyser plugin,
       index-definition validator settings. Run LAST because it's the only
       step whose own precondition (`has_oak_index`) depends on reading
       project state at all -- every other step's inputs come straight from
       `config`.

    Every Finding any of the four steps returns is collected, MERGED with
    whatever Phase-1 already wrote to `.modernize/findings.json`
    (`_load_existing_findings`), de-duped via `rm_common.dedup_findings`
    (existing findings first, so a Phase-1 RM-101/RM-107 keeps its original
    position; this run's own new findings -- e.g. a Felix->BND RM-902 --
    appended after, each only once even if two bundles both trip it with an
    identical detail string), and written back to the same file in
    `inspect_project.main`'s own `{"findings": [f.__dict__, ...]}` shape --
    so re-running this orchestrator (or Phase-1's inspect again) never
    duplicates a finding already on disk.

    Prints a one-line summary (poms refactored, total findings after the
    merge) and returns 0 -- there is no failure mode of its own here: every
    `refactor_*_pom` call either mutates a real pom.xml in place or raises
    on a genuinely malformed input (missing file, unparsable XML), which is
    exactly `pom_engine.load`'s own existing behavior, not something this
    orchestration wraps or swallows."""
    ap = argparse.ArgumentParser(description="repo-modernize POM refactor orchestration")
    ap.add_argument("root", help="target project root")
    ap.add_argument("--config", required=True, help="path to .modernize/config.json")
    ap.add_argument("--sdk-version", default="pinned",
                    help="AEM SDK API version to bake into the reactor: 'pinned' (default, "
                         "deterministic/offline), 'latest' (resolve the newest from Maven "
                         "Central; falls back to pinned when offline), or an explicit version.")
    a = ap.parse_args(argv)

    # Resolve the SDK version choice into the module override the reactor step reads.
    global _sdk_api_version_override
    if a.sdk_version and a.sdk_version != "pinned":
        if a.sdk_version == "latest":
            import archetype as _arch
            ver, _is_latest, note = _arch.sdk_api_version(prefer_latest=True)
            _sdk_api_version_override = ver
            if note:
                print(f"refactor_poms: {note}")
        else:
            _sdk_api_version_override = a.sdk_version
            print(f"refactor_poms: using explicit AEM SDK {a.sdk_version}")

    root = Path(a.root)
    config = C.load_json(a.config)
    tm = config["targetModules"]

    findings: List[C.Finding] = []
    poms_refactored = 0

    for bundle in config.get("bundles", []):
        bundle_pom = root / bundle["path"] / "pom.xml"
        findings.extend(refactor_bundle_pom(bundle_pom, config))
        poms_refactored += 1

    for module_key in ("uiApps", "uiContent"):
        module_pom = root / tm[module_key] / "pom.xml"
        findings.extend(refactor_content_pom(module_pom, config, module_key))
        poms_refactored += 1

    all_pom = root / tm["all"] / "pom.xml"
    findings.extend(refactor_all_pom(all_pom, config))
    poms_refactored += 1

    has_oak_index = _ui_apps_has_oak_index(root, config)
    reactor_pom = root / "pom.xml"
    findings.extend(refactor_reactor_pom(reactor_pom, config, has_oak_index))
    poms_refactored += 1

    findings_path = C.manifest_path(root, "findings.json")
    merged = C.dedup_findings(_load_existing_findings(findings_path) + findings)
    C.save_json(findings_path, {"findings": [f.__dict__ for f in merged]})

    print(f"refactor_poms: {poms_refactored} pom(s) refactored under {root}; "
          f"{len(merged)} finding(s) in {findings_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
