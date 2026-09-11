import contextlib
import io
import json
from pathlib import Path
import sys
import sysconfig
import tempfile
import types
import unittest
from unittest.mock import patch

from test_dependency_lock import checker, pin


class DependencyVerificationTests(unittest.TestCase):
    def run_verifier(self, version="1.2.3", content=None, missing=False, shadow=False,
                     import_error=False, existing=False):
        with tempfile.TemporaryDirectory(prefix="lakda-dependency-") as directory:
            root = Path(directory)
            lock, output = root / "lock.txt", root / "verification.json"
            if not missing:
                lock.write_bytes(pin().encode() if content is None else content)
            if existing:
                output.write_bytes(b"historical evidence")
            library = root / "site-packages"
            library.mkdir()
            module_path = (root if shadow else library) / "fixture.py"
            module_path.write_text("# fixture\n", encoding="utf-8")
            installed = types.SimpleNamespace(metadata={"Name": "Example.Pkg"}, version=version)
            vendored = types.SimpleNamespace(metadata={"Name": "Example.Pkg"}, version="0.1")

            def distributions(**kwargs):
                return [installed] if kwargs.get("path") == [str(library)] else [installed, vendored]

            stdout = io.StringIO()
            with patch.object(sys, "argv", ["verify_dependencies.py", "--lock", str(lock), "--out", str(output)]), \
                    patch.object(sysconfig, "get_path", return_value=str(library)), \
                    patch.object(checker.importlib.metadata, "distributions", side_effect=distributions) as inventory, \
                    patch.object(checker.importlib, "import_module", return_value=types.SimpleNamespace(__file__=str(module_path)),
                                 side_effect=ImportError("fixture import error") if import_error else None) as importer, \
                    contextlib.redirect_stdout(stdout):
                code = checker.main()
            if existing:
                self.assertEqual(output.read_bytes(), b"historical evidence")
                self.assertEqual(code, 1)
                self.assertFalse(json.loads(stdout.getvalue())["evidenceSaved"])
                return
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result["schemaVersion"], "lakda/bridge-dependency-verification/v2")
            self.assertEqual(result["scope"], "locked-versions-and-package-import")
            self.assertEqual(code == 0, result["status"] == "passed")
            self.assertTrue(json.loads(stdout.getvalue())["evidenceSaved"])
            return code, result, inventory, importer

    def test_only_interpreter_site_packages_are_compared_not_vendored_metadata(self):
        code, result, inventory, importer = self.run_verifier()
        self.assertEqual(code, 0)
        self.assertEqual(result["dependencyCheck"]["installedPackages"], 1)
        self.assertEqual(result["dependencyCheck"]["lockedPackages"], 1)
        self.assertEqual(len(result["imports"]), 7)
        self.assertEqual(importer.call_count, 7)
        self.assertEqual(inventory.call_count, 1)
        self.assertTrue(all(row["status"] == "passed" for row in result["imports"]))

    def test_version_mismatch_does_not_pass_with_successful_imports(self):
        code, result, _inventory, importer = self.run_verifier(version="9.9")
        self.assertEqual(code, 1)
        self.assertEqual(result["dependencyCheck"]["checks"][0]["reason"], "version-mismatch")
        importer.assert_not_called()
        self.assertTrue(all(row["status"] == "not-run" for row in result["imports"]))

    def test_missing_and_invalid_locks_still_produce_failed_evidence(self):
        for arguments in ({"missing": True}, {"content": b"invalid lock"}):
            with self.subTest(arguments=arguments):
                code, result, _inventory, importer = self.run_verifier(**arguments)
                self.assertEqual(code, 1)
                self.assertEqual(result["dependencyCheck"]["status"], "failed")
                importer.assert_not_called()

    def test_module_outside_the_checked_environment_is_not_accepted(self):
        code, result, _inventory, _importer = self.run_verifier(shadow=True)
        self.assertEqual(code, 1)
        self.assertTrue(all(row["reason"] == "outside-environment" for row in result["imports"]))

    def test_import_error_is_separate_from_version_consistency(self):
        code, result, _inventory, _importer = self.run_verifier(import_error=True)
        self.assertEqual(code, 1)
        self.assertEqual(result["dependencyCheck"]["status"], "passed")
        self.assertTrue(all(row["errorType"] == "ImportError" for row in result["imports"]))

    def test_existing_evidence_is_not_overwritten(self):
        self.run_verifier(existing=True)
