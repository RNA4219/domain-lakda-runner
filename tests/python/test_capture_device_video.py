"""接続済みdeviceの録画契約。人工bytesであり実機・codec検証ではない。"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from bridge_fixture import BridgeTestCase


class DeviceVideoTests(BridgeTestCase):
    def device_recorder(self):
        def start(output):
            Path(output).write_bytes(b"fixture-mp4-container")
            return output

        device = SimpleNamespace(start_recording=Mock(side_effect=start),
                                 stop_recording=Mock(return_value=True))
        self.state.device = device
        return device

    def test_device_api_produces_mp4_and_stop_stays_with_start_backend(self):
        device = self.device_recorder()
        self.assertTrue(self.state.video_supported)
        self.assertTrue(self.capture("start", "video")["accepted"])
        self.assertEqual(self.recorder.starts, 0)
        output = device.start_recording.call_args.kwargs["output"]
        self.assertEqual(Path(output), self.root / "fixture-run/artifacts/video/0001.mp4")
        replacement = self.device_recorder()
        self.state.airtest = replacement
        result = self.capture("stop", "video")
        self.assertTrue(result["accepted"])
        self.assertTrue(result["stopped"])
        self.assertEqual(result["artifactRefs"][0]["path"], "artifacts/video/0001.mp4")
        device.stop_recording.assert_called_once_with()
        replacement.stop_recording.assert_not_called()

    def test_unconfirmed_start_does_not_adopt_or_stop_existing_recording(self):
        device = self.device_recorder()
        device.start_recording.side_effect = None
        device.start_recording.return_value = None
        result = self.capture("start", "video")
        self.assertFalse(result["accepted"])
        self.assertEqual(self.state._recording, {})
        self.capture("discard", "video")
        device.stop_recording.assert_not_called()

    def test_unconfirmed_device_stop_retains_active_and_bound_method(self):
        device = self.device_recorder()
        self.assertTrue(self.capture("start", "video")["accepted"])
        original_stop = device.stop_recording
        replacement_stop = Mock(return_value=True)
        device.stop_recording = replacement_stop
        for value in (False, None):
            original_stop.return_value = value
            result = self.capture("stop", "video")
            self.assertFalse(result["accepted"])
            self.assertFalse(result.get("stopped", False))
            self.assertEqual(result["artifactRefs"], [])
            self.assertIn("fixture-run", self.state._recording)
        original_stop.return_value = True
        self.assertTrue(self.capture("stop", "video")["accepted"])
        self.assertEqual(original_stop.call_count, 3)
        replacement_stop.assert_not_called()

    def test_partial_device_api_does_not_fall_back_to_shared_recorder(self):
        self.state.device = SimpleNamespace(start_recording=Mock())
        self.assertFalse(self.state.video_supported)
        self.assertFalse(self.capture("start", "video")["accepted"])
        self.assertEqual(self.recorder.starts, 0)

    def test_legacy_stop_is_bound_even_if_shared_api_changes(self):
        self.assertTrue(self.capture("start", "video")["accepted"])
        self.state.airtest = SimpleNamespace(stop_recording=Mock())
        result = self.capture("stop", "video")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["artifactRefs"][0]["path"], "artifacts/video/0001.webm")
        self.assertEqual(self.recorder.stops, 1)
        self.state.airtest.stop_recording.assert_not_called()
