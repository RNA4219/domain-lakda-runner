"""実端末・Airtest依存なしで、本体bridgeを呼ぶためのfixture。"""
import argparse
import importlib.util
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("lakda_bridge", ROOT / "tools/airtest-poco-bridge/server.py")
bridge = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", [str(ROOT / "tools/airtest-poco-bridge"), *sys.path]):
    spec.loader.exec_module(bridge)


class Recorder:
    def __init__(self):
        self.starts = 0
        self.stops = 0
        self.frame_count = 0
        self.stop_error = False
        self.fail_after = None
        self.frame_ready = threading.Event()

    def start_recording(self, output):
        self.starts += 1
        Path(output).write_bytes(b"fixture-video")

    def stop_recording(self):
        self.stops += 1
        if self.stop_error:
            raise RuntimeError("fixture backend stop failure")

    def snapshot(self, filename):
        self.frame_count += 1
        if self.fail_after is not None and self.frame_count > self.fail_after:
            raise RuntimeError("fixture snapshot failure")
        Path(filename).write_bytes(b"frame")
        self.frame_ready.set()


class BridgeTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lakda-bridge-test-")
        self.root = Path(self.temp.name)
        args = argparse.Namespace(
            platform="android", target_revision="fixture-build", app_id="fixture-app",
            app_revision=None, platform_version=None, serial_digest=None,
            device_alias_digest=None, surface=None, output_dir=str(self.root),
            allowed_staging_root=str(self.root), templates=None, templates_root=None,
            device_uri=None,
        )
        with patch.object(bridge.BridgeState, "_load_runtime"):
            self.state = bridge.BridgeState(args)
        self.recorder = Recorder()
        self.state.airtest = self.recorder
        self.state.device = object()

    def tearDown(self):
        self.state.native_identity_exchange.close()
        for active in list(self.state._recording.values()):
            if "stop" in active:
                active["stop"].set()
                active["thread"].join(timeout=2)
                self.assertFalse(active["thread"].is_alive(), "sampler leaked")
        self.temp.cleanup()

    def capture(self, action, mode="sampled-frames/v1", **values):
        request = dict(runId="fixture-run", stagingDir=str(self.root / "fixture-run"),
                       action=action, mode=mode, intervalMs=1, maxFrames=2,
                       maxBytes=100, stopTimeoutMs=500)
        request.update(values)
        return self.state.capture_control({"request": request})

    def finish_sampler(self):
        active = self.state._recording["fixture-run"]
        active["thread"].join(timeout=2)
        self.assertFalse(active["thread"].is_alive())
        return active
