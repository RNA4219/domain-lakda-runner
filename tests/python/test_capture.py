"""captureの実行契約。偽backendを使い、本体のthreadとfile処理を検証する。"""
from bridge_fixture import BridgeTestCase


class CaptureTests(BridgeTestCase):
    def test_frames_start_stop_match_real_bytes(self):
        self.assertTrue(self.capture("start")["accepted"])
        self.finish_sampler()
        result = self.capture("stop")
        self.assertTrue(result["accepted"])
        self.assertTrue(result["stopped"])
        files = list((self.root / "fixture-run/artifacts/frames").glob("*.png"))
        self.assertEqual(result["frameCount"], len(files))
        self.assertEqual(result["byteCount"], sum(p.stat().st_size for p in files))
        self.assertEqual((result["frameCount"], result["byteCount"]), (2, 10))

    def test_discard_removes_only_this_capture(self):
        unrelated = self.root / "keep.txt"
        unrelated.write_text("keep")
        self.capture("start")
        self.finish_sampler()
        self.assertTrue(self.capture("discard")["accepted"])
        self.assertFalse((self.root / "fixture-run/artifacts/frames").exists())
        self.assertEqual(unrelated.read_text(), "keep")

    def test_duplicate_start_and_mode_mismatch_do_not_replace_active(self):
        self.capture("start")
        active = self.state._recording["fixture-run"]
        self.assertFalse(self.capture("start")["accepted"])
        self.assertFalse(self.capture("stop", "video")["accepted"])
        self.assertIs(self.state._recording["fixture-run"], active)

    def test_stop_without_start_and_idempotent_discard(self):
        self.assertFalse(self.capture("stop")["accepted"])
        self.assertTrue(self.capture("discard")["accepted"])

    def test_frame_and_byte_limits(self):
        for limit, count, accepted in [(4, 0, False), (5, 1, True), (6, 1, True)]:
            with self.subTest(maxBytes=limit):
                staging = str(self.root / ("boundary-" + str(limit)))
                self.capture("start", maxBytes=limit, stagingDir=staging)
                self.finish_sampler()
                result = self.capture("stop", stagingDir=staging)
                self.assertEqual(result["accepted"], accepted)
                self.assertEqual(result["frameCount"], count)
                self.capture("discard", stagingDir=staging)

    def test_invalid_capture_parameters(self):
        for field in ("intervalMs", "maxFrames", "maxBytes", "stopTimeoutMs"):
            for value in (0, -1, True, "1", 1.5, None):
                with self.subTest(field=field, value=value):
                    self.assertFalse(self.capture("start", **{field: value})["accepted"])
        self.assertEqual(self.state._recording, {})

    def test_video_start_stop_and_digest(self):
        self.assertTrue(self.capture("start", "video")["accepted"])
        result = self.capture("stop", "video")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["artifactRefs"][0]["size"], len(b"fixture-video"))
        self.assertEqual(self.recorder.stops, 1)

    def test_video_backend_stop_failure_keeps_active_capture(self):
        self.capture("start", "video")
        self.recorder.stop_error = True
        self.assertFalse(self.capture("stop", "video")["accepted"])
        self.assertIn("fixture-run", self.state._recording)
        self.recorder.stop_error = False
        self.assertTrue(self.capture("stop", "video")["accepted"])

    def test_video_cannot_advertise_without_stop_backend(self):
        self.recorder.stop_recording = None
        self.assertFalse(self.state.video_supported)
        self.assertFalse(self.capture("start", "video")["accepted"])

    def test_sampler_error_after_valid_frame_is_not_success(self):
        self.recorder.fail_after = 1
        self.capture("start", maxFrames=3)
        self.finish_sampler()
        result = self.capture("stop")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "sampled-frame capture failed")

    def test_missing_frame_after_capture_is_not_success(self):
        self.capture("start", maxFrames=1)
        self.finish_sampler()
        next((self.root / "fixture-run/artifacts/frames").glob("*.png")).unlink()
        self.assertFalse(self.capture("stop")["accepted"])

    def test_changed_frame_bytes_are_rejected_even_at_the_same_size(self):
        self.capture("start", maxFrames=1)
        self.finish_sampler()
        next((self.root / "fixture-run/artifacts/frames").glob("*.png")).write_bytes(b"other")
        self.assertFalse(self.capture("stop")["accepted"])
