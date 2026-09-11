import threading
from pathlib import Path
from unittest.mock import patch
from bridge_fixture import BridgeTestCase


class CaptureBoundaryTests(BridgeTestCase):
    def test_sampler_timeout_retains_active_until_stopped(self):
        self.capture("start")
        active = self.state._recording["fixture-run"]
        self.assertTrue(self.recorder.frame_ready.wait(timeout=1))
        active["stop"].set()
        active["thread"].join(timeout=2)
        with patch.object(active["thread"], "is_alive", return_value=True):
            result = self.capture("stop", stopTimeoutMs=1)
        self.assertFalse(result["accepted"])
        self.assertNotIn("stopped", result)
        self.assertIs(self.state._recording["fixture-run"], active)
        self.assertTrue(self.capture("stop")["accepted"])

    def test_backend_start_error_is_not_active(self):
        with patch.object(self.recorder, "start_recording", side_effect=RuntimeError("private-value")):
            result = self.capture("start", "video")
        self.assertFalse(result["accepted"])
        self.assertNotIn("private-value", str(result))
        self.assertEqual(self.state._recording, {})

    def test_video_empty_and_over_budget_are_rejected(self):
        for payload in (b"", b"x" * 101):
            with self.subTest(size=len(payload)):
                staging = str(self.root / ("video-boundary-" + str(len(payload))))
                self.capture("start", "video", stagingDir=staging)
                self.state._recording["fixture-run"]["path"].write_bytes(payload)
                self.assertFalse(self.capture("stop", "video", stagingDir=staging)["accepted"])

    def test_outside_staging_and_artifact_traversal(self):
        with self.assertRaisesRegex(RuntimeError, "outside"):
            self.capture("start", stagingDir=str(self.root.parent / "outside"))
        for relative in ("../outside.png", str(self.root / "absolute.png")):
            with self.subTest(relative=relative), self.assertRaises(RuntimeError):
                self.state._safe_artifact_path(self.root, relative)

    def test_empty_frame_is_failure(self):
        self.recorder.snapshot = lambda filename: Path(filename).write_bytes(b"")
        self.capture("start")
        self.finish_sampler()
        self.assertFalse(self.capture("stop")["accepted"])

    def test_existing_capture_files_are_not_overwritten(self):
        for mode, relative in (("video", "video/0001.webm"), ("sampled-frames/v1", "frames/frame-0001.png")):
            with self.subTest(mode=mode):
                path = self.root / "fixture-run/artifacts" / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"retained-evidence")
                result = self.capture("start", mode)
                self.assertFalse(result["accepted"])
                self.assertEqual(path.read_bytes(), b"retained-evidence")
        self.assertEqual(self.recorder.starts, 0)

    def test_one_backend_cannot_record_multiple_runs_at_once(self):
        self.assertTrue(self.capture("start", "video")["accepted"])
        result = self.capture("start", "video", runId="another-run", stagingDir=str(self.root / "another-run"))
        self.assertFalse(result["accepted"])
        self.assertEqual(self.recorder.starts, 1)

    def test_stop_does_not_accept_a_changed_staging_directory(self):
        self.assertTrue(self.capture("start", "video")["accepted"])
        self.assertFalse(self.capture("stop", "video", stagingDir=str(self.root / "other"))["accepted"])
        self.assertEqual(self.recorder.stops, 0)
        self.assertTrue(self.capture("stop", "video")["accepted"])

    def test_discard_does_not_remove_a_different_retained_media_type(self):
        retained = self.root / "fixture-run/artifacts/video/0001.webm"
        retained.parent.mkdir(parents=True)
        retained.write_bytes(b"retained")
        self.assertTrue(self.capture("start")["accepted"])
        self.finish_sampler()
        self.assertTrue(self.capture("discard")["accepted"])
        self.assertEqual(retained.read_bytes(), b"retained")

    def test_simultaneous_stop_does_not_call_backend_twice(self):
        entered = threading.Event()
        twice = threading.Event()
        release = threading.Event()
        results = []

        def stop_backend():
            self.recorder.stops += 1
            entered.set()
            if self.recorder.stops > 1:
                twice.set()
            release.wait(timeout=2)

        self.recorder.stop_recording = stop_backend
        self.capture("start", "video")
        threads = [threading.Thread(target=lambda: results.append(self.capture("stop", "video"))) for _ in range(2)]
        try:
            threads[0].start()
            self.assertTrue(entered.wait(timeout=1))
            threads[1].start()
            twice.wait(timeout=0.1)
        finally:
            release.set()
            for thread in threads:
                if thread.ident is not None:
                    thread.join(timeout=2)
                    self.assertFalse(thread.is_alive())
        self.assertEqual(self.recorder.stops, 1)
        self.assertEqual(sum(result["accepted"] for result in results), 1)
