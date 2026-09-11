"""本体captureと背景停止。loopback外の端末・SDKへ接続しない。"""
from pathlib import Path
import threading
import unittest
from unittest.mock import Mock, patch
import test_native_identity_capture_guard as cases
from bridge_fixture import bridge


class NativeCaptureLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.CaptureGuardTests()
        self.fixture.setUp()
        self.state, self.root, self.exchange = self.fixture.state, self.fixture.root, self.fixture.exchange
        self.guard = self.fixture.guard()

        def start(**value):
            Path(value["output"]).write_bytes(b"fixture-video")
            return value["output"]

        self.fixture.device.start_recording.side_effect = start

    def tearDown(self):
        for key, active in list(self.state._recording.items()):
            if "videoWatch" in active:
                active["videoWatch"].stop(1000)
                self.assertTrue(active["videoWatch"].finished.is_set())
            if "stop" in active:
                active["stop"].set()
                active["thread"].join(1)
                self.assertFalse(active["thread"].is_alive())
            # Dispose fixture state after its workers exit; this is not SDK stop confirmation.
            self.state._recording.pop(key)
        self.fixture.tearDown()

    def capture(self, action, mode="video", **changes):
        value = {"runId": "fixture-run", "stagingDir": str(self.root / "fixture-run"),
                 "action": action, "mode": mode, "intervalMs": 1, "maxFrames": 3,
                 "maxBytes": 1024, "stopTimeoutMs": 500}
        value.update(changes)
        return self.state.capture_control({"request": value}, identity_guard=self.guard)

    def test_revoked_video_is_stopped_in_background_and_not_published(self):
        self.assertTrue(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        self.exchange.actions._leases.pop(self.fixture.lease["observationId"])
        self.assertTrue(watch.finished.wait(1), "capture monitor did not finish")
        self.fixture.device.stop_recording.assert_called_once_with()
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["artifactRefs"], [])
        self.assertTrue((self.root / "fixture-run/artifacts/video/0001.mp4").is_file())
        self.assertEqual(self.state._recording, {})

    def test_changed_transport_keeps_stop_unconfirmed_without_sdk_cleanup(self):
        self.assertTrue(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        self.exchange._transport.close()
        self.assertTrue(watch.finished.wait(1))
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertFalse(result.get("stopped", False))
        self.assertIn("fixture-run", self.state._recording)
        self.fixture.device.stop_recording.assert_not_called()

    def test_approval_expiry_stops_video_without_waiting_for_next_control_request(self):
        self.assertTrue(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        expired = cases.actions._window_time(self.fixture.window["validUntil"])
        with patch.object(cases.actions.clock, "wall_milliseconds", return_value=expired):
            self.assertTrue(watch.finished.wait(1))
            self.fixture.device.stop_recording.assert_called_once_with()
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["artifactRefs"], [])

    def test_stop_timeout_preserves_active_and_finishes_without_duplicate_stop(self):
        entered, release = threading.Event(), threading.Event()

        def stop():
            entered.set()
            release.wait(2)
            self.fixture.device.yosemite_recorder.recording_proc = None
            return True

        self.fixture.device.stop_recording.side_effect = stop
        self.assertTrue(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        try:
            result = self.capture("stop", stopTimeoutMs=20)
            self.assertTrue(entered.wait(1))
            self.assertFalse(result["accepted"])
            self.assertFalse(result.get("stopped", False))
            self.assertIn("fixture-run", self.state._recording)
        finally:
            release.set()
            self.assertTrue(watch.finished.wait(1))
        self.assertTrue(self.capture("stop")["accepted"])
        self.fixture.device.stop_recording.assert_called_once_with()

    def test_legacy_control_cannot_stop_a_guarded_capture(self):
        self.assertTrue(self.capture("start")["accepted"])
        value = {"runId": "fixture-run", "stagingDir": str(self.root / "fixture-run"), "action": "stop", "mode": "video"}
        self.assertFalse(self.state.capture_control({"request": value})["accepted"])
        self.fixture.device.stop_recording.assert_not_called()
        self.assertTrue(self.capture("stop")["accepted"])

    def test_ambiguous_start_keeps_state_and_never_guesses_ownership_for_stop(self):
        self.fixture.device.start_recording.side_effect = RuntimeError("private-start-canary")
        result = self.capture("start")
        self.assertFalse(result["accepted"])
        self.assertNotIn("private-start-canary", str(result))
        self.assertIn("fixture-run", self.state._recording)
        self.assertFalse(self.capture("start")["accepted"])
        self.assertFalse(self.capture("stop").get("stopped", False))
        self.fixture.device.start_recording.assert_called_once()
        self.fixture.device.stop_recording.assert_not_called()

    def test_invalidation_during_start_still_stops_the_confirmed_recorder(self):
        def start(**value):
            Path(value["output"]).write_bytes(b"fixture-video")
            self.exchange.actions._leases.pop(self.fixture.lease["observationId"])
            return value["output"]

        self.fixture.device.start_recording.side_effect = start
        self.assertFalse(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        self.assertTrue(watch.finished.wait(1))
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.fixture.device.stop_recording.assert_called_once_with()

    def test_monitor_creation_failure_can_retry_cleanup_without_publishing_video(self):
        with patch.object(bridge, "NativeCaptureVideo", side_effect=RuntimeError("private-thread-canary")):
            result = self.capture("start")
            self.assertFalse(result["accepted"])
            self.assertNotIn("private-thread-canary", str(result))
        self.assertIn("fixture-run", self.state._recording)
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["artifactRefs"], [])
        self.fixture.device.stop_recording.assert_called_once_with()

    def test_exchange_close_stops_owned_capture_before_closing_transport(self):
        self.assertTrue(self.capture("start")["accepted"])
        self.exchange.close()
        self.assertTrue(self.exchange._closed)
        self.fixture.device.stop_recording.assert_called_once_with()
        self.assertEqual(self.state._recording, {})

    def test_close_timeout_blocks_new_capture_but_allows_original_stop_to_finish(self):
        entered, release = threading.Event(), threading.Event()

        def stop():
            entered.set()
            release.wait(2)
            self.fixture.device.yosemite_recorder.recording_proc = None
            return True

        self.fixture.device.stop_recording.side_effect = stop
        self.assertTrue(self.capture("start")["accepted"])
        watch = self.state._recording["fixture-run"]["videoWatch"]
        try:
            with self.assertRaisesRegex(Exception, "capture-close-unconfirmed"):
                self.exchange.close()
            self.assertTrue(entered.wait(1))
            self.assertFalse(self.exchange._closed)
            self.assertFalse(self.exchange._transport.closed)
            with self.assertRaises(Exception):
                self.guard.snapshot(self.root / "closing.png")
        finally:
            release.set()
            self.assertTrue(watch.finished.wait(1))
        self.exchange.close()
        self.assertTrue(self.exchange._closed)
        self.fixture.device.stop_recording.assert_called_once_with()

    def test_frames_stop_after_revocation_and_do_not_count_invalid_snapshot(self):
        entered, release = threading.Event(), threading.Event()

        def snapshot():
            if self.fixture.device.adb.snapshot.call_count == 2:
                entered.set()
                release.wait(2)
            return self.fixture.bytes

        self.fixture.device.adb.snapshot = Mock(side_effect=snapshot)
        self.guard = self.fixture.guard()
        self.assertTrue(self.capture("start", "sampled-frames/v1")["accepted"])
        active = self.state._recording["fixture-run"]
        try:
            self.assertTrue(entered.wait(1))
            self.exchange.actions._leases.pop(self.fixture.lease["observationId"])
        finally:
            release.set()
            active["thread"].join(1)
        self.assertFalse(active["thread"].is_alive())
        result = self.capture("stop", "sampled-frames/v1")
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["frameCount"], 1)
        self.assertEqual(self.fixture.device.adb.snapshot.call_count, 2)
        self.assertEqual(self.state.airtest.frame_count, 0)
