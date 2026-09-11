"""実機やAirtest importなしで、Android providerの取得境界を検証する。"""
import importlib.util
import io
import json
import logging
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from bridge_fixture import BridgeTestCase

spec = importlib.util.spec_from_file_location("lakda_native_identity", Path(__file__).resolve().parents[2] / "tools/airtest-poco-bridge/native_identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
APP = "org.example.fixture"
DUMP = ("Packages:\n  Package [" + APP + "] (abc):\n    versionCode=42 minSdk=23\n").encode()
RAW = "raw-device-canary"


class AndroidIdentityTests(unittest.TestCase):
    def fixture(self, outputs=None, hook=None):
        calls = []
        outputs = iter(outputs if outputs is not None else [RAW.encode() + b"\n", DUMP, b"14\n", DUMP, RAW.encode() + b"\n"])
        adb = SimpleNamespace(serialno="private-adb-selector")
        device = SimpleNamespace(adb=adb)

        def command(argv, **kwargs):
            calls.append((argv, kwargs))
            if hook:
                hook(len(calls), device)
            value = next(outputs)
            if isinstance(value, Exception):
                raise value
            return value

        adb.cmd = command
        return device, calls

    def observe(self, device, **kwargs):
        return identity.observe_android_identity(device, APP, {"airtestVersion": "1.3.5"}, **kwargs)

    def assert_unavailable(self, result):
        self.assertTrue(all(row == {"status": "unavailable", "source": "unavailable", "value": None} for row in result["fields"].values()))

    def test_observes_installed_app_and_device_using_only_fixed_read_commands(self):
        device, calls = self.fixture()
        result = self.observe(device)
        self.assertEqual(result["fields"]["appId"]["value"], APP)
        self.assertEqual(result["fields"]["appBuild"]["value"], "42")
        self.assertEqual(result["fields"]["platformVersion"]["value"], "14")
        self.assertEqual(result["fields"]["deviceDigest"]["value"], "sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089")
        self.assertEqual([call[0] for call in calls], [["shell", "getprop", "ro.serialno"], ["shell", "dumpsys", "package", APP],
                         ["shell", "getprop", "ro.build.version.release"], ["shell", "dumpsys", "package", APP], ["shell", "getprop", "ro.serialno"]])
        for _, arguments in calls:
            self.assertTrue(arguments["device"])
            self.assertFalse(arguments["ensure_unicode"])
            self.assertGreater(arguments["timeout"], 0)
            self.assertLessEqual(arguments["timeout"], 5)
        self.assertNotIn(RAW, json.dumps(result))
        self.assertNotIn("private-adb-selector", json.dumps(result))

    def test_missing_device_and_unpinned_sdk_never_query(self):
        self.assert_unavailable(self.observe(None))
        for version in (None, "1.3.4", "1.3.6"):
            device, calls = self.fixture()
            self.assert_unavailable(identity.observe_android_identity(device, APP, {"airtestVersion": version}))
            self.assertEqual(calls, [])

    def test_invalid_package_and_time_budget_never_query(self):
        device, calls = self.fixture()
        for app in ("", "app;id", "app name", "app/other", "-option", "a." + "b" * 256):
            with self.subTest(app=app), self.assertRaisesRegex(ValueError, "identity-request-invalid"):
                identity.observe_android_identity(device, app, {"airtestVersion": "1.3.5"})
        for duration in (True, 999, 15001, 1000.5, float("nan")):
            with self.subTest(duration=duration), self.assertRaisesRegex(ValueError, "identity-request-invalid"):
                self.observe(device, timeout_ms=duration)
        self.assertEqual(calls, [])

    def test_malformed_or_ambiguous_package_never_uses_the_declared_app(self):
        for invalid in (b"", DUMP.replace(APP.encode(), b"another.app"), DUMP + DUMP,
                        DUMP + b"    versionCode=43\n", DUMP.replace(b"42", b"042"), DUMP.replace(b"42", b"9" * 21),
                        DUMP.replace(b"    versionCode=", b"Other section:\n    versionCode=")):
            with self.subTest(output=invalid):
                device, _ = self.fixture([RAW.encode(), invalid, b"14", invalid, RAW.encode()])
                result = self.observe(device)
                self.assertEqual(result["fields"]["appId"]["status"], "unavailable")
                self.assertEqual(result["fields"]["appBuild"]["status"], "unavailable")

    def test_changed_build_or_device_discards_the_snapshot(self):
        for index, value in ((3, DUMP.replace(b"42", b"43")), (4, b"another-device")):
            outputs = [RAW.encode(), DUMP, b"14", DUMP, RAW.encode()]
            outputs[index] = value
            device, _ = self.fixture(outputs)
            self.assert_unavailable(self.observe(device))

    def test_connection_object_or_selector_change_discards_the_snapshot(self):
        for change in (lambda device: setattr(device.adb, "serialno", "another-selector"), lambda device: setattr(device, "adb", object())):
            device, _ = self.fixture(hook=lambda index, current: change(current) if index == 2 else None)
            self.assert_unavailable(self.observe(device))

    def test_bad_transport_and_private_errors_never_escape(self):
        for invalid in (RuntimeError(RAW + " private path"), b"\xff", b"x" * (identity.MAX_RESPONSE_BYTES + 1), None):
            with self.subTest(kind=type(invalid).__name__):
                device, _ = self.fixture([invalid])
                self.assert_unavailable(self.observe(device))

    def test_one_monotonic_budget_covers_all_queries_and_rejects_late_results(self):
        ticks = [0.0]
        device, calls = self.fixture(hook=lambda index, current: ticks.__setitem__(0, ticks[0] + 0.3))
        with patch.object(identity.time, "monotonic", side_effect=lambda: ticks[0]):
            self.assert_unavailable(self.observe(device, timeout_ms=1000))
        self.assertEqual(len(calls), 4)
        self.assertEqual([round(call[1]["timeout"], 2) for call in calls], [1, 0.7, 0.4, 0.1])

    def test_properties_reject_private_or_invalid_values_without_substitution(self):
        for raw in (b"", b" serial ", b"serial\nextra", b"serial\\path", b"serial\x00"):
            device, _ = self.fixture([raw, DUMP, b"14", DUMP, raw])
            self.assert_unavailable(self.observe(device))
        device, _ = self.fixture([RAW.encode(), DUMP, b"bad\x00version", DUMP, RAW.encode()])
        self.assertEqual(self.observe(device)["fields"]["platformVersion"]["status"], "unavailable")

    def test_private_sdk_logging_is_thread_scoped_and_restored_after_failure(self):
        logger = logging.getLogger("airtest.core.android.adb")
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        logger.addHandler(handler)
        original_level, original_filters = logger.level, list(logger.filters)
        logger.setLevel(logging.DEBUG)

        def during_query(index, device):
            logger.debug(RAW)
            worker = threading.Thread(target=lambda: logger.debug("other-thread-kept"))
            worker.start()
            worker.join(timeout=1)
            self.assertFalse(worker.is_alive())

        try:
            device, _ = self.fixture([RuntimeError(RAW)], hook=during_query)
            self.assert_unavailable(self.observe(device))
            self.assertNotIn(RAW, stream.getvalue())
            self.assertIn("other-thread-kept", stream.getvalue())
            self.assertEqual(logger.filters, original_filters)
            logger.debug("after-query-kept")
            self.assertIn("after-query-kept", stream.getvalue())
        finally:
            logger.removeHandler(handler)
            logger.setLevel(original_level)

    def test_device_digest_matches_typescript_and_rejects_invalid_identifiers(self):
        self.assertEqual(identity.android_device_digest(RAW), "sha256:2ed25b90cc813d5fb19ada61d2a6a4a8c7a541f50dd3a0d5bd22844f8ba15089")
        for invalid in ("", " a", "a\x00", "a/path", "\ud800", "😀" * 257):
            with self.subTest(identifier_type=type(invalid).__name__), self.assertRaisesRegex(ValueError, "device-identifier-invalid"):
                identity.android_device_digest(invalid)


class NativeIdentityBridgeTests(BridgeTestCase):
    def test_bridge_collects_sdk_values_independently_of_operator_declarations(self):
        outputs = iter([RAW.encode(), DUMP, b"14", DUMP, RAW.encode()])
        self.state.device = SimpleNamespace(adb=SimpleNamespace(serialno="private-selector", cmd=lambda *args, **kwargs: next(outputs)))
        self.state.app_id = APP
        self.state.app_revision = "operator-revision"
        self.state.platform_version = "operator-os"
        self.state.serial_digest = "sha256:" + "c" * 64
        self.state.runtime_versions = {"airtestVersion": "1.3.5"}
        result = self.state.native_identity_fields()
        self.assertEqual(result["fields"]["appBuild"]["value"], "42")
        self.assertEqual(result["fields"]["platformVersion"]["value"], "14")
        self.assertNotEqual(result["fields"]["deviceDigest"]["value"], self.state.serial_digest)
        self.assertNotIn("operator-", json.dumps(result))

    def test_disconnected_bridge_does_not_query_an_old_device(self):
        self.state.app_id = APP
        self.state.runtime_versions = {"airtestVersion": "1.3.5"}
        self.state.airtest = None
        command = Mock(side_effect=AssertionError("disconnected device was queried"))
        self.state.device = SimpleNamespace(adb=SimpleNamespace(serialno="private-selector", cmd=command))
        result = self.state.native_identity_fields()
        self.assertTrue(all(field["status"] == "unavailable" for field in result["fields"].values()))
        command.assert_not_called()

    def test_replacement_of_bridge_device_during_collection_is_rejected(self):
        outputs = iter([RAW.encode(), DUMP, b"14", DUMP, RAW.encode()])
        self.state.app_id = APP
        self.state.runtime_versions = {"airtestVersion": "1.3.5"}

        def command(*args, **kwargs):
            self.state.device = object()
            return next(outputs)

        self.state.device = SimpleNamespace(adb=SimpleNamespace(serialno="private-selector", cmd=command))
        with self.assertRaisesRegex(ValueError, "connection-changed"):
            self.state.native_identity_fields()

    def test_other_platforms_do_not_claim_android_provider_support(self):
        for platform in ("windows", "ios"):
            self.state.platform = platform
            with self.subTest(platform=platform), self.assertRaisesRegex(ValueError, "provider-unavailable"):
                self.state.native_identity_fields()
