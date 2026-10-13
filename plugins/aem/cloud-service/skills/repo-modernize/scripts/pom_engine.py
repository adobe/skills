"""Formatting-preserving lxml POM engine (Phase-2 Task B1).

`load`/`save` round-trip a POM byte-for-byte when nothing was edited, and
keep edits localized to the touched element when something was. This is the
load-bearing foundation the Phase-2 POM refactors (B2-B6) build on -- see
the engine-decision rationale for why lxml + a save-normalization layer was
chosen over a full re-serializing model library, and
the Phase-0 prototype these primitives
are ported from.

Normalization layer (mandatory per engine-decision.md, applied in `save`):
  (a) The original prolog + `<project ...>` start-tag is spliced back into
      the output verbatim (byte-for-byte from the source), instead of
      letting lxml re-serialize it. This is what kills the two systematic
      diff sources the spike measured: prolog/comment whitespace collapse,
      and root `xmlns`/`xsi:schemaLocation` attribute reordering.
  (b) `<tag/>` is restored to `<tag />` (the archetype style) via a
      markup-aware scanner (not a blind regex): it walks tags/comments/
      CDATA/PIs structurally, so it only ever touches an element's own
      self-close and never text content or attribute values.
  (c) Primitives that insert a new subtree (`add_embedded`, an inserted
      `ensure_plugin`, a merged dependency) call `pretty_insert`, which
      clones the `.text`/`.tail` indentation whitespace from an existing
      sibling so the new node pretty-prints instead of serializing as a
      dense one-liner, and so the *existing* siblings are never reflowed.
"""

import copy
import re

from lxml import etree

_PARSER = etree.XMLParser(
    remove_blank_text=False, remove_comments=False,
    strip_cdata=False, resolve_entities=False,
)


# ---------------------------------------------------------------------------
# load / save
# ---------------------------------------------------------------------------

def load(path):
    """Parse `path` with lxml. Returns (tree, original_bytes); pass both to
    `save()` later so the normalization layer has the source bytes to splice
    from."""
    path = str(path)
    with open(path, "rb") as f:
        original_bytes = f.read()
    tree = etree.parse(path, _PARSER)
    return tree, original_bytes


def save(tree, path, original_bytes):
    """Serialize `tree` to `path`, then apply the mandatory normalization
    layer so an unedited load->save is a zero-line git diff against
    `original_bytes`."""
    root_name = _root_local_name(tree)
    serialized = etree.tostring(tree, xml_declaration=True, encoding="UTF-8")

    orig_end = _find_root_start_tag_end(original_bytes, root_name)
    ser_end = _find_root_start_tag_end(serialized, root_name)

    original_prefix = original_bytes[: orig_end + 1]
    body = serialized[ser_end + 1 :]

    result = original_prefix + body
    result = _restore_self_close_spacing(result)

    # Mirror the original's trailing-newline presence exactly, rather than
    # unconditionally forcing one (the spike always added a trailing '\n',
    # which would itself be a diff against a source with none).
    if original_bytes.endswith(b"\n") and not result.endswith(b"\n"):
        result += b"\n"
    elif not original_bytes.endswith(b"\n") and result.endswith(b"\n"):
        result = result[:-1]

    with open(str(path), "wb") as f:
        f.write(result)


def _root_local_name(tree):
    root = tree.getroot() if hasattr(tree, "getroot") else tree
    tag = root.tag
    name = _local(tag) if isinstance(tag, str) else "project"
    return name.encode("ascii")


def _find_root_start_tag_end(data, root_name):
    """Return the byte offset of the '>' that closes the root element's
    start-tag, skipping over the XML declaration and any leading comments/
    PIs/doctype first. Quote-aware, so a literal '>' inside an attribute
    value (e.g. xsi:schemaLocation) can't terminate the scan early."""
    i = 0
    n = len(data)
    while i < n:
        while i < n and data[i : i + 1].isspace():
            i += 1
        if data[i : i + 2] == b"<?":
            end = data.find(b"?>", i + 2)
            if end == -1:
                raise ValueError(
                    "pom_engine: unterminated '<?...?>' while scanning for root element"
                )
            i = end + 2
            continue
        if data[i : i + 4] == b"<!--":
            end = data.find(b"-->", i + 4)
            if end == -1:
                raise ValueError(
                    "pom_engine: unterminated comment while scanning for root element"
                )
            i = end + 3
            continue
        if data[i : i + 2] == b"<!":
            end = data.find(b">", i)
            if end == -1:
                raise ValueError(
                    "pom_engine: unterminated '<!...>' while scanning for root element"
                )
            i = end + 1
            continue
        break

    prefix = b"<" + root_name
    following = data[i + len(prefix) : i + len(prefix) + 1]
    if data[i : i + len(prefix)] != prefix or following not in (b" ", b"\t", b"\r", b"\n", b">", b"/"):
        raise ValueError(
            f"pom_engine: expected root element <{root_name.decode()}> at byte offset {i}"
        )

    j = i + 1
    in_quote = None
    while j < n:
        c = data[j : j + 1]
        if in_quote:
            if c == in_quote:
                in_quote = None
        elif c in (b'"', b"'"):
            in_quote = c
        elif c == b">":
            return j
        j += 1
    raise ValueError("pom_engine: root start-tag was never closed with '>'")


def _restore_self_close_spacing(data):
    """Insert a space before every element self-close `/>` (lxml always
    serializes `<tag/>`; the archetype style is `<tag />`). Walks the byte
    stream as markup -- comments/CDATA/PIs are copied through verbatim by
    their natural terminator, and tag scanning is quote-aware -- so this
    only ever touches a real element's own self-close, never text content
    or a '/>' -like substring inside an attribute value or comment."""
    out = []
    i = 0
    n = len(data)
    while i < n:
        lt = data.find(b"<", i)
        if lt == -1:
            out.append(data[i:])
            break
        if lt > i:
            out.append(data[i:lt])
        start = lt
        j = lt + 1
        nxt = data[j : j + 1]
        if nxt in (b"!", b"?"):
            if data[j : j + 3] == b"!--":
                end = data.find(b"-->", j)
                end = end + 3 if end != -1 else n
            elif data[j : j + 8] == b"![CDATA[":
                end = data.find(b"]]>", j)
                end = end + 3 if end != -1 else n
            elif nxt == b"?":
                end = data.find(b"?>", j)
                end = end + 2 if end != -1 else n
            else:  # doctype / other markup declaration
                end = data.find(b">", j)
                end = end + 1 if end != -1 else n
            out.append(data[start:end])
            i = end
            continue

        in_quote = None
        k = j
        while k < n:
            c = data[k : k + 1]
            if in_quote:
                if c == in_quote:
                    in_quote = None
            elif c in (b'"', b"'"):
                in_quote = c
            elif c == b">":
                break
            k += 1
        tag = data[start:k]  # excludes the trailing '>'
        if tag.endswith(b"/"):
            out.append(tag[:-1].rstrip() + b" />")
        else:
            out.append(tag + b">")
        i = k + 1
    return b"".join(out)


# ---------------------------------------------------------------------------
# Namespace-agnostic element helpers
# ---------------------------------------------------------------------------

def _local(tag):
    if isinstance(tag, str) and tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _namespace_of(el):
    tag = el.tag
    if isinstance(tag, str) and tag.startswith("{"):
        return tag[1:].split("}", 1)[0]
    return ""


def _qualified_by_ns(local, ns):
    return f"{{{ns}}}{local}" if ns else local


def _apply_namespace_all(elems, ns):
    """Re-namespace every element in `elems` (and their descendants) to `ns`,
    for subtrees that were built or parsed without one (e.g. a bare
    `etree.fromstring` fragment) before grafting them into a namespaced
    document."""
    if not ns:
        return
    for e in elems:
        for el in e.iter():
            if isinstance(el.tag, str) and not el.tag.startswith("{"):
                el.tag = f"{{{ns}}}{el.tag}"


def find_first(node, localname):
    """First element matching `localname` (namespace-agnostic), searching
    `node` itself and its descendants in document order. `node` may be an
    ElementTree or an Element."""
    root = node.getroot() if hasattr(node, "getroot") else node
    for el in root.iter():
        if isinstance(el.tag, str) and _local(el.tag) == localname:
            return el
    return None


def _child_text(el, localname, default=""):
    for child in el:
        if isinstance(child.tag, str) and _local(child.tag) == localname:
            return child.text if child.text is not None else default
    return default


def set_child_text(parent, localname, text):
    """Set the text of `parent`'s direct child matching `localname`. Returns
    True if a matching child was found and updated, False otherwise (no
    element is created -- mirrors the spike's `set_bundle_identity`, which
    only ever set text on children that already existed)."""
    for child in parent:
        if isinstance(child.tag, str) and _local(child.tag) == localname:
            child.text = text
            return True
    return False


# ---------------------------------------------------------------------------
# Pretty-printing helper for inserted subtrees (normalization layer, part c)
# ---------------------------------------------------------------------------

def _leading_ws(text):
    if not text:
        return ""
    idx = text.rfind("\n")
    return text[idx + 1 :] if idx != -1 else text


def _apply_indentation_shape(new_elem, template):
    """Recursively copy `template`'s whitespace shape (its `.text` and its
    children's `.tail`) onto `new_elem`, so a freshly built subtree
    pretty-prints like its structural sibling instead of collapsing to a
    dense one-liner. `new_elem.text` is only ever overwritten when
    `new_elem` itself has children -- a LEAF `new_elem` (e.g. a bare
    `<module>all</module>`) has no indentation whitespace of its own to
    shape; its `.text` IS its real scalar value, so it must survive
    untouched. Recursion only descends into a child when both sides share
    a tag AND the template child itself has children -- so a leaf
    grandchild's `.text` (its real value, e.g. a groupId string) is never
    touched either."""
    t_children = list(template)
    n_children = list(new_elem)
    if n_children:
        new_elem.text = template.text
    if not n_children:
        return
    if t_children:
        between_tail = t_children[-2].tail if len(t_children) >= 2 else t_children[-1].tail
        closing_tail = t_children[-1].tail
    else:
        between_tail = closing_tail = None
    last_idx = len(n_children) - 1
    for i, nc in enumerate(n_children):
        t_child = t_children[i] if i < len(t_children) else None
        if t_child is not None and t_child.tag == nc.tag and len(t_child):
            _apply_indentation_shape(nc, t_child)
        if t_child is not None:
            nc.tail = t_child.tail
        else:
            nc.tail = closing_tail if i == last_idx else between_tail


def pretty_insert(parent, new_elem):
    """Append `new_elem` as the last child of `parent`, shaping its (and its
    children's) indentation whitespace to match its new siblings, and
    fixing up the previously-last child's tail so it now separates two
    siblings instead of leading into `parent`'s close tag. This is what
    keeps an insertion's diff confined to the new node's own lines."""
    children = list(parent)
    if children:
        same_tag = [c for c in children if c.tag == new_elem.tag]
        template = same_tag[-1] if same_tag else children[-1]
        _apply_indentation_shape(new_elem, template)
        old_last = children[-1]
        between_tail = children[-2].tail if len(children) >= 2 else parent.text
        new_elem.tail = old_last.tail
        old_last.tail = between_tail
        parent.append(new_elem)
    else:
        # No existing sibling to model indentation from. Best-effort default
        # (one level deeper than `parent`, 2-space step) -- not exercised by
        # the WKND fixtures, where every parent primitives insert into
        # (<dependencies>, <embeddeds>, <plugins>) already has >=1 child.
        base = _leading_ws(parent.tail) if parent.tail else ""
        step = "  "
        child_indent = base + step
        kids = list(new_elem)
        new_elem.text = "\n" + child_indent + step
        for i, nc in enumerate(kids):
            nc.tail = ("\n" + child_indent) if i == len(kids) - 1 else ("\n" + child_indent + step)
        new_elem.tail = "\n" + base
        parent.append(new_elem)
    return new_elem


# ---------------------------------------------------------------------------
# Edit primitives (ported from the Phase-0 prototype)
# ---------------------------------------------------------------------------

def drop_dependency(tree, group, artifact):
    """Remove every <dependency> matching (group, artifact) from every
    <dependencies> block in `tree`. Returns True if anything was removed.

    If the removed dependency was the last child, the new last child's tail
    is reset to whatever tail the old last child had (the whitespace that
    leads into `</dependencies>`) -- otherwise it would keep its old
    between-siblings tail and `</dependencies>` would come out reindented
    by one level, a +1-line cosmetic diff the Phase-0 spike accepted
    (engine-decision.md criterion 2) but that pom_engine does not need to."""
    root = tree.getroot() if hasattr(tree, "getroot") else tree
    removed = False
    for deps in root.iter():
        if not isinstance(deps.tag, str) or _local(deps.tag) != "dependencies":
            continue
        children = list(deps)
        if not children:
            continue
        closing_tail = children[-1].tail
        removed_here = False
        for dep in children:
            if not isinstance(dep.tag, str) or _local(dep.tag) != "dependency":
                continue
            if _child_text(dep, "groupId") == group and _child_text(dep, "artifactId") == artifact:
                deps.remove(dep)
                removed = True
                removed_here = True
        if removed_here:
            remaining = list(deps)
            if remaining:
                remaining[-1].tail = closing_tail
    return removed


def add_embedded(all_tree, group, artifact, target, type_="zip"):
    """Append a new <embedded> to the first <embeddeds> block found in
    `all_tree`. Pretty-printed and placed via `pretty_insert`, so existing
    <embedded> siblings are byte-identical after the edit."""
    embeddeds = find_first(all_tree, "embeddeds")
    if embeddeds is None:
        raise ValueError("pom_engine.add_embedded: no <embeddeds> element found")
    ns = _namespace_of(embeddeds)
    new = etree.Element(_qualified_by_ns("embedded", ns))
    for local, val in (
        ("groupId", group), ("artifactId", artifact), ("type", type_), ("target", target),
    ):
        child = etree.SubElement(new, _qualified_by_ns(local, ns))
        child.text = val
    pretty_insert(embeddeds, new)
    return new


def merge_dependencies(dst, src, provided_prefixes=()):
    """Merge every <dependency> found anywhere in `src` into the first
    <dependencies> block in `dst`: a dependency not already present there
    (matched by groupId:artifactId) is appended; one already present keeps
    the higher of the two versions (compared via `ComparableVersion`).
    `uber-jar` is never carried forward (superseded by the AEM SDK API).

    `provided_prefixes` (renamed from the spike's unused `adobe_prefixes`,
    which was accepted but never consulted): a newly-added dependency whose
    groupId starts with one of these prefixes is given
    `<scope>provided</scope>`. This is new behavior, not exercised by the
    brief's pinned tests -- see the task report's "concerns" section.

    Returns a list of human-readable notes describing what changed.
    """
    notes = []
    dst_root = dst.getroot() if hasattr(dst, "getroot") else dst
    src_root = src.getroot() if hasattr(src, "getroot") else src

    dst_deps = find_first(dst_root, "dependencies")
    if dst_deps is None:
        return notes
    ns = _namespace_of(dst_deps)

    index = {}
    for d in dst_deps:
        if not isinstance(d.tag, str) or _local(d.tag) != "dependency":
            continue
        index[(_child_text(d, "groupId"), _child_text(d, "artifactId"))] = d

    for s in src_root.iter():
        if not isinstance(s.tag, str) or _local(s.tag) != "dependency":
            continue
        g = _child_text(s, "groupId")
        a = _child_text(s, "artifactId")
        if a == "uber-jar":
            continue
        key = (g, a)
        if key not in index:
            new_dep = copy.deepcopy(s)
            _apply_namespace_all([new_dep], ns)
            if provided_prefixes and any(g.startswith(p) for p in provided_prefixes):
                if not set_child_text(new_dep, "scope", "provided"):
                    scope = etree.SubElement(new_dep, _qualified_by_ns("scope", ns))
                    scope.text = "provided"
            pretty_insert(dst_deps, new_dep)
            index[key] = new_dep
            notes.append(f"add {g}:{a}")
        else:
            sv = _child_text(s, "version", default=None)
            dv_el = None
            for c in index[key]:
                if isinstance(c.tag, str) and _local(c.tag) == "version":
                    dv_el = c
                    break
            dv = dv_el.text if dv_el is not None else None
            if sv and dv and ComparableVersion(sv) > ComparableVersion(dv):
                dv_el.text = sv
                notes.append(f"bump {g}:{a}->{sv}")
    return notes


def _coerce_config_children(config_xml, ns):
    """Normalize `config_xml` (a raw XML fragment string containing one or
    more sibling elements, a single lxml Element, or an iterable of lxml
    Elements) into a list of freshly-owned, `ns`-namespaced Element copies,
    ready to graft into a document."""
    if config_xml is None or config_xml == "":
        return []
    if isinstance(config_xml, str):
        wrapped = etree.fromstring(
            ("<_pom_engine_wrap>" + config_xml + "</_pom_engine_wrap>").encode("utf-8")
        )
        children = list(wrapped)
        for c in children:
            wrapped.remove(c)
        _apply_namespace_all(children, ns)
        return children
    if isinstance(config_xml, etree._Element):
        c = copy.deepcopy(config_xml)
        _apply_namespace_all([c], ns)
        return [c]
    children = [copy.deepcopy(c) for c in config_xml]
    _apply_namespace_all(children, ns)
    return children


def _replace_non_identity_children(plugin_elem, new_children):
    """Remove every child of `plugin_elem` except groupId/artifactId, then
    append `new_children` in their place, reusing the removed children's
    tail whitespace so the swap doesn't collapse to a dense line or
    misalign the closing `</plugin>`."""
    old_children = list(plugin_elem)
    keep = [c for c in old_children if isinstance(c.tag, str) and _local(c.tag) in ("groupId", "artifactId")]
    removed = [c for c in old_children if c not in keep]

    closing_tail = removed[-1].tail if removed else (keep[-1].tail if keep else plugin_elem.text)
    between_tail = keep[-1].tail if keep else plugin_elem.text

    for c in removed:
        plugin_elem.remove(c)

    last_idx = len(new_children) - 1
    for i, nc in enumerate(new_children):
        nc.tail = closing_tail if i == last_idx else between_tail
        plugin_elem.append(nc)

    if keep and new_children:
        keep[-1].tail = between_tail


def ensure_plugin(build, group, artifact, config_xml):
    """Idempotent upsert of a <plugin> keyed by (group, artifact) under
    <build>/<plugins> (creating <plugins> if missing). If a plugin with that
    identity already exists, its non-identity children (everything but
    groupId/artifactId) are replaced with the parsed content of
    `config_xml`. Otherwise a new <plugin> is built (groupId/artifactId +
    that content) and inserted via `pretty_insert`. Returns the <plugin>
    element."""
    root = build.getroot() if hasattr(build, "getroot") else build
    plugins = find_first(root, "plugins")
    if plugins is None:
        ns = _namespace_of(root)
        plugins = etree.Element(_qualified_by_ns("plugins", ns))
        pretty_insert(root, plugins)
    ns = _namespace_of(plugins)

    existing = None
    for p in plugins:
        if not isinstance(p.tag, str) or _local(p.tag) != "plugin":
            continue
        if _child_text(p, "groupId") == group and _child_text(p, "artifactId") == artifact:
            existing = p
            break

    new_children = _coerce_config_children(config_xml, ns)

    if existing is not None:
        _replace_non_identity_children(existing, new_children)
        return existing

    new_plugin = etree.Element(_qualified_by_ns("plugin", ns))
    g = etree.SubElement(new_plugin, _qualified_by_ns("groupId", ns))
    g.text = group
    a = etree.SubElement(new_plugin, _qualified_by_ns("artifactId", ns))
    a.text = artifact
    for nc in new_children:
        new_plugin.append(nc)
    pretty_insert(plugins, new_plugin)
    return new_plugin


# ---------------------------------------------------------------------------
# ComparableVersion
# ---------------------------------------------------------------------------

_QUALIFIER_ORDER = {
    "alpha": 0, "a": 0,
    "beta": 1, "b": 1,
    "milestone": 2, "m": 2,
    "rc": 3, "cr": 3,
    "snapshot": 4,
    "": 5, "ga": 5, "final": 5, "release": 5,
    "sp": 6,
}

# Order key for a segment that is *absent* because one version has fewer
# dot/dash/underscore-separated segments than the other it's being compared
# to (e.g. "2.0" vs "2.0-alpha"). Padding with the "" qualifier's key (not
# with "nothing", which plain tuple/list comparison would treat as smaller)
# is what makes "2.0-alpha" < "2.0" -- a shorter release version must still
# outrank a longer pre-release one.
_RELEASE_KEY = (1, _QUALIFIER_ORDER[""], "")


def _segment_key(seg):
    """Order key for one split segment. Always returns a homogeneously typed
    (int, int, str) triple -- never a bare int or str -- so that comparing
    two segment-key lists never raises TypeError, even when one version's
    segment at a given position is numeric and the other's is an
    unrecognized alphanumeric qualifier (the spike's `_comparable()` mixed
    raw `int`/`str` in the same list and could raise exactly that)."""
    if seg.isdigit():
        return (0, int(seg), "")
    q = seg.lower()
    if q in _QUALIFIER_ORDER:
        return (1, _QUALIFIER_ORDER[q], q)
    return (2, 0, q)  # unrecognized qualifier: sorts after known ones, lexically


class ComparableVersion:
    """Orderable Maven-ish version string. Splits on '.', '-', '_'; numeric
    segments compare as ints, recognized qualifiers (alpha/beta/milestone/
    rc/snapshot/ga/final/sp) order per Maven convention, and any other
    alphanumeric segment falls back to a stable lexical bucket -- so
    comparison is total and never raises TypeError."""

    __slots__ = ("original", "segments", "_key")

    def __init__(self, version):
        self.original = version if version is not None else ""
        self.segments = [s for s in re.split(r"[.\-_]", self.original) if s != ""]
        self._key = tuple(_segment_key(s) for s in self.segments)

    def _padded_keys(self, other):
        n = max(len(self._key), len(other._key))
        a = self._key + (_RELEASE_KEY,) * (n - len(self._key))
        b = other._key + (_RELEASE_KEY,) * (n - len(other._key))
        return a, b

    def _compare(self, other):
        a, b = self._padded_keys(other)
        if a < b:
            return -1
        if a > b:
            return 1
        return 0

    def __eq__(self, other):
        return isinstance(other, ComparableVersion) and self._compare(other) == 0

    def __lt__(self, other):
        return self._compare(other) < 0

    def __le__(self, other):
        return self._compare(other) <= 0

    def __gt__(self, other):
        return self._compare(other) > 0

    def __ge__(self, other):
        return self._compare(other) >= 0

    def __hash__(self):
        return hash(self._key)

    def __str__(self):
        return self.original

    def __repr__(self):
        return f"ComparableVersion({self.original!r})"
