"""Tests for the archetype/SDK version resolution + refresh mechanism (offline-safe).

Network calls are always mocked here, so these run offline and deterministically.
"""
import unittest
from unittest import mock

import archetype as A


_SDK_META = ('<metadata><versioning>'
             '<latest>2099.1.1.NEW</latest><release>2099.1.1.NEW</release>'
             '<versions><version>2020.5.old</version><version>2099.1.1.NEW</version></versions>'
             '</versioning></metadata>')
_ARCH_META = ('<metadata><versioning><latest>99</latest><release>99</release>'
              '<versions><version>56</version><version>99</version></versions>'
              '</versioning></metadata>')


class LatestTag(unittest.TestCase):
    def test_parses_latest(self):
        self.assertEqual(A._latest_tag(_SDK_META), "2099.1.1.NEW")
        self.assertEqual(A._latest_tag(_ARCH_META), "99")

    def test_none_on_empty(self):
        self.assertIsNone(A._latest_tag(None))
        self.assertIsNone(A._latest_tag("<metadata/>"))


class Resolvers(unittest.TestCase):
    def test_resolve_latest_sdk(self):
        with mock.patch.object(A, "_fetch", return_value=_SDK_META):
            self.assertEqual(A.resolve_latest_sdk_api(), "2099.1.1.NEW")

    def test_resolve_latest_archetype(self):
        with mock.patch.object(A, "_fetch", return_value=_ARCH_META):
            self.assertEqual(A.resolve_latest_archetype(), "99")

    def test_offline_returns_none_never_raises(self):
        with mock.patch.object(A, "_fetch", return_value=None):
            self.assertIsNone(A.resolve_latest_sdk_api())
            self.assertIsNone(A.resolve_latest_archetype())
            self.assertIsNone(A.staleness_note())


class SdkApiVersion(unittest.TestCase):
    def test_pinned_default_no_network(self):
        # prefer_latest=False must never touch the network.
        with mock.patch.object(A, "_fetch", side_effect=AssertionError("no network expected")):
            ver, is_latest, note = A.sdk_api_version(prefer_latest=False)
        self.assertEqual(ver, A.PINNED_SDK_API)
        self.assertFalse(is_latest)
        self.assertEqual(note, "")

    def test_prefer_latest_uses_newest(self):
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value="2099.1.1.NEW"):
            ver, is_latest, note = A.sdk_api_version(prefer_latest=True)
        self.assertEqual(ver, "2099.1.1.NEW")
        self.assertTrue(is_latest)
        self.assertIn("2099.1.1.NEW", note)

    def test_prefer_latest_offline_falls_back_to_pin(self):
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=None):
            ver, is_latest, note = A.sdk_api_version(prefer_latest=True)
        self.assertEqual(ver, A.PINNED_SDK_API)
        self.assertIn("could not reach", note)

    def test_prefer_latest_already_pinned_no_note(self):
        with mock.patch.object(A, "resolve_latest_sdk_api", return_value=A.PINNED_SDK_API):
            ver, is_latest, note = A.sdk_api_version(prefer_latest=True)
        self.assertEqual(ver, A.PINNED_SDK_API)
        self.assertTrue(is_latest)
        self.assertEqual(note, "")


class StalenessNote(unittest.TestCase):
    def test_note_when_behind(self):
        with mock.patch.object(A, "resolve_latest_archetype", return_value="99"), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value="2099.1.1.NEW"):
            note = A.staleness_note()
        self.assertIn("archetype-99", note)
        self.assertIn("2099.1.1.NEW", note)

    def test_no_note_when_current(self):
        with mock.patch.object(A, "resolve_latest_archetype", return_value=A.PINNED_ARCHETYPE), \
             mock.patch.object(A, "resolve_latest_sdk_api", return_value=A.PINNED_SDK_API):
            self.assertIsNone(A.staleness_note())


class RefactorPomsSdkFlag(unittest.TestCase):
    """The --sdk-version flag sets the module override the reactor step reads."""

    def test_explicit_version_override(self):
        import refactor_poms as RP
        # simulate main()'s flag handling without running the whole pipeline
        RP._sdk_api_version_override = "2099.9.9.EXPLICIT"
        try:
            self.assertEqual(RP._effective_sdk_api_version(), "2099.9.9.EXPLICIT")
        finally:
            RP._sdk_api_version_override = None
        # default reverts to the pin
        self.assertEqual(RP._effective_sdk_api_version(), RP._AEM_SDK_API_VERSION)


if __name__ == "__main__":
    unittest.main(verbosity=2)
