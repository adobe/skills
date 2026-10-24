# scripts/test_osgi_formats.py
"""Format-exact tests for osgi_formats: each expectation is what the Java code that loaded the
legacy file on AEM 6.x produced (FileVault DocViewProperty2 + Sling ConfigNodeConverter for
sling:OsgiConfig, Felix ConfigurationHandler for .config, java.util.Properties for .cfg), and
how Sling's .cfg.json reader (Felix cm.json) reads it back."""
import tempfile
import unittest
from pathlib import Path

import osgi_formats as F


def _write(tmp, name, data):
    p = Path(tmp) / name
    p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    return p


class DocViewParse(unittest.TestCase):
    def test_untyped_scalar(self):
        self.assertEqual(F.parse_docview("abc"), (None, False, ["abc"]))

    def test_type_hint_only_at_start(self):
        self.assertEqual(F.parse_docview("{Boolean}true"), ("Boolean", False, ["true"]))
        self.assertEqual(F.parse_docview("a{Long}5"), (None, False, ["a{Long}5"]))

    def test_arrays_are_not_trimmed(self):
        self.assertEqual(F.parse_docview("[a,b]"), (None, True, ["a", "b"]))
        self.assertEqual(F.parse_docview("[a, b]"), (None, True, ["a", " b"]))

    def test_typed_array(self):
        self.assertEqual(F.parse_docview("{Long}[1,2]"), ("Long", True, ["1", "2"]))

    def test_empty_array_and_single_empty_element(self):
        self.assertEqual(F.parse_docview("[]"), (None, True, []))
        self.assertEqual(F.parse_docview(r"[\0]"), (None, True, [""]))

    def test_escapes(self):
        self.assertEqual(F.parse_docview(r"\{0,date}"), (None, False, ["{0,date}"]))
        self.assertEqual(F.parse_docview(r"[a\,b,c]"), (None, True, ["a,b", "c"]))
        self.assertEqual(F.parse_docview(r"C:\\path"), (None, False, [r"C:\path"]))
        self.assertEqual(F.parse_docview(r"\u0041b"), (None, False, ["Ab"]))

    def test_closing_bracket_only_at_end(self):
        self.assertEqual(F.parse_docview("[a]b]"), (None, True, ["a]b"]))


class DocViewToJson(unittest.TestCase):
    def conv(self, raw):
        return F.docview_to_json("k", raw)

    def test_strings(self):
        self.assertEqual(self.conv("x"), ("k", "x", []))
        self.assertEqual(self.conv("{String}x"), ("k", "x", []))
        self.assertEqual(self.conv("[a,b]"), ("k", ["a", "b"], []))

    def test_long_double_boolean_become_native_json(self):
        self.assertEqual(self.conv("{Long}5"), ("k", 5, []))
        self.assertEqual(self.conv("{Long}+5"), ("k", 5, []))
        self.assertEqual(self.conv("{Double}1.5"), ("k", 1.5, []))
        self.assertEqual(self.conv("{Double}2"), ("k", 2.0, []))
        self.assertIsInstance(self.conv("{Double}2")[1], float)
        self.assertEqual(self.conv("{Boolean}true"), ("k", True, []))
        self.assertEqual(self.conv("{Boolean}FALSE"), ("k", False, []))

    def test_typed_arrays(self):
        self.assertEqual(self.conv("{Long}[1,2]"), ("k", [1, 2], []))
        self.assertEqual(self.conv("{Double}[1,2.5]"), ("k", [1.0, 2.5], []))
        self.assertEqual(self.conv("{Boolean}[true,false]"), ("k", [True, False], []))
        self.assertEqual(self.conv("{Long}[]"), ("k", [], []))  # installer: empty -> String[0]

    def test_noncanonical_boolean_is_false_and_noted(self):
        key, value, notes = self.conv("{Boolean}yes")
        self.assertEqual((key, value), ("k", False))
        self.assertEqual(notes[0][0], "NORMAL")

    def test_invalid_number_kept_as_string_high(self):
        for raw, kept in (("{Long}abc", "abc"), ("{Long}5.0", "5.0"),
                          ("{Long}9223372036854775808", "9223372036854775808")):
            key, value, notes = self.conv(raw)
            self.assertEqual((key, value), ("k", kept), raw)
            self.assertEqual(notes[0][0], "HIGH", raw)

    def test_nonfinite_double_uses_type_hint(self):
        self.assertEqual(self.conv("{Double}NaN"), ("k:Double", "NaN", []))
        self.assertEqual(self.conv("{Double}[1.5,-Infinity]"), ("k:Double[]", ["1.5", "-Infinity"], []))

    def test_types_the_installer_ignores_are_dropped_and_noted(self):
        for raw in ("{Name}foo", "{Path}/a/b", "{Decimal}1.5", "{Date}2020-01-01T00:00:00.000Z"):
            key, value, notes = self.conv(raw)
            self.assertIsNone(key, raw)
            self.assertEqual(notes[0][0], "NORMAL", raw)
            self.assertIn(repr(raw), notes[0][1])

    def test_unknown_type_kept_as_string_high(self):
        key, value, notes = self.conv("{Integer}5")
        self.assertEqual((key, value), ("k", "5"))
        self.assertEqual(notes[0][0], "HIGH")


class OsgiConfigXml(unittest.TestCase):
    def test_reads_typed_values_and_skips_namespaced(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, "com.x.Foo.xml",
                       '<?xml version="1.0" encoding="UTF-8"?>\n'
                       '<jcr:root xmlns:sling="http://sling.apache.org/jcr/sling/1.0" '
                       'xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="sling:OsgiConfig" '
                       'enabled="{Boolean}true" count="{Long}5" names="[a,b]" '
                       'pattern="\\{0} [{3}]" ref="{Name}x"/>')
            props, notes = F.read_osgiconfig_xml(p)
        self.assertEqual(props, {"enabled": True, "count": 5, "names": ["a", "b"],
                                 "pattern": "{0} [{3}]"})
        self.assertEqual([n[0] for n in notes], ["NORMAL"])  # the dropped {Name}

    def test_other_node_type_is_not_a_config(self):
        with tempfile.TemporaryDirectory() as d:
            p = _write(d, "foo.xml", '<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" '
                                     'jcr:primaryType="nt:unstructured" a="b"/>')
            with self.assertRaises(F.ConversionError):
                F.read_osgiconfig_xml(p)

    def test_malformed_xml(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(F.ConversionError):
                F.read_osgiconfig_xml(_write(d, "bad.xml", "<jcr:root"))


class FelixConfig(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as d:
            return F.read_felix_config(_write(d, "com.x.Foo.config", text))

    def test_scalars(self):
        props, notes = self.read(
            'str="x"\nstrT=T"y"\nlong=L"5"\nbool=B"true"\nint=I"5"\nshort=S"7"\nbyte=X"7"\nch=C"ab"\n')
        self.assertEqual(props, {"str": "x", "strT": "y", "long": 5, "bool": True,
                                 "int:Integer": 5, "short:Short": 7, "byte:Byte": 7,
                                 "ch:Character": "a"})
        self.assertEqual(notes, [])

    def test_float_and_double_are_raw_bits(self):
        props, _ = self.read('f=F"1069547520"\ng=F"1036831949"\nd=D"4609434218613702656"\n'
                             'e=D"4611686018427387904"\n')
        self.assertEqual(props, {"f:Float": 1.5, "g:Float": 0.1, "d": 1.5, "e": 2.0})
        self.assertIsInstance(props["e"], float)

    def test_nonfinite_float_uses_string_with_hint(self):
        props, _ = self.read('f=F"2143289344"\n')
        self.assertEqual(props, {"f:Float": "NaN"})

    def test_arrays(self):
        props, _ = self.read('a=["x","y"]\nl=L["1","2"]\ni=I["1","2"]\np=l["1"]\nb=B["true"]\n'
                             'e=[]\nel=L[]\n')
        self.assertEqual(props, {"a": ["x", "y"], "l": [1, 2], "i:Integer[]": [1, 2],
                                 "p:long[]": [1], "b": [True], "e": [], "el:Long[]": []})

    def test_collections(self):
        props, _ = self.read('c=("x","y")\nci=I("1")\n')
        self.assertEqual(props, {"c:Collection<String>": ["x", "y"], "ci:Collection<Integer>": [1]})

    def test_felix_written_multiline_array_with_trailing_comma(self):
        props, _ = self.read('a=[ \\\r\n  "x", \\\r\n  "y", \\\r\n  ]\r\n')
        self.assertEqual(props, {"a": ["x", "y"]})

    def test_escapes_comments_and_spacing(self):
        props, _ = self.read('# header\n'
                             'p = "a\\ b\\=c\\"d\\\\e\\u0041\\n"\n'
                             '# between\n'
                             'q="z"\n')
        self.assertEqual(props, {"p": 'a b=c"d\\eA\n', "q": "z"})

    def test_empty_character_is_dropped_and_noted(self):
        props, notes = self.read('c=C""\n')
        self.assertEqual(props, {})
        self.assertEqual(notes[0][0], "NORMAL")

    def test_malformed_files_raise(self):
        for text in ('a=x\n',                 # unquoted: Felix ignores it and misreads what follows
                     'a="x\n',                # unterminated
                     'url="http://h?a=b"\n',  # unescaped '=': Felix truncates and stops reading
                     'n=I"abc"\n',            # invalid Integer
                     'n=I"9999999999"\n',     # Integer overflow
                     'f=F"1.5"\n',            # Felix floats are raw bits, not decimals
                     'a=["x" "y"]\n'):        # missing comma
            with self.assertRaises(F.ConversionError, msg=text):
                self.read(text)


class PropertiesCfg(unittest.TestCase):
    def read(self, data):
        with tempfile.TemporaryDirectory() as d:
            return F.read_properties_cfg(_write(d, "com.x.Foo.cfg", data))

    def test_values_stay_strings(self):
        self.assertEqual(self.read(b"n=5\nb=true\n")[0], {"n": "5", "b": "true"})

    def test_separators_comments_blank_lines(self):
        props, _ = self.read(b"# c\n! c2\n\na=1\nb = two\nc:3\nd 4\n  e=5\n")
        self.assertEqual(props, {"a": "1", "b": "two", "c": "3", "d": "4", "e": "5"})

    def test_continuation_and_escapes(self):
        props, _ = self.read(b"a=x\\\n   y\nb=\\t\\u0041\nk\\=x=1\nev=a\\\\\n")
        self.assertEqual(props, {"a": "xy", "b": "\tA", "k=x": "1", "ev": "a\\"})

    def test_latin1(self):
        self.assertEqual(self.read(b"a=\xe9\n")[0], {"a": "\u00e9"})

    def test_xml_form(self):
        props, _ = self.read(b'<?xml version="1.0" encoding="UTF-8"?>\n<properties>'
                             b'<entry key="a">1</entry><entry key="b"></entry></properties>')
        self.assertEqual(props, {"a": "1", "b": ""})


if __name__ == "__main__":
    unittest.main()
