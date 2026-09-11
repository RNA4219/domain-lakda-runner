import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


BRIDGE_ROOT = Path(__file__).resolve().parents[2] / "tools/airtest-poco-bridge"
spec = importlib.util.spec_from_file_location("lakda_dependency_verifier", BRIDGE_ROOT / "verify_dependencies.py")
checker = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", [str(BRIDGE_ROOT), *sys.path]):
    spec.loader.exec_module(checker)


def pin(name="example_pkg", version="1.2.3"):
    return name + "==" + version + " \\\n    --hash=sha256:" + "a" * 64 + "\n"


class DependencyLockTests(unittest.TestCase):
    def test_generated_lock_and_name_normalization(self):
        lock = checker.parse_lock(("# fixture\n\n" + pin("Example.Pkg") + pin("Other", "2.0")).encode())
        self.assertEqual(lock, {"example-pkg": "1.2.3", "other": "2.0"})
        actual = checker.parse_lock((BRIDGE_ROOT / "locks/windows-amd64-py312.txt").read_bytes())
        self.assertEqual(actual["airtest"], "1.3.5")
        self.assertEqual(actual["pocoui"], "1.0.94")
        self.assertGreater(len(actual), 2)

    def test_incomplete_or_unsupported_lock_is_not_partially_accepted(self):
        invalid = [b"", b"\xff", b"# no packages\n", b"example==1.2.3\n",
                   (pin() + "--index-url https://example.invalid\n").encode(),
                   (pin() + "-r other.txt\n").encode(), (pin() + "trailing\\").encode(),
                   pin().replace("a" * 64, "a" * 63).encode(),
                   pin().replace("example_pkg==1.2.3", 'example_pkg==1.2.3; python_version > "3"').encode(),
                   (pin("example.pkg") + pin("EXAMPLE_pkg")).encode(),
                   b"#" + b"x" * (1024 * 1024)]
        for content in invalid:
            with self.subTest(content=content[:55]):
                with self.assertRaises(ValueError):
                    checker.parse_lock(content)

    def test_versions_match_and_installer_exclusion_is_explicit(self):
        result = checker.compare_packages({"example-pkg": "1.2.3"}, [
            {"name": "Example.Pkg", "version": "1.2.3"}, {"name": "pip", "version": "25.0"}])
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["excluded"], [{"name": "pip", "version": "25.0"}])
        self.assertEqual(result["checks"][0]["reason"], "match")

    def test_missing_wrong_duplicate_and_extra_packages_fail(self):
        cases = [([], "missing"), ([{"name": "example-pkg", "version": "9.0"}], "version-mismatch"),
                 ([{"name": "example-pkg", "version": "1.2.3"},
                   {"name": "EXAMPLE.PKG", "version": "1.2.3"}], "ambiguous-distribution"),
                 ([{"name": "example-pkg", "version": "1.2.3"},
                   {"name": "other", "version": "1.0"}], "unexpected-package")]
        for packages, reason in cases:
            with self.subTest(reason=reason):
                result = checker.compare_packages({"example-pkg": "1.2.3"}, packages)
                self.assertEqual(result["status"], "failed")
                self.assertIn(reason, [row["reason"] for row in result["checks"]])

    def test_pip_is_checked_when_locked_and_duplicates_are_never_hidden(self):
        for locked, packages in [({"pip": "24.0"}, [{"name": "pip", "version": "25.0"}]),
                                 ({"example": "1.0"}, [{"name": "example", "version": "1.0"},
                                  {"name": "pip", "version": "25.0"}, {"name": "pip", "version": "25.0"}])]:
            with self.subTest(locked=locked):
                self.assertEqual(checker.compare_packages(locked, packages)["status"], "failed")
