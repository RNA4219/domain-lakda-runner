"""観測したSDK接続による撮影と、元の接続だけを使う終了処理。"""
from pathlib import Path
import time
import native_identity_clock as clock
from native_identity import _private_adb_logging


class NativeCaptureGuard:
    def __init__(self, guard):
        self.guard = guard
        self.device, _, self.adb, self.selector = guard.entry["marker"]
        self.display = getattr(self.adb, "display_id", None)
        self._snapshot = getattr(self.adb, "snapshot", None)
        self._start = getattr(self.device, "start_recording", None)
        self._stop = getattr(self.device, "stop_recording", None)
        self._recorder = getattr(self.device, "yosemite_recorder", None)
        self._owned, self._stopped, self._process = False, False, None
        self.start_unconfirmed = False

    def fail(self, reason):
        raise self.guard.actions.error_type(reason, 412)

    def _connection(self):
        if getattr(self.device, "adb", None) is not self.adb or getattr(self.adb, "serialno", None) != self.selector or getattr(self.adb, "display_id", None) != self.display:
            self.fail("capture-connection-mismatch")
        self.guard.actions.exchange._check_transport(self.guard.entry["transport"], self.guard.entry["marker"])

    def check(self):
        self.guard.check()
        self._connection()

    def snapshot(self, filename):
        self.check()
        if not callable(self._snapshot):
            self.fail("capture-snapshot-unavailable")
        with _private_adb_logging():
            value = self._snapshot()
        self.check()
        if not isinstance(value, bytes) or not value.startswith(b"\x89PNG\r\n\x1a\n"):
            self.fail("capture-snapshot-invalid")
        Path(filename).write_bytes(value)

    def _video_connection(self):
        self._connection()
        if self._recorder is None or getattr(self.device, "yosemite_recorder", None) is not self._recorder or getattr(self._recorder, "adb", None) is not self.adb or getattr(self.device, "recorder", None) is not None:
            self.fail("capture-recorder-mismatch")

    def start_video(self, output):
        self.check()
        self._video_connection()
        if self._owned or self.start_unconfirmed or self.display not in (None, 0) or not callable(self._start) or not callable(self._stop):
            self.fail("capture-video-unavailable")
        entry = self.guard.entry
        seconds = int(min(entry["deadline"], entry["approval_deadline"]) - time.monotonic())
        seconds = min(seconds, (entry["approval_end"] - clock.wall_milliseconds()) // 1000, 1800)
        if seconds < 1:
            self.fail("capture-duration-expired")
        self.start_unconfirmed = True
        with _private_adb_logging():
            result = self._start(output=output, max_time=seconds, mode="yosemite")
        if result is None:
            self.start_unconfirmed = False
            return None
        self._process = getattr(self._recorder, "recording_proc", None)
        if not isinstance(result, str) or result != output or self._process is None:
            self.fail("capture-start-unconfirmed")
        self._owned = True
        self.start_unconfirmed = False
        return result

    def check_video(self):
        self.check()
        self._video_connection()
        if not self._owned or getattr(self._recorder, "recording_proc", None) is not self._process:
            self.fail("capture-recording-changed")

    def stop_video(self):
        if self._stopped:
            return True
        if not self._owned:
            self.fail("capture-video-unowned")
        self._video_connection()
        if getattr(self._recorder, "recording_proc", None) is not self._process:
            self.fail("capture-recording-changed")
        with _private_adb_logging():
            result = self._stop()
        self._video_connection()
        current = getattr(self._recorder, "recording_proc", None)
        if current is not None and current is not self._process:
            self.fail("capture-recording-changed")
        self._stopped = result is True
        return self._stopped
