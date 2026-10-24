"""Exact readers for the legacy OSGi configuration formats, producing `.cfg.json` values.

A converted `.cfg.json` must give Configuration Admin the same values the legacy file
gave it on AEM 6.x / AMS, so each reader follows the code that loaded that format:

- `sling:OsgiConfig` node (`.xml`): values are parsed with FileVault's DocView grammar
  (`DocViewProperty2.parse`) and typed the way Sling's JCR installer
  (`ConfigNodeConverter`) hands them to Configuration Admin: String, Long, Double and
  Boolean are kept; every other JCR type was ignored at runtime, so it is reported
  instead of being silently invented.
- Felix `.config`: Apache Felix `ConfigurationHandler` grammar (typed values, arrays,
  collections; Float/Double stored as raw IEEE-754 bits).
- `.cfg`: `java.util.Properties` (ISO-8859-1, or the XML form when the first byte is
  `<`). Only String values exist in this format, so they stay strings.

Output follows the OSGi Configurator JSON that Sling's installer reads: plain JSON for
String, Long, Double and Boolean values (and arrays of them); a `key:Type` suffix only
where plain JSON cannot express the exact type (Integer, Float, Byte, Short, Character,
primitive arrays, collections, empty typed arrays, non-finite numbers).

Every reader returns `(properties, notes)`; a note is `(priority, text)`. A file that
cannot be read the way AEM read it raises `ConversionError`.
"""
from __future__ import annotations

import math
import re
import struct
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional, Tuple

Note = Tuple[str, str]


class ConversionError(ValueError):
    """The legacy file is malformed: converting it would not reproduce what AEM loaded."""


# --------------------------------------------------------------------------- numbers

_INT_RE = re.compile(r"[+-]?[0-9]+")
_JAVA_DECIMAL_RE = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[fFdD]?")
_RANGES = {"Byte": 8, "Short": 16, "Integer": 32, "Long": 64}


def _parse_int(text: str, kind: str) -> int:
    """`Byte/Short/Integer/Long.valueOf`: optional sign, decimal digits, range-checked."""
    if not _INT_RE.fullmatch(text):
        raise ValueError(text)
    value, bits = int(text), _RANGES[kind]
    if not -(1 << (bits - 1)) <= value <= (1 << (bits - 1)) - 1:
        raise ValueError(text)
    return value


def _parse_java_double(text: str) -> float:
    """`Double.valueOf`: trims whitespace, allows NaN/Infinity and an f/d suffix."""
    t = text.strip()
    if re.fullmatch(r"[+-]?NaN", t):
        return math.nan
    if re.fullmatch(r"[+-]?Infinity", t):
        return -math.inf if t.startswith("-") else math.inf
    if _JAVA_DECIMAL_RE.fullmatch(t):
        return float(t[:-1] if t[-1] in "fFdD" else t)
    raise ValueError(text)


def _float32_from_bits(bits: int) -> float:
    """`Float.intBitsToFloat`, returned as the shortest decimal that round-trips."""
    value = struct.unpack(">f", struct.pack(">i", bits))[0]
    if not math.isfinite(value):
        return value
    for digits in range(1, 10):
        candidate = float(f"{value:.{digits}g}")
        if struct.unpack(">f", struct.pack(">f", candidate))[0] == value:
            return candidate
    return value


def _float64_from_bits(bits: int) -> float:
    """`Double.longBitsToDouble`."""
    return struct.unpack(">d", struct.pack(">q", bits))[0]


def _java_double_text(value: float) -> str:
    """A non-finite value as Java prints it, for a typed string in JSON (JSON has no NaN)."""
    if math.isnan(value):
        return "NaN"
    return "-Infinity" if value < 0 else "Infinity"


# --------------------------------------------------------------------------- DocView

def parse_docview(value: str) -> Tuple[Optional[str], bool, List[str]]:
    """Parse one DocView attribute value exactly like FileVault's `DocViewProperty2.parse`.

    Returns `(type_name or None, is_multi, values)`. A `{Type}` hint is only recognized at
    the start; `\\` escapes any character (`\\uXXXX` for code points, `[\\0]` for a single
    empty element); `]` closes an array only as the last character; nothing is trimmed.
    """
    is_multi, type_name, state = False, None, "b"
    vals: Optional[List[str]] = None
    tmp: List[str] = []
    unicode_value = unicode_digits = 0
    pos, n = 0, len(value)
    while pos < n:
        c = value[pos]
        pos += 1
        if state in ("b", "a"):
            if c == "{" and state == "b":
                state = "t"
            elif c == "[":
                is_multi, state = True, "v"
            elif c == "\\":
                state = "e"
            else:
                tmp.append(c)
                state = "v"
        elif state == "t":
            if c == "}":
                type_name, tmp, state = "".join(tmp), [], "a"
            else:
                tmp.append(c)
        elif state == "v":
            if c == "\\":
                state = "e"
            elif c == "," and is_multi:
                vals = (vals or []) + ["".join(tmp)]
                tmp = []
            elif c == "]" and is_multi and pos == n:
                if tmp or vals is not None:
                    vals = (vals or []) + ["".join(tmp)]
                    tmp = []
            else:
                tmp.append(c)
        elif state == "e":
            if c == "u":
                state, unicode_value, unicode_digits = "u", 0, 0
            elif c == "0":
                state = "v"
                if vals is None:
                    vals = []
            else:
                tmp.append(c)
                state = "v"
        else:  # "u": four hex digits
            unicode_value = (unicode_value << 4) + int(c, 16)
            unicode_digits += 1
            if unicode_digits == 4:
                tmp.append(chr(unicode_value))
                state = "v"
    if is_multi:
        if tmp:
            vals = (vals or []) + ["".join(tmp)]
        return type_name, True, vals or []
    return type_name, False, ["".join(tmp)]


# javax.jcr.PropertyType names FileVault accepts in a {Type} hint ("BinaryRef" is FileVault's own).
_JCR_TYPES = {"String", "Binary", "Long", "Double", "Decimal", "Date", "Boolean", "Name",
              "Path", "Reference", "WeakReference", "URI", "undefined", "BinaryRef"}


def docview_to_json(key: str, raw: str) -> Tuple[Optional[str], object, List[Note]]:
    """Convert one `sling:OsgiConfig` attribute. Returns `(json_key, value, notes)`;
    `json_key` is None when the property is not carried over."""
    notes: List[Note] = []
    try:
        type_name, is_multi, values = parse_docview(raw)
    except ValueError:
        notes.append(("HIGH", f"'{key}': malformed \\u escape in {raw!r}; kept the raw text -- review"))
        return key, raw, notes

    def as_is():
        return list(values) if is_multi else values[0]

    if type_name in (None, "String"):
        return key, as_is(), notes
    if type_name not in _JCR_TYPES:
        notes.append(("HIGH", f"'{key}': unknown type hint {{{type_name}}} (FileVault rejects it at "
                              "import); kept as a string -- review"))
        return key, as_is(), notes
    if type_name in ("Long", "Double", "Boolean"):
        if is_multi and not values:
            return key, [], notes  # the JCR installer turns an empty multi-value into String[0]
        try:
            converted = [_jcr_value(type_name, v, key, notes) for v in values]
        except ValueError:
            notes.append(("HIGH", f"'{key}': {raw!r} is not a valid {type_name} (FileVault rejects it "
                                  "at import); kept as a string -- review"))
            return key, as_is(), notes
        if type_name == "Double" and not all(math.isfinite(x) for x in converted):
            texts = [_java_double_text(x) if not math.isfinite(x) else repr(x) for x in converted]
            return (f"{key}:Double[]" if is_multi else f"{key}:Double"), (texts if is_multi else texts[0]), notes
        return key, (converted if is_multi else converted[0]), notes
    if type_name == "Date":
        reason = "Configuration Admin does not accept Date values, so AEM 6.x could not apply them"
    else:
        reason = (f"the AEM 6.x JCR installer ignores {{{type_name}}} values, so this property was "
                  "never applied")
    notes.append(("NORMAL", f"'{key}': not carried into .cfg.json -- {reason} (source value {raw!r}); "
                            "re-add it as a string if it is needed"))
    return None, None, notes


def _jcr_value(type_name: str, text: str, key: str, notes: List[Note]):
    if type_name == "Long":
        return _parse_int(text, "Long")
    if type_name == "Double":
        return _parse_java_double(text)
    if text.lower() not in ("true", "false"):
        notes.append(("NORMAL", f"'{key}': {{Boolean}}{text} reads as false (Boolean.valueOf); "
                                "converted to false -- review"))
    return text.lower() == "true"


def read_osgiconfig_xml(path) -> Tuple[Dict[str, object], List[Note]]:
    """A `sling:OsgiConfig` DocView file. Namespaced attributes (`jcr:primaryType` and any
    other name containing ':') are skipped, exactly as the JCR installer skips them. A node
    explicitly typed as anything other than `sling:OsgiConfig` was never an OSGi config."""
    try:
        root = ET.parse(str(path)).getroot()
    except ET.ParseError as e:
        raise ConversionError(f"not well-formed XML: {e}") from e
    primary_type = root.attrib.get("{http://www.jcp.org/jcr/1.0}primaryType")
    if primary_type is not None and primary_type != "sling:OsgiConfig":
        raise ConversionError(f"node type is {primary_type}, not sling:OsgiConfig")
    props: Dict[str, object] = {}
    notes: List[Note] = []
    for attr, raw in root.attrib.items():
        if attr.startswith("{") or ":" in attr or attr == "primaryType":
            continue
        json_key, value, value_notes = docview_to_json(attr, raw)
        notes += value_notes
        if json_key is not None:
            props[json_key] = value
    return props, notes


# --------------------------------------------------------------------------- Felix .config

# type code -> (wrapper type, conversion). Primitive codes autobox the same way Felix does.
_FELIX_SCALAR = {"T": "String", "I": "Integer", "L": "Long", "F": "Float", "D": "Double",
                 "X": "Byte", "S": "Short", "C": "Character", "B": "Boolean"}
_FELIX_PRIMITIVE = {"i": "int", "l": "long", "f": "float", "d": "double", "x": "byte",
                    "s": "short", "c": "char", "b": "boolean"}
_PRIMITIVE_WRAPPER = {"i": "I", "l": "L", "f": "F", "d": "D", "x": "X", "s": "S", "c": "C", "b": "B"}
_NATIVE_JSON = {"String", "Long", "Double", "Boolean"}  # read back with the same type without a hint
_NAME_CHARS = set("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-.\\")
_TOKEN_CHARS = set('=[](),"') | set(_FELIX_SCALAR) | set(_FELIX_PRIMITIVE)
_ESCAPES = {"b": "\b", "t": "\t", "n": "\n", "f": "\f", "r": "\r"}
_NAME = object()


class _FelixReader:
    """A port of the parts of Felix `ConfigurationHandler` the installer uses, made strict:
    where Felix would silently truncate or drop data, this raises `ConversionError`."""

    def __init__(self, text: str):
        self.s = text.replace("\r\n", "\n").replace("\r", "\n")
        self.i = 0
        self.token_value = ""

    def line(self) -> int:
        return self.s.count("\n", 0, self.i) + 1

    def fail(self, why: str):
        raise ConversionError(f"line {self.line()}: {why}")

    def read(self) -> Optional[str]:
        if self.i >= len(self.s):
            self.i += 1
            return None
        c = self.s[self.i]
        self.i += 1
        return c

    def unread(self):
        self.i -= 1

    def skip_ws(self) -> Optional[str]:
        c = self.read()
        while c is not None and c.isspace():
            c = self.read()
        return c

    def skip_ws_and_continuations(self) -> Optional[str]:
        c = self.skip_ws()
        while c == "\\" and self.i < len(self.s) and self.s[self.i] == "\n":
            self.i += 1
            c = self.skip_ws()
        return c

    def next_token(self, new_line: bool):
        c = self.skip_ws()
        if c is None:
            return None
        if new_line and c == "#":
            while c is not None and c != "\n":
                c = self.read()
            return None if c is None else self.next_token(True)
        if c in _NAME_CHARS or c not in _TOKEN_CHARS:
            self.unread()
            self.token_value = self.read_quoted()
            return _NAME
        return c

    def read_quoted(self) -> str:
        buf: List[str] = []
        while True:
            c = self.read()
            if c is None:
                self.unread()
                return "".join(buf)
            if c == "\\":
                e = self.read()
                if e is None:
                    self.fail("dangling escape at end of file")
                if e == "u":
                    digits = self.s[self.i:self.i + 4]
                    if len(digits) != 4 or not re.fullmatch(r"[0-9a-fA-F]{4}", digits):
                        self.fail(f"malformed \\u escape: \\u{digits}")
                    self.i += 4
                    buf.append(chr(int(digits, 16)))
                else:
                    buf.append(_ESCAPES.get(e, e))
            elif c in ('=', '"'):
                self.unread()
                return "".join(buf)
            else:
                buf.append(c)

    def read_simple(self, code: str):
        text = self.read_quoted()
        if self.read() != '"':
            self.fail("value is not terminated by '\"' (an unescaped '=' inside a quoted value "
                      "makes Felix truncate it and ignore the rest of the file -- escape it as \\=)")
        kind = _FELIX_SCALAR[_PRIMITIVE_WRAPPER.get(code, code)]
        try:
            if kind == "String":
                return text
            if kind in _RANGES:
                return _parse_int(text, kind)
            if kind == "Float":
                return _float32_from_bits(_parse_int(text, "Integer"))
            if kind == "Double":
                return _float64_from_bits(_parse_int(text, "Long"))
            if kind == "Boolean":
                return text.lower() == "true"
            return text[:1] or None  # Character: Felix drops an empty one
        except ValueError:
            self.fail(f'"{text}" is not a valid {kind}'
                      + (" (Felix stores Float/Double as raw IEEE-754 bits)" if kind in ("Float", "Double") else ""))

    def read_values(self, code: str, close: str) -> List[object]:
        values: List[object] = []
        while True:
            c = self.skip_ws_and_continuations()
            if c == '"':
                values.append(self.read_simple(code))
                c = self.skip_ws_and_continuations()
            if c == close:
                return values
            if c != ",":
                self.fail(f"expected ',' or '{close}' in a multi-value, got {c!r}")

    def read_value(self):
        c = self.skip_ws()
        code = "T"
        if c is not None and (c in _FELIX_SCALAR or c in _FELIX_PRIMITIVE):
            code, c = c, self.read()
        if c == "[":
            return "array", code, self.read_values(code, "]")
        if c == "(":
            return "collection", code, self.read_values(code, ")")
        if c == '"':
            return "scalar", code, self.read_simple(code)
        self.fail("value must be quoted, e.g. key=\"value\" (Felix ignores an unquoted value and "
                  "misreads the lines after it)")

    def read_all(self):
        entries = []
        while True:
            token = self.next_token(True)
            if token is None:
                return entries
            if token is not _NAME:
                self.fail(f"expected a property name, got {token!r}")
            key = self.token_value.strip()
            if self.next_token(False) != "=":
                self.fail(f"expected '=' after '{key}'")
            entries.append((key,) + self.read_value())


def _felix_to_json(key: str, shape: str, code: str, value, notes: List[Note]):
    wrapper = _FELIX_SCALAR[_PRIMITIVE_WRAPPER.get(code, code)]
    if shape == "scalar":
        if value is None:
            notes.append(("NORMAL", f"'{key}': empty Character value is dropped by Felix; not carried over"))
            return None, None
        if isinstance(value, float) and not math.isfinite(value):
            return f"{key}:{wrapper}", _java_double_text(value)
        return (key if wrapper in _NATIVE_JSON else f"{key}:{wrapper}"), value
    if any(v is None for v in value):
        notes.append(("NORMAL", f"'{key}': a multi-value with an empty Character is dropped by Felix; "
                                "not carried over"))
        return None, None
    finite = all(not isinstance(v, float) or math.isfinite(v) for v in value)
    # JSON has no NaN/Infinity: then every element becomes the Java text form, typed by the key hint.
    values = value if finite else [_java_double_text(v) if not math.isfinite(v) else repr(v) for v in value]
    if shape == "collection":
        return f"{key}:Collection<{wrapper}>", values
    if code in _FELIX_PRIMITIVE:
        return f"{key}:{_FELIX_PRIMITIVE[code]}[]", values
    native = wrapper == "String" or (wrapper in _NATIVE_JSON and value and finite)
    return (key if native else f"{key}:{wrapper}[]"), values


def read_felix_config(path) -> Tuple[Dict[str, object], List[Note]]:
    """A Felix `.config` file (UTF-8)."""
    try:
        text = Path(path).read_bytes().decode("utf-8")
    except UnicodeDecodeError as e:
        raise ConversionError(f"not UTF-8: {e}") from e
    props: Dict[str, object] = {}
    notes: List[Note] = []
    for key, shape, code, value in _FelixReader(text).read_all():
        json_key, json_value = _felix_to_json(key, shape, code, value, notes)
        if json_key is not None:
            props[json_key] = json_value
    return props, notes


# --------------------------------------------------------------------------- .cfg (Properties)

def _properties_lines(text: str) -> List[str]:
    """Logical lines per `java.util.Properties.load`: comments (`#`, `!`) and blank lines
    skipped, a line ending in an odd number of backslashes continued (the next line's
    leading whitespace is dropped)."""
    out: List[str] = []
    natural = re.split(r"\r\n|\r|\n", text)
    i, n = 0, len(natural)
    while i < n:
        line = natural[i].lstrip(" \t\f")
        i += 1
        if not line or line[0] in "#!":
            continue
        logical = ""
        while True:
            backslashes = len(line) - len(line.rstrip("\\"))
            if backslashes % 2 == 1 and i < n:
                logical += line[:-1]
                line = natural[i].lstrip(" \t\f")
                i += 1
                continue
            logical += line[:-1] if backslashes % 2 == 1 else line
            break
        out.append(logical)
    return out


def _properties_unescape(s: str) -> str:
    out, i = [], 0
    while i < len(s):
        c = s[i]
        i += 1
        if c != "\\" or i >= len(s):
            out.append(c)
            continue
        c = s[i]
        i += 1
        if c == "u":
            digits = s[i:i + 4]
            if not re.fullmatch(r"[0-9a-fA-F]{4}", digits):
                raise ConversionError(f"malformed \\uxxxx encoding: \\u{digits}")
            out.append(chr(int(digits, 16)))
            i += 4
        else:
            out.append({"t": "\t", "r": "\r", "n": "\n", "f": "\f"}.get(c, c))
    return "".join(out)


def _split_property(line: str) -> Tuple[str, str]:
    key_end, value_start, has_sep, escaped = len(line), len(line), False, False
    for idx, c in enumerate(line):
        if c in "=:" and not escaped:
            key_end, value_start, has_sep = idx, idx + 1, True
            break
        if c in " \t\f" and not escaped:
            key_end, value_start = idx, idx + 1
            break
        escaped = (not escaped) if c == "\\" else False
    while value_start < len(line):
        c = line[value_start]
        if c not in " \t\f":
            if not has_sep and c in "=:":
                has_sep = True
            else:
                break
        value_start += 1
    return line[:key_end], line[value_start:]


def read_properties_cfg(path) -> Tuple[Dict[str, object], List[Note]]:
    """A `.cfg` file. Every value is a String in this format, so every value stays a string."""
    data = Path(path).read_bytes()
    if data[:1] == b"<":
        try:
            root = ET.fromstring(data)
        except ET.ParseError as e:
            raise ConversionError(f"not well-formed XML properties: {e}") from e
        props: Dict[str, object] = {}
        for entry in root.iter("entry"):
            if entry.get("key") is None:
                raise ConversionError("<entry> without a key attribute")
            props[entry.get("key")] = entry.text or ""
        return props, []
    props = {}
    for logical in _properties_lines(data.decode("latin-1")):
        key, value = _split_property(logical)
        props[_properties_unescape(key)] = _properties_unescape(value)
    return props, []


def read_legacy_config(path) -> Tuple[Dict[str, object], List[Note]]:
    """Dispatch on the file suffix: `.xml`, `.config` or `.cfg`."""
    name = Path(path).name
    if name.endswith(".xml"):
        return read_osgiconfig_xml(path)
    if name.endswith(".config"):
        return read_felix_config(path)
    if name.endswith(".cfg"):
        return read_properties_cfg(path)
    raise ValueError(f"not a legacy OSGi config file: {name}")
