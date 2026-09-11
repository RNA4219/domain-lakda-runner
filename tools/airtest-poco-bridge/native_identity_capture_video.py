"""native録画を監視し、停止確認の待機を呼出し側で有界にする。"""
import threading


class NativeCaptureVideo:
    def __init__(self, guard, monitor=True):
        self.guard = guard
        self.finished = threading.Event()
        self._requested = threading.Event()
        self._lock = threading.Lock()
        self._stopped = False
        self._failure = None
        self._thread = None
        self._launch(monitor)

    def _launch(self, monitor):
        self.finished.clear()
        self._thread = threading.Thread(target=self._work, args=(monitor,), name="native-capture-video", daemon=True)
        self._thread.start()

    def _work(self, monitor):
        try:
            while monitor and not self._requested.is_set():
                try:
                    self.guard.check_video()
                except Exception:
                    with self._lock:
                        self._failure = "native-capture-guard-failed"
                    break
                self._requested.wait(0.1)
            try:
                stopped = self.guard.stop_video() is True
            except Exception:
                stopped = False
            with self._lock:
                self._stopped = stopped
        finally:
            self.finished.set()

    def stop(self, timeout_ms):
        if type(timeout_ms) is not int or not 1 <= timeout_ms <= 300000:
            return {"stopped": False, "reason": "native-capture-stop-timeout-invalid"}
        with self._lock:
            self._requested.set()
            if not self._stopped and not self._thread.is_alive():
                self._launch(False)
            thread = self._thread
        thread.join(timeout_ms / 1000)
        if thread.is_alive():
            return {"stopped": False, "reason": "native-capture-stop-timeout"}
        with self._lock:
            return {"stopped": self._stopped, "failure": self._failure,
                    "reason": None if self._stopped else "native-capture-stop-unconfirmed"}
