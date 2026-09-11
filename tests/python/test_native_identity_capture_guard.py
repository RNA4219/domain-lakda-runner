"""観測leaseへひも付く撮影。人工SDKであり実機・映像の受入ではない。"""
import copy
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
import test_native_identity_window as cases
import test_native_identity_exchange as exchange_cases
import native_identity_actions as actions


class CaptureGuardTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.NativeWindowTests()
        self.fixture.setUp()
        self.state = self.fixture.state
        self.exchange = self.fixture.fixture.exchange
        self.root = self.fixture.fixture.fixture.root
        self.device = self.state.device
        self.bytes = b"\x89PNG\r\n\x1a\nfixture-screen"
        self.device.adb.snapshot = Mock(return_value=self.bytes)
        self.device.adb.display_id = None
        self.device.snapshot = Mock(side_effect=AssertionError("shared screen proxy"))
        self.device.yosemite_recorder = SimpleNamespace(adb=self.device.adb, recording_proc=object())
        self.device.recorder = None
        self.device.start_recording = Mock(side_effect=lambda **value: value["output"])
        def stop():
            self.device.yosemite_recorder.recording_proc = None
            return True

        self.device.stop_recording = Mock(side_effect=stop)
        self.request = self.fixture.request()
        self.window = self.request["approvalWindow"]
        self.lease = self.request["lease"]

    def tearDown(self):
        self.fixture.tearDown()

    def guard(self):
        return self.exchange.actions.capture_guard(self.lease, self.window, exchange_cases.ENDPOINT)

    def test_snapshot_uses_bound_adb_and_rejects_post_capture_connection_change(self):
        guard = self.guard()
        path = self.root / "guarded.png"
        guard.snapshot(path)
        self.assertEqual(path.read_bytes(), self.bytes)
        self.device.snapshot.assert_not_called()
        self.assertEqual(self.state.airtest.frame_count, 0)
        changed = self.root / "changed.png"

        def replace_connection():
            self.device.adb.serialno = "another-private-selector"
            return self.bytes

        self.device.adb.snapshot.side_effect = replace_connection
        with self.assertRaises(Exception):
            guard.snapshot(changed)
        self.assertFalse(changed.exists())

    def test_revoked_lease_and_changed_display_prevent_new_snapshot(self):
        guard = self.guard()
        self.device.adb.display_id = "different-display"
        with self.assertRaises(Exception):
            guard.snapshot(self.root / "display.png")
        self.device.adb.display_id = None
        self.exchange.actions._leases.pop(self.lease["observationId"])
        with self.assertRaisesRegex(Exception, "lease-unavailable"):
            guard.snapshot(self.root / "revoked.png")
        self.device.adb.snapshot.assert_not_called()

    def test_capture_authorization_rejects_mismatch_and_does_not_spend_action_ordinal(self):
        guard = self.guard()
        guard.check()
        self.assertEqual(self.exchange.actions._leases[self.lease["observationId"]]["ordinal"], 0)
        invalid = copy.deepcopy(self.window)
        invalid["targetManifestSha256"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(Exception, "approval-window-mismatch"):
            self.exchange.actions.capture_guard(self.lease, invalid, exchange_cases.ENDPOINT)
        with self.assertRaises(Exception):
            self.exchange.actions.capture_guard({**self.lease, "unknown": True}, self.window, exchange_cases.ENDPOINT)
        self.device.start_recording.assert_not_called()
        self.device.adb.snapshot.assert_not_called()

    def test_recording_duration_and_cleanup_remain_bound_after_expiry_and_device_switch(self):
        guard = self.guard()
        path = str(self.root / "video.mp4")
        self.assertEqual(guard.start_video(path), path)
        arguments = self.device.start_recording.call_args.kwargs
        self.assertEqual(arguments["mode"], "yosemite")
        self.assertGreaterEqual(arguments["max_time"], 1)
        self.assertLessEqual(arguments["max_time"], 5)
        self.state.device = SimpleNamespace(stop_recording=Mock())
        with patch.object(actions.clock, "wall_milliseconds", return_value=self.fixture.now + 6000):
            with self.assertRaises(Exception):
                guard.check()
            self.assertTrue(guard.stop_video())
        self.device.stop_recording.assert_called_once_with()
        self.state.device.stop_recording.assert_not_called()
        self.assertTrue(guard.stop_video())
        self.device.stop_recording.assert_called_once_with()

    def test_cleanup_rejects_changed_recorder_or_transport_and_unowned_recording(self):
        guard = self.guard()
        self.device.start_recording.side_effect = None
        self.device.start_recording.return_value = None
        self.assertIsNone(guard.start_video(str(self.root / "busy.mp4")))
        with self.assertRaises(Exception):
            guard.stop_video()
        self.device.start_recording.side_effect = lambda **value: value["output"]
        guard.start_video(str(self.root / "owned.mp4"))
        recorder = self.device.yosemite_recorder
        self.device.yosemite_recorder = SimpleNamespace(adb=self.device.adb)
        with self.assertRaises(Exception):
            guard.stop_video()
        self.device.yosemite_recorder = recorder
        self.exchange._transport.close()
        with self.assertRaises(Exception):
            guard.stop_video()
        self.device.stop_recording.assert_not_called()

    def test_video_process_replacement_and_short_remaining_budget_are_refused(self):
        guard = self.guard()
        entry = self.exchange.actions._leases[self.lease["observationId"]]
        original_deadline = entry["approval_deadline"]
        entry["approval_deadline"] = time.monotonic() + 0.5
        with self.assertRaisesRegex(Exception, "capture-duration-expired"):
            guard.start_video(str(self.root / "short.mp4"))
        self.device.start_recording.assert_not_called()
        entry["approval_deadline"] = original_deadline
        guard.start_video(str(self.root / "owned.mp4"))
        self.device.yosemite_recorder.recording_proc = object()
        with self.assertRaisesRegex(Exception, "capture-recording-changed"):
            guard.stop_video()
        self.device.stop_recording.assert_not_called()
