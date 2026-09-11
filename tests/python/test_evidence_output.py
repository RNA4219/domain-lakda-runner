import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from run_tests import main


class EvidenceOutputTests(unittest.TestCase):
    def run_evidence(self, case):
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
        with tempfile.TemporaryDirectory(prefix="lakda-evidence-") as directory:
            output = Path(directory)
            with patch.object(sys, "argv", ["run_tests.py", "--out", directory]), \
                    patch.object(unittest.defaultTestLoader, "discover", return_value=suite), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = main()
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            xml = ET.parse(output / "junit.xml").getroot()
        self.assertEqual(summary["tests"], len(summary["cases"]))
        self.assertEqual(summary["tests"], len(xml.findall("testcase")))
        for key in ("tests", "failures", "errors", "skipped"):
            self.assertEqual(int(xml.get(key)), summary[key])
        for key, tag in (("failures", "failure"), ("errors", "error"), ("skipped", "skipped")):
            self.assertEqual(len(xml.findall("testcase/" + tag)), summary[key])
        self.assertEqual(code == 0, summary["status"] == "passed")
        if code != 0:
            self.assertIsInstance(summary.get("reason"), str)
        return code, summary, xml

    def test_module_and_class_errors_have_their_own_records(self):
        def fixture_error(*_args):
            raise RuntimeError("fixture setup or teardown")

        for hook in ("setUpModule", "tearDownModule", "setUpClass", "tearDownClass"):
            with self.subTest(hook=hook):
                class Fixture(unittest.TestCase):
                    def test_body(self):
                        pass
                module = types.ModuleType("lakda_evidence_fixture")
                Fixture.__module__ = module.__name__
                if hook.endswith("Module"):
                    setattr(module, hook, fixture_error)
                else:
                    setattr(Fixture, hook, classmethod(fixture_error))
                with patch.dict(sys.modules, {module.__name__: module}):
                    code, summary, xml = self.run_evidence(Fixture)
                self.assertEqual(code, 1)
                self.assertEqual(summary["errors"], 1)
                started = 0 if hook.startswith("setUp") else 1
                self.assertEqual(summary["executedTests"], started)
                self.assertEqual(summary["tests"], started + 1)
                record = summary["cases"][-1]
                self.assertTrue(record["id"].startswith(hook + " ("))
                self.assertEqual(record["kind"], "fixture")
                self.assertEqual(record["status"], "error")
                self.assertIsNone(record["durationMs"])
                self.assertIsNone(xml.findall("testcase")[-1].get("time"))
                if started:
                    self.assertEqual(summary["cases"][0]["status"], "passed")

    def test_skipped_class_is_not_an_executed_test(self):
        class Fixture(unittest.TestCase):
            @classmethod
            def setUpClass(cls):
                raise unittest.SkipTest("fixture unavailable")

            def test_body(self):
                pass
        code, summary, xml = self.run_evidence(Fixture)
        self.assertEqual((code, summary["executedTests"], summary["skipped"]), (1, 0, 1))
        self.assertIn("fixture unavailable", xml.find("testcase/skipped").get("message"))

    def test_expected_failure_alone_is_not_success(self):
        class Fixture(unittest.TestCase):
            @unittest.expectedFailure
            def test_expected(self):
                self.fail("known fixture failure")
        code, summary, xml = self.run_evidence(Fixture)
        self.assertEqual(code, 1)
        self.assertEqual(summary["cases"][0]["status"], "expected-failure")
        self.assertEqual(summary["expectedFailures"], 1)
        self.assertEqual(summary["skipped"], 1)
        self.assertIn("expected failure", xml.find("testcase/skipped").get("message"))

    def test_unexpected_success_is_a_failure_in_both_formats(self):
        class Fixture(unittest.TestCase):
            @unittest.expectedFailure
            def test_unexpected(self):
                pass
        code, summary, xml = self.run_evidence(Fixture)
        self.assertEqual(code, 1)
        self.assertEqual(summary["cases"][0]["status"], "unexpected-success")
        self.assertEqual(summary["unexpectedSuccesses"], 1)
        self.assertEqual(summary["failures"], 1)
        self.assertIsNotNone(xml.find("testcase/failure"))

    def test_success_with_skip_and_expected_failure_is_explicit(self):
        class Fixture(unittest.TestCase):
            def test_pass(self):
                pass

            @unittest.skip("fixture skip")
            def test_skip(self):
                pass

            @unittest.expectedFailure
            def test_expected(self):
                self.fail("known fixture failure")
        code, summary, _xml = self.run_evidence(Fixture)
        self.assertEqual(code, 0)
        self.assertEqual(summary["executedTests"], 3)
        self.assertEqual(summary["skipped"], 2)
        self.assertEqual(summary["ordinarySkipped"], 1)
        self.assertEqual(summary["expectedFailures"], 1)
        self.assertEqual([row["status"] for row in summary["cases"]].count("passed"), 1)

    def test_later_skipped_subtest_does_not_erase_failure_or_error(self):
        for exception in (AssertionError, RuntimeError):
            with self.subTest(exception=exception.__name__):
                class Fixture(unittest.TestCase):
                    def test_steps(self):
                        for value in (1, 2):
                            with self.subTest(value=value):
                                if value == 1:
                                    raise exception("fixture failure")
                                self.skipTest("later skipped step")
                code, summary, _xml = self.run_evidence(Fixture)
                self.assertEqual(code, 1)
                expected = "failed" if exception is AssertionError else "error"
                self.assertEqual(summary["cases"][0]["status"], expected)
                self.assertEqual(summary["tests"], 1)

    def test_zero_tests_and_all_skipped_are_failed_reports(self):
        class Skipped(unittest.TestCase):
            @unittest.skip("fixture skip")
            def test_skip(self):
                pass
        for case, started in ((unittest.TestCase, 0), (Skipped, 1)):
            with self.subTest(started=started):
                code, summary, _xml = self.run_evidence(case)
                self.assertEqual(code, 1)
                self.assertEqual(summary["executedTests"], started)
