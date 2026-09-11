"""人工ADBの実TCP接続を観測とSDK操作guardへつなぐ。"""
import importlib
import copy
import os
import sys
import unittest
from unittest.mock import Mock, patch
from bridge_fixture import bridge
import test_native_identity_actions as cases
from native_transport_fixture import AdbPeer, SELECTOR, listing


class NativeTransportGuardTests(unittest.TestCase):
    def setUp(self):
        with patch.object(sys, "path", [str(cases.cases.ROOT), *sys.path]):
            self.transport = importlib.import_module("native_identity_transport")
            self.protocol = importlib.import_module("native_identity_transport_protocol")
        self.environment = patch.dict(os.environ, {key: value for key, value in os.environ.items() if key not in self.protocol.SERVER_ENV}, clear=True)
        self.environment.start()
        self.fixture = cases.NativeActionTests()
        self.fixture.setUp()
        self.state, self.exchange = self.fixture.state, self.fixture.exchange
        self.peer = AdbPeer()
        for key in ("host", "port", "adb_path", "cmd_options"):
            setattr(self.state.device.adb, key, getattr(self.peer.adb, key))
        self.exchange._transport_factory = self.transport.NativeAndroidTransport

    def tearDown(self):
        try:
            closer = getattr(self.exchange, "close", None)
            if closer:
                closer()
            self.peer.close()
            self.fixture.tearDown()
        finally:
            self.environment.stop()

    def test_same_sdk_transport_change_refuses_action_and_requires_a_new_observation(self):
        record = self.fixture.observe()
        request = self.fixture.request(record)
        self.peer.publish(listing(8))
        with self.assertRaisesRegex(Exception, "transport") as caught:
            self.fixture.perform(request)
        self.assertNotIn(SELECTOR, str(caught.exception))
        self.state.device.touch.assert_not_called()
        newer = self.fixture.observe()
        self.assertNotEqual(record["bridgeBinding"]["connectionId"], newer["bridgeBinding"]["connectionId"])
        self.assertEqual(self.fixture.perform(self.fixture.request(newer))["result"]["status"], "executed")
        self.state.device.touch.assert_called_once()
        with self.assertRaises(Exception):
            self.fixture.perform(request)

    def test_preparation_switch_has_zero_sdk_calls_and_no_raw_selector(self):
        request = self.fixture.request()
        def prepare(candidate):
            self.peer.publish(listing(8))
            return {"ui": {"screen": {"resolution": [100, 200]}}}
        self.state._assert_fresh_candidate.side_effect = prepare
        result = self.fixture.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        self.state.device.touch.assert_not_called()
        self.assertNotIn(SELECTOR, str(result))

    def test_sdk_switch_retains_attempt_and_discards_the_lease(self):
        request = self.fixture.request()
        self.state.device.touch.side_effect = lambda position: self.peer.publish(listing(8))
        result = self.fixture.perform(request)
        self.assertEqual(result["result"]["status"], "infrastructure_error")
        self.assertTrue(result["actionAttempted"])
        self.state.device.touch.assert_called_once()
        request["ordinal"] = 2
        with self.assertRaisesRegex(Exception, "lease-unavailable"):
            self.fixture.perform(request)

    def test_closed_tracker_with_reused_id_refuses_old_recovery(self):
        record = self.fixture.observe()
        self.peer.disconnect_trackers()
        self.assertTrue(self.exchange._transport.stopped.wait(1))
        with self.assertRaisesRegex(Exception, "transport"):
            self.fixture.perform(self.fixture.request(record, "recover"))
        self.state.device.keyevent.assert_not_called()
        newer = self.fixture.observe()
        self.assertTrue(self.fixture.perform(self.fixture.request(newer, "recover"))["result"]["recovered"])

    def test_provider_switch_does_not_register_a_lease(self):
        original = self.fixture.fixture.provider._mock_wraps
        def changed(**kwargs):
            result = original(**kwargs)
            self.peer.publish(listing(8))
            return result
        self.fixture.fixture.provider.side_effect = changed
        with self.assertRaisesRegex(Exception, "transport"):
            self.fixture.observe()
        self.assertEqual(len(self.exchange.actions._leases), 0)
        self.assertEqual(self.fixture.fixture.provider.call_count, 1)

    def test_session_capacity_shares_one_tracker_and_close_stops_it(self):
        for _ in range(32):
            self.fixture.fixture.open()
        before = len(self.peer.requests)
        with self.assertRaisesRegex(Exception, "session-capacity"):
            self.fixture.fixture.open()
        self.assertEqual(len(self.peer.requests), before)
        self.assertEqual(self.peer.requests.count("host:track-devices-l"), 1)
        self.exchange.close()
        self.assertFalse(self.exchange._transport.thread.is_alive())

    def test_unavailable_tracking_refuses_observation_before_provider(self):
        self.peer.raw_reply = b"FAIL000eprivate-canary"
        with self.assertRaisesRegex(Exception, "transport") as caught:
            self.fixture.observe()
        self.assertNotIn("private-canary", str(caught.exception))
        self.fixture.fixture.provider.assert_not_called()

    def test_failed_current_query_does_not_retry_until_a_new_open(self):
        self.fixture.fixture.open()
        with self.peer.lock:
            self.peer.snapshot = listing(8)
        with self.assertRaisesRegex(Exception, "transport"):
            self.fixture.fixture.open()
        self.assertEqual(self.peer.requests.count("host:track-devices-l"), 1)
        self.fixture.fixture.provider.assert_not_called()
        self.fixture.observe()
        self.assertEqual(self.peer.requests.count("host:track-devices-l"), 2)

    def test_new_sdk_object_closes_previous_tracker_and_pending_session(self):
        pending = self.fixture.fixture.open()
        old = self.exchange._transport
        self.state.device.adb = copy.copy(self.state.device.adb)
        newer = self.fixture.fixture.open()
        self.assertTrue(old.closed)
        self.assertFalse(old.thread.is_alive())
        with self.assertRaisesRegex(Exception, "binding-mismatch"):
            self.fixture.fixture.observe(pending)
        self.fixture.fixture.observe(newer)
        self.assertIsNot(old, self.exchange._transport)

    def test_unconfirmed_close_prevents_tracker_replacement(self):
        self.fixture.fixture.open()
        old = self.exchange._transport
        old.close()
        with patch.object(old, "close", side_effect=self.transport.NativeTransportError("transport-close-unconfirmed")):
            with self.assertRaisesRegex(Exception, "transport-close-unconfirmed"):
                self.fixture.fixture.open()
        self.assertIs(self.exchange._transport, old)
        self.assertEqual(self.peer.requests.count("host:track-devices-l"), 1)

    def test_bridge_exit_closes_tracker_and_server(self):
        self.fixture.fixture.open()
        server = Mock()
        server.serve_forever.side_effect = KeyboardInterrupt()
        argv = ["server.py", "--platform", "android", "--target-revision", "fixture"]
        with patch.object(sys, "argv", argv), patch.object(bridge, "BridgeState", return_value=self.state), patch.object(bridge, "ThreadingHTTPServer", return_value=server), patch.object(bridge.Handler, "state", self.state, create=True):
            with self.assertRaises(KeyboardInterrupt):
                bridge.main()
        self.assertTrue(self.exchange._transport.closed)
        self.assertFalse(self.exchange._transport.thread.is_alive())
        server.server_close.assert_called_once()

    def test_sdk_server_configuration_change_during_preparation_refuses_operation(self):
        request = self.fixture.request()
        def changed(candidate):
            os.environ["ANDROID_ADB_SERVER_ADDRESS"] = "private-invalid"
            return {"ui": {"screen": {"resolution": [100, 200]}}}
        self.state._assert_fresh_candidate.side_effect = changed
        result = self.fixture.perform(request)
        self.assertEqual(result["result"]["status"], "denied")
        self.assertFalse(result["actionAttempted"])
        self.assertNotIn("private-invalid", str(result))
        self.state.device.touch.assert_not_called()
