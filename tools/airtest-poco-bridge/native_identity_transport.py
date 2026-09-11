"""ADBの継続接続とtransport IDを合わせて接続世代を保持する。"""
import math
import select
import socket
import threading
import time
import native_identity_transport_protocol as protocol
from native_identity_transport_protocol import NativeTransportError


class NativeAndroidTransport:
    def __init__(self, adb, idle_timeout=330):
        self.adb = adb
        self.binding = protocol.descriptor(adb)
        self.stopped = threading.Event()
        self._close_lock = threading.Lock()
        self._socket = None
        self.thread = None
        self._failure = "transport-closed"
        if isinstance(idle_timeout, bool) or not isinstance(idle_timeout, (int, float)) or not math.isfinite(idle_timeout) or not 0.01 <= idle_timeout <= 330:
            raise NativeTransportError("transport-config-invalid")
        self._idle_deadline = time.monotonic() + idle_timeout
        try:
            deadline = time.monotonic() + protocol.IO_TIMEOUT
            self._socket = protocol.open_service(self.binding, "host:track-devices-l", deadline)
            self._transport_id = protocol.selected_transport(protocol.read_frame(self._socket, deadline), self.binding[2])
            if protocol.descriptor(adb) != self.binding:
                raise NativeTransportError("transport-config-invalid")
            self.thread = threading.Thread(target=self._read_updates, name="lakda-native-transport", daemon=True)
            self.thread.start()
        except Exception:
            self._invalidate("transport-unavailable")
            raise NativeTransportError("transport-unavailable") from None

    @property
    def closed(self):
        return self.stopped.is_set()

    def keepalive(self, deadline):
        self._assert_live()
        if not math.isfinite(deadline):
            raise NativeTransportError("transport-config-invalid")
        self._idle_deadline = max(self._idle_deadline, deadline)

    def _assert_live(self):
        if not self.closed and time.monotonic() >= self._idle_deadline:
            self._invalidate("transport-expired")
        if self.closed:
            raise NativeTransportError(self._failure)

    def _invalidate(self, code):
        with self._close_lock:
            if self.closed:
                return
            self._failure = code
            self.stopped.set()
            if self._socket is not None:
                try:
                    self._socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self._socket.close()

    def close(self):
        self._invalidate("transport-closed")
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=1)
            if self.thread.is_alive():
                raise NativeTransportError("transport-close-unconfirmed")

    def _read_updates(self):
        try:
            while not self.closed:
                now = time.monotonic()
                if now >= self._idle_deadline:
                    raise NativeTransportError("transport-expired")
                if not select.select([self._socket], [], [], min(0.05, self._idle_deadline - now))[0]:
                    continue
                payload = protocol.read_frame(self._socket, min(time.monotonic() + protocol.IO_TIMEOUT, self._idle_deadline))
                if protocol.selected_transport(payload, self.binding[2]) != self._transport_id:
                    raise NativeTransportError("transport-generation-mismatch")
        except NativeTransportError as error:
            self._invalidate(error.code)
        except Exception:
            self._invalidate("transport-unavailable")

    def check(self, adb):
        try:
            self._assert_live()
            if adb is not self.adb or protocol.descriptor(adb) != self.binding:
                raise NativeTransportError("transport-config-invalid")
            if protocol.query_transport(self.binding, time.monotonic() + protocol.IO_TIMEOUT) != self._transport_id:
                raise NativeTransportError("transport-generation-mismatch")
            self._assert_live()
            if self.closed or protocol.descriptor(adb) != self.binding:
                raise NativeTransportError(self._failure if self.closed else "transport-config-invalid")
        except NativeTransportError as error:
            self._invalidate(error.code)
            raise
        except Exception:
            self._invalidate("transport-unavailable")
            raise NativeTransportError("transport-unavailable") from None
