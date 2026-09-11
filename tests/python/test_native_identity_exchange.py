"""観測の一回用sessionと接続bindingを実機なしで検証する。"""
import importlib.util
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import uuid
from unittest.mock import Mock, patch
from bridge_fixture import BridgeTestCase

ROOT = Path(__file__).resolve().parents[2] / "tools/airtest-poco-bridge"
spec = importlib.util.spec_from_file_location("lakda_native_exchange", ROOT / "native_identity_exchange.py")
exchange = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", [str(ROOT), *sys.path]):
    spec.loader.exec_module(exchange)
APP = "org.example.fixture"
RAW = "raw-device-canary"
ENDPOINT = "http://127.0.0.1:9988/"


class FixtureTransport:
    """観測契約だけの試験用。実通信はtransport専用試験で扱う。"""
    def __init__(self, adb, idle_timeout):
        self.adb, self.closed = adb, False

    def check(self, adb):
        if self.closed or adb is not self.adb:
            raise exchange.NativeTransportError("transport-closed")

    def keepalive(self, deadline):
        self.check(self.adb)

    def close(self):
        self.closed = True


class IdentityExchangeTests(BridgeTestCase):
    def setUp(self):
        super().setUp()
        self.commands = []
        self.state.app_id = APP
        self.state.app_revision = "approved-revision"
        self.state.runtime_versions = {"airtestVersion": "1.3.5"}
        dump = ("Packages:\n  Package [" + APP + "] (abc):\n    versionCode=42 minSdk=23\n").encode()

        def command(argv, **kwargs):
            self.commands.append(argv)
            return dump if argv[1] == "dumpsys" else b"14\n" if argv[-1].endswith("release") else RAW.encode() + b"\n"

        self.state.device = SimpleNamespace(adb=SimpleNamespace(serialno="private-selector", cmd=command))
        self.provider = Mock(wraps=self.state.native_identity_fields)
        self.state.native_identity_fields = self.provider
        self.exchange = exchange.NativeIdentityExchange(self.state)
        self.exchange._transport_factory = FixtureTransport
        self.state.native_identity_exchange._transport_factory = FixtureTransport
        self.addCleanup(self.exchange.close)

    def opening(self, **changes):
        value = {"schemaVersion": "lakda/native-identity-open/v1", "challenge": str(uuid.uuid4()), "maxAgeMs": 60000,
                 "bridgeBinding": {"bridgeDigest": exchange._digest({"transport": "loopback-json/v1", "endpoint": ENDPOINT}),
                                   "capabilityDigest": exchange._digest(self.state.capabilities())}}
        value.update(changes)
        return value

    def open(self, **changes):
        return self.exchange.open(self.opening(**changes), ENDPOINT)

    def observing(self, session):
        return {"schemaVersion": "lakda/native-identity-request/v1", "connectionId": session["connectionId"], "challenge": session["challenge"]}

    def observe(self, session):
        return self.exchange.observe(self.observing(session), ENDPOINT)

    def test_open_binds_server_generated_ids_without_collecting_device_data(self):
        request = self.opening()
        session = self.exchange.open(request, ENDPOINT)
        self.assertEqual(session["schemaVersion"], "lakda/native-identity-session/v1")
        self.assertEqual(session["challenge"], request["challenge"])
        self.assertEqual(session["bridgeBinding"], request["bridgeBinding"])
        self.assertRegex(session["connectionId"], "^[0-9a-f-]{36}$")
        self.assertNotEqual(session["connectionId"], self.open()["connectionId"])
        self.assertEqual(self.commands, [])
        self.provider.assert_not_called()

    def test_observation_consumes_one_session_and_keeps_declarations_separate(self):
        session = self.open()
        record = self.observe(session)
        self.assertEqual(record["schemaVersion"], "lakda/native-identity-observation/v1")
        self.assertEqual(record["bridgeBinding"], {**session["bridgeBinding"], "connectionId": session["connectionId"]})
        self.assertEqual(record["challenge"], session["challenge"])
        self.assertEqual(record["fields"]["appBuild"]["value"], "42")
        self.assertEqual(record["declared"]["appRevision"], "approved-revision")
        self.assertNotIn(RAW, json.dumps(record))
        with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-unavailable"):
            self.observe(session)
        self.assertEqual(self.provider.call_count, 1)

    def test_invalid_requests_and_policy_do_not_invoke_provider(self):
        for change in ({"schemaVersion": "legacy"}, {"challenge": "not-a-uuid"}, {"maxAgeMs": True}, {"maxAgeMs": 999}, {"maxAgeMs": 300001}, {"unknown": "raw"}):
            with self.subTest(change=change), self.assertRaises(exchange.NativeIdentityExchangeError):
                self.open(**change)
        self.provider.assert_not_called()

    def test_wrong_endpoint_or_capability_cannot_open(self):
        for key in ("bridgeDigest", "capabilityDigest"):
            request = self.opening()
            request["bridgeBinding"][key] = "sha256:" + "f" * 64
            with self.subTest(key=key), self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "binding-mismatch"):
                self.exchange.open(request, ENDPOINT)
        self.provider.assert_not_called()

    def test_expired_session_is_rejected_before_provider(self):
        ticks = [0.0]
        with patch.object(exchange.time, "monotonic", side_effect=lambda: ticks[0]):
            session = self.open()
            ticks[0] = 30
            with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-unavailable"):
                self.observe(session)
        self.provider.assert_not_called()

    def test_connection_and_capability_changes_invalidate_open_sessions(self):
        for change in (lambda: setattr(self.state, "device", object()), lambda: setattr(self.state.device.adb, "serialno", "another-selector"),
                       lambda: setattr(self.state, "target_revision", "another-revision")):
            session = self.open()
            with patch.object(self.state, "device", self.state.device), patch.object(self.state, "target_revision", self.state.target_revision):
                change()
                with self.assertRaises(exchange.NativeIdentityExchangeError):
                    self.observe(session)
        self.provider.assert_not_called()

    def test_wrong_challenge_consumes_the_session_without_collecting(self):
        session = self.open()
        request = self.observing(session)
        request["challenge"] = str(uuid.uuid4())
        with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-unavailable"):
            self.exchange.observe(request, ENDPOINT)
        with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-unavailable"):
            self.observe(session)
        self.provider.assert_not_called()

    def test_connection_switch_during_capability_read_is_rejected_before_provider(self):
        session = self.open()
        original = self.state.capabilities

        def switching():
            value = original()
            self.state.device = object()
            return value

        with patch.object(self.state, "capabilities", side_effect=switching):
            with self.assertRaises(exchange.NativeIdentityExchangeError):
                self.observe(session)
        self.provider.assert_not_called()

    def test_registry_is_bounded_and_expired_entries_can_be_replaced(self):
        ticks = [0.0]
        with patch.object(exchange.time, "monotonic", side_effect=lambda: ticks[0]):
            sessions = [self.open() for _ in range(32)]
            with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-capacity"):
                self.open()
            ticks[0] = 30
            self.assertNotIn(self.open()["connectionId"], [value["connectionId"] for value in sessions])
        self.provider.assert_not_called()

    def test_missing_observation_is_declared_only_without_value_substitution(self):
        session = self.open()
        self.provider.return_value = {"provider": {"name": "fixture", "version": "1"}, "fields": {
            key: {"status": "unavailable", "source": "unavailable", "value": None} for key in exchange.SOURCES}}
        record = self.observe(session)
        self.assertEqual(record["fields"]["appBuild"], {"status": "declared-only", "source": "operator-declaration", "value": None})
        self.assertEqual(record["fields"]["deviceDigest"]["status"], "unavailable")

    def test_invalid_declared_values_never_reach_provider_or_response(self):
        self.state.app_revision = "C:\\private\\build"
        session = self.open()
        with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "declaration-invalid"):
            self.observe(session)
        self.provider.assert_not_called()

    def test_private_provider_data_is_rejected_and_session_cannot_be_reused(self):
        session = self.open()
        self.provider.return_value = {"provider": {"name": "fixture", "version": "1"}, "fields": {}, "rawSerial": RAW}
        with self.assertRaises(exchange.NativeIdentityExchangeError) as caught:
            self.observe(session)
        self.assertNotIn(RAW, str(caught.exception))
        with self.assertRaises(exchange.NativeIdentityExchangeError):
            self.observe(session)
        self.assertEqual(self.provider.call_count, 1)

    def test_provider_failure_keeps_exception_details_private(self):
        session = self.open()
        self.provider.side_effect = RuntimeError(RAW + " private-path")
        with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "provider-unavailable") as caught:
            self.observe(session)
        self.assertNotIn(RAW, str(caught.exception))

    def test_observation_expiry_includes_collection_time(self):
        ticks = [0.0]
        fields = {key: {"status": "unavailable", "source": "unavailable", "value": None} for key in exchange.SOURCES}
        with patch.object(exchange.time, "monotonic", side_effect=lambda: ticks[0]):
            session = self.open(maxAgeMs=1000)

            def late(**kwargs):
                ticks[0] = 1
                return {"provider": {"name": "fixture", "version": "1"}, "fields": fields}

            self.provider.side_effect = late
            with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "observation-expired"):
                self.observe(session)

    def test_concurrent_reuse_does_not_start_a_second_provider_call(self):
        session, started, release = self.open(), threading.Event(), threading.Event()
        results, errors = [], []

        def blocking(**kwargs):
            started.set()
            if not release.wait(timeout=2):
                raise RuntimeError("fixture release timed out")
            return {"provider": {"name": "fixture", "version": "1"}, "fields": {
                key: {"status": "unavailable", "source": "unavailable", "value": None} for key in exchange.SOURCES}}

        def first():
            try:
                results.append(self.observe(session))
            except Exception as error:
                errors.append(error)

        self.provider.side_effect = blocking
        thread = threading.Thread(target=first)
        thread.start()
        try:
            self.assertTrue(started.wait(timeout=1))
            with self.assertRaisesRegex(exchange.NativeIdentityExchangeError, "session-unavailable"):
                self.observe(session)
        finally:
            release.set()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 1)
        self.assertEqual(self.provider.call_count, 1)
