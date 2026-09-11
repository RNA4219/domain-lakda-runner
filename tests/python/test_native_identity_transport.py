"""実TCPの人工ADB peerで接続世代・上限・秘匿を検証する。"""
import importlib
import os
import sys
import unittest
from unittest.mock import patch
import test_native_identity_actions as fixture_bootstrap
from native_transport_fixture import AdbPeer, SELECTOR, frame, listing


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        with patch.object(sys, "path", [str(fixture_bootstrap.cases.ROOT), *sys.path]):
            self.module = importlib.import_module("native_identity_transport")
            self.protocol = importlib.import_module("native_identity_transport_protocol")
        self.environment = patch.dict(os.environ, {key: value for key, value in os.environ.items() if key not in self.protocol.SERVER_ENV}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def capture(self, peer, **options):
        result = self.module.NativeAndroidTransport(peer.adb, **options)
        self.addCleanup(result.close)
        return result

    def test_fragmented_handshake_and_current_query_use_only_fixed_services(self):
        with AdbPeer() as peer:
            peer.fragment = True
            captured = self.capture(peer)
            captured.check(peer.adb)
            captured.check(peer.adb)
            self.assertEqual(peer.requests, ["host:track-devices-l", "host:devices-l", "host:devices-l"])
            self.assertFalse(captured.closed)
            captured.close()
            self.assertFalse(captured.thread.is_alive())

    def test_transport_change_on_the_same_sdk_object_invalidates_the_connection(self):
        with AdbPeer() as peer:
            captured = self.capture(peer)
            peer.publish(listing(8))
            with self.assertRaises(self.module.NativeTransportError) as caught:
                captured.check(peer.adb)
            self.assertNotIn(SELECTOR, str(caught.exception))
            self.assertTrue(captured.closed)
            peer.publish(listing(7))
            with self.assertRaises(self.module.NativeTransportError):
                captured.check(peer.adb)

    def test_closed_tracker_cannot_be_replaced_by_a_query_with_the_same_transport_id(self):
        with AdbPeer() as peer:
            captured = self.capture(peer)
            peer.disconnect_trackers()
            self.assertTrue(captured.stopped.wait(1))
            with self.assertRaises(self.module.NativeTransportError):
                captured.check(peer.adb)
            newer = self.capture(peer)
            newer.check(peer.adb)
            self.assertFalse(newer.closed)

    def test_other_device_changes_do_not_change_the_selected_generation(self):
        with AdbPeer() as peer:
            captured = self.capture(peer)
            peer.publish(listing() + listing(99, selector="other-private-device"))
            captured.check(peer.adb)
            self.assertFalse(captured.closed)

    def test_offline_duplicate_missing_and_noncanonical_ids_are_refused(self):
        for payload in (b"", listing(state="offline"), listing(state="unauthorized"), listing() + listing(), listing(0), listing("01"), listing(2**64), b"private-selector device\n", b"\xff"):
            with AdbPeer() as peer:
                peer.snapshot = payload
                with self.assertRaises(self.module.NativeTransportError) as caught:
                    self.module.NativeAndroidTransport(peer.adb)
                self.assertNotIn(SELECTOR, str(caught.exception))

    def test_rows_and_protocol_envelope_are_bounded(self):
        for response in (b"FAIL000eprivate-canary", b"OKAYzzzz", b"OKAY" + frame(listing() + b"other device transport_id:9\n" * 256), b"OKAY0001\xff"):
            with AdbPeer() as peer:
                peer.raw_reply = response
                with self.assertRaises(self.module.NativeTransportError) as caught:
                    self.module.NativeAndroidTransport(peer.adb)
                self.assertNotIn("private-canary", str(caught.exception))

    def test_descriptor_or_environment_changes_fail_before_a_new_query(self):
        for change in ("host", "port", "serialno", "cmd_options", "environment"):
            with AdbPeer() as peer:
                captured = self.capture(peer)
                before = len(peer.requests)
                with patch.dict(os.environ, {}, clear=False):
                    if change == "environment":
                        os.environ["ADB_SERVER_SOCKET"] = "tcp:private-invalid:5037"
                    else:
                        setattr(peer.adb, change, ["altered"] if change == "cmd_options" else 1 if change == "port" else "private-invalid")
                    with self.assertRaises(self.module.NativeTransportError) as caught:
                        captured.check(peer.adb)
                    self.assertNotIn("private-invalid", str(caught.exception))
                self.assertEqual(len(peer.requests), before)

    def test_network_timeout_and_idle_deadline_close_the_reader(self):
        with AdbPeer() as peer:
            peer.delay = 0.1
            with patch.object(self.protocol, "IO_TIMEOUT", 0.025):
                with self.assertRaises(self.module.NativeTransportError):
                    self.module.NativeAndroidTransport(peer.adb)
        with AdbPeer() as peer:
            captured = self.capture(peer, idle_timeout=0.05)
            self.assertTrue(captured.stopped.wait(1))
            captured.close()
            self.assertFalse(captured.thread.is_alive())

    def test_expired_reader_is_not_revived_before_background_scheduling(self):
        for operation in ("check", "keepalive"):
            with self.subTest(operation=operation), AdbPeer() as peer, patch.object(self.module.NativeAndroidTransport, "_read_updates"):
                captured = self.capture(peer)
                captured._idle_deadline = self.module.time.monotonic() - 1
                before = len(peer.requests)
                with self.assertRaisesRegex(self.module.NativeTransportError, "transport-expired"):
                    if operation == "check":
                        captured.check(peer.adb)
                    else:
                        captured.keepalive(self.module.time.monotonic() + 60)
                self.assertTrue(captured.closed)
                self.assertEqual(len(peer.requests), before)

    def test_every_sdk_server_environment_override_is_refused_even_if_empty(self):
        for variable in self.protocol.SERVER_ENV:
            with self.subTest(variable=variable), AdbPeer() as peer, patch.dict(os.environ, {variable: ""}):
                with self.assertRaisesRegex(self.module.NativeTransportError, "transport-config-invalid"):
                    self.module.NativeAndroidTransport(peer.adb)
                self.assertEqual(peer.requests, [])
