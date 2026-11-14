"""archetype.py: which AEM project archetype and AEM SDK version a run uses -- Maven
Central's newest release, else the newest in the local Maven repository. Network calls are
always mocked, so these run offline."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import archetype as A
import refactor_poms as RP

_SDK_META = ('<metadata><versioning>'
             '<latest>2099.1.1.NEW</latest><release>2099.1.1.NEW</release>'
             '<versions><version>2020.5.old</version><version>2099.1.1.NEW</version></versions>'
             '</versioning></metadata>')
_ARCH_META = ('<metadata><versioning><latest>99</latest><release>99</release>'
              '<versions><version>56</version><version>99</version></versions>'
              '</versioning></metadata>')


def _local_repo(entries):
    """A fake local Maven repository: {"group:artifact": {version: file suffix or None}}."""
    root = Path(tempfile.mkdtemp())
    for ga, versions in entries.items():
        group, artifact = ga.split(":")
        for version, suffix in versions.items():
            d = root.joinpath(*group.split("."), artifact, version)
            d.mkdir(parents=True)
            if suffix:
                (d / f"{artifact}-{version}{suffix}").write_text("x")
    return root


class LatestTag(unittest.TestCase):
    def test_parses_release(self):
        self.assertEqual(A._latest_tag(_SDK_META), "2099.1.1.NEW")
        self.assertEqual(A._latest_tag(_ARCH_META), "99")

    def test_none_on_empty(self):
        self.assertIsNone(A._latest_tag(None))
        self.assertIsNone(A._latest_tag("<metadata/>"))


class CentralLatest(unittest.TestCase):
    def test_url_and_value(self):
        with mock.patch.object(A, "_fetch", return_value=_ARCH_META) as fetch:
            self.assertEqual(A.central_latest(*A.ARCHETYPE), "99")
        self.assertEqual(fetch.call_args.args[0], "https://repo1.maven.org/maven2/com/adobe/aem/"
                         "aem-project-archetype/maven-metadata.xml")

    def test_offline_returns_none_never_raises(self):
        with mock.patch.object(A, "_fetch", return_value=None):
            self.assertIsNone(A.central_latest(*A.SDK_API))


class LocalRepository(unittest.TestCase):
    def test_newest_local_release(self):
        repo = _local_repo({"com.adobe.aem:aem-project-archetype": {
            "56": ".jar", "58": ".jar", "9": ".pom", "60-SNAPSHOT": ".jar", "61": None}})
        with mock.patch.dict(os.environ, {"REPO_MODERNIZE_M2_REPO": str(repo)}):
            self.assertEqual(A.newest_local(*A.ARCHETYPE), "58")      # 61 has no artifact
            self.assertIsNone(A.newest_local(*A.SDK_API))

    def test_sdk_versions_order_by_number(self):
        repo = _local_repo({"com.adobe.aem:aem-sdk-api": {
            "2026.4.25520.20260417T163942Z-260300": ".jar",
            "2026.10.29023.20261017T134015Z-260900": ".jar",
            "2026.9.28386.20260923T071724Z-260800": ".pom"}})
        with mock.patch.dict(os.environ, {"REPO_MODERNIZE_M2_REPO": str(repo)}):
            self.assertEqual(A.newest_local(*A.SDK_API), "2026.10.29023.20261017T134015Z-260900")

    def test_settings_xml_local_repository(self):
        home = Path(tempfile.mkdtemp())
        (home / ".m2").mkdir()
        (home / ".m2/settings.xml").write_text(
            '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">'
            '<localRepository>${user.home}/maven-repo</localRepository></settings>')
        env = {k: v for k, v in os.environ.items() if k != "REPO_MODERNIZE_M2_REPO"}
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(A.Path, "home", return_value=home):
            self.assertEqual(A.local_repository(), home / "maven-repo")

    def test_default_location(self):
        home = Path(tempfile.mkdtemp())
        env = {k: v for k, v in os.environ.items() if k != "REPO_MODERNIZE_M2_REPO"}
        with mock.patch.dict(os.environ, env, clear=True), \
             mock.patch.object(A.Path, "home", return_value=home):
            self.assertEqual(A.local_repository(), home / ".m2/repository")


class Latest(unittest.TestCase):
    def test_central_first(self):
        with mock.patch.object(A, "central_latest", return_value="99"), \
             mock.patch.object(A, "newest_local", return_value="58"):
            self.assertEqual(A.latest(*A.ARCHETYPE), ("99", "Maven Central"))

    def test_local_when_central_unreachable(self):
        with mock.patch.object(A, "central_latest", return_value=None), \
             mock.patch.object(A, "newest_local", return_value="58"):
            self.assertEqual(A.latest(*A.ARCHETYPE), ("58", "local Maven repository"))
            self.assertEqual(A.resolve_latest_archetype(), "58")

    def test_neither(self):
        with mock.patch.object(A, "central_latest", return_value=None), \
             mock.patch.object(A, "newest_local", return_value=None):
            self.assertEqual(A.latest(*A.SDK_API), (None, ""))
            self.assertIsNone(A.resolve_latest_sdk_api())


class RefactorPomsSdkFlag(unittest.TestCase):
    """refactor_poms writes the archetype templates' SDK unless --sdk-version overrides it."""

    def test_override_wins_and_default_is_the_templates(self):
        RP._sdk_api_version_override = "2099.9.9.EXPLICIT"
        try:
            self.assertEqual(RP._effective_sdk_api_version(), "2099.9.9.EXPLICIT")
        finally:
            RP._sdk_api_version_override = None
        self.assertEqual(RP._effective_sdk_api_version(), RP._AEM_SDK_API_VERSION)


if __name__ == "__main__":
    unittest.main()
