"""撮影専用連番と元guardのcleanup。人工SDKのみを使用する。"""
import copy
import threading
import time
import unittest
from unittest.mock import patch
import test_native_identity_capture_lifecycle as cases
import test_native_identity_exchange as exchange_cases
from native_identity_capture_exchange import NativeIdentityCaptures


class NativeCaptureExchangeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = cases.NativeCaptureLifecycleTests()
        self.fixture.setUp()
        self.state, self.exchange = self.fixture.state, self.fixture.exchange
        self.capture = NativeIdentityCaptures(self.exchange.actions)
        self.device = self.fixture.fixture.device

    def tearDown(self):
        self.fixture.tearDown()

    def request(self, operation="screenshot", ordinal=1, capture_ordinal=None):
        payload = {"runId": "fixture-run", "stagingDir": str(self.fixture.root / "fixture-run")}
        if operation != "screenshot":
            payload.update(mode="video", maxBytes=1024, stopTimeoutMs=500)
        return {"schemaVersion": "lakda/native-capture-request/v1", "operation": operation,
                "ordinal": ordinal, "captureOrdinal": capture_ordinal or ordinal,
                "lease": copy.deepcopy(self.fixture.fixture.lease),
                "approvalWindow": copy.deepcopy(self.fixture.fixture.window), "payload": payload}

    def send(self, request):
        return self.capture.perform(request, exchange_cases.ENDPOINT)

    def test_screenshot_replay_does_not_capture_twice_and_receipt_binds_request(self):
        request = self.request()
        result = self.send(request)
        self.assertEqual(result["schemaVersion"], "lakda/native-capture-result/v1")
        self.assertEqual(result["requestSha256"], exchange_cases.exchange._digest(request))
        self.assertTrue(result["result"]["accepted"])
        self.assertEqual(len(result["result"]["artifactRefs"]), 1)
        self.assertEqual(self.send(request), result)
        self.device.adb.snapshot.assert_called_once()
        changed = copy.deepcopy(request)
        changed["payload"]["runId"] = "changed"
        with self.assertRaisesRegex(Exception, "capture-ordinal-mismatch"):
            self.send(changed)
        with self.assertRaisesRegex(Exception, "capture-ordinal-mismatch"):
            self.send(self.request(ordinal=3))
        self.assertTrue(self.send(self.request(ordinal=2))["result"]["accepted"])
        with self.assertRaisesRegex(Exception, "capture-ordinal-mismatch"):
            self.send(request)
        self.assertEqual(self.device.adb.snapshot.call_count, 2)

    def test_snapshot_does_not_replace_video_identity_and_stop_is_idempotent(self):
        self.assertTrue(self.send(self.request("start"))["result"]["accepted"])
        self.assertTrue(self.send(self.request(ordinal=2))["result"]["accepted"])
        stop = self.request("stop", 3, 1)
        result = self.send(stop)
        self.assertTrue(result["result"]["stopped"])
        self.assertTrue(result["result"]["artifactRefs"][0]["path"].endswith(".mp4"))
        self.assertEqual(self.send(stop), result)
        self.device.stop_recording.assert_called_once()
        with self.assertRaisesRegex(Exception, "capture-unavailable"):
            self.send(self.request("stop", 4, 1))

    def test_expired_revoked_lease_can_only_clean_up_original_capture(self):
        self.send(self.request("start"))
        self.exchange.actions._leases.pop(self.fixture.fixture.lease["observationId"])
        result = self.send(self.request("stop", 2, 1))
        self.assertTrue(result["result"]["stopped"])
        self.device.stop_recording.assert_called_once()
        with self.assertRaisesRegex(Exception, "lease-unavailable"):
            self.send(self.request(ordinal=3))

    def test_stop_requires_original_scope_and_endpoint_without_consuming_ordinal(self):
        self.send(self.request("start"))
        request = self.request("stop", 2, 1)
        wrong = copy.deepcopy(request)
        wrong["payload"]["stagingDir"] += "-other"
        with self.assertRaisesRegex(Exception, "capture-binding-mismatch"):
            self.send(wrong)
        with self.assertRaisesRegex(Exception, "capture-binding-mismatch"):
            self.capture.perform(request, exchange_cases.ENDPOINT + "other/")
        wrong = copy.deepcopy(request)
        wrong["approvalWindow"]["targetManifestSha256"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(Exception, "capture-binding-mismatch"):
            self.send(wrong)
        self.device.stop_recording.assert_not_called()
        self.assertTrue(self.send(request)["result"]["stopped"])

    def test_stop_timeout_replay_then_explicit_recheck_uses_one_backend_call(self):
        self.send(self.request("start"))
        release = threading.Event()
        self.device.stop_recording.side_effect = lambda: release.wait(2)
        request = self.request("stop", 2, 1)
        request["payload"]["stopTimeoutMs"] = 20
        try:
            result = self.send(request)
            self.assertFalse(result["result"]["stopped"])
            self.assertEqual(self.send(request), result)
            release.set()
            watch = self.state._recording["fixture-run"]["videoWatch"]
            self.assertTrue(watch.finished.wait(1))
            self.assertTrue(self.send(self.request("stop", 3, 1))["result"]["stopped"])
            self.device.stop_recording.assert_called_once()
        finally:
            release.set()

    def test_unknown_start_is_not_retried_and_exception_message_is_not_returned(self):
        self.device.start_recording.side_effect = RuntimeError("private-capture-canary")
        request = self.request("start")
        result = self.send(request)
        self.assertFalse(result["result"]["accepted"])
        self.assertEqual(result, self.send(request))
        self.assertNotIn("private-capture-canary", str(result))
        stopped = self.send(self.request("stop", 2, 1))
        self.assertFalse(stopped["result"]["stopped"])
        self.device.start_recording.assert_called_once()
        self.device.stop_recording.assert_not_called()

    def test_invalid_requests_and_shared_action_lock_prevent_dispatch(self):
        for mutate in (lambda r: r.update(extra="canary"), lambda r: r.update(ordinal=True),
                       lambda r: r.update(captureOrdinal=2), lambda r: r["payload"].update(kinds=["screenshot"]),
                       lambda r: r["lease"].update(extra="canary")):
            request = self.request()
            mutate(request)
            with self.assertRaisesRegex(Exception, "capture-request-invalid"):
                self.send(request)
        with self.exchange.actions._operation:
            with self.assertRaisesRegex(Exception, "capture-busy"):
                self.send(self.request())
        self.device.adb.snapshot.assert_not_called()

    def test_old_capture_number_cannot_stop_a_later_recording(self):
        from pathlib import Path
        self.send(self.request("start"))
        self.send(self.request("stop", 2, 1))

        def start(**value):
            Path(value["output"]).write_bytes(b"later-fixture-video")
            self.device.yosemite_recorder.recording_proc = object()
            return value["output"]

        self.device.start_recording.side_effect = start
        request = self.request("start", 3)
        request["payload"].update(runId="later-run", stagingDir=str(self.fixture.root / "later-run"))
        self.assertTrue(self.send(request)["result"]["accepted"])
        with self.assertRaisesRegex(Exception, "capture-unavailable"):
            self.send(self.request("stop", 4, 1))
        self.assertEqual(self.device.stop_recording.call_count, 1)
        request.update(operation="stop", ordinal=4)
        self.assertTrue(self.send(request)["result"]["stopped"])
        self.assertEqual(self.device.stop_recording.call_count, 2)

    def test_post_stop_receipt_failure_does_not_reuse_success(self):
        request = self.request("start")
        request["payload"].update(mode="sampled-frames/v1", intervalMs=1, maxFrames=1)
        self.assertTrue(self.send(request)["result"]["accepted"])
        active = self.state._recording["fixture-run"]
        active["thread"].join(1)
        self.assertFalse(active["thread"].is_alive())
        request.update(operation="stop", ordinal=2)
        with patch.object(self.state, "_validated_frame_capture", side_effect=lambda value: value.pop("artifacts") is not None):
            result = self.send(request)["result"]
        self.assertFalse(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["artifactRefs"], [])

    def test_close_does_not_wait_unboundedly_for_an_inflight_sdk_start(self):
        entered, release = threading.Event(), threading.Event()
        original = self.device.start_recording.side_effect
        outcomes = []

        def start(**value):
            entered.set()
            release.wait(3)
            return original(**value)

        self.device.start_recording.side_effect = start
        worker = threading.Thread(target=lambda: outcomes.append(self.send(self.request("start"))))
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            before = time.monotonic()
            with self.assertRaisesRegex(Exception, "capture-close-unconfirmed"):
                self.exchange.close()
            self.assertLess(time.monotonic() - before, 1.5)
            self.assertFalse(self.exchange._transport.closed)
        finally:
            release.set()
            worker.join(4)
            self.assertFalse(worker.is_alive())
        self.assertEqual(len(outcomes), 1)
        self.exchange.close()
        self.assertTrue(self.exchange._transport.closed)
        self.device.start_recording.assert_called_once()
        self.device.stop_recording.assert_called_once()

    def test_cleanup_can_cross_an_undelivered_request_without_targeting_another_capture(self):
        self.send(self.request("start"))
        with self.assertRaisesRegex(Exception, "capture-ordinal-mismatch"):
            self.send(self.request(ordinal=3))
        stopped = self.send(self.request("stop", 3, 1))
        self.assertTrue(stopped["result"]["stopped"])
        self.device.stop_recording.assert_called_once()

    def test_rejected_start_without_owned_state_reports_that_capture_stopped(self):
        self.device.start_recording.return_value = None
        self.device.start_recording.side_effect = None
        response = self.send(self.request("start"))["result"]
        self.assertFalse(response["accepted"])
        self.assertTrue(response["stopped"])
        self.device.stop_recording.assert_not_called()


if __name__ == "__main__":
    unittest.main()
