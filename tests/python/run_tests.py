"""Python bridge fixtureの実結果をJSON／JUnitへ記録する。"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import sys
import time
import unittest
import xml.etree.ElementTree as ET


class EvidenceResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = []
        self.active_test = None
        self.current = None

    def startTest(self, test):
        self.test_started = time.monotonic()
        self.active_test = test
        self.current = {"id": test.id(), "kind": "test", "status": "passed"}
        super().startTest(test)

    def record_outcome(self, test, status, reason):
        # Fixture callbacks have no startTest/stopTest; skipped subtests belong
        # to their active parent and must not become extra executed cases.
        if self.active_test is not None and (
                test is self.active_test or getattr(test, "test_case", None) is self.active_test):
            record = self.current
        else:
            record = {"id": test.id(), "kind": "fixture", "status": "passed", "durationMs": None}
            self.records.append(record)
        priority = {"passed": 0, "skipped": 1, "expected-failure": 2,
                    "unexpected-success": 3, "failed": 4, "error": 5}
        if priority[status] >= priority[record["status"]]:
            record.update(status=status, reason=reason)

    def addFailure(self, test, err):
        self.record_outcome(test, "failed", err[0].__name__)
        super().addFailure(test, err)

    def addError(self, test, err):
        self.record_outcome(test, "error", err[0].__name__)
        super().addError(test, err)

    def addSkip(self, test, reason):
        self.record_outcome(test, "skipped", reason)
        super().addSkip(test, reason)

    def addExpectedFailure(self, test, err):
        self.record_outcome(test, "expected-failure", "expected failure: " + err[0].__name__)
        super().addExpectedFailure(test, err)

    def addUnexpectedSuccess(self, test):
        self.record_outcome(test, "unexpected-success", "unexpected success")
        super().addUnexpectedSuccess(test)

    def addSubTest(self, test, subtest, err):
        if err is not None:
            status = "failed" if issubclass(err[0], test.failureException) else "error"
            self.record_outcome(test, status, err[0].__name__)
        super().addSubTest(test, subtest, err)

    def stopTest(self, test):
        self.current["durationMs"] = round((time.monotonic() - self.test_started) * 1000, 3)
        self.records.append(self.current)
        self.active_test = None
        self.current = None
        super().stopTest(test)


def result_counts(result):
    """JUnit and JSON count cases, not the number of failed subtest steps."""
    return {
        "tests": len(result.records),
        "failures": sum(record["status"] in ("failed", "unexpected-success") for record in result.records),
        "errors": sum(record["status"] == "error" for record in result.records),
        "skipped": sum(record["status"] in ("skipped", "expected-failure") for record in result.records),
    }


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(root / ".lakda/qa/python"))
    args = parser.parse_args()
    # compile() verifies syntax without creating __pycache__ in the package.
    source = root / "tools/airtest-poco-bridge/server.py"
    compile(source.read_bytes(), str(source), "exec")
    started = datetime.now(timezone.utc).isoformat()
    suite = unittest.defaultTestLoader.discover(str(root / "tests/python"))
    result = unittest.TextTestRunner(verbosity=2, resultclass=EvidenceResult).run(suite)
    counts = result_counts(result)
    if result.errors:
        reason = "test-errors"
    elif result.unexpectedSuccesses:
        reason = "unexpected-successes"
    elif not result.wasSuccessful():
        reason = "test-failures"
    elif not result.records:
        reason = "no-tests"
    elif not any(record["status"] == "passed" for record in result.records):
        reason = "no-passed-tests"
    else:
        reason = None
    passed = reason is None
    summary = {
        "schemaVersion": "lakda/python-bridge-test/v1", "status": "passed" if passed else "failed", "reason": reason,
        "executionMode": "fixture", "startedAt": started, "endedAt": datetime.now(timezone.utc).isoformat(),
        "pythonVersion": platform.python_version(), "platform": sys.platform,
        **counts, "executedTests": result.testsRun,
        "ordinarySkipped": sum(record["status"] == "skipped" for record in result.records),
        "expectedFailures": sum(record["status"] == "expected-failure" for record in result.records),
        "unexpectedSuccesses": sum(record["status"] == "unexpected-success" for record in result.records),
        "cases": result.records,
    }
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    xml = ET.Element("testsuite", name="lakda-python-bridge", **{key: str(value) for key, value in counts.items()})
    for record in result.records:
        attributes = {"name": record["id"]}
        if record["durationMs"] is not None:
            attributes["time"] = str(record["durationMs"] / 1000)
        case = ET.SubElement(xml, "testcase", **attributes)
        if record["status"] != "passed":
            tags = {"failed": "failure", "error": "error", "skipped": "skipped",
                    "expected-failure": "skipped", "unexpected-success": "failure"}
            ET.SubElement(case, tags[record["status"]], message=record.get("reason", record["status"]))
    ET.ElementTree(xml).write(output / "junit.xml", encoding="utf-8", xml_declaration=True)
    print(json.dumps({key: value for key, value in summary.items() if key != "cases"}))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
